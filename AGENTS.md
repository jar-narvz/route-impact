# AGENTS.md

> Symlink this file to `CLAUDE.md` (`ln -s AGENTS.md CLAUDE.md`) so Claude Code and Codex read the same rules.

## Project
- **What:** `route-impact` — measures how a day of OpenStreetMap edits changes navigation in Northern California. Routes a fixed, population-weighted trip set on two consecutive Geofabrik snapshots, reports broken and slowed trips with a LOW/MEDIUM/HIGH risk level, traces each to the edit that caused it, runs daily in GitHub Actions, and is evaluated with injected faults. Design: `docs/DESIGN.md`.
- **Stack:** Python 3.11+, DuckDB (+ `spatial` extension, `ST_ReadOSM`), SQL, scipy (`sparse.csgraph`), pytest, GNU Make, bash, GitHub Actions + Pages, Leaflet (results map) and MapLibre GL JS (playground), static pages only. `osmium-tool` only for building test fixtures. RoutingKit (C++, BSD-2, pinned commit, cloned into `data/`) only as the offline CCH order tool in `scripts/cch_order/`; never needed by tests or CI.
- **Key dirs:**
  - `sql/extract/` — SQL that builds `roads`, `road_nodes`, `places`, and graph `edges` from the `.osm.pbf` (`drivable.sql` holds the drivable list)
  - `sql/faults/` — one `.sql` per fault type (mutations applied to a copy of a snapshot DB)
  - `src/route_impact/` — Python (`cli.py`, `extract.py`, `graph.py`, `trips.py`, `impact.py`, `risk.py`, `rootcause.py`, `report.py`, `faults.py`, `metrics.py`)
  - `config/` — `speeds.toml`, `thresholds.toml`, `trips.csv`, `demo_faults.toml` (committed)
  - `site/` — static results map (`index.html`)
  - `tests/` — pytest; `tests/fixtures/` holds the tiny checked-in extracts and `expected.json`
  - `data/` — downloaded extracts + DuckDB files (**gitignored, never commit**)
  - `results/` — per-day `impact.json`, `report.md`, `impact.geojson`; `faults/`; benchmark `metrics.json` (small, committed)

## Commands
- Install: `python3.11 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]" && make setup` (`setup` installs the DuckDB `spatial` extension once; needs the network)
- Download: `make download DATE=YYMMDD` (dated snapshot, checksum-verified) · `make download` (latest)
- Impact: `make impact OLD=<YYMMDD> NEW=<YYMMDD>` (→ `results/<new-date>/`). Scripts and workflows that need the 0/1/2 exit code call `route-impact impact --old … --new …` directly — `make` turns any failure into exit 2.
- What-if: `route-impact what-if --snapshot <YYMMDD> --delete-way <id>` (also `--flip-oneway`, `--disconnect-node`)
- Faults: `make faults SNAPSHOT=<YYMMDD> N=200 SEED=2027` (→ `results/faults/<snapshot>/`)
- Benchmark: `make bench SNAPSHOT=<YYMMDD>` (→ `results/<snapshot>/metrics.json`: rows, seconds, peak RSS)
- Test: `make test` (pytest on `tests/fixtures/` only — never needs the network or the big file)
- Lint: `make lint` (`ruff check . && ruff format --check .`)

## Workflow
- `PLAN.md` is the source of truth for what to build. `PROGRESS.md` holds current status. `docs/DESIGN.md` explains why.
- Work **one step at a time**, in plan order, unless PLAN.md says steps are independent.
- A step is **done only when its Verify command produces the expected result.** Paste the actual output into PROGRESS.md.
- Touch **only the files named in the step.** If another file needs changing, stop and note it in PROGRESS.md instead.
- After each step, append an entry to the top of the PROGRESS.md log and update "Current state".
- Every number that ends up in the README or resume must come from a real `results/` file. Never invent or round up metrics.

## Roles
- **Claude Code:** plans, reviews diffs, writes/edits PLAN.md and docs/DESIGN.md, decides when a step is done.
- **Codex:** implements steps and writes tests. Whichever agent did **not** write the code reviews it.
- **Jared:** runs commits, the full-size NorCal benchmark and fault suite on his machine, makes final calls.

## Output rules
- End every step with a summary of **≤ 5 lines** plus the list of changed files.
- Reviews read **only the changed files** (and the step in PLAN.md), not the whole repo.
- Review findings: **max 10 bullets**, most severe first, each with file:line.

## Code style
- SQL: uppercase keywords; each file starts with a header comment saying what it builds or mutates and any known caveats. One fault type per file in `sql/faults/`.
- Extract and fault SQL is pure over the snapshot tables — the Python runner handles files and output.
- Python: type hints, small functions, `pathlib`, no global state. Format with ruff.
- DuckDB connections set `memory_limit` and `threads` explicitly so benchmarks are reproducible.
- Keep each rule in **one place**: drivable list in `sql/extract/drivable.sql`, default speeds in `config/speeds.toml`, risk thresholds in `config/thresholds.toml`.
- Randomness is always seeded; seeds are recorded in outputs.

## Don't
- Codex does not edit `PLAN.md` or `docs/DESIGN.md`.
- Don't commit anything in `data/`, any `.osm.pbf` over 5 MB, `.duckdb` files, or secrets/tokens.
- No destructive git (`push --force`, `reset --hard`, history rewrites, branch deletion).
- Don't make tests depend on the network or on the full NorCal file.
- Don't add a database server, ORM, web framework, or backend server — DuckDB files + CLI + static pages only.
