# PLAN.md — osm-validate

## Goal
Ship a public repo that validates OpenStreetMap road data the way a maps team signs off on a release: run 4 quality checks over the Northern California extract (tens of millions of features), record real scale metrics (rows, seconds, peak memory), run in CI on a tiny fixture, and — stretch — diff two daily snapshots and chart the results.

**Done (MVP, Nov 3):** `make download && make check && make bench` works on the full NorCal extract, `make test` passes in GitHub Actions, and the README shows real numbers that fill the resume bullet.
**Done (stretch, Nov 4 AM):** `make diff` reports per-check and per-road-class changes between two dates; a Tableau Public chart shows check results per snapshot.

## Context / constraints
- Target: Maps & Nav Validation posting, applying **Nov 4**. Gaps to close: large-scale data processing/querying, Linux, dashboards, evaluation metrics.
- Time: MVP ≈ 1 day (Nov 3); stretch = Nov 4 morning. Scale AI OA is due Nov 2, so nothing here should need work before Nov 3 except Step 0–1 if there's slack.
- Separate public repo `osm-validate`; does not share code with posting-triage.
- Data source: Geofabrik `north-america/us/california/norcal-latest.osm.pbf` (~600 MB compressed) + its `.md5`.
- No DB server: DuckDB `spatial` extension reads `.osm.pbf` directly via `ST_ReadOSM` (columns: `kind`, `id`, `tags`, `refs`, `lat`, `lon`, `ref_roles`, `ref_types`).
- **Drivable roads** = ways with `highway` in: motorway, trunk, primary, secondary, tertiary, unclassified, residential, living_street, service, and the `*_link` variants.
- A "road segment" = one OSM way. An "intersection point" = a node referenced by ≥ 2 drivable ways (or by the same way's ends).
- Resume bullet (fill only with real numbers from `results/`):
  > Built a map-data validation tool in Python and DuckDB that runs [4] quality checks over [N million] OpenStreetMap road segments in [X] seconds, and diffs daily snapshots to flag risky changes before release; checks run in GitHub Actions CI.

## Steps

### Step 0 — Scaffold the repo
- **Owner:** Codex
- **Files:** `pyproject.toml`, `Makefile`, `.gitignore`, `README.md` (stub), `src/osm_validate/__init__.py`, `src/osm_validate/cli.py` (stub), `tests/test_smoke.py`
- **Do:** Package with `duckdb`, dev extras `pytest`, `ruff`. Makefile targets `help, download, check, bench, diff, test, lint` (stubs that echo for now). `.gitignore` covers `data/`, `*.duckdb`, `.venv/`, large `*.osm.pbf`. Smoke test imports duckdb and loads `spatial`.
- **Verify:** `make help && make test` → target list prints; `1 passed`.
- **Status:** todo

### Step 1 — Test fixtures with known answers
- **Owner:** Codex (fixture design reviewed by Claude)
- **Files:** `tests/fixtures/handmade.osm`, `tests/fixtures/handmade.osm.pbf`, `tests/fixtures/expected.json`, `tests/fixtures/berkeley_sample.osm.pbf`, `scripts/build_fixtures.sh`
- **Do:** Hand-write a small OSM XML (~20 nodes, ~10 ways, 2 restriction relations) that contains a **known count** of each violation: unnamed residential road, missing maxspeed, bare-number maxspeed next to `mph` ones, a dead end, a cul-de-sac, a restriction pointing to a missing way. Record exact expected counts in `expected.json`. Convert with `osmium cat handmade.osm -o handmade.osm.pbf`. Also cut a real sample (small Berkeley bbox) with `osmium extract` from the NorCal file — keep it < 2 MB.
- **Verify:** `duckdb -c "INSTALL spatial; LOAD spatial; SELECT kind, count(*) FROM ST_ReadOSM('tests/fixtures/handmade.osm.pbf') GROUP BY 1"` → node/way/relation counts match the XML; `ls -lh tests/fixtures/*.pbf` → each < 2 MB.
- **Status:** todo

### Step 2 — Download with integrity check
- **Owner:** Codex (Jared runs it on the real network)
- **Files:** `scripts/download.sh`, `Makefile`
- **Do:** `make download [DATE=YYMMDD]` → `curl` the latest (or dated) NorCal `.osm.pbf` + `.md5` into `data/`, verify with `md5sum -c`, skip if already present. Snapshot name = date from Geofabrik's file or `DATE`.
- **Verify:** `make download && ls -lh data/` → ~600 MB `.osm.pbf`, `md5sum -c` prints `OK`.
- **Status:** todo

### Step 3 — Extract roads, nodes, restrictions
- **Owner:** Codex
- **Files:** `sql/extract/drivable.sql`, `sql/extract/build_tables.sql`, `src/osm_validate/extract.py`
- **Do:** From `ST_ReadOSM` build into `data/<snapshot>.duckdb`:
  - `roads(way_id, highway, name, maxspeed, oneway, node_refs[])` — drivable ways only
  - `road_nodes(node_id, way_id, position, is_endpoint)` — unnested refs
  - `restrictions(rel_id, restriction, from_way, via, to_way)` — `type=restriction` relations
  - `all_way_ids(way_id)` — every way in the extract (needed for the restriction check)
  Read the `.pbf` **once**; persist tables so checks don't re-scan.
- **Verify:** `pytest tests/test_extract.py` on `handmade.osm.pbf` → row counts equal those in `expected.json`.
- **Status:** todo

### Step 4 — The 4 checks
- **Owner:** Codex (SQL reviewed by Claude for false positives)
- **Files:** `sql/checks/01_unnamed_roads.sql`, `sql/checks/02_maxspeed.sql`, `sql/checks/03_dead_ends.sql`, `sql/checks/04_broken_restrictions.sql`, `src/osm_validate/checks.py`, `tests/test_checks.py`
- **Do:** Each file returns `count` (+ up to 10 sample IDs):
  1. **Unnamed roads:** drivable ways with no `name` and no `ref`, excluding `service` and `*_link` (legitimately unnamed).
  2. **Speed limits:** two numbers — ways missing `maxspeed`; ways whose `maxspeed` is a bare number (km/h by OSM convention, suspicious in the US) vs `"NN mph"`.
  3. **Dead ends:** way endpoints on drivable roads referenced by exactly one drivable way. Report `noexit=yes` / `turning_circle` endpoints separately so intentional dead ends aren't counted as errors.
  4. **Broken turn restrictions:** restriction relations whose `from`/`to` way ID is not in `all_way_ids`.
  `make check` writes `results/<snapshot>/checks.json`.
- **Verify:** `make test` → every check on `handmade.osm.pbf` equals `expected.json` exactly.
- **Status:** todo

### Step 5 — Measure scale
- **Owner:** Codex writes it; **Jared runs it on the full file**
- **Files:** `src/osm_validate/metrics.py`, `scripts/bench.sh`, `Makefile`
- **Do:** `make bench` runs extract + checks on the full snapshot and records: input file size, rows read per `kind`, drivable road segments, wall-clock seconds per phase (extract / each check / total), peak RSS. Peak RSS via `/usr/bin/time -v` (Linux) or `/usr/bin/time -l` (macOS) — script detects which. Also log DuckDB version, `threads`, `memory_limit`, machine (CPU, RAM).
- **Verify:** `make bench` → `results/<snapshot>/metrics.json` exists with all fields non-null; `jq .` pretty-prints it.
- **Status:** todo

### Step 6 — CI
- **Owner:** Codex
- **Files:** `.github/workflows/ci.yml`
- **Do:** On push/PR: Ubuntu, Python 3.11, cache pip, `pip install -e ".[dev]"`, `make lint`, `make test` (fixtures only, no network beyond pip/DuckDB extension install).
- **Verify:** push to GitHub → Actions run is green; badge renders in README.
- **Status:** todo

### Step 7 — README with real numbers (MVP done)
- **Owner:** Claude drafts, Jared approves
- **Files:** `README.md`
- **Do:** What it does, why (release sign-off framing), quickstart (`make` commands), the 4 checks with their known false positives, a results table pulled from `results/<snapshot>/checks.json` + `metrics.json`, CI badge, limitations. Fill the resume bullet from the same files.
- **Verify:** every number in README `grep`s back to a value in `results/`; a fresh clone runs `make test` green.
- **Status:** todo

### Step 8 — Release diff (stretch)
- **Owner:** Codex (diff semantics reviewed by Claude)
- **Files:** `src/osm_validate/diff.py`, `sql/diff/*.sql`, `tests/fixtures/handmade_v2.osm(.pbf)`, `tests/test_diff.py`, `Makefile`
- **Do:** `make diff OLD=… NEW=…` compares two snapshot DBs: per-check count deltas; road segments added/deleted/modified by `highway` class (e.g. "142 motorway segments deleted"); flag large deltas over a threshold as "risky". Fixture v2 = v1 with a known set of edits.
- **Verify:** `make test` → diff of handmade v1→v2 matches the known edits exactly; then on real data `results/diff_<old>_<new>.json` exists.
- **Status:** todo

### Step 9 — Dashboard (stretch)
- **Owner:** Jared (Codex writes the CSV export)
- **Files:** `src/osm_validate/export.py`, `results/dashboard.csv`
- **Do:** Export one tidy CSV (`snapshot, check, metric, value`) across snapshots; build a Tableau Public chart of check results per snapshot; link it in README.
- **Verify:** CSV opens in Tableau with no reshaping; public link works logged out.
- **Status:** todo

### Not in this repo — Linux practice (before the interview)
Practice `grep`, `awk`, pipes, `ps`, `top`, `kill`, `chmod`, `ssh`, `cron` on real data (e.g. CloudWatch logs). Track separately; don't add to this repo.

## Risks / open questions
- **Dated snapshots:** confirm Geofabrik's public server still lists older daily `norcal-YYMMDD.osm.pbf` files before relying on Step 8. Fallback: download `latest` on two different days (Nov 3 + Nov 4).
- **Extract-boundary false positives:** restrictions and roads near the NorCal edge can reference ways outside the extract → Check 4 and dead ends will over-count at the border. Note it in README; optionally exclude features within N km of the boundary.
- **Dead ends ≠ errors:** cul-de-sacs are real. Report the count as a metric, not a failure.
- **Memory on a laptop:** extracting nodes for tens of millions of features may exceed RAM. Set `memory_limit`, filter to drivable ways before unnesting, and let DuckDB spill to disk (`temp_directory`).
- **Peak memory measurement** differs by OS (`time -v` vs `time -l`); record which tool was used next to the number.
- **CI extension install:** DuckDB downloads `spatial` at runtime; if Actions flakes, cache `~/.duckdb/extensions`.
- Open: which machine runs the official benchmark (laptop vs a Linux box/EC2)? Running it on Linux strengthens the Linux story.

## Review log
- _Run before Step 0:_ `codex exec "Read PLAN.md and AGENTS.md. Critique the plan: missing steps, wrong Verify commands, OSM/DuckDB pitfalls, scope risk for a 1-day MVP. Max 10 bullets."` → paste summary here.
