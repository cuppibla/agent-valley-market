# Market Street — Agent 101, week three

**Nothing may be sold twice.** Week one asked who says what runs; week two asked who
decides what runs next. This week asks **what a run leaves behind** — the memory that
makes a retry safe, the file that makes a crash survivable, and the person the workflow
waits for. You take your familiar shopping, and the shop has to remember.

▶ **Start here: [Run it](#run-it).** The written codelab is a draft and lives elsewhere;
everything you need to run the thing is in this repo.

**You do not need weeks one or two.** The story continues, the lab stands alone.

## Run it

```bash
git clone https://github.com/cuppibla/agent-valley-market
cd agent-valley-market
uv sync
cp .env.example .env
uv run python scripts/preflight.py
```

`.env.example` defaults to **Vertex AI**, so it picks up whatever project `gcloud` is
pointed at — nothing to edit and no key to paste.

Then two surfaces, each right before you need it:

```bash
uv run adk web .
```

```bash
bash valley.sh
```

The first is the workbench — the graph raw, on `:8000`. The second is the stage — the
street on `:8300` and the shop on `:3200`.

## What's in here

| | |
|---|---|
| `street/agent.py` | the workflow you edit — two of the three edits, both one line |
| `street/service.py` | the shop's back end — the third edit: where the ledger lives |
| `street/lookups.py` | the stall: three things for sale, plain data |
| `site/` | Market Street itself (Next.js) — the counter, the back room, the Monocle |
| `forge/` | the **shared runtime** — identical in every week of the series |

Once the ledger is in a file, the workbench can read the shop's own sessions:

```bash
uv run adk web --session_service_uri=sqlite:///market.db .
```

Three slashes. Two (`sqlite://market.db`) silently means "in memory".

## The series

Each week is its own repo, so each one clones small and stands alone.

| | | |
|---|---|---|
| 01 · Control | The Summoning Grove | [agent-valley-lab](https://github.com/cuppibla/agent-valley-lab) |
| 02 · Decompose | The Buildyard | [agent-valley-buildyard](https://github.com/cuppibla/agent-valley-buildyard) |
| **03 · Coordinate** | **Market Street** | this repo |
| 04 · Remember | The Archive | with the live series |
| 05 · Live | The Night Market | with the live series |
