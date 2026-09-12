"""Market Street — one counter, two paths, and a ledger that remembers.

    START ─▶ desk ─▶ route ─┬─ "buy" ────▶ reserve ─▶ charge ─▶ grant ─▶ notify ─▶ reply
                            ├─ "return" ─▶ verify ─▶ [approve] ─▶ refund ─▶ record ─▶ reply
                            └─ "ask" ────▶ twill

Grand opening. Everything is for sale, and nothing may be sold twice.

Week two was about the shape of the graph. This week is about what a run leaves
behind. Every node here reads and writes ONE dictionary — `ctx.state` — and that
dictionary is the shop's memory: the ledger of what was charged, the customer's
purse, the case the manager is being asked about. The graph forgets everything
between runs. The state does not, as long as it is kept somewhere a crashed process
cannot take with it — which is chapter three, and one line in `service.py`.

Three edits, three chapters:

    EDIT ONE    chapter 2   one line in `charge`       the ledger makes a retry safe
    EDIT TWO    chapter 3   one line in `service.py`   the ledger survives the night
    EDIT THREE  chapter 4   one word in the edges      a manager the graph waits for

Keys with no prefix belong to this conversation. `user:` keys follow the customer
into every conversation they ever have. `app:` keys belong to the shop, whoever
walks in. `temp:` keys are wiped when the turn ends. That is the whole of chapter 5.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from google.adk import Agent, Event, Workflow
from google.adk.agents.context import Context
from google.adk.events import EventActions
from google.adk.events.request_input import RequestInput
from google.adk.workflow import FunctionNode
from google.genai import types
from pydantic import BaseModel, Field

from street import lookups
from street.lookups import ITEMS, START_PURSE

MODEL = "gemini-3-flash-preview"

# Gemini 3 thinks before it answers. The desk's job is clerical — read a sentence,
# fill in a slip — so thinking is off, and the customer is not kept waiting.
FAST = types.GenerateContentConfig(
    thinking_config=types.ThinkingConfig(thinking_budget=0))


# ── the desk ────────────────────────────────────────────────────────────────
class Slip(BaseModel):
    """What the desk writes down. A schema, not a paragraph: the graph routes on
    `intent`, so it cannot be a sentence the code then has to interpret."""

    intent: Literal["buy", "return", "ask"] = Field(
        description="buy = they want something from the stall. return = they want to "
                    "give something back or want sparks back. ask = anything else.")
    item: str | None = Field(None, description="the item id from the stall, if the "
                                               "message names one (id, not the name)")
    order: str | None = Field(None, description="the order number written in the "
                                                "message, like #k7f2, if there is one")


desk = Agent(
    name="desk",
    model=MODEL,
    generate_content_config=FAST,
    output_schema=Slip,
    instruction=(
        "You are the front desk of Twill's shop on Market Street. The stall sells:\n\n"
        + lookups.stall() +
        "\n\nRead the customer's message and fill in the slip. Nothing else."
    ),
)


def _slip(x: Any) -> dict:
    """The slip as a dict, whatever shape the desk handed it over in."""
    if isinstance(x, dict):
        return x
    if isinstance(x, str):
        try:
            return json.loads(x)
        except ValueError:
            pass
    return {"intent": "ask", "item": None, "order": None}


def route(ctx: Context, node_input: Any):
    """Read the slip and say which way the customer goes.

    The desk is a model and this is a function — the same split as week two's
    reviewer: the model fills in the form, the code decides. A buy with no item on
    it cannot go down the buy path, so it goes to Twill, who will ask.
    """
    slip = _slip(node_input)
    slip["item"] = lookups.find(slip.get("item")) or lookups.find(str(node_input))
    if slip.get("intent") == "buy" and not slip["item"]:
        slip["intent"] = "ask"
    if slip.get("intent") not in ("buy", "return", "ask"):
        slip["intent"] = "ask"
    ctx.state["slip"] = slip
    return Event(message=f"desk · {slip['intent']}", output=slip,
                 actions=EventActions(route=slip["intent"]))


# ── buying ──────────────────────────────────────────────────────────────────
def reserve(ctx: Context, node_input: Any):
    """Put the thing aside. The order number comes from the message — the courier
    wrote it on the parcel — so a second delivery of the same parcel carries the
    same number. That number is the whole of chapter 2."""
    slip = node_input
    item = ITEMS[slip["item"]]
    key = slip.get("order") or "#" + ctx.invocation_id[-4:]
    order = {"key": key, "item": slip["item"], "name": item["name"], "price": item["price"]}
    return Event(message=f"reserve · {item['name']} put aside · {key}", output=order)


def seen(order: dict) -> Event:
    """The ledger already has this order. Say so, charge nothing, carry on."""
    return Event(message=f"charge · seen {order['key']} already — not charged again",
                 output={**order, "charged": False})


def charge(ctx: Context, node_input: Any):
    """Take the sparks, and write it down.

    The ledger is a dictionary in state keyed by order number. Reading it BEFORE
    charging is what makes a retry safe — and until you add that line, it is only
    a record, not a guard.
    """
    order = node_input
    ledger = dict(ctx.state.get("orders", {}))

    # 👉 EDIT ONE — chapter 2. Add this line, then save:
    #
    #     if order["key"] in ledger: return seen(order)

    purse = int(ctx.state.get("user:sparks", START_PURSE))
    if purse < order["price"]:
        return Event(message=f"charge · ✦{order['price']} asked, ✦{purse} in the purse — no sale",
                     output={**order, "charged": False, "short": True})
    ctx.state["user:sparks"] = purse - order["price"]
    ledger[order["key"]] = {"item": order["item"], "price": order["price"], "status": "paid"}
    ctx.state["orders"] = ledger
    return Event(message=f"charge · ✦{order['price']} · purse {purse} → {purse - order['price']}",
                 output={**order, "charged": True})


def grant(ctx: Context, node_input: Any):
    """Hang it on the collar. `user:` — it is theirs in every conversation after this one."""
    order = node_input
    worn = list(ctx.state.get("user:inventory", []))
    if order.get("short"):
        return Event(message="grant · nothing to hang — it was not paid for", output=order)
    if order["item"] not in worn:
        worn.append(order["item"])
        ctx.state["user:inventory"] = worn
    return Event(message=f"grant · {order['name']} is on the collar", output=order)


def notify(ctx: Context, node_input: Any):
    """Tell the courier. The last thing that happens on a sale — and the step a
    fainting clerk never reaches, which is why the courier comes back."""
    return Event(message="notify · the courier has the parcel", output=node_input)


# ── returning ───────────────────────────────────────────────────────────────
def verify(ctx: Context, node_input: Any):
    """Find the order in the ledger. Nothing leaves the till on a customer's say-so."""
    slip = node_input
    ledger = ctx.state.get("orders", {})
    key = slip.get("order")
    if key not in ledger:
        paid = [k for k, v in ledger.items() if v["status"] == "paid"
                and (not slip.get("item") or v["item"] == slip["item"])]
        key = paid[-1] if paid else None
    if key is None:
        case = {"ok": False, "why": "no such order in the ledger"}
        ctx.state["case"] = case
        return Event(message="verify · nothing in the ledger to refund", output=case)
    entry = ledger[key]
    case = {"ok": True, "key": key, "item": entry["item"], "name": ITEMS[entry["item"]]["name"],
            "amount": entry["price"]}
    ctx.state["case"] = case
    return Event(message=f"verify · {case['name']} · ✦{case['amount']} · paid", output=case)


STAMP = "till:stamp"


class Stamp(BaseModel):
    """What the manager sends back."""

    ok: bool = Field(description="True to refund. False to decline.")
    note: str = Field("", description="If declining, why — the customer will hear it.")


async def _approve(ctx: Context, node_input: Any):
    """Stop, and wait for a person.

    The node runs twice. On the way in there is no answer, so it asks and returns —
    and the run ENDS. The question is not lost: it is held in the session, next to
    the ledger. Whenever the answer arrives — a second later or a day later, in a
    different process — the node runs again with `ctx.resume_inputs` filled in and
    falls through to the bottom. That is why it is declared with
    `rerun_on_resume=True`: without it the body never runs a second time.

    The answer is not routed on — week two did that. It is written into the case,
    and `refund` reads it there. The human's decision travels the same way as
    everything else this week: as state.
    """
    case = node_input
    if not case.get("ok"):
        yield Event(message="approve · nothing to stamp", output=case)
        return

    answer = ctx.resume_inputs.get(STAMP)
    if answer is None:
        yield RequestInput(
            interrupt_id=STAMP,
            message=f"Refund ✦{case['amount']} for the {case['name']}?",
            payload=case,                     # what the manager is looking at
            response_schema=Stamp,
        )
        return

    case = {**case, "stamped": bool(answer.get("ok")), "note": (answer.get("note") or "").strip()}
    ctx.state["case"] = case
    yield Event(message="approve · stamped" if case["stamped"]
                else f"approve · declined — {case['note'] or 'no reason given'}", output=case)


approve = FunctionNode(func=_approve, name="approve", rerun_on_resume=True)


def refund(ctx: Context, node_input: Any):
    """Sparks back, item off the collar — if the case allows it.

    Read the middle line. Before chapter 4 there is no `stamped` key on the case,
    so a refund goes through with nobody looking. After it, the manager's word is
    on the case and this line reads it.
    """
    case = node_input
    if not case.get("ok"):
        return Event(message="refund · nothing to refund", output=case)
    if "stamped" in case and not case["stamped"]:
        return Event(message="refund · not stamped — the till stays shut", output=case)

    purse = int(ctx.state.get("user:sparks", START_PURSE))
    ctx.state["user:sparks"] = purse + case["amount"]
    ctx.state["user:inventory"] = [i for i in ctx.state.get("user:inventory", []) if i != case["item"]]
    ledger = dict(ctx.state.get("orders", {}))
    ledger[case["key"]] = {**ledger[case["key"]], "status": "refunded"}
    ctx.state["orders"] = ledger
    return Event(message=f"refund · ✦{case['amount']} back · purse {purse} → {purse + case['amount']}",
                 output={**case, "refunded": True})


def record(ctx: Context, node_input: Any):
    """The shop's own count. `app:` — every customer who ever walks in adds to it."""
    case = node_input
    if case.get("refunded"):
        ctx.state["app:refunds_total"] = int(ctx.state.get("app:refunds_total", 0)) + 1
    ctx.state["temp:scratch"] = "wiped when this turn ends"
    return Event(message="record · ledger written", output=case)


# ── Twill's mouth ───────────────────────────────────────────────────────────
def reply(ctx: Context, node_input: Any):
    """What the customer hears. A function, so the words follow the ledger exactly."""
    x = node_input or {}
    purse = ctx.state.get("user:sparks", START_PURSE)
    if ctx.state.get("slip", {}).get("intent") == "buy":
        if x.get("charged"):
            text = (f"The {x['name']} is yours — ✦{x['price']} from your purse, ✦{purse} left. "
                    "The courier is on the way.")
        elif x.get("short"):
            text = f"The {x['name']} is ✦{x['price']} and your purse has ✦{purse}. Maybe return something first?"
        else:
            text = (f"I've seen order {x['key']} already, so I didn't charge you twice. "
                    f"Your purse is still ✦{purse}.")
    elif not x.get("ok"):
        text = "I can't find that in the ledger, so there's nothing to refund."
    elif x.get("refunded"):
        text = f"Done — ✦{x['amount']} is back in your purse. ✦{purse} now."
    elif "stamped" in x and not x["stamped"]:
        text = "The manager said no" + (f": {x['note']}." if x.get("note") else ". Sorry about that.")
    else:
        text = "Hmm. The case went through, but nothing moved."
    return Event(message=text)


twill = Agent(
    name="twill",
    model=MODEL,
    generate_content_config=FAST,
    instruction=(
        "You are Twill, the owl who keeps the shop on Market Street. Answer the customer "
        "in one or two short, warm sentences.\n\n"
        "The stall sells:\n" + lookups.stall() + "\n\n"
        # Every line below is state. The desk and the crew wrote it; Twill reads it.
        # That is how a function node and a model share one memory: the same keys.
        "This customer's ledger: {orders?}\n"
        "What they are wearing: {user:inventory?}\n"
        "Sparks in their purse: {user:sparks?}\n"
        "Their last case: {case?}\n\n"
        "House rule: nothing may be sold twice. If they want to buy or return something, "
        "tell them to say so plainly and you will see to it."
    ),
)


# ── the wire ────────────────────────────────────────────────────────────────
root_agent = Workflow(
    name="street",
    description="A shop that remembers: buy, return, and a ledger nothing is sold twice from.",
    edges=[
        ("START", desk, route, {"buy": reserve, "return": verify, "ask": twill}),
        (reserve, charge, grant, notify, reply),
        (verify,
         # 👉 EDIT THREE — chapter 4. Add `approve,` on the next line. One word: the
         #    graph now stops here and waits for a person before any sparks move.

         refund, record, reply),
    ],
)
