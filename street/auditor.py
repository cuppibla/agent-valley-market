"""The auditor — one rule the shop keeps, that no single node owns.

Week one's lesson was that **an instruction is a request and a callback is a rule**.
This is that lesson pointed at state.

`charge` and `refund` are careful with the purse. But "careful" is a property of the
code you happened to write, and the purse is `user:` state: it follows the customer
into every conversation they ever have, and any node in the shop can reach it, now or
in six months when somebody adds one. An instruction cannot stop that. A prompt
certainly cannot.

So the shop employs an auditor. It is a plugin, which means it sees **every event from
every node** — agents and plain functions alike — on the way to being written down.
When it finds a change to the till coming from a node whose job is not the till, it
takes that change out of the event before the session ever sees it, and says so.

    ALLOWED = {"charge", "refund"}

That set is the whole policy, it lives in one place, and it applies to nodes that have
not been written yet.
"""

from __future__ import annotations

from google.adk.plugins.base_plugin import BasePlugin
from google.genai import types

from street.state import SPARKS

#: The only two nodes allowed to move the customer's sparks.
ALLOWED = {"charge", "refund"}


class Auditor(BasePlugin):
    """Refuses any write to the till from a node that has no business there."""

    def __init__(self) -> None:
        super().__init__(name="auditor")
        #: Every refusal this process has made, so the shop can show its work.
        self.refusals: list[dict] = []
        #: What the till last said when somebody allowed to touch it did.
        self._last_good: dict[str, int] = {}

    async def on_event_callback(self, *, invocation_context, event):
        """Runs on the way OUT of every node, before the event is persisted.

        Returning the event replaces it; returning None leaves it alone. So taking a
        key out of `state_delta` here means the session never learns about it — the
        write does not happen late, it does not happen at all.
        """
        actions = event.actions
        delta = (actions.state_delta or {}) if actions else {}
        if SPARKS not in delta:
            return None

        node = ((event.model_dump().get("node_info") or {}).get("path") or "").split("/")[-1].split("@")[0]
        sid = invocation_context.session.id
        if node in ALLOWED:
            self._last_good[sid] = delta[SPARKS]        # an auditor knows the true figure
            return None

        refused = delta.pop(SPARKS)
        self.refusals.append({"node": node, "value": refused})
        # The delta is what gets written down, so removing the key is the refusal. But
        # the node that tried it has already changed its own copy, and the rest of THIS
        # run would go on believing it — so put the true figure back in the live state
        # as well. A rule that only holds at the boundary is a rule with a hole in it.
        true = self._last_good.get(sid, invocation_context.session.state.get(SPARKS))
        if true is not None:
            invocation_context.session.state[SPARKS] = true
        event.content = types.Content(role="model", parts=[types.Part(
            text=f"auditor · refused {SPARKS} from {node} — that is not its till")])
        return event
