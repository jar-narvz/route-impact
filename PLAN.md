# PLAN.md — route-impact

## Goal
Ship a public repo that measures how a day of OpenStreetMap edits changes navigation in Northern California: route a fixed, population-weighted trip set on two consecutive Geofabrik snapshots, report broken and slowed trips, trace each to the edit that caused it, run daily on GitHub Actions, and evaluate it with injected faults. Design and justification: [docs/DESIGN.md](docs/DESIGN.md).

**Done (MVP, Nov 3):**
- `route-impact impact --old 261026 --new 261027` produces `results/2026-10-27/{impact.json,report.md,impact.geojson}` with a risk level.
- The daily workflow has run green at least once and committed a `results/<date>/` folder.
- `make faults` has produced fault-suite results on the full snapshot.
- `make test` passes in GitHub Actions.
- The README shows real numbers that fill the resume bullet.

## Context / constraints
- Target: Tesla Maps & Navigation Validation internship (Winter/Spring 2027), applying **Nov 4**. Gaps this closes: release validation / risk assessment, evaluation metrics, automated backend systems, debugging tools / root cause, large-scale data processing. **Accepted gap:** Linux sysadmin (no self-managed host). Visualization is covered by other work; dashboard cut, results map kept.
- Time: build Oct 29 – Nov 2 (Codex implements, Claude reviews, Jared spends ~10 min/day running commit commands; Scale AI OA due Nov 2). Nov 3 = Jared's full benchmark + README. Nov 4 = apply.
- Separate public repo `jar-narvz/route-impact`; shares no code with posting-triage.
- Data: Geofabrik `north-america/us/california/norcal-YYMMDD.osm.pbf` (+ `.md5`), ~655 MB each. Local copies 261023–261026 + `norcal-latest` (= 261027 by md5) are in `data/`, all checksums verified 2026-10-28.
- DuckDB `spatial` extension reads `.osm.pbf` directly via `ST_ReadOSM` (columns: `kind`, `id`, `tags`, `refs`, `lat`, `lon`, `ref_roles`, `ref_types`; no version/timestamp). Installing the extension needs the network **once** (`make setup`); tests run offline after that.
- Python: create the venv with `python3.11` (the machine's default `python3` is 3.15; DuckDB/scipy wheels may not exist for it). Use the Python `duckdb` package in Verify commands, not the DuckDB CLI, so they work in CI.
- No DB server, ORM, web framework. Static pages only.
- Resume bullet (fill only with real numbers from `results/`):
  > Built a daily pipeline in Python and DuckDB that measures how OpenStreetMap edits change navigation across Northern California — routes [N] population-weighted trips over a [V]-intersection road graph built from [M] million map elements in [X] seconds, traces every broken or slowed route to the responsible edit, and names the correct culprit in [Y]% of [K] injected faults; runs daily in GitHub Actions.

**Mandatory vertical slice** (must work end-to-end before anything secondary): Steps 0–7 on fixtures → Step 4's full-graph feasibility check → Step 11 daily job with `report.md`. **Secondary:** random fault suite (Step 9's random part). The results map (Step 8's `site/`) is **protected** — Jared's call, 2026-10-28. Step 10 (CI) is independent and can land any time after Step 0.

## Steps

### Step 0 — Scaffold the repo
- **Owner:** Codex
- **Files:** `pyproject.toml`, `Makefile`, `.gitignore`, `README.md` (stub), `src/route_impact/__init__.py`, `src/route_impact/cli.py` (stub), `tests/test_smoke.py`
- **Do:** Package `route-impact` (console script `route-impact`), Python ≥ 3.11, deps `duckdb`, `numpy`, `scipy`; dev extras `pytest`, `ruff`. Makefile targets `help, setup, download, extract, impact, what-if, faults, bench, test, lint` (stubs that echo for now, except `setup`). `make setup` runs `INSTALL spatial` once via Python duckdb (the only target that needs the network apart from `download`). `.gitignore` covers `data/`, `*.duckdb`, `.venv/`, `*.osm.pbf` except `tests/fixtures/*.osm.pbf`. Smoke test imports duckdb + scipy and runs `LOAD spatial` (no `INSTALL`).
- **Verify:** `python3.11 -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]" && make setup && make help && make test` → target list prints; `1 passed`.
- **Status:** done 2026-10-28 (see PROGRESS.md)

### Step 1 — Test fixtures with known answers
- **Owner:** Codex (fixture design reviewed by Claude before code that uses it)
- **Files:** `tests/fixtures/town_v1.osm`, `tests/fixtures/town_v2.osm`, `tests/fixtures/town_v2_split.osm`, `tests/fixtures/*.osm.pbf`, `tests/fixtures/expected.json`, `tests/fixtures/berkeley_sample.osm.pbf`, `scripts/build_fixtures.sh`, `scripts/fixture_oracle.py` (design: `docs/FIXTURES.md`, Claude-owned)
- **Do:** Hand-write a small grid "town" (~50 nodes, ~30 ways) laid out per `docs/FIXTURES.md`; travel times come from an independent oracle (`scripts/fixture_oracle.py`: plain-Python Dijkstra over the XML, no imports from `src/`), not hand arithmetic, containing: a motorway with on/off ramps; a roundabout **without** a `oneway` tag; a `oneway=-1` street; a `service` road and an `access=private` road (excluded); an `access=no` + `motorcar=yes` road (kept) and a `vehicle=no` road (excluded); two parallel ways between the same two junctions with different speeds; a closed way and a self-intersecting way (repeated node); a bridge crossing over a road **without** a shared node; a bridge with one alternative; two `place=town` nodes with populations.
  - `town_v2.osm` = v1 plus a known edit set: bridge deleted; one one-way flipped; one intersection disconnected (shared node replaced by two nodes); one `maxspeed` lowered; one destination's only access road deleted (destination becomes an island).
  - `town_v2_split.osm` = v1 with **only** way splits, a way merge, and a new mid-road junction node — must produce zero impact.
  - `expected.json` records vertex/edge counts, kept/excluded way ids, travel times of named trips on each version, which trips break/slow, and each one's confirmed culprit.
  - Convert with `osmium cat`. Cut a real Berkeley bbox with `osmium extract` from `data/norcal-latest.osm.pbf`, < 2 MB.
- **Verify:** `python -c "import duckdb; c=duckdb.connect(); c.execute('LOAD spatial'); print(c.sql(\"SELECT kind, count(*) FROM ST_ReadOSM('tests/fixtures/town_v1.osm.pbf') GROUP BY 1 ORDER BY 1\").fetchall())"` → counts match the XML (same for v2, v2_split); `ls -lh tests/fixtures/*.pbf` → each < 2 MB; `python scripts/fixture_oracle.py --check` → `OK` (recomputes every time and count in `expected.json`, and confirms each changed trip is changed by exactly its listed edit).
- **Status:** done (2026-10-28)

### Step 2 — Download with integrity check
- **Owner:** Codex
- **Files:** `scripts/download.sh`, `Makefile`
- **Do:** `make download DATE=YYMMDD` → `curl` `norcal-YYMMDD.osm.pbf` + `.md5` into `data/`, resume partial files (`curl -C -`), verify checksum (`md5sum` on Linux, `md5 -q` on macOS — script detects), skip if present and valid, non-zero exit with a clear message if the file isn't published or the checksum fails. `DATE` omitted → latest.
- **Verify:** `make download DATE=261026 && make download DATE=261026` → both print "already present, checksum OK" (file exists locally); `make download DATE=991231` → non-zero exit, "not published".
- **Status:** done (2026-10-28)

### Step 3 — Extract roads, nodes, places
- **Owner:** Codex
- **Files:** `sql/extract/drivable.sql`, `sql/extract/build_tables.sql`, `src/route_impact/extract.py`, `config/speeds.toml`, `tests/test_extract.py`
- **Do:** Per DESIGN §5.2–5.3, two phases over `ST_ReadOSM`: (1) drivable ways → staging with full `tags` MAP and ordered `node_refs` (repeats kept); (2) nodes filtered to referenced ids + `place` nodes. Build `data/<snapshot>.duckdb` with `roads`, `road_nodes`, `places`. Drivable list only in `drivable.sql` (no `service`); access by precedence `motorcar → motor_vehicle → vehicle → access` (exclude `no`/`private`); car ferries included; `oneway` normalised to −1/0/1 with implied one-way for `motorway` and `junction=roundabout|circular`; `maxspeed` parsed (`"NN mph"` → mph, bare → km/h, non-positive/unparseable → NULL), `speed_kph` filled from `config/speeds.toml`; `content_hash` = hash of key-sorted tags + ordered refs. Fail with an error if any ref lacks a coordinate. Connection sets `threads`, `memory_limit`, `temp_directory`.
- **Verify:** `pytest tests/test_extract.py` → on `town_v1`: row counts, kept/excluded way ids (incl. both access-precedence cases), oneway values (roundabout = 1, `-1` street = −1) equal `expected.json`; a fixture with a missing node ref raises.
- **Status:** done (2026-10-28)

### Step 4 — Road graph + feasibility on the full graph
- **Owner:** Codex (graph construction reviewed by Claude); full-graph check run locally on `data/norcal-latest.osm.pbf`
- **Files:** `sql/extract/segments.sql`, `src/route_impact/graph.py`, `scripts/feasibility.py`, `tests/test_graph.py`
- **Do:** Per DESIGN §5.4: SQL emits directed **segments** `(a, b, way_id, seq, length_m, seconds)`; vertices = nodes occurring ≥ 2 times across all refs + way endpoints; edges = segment runs between vertices, each keeping its segment list. Reduce parallel edges to the minimum time per (u, v) with a deterministic tie-break **before** building the CSR matrix; keep the (u, v) → winning-edge table. LSCC on demand. `shortest(graph, sources, targets, batch=32)` returns only requested times + paths (as segment lists). `scripts/feasibility.py` builds the full NorCal graph and routes the 61 city origins + the local origins in batches, printing vertices, edges, seconds, and peak RSS.
- **Verify:** `pytest tests/test_graph.py` → on `town_v1`: vertex/edge counts and hand-computed trip times equal `expected.json`; the faster parallel road wins (not the sum); closed and self-intersecting ways create the expected vertices; the bridge over the road creates no vertex; the roundabout is never traversed backwards. Then `python scripts/feasibility.py data/norcal-latest.osm.pbf` → completes with **peak RSS < 12 GB** (headroom on a 16 GB runner); record vertices, edges, seconds, RSS in PROGRESS. If it fails the budget, stop and revisit DESIGN §5.4 before Step 5.
- **Status:** done (2026-10-28)

### Step 5 — Fixed trip set
- **Owner:** Codex
- **Files:** `src/route_impact/trips.py`, `src/route_impact/cli.py`, `Makefile`, `config/trips.csv`, `tests/test_trips.py`
- **Do:** `route-impact trips --snapshot latest --seed 2027` writes `config/trips.csv` (`trip_id, kind, o_lat, o_lon, d_lat, d_lon, weight`): intercity = all ordered pairs among places with population ≥ 50,000 inside lat 36.2–41.7, lon < −120.3, weight `pop_A × pop_B`; local = 2,000 pairs of LSCC vertices in the same box, straight-line 2–30 km, weight 1 (local trips are counted, not gravity-weighted). Intercity rows first, then local; coordinates written with 6 decimals so the file is byte-stable. Generated once and committed.
- **Verify:** run twice with the same seed → identical file hash; intercity rows = n × (n − 1) for the n places found (expected n = 61 → 3,660; record n in PROGRESS); local rows = 2,000.
- **Status:** done

### Step 6 — Impact (snap, route, segment diff, incremental reroute, risk)
- **Owner:** Codex (correctness argument reviewed by Claude)
- **Files:** `src/route_impact/impact.py`, `src/route_impact/risk.py`, `config/thresholds.toml`, `src/route_impact/graph.py` (add pair routing only), `src/route_impact/cli.py`, `Makefile`, `tests/test_impact.py`
- **Do:** Per DESIGN §5.5, §5.6, §5.8: snap on OLD's LSCC; on NEW keep the same node id and route on the **full** NEW graph, fallback within 200 m, else broken; segment diff (missing or slower `(a → b)`); reroute only trips whose OLD path has a changed segment or whose endpoint needed a fallback; metrics (broken, slowed ≥ `slow_seconds`, gravity-weighted share, median/p95 delay); risk level + rule that fired; exit 0/1/2. `route-impact impact --old … --new …` (and `make impact`) writes `results/<new-date>/impact.json`. `thresholds.toml` notes it is provisional and calibrated on 261023–261027.
- **Verify:** `make test` → `town_v1 → town_v2`: broken/slowed trips match `expected.json`, **including the island destination as broken**; `town_v1 → town_v2_split`: 0 changed segments, 0 broken, 0 slowed, LOW; `town_v1 → town_v1`: LOW, exit 0; incremental == full recompute on every fixture pair.
- **Status:** done (2026-10-28, reviewed by Claude)

### Step 7 — Root cause with counterfactual confirmation
- **Owner:** Codex
- **Files:** `src/route_impact/rootcause.py`, `tests/test_rootcause.py`; plus `impact.py`, `graph.py`, `risk.py`, `cli.py`, `tests/test_impact.py` for wiring and the Step 6 review fixes
- **Do:** Per DESIGN §5.7: group changed segments on each affected trip's OLD path into candidate edits (way, disconnected node, lost endpoint); confirm each by restoring only that edit's OLD segments into NEW and rerouting; label confirmed / candidate / joint cause; rank by gravity weight + trips affected; attach before/after tags and openstreetmap.org links; add to `impact.json`.
- **Verify:** `make test` → every affected trip on `town_v1 → town_v2` has the confirmed culprit listed in `expected.json`; a trip whose OLD path passes the lowered-maxspeed road (E4) and is broken by the island deletion (E5) lists E5 as confirmed and E4 as candidate only (built in the test; synthetic graph if no fixture origin works); restoring a deleted way that attached mid-way to a surviving road recovers the trip; `town_v2_split` names nothing.
- **Status:** done

### Step 8 — Report, GeoJSON, results map
- **Owner:** Codex (report wording reviewed by Claude)
- **Files:** `src/route_impact/report.py`, `src/route_impact/cli.py`, `Makefile`, `site/index.html`, `tests/test_report.py`
- **Do:** From `impact.json` write `report.md` (layout in DESIGN §6.1) and `impact.geojson` (affected trips' old/new paths + culprit segments only); `impact` calls the report step. `site/index.html` (**protected**): static Leaflet page (pinned CDN version, OSM tiles + attribution) that loads `results/<date>/impact.geojson` from a `?date=` parameter; click a culprit → tags + link.
- **Verify:** `make test` → report for `town_v1 → town_v2` contains the expected risk line and confirmed culprit ids; GeoJSON parses and its feature count equals `expected.json`; open `site/index.html` locally against the fixture output → routes and culprits draw.
- **Status:** done (2026-10-28)

### Step 9 — Faults + what-if
- **Owner:** Codex (fault catalog and scoring reviewed by Claude)
- **Files:** `sql/faults/*.sql`, `src/route_impact/faults.py`, `src/route_impact/cli.py`, `src/route_impact/impact.py`, `src/route_impact/report.py`, `site/index.html`, `config/demo_faults.toml`, `Makefile`, `tests/fixtures/town_trips.csv`, `tests/test_faults.py`
- **Do:** Per DESIGN §5.9: one `.sql` per fault type (7 types) applied to a copy of a snapshot DB; `route-impact what-if --snapshot S --delete-way|--flip-oneway|--disconnect-node ID`; `make faults SNAPSHOT=… N=200 SEED=2027` samples faults only from segments on OLD trip paths, runs single + batch-of-10, scores incremental == full recompute, root-cause top-1 confirmed accuracy (single, batch, joint-cause separately, ground truth per DESIGN §5.9), and impact rate; writes `results/faults/<snapshot>/`. `demo_faults.toml` holds the 3 demos (Bay Bridge, a freeway ramp, an I-80 intersection) with ids looked up in the real data.
  - **Decisions (Claude, 2026-10-28):**
    - Faults mutate only `roads` (and `road_nodes` for `disconnect_node`); `build_graph` re-derives segments from them, so no graph table needs patching. Tag faults keep `tags`, the derived columns (`highway`, `maxspeed_raw`, `speed_kph`, `oneway`) and `content_hash` consistent, so a fault looks exactly like a re-extracted edit. Default speeds come from `config/speeds.toml` via a temp table, as in `extract.py`.
    - `impact.py` gains a lower-level entry point that takes a prebuilt OLD graph, OLD nodes and OLD way info. *Why:* the suite runs ~220 NEW graphs against one OLD; rebuilding OLD each time doubles the cost. `compute_impact` keeps its signature and output.
    - "Top-1" = among a trip's confirmed edits, the one ranked highest in `payload["culprits"]`. Expected edit key per fault: deletes → `way_deleted/<way>`, tag faults → `way_changed/<way>`, `disconnect_node` → `node_disconnected/<node>`.
    - Faults in one batch touch distinct ways and nodes. Joint-cause trips = `cause == "joint"`.
    - `--snapshot` takes `YYMMDD` (→ `<data-dir>/norcal-<S>.osm.pbf`) or a name (→ `<data-dir>/<S>.osm.pbf`), so fixtures run as `--data-dir tests/fixtures --snapshot town_v1`.
    - `write_geojson` adds a top-level `"snapshots": {"old", "new"}` member; the map shows a "synthetic test town" notice when `old` is not `YYMMDD`.
    - Map follow-ups (Jared, 2026-10-28): re-fit on resize, start/end markers per trip, small legend, synthetic notice.
    - Makefile: SNAPSHOT/SEED/N defaults become target-specific.
- **Verify:** `make test` → mini suite on `town_v1` with **all 7 fault types**, each with a known answer, scores 100% incremental == full and 100% root cause; one batch fixture with two interacting faults is scored as joint cause; `route-impact what-if --data-dir tests/fixtures --snapshot town_v1 --trips tests/fixtures/town_trips.csv --thresholds <slow_seconds=10 file> --delete-way 51` prints T1 slowed with root cause way 51 ✔ (pinned by `test_cli_fixture_thresholds`; with the default 120 s threshold the fixture detour is correctly not "slowed"). Then (Claude, on the real data) `route-impact what-if --snapshot 261027 --delete-way <Bay Bridge id> --out results/faults/261027/demo-bay-bridge` writes an `impact.geojson` whose routes follow real streets in `site/?src=`.
- **Status:** todo

### Step 10 — CI (independent; any time after Step 0)
- **Owner:** Codex
- **Files:** `.github/workflows/ci.yml`, `README.md` (badge line only)
- **Do:** On push/PR: ubuntu-latest, Python 3.11, cache pip and `~/.duckdb/extensions`, `pip install -e ".[dev]"`, `make setup`, `make lint`, `make test`. Add the badge to README.
- **Verify:** push → Actions run green; badge renders in README.
- **Status:** todo

### Step 11 — Daily job
- **Owner:** Codex (workflow reviewed by Claude before first scheduled run)
- **Files:** `.github/workflows/daily.yml`, `scripts/daily.sh`
- **Do:** Per DESIGN §5.11: schedule + `workflow_dispatch(date, test_high)`; skip if `results/<date>/` exists; `make download` yesterday + today; call the **`route-impact` CLI directly** (not `make impact`) and branch on its exit code: 0 → commit `results/<date>/` as a bot commit (`contents: write`); 1 → commit + open an issue (`issues: write`) with the report and map link; 2 or anything else → fail the run. `test_high=true` runs the fixture pair `town_v1 → town_v2` instead, opens an issue titled `[test]`, and commits nothing. Publish `site/` + `results/` to GitHub Pages.
- **Verify:** three dispatches, each checked separately — (a) date 2026-10-27 → green, bot commit adds `results/2026-10-27/`, Pages map loads; same date again → "already done", no commit. (b) `test_high=true` → green, a `[test]` issue opens, no commit. (c) date 2099-01-01 → run fails with "not published", no commit, no issue.
- **Status:** todo

### Step 12 — Benchmark + real fault suite
- **Owner:** Codex writes; **Jared runs on the full files**
- **Files:** `src/route_impact/metrics.py`, `scripts/bench.sh`, `scripts/check_outputs.py`, `Makefile`
- **Do:** `make bench SNAPSHOT=…` records input size, rows per `kind`, drivable ways, graph vertices/edges, LSCC size, seconds per phase (extract / graph / route / diff / root cause / total), peak RSS (`/usr/bin/time -v` on Linux, `-l` on macOS — record which), DuckDB version, threads, memory_limit, CPU, RAM. Then `make faults` on 261027 and `route-impact impact` for 23→24, 24→25, 25→26, 26→27. `scripts/check_outputs.py` validates every output against its required fields.
- **Verify:** `python scripts/check_outputs.py results/` → every `metrics.json` field present and non-null with the right type; `results/faults/261027/` has all score fields and n = 200 (or the reduced n, stated); four `results/<date>/impact.json` files each carry a risk level and exit code.
- **Status:** todo

### Step 13 — README with real numbers (MVP done)
- **Owner:** Claude drafts, Jared approves
- **Files:** `README.md`
- **Do:** What it does and why (release sign-off), quickstart, how it works (segments, trips, snapping, incremental reroute, counterfactual root cause), real results table from `results/`, fault-suite results with what each number means, the US 199 false-alarm example (only if the 26→27 run confirms zero changed segments for it), map link, CI badge, limitations (no turn restrictions/traffic, provisional thresholds, injected ≠ real-world catch rate, reversible roads treated as two-way). Fill the resume bullet from the same files.
- **Verify:** every number in README `grep`s back to a value in `results/`; a fresh clone runs `make setup && make test` green.
- **Status:** todo

### Phase 2 (after Nov 4, optional) — Fault playground
In-browser Bay Area routing (static, no server): ship a compact Bay Area subgraph, click a road to delete/flip it, recompute routes in JS. Not planned in detail yet.

## Risks / open questions
- **Scope vs time:** 14 steps in ~5 days. **Cut order (whole features, not trimming):** (1) batch-of-10 fault runs (single faults only); (2) random suite → demos + 50 random faults (n stated); (3) map click-for-details popups (still draw routes and culprits). **Never cut:** the mandatory vertical slice, CI, demo faults, the results map.
- **Graph correctness** is the biggest technical risk (vertex rule, segment identity, parallel-edge reduction, implied one-ways, snapping). Mitigated by the hand-computed fixtures, `town_v2_split`, the self-comparison test, and incremental == full recompute.
- **Routing memory/time on the free runner** is checked in Step 4, not at the end. If it misses the 12 GB budget: smaller batches, then fewer local trips (stated in README). A distance `limit` is **not** an option (it fakes broken trips).
- **Quiet real days:** expected (4 days of exploration showed almost no major-road change). The story rests on fault-suite numbers + "stays quiet on normal days".
- **Provisional thresholds:** no history to calibrate on; revisit after ~2 weeks of daily runs.
- **Geofabrik publish timing:** schedule the job late enough in the UTC day; retry once before failing.
- **Bot commits** fill history; accepted (DESIGN §5.11).
- **CI extension install:** `make setup` downloads `spatial`; cache `~/.duckdb/extensions`.

## Decision log (2026-10-28 design session, Jared + Claude)
1. Pivoted from data-quality checks to **routing impact** — checks were noisy or always 0 on real data, and the "verdict + reason" shape repeated posting-triage.
2. **Daily automation is in the MVP**; dashboard and Tableau cut; **results map kept and protected from cuts**; fault playground → Phase 2; `what-if` CLI in MVP.
3. **Linux sysadmin gap accepted**; runs on GitHub's Ubuntu runners.
4. Results committed to `results/<date>/` by the daily workflow.
5. Trips: 61 cities × 60 gravity-weighted + 2,000 seeded local trips; endpoints stored as coordinates.
6. Risk LOW/MEDIUM/HIGH; HIGH opens a GitHub issue; exit 0/1/2.
7. Defaults accepted: no standalone checks; maxspeed-or-class-default speeds; exclude service/private, include car ferries; graph-based root cause; scipy routing.
8. Fault injection on DuckDB tables; demos + seeded random suite; scored as incremental==full, root-cause accuracy, impact rate (redundancy, not accuracy).
9. Renamed `osm-validate` → `route-impact` (GitHub repo + local folder).
10. After Codex critique: segments are the cross-snapshot identity; snapping keeps node ids and routes on the full NEW graph; root cause confirmed by counterfactual; access by OSM precedence; batched routing; workflow calls the CLI directly (see Review log).
11. Step 6 adds `graph.route_pairs` (2026-10-28, Claude): `shortest()` returns the full origin × destination product, so 2,000 local origins would rebuild ~4M paths; pair routing keeps the same batched Dijkstra but rebuilds only the requested paths. Impact extracts each snapshot into a fresh temp DB (as `trips.generate` does) — no cached `.duckdb`, so no stale-cache risk and the "tables already exist" issue goes away.

## Review log
### 2026-10-28 — Codex plan critique (`codex exec --sandbox read-only`, 10 points)
Prompt: *"Read docs/DESIGN.md, PLAN.md and AGENTS.md. Critique the plan: missing steps, wrong Verify commands, OSM/DuckDB/scipy pitfalls, graph-construction bugs, scope risk for ~5 days. Max 10 bullets."*

| # | Point | Decision | Reason / change |
|---|---|---|---|
| 1 | Snapping NEW endpoints into NEW's LSCC hides broken trips; DESIGN contradicted itself | **Accept** | Real bug. Endpoints snap on OLD's LSCC; NEW keeps the node id and routes on the full graph; 200 m fallback, else broken. Island fixture added (DESIGN §5.5, Steps 1, 6). |
| 2 | Batched multi-source Dijkstra ≈ 18.6 GB; feasibility checked too late; `limit` changes correctness | **Accept** | Math checks out (2,061 × ~754K × 8 B + int32 preds). Routing in fixed batches keeping only requested results; feasibility moved into Step 4 with a 12 GB budget; `limit` dropped (DESIGN §5.4). |
| 3 | Vertex rule misses repeated nodes in one way; CSR sums duplicates; need deterministic tie-break | **Accept** | Vertices count occurrences, not distinct ways; parallel edges min-reduced before CSR with a tie-break table; fixtures for parallel/closed/self-intersecting/grade-separated (DESIGN §5.4, Steps 1, 4). |
| 4 | Cross-snapshot edge identity unspecified; splits and new junctions change edge/way ids | **Accept** | Diff now compares directed node-pair **segments** with per-snapshot costs; splits, merges, and new mid-road junctions yield zero changes. `town_v2_split` fixture (DESIGN §5.6). |
| 5 | Changed edges are candidates, not proven culprits; batch ground truth ambiguous | **Accept** | Counterfactual restore-one-edit confirmation; confirmed / candidate / joint-cause labels; explicit batch ground truth. Point 4's fix already removes the harmless-split case (DESIGN §5.7, §5.9, Step 7). |
| 6 | Access filter ignores OSM precedence and `vehicle=no`; non-positive speeds | **Accept** | Precedence `motorcar → motor_vehicle → vehicle → access`; speeds must be > 0; fixtures for both precedence cases (DESIGN §5.3–5.4, Steps 1, 3). |
| 7 | "One pass" extraction unspecified for node coordinates; hash discards tags needed later | **Accept** | Two-phase extract with filtered node scan and `temp_directory`; full tags MAP kept; canonical hash; missing refs fail (DESIGN §5.2, Step 3). |
| 8 | `make` returns 2 on any recipe failure, so HIGH (1) looks like a crash | **Accept** | Workflow calls the CLI directly and branches 0/1/2; Verify covers LOW, HIGH (`test_high`), and error branches separately (DESIGN §5.11, Step 11). |
| 9 | Verify commands: DuckDB CLI/network, 4 vs 7 fault types, `jq .` proves nothing | **Accept (partly)** | The DuckDB CLI *is* installed on Jared's Mac, but Verify now uses Python `duckdb` so CI can run it; `make setup` provisions the extension once; Step 9 covers all 7 types; `scripts/check_outputs.py` replaces `jq .`. |
| 10 | Missing integration ownership (cli.py/Makefile/README); cuts too small; need a vertical slice | **Accept (partly)** | File lists fixed (Steps 5, 8, 10); mandatory vertical slice defined; cut order now removes whole features. Not reordering step numbers — CI marked independent instead, which gets the same benefit with less churn. |
