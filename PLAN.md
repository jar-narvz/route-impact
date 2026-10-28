# PLAN.md — route-impact

## Goal
Ship a public repo that measures how a day of OpenStreetMap edits changes navigation in Northern California: route a fixed, population-weighted trip set on two consecutive Geofabrik snapshots, report broken and slowed trips, trace each to the edit that caused it, run daily on GitHub Actions, and evaluate it with injected faults. Design and justification: [docs/DESIGN.md](docs/DESIGN.md).

**Done (MVP, Nov 3):**
- `make impact OLD=261026 NEW=261027` produces `results/2026-10-27/{impact.json,report.md,impact.geojson}` with a risk level.
- The daily workflow has run green at least once and committed a `results/<date>/` folder.
- `make faults` has produced fault-suite results on the full snapshot.
- `make test` passes in GitHub Actions.
- The README shows real numbers that fill the resume bullet.

## Context / constraints
- Target: Tesla Maps & Navigation Validation internship (Winter/Spring 2027), applying **Nov 4**. Gaps this closes: release validation / risk assessment, evaluation metrics, automated backend systems, debugging tools / root cause, large-scale data processing. **Accepted gap:** Linux sysadmin (no self-managed host). Visualization is covered by other work; dashboard cut, results map kept.
- Time: build Oct 29 – Nov 2 (Codex implements, Claude reviews, Jared spends ~10 min/day running commit commands; Scale AI OA due Nov 2). Nov 3 = Jared's full benchmark + README. Nov 4 = apply.
- Separate public repo `jar-narvz/route-impact`; shares no code with posting-triage.
- Data: Geofabrik `north-america/us/california/norcal-YYMMDD.osm.pbf` (+ `.md5`), ~655 MB each. Local copies 261023–261027 are in `data/` (all checksums verified 2026-10-28; `norcal-latest` = 261027).
- DuckDB `spatial` extension reads `.osm.pbf` directly via `ST_ReadOSM` (columns: `kind`, `id`, `tags`, `refs`, `lat`, `lon`, `ref_roles`, `ref_types`; no version/timestamp).
- Python: create the venv with `python3.11` (the machine's default `python3` is 3.15; DuckDB/scipy wheels may not exist for it).
- No DB server, ORM, web framework. Static pages only.
- Resume bullet (fill only with real numbers from `results/`):
  > Built a daily pipeline in Python and DuckDB that measures how OpenStreetMap edits change navigation across Northern California — routes [N] population-weighted trips over a [V]-intersection road graph built from [M] million map elements in [X] seconds, traces every broken or slowed route to the responsible edit, and names the correct culprit in [Y]% of [K] injected faults; runs daily in GitHub Actions.

## Steps

### Step 0 — Scaffold the repo
- **Owner:** Codex
- **Files:** `pyproject.toml`, `Makefile`, `.gitignore`, `README.md` (stub), `src/route_impact/__init__.py`, `src/route_impact/cli.py` (stub), `tests/test_smoke.py`
- **Do:** Package `route-impact` (console script `route-impact`), Python ≥ 3.11, deps `duckdb`, `numpy`, `scipy`; dev extras `pytest`, `ruff`. Makefile targets `help, download, extract, impact, what-if, faults, bench, test, lint` (stubs that echo for now). `.gitignore` covers `data/`, `*.duckdb`, `.venv/`, `*.osm.pbf` except `tests/fixtures/*.osm.pbf`. Smoke test imports duckdb + scipy and loads `spatial`.
- **Verify:** `python3.11 -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]" && make help && make test` → target list prints; `1 passed`.
- **Status:** todo

### Step 1 — Test fixtures with known answers
- **Owner:** Codex (fixture design reviewed by Claude before code that uses it)
- **Files:** `tests/fixtures/town_v1.osm`, `tests/fixtures/town_v2.osm`, `tests/fixtures/*.osm.pbf`, `tests/fixtures/expected.json`, `tests/fixtures/berkeley_sample.osm.pbf`, `scripts/build_fixtures.sh`
- **Do:** Hand-write a small grid "town" (~30 nodes, ~15 ways) with hand-computable shortest paths: a motorway with an on/off ramp, a roundabout **without** a `oneway` tag, a `oneway=-1` street, a `service` road and an `access=private` road (both must be excluded), a bridge with one alternative, two `place=town` nodes with populations. `town_v2.osm` = v1 plus a known edit set: one way split (no impact), the bridge deleted, one one-way flipped, one intersection disconnected (shared node replaced by two nodes), one `maxspeed` lowered. `expected.json` records vertex/edge counts, the travel time of named trips on v1 and v2, which trips break/slow, and each one's culprit. Convert with `osmium cat`. Cut a real Berkeley bbox with `osmium extract` from `data/norcal-latest.osm.pbf` (= 261027 by checksum), < 2 MB.
- **Verify:** `duckdb -c "INSTALL spatial; LOAD spatial; SELECT kind, count(*) FROM ST_ReadOSM('tests/fixtures/town_v1.osm.pbf') GROUP BY 1"` → counts match the XML; `ls -lh tests/fixtures/*.pbf` → each < 2 MB.
- **Status:** todo

### Step 2 — Download with integrity check
- **Owner:** Codex
- **Files:** `scripts/download.sh`, `Makefile`
- **Do:** `make download DATE=YYMMDD` → `curl` `norcal-YYMMDD.osm.pbf` + `.md5` into `data/`, resume partial files (`curl -C -`), verify checksum (`md5sum -c` on Linux, `md5 -q` on macOS — script detects), skip if present and valid, non-zero exit with a clear message if the file isn't published or the checksum fails. `DATE` omitted → latest, named by its dated equivalent.
- **Verify:** `make download DATE=261027 && make download DATE=261027` → first prints `OK` (or "already present, checksum OK"), second is a no-op; `make download DATE=991231` → non-zero exit, "not published".
- **Status:** todo

### Step 3 — Extract roads, nodes, places
- **Owner:** Codex
- **Files:** `sql/extract/drivable.sql`, `sql/extract/build_tables.sql`, `src/route_impact/extract.py`, `config/speeds.toml`, `tests/test_extract.py`
- **Do:** One pass over `ST_ReadOSM` builds `data/<snapshot>.duckdb` with `roads(way_id, highway, name, ref, maxspeed_raw, speed_kph, oneway, node_refs, tags_hash)`, `road_nodes(node_id, lat, lon)`, `places(node_id, name, place, population, lat, lon)` per DESIGN §5.2–5.4: drivable list (no `service`) defined only in `drivable.sql`; exclude `access|motor_vehicle|motorcar ∈ {private,no}`; include car ferries; normalise `oneway` to −1/0/1 with implied one-way for `motorway` and `junction=roundabout|circular`; parse `maxspeed` (`"NN mph"` → mph, bare → km/h, else NULL) and fill `speed_kph` from `config/speeds.toml` defaults. Connection sets `threads` and `memory_limit`.
- **Verify:** `pytest tests/test_extract.py` → row counts, oneway values (roundabout = 1, `-1` street = −1) and exclusions on `town_v1` equal `expected.json`.
- **Status:** todo

### Step 4 — Road graph
- **Owner:** Codex (graph construction reviewed by Claude)
- **Files:** `sql/extract/edges.sql`, `src/route_impact/graph.py`, `tests/test_graph.py`
- **Do:** SQL splits ways at vertices (nodes used by ≥ 2 roads + way endpoints) into directed edges `(edge_id, u, v, way_id, from_node, to_node, length_m, seconds)` (haversine). Python loads them into a scipy CSR matrix (fastest of any parallel edges), computes the largest strongly connected component, and exposes `shortest(graph, sources) -> times, predecessors` and path → edge ids.
- **Verify:** `pytest tests/test_graph.py` → vertex/edge counts and hand-computed trip times on `town_v1` equal `expected.json`; roundabout is never traversed backwards.
- **Status:** todo

### Step 5 — Fixed trip set
- **Owner:** Codex
- **Files:** `src/route_impact/trips.py`, `config/trips.csv`, `tests/test_trips.py`
- **Do:** `route-impact trips --snapshot 261027 --seed 2027` writes `config/trips.csv` (`trip_id, kind, o_lat, o_lon, d_lat, d_lon, weight`): intercity = all ordered pairs among places with population ≥ 50,000 inside lat 36.2–41.7, lon < −120.3, weight `pop_A × pop_B`; local = 2,000 pairs of LSCC vertices in the same box, straight-line 2–30 km. Generated once and committed.
- **Verify:** run twice with the same seed → identical file hash; `wc -l config/trips.csv` → 3,660 intercity + 2,000 local + header (intercity count = n × (n − 1) for the n places found; record n in PROGRESS).
- **Status:** todo

### Step 6 — Impact (route, diff, incremental reroute, risk)
- **Owner:** Codex (correctness argument reviewed by Claude)
- **Files:** `src/route_impact/impact.py`, `src/route_impact/risk.py`, `config/thresholds.toml`, `src/route_impact/cli.py`, `Makefile`, `tests/test_impact.py`
- **Do:** Per DESIGN §5.6 and §5.8: snap trips to LSCC vertices; route on OLD; graph diff (OLD edges missing or slower in NEW, plus re-snapped endpoints); reroute only affected trips; metrics (broken, slowed ≥ `slow_seconds`, gravity-weighted share, median/p95 delay); risk level with the rule that fired; exit 0/1/2. `make impact OLD=… NEW=…` writes `results/<new-date>/impact.json`. `thresholds.toml` notes it is provisional and calibrated on 261023–261027.
- **Verify:** `make test` → on `town_v1 → town_v2` broken/slowed trips match `expected.json`; `town_v1 → town_v1` → 0 broken, 0 slowed, LOW, exit 0; incremental result == full recompute on every fixture pair.
- **Status:** todo

### Step 7 — Root cause
- **Owner:** Codex
- **Files:** `src/route_impact/rootcause.py`, `tests/test_rootcause.py`
- **Do:** Per DESIGN §5.7: culprits = changed edges on each affected trip's OLD path → way ids (and node id for disconnections); rank by gravity weight + trips affected; attach before/after tags and openstreetmap.org links; add to `impact.json`.
- **Verify:** `make test` → every affected trip on `town_v1 → town_v2` names the culprit listed in `expected.json`; the way split names nothing.
- **Status:** todo

### Step 8 — Report, GeoJSON, results map
- **Owner:** Codex (report wording reviewed by Claude)
- **Files:** `src/route_impact/report.py`, `site/index.html`, `tests/test_report.py`
- **Do:** From `impact.json` write `report.md` (layout in DESIGN §6.1) and `impact.geojson` (affected trips' old/new paths + culprit edges only). `site/index.html`: static Leaflet page (pinned CDN version, OSM tiles + attribution) that loads `results/<date>/impact.geojson` from a `?date=` parameter; click a culprit → tags + link.
- **Verify:** `make test` → report for `town_v1 → town_v2` contains the expected risk line and culprit ids; GeoJSON is valid (`json.load` + feature count = expected); open `site/index.html` locally against the fixture output → routes and culprits draw.
- **Status:** todo

### Step 9 — Faults + what-if
- **Owner:** Codex (fault catalog and scoring reviewed by Claude)
- **Files:** `sql/faults/*.sql`, `src/route_impact/faults.py`, `src/route_impact/cli.py`, `config/demo_faults.toml`, `Makefile`, `tests/test_faults.py`
- **Do:** Per DESIGN §5.9: one `.sql` per fault type applied to a copy of a snapshot DB; `route-impact what-if --snapshot S --delete-way|--flip-oneway|--disconnect-node ID`; `make faults SNAPSHOT=… N=200 SEED=2027` samples faults only from edges on OLD trip paths, runs single + batch-of-10, scores incremental == full recompute, root-cause top-1 accuracy (single and batch separately), and impact rate; writes `results/faults/<snapshot>/`. `demo_faults.toml` holds the 3 demo faults (Bay Bridge, a freeway ramp, an I-80 intersection) with ids looked up in the real data.
- **Verify:** `make test` → mini suite on `town_v1` (4 faults, one per type with a known answer) scores 100% incremental == full and 100% root cause; `route-impact what-if --snapshot town_v1 --delete-way <bridge id>` prints the expected trips.
- **Status:** todo

### Step 10 — CI
- **Owner:** Codex
- **Files:** `.github/workflows/ci.yml`
- **Do:** On push/PR: ubuntu-latest, Python 3.11, cache pip and `~/.duckdb/extensions`, `pip install -e ".[dev]"`, `make lint`, `make test`.
- **Verify:** push → Actions run green; badge renders in README.
- **Status:** todo

### Step 11 — Daily job
- **Owner:** Codex (workflow reviewed by Claude before first scheduled run)
- **Files:** `.github/workflows/daily.yml`, `scripts/daily.sh`
- **Do:** Per DESIGN §5.11: schedule + `workflow_dispatch(date)`; skip if `results/<date>/` exists; download yesterday + today dated files via `make download`; `make impact`; commit `results/<date>/` as a bot commit (`contents: write`); on exit 1 (HIGH) open an issue (`issues: write`) with the report and map link; any other non-zero exit fails the run. Publish `site/` + `results/` to GitHub Pages.
- **Verify:** `workflow_dispatch` with date 2026-10-27 → run green, a bot commit adds `results/2026-10-27/`, Pages URL loads the map; a second dispatch for the same date → "already done", no commit.
- **Status:** todo

### Step 12 — Benchmark + real fault suite
- **Owner:** Codex writes; **Jared runs on the full files**
- **Files:** `src/route_impact/metrics.py`, `scripts/bench.sh`, `Makefile`
- **Do:** `make bench SNAPSHOT=…` records input size, rows per `kind`, drivable ways, graph vertices/edges, LSCC size, seconds per phase (extract / graph / route / diff / root cause / total), peak RSS (`/usr/bin/time -v` on Linux, `-l` on macOS — record which), DuckDB version, threads, memory_limit, CPU, RAM. Then run `make faults` on 261027 and `make impact` for 23→24, 24→25, 25→26, 26→27.
- **Verify:** `results/<snapshot>/metrics.json` exists with all fields non-null (`jq .`); `results/faults/261027/` exists; four `results/<date>/impact.json` files exist.
- **Status:** todo

### Step 13 — README with real numbers (MVP done)
- **Owner:** Claude drafts, Jared approves
- **Files:** `README.md`
- **Do:** What it does and why (release sign-off), quickstart, how it works (graph, trips, incremental reroute, root cause), real results table from `results/`, fault-suite results with what each number means, the US 199 false-alarm example (only if the 26→27 run confirms no impact), map link, CI badge, limitations (no turn restrictions/traffic, provisional thresholds, injected ≠ real-world catch rate, reversible roads treated as two-way). Fill the resume bullet from the same files.
- **Verify:** every number in README `grep`s back to a value in `results/`; a fresh clone runs `make test` green.
- **Status:** todo

### Phase 2 (after Nov 4, optional) — Fault playground
In-browser Bay Area routing (static, no server): ship a compact Bay Area subgraph, click a road to delete/flip it, recompute routes in JS. Not planned in detail yet.

## Risks / open questions
- **Scope vs time:** 14 steps in ~5 days. Cut order: random faults 200 → 50, then map popups. Never cut impact, root cause, daily job, CI.
- **Graph correctness** is the biggest technical risk (splitting at vertices, implied one-ways, LSCC). Mitigated by the hand-computed fixture and the self-comparison test.
- **Routing time on the free runner** is unmeasured until Step 12. If it's too slow: group local trips by origin, cap Dijkstra by distance (`limit`), or reduce local trips (stated in README).
- **Quiet real days:** expected (4 days of exploration showed almost no major-road change). The story rests on fault-suite numbers + "stays quiet on normal days".
- **Provisional thresholds:** no history to calibrate on; revisit after ~2 weeks of daily runs.
- **Geofabrik publish timing:** schedule the job late enough in the UTC day; retry once before failing.
- **Bot commits** fill history; accepted (DESIGN §5.11).
- **CI extension install:** DuckDB downloads `spatial` at runtime; cache `~/.duckdb/extensions`.

## Decision log (2026-10-28 design session, Jared + Claude)
1. Pivoted from data-quality checks to **routing impact** — checks were noisy or always 0 on real data, and the "verdict + reason" shape repeated posting-triage.
2. **Daily automation is in the MVP**; dashboard and Tableau cut; **results map kept**; fault playground → Phase 2; `what-if` CLI in MVP.
3. **Linux sysadmin gap accepted**; runs on GitHub's Ubuntu runners.
4. Results committed to `results/<date>/` by the daily workflow.
5. Trips: 61 cities × 60 gravity-weighted + 2,000 seeded local trips; endpoints stored as coordinates.
6. Risk LOW/MEDIUM/HIGH; HIGH opens a GitHub issue; exit 0/1/2.
7. Defaults accepted: no standalone checks; maxspeed-or-class-default speeds; exclude service/private, include car ferries; LSCC snapping on OLD; graph-based root cause; scipy routing.
8. Fault injection on DuckDB tables; demos + seeded random suite; scored as incremental==full, root-cause accuracy, impact rate (redundancy, not accuracy).
9. Renamed `osm-validate` → `route-impact` (GitHub repo + local folder).

## Review log
- _Before Step 0:_ `codex exec "Read docs/DESIGN.md, PLAN.md and AGENTS.md. Critique the plan: missing steps, wrong Verify commands, OSM/DuckDB/scipy pitfalls, graph-construction bugs, scope risk for ~5 days. Max 10 bullets."` → paste summary here with accept/reject + reason per point.
