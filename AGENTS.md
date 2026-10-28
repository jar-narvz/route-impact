# AGENTS.md

> Symlink this file to `CLAUDE.md` (`ln -s AGENTS.md CLAUDE.md`) so Claude Code and Codex read the same rules.

## Project
- **What:** `osm-validate` — a CLI tool that runs data-quality checks over OpenStreetMap road data (Northern California extract) and diffs two daily snapshots to flag risky changes before a release.
- **Stack:** Python 3.11+, DuckDB (+ `spatial` extension, `ST_ReadOSM`), SQL, pytest, GNU Make, bash, GitHub Actions. `osmium-tool` only for building test fixtures.
- **Key dirs:**
  - `sql/checks/` — one `.sql` file per check; each returns a single number (plus optional sample IDs)
  - `sql/extract/` — SQL that builds the `roads`, `road_nodes`, `restrictions` tables from the `.osm.pbf`
  - `src/osm_validate/` — Python runner (`cli.py`, `checks.py`, `diff.py`, `metrics.py`)
  - `tests/` — pytest; `tests/fixtures/` holds the tiny checked-in extracts
  - `data/` — downloaded extracts + DuckDB files (**gitignored, never commit**)
  - `results/` — JSON/CSV outputs per snapshot (small, committed for the README/dashboard)

## Commands
- Install: `python -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"`
- Download: `make download` (latest NorCal extract) · `make download DATE=YYMMDD` (dated snapshot)
- Run checks: `make check` (→ `results/<snapshot>/checks.json`)
- Benchmark: `make bench` (→ `results/<snapshot>/metrics.json`: rows, seconds, peak RSS)
- Diff: `make diff OLD=<snapshot> NEW=<snapshot>` (→ `results/diff_<old>_<new>.json`)
- Test: `make test` (pytest on `tests/fixtures/` only — never needs the network or the big file)
- Lint: `make lint` (`ruff check . && ruff format --check .`)

## Workflow
- `PLAN.md` is the source of truth for what to build. `PROGRESS.md` holds current status.
- Work **one step at a time**, in plan order, unless PLAN.md says steps are independent.
- A step is **done only when its Verify command produces the expected result.** Paste the actual output into PROGRESS.md.
- Touch **only the files named in the step.** If another file needs changing, stop and note it in PROGRESS.md instead.
- After each step, append an entry to the top of the PROGRESS.md log and update "Current state".
- Every number that ends up in the README or resume must come from a real `results/` file. Never invent or round up metrics.

## Roles
- **Claude Code:** plans, reviews diffs, writes/edits PLAN.md, decides when a step is done.
- **Codex:** implements steps and writes tests. Whichever agent did **not** write the code reviews it.
- **Jared:** runs the full-size NorCal benchmark on his machine, builds the Tableau dashboard, makes final calls.

## Output rules
- End every step with a summary of **≤ 5 lines** plus the list of changed files.
- Reviews read **only the changed files** (and the step in PLAN.md), not the whole repo.
- Review findings: **max 10 bullets**, most severe first, each with file:line.

## Code style
- SQL: one check per file, uppercase keywords, a header comment stating what the check counts and known false positives.
- Each check is a pure query over the extracted tables — no side effects; the runner handles output.
- Python: type hints, small functions, `pathlib`, no global state. Format with ruff.
- DuckDB connections set `memory_limit` and `threads` explicitly so benchmarks are reproducible.
- Keep the drivable-highway list in **one place** (`sql/extract/drivable.sql` or a Python constant), not duplicated.

## Don't
- Codex does not edit `PLAN.md`.
- Don't commit anything in `data/`, any `.osm.pbf` over 5 MB, `.duckdb` files, or secrets/tokens.
- No destructive git (`push --force`, `reset --hard`, history rewrites, branch deletion).
- Don't make tests depend on the network or on the full NorCal file.
- Don't add a database server, ORM, or web framework — DuckDB file + CLI only.
