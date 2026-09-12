"""What the stall sells. Plain data — prices are not something a model gets to invent."""

from __future__ import annotations

ITEMS: dict[str, dict] = {
    "star-lantern": {"name": "Star Lantern", "price": 4, "blurb": "hangs from the collar",
                     "icon": "/world/icons/items/star-lantern.jpg"},
    "cape":         {"name": "Rain Cape",    "price": 6, "blurb": "for a rainy week",
                     "icon": "/world/icons/items/cape.jpg"},
    "charm":        {"name": "Lucky Charm",  "price": 3, "blurb": "rings on the porch",
                     "icon": "/world/icons/items/charm.jpg"},
}

START_PURSE = 30          # every familiar arrives on Market Street with thirty sparks


def stall() -> str:
    """The stall as a model reads it — one line per item, id first."""
    return "\n".join(f"  {k}  — {v['name']}, ✦{v['price']}, {v['blurb']}" for k, v in ITEMS.items())


def find(text: str | None) -> str | None:
    """An item id from a name the customer used. Tolerant: 'lantern' is enough."""
    t = (text or "").lower()
    for k, v in ITEMS.items():
        if k in t or v["name"].lower() in t or v["name"].split()[-1].lower() in t:
            return k
    return None
