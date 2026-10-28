# PROGRESS.md — route-impact

## Current state
- **Working on:** —
- **Done:** design (docs/DESIGN.md), Codex plan critique (PLAN.md → Review log), Step 0.
- **Next up:** Step 1 — Test fixtures with known answers. Claude first writes/reviews the fixture design (which nodes/ways, which edits in `town_v2` and `town_v2_split`, the expected answers), then hands it to Codex.
- **Pending small fixes:** AGENTS.md install line should say `PYENV_VERSION=3.11.14 python3.11 -m venv .venv` (see Step 0 gotchas).
- **Environment:** `.venv` exists (Python 3.11.14, deps + `spatial` installed). Snapshots 261023–261026 + `norcal-latest` (= 261027) in `data/`, checksums verified. Run `codex exec` with `< /dev/null`.
- **Blockers:** none
- **Deadlines:** build Oct 29 – Nov 2 · benchmark + README Nov 3 · apply Nov 4

## Log (append-only, newest on top)

<!--
Template — copy above the newest entry:

### YYYY-MM-DD — Step N: <name>
- **Agent:** Codex | Claude | Jared
- **Did:**
- **Changed:** `path/one`, `path/two`
- **Verify:** `<command>` → <actual output / pass-fail>
- **Review:** <reviewer> — <approved | findings + how resolved>
- **Gotchas:**
-->

### 2026-10-28 — Step 0: Scaffold the repo
- **Agent:** Codex (implement) · Claude (review + Verify)
- **Did:** Package `route-impact` (duckdb, numpy, scipy; dev pytest, ruff), console script with stub subcommands (exit 2), Makefile with `help`/`setup`/`test`/`lint` working and other targets stubbed, `.gitignore`, README stub, offline smoke test (`LOAD spatial`, no `INSTALL`).
- **Changed:** `pyproject.toml`, `Makefile`, `.gitignore`, `README.md`, `src/route_impact/__init__.py`, `src/route_impact/cli.py`, `tests/test_smoke.py`
- **Verify:** `PYENV_VERSION=3.11.14 python3.11 -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]" && make setup && make help && make test` → Python 3.11.14; target list printed (10 targets); `1 passed in 0.87s`. Extra: `make lint` → "All checks passed! 9 files already formatted"; `route-impact --version` → `0.1.0`; `route-impact impact` → "not implemented yet", exit 2; `git status` no longer lists `data/`.
- **Review:** Claude — approved. Scope: only the 7 named files. Minor, not blocking: (1) `Makefile:31` labels `what-if` as Step 8, PLAN says Step 9 — the stub is replaced in Step 9 anyway; (2) `tests/test_smoke.py:12` proves `LOAD spatial` succeeds but runs no spatial function — acceptable, `LOAD` raises if the extension is missing; (3) dependencies unpinned — revisit in Step 12 when recording versions.
- **Gotchas:** On this Mac `python3.11` is a pyenv shim that fails unless 3.11 is enabled: use `PYENV_VERSION=3.11.14 python3.11 -m venv .venv` (or `pyenv shell 3.11.14`). AGENTS.md's install line should mention this — not edited, since Step 0 doesn't name AGENTS.md. Backgrounded `codex exec` must get `< /dev/null` or it waits on stdin forever.

### 2026-10-28 — Review: Codex plan critique
- **Agent:** Codex (critique, read-only) · Claude (decisions + edits)
- **Did:** Ran the plan critique; accepted 8 points in full and 2 in part (table in PLAN.md → Review log). Updated DESIGN.md §2, §5.1–5.7, §5.9, §5.11, §5.13 and PLAN.md Steps 0–12, cut order, and decision log; added `make setup` and the CLI-exit-code note to AGENTS.md.
- **Changed:** `docs/DESIGN.md`, `PLAN.md`, `AGENTS.md`, `PROGRESS.md`
- **Verify:** n/a (docs only)
- **Review:** Claude weighed each Codex point against the design; Jared chose to protect the results map; cut order is now batch faults → random suite to 50 → map popups.
- **Gotchas:** scipy sums duplicate sparse entries; multi-source `dijkstra` returns dense matrices (batch it); `make` exits 2 on any recipe failure.

### 2026-10-28 — Design: pivot to route-impact
- **Agent:** Claude (with Jared)
- **Did:** Design session. Pivoted from data-quality checks to measuring routing impact of daily OSM edits; wrote `docs/DESIGN.md`; rewrote PLAN.md (Steps 0–13 + Phase 2); updated AGENTS.md for the rename and new scope. Downloaded and checksum-verified snapshots 261023–261026 into `data/` (`norcal-latest` = 261027 by md5).
- **Changed:** `docs/DESIGN.md`, `PLAN.md`, `AGENTS.md`, `PROGRESS.md`
- **Verify:** n/a (docs only). Checksums: `261023 OK · 261024 OK · 261025 OK · 261026 OK`.
- **Review:** pending — Codex plan critique
- **Gotchas:**
  - Geofabrik extracts include every way a relation references → "restriction points to missing way" is always 0.
  - All 21 motorway/trunk dead ends sit on the extract's cut line.
  - 1,075 of 2,708 roundabouts have no `oneway` tag → implied one-way is required.
  - Default `python3` is 3.15 → build the venv with `python3.11`.
  - Exploration numbers in DESIGN.md are design evidence only, never README numbers.

### 2026-10-27 — Setup: templates
- **Agent:** Claude
- **Did:** Drafted AGENTS.md, PLAN.md, PROGRESS.md for `osm-validate` (Steps 0–9; MVP = 0–7, stretch = 8–9).
- **Changed:** `AGENTS.md`, `PLAN.md`, `PROGRESS.md`
- **Verify:** n/a (docs only)
- **Review:** superseded by the 2026-10-28 redesign
- **Gotchas:** Confirm Geofabrik dated snapshots exist before committing to Step 8.
