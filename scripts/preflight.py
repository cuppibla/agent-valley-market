"""Prove the toolchain is green before the lab starts. Boots nothing.

    python scripts/preflight.py
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

OK, BAD = "  ✓", "  ✗"
problems: list[str] = []


def check(label: str, ok: bool, hint: str = "") -> None:
    print(f"{OK if ok else BAD} {label}")
    if not ok:
        problems.append(hint or label)


def main() -> None:
    print("\nAgent Valley · preflight\n")

    check(f"python {sys.version_info.major}.{sys.version_info.minor}",
          sys.version_info >= (3, 11), "python 3.11+ required")

    try:
        import google.adk  # noqa: F401
        check("google-adk", True)
    except ImportError:
        check("google-adk", False, "run: uv sync")

    check("node + npm", bool(shutil.which("npm")), "install Node 20+ for the valley app")

    import forge  # settles Vertex-vs-key config
    from forge.agent.backends import configured, using_vertex

    if using_vertex():
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        check(f"Vertex AI · project {project or '(none found)'}", bool(project),
              "gcloud config set project YOUR_PROJECT_ID  (and gcloud auth application-default login)")
    else:
        check("API key (.env)", configured(),
              "cp .env.example .env — then either leave GOOGLE_GENAI_USE_VERTEXAI=TRUE "
              "(and point gcloud at a project), or paste a key from https://aistudio.google.com/apikey")

    check("the shared runtime imports", True)

    # This week's own graph, and where it keeps its memory. `approve` in the node
    # list means chapter 3's edit is in; SqliteSessionService means chapter 4's is.
    try:
        from street.agent import root_agent
        names = [n.name for n in root_agent.graph.nodes if not n.name.startswith("__")]
        gate = "approve" in names
        print(f"{OK} street     · workflow · {len(names)} nodes"
              f"{'  · the manager is in' if gate else '  · no manager yet (chapter 3 adds one)'}")
        import street.service as svc
        store = type(svc._sessions).__name__
        print(f"{OK} ledger     · {store}"
              f"{'' if store.startswith('Sqlite') else '  · in memory (chapter 4 moves it to a file)'}")
    except Exception as exc:                      # noqa: BLE001
        check("street imports", False, f"street/agent.py did not import: {exc}")

    print()
    if problems:
        print("PREFLIGHT RED — fix these first:")
        for p in problems:
            print(f"   · {p}")
        sys.exit(1)
    print("PREFLIGHT GREEN — nothing is running yet; each chapter boots what it needs.\n")


if __name__ == "__main__":
    main()
