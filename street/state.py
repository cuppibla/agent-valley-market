"""Every key this shop remembers, in one place.

Five keys. Each one is written by somebody and read by somebody else — a key that
is only ever written is decoration, and there are none of those here.

The shop stops three times in a normal day (the desk asks you something, the courier
is out, the manager has to sign) and **every one of those pauses ends the turn**.
So nothing this shop needs can live in `temp:`: by the time the courier knocks, the
turn that started the order is long over. That is why the fourth drawer is empty.

    key              scope    written by                       read by
    ─────────────────────────────────────────────────────────────────────────────
    orders           session  reserve · courier · charge ·      the guard in charge,
                              refund                            charge after the pause,
                                                                verify, Twill
    case             session  verify · approve                  refund, Twill, the back office
    user:sparks      user     charge · refund                   Twill, the purse
    user:inventory   user     grant · refund                    Twill
    app:stock        app      reserve · refund                  reserve, as a gate

`orders` is the series contract's `order_state`; the order number **is** its
`idempotency_key`; `case` is its `pending_trade`. There is no `execution_trace`,
because the session's own event list already is one.
"""

from __future__ import annotations

# ── session: this conversation ──────────────────────────────────────────────
ORDERS = "orders"
"""The ledger: {order_key: {item, price, status, ticket?}}.

`status` is the shop's whole lifecycle, and every pause has a name in it:

    reserved  →  out_for_delivery  →  paid  →  refunded

The key is the order number the courier wrote on the parcel, which makes it the
idempotency key: a retried order carries the same one, a new order does not.
"""

CASE = "case"
"""The return being worked on: {ok, key, item, name, amount, stamped?, note?}.

While `stamped` is missing, a person is being waited for.
"""

# ── user: this customer, in every conversation they ever have ───────────────
SPARKS = "user:sparks"
INVENTORY = "user:inventory"

# ── app: the shop, shared by everybody who walks in ─────────────────────────
STOCK = "app:stock"
"""{item_id: how many are left}. The one key two customers share."""

# ── the statuses, so nothing is spelled two ways ────────────────────────────
RESERVED = "reserved"
OUT_FOR_DELIVERY = "out_for_delivery"
PAID = "paid"
REFUNDED = "refunded"
