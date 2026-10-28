# PROGRESS.md — route-impact

## Current state
- **Working on:** Step 9b — small outputs, contiguous-run culprits, fault timing (added to PLAN.md + DESIGN §5.7/§5.9/§5.10 by Claude, 2026-10-28; Jared chose a separate step).
- **Done:** design, plan critique, Steps 0–9 committed (Step 9 = `a8c7c9a`).
- **Next up:** Claude writes the Step 9b Codex brief from PLAN "### Step 9b", launches Codex, reviews, then reruns the Bay Bridge what-if and an n=10 timed suite on 261027 (scratchpad outputs). Then Step 10/11.
  - **Read to resume (one call):** `grep -n "### Step 9b" PLAN.md` and read that step; `grep -n "def explain_trips\|def candidate_edits\|def write_geojson\|def render_markdown\|def evaluate_faults" src/route_impact/*.py; git status --short`. Previous Bay Bridge outputs + preview are in the session scratchpad; `.claude/launch.json` (untracked, local) serves that preview.
  - **Real-data what-if (Claude, 2026-10-28):** `route-impact what-if --snapshot 261027 --out <scratchpad> --delete-way` ×10 Bay Bridge ways → `Affected: 253 intercity · 96 local trips · 15% weighted travel`, `Root cause: way 661905446 ✔`; `/usr/bin/time -l`: 603.98 s real, 8549171200 bytes max RSS. Map preview (12 heaviest trips) drawn in the browser: detours follow real roads (Richmond–San Rafael and San Mateo bridges). Outputs left in the scratchpad, not `results/`.
  - **Finding A — output size:** that run wrote impact.json 117,885,253 B and impact.geojson 110,577,262 B (349 trips × full paths). Too big to commit or load in the map; a bad real day would do the same. Needs a size cap (e.g. top-K trips in GeoJSON, paths out of the committed impact.json).
  - **Finding B — multi-way edits read as "joint":** the bridge is 10 ways in series, so restoring any one way recovers nothing; 348 of 349 trips are `joint` (1 confirmed) and the top culprit has 1 trip. Correct per DESIGN §5.7, but the flagship demo looks like a miss. Option: when no single edit recovers a trip, try restoring all its candidates together and label the set "confirmed (group)".
  - **Finding C — suite runtime:** one what-if = 604 s incl. one extract + two graph builds. The suite repeats copy + NEW graph + compare ×2 + root cause ~220 times; per-fault cost unmeasured. Profile one fault before Step 12; a 200-fault run may not fit Nov 3.
  - Minor: report.md header/Map link use `date=261027+what-if` for what-if runs (link is broken there).
  - **Watch:**
    - Peak RSS ≈ 8 GB for a full impact run (two graphs); root cause adds one O(E) CSR copy per candidate check plus one Python pass over OLD roads and NEW edges per run — unmeasured on NorCal. Time both in Step 11.
    - Two independent slowdowns that each exceed `slow_seconds` are labelled `joint`; after Step 9b only if they are not contiguous on the OLD path (DESIGN §5.7).
    - `scripts/feasibility.py:31-32` still hardcodes the city filter. Switch it to `trips.filter_places` when a step names that file.
  - **Follow-ups (not blocking):** remove the unused `segments` temp table (`segments.sql:21-25`). Have Step 3 emit a `speed_source` column so `graph.py:70-80` stops duplicating the maxspeed parser.
  - **Still open from earlier reviews:**
    - `extract()` finds `sql/` and `config/` via the source checkout (`parents[2]`), so it needs the editable install (the CI workflow must use `pip install -e`).
    - The motorway and ramps are on no named trip, so they're covered structurally only.
- **Pending small fixes:** AGENTS.md install line should say `PYENV_VERSION=3.11.14 python3.11 -m venv .venv` (see Step 0 gotchas).
- **Environment:** `.venv` exists (Python 3.11.14, deps + `spatial`). Snapshots 261023–261027 in `data/`, verified (261027 is an APFS clone of `norcal-latest`, same md5); `make download` works.
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

### 2026-10-28 — Step 9: Faults + what-if
- **Agent:** Codex
- **Did:** Implemented all seven parameterized SQL mutations with target refusals, derived-column/hash consistency and configured default speeds. Added a reusable OLD graph/node/way entry point and cached OLD routing, seeded sampling across fault types/classes from OLD paths, consecutive distinct-target batches of ten, exact all-trip routing-result incremental/full comparisons before serialization rounds floats, and separate single/batch/joint scores with denominators. Added repeatable what-if flags, snapshot resolution, report output while both databases exist, three configured demos and Make targets. Added GeoJSON snapshot labels, synthetic notice, endpoint markers/legend and resize fitting. Added 33 offline fault tests including known-answer cases, the joint speed-fault batch, real seeded output-file determinism, CLI outputs and legacy report compatibility.
- **Review fixes:** 1) Reuse one NEW graph/nodes/way-info load per run; full recompute calls only `compare_trips`, with a regression pinning one graph build and one root-cause pass per run. 2) Compare all raw trip records before serialization (including ok/improved results), omitting only the mode-dependent `rerouted` execution flag; regression catches a 1e-10-second difference on an unaffected trip. 3) Refuse downgrade_class unless the configured residential default is strictly slower, and bad_maxspeed unless current speed exceeds 5 mph; sampling uses the same eligibility rule, with equal/slower refusal tests. 4) Worst prints trip id/kind and one-decimal delay; pinned CLI assertion updated. 5) Move TOML demo parsing into `run_demos`, simplify Make target, and test exact configured Fault lists/output paths plus custom config with monkeypatched `run_what_if`.
- **Changed:** `sql/faults/delete_way.sql`, `sql/faults/delete_bridge.sql`, `sql/faults/flip_oneway.sql`, `sql/faults/add_oneway.sql`, `sql/faults/disconnect_node.sql`, `sql/faults/bad_maxspeed.sql`, `sql/faults/downgrade_class.sql`, `src/route_impact/faults.py`, `src/route_impact/cli.py`, `src/route_impact/impact.py`, `src/route_impact/report.py`, `site/index.html`, `config/demo_faults.toml`, `Makefile`, `tests/fixtures/town_trips.csv`, `tests/test_faults.py`, `PROGRESS.md`.
- **Verify:** Activated the existing venv with `PATH="$PWD/.venv/bin:$PATH"`; both commands exited 0, offline on fixtures only. Actual final output:

```text
$ make test
python -m pytest
============================= test session starts ==============================
platform darwin -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0
rootdir: /Users/jarednarvaez/route-impact
configfile: pyproject.toml
collected 107 items

tests/test_extract.py ......                                             [  5%]
tests/test_faults.py .................................                   [ 36%]
tests/test_graph.py .............                                        [ 48%]
tests/test_impact.py .............................                       [ 75%]
tests/test_report.py .....                                               [ 80%]
tests/test_rootcause.py ..............                                   [ 93%]
tests/test_smoke.py .                                                    [ 94%]
tests/test_trips.py ......                                               [100%]

============================= 107 passed in 13.61s =============================
$ make lint
ruff check . && ruff format --check .
All checks passed!
28 files already formatted
```

- **Review:** Claude — first pass found 5 issues (double NEW graph/root cause per fault; incremental==full compared only affected trips; no-op downgrade/maxspeed faults eligible; Worst printed node ids; Makefile one-liner); Codex fixed all 5, Claude re-checked: `make test` 107 passed, `make lint` clean. Real-data what-if run and map check by Claude; findings A–C in Current state. Codex's original note: No NorCal extraction, suite, demo or browser visual check was run. `make -n demos SNAPSHOT=261027` and `make -n faults SNAPSHOT=town_v1` produced the intended commands; dry runs only. No network calls.
- **Gotchas:** Review-fix verification initially caught an incorrect new CLI expectation (+1.5 vs actual +1.2 min) and import ordering; corrected before the final passing checks above. The requested default-threshold CLI correctly prints no affected trips: only T1 uses way 51 on OLD (50→51→52), and its bridge detour does not reach 120 seconds. A separate CLI test uses slow_seconds=10 and pins `Trip T1: slowed` and the matching root cause, including nonempty report/GeoJSON output. Report date rendering needed a non-date label fallback for required `town_v1` / `+what-if` reports; GeoJSON accepts missing labels in legacy minimal test payloads. Initial full tests exposed that compatibility issue and it was fixed within report.py. Sampling refuses N when there are insufficient distinct eligible targets; no silent duplicates. Manually provided colliding targets close a batch early; sampled suites have globally distinct modified ways and thus full groups of ten except the remainder. No out-of-list source file was needed or edited. PROGRESS.md is updated as explicitly requested. Pre-existing PLAN.md changes were left untouched; docs/DESIGN.md was not edited. No staging or commits.
- **Commit commands (Jared, after Claude review):**

```sh
git add sql/faults/delete_way.sql sql/faults/delete_bridge.sql sql/faults/flip_oneway.sql sql/faults/add_oneway.sql sql/faults/disconnect_node.sql sql/faults/bad_maxspeed.sql sql/faults/downgrade_class.sql src/route_impact/faults.py src/route_impact/cli.py src/route_impact/impact.py src/route_impact/report.py site/index.html config/demo_faults.toml Makefile tests/fixtures/town_trips.csv tests/test_faults.py PROGRESS.md
git commit -m "Add fault injection suite and what-if routing"
```

### 2026-10-28 — Step 8: review fix-up
- **Agent:** Codex
- **Did:** Addressed Claude's review findings 1–3: corrected the report map URL to `/route-impact/site/`, skipped empty trip paths in GeoJSON while retaining the error for culprit ways with fewer than two nodes, and formatted popup delay minutes to one decimal while preserving unreachable for null. Added exact map-link and empty-old-path regression assertions, including written feature counts, roles, coordinates, and malformed culprit rejection.
- **Changed:** `src/route_impact/report.py`, `site/index.html`, `tests/test_report.py`, `PROGRESS.md`.
- **Verify:** Final actual output; both commands exited 0:

```text
$ PYENV_VERSION=3.11.14 .venv/bin/python -m pytest -q
........................................................................ [ 97%]
..                                                                       [100%]
74 passed in 6.97s
$ .venv/bin/ruff check . && .venv/bin/ruff format --check .
All checks passed!
26 files already formatted
```

- **Review (Claude, 2026-10-28):** Verify rerun: 74 passed, ruff clean. `report.py:105` link now `/route-impact/site/?date=`; `report.py:142` skips empty paths; `index.html:48` uses `toFixed(1)`. All three findings closed. Step 8 done.
- **Gotchas:** Initial formatting check required wrapping the exact-link assertion; formatted the allowed test file and reran both Verify commands successfully. No browser check performed for popup formatting. Only the four authorized files were edited; existing Step 8 changes in other files were preserved. No staging or commit performed; PLAN.md and docs/DESIGN.md were not edited.

### 2026-10-28 — Step 8: Report, GeoJSON, results map
- **Agent:** Codex
- **Did:** Added pure Markdown rendering, batched snapshot geometry export, report generation inside the impact temporary-database lifetime, and a Markdown-only report CLI. Added Makefile report/map targets and corrected the what-if stub to Step 9. Added the static Leaflet map with pinned CDN assets and SRI, relative source/date validation, safe DOM popups, OSM attribution, route/culprit styling, bounds fitting, and load/empty messages. Added offline fixture, tag-shape, CLI preservation, and exact snapshot/fallback geometry checks.
- **Changed:** `src/route_impact/report.py` (new), `src/route_impact/cli.py`, `Makefile`, `site/index.html` (new), `tests/test_report.py` (new), `PROGRESS.md`.
- **Verify:** Final actual output, offline, both commands exited 0:

```text
$ PYENV_VERSION=3.11.14 .venv/bin/python -m pytest -q
........................................................................ [ 98%]
.                                                                        [100%]
73 passed in 6.76s
$ .venv/bin/ruff check . && .venv/bin/ruff format --check .
All checks passed!
26 files already formatted
```

- **Review (Claude, 2026-10-28):** Verify rerun: 73 passed, ruff clean. Manual map check in the in-app browser, fixture town_v1→town_v2 served over `http.server`: 14 features drawn (5 old paths, 4 new, 4 culprit ways, 1 node point), Leaflet SRI loads, culprit popups show before/after tags and the OSM link, trip popups show status and delay, `?src=//example.com/…` and a missing `?date=` show the error box. Findings:
  1. `src/route_impact/report.py:105` — the map link `…/route-impact/?date=` points at the Pages root, but `site/index.html:73` fetches `../results/<date>/`, which only resolves when the page is at `/route-impact/site/`. Fix the link to `…/route-impact/site/?date=`; Step 11 publishes the repo root to Pages.
  2. `src/route_impact/report.py:192-193` — an affected trip with an empty path (both ends snapped to one OLD vertex) raises, which makes the whole `impact` run exit 2 after impact.json is written. Skip that feature instead.
  3. `site/index.html:48` — the delay isn't rounded (`1.529 min`). Show one decimal.
  4. (accepted) The mockup's graph V/E and ways added/deleted lines are omitted because impact.json lacks them. Add them when a step touches `impact.py`.
- **Gotchas:** Graph vertex/edge counts and ways added/deleted/modified are omitted because impact.json does not contain those measurements. Null delay for a broken trip is displayed as unreachable rather than a numeric minute value. The first lint run found two ISC004 string-concatenation style errors, corrected before the final verification above. `ROUTE_IMPACT_DUMP_DIR` optionally copies the fixture impact.geojson to a stable directory for manual map checks; default is off (run `ROUTE_IMPACT_DUMP_DIR=<directory> PYENV_VERSION=3.11.14 .venv/bin/python -m pytest -q tests/test_report.py::test_fixture_report`, then serve a root containing that directory and use `site/?src=<relative-path>/impact.geojson`). Leaflet and map tiles require browser network access; no browser/network validation was performed in the sandbox. No changes to PLAN.md, docs/DESIGN.md, impact.py, rootcause.py, or expected.json; no staging or commit performed.

### 2026-10-28 — Step 7: review fix-up
- **Agent:** Codex
- **Did:** Resolved review findings 1–4: candidate-free affected trips are unexplained; slowed counterfactual routing uses old_seconds + slow_seconds as its Dijkstra limit, while broken trips remain unbounded; the mixed-cause test requires fixture origins; shared towns and thresholds fixtures now live in conftest.py.
- **Changed:** `src/route_impact/rootcause.py`, `src/route_impact/graph.py`, `tests/test_rootcause.py`, `tests/test_impact.py`, `tests/conftest.py` (new), `PROGRESS.md`.
- **Verify:** Actual output, offline, both commands exited 0:

```text
$ PYENV_VERSION=3.11.14 PATH="$PWD/.venv/bin:$PATH" make test
python -m pytest
============================= test session starts ==============================
platform darwin -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0
rootdir: /Users/jarednarvaez/route-impact
configfile: pyproject.toml
collected 69 items

tests/test_extract.py ......                                             [  8%]
tests/test_graph.py .............                                        [ 27%]
tests/test_impact.py .............................                       [ 69%]
tests/test_rootcause.py ..............                                   [ 89%]
tests/test_smoke.py .                                                    [ 91%]
tests/test_trips.py ......                                               [100%]

============================== 69 passed in 5.90s ==============================
$ PYENV_VERSION=3.11.14 PATH="$PWD/.venv/bin:$PATH" make lint
ruff check . && ruff format --check .
All checks passed!
24 files already formatted
```

- **Review:** Awaiting Claude's independent review; Codex implemented these fixes.
- **Gotchas:** Recovery remains strict: restored delay exactly slow_seconds stays candidate; tests cover below/at/above the boundary and assert the slowed routing limit. Candidate-free tests cover both the all-empty early return and a mixed batch with another trip's edit. Direct restoration checks verify inclusive Dijkstra limits and infinity beyond the limit. Existing fixture scope and test behavior are preserved. No full-size NorCal performance run. Current state, PLAN.md and docs/ were not changed; no staging or commit performed.

### 2026-10-28 — Step 7: Root cause with counterfactual confirmation
- **Agent:** Codex
- **Did:** Added pure edit grouping and one roads-info loader; indexed candidate restoration sets once across affected trips; restored OLD edges into a copy of NEW's CSR with minimum-cost parallel union and attachment-point splitting of compressed NEW runs. One Dijkstra per candidate confirms recovery. Added per-trip confirmed/joint labels, ranked culprits and candidates, before/after metadata, disconnected-node descriptions and OSM links. Passed explicit snapshot labels from CLI, preserved integer weights with validation, and included measured share and threshold in the HIGH rule.
- **Changed:** `src/route_impact/rootcause.py` (new), `tests/test_rootcause.py` (new), `src/route_impact/impact.py`, `src/route_impact/graph.py`, `src/route_impact/risk.py`, `src/route_impact/cli.py`, `tests/test_impact.py`, `PROGRESS.md`.
- **Verify:** Actual final output, repo venv and Python 3.11.14, offline:

```text
$ PYENV_VERSION=3.11.14 PATH="$PWD/.venv/bin:$PATH" make test
python -m pytest
============================= test session starts ==============================
platform darwin -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0
rootdir: /Users/jarednarvaez/route-impact
configfile: pyproject.toml
collected 64 items

tests/test_extract.py ......                                             [  9%]
tests/test_graph.py .............                                        [ 29%]
tests/test_impact.py .............................                       [ 75%]
tests/test_rootcause.py .........                                        [ 89%]
tests/test_smoke.py .                                                    [ 90%]
tests/test_trips.py ......                                               [100%]

============================== 64 passed in 6.19s ==============================
$ PYENV_VERSION=3.11.14 PATH="$PWD/.venv/bin:$PATH" make lint
ruff check . && ruff format --check .
All checks passed!
23 files already formatted
```

- **Review:** Pending Claude; Codex implemented this step and does not provide independent approval.
- **Gotchas:** No full-size NorCal run or performance measurement. Counterfactual union deliberately retains NEW directions alongside restored OLD directions. Two independently sufficient slowdowns remain joint/candidate when neither single restore brings delay below the threshold. Tests search fixture OLD origins for a way-41 path to node 401 and fall back to a small synthetic graph only if none exists. Additional checks cover zero-cost edges, minimum parallel cost, multiple interior attachments, directionality and unchanged NEW CSR. Initial lint found fixture-import naming issues; resolved before the clean final run above. Existing PLAN.md edits and docs were left untouched; no commit or staging performed.
- **Review:** Claude — Verify rerun independently: `make test` → 64 passed; `make lint` → clean. Mixed-cause test takes the fixture branch (origins 300, 301, 302, 310, 320 reach 401 via way 41). Findings: (1) `rootcause.py:133-135,191` an affected trip with no candidate edits (e.g. a fallback-snap-only slowdown) is labelled `joint` with empty `edits` — should be `unexplained`; (2) `graph.py` `restored_seconds` runs an unbounded Dijkstra per check — for slowed trips pass `limit=old_seconds + slow_seconds`; NorCal cost unmeasured; (3) `test_rootcause.py:132-137` synthetic fallback is dead code — assert fixture origins exist instead; (4) `test_rootcause.py:5` imports `test_impact` via pytest rootdir path — move shared fixtures to `tests/conftest.py`; (5) `edit_details` tag shape differs for way edits (dict) vs node edits (way→tags) — Step 8 report must handle both. (6) `rootcause.py:143-145,157-159` full Python scans of OLD roads / NEW edges run once per impact run — fine for fixtures, time it in Step 11.

### 2026-10-28 — Step 6: Impact
- **Agent:** Codex
- **Did:** Added requested-pair batched routing without changing `shortest`; coordinate snapping on OLD's LSCC, NEW node identity/full-graph routing and bounded fallback; directed segment cost diff over all NEW edges; incremental/full comparison, affected paths, split metrics, provisional thresholds, ordered risk rules and 0/1/2 CLI exits. CLI extracts each snapshot into a fresh temporary DB and writes sorted deterministic JSON. Added offline fixture, island, split, full/incremental, fallback, threshold-boundary, metrics, deterministic serialization and CLI error tests.
- **Changed:** `src/route_impact/impact.py`, `src/route_impact/risk.py`, `config/thresholds.toml`, `src/route_impact/graph.py` (only added `route_pairs`), `src/route_impact/cli.py`, `Makefile` (impact target/help only), `tests/test_impact.py`, `PROGRESS.md`.
- **Verify:** Actual output (venv prepended to PATH for Make):

```text
$ PATH="$PWD/.venv/bin:$PATH" make test && PATH="$PWD/.venv/bin:$PATH" make lint
python -m pytest
============================= test session starts ==============================
platform darwin -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0
rootdir: /Users/jarednarvaez/route-impact
configfile: pyproject.toml
collected 48 items

tests/test_extract.py ......                                             [ 12%]
tests/test_graph.py .............                                        [ 39%]
tests/test_impact.py ......................                              [ 85%]
tests/test_smoke.py .                                                    [ 87%]
tests/test_trips.py ......                                               [100%]

============================== 48 passed in 5.30s ==============================
ruff check . && ruff format --check .
All checks passed!
21 files already formatted
$ .venv/bin/route-impact impact --old 261026 --new 261027; echo "exit=$?"
impact: Snapshot file not found: data/norcal-261027.osm.pbf
exit=2
$ /usr/bin/time -l .venv/bin/route-impact impact --old 261026 --new 261027; echo "exit=$?"
impact: Snapshot file not found: data/norcal-261027.osm.pbf
        0.40 real         0.33 user         0.06 sys
time: sysctl kern.clockrate: Operation not permitted
exit=1
$ cat data/norcal-261027.osm.pbf.md5 data/norcal-latest.osm.pbf.md5
20ae2f1079e766989b07bd228297cf4d  norcal-261027.osm.pbf
20ae2f1079e766989b07bd228297cf4d  norcal-latest.osm.pbf
$ md5 -q data/norcal-latest.osm.pbf
20ae2f1079e766989b07bd228297cf4d
$ git diff --check
```

  Full-size comparison: invoked `.venv/bin/python -u` with temporary symlinks named `norcal-261026.osm.pbf` (to the dated OLD file) and `norcal-261027.osm.pbf` (to checksum-verified `norcal-latest.osm.pbf`). The wrapper called `main(["impact", "--old", "261026", "--new", "261027", "--data-dir", str(folder), "--results-dir", str(folder / "results")])`, timed the whole call using `time.perf_counter()`, and read `resource.getrusage(resource.RUSAGE_SELF).ru_maxrss`. Actual output:

```text
LOW LOW: no rule fired broken=0 slowed=0 output=/var/folders/4m/7y2d1r2x06vbmf36cx2vpzt80000gn/T/route-impact-verify-1hvsznc8/results/2026-10-27/impact.json
exit=0
wall_seconds=397.21
peak_rss_bytes=7984971776
```

  The temporary input/output directory was cleaned up. A byte-for-byte copy of the actual output is retained at `/tmp/route-impact-step6-impact.json` (not a repository change). This verifies the checksum-identical 261026→261027 data, while the exact default-path command remains blocked by the missing dated filename. The requested `/usr/bin/time -l` peak-RSS measurement remains unavailable under the sandbox; the measured Python resource value above is the fallback, not output from `time -l`.
- **Review (Claude, 2026-10-28):** **PASS.** Reran `make test` (48 passed) and `make lint` (clean) myself. The fixture tests cover every PLAN Verify item: T1–T4 slowed and T5 broken with reason `unreachable` (node 401 kept, full-graph routing, no fallback); split → 0 changed segments / LOW; self → LOW, exit 0; incremental == full over *all* trips on all three pairs; deterministic bytes. Codex's real run: 29 changed segments on trip paths, 142 trips rerouted of 5,660, 0 broken, 0 slowed → LOW. Findings (none blocking):
  1. `data/norcal-261027.osm.pbf` was missing (only `norcal-latest`). Claude APFS-cloned it (`cp -c`, md5 `20ae2f10…` matches the `.md5`) and reran the exact Verify command:
     ```text
     $ /usr/bin/time -l .venv/bin/route-impact impact --old 261026 --new 261027; echo "exit=$?"
     LOW LOW: no rule fired broken=0 slowed=0 output=results/2026-10-27/impact.json
           386.67 real       412.20 user        13.18 sys
               7811842048  maximum resident set size
               8535332416  peak memory footprint
     exit=0
     ```
     `results/2026-10-27/impact.json`: changed_segments=29, rerouted=142, broken=0, slowed=0. These match Codex's symlink run exactly.
  2. Peak RSS ≈ 8.0 GB (two graphs plus KD-trees), up from 4.55 GB for one graph. Under the 12 GB budget, but check it against the GitHub runner's memory in Step 11.
  3. `impact.py:103`: `weight` is parsed as a float, so `impact.json` writes gravity weights as floats (`5.7e10`-style). Emit ints. Fold into Step 7 (it edits `impact.json`).
  4. `risk.py:41`: the HIGH share rule's message doesn't state the share or the threshold. Say e.g. "0.62% ≥ 0.50%". Fold into Step 7.
  5. `impact.py:309`: `old`/`new` labels come from the DB file stem, which ties them to the CLI's naming. Pass the labels explicitly when Step 7/9 call `compute_impact`.
  6. Incremental == full is checked on fixtures only, not on NorCal. Step 9 scores it on the real graph.
  7. `risk.py:16`: `high_local_broken` is typed `int`, but the loader accepts 10.5. Trivial.
- **Gotchas:** The exact requested dated input `data/norcal-261027.osm.pbf` is absent. Its checksum matches the actual MD5 of `norcal-latest.osm.pbf`; an additional full-size run uses temporary dated symlinks and temporary results, leaving `data/` unchanged. `/usr/bin/time -l` is blocked from `sysctl kern.clockrate` and exits 1 itself, without printing peak RSS; the unwrapped CLI correctly returns 2 for the missing file. The additional run measures `perf_counter()` wall time and macOS `resource.getrusage(RUSAGE_SELF).ru_maxrss` in bytes instead. No network. `PLAN.md` already had edits at task start and was not touched; `docs/DESIGN.md` was not touched. Metric totals are at the top level, with `intercity`/`local` count and delay breakdowns; `gravity_share_high` is the HIGH rule's share. Risk is evaluated before JSON's required two-decimal rounding. Improvements are counted among rerouted trips; full mode additionally observes improvements on trips incremental mode skips, as DESIGN §5.6 permits. No commit.

### 2026-10-28 — Step 5: Fixed trip set
- **Agent:** Codex
- **Did:** Centralized city/box and local-trip defaults in `trips.py`, with an importable pure `filter_places` function. Added sorted ordered intercity pairs with integer gravity weights and unsnapped place coordinates; seeded uniform rejection sampling without replacement for local pairs from `build_graph(db).lscc()`. Generation uses a fresh temporary DuckDB, explicit threads/memory limits, deterministic CSV formatting, and one summary line. Wired the CLI and Make target with seed 2027. Added offline synthetic and Berkeley fixture tests.
- **Changed:** `src/route_impact/trips.py`, `src/route_impact/cli.py`, `Makefile`, `config/trips.csv`, `tests/test_trips.py`, `PROGRESS.md`.
- **Verify:** Actual output (timed the requested generation commands with `/usr/bin/time -p`; `real` is wall runtime in seconds):

```text
$ source .venv/bin/activate
$ make test && make lint
python -m pytest
============================= test session starts ==============================
platform darwin -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0
rootdir: /Users/jarednarvaez/route-impact
configfile: pyproject.toml
collected 26 items

tests/test_extract.py ......                                             [ 23%]
tests/test_graph.py .............                                        [ 73%]
tests/test_smoke.py .                                                    [ 76%]
tests/test_trips.py ......                                               [100%]

============================== 26 passed in 3.79s ==============================
ruff check . && ruff format --check .
All checks passed!
18 files already formatted
$ /usr/bin/time -p route-impact trips --snapshot latest --seed 2027 && shasum config/trips.csv
snapshot=data/norcal-latest.osm.pbf seed=2027 n_places=61 intercity=3660 local=2000 lscc_vertices_in_box=602267
real 47.70
user 65.87
sys 2.45
cc7e8452f04d0729e490d81f9b0f3ab50402fde5  config/trips.csv
$ /usr/bin/time -p route-impact trips --snapshot latest --seed 2027 && shasum config/trips.csv
snapshot=data/norcal-latest.osm.pbf seed=2027 n_places=61 intercity=3660 local=2000 lscc_vertices_in_box=602267
real 47.61
user 65.72
sys 2.36
cc7e8452f04d0729e490d81f9b0f3ab50402fde5  config/trips.csv
$ grep -c '^ic-' config/trips.csv; grep -c '^lo-' config/trips.csv
3660
2000
$ git diff --check
```

  Both SHA-1 hashes match. Found n = 61, so 61 × 60 = 3,660 intercity rows; 2,000 local rows. Full generation wall runtimes: 47.70 s and 47.61 s. Seed 2027 is recorded in the Makefile defaults and both summary lines.
- **Review (Claude, 2026-10-28):** Approved. Reran Verify: 26 passed, ruff clean, both runs hash `cc7e8452f04d0729e490d81f9b0f3ab50402fde5` (matches above). Summary line: n_places=61, intercity=3660, local=2000, lscc_vertices_in_box=602267. Measured with `/usr/bin/time -l`: 47.5 s wall, peak RSS 3.80 GB and 4.09 GB on the two runs. Scope: only the named files. Local sampling uses `graph.lscc()`, and `filter_places` is importable. Non-blocking findings: (1) `Makefile:2` `SNAPSHOT ?= latest` is a moving target, so a later `make trips` would silently replace the committed trips. The committed file comes from `norcal-latest` = **261027**, seed 2027. (2) `Makefile:2-3` puts the SNAPSHOT/SEED defaults at global scope, so they will also apply to `faults`/`bench` when those are implemented. Make them target-specific then. (3) `tests/test_trips.py:129`: the fixture has no place nodes, so `generate()`'s intercity path is only covered by unit tests plus the full run (n=61). (4) `cli.py:7` imports `trips` at module top, so `--version` also loads duckdb/scipy. Negligible.
- **Gotchas:** Berkeley sample has no place nodes, so its end-to-end test asserts empty intercity output while checking local LSCC endpoint membership and identical CSV bytes; synthetic city tests check ordering and exact gravity weights. Sampling is bounded at 100 batches of 100,000 draws and raises a clear error if it cannot fill the requested count. `scripts/feasibility.py:31-32` still hardcodes the city filter; it should import `filter_places`/constants in a later authorized step (outside this step's allowed files). `PLAN.md` and `PROGRESS.md` had pre-existing edits at the start; `PLAN.md` and `docs/DESIGN.md` were not edited. No commit.

### 2026-10-28 — Step 4: Road graph and fixture feasibility
- **Agent:** Codex
- **Did:** Added haversine directed segments, repeated-node/endpoint vertices, ordered segment runs, deterministic minimum-time parallel reduction before CSR construction, winning-edge lookup, on-demand LSCC, and batched shortest paths with requested times/segment paths (unreachable = inf/None). Validate NULL/non-positive/non-finite speeds and return the count of tagged speeds falling back under Step 3's parser. Added a temporary-DB feasibility script with spherical nearest-vertex city snapping, seeded local origin/target samples, phase timings, and platform-correct peak RSS.
- **Changed:** `sql/extract/segments.sql`, `src/route_impact/graph.py`, `scripts/feasibility.py`, `tests/test_graph.py`, `PROGRESS.md` (log only; Current state unchanged).
- **Verify:** Actual output:

```text
$ .venv/bin/pytest tests/test_graph.py -q
.............                                                            [100%]
13 passed in 6.74s
$ .venv/bin/pytest -q
....................                                                     [100%]
20 passed in 2.65s
$ .venv/bin/ruff check . && .venv/bin/ruff format --check .
All checks passed!
16 files already formatted
$ .venv/bin/python scripts/feasibility.py tests/fixtures/town_v1.osm.pbf
extract_seconds=0.101
vertices=40 edges=108 reduced_edges=105 fallback_speed_roads=0 graph_seconds=0.028
city_places=0 city_origins=0 local_origins=40 targets=32 seed=2027 prepare_seconds=0.018
routes=1280 unreachable=69 routing_seconds=0.011
peak_rss_bytes=140034048 peak_rss_gb=0.140034
```

- **Review (Claude, 2026-10-28):** Approved. Reran the tests and lint, and the results match the output above. Haversine R matches the oracle. NULL, non-positive and non-finite speeds raise an error. Parallel edges are reduced before the CSR matrix is built. Checked that scipy keeps explicit zero-cost edges. Non-blocking findings:
  - The maxspeed regex is duplicated in `graph.py:70-80`.
  - `segments.sql:21-25` builds a `segments` table that nothing uses.
  - `graph.edges` keeps the parallel edges that lost.
  - Segments are Python objects. That is fine at 4.55 GB but is the first place to cut memory.

  **Full-graph Verify** (Claude, `/usr/bin/time -l python scripts/feasibility.py data/norcal-latest.osm.pbf`, norcal-latest = 261027):
```text
extract_seconds=18.881
vertices=726182 edges=1660020 reduced_edges=1646959 fallback_speed_roads=45 graph_seconds=26.341
city_places=61 city_origins=61 local_origins=2000 targets=32 seed=2027 prepare_seconds=1.498
routes=65952 unreachable=4631 routing_seconds=266.767
peak_rss_bytes=4545970176 peak_rss_gb=4.545970
      315.49 real       329.45 user         5.96 sys
```
  Peak RSS is 4.55 GB, under the 12 GB budget → **PASS**. 61 city places were found, matching the plan. The 4,631 unreachable routes come from sampling all vertices rather than the LSCC.
- **Gotchas (Codex, written before the full run):** Full-graph feasibility run is **NOT done**; `data/norcal-latest.osm.pbf` was not run. The < 12 GB full-graph budget remains unverified. Town has no qualifying city places, so its smoke run does not exercise city snapping. Routing requires vertex OSM ids and returns the requested source/target Cartesian product; the feasibility driver discards each batch's routes and samples 32 destination vertices by default (2,000 local origins, seed 2027). Segment seq is zero-based in original way order even when traveling in reverse. Initial lint reported EXE001 for the script's shebang without executable permission; fixed by setting its executable bit before the successful lint run above. All three town versions match oracle counts/times. Tests also cover invalid speeds, fallback counts, equal-time parallel tie-breaks, LSCC, empty graphs, and disconnected/source-to-self routing. No commit.

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
