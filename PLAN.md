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
- **Status:** done (2026-10-28, `a8c7c9a`). Real-data run exposed findings A–C → Step 9b.

### Step 9b — Small outputs, contiguous-run culprits, fault timing
- **Owner:** Codex (root-cause rule and output budget reviewed by Claude)
- **Why:** the real Bay Bridge what-if on 261027 (PROGRESS 2026-10-28) wrote a 117,885,253 B `impact.json` and a 110,577,262 B `impact.geojson`, labelled 348 of 349 trips `joint` because the bridge is 10 ways in series, and took 603.98 s with per-fault suite cost unmeasured.
- **Files:** `src/route_impact/impact.py`, `src/route_impact/rootcause.py`, `src/route_impact/report.py`, `src/route_impact/faults.py`, `src/route_impact/cli.py` (added 2026-10-28 after Codex's scope stop: `impact` writes impact.json at `cli.py:110`), `site/index.html`, `tests/test_rootcause.py`, `tests/test_report.py`, `tests/test_faults.py`
- **Do:**
  - **A — output budget (DESIGN §5.10):**
    - `impact.json` keeps every per-trip scalar plus `edits`, but drops `old_path`, `new_path` and `changed_segments` (adds `changed_segment_count`). *Why:* they are the bulk, and nothing reads them back from disk; `report` re-renders from metrics and culprits only.
    - `impact.geojson` draws at most `MAP_MAX_TRIPS = 25` affected trips (one constant in `report.py`), chosen broken first, then by weight descending, then trip_id; all confirmed culprit features are always drawn. Coordinates rounded to 6 decimals, written without indentation. Top-level `"trips_shown"` and `"trips_total"`; the map says "showing N of M affected trips" when they differ.
    - `report.md`: for a non-date label, the header shows the label as-is, and the Map line becomes a relative `site/?src=` link to that run's GeoJSON (`write_report` passes the path).
  - **B — contiguous-run culprits (DESIGN §5.7):**
    - Single-edit confirmation is unchanged and runs first.
    - Only for a trip with no confirmed single edit: split its changed OLD-path segments into maximal **runs**, consecutive in path order with no unchanged segment between them. Each run with ≥ 2 edits is a **run candidate**, keyed `run/<member edit keys sorted, joined by +>`. Restore that run's segments alone with the same counterfactual; if the trip recovers, the run is confirmed and the trip's cause is `confirmed` via that run.
    - *Why runs, not "all candidates together":* restoring every changed segment on the OLD path rebuilds the OLD path, so it always passes and proves nothing. A run is one place on the road (a bridge deleted as several ways), so two far-apart slowdowns stay `joint`, as today.
    - Runs rank with single edits by weight, then count, then key. A culprit entry lists its members with names and links.
    - Scoring (`faults.py`): a confirmed run is correct iff every member is an injected fault.
  - **C — fault timing:** `scores.json` gets `"seconds"`: extract, baseline, and per run (apply, new graph, compare incremental, compare full, root cause), plus the mean per single fault and per batch.
- **Verify:**
  - `make test` and `make lint` pass. New tests:
    - a fixture where deleting two consecutive ways of one trip (e.g. 50 and 51 on T1) is labelled `confirmed` via `run/way_deleted/50+way_deleted/51`;
    - the existing two-slowdowns case (`bad_maxspeed` on 50 and 51) is still `joint`, unless the two ways are consecutive. If they are, pick non-adjacent ways and note it in PROGRESS;
    - GeoJSON is capped at `MAP_MAX_TRIPS`, with `trips_shown` and `trips_total` correct;
    - `impact.json` has no path keys.
  - Then Claude reruns the Bay Bridge what-if on 261027 into the scratchpad:
    - both files are ≤ 5 MB;
    - trips are `joint`, which is correct: deleting both spans makes two separate runs per route, split by the undeleted Yerba Buena tunnel (Jared kept both spans, 2026-10-28);
    - the map draws in the browser.
  - Then Claude runs `route-impact faults --snapshot 261027 --n 10 --seed 2027 --results-dir <scratchpad>` with `/usr/bin/time -l`, records the per-fault seconds in PROGRESS, and Jared picks N for Step 12 from that.
- **Status:** done (2026-10-28, `24eceb4`). n=10 timing: 410.2 s per run, full-recompute check 73.6% of it (PROGRESS 2026-10-28).

### Step 9c — Sampled full check, resumable suite (then start the real run)
- **Owner:** Codex (Claude reviews, rehearses and starts the real run)
- **Why:** at the measured 410.2 s per run, N=200 (220 runs) is 25.2 h; the full-recompute check is 73.6% of it. It is a correctness check, not the score, and matched 11/11 on real data. Sampling every 10th run projects to 8.6 h. Separately, `scores.json` is only written at the end, so a crash at hour 7 loses everything. Jared, 2026-10-28: sample 1 in 10, save after every run, N=200, run as soon as possible.
- **Files:** `src/route_impact/faults.py`, `src/route_impact/cli.py`, `Makefile`, `tests/test_faults.py`
- **Do:**
  - **Sampled check:** `faults --full-check-every K` (default 10; `1` = every run). Full recompute runs on run indices 0, K, 2K, … in suite order: singles first, then batches. The fault order is already seeded-random, so no extra randomness is needed. Each run records `"full_checked": bool`. `incremental_equals_full` counts only checked runs, so its denominator is the number checked. `scores.json` records `full_check_every`. Makefile: `FULL_CHECK_EVERY ?= 10` on the `faults` target.
  - **Save after every run:** append one JSON line per finished run to `results/faults/<S>/progress.jsonl`: index, faults, full_checked, equal, the run's score contributions, affected trip ids and timings. Flush it each time. `scores.json` is built from `progress.jsonl` at the end.
  - **Resume:** on start, if `progress.jsonl` exists, it must belong to the same run: `faults.json` has the same seed, N, fault list and `full_check_every`. If so, skip the runs already recorded and finish the rest. If not, stop with a clear error; never mix runs. `--fresh` deletes both files and starts over.
- **Verify:**
  - `make test` and `make lint` pass. New tests:
    - K=1 reproduces today's scores on the fixture suite;
    - K=3 checks exactly runs 0, 3, 6, …;
    - a run that crashes partway (monkeypatched to raise on run 2), then restarts, skips runs 0–1 (counted calls to `apply_faults`) and ends with the same scores as an uninterrupted run, `seconds` excluded;
    - a mismatched `faults.json` stops with an error.
  - Then Claude rehearses `route-impact faults --snapshot 261027 --n 10 --seed 2027 --results-dir <scratchpad>` (exit 0, runs 0 and 10 checked, `progress.jsonl` has 11 lines).
  - Then Claude starts `route-impact faults --snapshot 261027 --n 200 --seed 2027` in the background, writing to `results/faults/261027/`.
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
  - *Decided 2026-10-29 (Claude):* cron `0 6 * * *`; the default date is **yesterday (UTC)** as NEW and the day before as OLD, so Geofabrik has already published both. `date` input is `YYYY-MM-DD` = NEW. "Not published" is retried (3 × 20 min) only on scheduled runs; a dispatch with an explicit date fails at once. Pages deploys in a second job, only after a commit (exit 0/1). Jared sets Settings → Pages → Source = GitHub Actions once.
- **Verify:** three dispatches, each checked separately — (a) date 2026-10-28 → green, bot commit adds `results/2026-10-28/`, Pages map loads; date 2026-10-27 (committed in Step 6) → "already done", no commit. (b) `test_high=true` → green, a `[test]` issue opens, no commit. (c) date 2099-01-01 → run fails with "not published", no commit, no issue.
- **Status:** done 2026-10-29 (runs 40838962434, 40840231384, 40840922338, 40840270536; see PROGRESS Step 11 Verify)

### Step 12 — Benchmark + real fault suite
- **Owner:** Codex writes; **Jared runs on the full files**
- **Files:** `src/route_impact/metrics.py`, `scripts/bench.sh`, `scripts/check_outputs.py`, `Makefile`, `tests/test_metrics.py`, `tests/test_check_outputs.py`
- **Do:** `make bench SNAPSHOT=… [OLD=…]` (OLD defaults to the day before SNAPSHOT; route / diff / root cause are timed on the real OLD→SNAPSHOT comparison, since a self-comparison has nothing to diff) records input size, rows per `kind`, drivable ways, graph vertices/edges, LSCC size, seconds per phase (extract / graph / route / diff / root cause / total), peak RSS (`/usr/bin/time -v` on Linux, `-l` on macOS — record which), DuckDB version, threads, memory_limit, CPU, RAM. Then `make faults` on 261027 and `route-impact impact` for 23→24, 24→25, 25→26, 26→27. `scripts/check_outputs.py` validates every output against its required fields.
- **Verify:** `python scripts/check_outputs.py results/` → every `metrics.json` field present and non-null with the right type; `results/faults/261027/` has all score fields and n = 200 (or the reduced n, stated); four `results/<date>/impact.json` files each carry a risk level and exit code.
- **Status:** done 2026-10-29 (bench `533b05b`; four impact runs 23→27 all LOW / exit 0; `check_outputs.py --expect-impact 4` → failures=0; see PROGRESS)

### Step 12b — Keep small fractions in impact.json (bug fix)
- **Owner:** Codex writes; Claude reviews and reruns
- **Files:** `src/route_impact/impact.py`, `tests/test_impact.py`, `src/route_impact/report.py`, `tests/test_report.py` (added 2026-10-29 in review: `report.md` printed `share * 100` with `:g`, which only looked tidy because the JSON was pre-rounded — it now prints percentages to 3 significant digits, e.g. `55.6%`, `0.00383%`), then regenerated `results/2026-10-2{4,5,6,7,8}/` (impact.json, report.md, impact.geojson)
- **Bug:** `json_safe` rounds every float to 2 decimals, so `high_slowed_share` 0.005 is written as 0.01 and any `gravity_share_*` below 0.005 is written as 0.0. Risk levels were computed before rounding, so no committed risk level is wrong, but `impact.json` (the source of truth) misreports the threshold and would hide small shares. Found in Step 12 Verify.
- **Do:** round finite floats to **6 significant digits** (`float(f"{v:.6g}")`) instead of 2 decimals; nonfinite → `null` as before. Update the `0.56` share assertion (`tests/test_impact.py:78`) to the 6-significant-digit value. Add tests: thresholds with `high_slowed_share = 0.005` serialise as `0.005`; a share of `3.83e-05` (one intercity trip's share of the gravity weight) serialises as non-zero; seconds still serialise deterministically (same payload twice → identical JSON). After the code is merged, rerun 23→24 … 27→28 locally (`make download DATE=261028` first) to regenerate the committed files.
  - *Why significant digits, not more decimals:* one rule fits values of any size — a 3.83e-05 share and a 299.54 s route both keep 6 meaningful digits, while fixed decimals would need a guess about the smallest value. *Rejected:* exempting share/threshold keys from rounding (a key list goes stale and new fields get rounded silently); no rounding (still deterministic, but float noise like `0.30000000000000004` makes committed diffs harder to read).
- **Verify:** `pytest tests/test_impact.py` green with the new tests; `make test` and `make lint` green. After the reruns: `python scripts/check_outputs.py results/ --expect-impact 4` → failures=0, and `git diff results/` shows only `high_slowed_share` 0.01 → 0.005 plus extra digits on existing floats — no change to risk level, exit code, broken, slowed or rerouted counts.
- **Status:** done 2026-10-29 (181 passed; five reruns all LOW/exit 0; results diff = `high_slowed_share` 0.01 → 0.005 only; see PROGRESS)

### Step 13 — README with real numbers (MVP done)
- **Owner:** Claude drafts, Jared approves
- **Files:** `README.md`
- **Do:** What it does and why (release sign-off), quickstart, how it works (segments, trips, snapping, incremental reroute, counterfactual root cause), real results table from `results/`, fault-suite results with what each number means, the US 199 false-alarm example (only if the 26→27 run confirms zero changed segments for it), map link, CI badge, limitations (no turn restrictions/traffic, provisional thresholds, injected ≠ real-world catch rate, reversible roads treated as two-way). Fill the resume bullet from the same files.
- **Verify:** every number in README `grep`s back to a value in `results/`; a fresh clone runs `make setup && make test` green.
- **Status:** done 2026-10-29 — Jared approved the README; numbers traced; fresh clone 181 passed; CI run 40961646981 green. **MVP done.**

### Phase 2 — Fault playground (design: [docs/PLAYGROUND.md](docs/PLAYGROUND.md); started 2026-10-29)
Branch `playground`; merge to `main` only after P2 Verify. Steps below are outlines; each gets Files / Do / Verify detail before Codex starts it.
- **P0 — Feasibility spike (two go/no-go decisions), Oct 30.**
  - **Owner:** Codex writes the spike code; Claude runs the export and the browser measurements and decides A and B.
  - **Branch:** `playground`.
  - **Files:**
    - `scripts/playground_spike.py`: spike exporter and stress-set generator. Not the P1 exporter; it may be replaced.
    - `site/playground/spike/index.html`, `site/playground/spike/worker.js`, `site/playground/spike/measure.js`
    - `results/playground/stress_set.json` and `results/playground/feasibility.json` (both committed)
  - **Spike data:** written to `data/playground-spike/` (gitignored, never committed), served locally with `python -m http.server` from the repo root.
  - **Do:**
    1. **Export from 261027 in the §5.2 format:**
       - routing: CSR, every parallel edge, reverse twins inactive, Float64 seconds, Float64 OSM ids;
       - baseline paths for the box's trip cohort (filter by raw coordinates, then snap to the LSCC);
       - geometry simplified at a stated tolerance with quantized coordinates, gzipped.
    2. **Freeze the stress set before measuring:** Bay Bridge and University ramp from `config/demo_faults.toml`; 20 Stomps from seeded random ways on at least one baseline path (seed recorded); Meteors at 150, 300 and 500 m on 4 fixed points (dense downtown SF, a bridge approach, a spot that isolates trip endpoints, a quiet residential area), with coordinates in the file.
    3. **Spike page:**
       - MapLibre from a pinned CDN version with an OpenFreeMap style;
       - worker loads and decompresses the data with `DecompressionStream`;
       - grouped-by-origin Dijkstra over the active-edge mask;
       - segment-to-circle Meteor hit test;
       - single + maximal-run attribution with a search counter;
       - `measure.js` runs every stress case 5× and downloads the result JSON.
    4. **Record:** cold-load transfer (excluding tiles), decode time, peak heap, per-file gzip size, and for each case its affected trips and origins, searches, attribution completeness and median latency. Also record tile, style and icon licenses and the attribution text.
  - **2026-10-29 — first measurement failed the gate; Jared chose "optimize once"** over the smaller box. The run was uncontrolled (hidden pane, two overlapping runs), but the pattern was consistent: Bay Bridge preset 34–46 s, chokepoint Meteors 9–18 s (75–85% of it attribution), most Stomps ≤ ~1 s. *Why optimize rather than shrink:* the cost is the number of searches, not graph size, so a smaller box would cut coverage without fixing the chokepoint cases. One pass, time-boxed to Oct 30, then a clean re-measure:
    1. Precompute both presets in Python (impact + uncapped attribution) and ship them as labelled results.
    2. A default Meteor attribution budget, set from the re-measure, with unchecked trips shown as "attribution incomplete".
    3. Group reroutes by origin *or* destination (reverse search), whichever needs fewer searches.
    4. A local-detour bound that skips the full search when a detour around the removed stretch is provably under 2 min. *Why this is safe:* the detour gives an upper bound on the new time.
    5. Reuse typed arrays in the search instead of allocating them per search.
    6. A run lock so measurements can't overlap.

    If the re-measure still fails, the no-go path above applies unchanged.
  - **Verify:** `results/playground/feasibility.json` has every field above for every stress case; every file is ≤ 5,000,000 B; decisions A and B are written in PROGRESS with the numbers they rest on. No pytest is required for spike code. `make test` and `make lint` stay green.
  - **2026-10-29 — result of the optimization pass:** 0 differences against the old worker, and the Python presets equal JS (`check.mjs --compare`). But each full search still costs ~60–70 ms (Node). Every live Stomp is ≤ 1,510 ms, but the Bay Bridge toll plaza Meteor fails at every radius: rerouting alone is 4,266 ms at 150 m, and 23.9–62.1 s with attribution.
  - **Jared, 2026-10-29: cut nothing.** Keep the whole Bay box, free-aim Meteor and "roads that mattered". The playground launch moves past Nov 4 (target ~Nov 17) instead of shipping a reduced version. Applications on Nov 4 use the finished MVP. The 2 s gate is unchanged. Next is P0b.
  - *Status:* spike done; gate not met by plain Dijkstra → P0b

- **P0b — Faster exact routing (landmarks + parallel workers).**
  - **Owner:** Codex writes; Claude verifies and measures.
  - **Files:** `site/playground/spike/{worker.js,measure.js,check.mjs,index.html}`.
  - **Do:**
    1. **ALT:** A* with landmark lower bounds. About 16 landmarks (farthest-point selection, seeded), with forward and backward distances computed in the worker after load, on the *superset* graph where every reverse twin is active. Then the bounds stay admissible after any Stomp, Meteor or Flip. Multi-target searches use the minimum bound over the remaining targets.
    2. **Parallel workers:** a pool of `min(navigator.hardwareConcurrency − 1, 8)` workers, each with its own copy of the graph. Searches are independent and are split across workers; results are merged deterministically.
    3. **Same outputs:** results identical to the current worker on every stress case.
  - **Verify:**
    - `node site/playground/spike/check.mjs --compare` → 0 differences, and presets still equal Python. A test also asserts every landmark bound ≤ the true distance on sampled pairs.
    - Then a clean browser measurement: pane visible, run lock, 5 repeats, into `results/playground/feasibility.json`. Record load time including landmark precompute, peak heap per worker, and per-case latency.
    - Gate unchanged: every stress case ≤ 2 s (Meteor with its attribution budget), each file ≤ 5,000,000 B, total ≤ 10,000,000 B.
  - **If it still misses:** P0c, customizable contraction hierarchies (CCH) via a WebAssembly build of RoutingKit (BSD-2), decided on the P0b numbers.
  - *Status:* code done and verified exact 2026-10-29. `check.mjs --compare`: 0 differences at P=1 and P=4; landmark bound max ratio 0.9999999996 on 500 pairs.
  - **Clean browser measurement** (`results/playground/feasibility_p0b.json`; pane visible, P=8, 5 repeats, Chrome 152 in the Claude app, M3 Max):
    - Stomps ≤ 543 ms median; presets ~10 ms; non-chokepoint Meteors ≤ 665 ms uncapped.
    - **Fails:** toll plaza Meteor with full attribution 2,675 / 4,812 / 6,471 ms (150/300/500 m). With attribution budget 40 it's 1,422–1,516 ms, but incomplete.
    - **Fails:** data transfer 15,413,857 B > the 10,000,000 B target.
    - Worker memory not measurable in the browser; Node peak 1.22 GB at P=4.

- **P0c — Exact fast routing with CCH** (design: docs/PLAYGROUND.md §5.10).
  - **Dates:** checkpoint **Nov 1** (P0c-2); cutoff **Nov 5**. If the gate isn't met by the cutoff, switch to the progressive-results fallback, recorded as a gate change. Then P1 Nov 6–9, P2 Nov 10–16, launch ~Nov 17.
  - **P0c-1 — Order tool** (Claude: needs network and a C++ build).
    - `scripts/cch_order/`: Makefile that clones RoutingKit at a pinned commit into `data/routingkit/` (never vendored), plus a tiny C++ main.
    - The exporter writes canonical input (§5.10); the tool writes the order and `order_manifest.json` (commit, compiler, flags, input/output SHA-256), and the exporter validates the permutation.
    - Also a committed tiny fixture order generated by the tool, for tests.
    - **Verify:** same input → byte-identical order on a rerun; manifest hashes match.
    - *Status:* done 2026-10-29 (Claude):
      - The tool built first try (Apple clang 17, fixed flags `-O2 -fno-fast-math -ffp-contract=off`; RoutingKit's own Makefile uses `-march=native -ffast-math`, which isn't reproducible).
      - Bay graph: 213,910 nodes and 272,836 undirected edges ordered in ~6 s; permutation validated; `cch_order.bin.gz` is 525,982 B.
      - Deleting and rebuilding the tool, then rerunning, gave an identical manifest (output sha256 `c06aa07d…`) and byte-identical gz.
      - Fixture `site/playground/spike/fixtures/grid6_order.json` (36 nodes, 62 edges) is byte-identical on rerun.
      - Note: RoutingKit symmetrizes the input itself, so the canonical input lists each undirected pair once.
  - **P0c-2 — CCH core + toll-plaza checkpoint** (Codex; due Nov 1).
    - Code: `site/playground/spike/cch.js` with fill-graph build, directed customization, partial re-customization (§5.10), guarded integer arithmetic with an ∞ sentinel, witnesses + unpacking, and batched counterfactuals.
    - Network-free tests (`node --test`, runnable in CI): tiny graphs, **all pairs**, under several permutations, including the committed RoutingKit fixture order. Edit cases: increase and decrease sequences, infinite directions, parallel-winner change, Flip, restore/undo, repeated edits. Each is compared against both full customization and Dijkstra, with unpacked-path validity asserted.
    - **Checkpoint:** on the real Bay graph in Node, time the toll-plaza 500 m case with full attribution, broken down into initial edit, each restore, undo, query and unpack, with dirty-arc and triangle-scan counts. Also record fill arcs, triangles and buffer bytes. If it isn't clearly heading under 2 s, Claude raises the fallback decision early.
    - *Status:* done 2026-10-29, **checkpoint passed → go** (Codex wrote it; Claude reran):
      - `node --test site/playground/spike/test/cch.test.mjs`: 27/27 pass.
      - `node site/playground/spike/cch_bench.mjs` → `results/playground/cch_checkpoint_node.json`, status complete; CCH == integer-ms Dijkstra running the same procedure on 25/25 comparisons.
      - Real Bay graph: 935,530 CCH arcs, 6,230,212 triangles, build 486 ms.
      - Median totals with full attribution, 1 thread (Node): toll plaza 500 m 81.5 ms, 150 m 38.8 ms; Bay Bridge live 47.8 ms; Union Square 500 m 48.9 ms; stomp_17 6.5 ms. (P0b with 8 workers: 6,471 / 2,675 / 5,070 / 665 / 331 ms.)
      - Process peak RSS 485,834,752 B, including the Dijkstra oracle.
      - First run stopped on the Uint32 bound → decision 15.
  - **P0c-3 — Integration + acceptance.**
    - Exporter: integer ms and the order; baselines and presets recomputed on integer ms; size trims.
    - `check.mjs`: a new integer-ms Dijkstra reference, with every stress case == CCH (impact + full attribution). Differences against the Float64 P0b reference are listed: classification, baseline paths, candidates, confirmed attribution.
    - Presets == Python. Data hashes and order hash recorded.
    - *Status (2026-10-30, Codex code, Claude reran):* integration done; acceptance not run yet.
      - Exporter: integer ms, Python baselines and presets, order and trims. Shipped data is 9,663,640 B (MapLibre not included).
      - Tests 30/30.
      - `check.mjs`: all 34 stress cases identical to the independent integer-ms Dijkstra; presets == Python. Float64→ms drift: only `added_ms` in 6 cases; 0 changes to affected sets, classification, baseline paths, candidates or confirmed attribution.
      - Bench: toll plaza 500 m 69.65 ms.
      - **Blocker found:** engine-alone Node RSS is 389,562,368 B after load and 551,026,688 B after 50 edits (+161,464,320 B; looks like a leak). Over the 300 MB limit.
  - **Verify (gate):**
    - **Clean browser run:** pane visible, fixed device and browser recorded, 5 repeats, each repeat asserting full oracle-equal attribution. The timer covers all required work: edit, counterfactuals, undo, unpacking, transfer and draw, ending when the GeoJSON source reports loaded and the next frame has rendered. Reset is timed separately. Live and preset cases are labelled.
    - **Limits:**
      - every stress case ≤ 2,000 ms median with full attribution;
      - each file ≤ 5,000,000 B; total transfer ≤ 10,000,000 B, with a cold load verified (cache disabled);
      - page ready ≤ 5,000 ms;
      - worker memory ≤ 300 MB, measured with `performance.measureUserAgentSpecificMemory` where available and in Node otherwise, including growth after 50 repeated edits.
    - The P0b `feasibility.json` is preserved as `feasibility_p0b.json`.
  - *Status:* **done 2026-10-30, gate passed** (Claude ran it; `results/playground/feasibility.json`).
    - Setup: Claude desktop app's built-in browser pane, visible; Chromium 152; MacBook Pro M3 Max.
    - Results:
      - 36 cases × 5 repeats, every repeat equal to the integer-ms reference;
      - slowest median 82.69 ms (toll plaza 500 m);
      - largest file 2,850,841 B;
      - transfer 9,727,543 B: graph data plus spike code, cold load verified;
      - page ready 644 ms;
      - worker memory 261,603,328 B (Node RSS fallback).
    - Caveats:
      - `measureUserAgentSpecificMemory` throws SecurityError in this embedded browser even with cross-origin isolation, so memory comes from the Node fallback.
      - MapLibre's transfer size isn't measured (cross-origin, reported as 0); the transfer total leaves it out.
      - Browser reset time rose from ~48 to ~1,298 ms over the run; the Node engine reset maxes at 0.29 ms, so the cost is on the draw side. Reset is outside the gate.
- **P1 — Exporter + oracle + tests.** `route-impact export-playground`; Python oracle (Stomp/Flip/Meteor + full recompute on the exported graph, fixed endpoints, uncapped "mattered" set); pytest on fixtures; `node --test` JS vs oracle for Stomp, Flip, delete-parallel-winner, flip-into-existing-edge, Meteor with one road mattering, Meteor needing a contiguous run, "several roads together", 120 s boundary. *Status:* todo
- **P2 — Game MVP.** `site/playground/`: Apple Maps-style layout (MapLibre, muted light/dark styles, three-height bottom sheet / desktop card, floating Rebuild/recenter/theme buttons); Stomp, Flip, Meteor; worker reroute with request ids; damage numbers; before/after routes; roads that mattered; Try these presets; honest "nothing happened" messages; loading/error states; keyboard + reduced motion. Verify: browser == oracle on both presets, 10 random Stomps, 3 Meteors; smoke test on the deployed Pages URL at phone and desktop sizes. *Status:* todo
- **P3 — More weapons:** Quake, Tornado, stacked edits with undo, Ashby junction as a Quake preset. *Status:* todo (after Nov 4)
- **P4 — Polish** (URL hash to share an edit, animation and phone pass). *Status:* todo (after Nov 4)

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

12. **Playground becomes a game with an Apple Maps-style interface** (2026-10-29, Jared + Claude). Jared asked for faults that work like campuscrusher.com and a UI that feels like Apple Maps on iOS.
    - **Game loop:** weapons Stomp / Flip / Meteor (MVP), Quake / Tornado (P3), damage numbers and Rebuild.
    - **Meteor's "roads that mattered" check:** the pipeline's restore-one-edit root cause applied to one blast.
    - **Interface:** MapLibre GL JS + OpenFreeMap vector tiles instead of Leaflet + raster tiles, because a calm restyled map and dark mode need vector styling. The results map stays on Leaflet.
    - **Not copied:** no global leaderboard (needs a backend), no 3D, no Apple assets (SF Symbols and SF Pro are licensed for Apple platforms only).
    - **Deadline fallback:** Meteor is the first thing dropped if P0 or time says so.
    - Details in docs/PLAYGROUND.md.

13. **Cut nothing; move the playground launch instead** (2026-10-29, Jared + Claude). P0 showed plain Dijkstra (~60–70 ms per search on 213,910 vertices) can't meet the 2 s gate for chokepoint Meteors with attribution. Jared rejected cutting Meteor, the explanations or the area.
    - **Plan:** make routing faster while keeping it exact: landmarks (ALT) + parallel workers (P0b), then CCH only if measured short (P0c).
    - **Launch:** target ~Nov 17. Nov 4 applications use the finished MVP.
    - **Gate:** stays at 2 s, not lowered after failing it.
    - *Why ALT first:* deletions only lengthen routes, so landmark bounds computed with all twins active stay valid under every edit. Answers stay exact (checked by `check.mjs`), there's no extra download (landmarks are computed after load), and it's 1–2 days against several for CCH.

14. **P0c = customizable contraction hierarchies** (2026-10-29, Jared). P0b's browser run met the gate everywhere except the full explanation at the toll plaza (2.7–6.5 s) and download size (15.4 MB). Jared chose CCH (everything ≤ 2 s with full explanations) over progressive results.
    - **Design:** RoutingKit nested-dissection order computed offline; topology, customization, queries and partial re-customization in plain JS.
    - **Costs:** integer-millisecond costs for exact arithmetic; size trims to reach ≤ 10 MB.
    - **Fallback:** if P0c still misses, progressive results, recorded as a gate change.

15. **CCH metric arithmetic: `Float64` holding integer ms, `Infinity` for no arc** (2026-10-29, Claude). The P0c-2 checkpoint stopped at the Uint32 design's own bound: the finite weights sum to 4,813,448,868 ms > 2³² − 1. That bound was overly conservative but was my spec, and Codex correctly refused to bend it. *Why Float64:* exact for integers below 2⁵³ (≈ 1.9 million× the Bay total), so no sentinel or guarded add; ~7.5 MB more memory. Checkpoint data so far: 935,530 CCH arcs (1.7× the 551,760 input arcs), 6,230,212 triangles, build 486.8 ms, Meteor hit counts identical to P0b.

## Review log
### 2026-10-29 — Codex critique of the P0c CCH design (`codex exec --sandbox read-only`, 10 points)
All 10 accepted; docs/PLAYGROUND.md §5.10 and PLAN P0c rewritten the same day.
1. **Partial re-customization was wrong for increases.** Accepted, and it was a real bug in my draft: a running `min` keeps stale cheap shortcuts after deletions. Now: recompute the direct-input minimum and all lower triangles from scratch, in rank order, propagating transitively; checked against full customization after every transition.
2. **"Any order is correct" needs the clique fill-graph and directed triangle rules.** Accepted: stated explicitly; tests use several permutations.
3. **Millisecond rounding can change classification and attribution.** Accepted: exactness is stated as relative to the quantized graph; rounded once in Python; every difference against the Float64 reference is reported, including paths, candidates and attribution.
4. **`Uint32` can't hold Infinity, and sums can wrap.** Accepted: sentinel 2³² − 1, guarded addition, a proven bound on sums, and tests for unreachable, near-limit, tie and zero-cost cases.
5. **One middle vertex isn't enough to unpack paths.** Accepted: direction-specific witnesses (input edge or child arcs), refreshed and restored with weights; path validity asserted; attribution uses the shipped baseline path.
6. **The bottleneck may move to repeated customization.** Accepted: batched counterfactuals, plus a toll-plaza checkpoint benchmark (Nov 1) before full integration.
7. **The timing contract was loose.** Accepted: the timer covers all required work to a rendered frame; reset is timed separately; live and preset are labelled; full attribution is asserted per repeat; hashes and device are recorded; the P0b file is preserved.
8. **Memory and size of CCH buffers unspecified.** Accepted: counts and bytes measured first; limits of page ready ≤ 5 s and worker memory ≤ 300 MB; cold load verified.
9. **No CI fixture strategy.** Accepted: tiny graphs, all pairs, several permutations, a committed RoutingKit fixture order; network-free `node --test`, separate from the full acceptance run.
10. **Reproducibility and schedule.** Accepted: canonical input, permutation validation, a manifest with hashes, recorded compiler/flags; P0c split into three sub-steps with a Nov 1 checkpoint and a Nov 5 cutoff that triggers the fallback.

### 2026-10-29 — Codex critique of the playground game + UI additions (`codex exec --sandbox read-only`, 9 points)
7 accepted as given, 2 accepted with changes; docs/PLAYGROUND.md and the P0 step updated the same day.
1. **Runs must be maximal runs split by unchanged segments.** Accepted: same rule as DESIGN §5.7 (keeps the Bay Bridge's two spans separate across the tunnel); groups shown separately from single roads.
2. **A capped check can't give a "several roads" verdict.** Accepted: per-trip bookkeeping; "attribution incomplete" whenever checks remain; browser-confirmed ⊆ oracle, equal when uncapped; a cap fixture.
3. **"Recovers" was stricter than the pipeline.** Accepted, and it was my error: a broken trip recovers when reachable, a slowed one when its delay is under 120 s, exactly as DESIGN §5.7. A fixture pins break → 5-min detour.
4. **"Any geometry point" misses crossing segments.** Accepted: segment-to-circle intersection in metres, whole ways deleted, simplification tolerance recorded; the oracle uses the same shipped geometry.
5. **Ways per blast isn't the cost.** Accepted: a frozen stress set (Bay Bridge, ramp, 20 Stomps, Meteors at 3 radii on 4 fixed spots), recording origins, searches, completeness and the median of 5 timings.
6. **Fallback depended on what failed; P2 too big.** Accepted with a change: P0 makes two decisions (A live routing → else precomputed presets; B Meteor → else Stomp/Flip live). The Apple-style UI stays because Jared asked for it, but the MVP uses ready-made light/dark styles, tap-to-change sheet heights and a simple ring; drag, custom style and animation move to P4.
7. **"Minutes of delay added" overclaims.** Accepted: labelled "added travel minutes across the sampled trips delayed ≥ 2 min", with the sample size, broken counted separately, seconds summed before rounding.
8. **Map editing wasn't accessible.** Accepted with a change: a center crosshair with Enter to fire (instead of a text road search, which can come later), a live region for results, visible focus, sheet-height buttons, and a keyboard-only Verify in P2.
9. **Attribution is a layout requirement.** Accepted: tile credits stay visible above the sheet at every height; P0 records the style, icon and fallback licenses and policies.

### 2026-10-29 — Codex critique of the Phase 2 playground design (`codex exec --sandbox read-only`, 10 points)
All 10 accepted; docs/PLAYGROUND.md and the Phase 2 steps updated the same day.
1. **Incremental proof: promise worsening only.** Accepted: flips activate reverse edges that can speed up untouched trips. The page reports break/slow only (as the pipeline does); the test compares incremental vs full worsening after delete and flip.
2. **Winner-only CSR loses parallel detours.** Accepted, and the most important point. It was a real correctness bug in the draft: export one row per pipeline `Edge`, relax all active edges, plus delete-winner and flip-into-existing-edge fixtures.
3. **Endpoint semantics differ from the CLI.** Accepted: fixed endpoints (edits only deactivate edges), with the oracle using the same rule; no claim of CLI equivalence.
4. **Box clipping changes answers.** Accepted: filter trips by raw coordinates before snapping; drop whole contracted edges that leave the box; LSCC once on the unedited graph only; freeze the cohort; state "no detours outside the box".
5. **`what-if` is not a valid oracle; Bay Bridge is 10 ways.** Accepted: the oracle is a Python full recompute on the identical exported graph; Bay Bridge is a labelled compound preset counted as one edit.
6. **The 300 ms single-search gate doesn't prove 1 s edits.** Accepted: P0 measures end-to-end edit latency in a real browser, with the Bay Bridge preset as the gate (≤ 2 s), and destinations grouped by origin. Deadline fallback: presets only.
7. **The size gate missed the total.** Accepted: hard per-file 5,000,000 B plus a 10,000,000 B transfer target excluding tiles (5 MB total was infeasible: routing alone is 3,992,423 B gzipped), measured into `results/playground/feasibility.json`.
8. **Binary format underspecified.** Accepted: versioned, little-endian, Float64 costs, Float64 OSM ids (node ids exceed 2^32), and an active-mask overlay with reverse twins instead of rewriting CSR.
9. **Node tests miss browser/worker/hosting.** Accepted: P0 measures in a real browser; P2 has a deployed-Pages smoke test; request ids stop stale worker responses; loading/error states are required (N8).
10. **MVP scope mixed deferred features; "routes around it" was unsupported.** Accepted: Nov 4 scope is delete + flip, one active edit, Reset, two presets, essential phone layout, loading/error states. Two honest "nothing changed" messages; the cause is stated as "this edit, by construction", not a root-cause search.

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
