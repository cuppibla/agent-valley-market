"""The shop's service — a chat, a stamp, and a window onto the session.

`/chat` runs the workflow on a conversation and streams one message per thing that
happens, so the back room lights up as the crew works rather than all at once at
the end. `/stamp` is the manager's answer on its way back into a graph that is
already waiting. `/session/{id}` is what the browser rebuilds itself from after a
reload — or after the clerk faints and the shop reopens.

The graph is re-imported on every request, so an edit in `street/agent.py` changes
what the street runs without restarting anything; a syntax error falls back to the
last good graph and says so.

There is one line in this file the lab asks you to change. It is marked.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import logging
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import forge  # noqa: F401,E402  — settles Vertex-vs-key config for every surface
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from google.adk.events import Event, EventActions  # noqa: E402
from google.adk.runners import Runner  # noqa: E402
from google.adk.sessions import InMemorySessionService  # noqa: E402
from google.adk.sessions.sqlite_session_service import SqliteSessionService  # noqa: E402,F401
from google.adk.workflow.utils._workflow_hitl_utils import (  # noqa: E402
    create_request_input_response, get_request_input_interrupt_ids)
from google.genai import types  # noqa: E402

from street.auditor import Auditor  # noqa: E402
from street.lookups import ITEMS, OPENING_STOCK, START_PURSE  # noqa: E402
from street.state import CASE, INVENTORY, ORDERS, SPARKS, STOCK  # noqa: E402

log = logging.getLogger(__name__)
app = FastAPI(title="Agent 101 · W3 Market Street")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# The same names `adk web .` uses: the app is the folder, the user is "user". That is
# what lets the dev UI open the very session this service wrote.
APP, USER = "street", "user"

# ── where the shop keeps its memory ─────────────────────────────────────────
# 👉 EDIT TWO — chapter 4. This is the whole edit. Replace the line below with:
#
#     _sessions = SqliteSessionService("market.db")
#
# In memory, the ledger lives inside this process and dies with it. In a file, it
# does not — and `adk web --session_service_uri=sqlite:///market.db .` can read it.
_sessions = InMemorySessionService()

# The weather. ☔ is the courier being unreliable, and lives in the browser (it
# knocks twice). 💥 is the clerk fainting, and has to live here: the process is
# the thing that dies.
FAINT = False

_last_good = None

# One rule the whole shop keeps, watching every node's state_delta. See auditor.py.
_auditor = Auditor()


# ── the learner's graph ─────────────────────────────────────────────────────
def load_graph():
    """Re-import street.agent. Returns (workflow, error) — never raises."""
    global _last_good
    try:
        mod = importlib.import_module("street.agent")
        mod = importlib.reload(mod)
        _last_good = mod.root_agent
        return mod.root_agent, None
    except Exception as exc:                       # noqa: BLE001
        log.warning("street.agent did not import: %s", exc)
        if _last_good is None:
            raise
        return _last_good, f"{type(exc).__name__}: {exc}"


def topology(wf) -> dict:
    """The shape the back room draws: every node, every edge, and the route words."""
    edges = [{"from": e.from_node.name, "to": e.to_node.name, "route": e.route}
             for e in wf.graph.edges]
    return {"name": wf.name,
            "nodes": [n.name for n in wf.graph.nodes if not n.name.startswith("__")],
            "edges": edges}


@app.get("/health")
async def health() -> dict:
    wf, err = load_graph()
    return {"ok": True, "graph": topology(wf), "graph_error": err, "faint": FAINT,
            "store": type(_sessions).__name__}


@app.get("/graph")
async def graph() -> dict:
    wf, err = load_graph()
    return {"graph": topology(wf), "graph_error": err}


@app.get("/items")
async def items() -> dict:
    return {"items": [{"id": k, **v} for k, v in ITEMS.items()], "purse": START_PURSE}


@app.post("/weather")
async def weather(req: Request) -> dict:
    """Arm the faint for the next sale — or, with `now`, faint on the spot. The
    second is for the moment a question is waiting: the process dies with the
    manager's card still up, and what happens to the card is chapter 4's proof."""
    global FAINT
    body = await req.json()
    if "faint" in body:
        FAINT = bool(body["faint"])
    if body.get("now"):
        async def _faint():
            await asyncio.sleep(0.3)
            os._exit(1)
        asyncio.get_running_loop().create_task(_faint())
    return {"faint": FAINT}


# ── the session, as the browser sees it ─────────────────────────────────────
def _node_of(ev) -> str:
    info = (ev.model_dump().get("node_info") or {})
    return (info.get("path") or "").split("/")[-1].split("@")[0]


def _text_of(ev) -> str:
    parts = (ev.content.parts if ev.content else []) or []
    return " ".join(p.text.strip() for p in parts if p.text and p.text.strip())


def _pending(sess) -> tuple[dict | None, dict | None]:
    """What this run is holding, if anything: a question, or a parcel.

    Both are long-running function calls — an interrupt IS a long-running tool with
    a schema and an id — but they finish differently. A question is over as soon as
    ANY response carries its id. A long-running tool answers itself once, with a
    placeholder, and is still out; so the parcel is pending exactly when the ledger
    says an order is out for delivery, which is the ledger doing its job.
    """
    answered: set[str] = set()
    for ev in sess.events:
        for p in (ev.content.parts if ev.content else []) or []:
            if p.function_response and p.function_response.id:
                answered.add(p.function_response.id)

    stamp = None
    for ev in sess.events:
        ids = get_request_input_interrupt_ids(ev)
        if not ids:
            continue
        call = next((p.function_call for p in (ev.content.parts if ev.content else []) or []
                     if p.function_call), None)
        if call and call.id not in answered:
            stamp = {"id": ids[0], "message": call.args.get("message"),
                     "payload": call.args.get("payload"), "node": _node_of(ev)}

    parcel = None
    out = [k for k, v in (sess.state.get(ORDERS) or {}).items()
           if v.get("status") == "out_for_delivery"]
    if out:
        for ev in sess.events:
            if not ev.long_running_tool_ids:
                continue
            for p in (ev.content.parts if ev.content else []) or []:
                if p.function_call and p.function_call.name == "hand_to_courier" \
                        and p.function_call.id in ev.long_running_tool_ids:
                    parcel = {"call_id": p.function_call.id,
                              "order": (p.function_call.args or {}).get("order") or out[-1]}
    return stamp, parcel


def _summary(sess) -> dict:
    """Every event, compact, plus what the graph is waiting on, if anything.

    `waiting` is derived, not stored: the last interrupt with no answer after it.
    That is exactly what the graph itself would find, and it is why a question
    survives a restart — it is in the same file as the ledger.
    """
    events = []
    for ev in sess.events:
        parts = (ev.content.parts if ev.content else []) or []
        ids = get_request_input_interrupt_ids(ev)
        answered = any(p.function_response for p in parts)
        node = _node_of(ev)
        delta = dict(ev.actions.state_delta or {}) if ev.actions else {}
        e = {"author": ev.author, "node": node, "text": _text_of(ev)[:300],
             "route": (ev.actions.route if ev.actions else None), "delta": delta,
             "at": ev.timestamp}
        if ids:
            call = next(p.function_call for p in parts if p.function_call)
            e["interrupt"] = {"id": ids[0], "message": call.args.get("message"),
                              "payload": call.args.get("payload"), "node": node}
        elif answered:
            e["answer"] = True
        events.append(e)
    stamp, parcel = _pending(sess)
    return {"exists": True, "id": sess.id, "state": dict(sess.state), "events": events,
            "waiting": stamp, "parcel": parcel}


@app.get("/session/{sid}")
async def session(sid: str) -> dict:
    sess = await _sessions.get_session(app_name=APP, user_id=USER, session_id=sid)
    if sess is None:
        return {"exists": False, "id": sid, "store": type(_sessions).__name__}
    return {**_summary(sess), "store": type(_sessions).__name__}


# ── the stream ──────────────────────────────────────────────────────────────
def _sse(kind: str, **data) -> str:
    return f"data: {json.dumps({'kind': kind, **data})}\n\n"


async def _run(sid: str, message: types.Content, *, purse: int | None = None):
    """Drive the workflow and translate ADK events into the ones the browser draws.

    The same generator serves a message and a stamp, because to the workflow they
    are the same thing: a message arriving on a session.
    """
    wf, err = load_graph()
    topo = topology(wf)
    yield _sse("graph", graph=topo, graph_error=err, store=type(_sessions).__name__)

    sess = await _sessions.get_session(app_name=APP, user_id=USER, session_id=sid)
    if sess is None:
        sess = await _sessions.create_session(app_name=APP, user_id=USER, session_id=sid)
    # A new customer starts with a purse. A known one keeps theirs — `user:` state
    # follows the customer, not the conversation, and this is the first place that
    # shows.
    delta = {}
    if SPARKS not in sess.state:
        delta[SPARKS] = int(purse) if purse is not None else START_PURSE
    # The shelf belongs to the shop, not to this conversation. It is seeded once,
    # and every customer after that draws from the same one.
    if STOCK not in sess.state:
        delta[STOCK] = dict(OPENING_STOCK)
    delta = delta or None

    runner = Runner(app_name=APP, agent=wf, session_service=_sessions, plugins=[_auditor])
    t0 = time.monotonic()
    try:
        async for ev in runner.run_async(user_id=USER, session_id=sid, new_message=message,
                                         state_delta=delta):
            node = _node_of(ev)
            if not node:
                continue
            parts = (ev.content.parts if ev.content else []) or []

            # The graph has stopped and is waiting for a person. Tested BEFORE the
            # tool filter below: a pause is delivered as a function call too.
            ids = get_request_input_interrupt_ids(ev)
            if ids:
                call = next(p.function_call for p in parts if p.function_call)
                yield _sse("interrupt", node=node, interrupt_id=ids[0],
                           message=call.args.get("message"), payload=call.args.get("payload"))
                continue
            if any(p.function_call or p.function_response for p in parts):
                continue

            text = _text_of(ev)
            sd = dict(ev.actions.state_delta or {}) if ev.actions else {}
            route = ev.actions.route if ev.actions else None
            yield _sse("node", node=node, text=text[:300], delta=sd, route=route,
                       at=round(time.monotonic() - t0, 2))

            # 💥 The clerk faints. After `grant`, before `notify`: the sparks are
            # taken and written down, the courier never hears back. The process
            # ends here — not an exception, the whole process — which is the only
            # honest way to find out where the ledger really lives.
            if FAINT and node in ("dispatch", "charge"):
                yield _sse("faint", node=node)
                await asyncio.sleep(0.25)
                os._exit(1)
    except Exception as exc:                       # noqa: BLE001
        # A node blew up. That is not the shop dying — the session is intact and the
        # browser should be told what it holds, or it will assume the worst and start
        # waiting for a restart that is not coming.
        log.exception("run failed")
        yield _sse("error", message=f"{type(exc).__name__}: {exc}"[:300])

    sess = await _sessions.get_session(app_name=APP, user_id=USER, session_id=sid)
    stamp, parcel = _pending(sess) if sess else (None, None)
    yield _sse("state", state=dict(sess.state) if sess else {}, waiting=stamp, parcel=parcel,
               seconds=round(time.monotonic() - t0, 1))


def _stream(gen, sid: str) -> StreamingResponse:
    return StreamingResponse(gen, media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                                      "X-Session-Id": sid})


@app.post("/chat")
async def chat(req: Request):
    body = await req.json()
    text = (body.get("text") or "").strip()
    sid = (body.get("session_id") or "").strip() or f"c-{os.urandom(4).hex()}"
    msg = types.Content(role="user", parts=[types.Part(text=text)])
    return _stream(_run(sid, msg, purse=body.get("purse")), sid)


@app.post("/delivered")
async def delivered(req: Request):
    """The courier reports back. Nobody was asked anything — this is the world
    answering, on the ticket it was given, and it resumes the run mid-graph."""
    body = await req.json()
    sid = (body.get("session_id") or "").strip()
    sess = await _sessions.get_session(app_name=APP, user_id=USER, session_id=sid)
    if sess is None:
        return {"error": "no such session"}
    _, parcel = _pending(sess)
    if not parcel:
        return {"error": "nothing is out for delivery"}
    msg = types.Content(role="user", parts=[types.Part(
        function_response=types.FunctionResponse(
            id=parcel["call_id"], name="hand_to_courier",
            response={"status": "delivered", "ticket": parcel["order"]}))])
    return _stream(_run(sid, msg), sid)


@app.get("/queue")
async def queue() -> dict:
    """Every case waiting for a stamp, across every customer in the shop.

    This is what the back office reads, and it is the reason an interrupt carries
    an id: the answer comes back from a different screen, so it has to say which
    case it is answering.
    """
    listed = await _sessions.list_sessions(app_name=APP)
    out = []
    for s in listed.sessions:
        full = await _sessions.get_session(app_name=APP, user_id=s.user_id, session_id=s.id)
        if full is None:
            continue
        stamp, _ = _pending(full)
        if stamp:
            out.append({"session_id": full.id, "user_id": s.user_id, "interrupt_id": stamp["id"],
                        "message": stamp["message"], "case": stamp["payload"],
                        "at": full.events[-1].timestamp if full.events else None})
    return {"queue": out, "store": type(_sessions).__name__}


@app.post("/reset")
async def reset(req: Request) -> dict:
    """Opening time again: a full purse, a full shelf, and nothing in the ledger.

    This resets the SHOP, not the customer. The familiar's name and portrait are
    not in the session at all — they are the browser's save file — so there is
    nothing here that could forget them, and the button that does lives there.

    The write goes the way every other write in this shop goes: a state delta on
    an event, appended to the session. The session service is the thing that knows
    `user:` follows the customer and `app:` belongs to the shop, and it only knows
    it because the delta went through it.
    """
    body = await req.json()
    sid = (body.get("session_id") or "").strip()
    if not sid:
        return {"error": "session_id is required"}
    sess = await _sessions.get_session(app_name=APP, user_id=USER, session_id=sid)
    if sess is None:
        sess = await _sessions.create_session(app_name=APP, user_id=USER, session_id=sid)
    # A copy of the opening shelf. `OPENING_STOCK` is one dict for the whole
    # process, and handing it to the session would mean the next sale sells from
    # the constant — which then never opens full again.
    opening = {SPARKS: START_PURSE, INVENTORY: [], STOCK: dict(OPENING_STOCK),
               ORDERS: {}, CASE: {}}
    await _sessions.append_event(sess, Event(
        author="shop", invocation_id=f"reset-{os.urandom(4).hex()}",
        actions=EventActions(state_delta=dict(opening))))
    # Handed back rather than left to be fetched: the browser has just thrown away
    # everything it was drawing, and one round trip is one fewer empty frame.
    return {"ok": True, "state": opening}


@app.post("/stamp")
async def stamp(req: Request):
    """The manager's answer. Same session, same stream shape, one difference: this
    message is the answer to a question the graph is already holding."""
    body = await req.json()
    sid = (body.get("session_id") or "").strip()
    interrupt_id = (body.get("interrupt_id") or "").strip()
    if not sid or not interrupt_id:
        return {"error": "session_id and interrupt_id are both required"}
    answer = {"ok": bool(body.get("ok")), "note": (body.get("note") or "").strip()}
    msg = types.Content(role="user", parts=[create_request_input_response(interrupt_id, answer)])
    return _stream(_run(sid, msg), sid)
