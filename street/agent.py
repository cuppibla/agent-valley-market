"""Market Street — a shop that can stop, and writes down where it stopped.

    START ─▶ desk ─▶ route ─┬─ "buy" ────▶ reserve ─▶ dispatch ─▶ charge ─▶ grant ─▶ reply
                            ├─ "return" ─▶ verify ─▶ [approve] ─▶ refund ─▶ reply
                            └─ "ask" ────▶ twill

Grand opening. Everything is for sale, and nothing may be sold twice.

Week two was about the shape of the graph. This week is about what a run leaves
behind — because this shop stops three times in a normal day, and **every one of
those pauses ends the turn**:

    the desk asks you something     `mode="task"`               waits for the person in front of it
    the courier is out              `LongRunningFunctionTool`   waits for the world
    the manager has to sign         `RequestInput`              waits for somebody somewhere else

Every pause leaves a name in the ledger — `reserved`, `out_for_delivery`, a case
with no stamp on it — and the run that picks it up again is a different turn, in a
different process, possibly tomorrow. Which is why, after a pause, **the edge
carries nothing and the ledger carries everything.** Read `charge`.

The keys are declared once, in `street/state.py`. Two edits, two chapters:

    EDIT ONE    chapter 3   one word in the edges      a manager the graph waits for
    EDIT TWO    chapter 4   one line in `service.py`   the ledger survives the night
"""

from __future__ import annotations

from typing import Any, Literal

from google.adk import Agent, Event, Workflow
from google.adk.agents.context import Context
from google.adk.events import EventActions
from google.adk.events.request_input import RequestInput
from google.adk.tools import LongRunningFunctionTool
from google.adk.workflow import FunctionNode
from google.genai import types
from pydantic import BaseModel, Field

from street import lookups
from street.lookups import ITEMS, OPENING_STOCK, START_PURSE
from street.state import (CASE, INVENTORY, ORDERS, OUT_FOR_DELIVERY, PAID, REFUNDED,
                          RESERVED, SPARKS, STOCK)

MODEL = "gemini-3-flash-preview"

# Gemini 3 thinks before it answers. Nothing here needs deliberation — the desk
# fills in a form and the dispatcher hands over a parcel — so thinking is off and
# the only slow thing on screen is a pause.
FAST = types.GenerateContentConfig(
    thinking_config=types.ThinkingConfig(thinking_budget=0))


# ── PAUSE ONE · the desk asks you something ─────────────────────────────────
class Slip(BaseModel):
    """What the desk writes down. A schema, not a paragraph: the graph routes on
    `intent`, and `mode="task"` validates the finished slip against this."""

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
        "\n\nRead the customer's message and fill in the slip. If they want to buy but "
        "have not said which thing, leave `item` empty — the clerk will ask them. "
        "Fill in the slip and nothing else."
    ),
)


# ── PAUSE ONE · the clerk asks you something ────────────────────────────────
# The desk above is an ordinary node agent, which means it is `single_turn`: it gets
# one shot, it cannot ask anything, and if it were missing a fact it would hand its
# own QUESTION down the edge as though it were an answer. So the asking lives in its
# own node, in `task` mode — the one mode that lets an agent inside a workflow talk
# to the customer across several turns. The workflow stops here, right at this box,
# until `finish_task` is called.
clerk = Agent(
    name="clerk",
    model=MODEL,
    generate_content_config=FAST,
    output_schema=Slip,
    mode="task",
    instruction=(
        "You are the clerk at Twill's shop. The customer wants to buy something but "
        "has not said which. The stall sells:\n\n" + lookups.stall() +
        "\n\nAsk them which one — one short question, nothing else. When they tell you, "
        "call finish_task with intent 'buy' and the item id. Never guess for them."
    ),
)


def route(ctx: Context, node_input: Any):
    """Read the slip and say which way the customer goes.

    The desk is a model and this is a function — the model fills in the form, the
    code decides. Note what is NOT here: the slip is not written to state. It
    travels one hop, to `reserve`, so it travels on the edge. Not everything
    belongs in the ledger.
    """
    slip = dict(node_input) if isinstance(node_input, dict) else {"intent": "ask"}
    slip["item"] = lookups.find(slip.get("item")) or lookups.find(str(node_input))
    intent = slip.get("intent") if slip.get("intent") in ("buy", "return", "ask") else "ask"

    if intent == "buy":
        if not slip["item"]:
            intent = "pick"         # they want something, but not which — the clerk asks
        elif int(ctx.state.get(STOCK, OPENING_STOCK).get(slip["item"], 0)) <= 0:
            intent = "ask"          # Twill has the shelf in front of her; let her say it
    slip["intent"] = "buy" if intent == "pick" else intent
    return Event(message=f"desk · {intent}", output=slip,
                 actions=EventActions(route=intent))


# ── buying ──────────────────────────────────────────────────────────────────
def reserve(ctx: Context, node_input: Any):
    """Take one off the shelf and write the order down.

    Read the `if`. Putting the same order in the ledger twice is the same as
    putting it there once, but taking it off the SHELF twice is not — so the whole
    block is skipped when the order number is already known. That is idempotency,
    and it is free for a write and never free for arithmetic. Remember this when
    you get to `charge`, which does arithmetic on somebody's purse.
    """
    slip = node_input
    item = ITEMS[slip["item"]]
    key = slip.get("order") or "#" + ctx.invocation_id[-4:]
    ledger = dict(ctx.state.get(ORDERS, {}))

    if key not in ledger:
        shelf = dict(ctx.state.get(STOCK, OPENING_STOCK))
        shelf[slip["item"]] = max(0, int(shelf.get(slip["item"], 0)) - 1)
        ctx.state[STOCK] = shelf
        ledger[key] = {"item": slip["item"], "name": item["name"], "price": item["price"],
                       "status": RESERVED}
        ctx.state[ORDERS] = ledger
    return Event(message=f"reserve · {item['name']} put aside · {key}",
                 output={"key": key, **ledger[key]})


# ── PAUSE TWO · the courier is out ──────────────────────────────────────────
def hand_to_courier(order: str, tool_context) -> dict:
    """Hand the parcel to the courier and get a ticket.

    This returns while the courier is still walking. Nothing here waits.

    Args:
        order: the order number written on the parcel.
    Returns:
        The ticket, and the fact that it has not been delivered yet.
    """
    ledger = dict(tool_context.state.get(ORDERS, {}))
    if order in ledger:
        ledger[order] = {**ledger[order], "status": OUT_FOR_DELIVERY, "ticket": order}
        tool_context.state[ORDERS] = ledger
    return {"status": OUT_FOR_DELIVERY, "ticket": order}


dispatch = Agent(
    name="dispatch",
    model=MODEL,
    generate_content_config=FAST,
    # A LONG-RUNNING tool. It returns a ticket immediately and the run ENDS — not
    # because anybody was asked anything, but because the shop is now waiting on
    # the world. The delivery arrives later, out of band, on that ticket.
    tools=[LongRunningFunctionTool(hand_to_courier)],
    instruction=("You hand parcels to the courier. Call hand_to_courier with the order "
                 "number you were given, then say one short sentence about it being on "
                 "its way. Nothing else."),
)


def charge(ctx: Context, node_input: Any):
    """Cash on delivery. This runs when the courier reports back, not before.

    Look at what it does NOT do: it does not read `node_input`. It cannot. The
    parcel left in one turn and the delivery came back in another, so the only
    thing connecting them is the ledger — which is the whole argument for this
    week in one line of code.
    """
    ledger = dict(ctx.state.get(ORDERS, {}))
    key = next((k for k, v in ledger.items() if v["status"] == OUT_FOR_DELIVERY), None)
    if key is None:
        return Event(message="charge · no parcel out for delivery", output=None)
    order = {"key": key, **ledger[key]}

    if ledger[key].get("charged"): return seen(ctx, key, order)

    purse = int(ctx.state.get(SPARKS, START_PURSE))
    ctx.state[SPARKS] = purse - order["price"]
    # `charged` is the fact the guard reads, and unlike `status` nothing ever unsets
    # it. A retried order really does send a second parcel, so the status really does
    # go back out for delivery — what must not happen twice is the money.
    ledger[key] = {**ledger[key], "status": PAID, "charged": True}
    ctx.state[ORDERS] = ledger
    return Event(message=f"charge · ✦{order['price']} on delivery · purse {purse} → {purse - order['price']}",
                 output={**order, "charged": True})


def seen(ctx: Context, key: str, order: dict) -> Event:
    """The ledger says this one was already paid for. Charge nothing, tidy up, carry on."""
    ledger = dict(ctx.state.get(ORDERS, {}))
    ledger[key] = {**ledger[key], "status": PAID}
    ctx.state[ORDERS] = ledger
    return Event(message=f"charge · seen {key} already — not charged again",
                 output={**order, "charged": False})


def grant(ctx: Context, node_input: Any):
    """Hang it on the collar. `user:` — it is theirs in every conversation after this."""
    order = node_input or {}
    if not order.get("key"):
        return Event(message="grant · nothing to hang", output=order)
    worn = list(ctx.state.get(INVENTORY, []))

    # 👉 TRY IT — chapter 5. Uncomment this line and buy something. `grant` has no
    #    business in the till, and the auditor in `street/auditor.py` will say so.
    #
    #     ctx.state[SPARKS] = 999

    if order["item"] not in worn:
        worn.append(order["item"])
        ctx.state[INVENTORY] = worn
    return Event(message=f"grant · {order['name']} is on the collar", output=order)


# ── returning ───────────────────────────────────────────────────────────────
def verify(ctx: Context, node_input: Any):
    """Find the order in the ledger. Nothing leaves the till on a customer's say-so."""
    slip = node_input if isinstance(node_input, dict) else {}
    ledger = ctx.state.get(ORDERS, {})
    key = slip.get("order")
    if key not in ledger:
        paid = [k for k, v in ledger.items() if v["status"] == PAID
                and (not slip.get("item") or v["item"] == slip["item"])]
        key = paid[-1] if paid else None
    if key is None:
        case = {"ok": False, "why": "no such order in the ledger"}
        ctx.state[CASE] = case
        return Event(message="verify · nothing in the ledger to refund", output=case)
    entry = ledger[key]
    case = {"ok": True, "key": key, "item": entry["item"], "name": entry["name"],
            "amount": entry["price"]}
    ctx.state[CASE] = case
    return Event(message=f"verify · {case['name']} · ✦{case['amount']} · paid", output=case)


# ── PAUSE THREE · the manager has to sign ───────────────────────────────────
STAMP = "till:stamp"


class Stamp(BaseModel):
    """What the manager sends back."""

    ok: bool = Field(description="True to refund. False to decline.")
    note: str = Field("", description="If declining, why — the customer will hear it.")


async def _approve(ctx: Context, node_input: Any):
    """Stop the run, and wait for somebody who is not in this conversation.

    The desk also waits for a person, and the difference is the whole lesson: the
    desk's answer is the customer's next message, arriving on a channel that is
    already open, so it needs no name. This answer comes back from the back office,
    which is a different screen and possibly a different person, so it needs an
    `interrupt_id` to say which case it is answering.

    The node runs twice. On the way in there is no answer, so it asks and returns —
    and the run ENDS. Whenever the answer arrives, the node runs again with
    `ctx.resume_inputs` filled in and falls through to the bottom. That is what
    `rerun_on_resume=True` buys.
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
            payload=case,
            response_schema=Stamp,
        )
        return

    case = {**case, "stamped": bool(answer.get("ok")), "note": (answer.get("note") or "").strip()}
    ctx.state[CASE] = case
    yield Event(message="approve · stamped" if case["stamped"]
                else f"approve · declined — {case['note'] or 'no reason given'}", output=case)


approve = FunctionNode(func=_approve, name="approve", rerun_on_resume=True)


def refund(ctx: Context, node_input: Any):
    """Sparks back, item off the collar, one back on the shelf — if the case allows it.

    Read the middle line. Before chapter three there is no `stamped` key on a case,
    so a refund goes through with nobody looking. After it, the manager's word is on
    the case and this line reads it.
    """
    case = node_input
    if not case.get("ok"):
        return Event(message="refund · nothing to refund", output=case)
    if "stamped" in case and not case["stamped"]:
        return Event(message="refund · not stamped — the till stays shut", output=case)

    purse = int(ctx.state.get(SPARKS, START_PURSE))
    ctx.state[SPARKS] = purse + case["amount"]
    ctx.state[INVENTORY] = [i for i in ctx.state.get(INVENTORY, []) if i != case["item"]]
    shelf = dict(ctx.state.get(STOCK, OPENING_STOCK))
    shelf[case["item"]] = int(shelf.get(case["item"], 0)) + 1
    ctx.state[STOCK] = shelf
    ledger = dict(ctx.state.get(ORDERS, {}))
    ledger[case["key"]] = {**ledger[case["key"]], "status": REFUNDED}
    ctx.state[ORDERS] = ledger
    return Event(message=f"refund · ✦{case['amount']} back · purse {purse} → {purse + case['amount']}",
                 output={**case, "refunded": True})


# ── Twill's mouth ───────────────────────────────────────────────────────────
def reply(ctx: Context, node_input: Any):
    """What the customer hears. A function, so the words follow the ledger exactly."""
    x = node_input or {}
    purse = ctx.state.get(SPARKS, START_PURSE)
    if x.get("charged"):
        text = (f"The {x['name']} is yours — ✦{x['price']} on delivery, ✦{purse} left.")
    elif x.get("key") and "charged" in x:
        text = (f"I've seen order {x['key']} already, so I didn't charge you twice. "
                f"Your purse is still ✦{purse}.")
    elif x.get("refunded"):
        text = f"Done — ✦{x['amount']} is back in your purse. ✦{purse} now."
    elif "stamped" in x and not x["stamped"]:
        text = "The manager said no" + (f": {x['note']}." if x.get("note") else ". Sorry about that.")
    elif not x.get("ok", True):
        text = "I can't find that in the ledger, so there's nothing to refund."
    else:
        text = "That's all sorted."
    return Event(message=text)


twill = Agent(
    name="twill",
    model=MODEL,
    generate_content_config=FAST,
    instruction=(
        "You are Twill, the owl who keeps the shop on Market Street. Answer the customer "
        "in one or two short, warm sentences, using ONLY the facts below.\n\n"
        # Every line here is state. Functions wrote it; Twill reads it. That is how a
        # plain function and a model share one memory: they agree on the names of keys.
        "Sparks in their purse: {user:sparks?}\n"
        "On their collar right now: {user:inventory?}\n"
        "This customer's ledger: {orders?}\n"
        "What is left on the shelf, for everybody: {app:stock?}\n"
        "Their last case: {case?}\n\n"
        "If they ask how many sparks they have, say the exact number. If they ask what "
        "they are wearing, name what is on the collar, and if it is empty say so.\n"
        "If they asked for something the shelf has none of, say it is sold out and offer "
        "what is left.\n"
        "The stall sells:\n" + lookups.stall() + "\n\n"
        "House rule: nothing may be sold twice."
    ),
)


# ── the wire ────────────────────────────────────────────────────────────────
root_agent = Workflow(
    name="street",
    description="A shop that can stop: a desk that asks, a courier that is out, a manager who signs.",
    edges=[
        ("START", desk, route, {"buy": reserve, "pick": clerk, "return": verify, "ask": twill}),
        (clerk, route),
        (reserve, dispatch, charge, grant, reply),
        (verify,
         # 👉 EDIT ONE — chapter 3. Add `approve,` on the next line. One word: the
         #    graph now stops here and waits for the back office before any sparks move.

         refund, reply),
    ],
)
