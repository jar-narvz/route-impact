# PROGRESS.md — route-impact

## Current state
- **Working on:** —
- **Done:** design, plan critique, Steps 0–3. Step 3 reviewed and approved, **not committed yet** (last commit `e0432b7`).
- **Next up:** Step 4 — Road graph + feasibility on the full graph (Codex implements, Claude reviews and runs Verify).
  - **Read to resume (one call):** `sed -n 60,65p PLAN.md; sed -n 139,149p docs/DESIGN.md; sed -n 5,9p docs/FIXTURES.md; sed -n 89,120p docs/FIXTURES.md`
  - **Then:** write the Codex brief from those lines and launch it.
  - **Watch in review:**
    - Fixture times use haversine R = 6,371,008.8 m (`scripts/fixture_oracle.py`); Step 4 must use the same R to match within 0.05 s.
    - Step 3 can leave `speed_kph` NULL if a drivable class is missing from `config/speeds.toml`. Step 4 should fail loudly on a NULL or non-positive speed rather than produce NaN times.
    - DESIGN §5.4 says zero/unparseable maxspeeds are *counted*. Step 3 doesn't count them; Step 4 (or the report) should, from `maxspeed_raw IS NOT NULL` vs parsed.
    - `extract()` fails if the output DB already has the tables. The CLI step must delete/rebuild the snapshot DB (or skip if present).
    - `extract()` finds `sql/` and `config/` via the source checkout (`parents[2]`), so it needs the editable install (the CI workflow must use `pip install -e`).
    - The motorway and ramps are on no named trip, so they're covered structurally only.
- **Pending small fixes:** AGENTS.md install line should say `PYENV_VERSION=3.11.14 python3.11 -m venv .venv` (see Step 0 gotchas).
- **Environment:** `.venv` exists (Python 3.11.14, deps + `spatial`). Snapshots 261023–261026 + `norcal-latest` (= 261027) in `data/`, verified; `make download` works.
- **Codex launch pattern:** `codex exec --sandbox workspace-write "<brief>" < /dev/null > /dev/null 2>&1` run in the background, then one check for a new file in `~/.codex/sessions/<yyyy>/<mm>/<dd>/`. Codex has no network, and its final message isn't captured, so Claude reruns Verify and reads `git diff`.
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

### 2026-10-28 — Step 3: Extract roads, nodes, places
- **Agent:** Codex
- **Did:** Added two-phase ST_ReadOSM extraction into roads, road_nodes, and places, with full tags/ordered refs, access precedence, car ferries, normalized direction, parsed/default speeds, canonical SHA256 content hashes, and transactional failure for missing references. Connection explicitly sets threads, memory_limit, and temp_directory; only LOAD spatial is used, with no download.
- **Changed:** `sql/extract/drivable.sql`, `sql/extract/build_tables.sql`, `src/route_impact/extract.py`, `config/speeds.toml`, `tests/test_extract.py`, `PROGRESS.md` (this required log/state update).
- **Verify:** Actual final output:

```text
$ .venv/bin/pytest tests/test_extract.py -q
......                                                                   [100%]
6 passed in 1.29s
$ .venv/bin/ruff check . && .venv/bin/ruff format --check .
All checks passed!
13 files already formatted
```

- **Review:** Claude, 2026-10-28 — approved. Reran Verify: `6 passed in 1.52s`, ruff clean, full suite `7 passed`. Findings (none blocking): (1) no guard against NULL `speed_kph` if a class is missing from speeds.toml; (2) unparseable/zero maxspeeds not counted (DESIGN §5.4), deferred to Step 4; (3) `maxspeed` like `25mph` (no space) or `50 km/h` falls back to default; (4) rerunning into an existing DB raises, CLI must handle; (5) spill dir `.<stem>-tmp` is never cleaned up; (6) `content_hash` relies on DuckDB `TO_JSON` formatting, so old/new snapshots should be built with the same DuckDB version.
- **Gotchas:** Initial coordinate equality assertions exposed ST_ReadOSM floating-point decoding noise (37.8 becomes 37.800000000000004); coordinate checks now use absolute tolerance 1e-10 with zero relative tolerance. Initial Ruff import-order errors were fixed before the final Verify above. Alternating/reversible direction is treated as two-way. Population uses TRY_CAST to BIGINT (invalid/missing → NULL). SQL/config paths assume a source checkout; no packaging or CLI changes made. Missing-reference inputs are generated/converted with osmium in tmp_path, and the test also confirms persistent tables roll back. No full-size snapshot run and no commit.

### 2026-10-28 — Step 2: Download with integrity check
- **Agent:** Codex (implementation), Claude (review + network Verify)
- **Did:** `scripts/download.sh` fetches the `.md5` first (404 → "not published"), resumes the pbf into a `.part` file, verifies, then moves it into place. Dated files skip the network when valid; `latest` always re-fetches its `.md5`.
- **Changed:** `scripts/download.sh`, `Makefile`
- **Verify:** `make download DATE=261026` ×2 → `norcal-261026.osm.pbf already present, checksum OK` (exit 0 both times). `make download DATE=991231` → `norcal-991231.osm.pbf not published on Geofabrik`, exit 2 via make (script exit 1), no stray files. `make download DATE=12ab` → `DATE must be 6 digits`. `make download` (latest, remote md5 = local) → `already present, checksum OK`.
- **Review:** Claude — approved. Accepted risk: a stale `.part` from an older `latest` gets resumed, fails the checksum, and is deleted, which wastes one download but is never wrong.
- **Gotchas:** Codex's sandbox has no network, so Claude ran the 404 and latest checks.

### 2026-10-28 — Step 1: Test fixtures with known answers
- **Agent:** Claude (design `docs/FIXTURES.md`), Codex (implementation)
- **Did:** Designed a 50-node / 28-way town with 5 v2 edits, 3 zero-impact split edits, and 9 named trips. Codex built the XML, the PBFs, `build_fixtures.sh`, the oracle, and `expected.json`. Claude swapped T2 after the isolation check failed.
- **Changed:** `docs/FIXTURES.md`, `PLAN.md` (Step 1 uses the oracle), `scripts/build_fixtures.sh`, `scripts/fixture_oracle.py`, `tests/fixtures/{town_v1,town_v2,town_v2_split}.osm(.pbf)`, `tests/fixtures/berkeley_sample.osm.pbf`, `tests/fixtures/expected.json`
- **Verify:** ST_ReadOSM counts → v1 `[('node', 50), ('way', 28)]`, v2 `[('node', 51), ('way', 26)]`, v2_split `[('node', 51), ('way', 29)]`, all equal to the XML element counts. Sizes: berkeley_sample 263K, town PBFs < 1K each. `python scripts/fixture_oracle.py --check` → `OK`.
- **Review:** Claude reviewed the oracle: it is independent of `src/`, applies access precedence and implied one-ways per DESIGN §5.3–5.4, and tie-breaks parallel edges deterministically. Finding: the first `--check` failed with `T2: isolation changed by [], expected ['E2']`, because 140 → 103 never used col 3. Fixed by T2 = 133 → 113 (99.49 s → 149.67 s, E2 only), with a matching one-line change in the oracle's trip list.
- **Gotchas:** in this grid the motorway is never on a shortest path, so ramps are tested structurally only. Codex ran without writing a final message to the session log, so Claude reran Verify itself.

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
