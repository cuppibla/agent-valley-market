"""Market Street — the shop that remembers. `adk web .` finds this folder by name."""
import forge  # noqa: F401,E402  — settles Vertex-vs-key config for every surface

from .agent import root_agent  # noqa: E402

__all__ = ["root_agent"]
