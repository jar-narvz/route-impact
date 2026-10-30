# PROGRESS.md — route-impact

## Current state
- **Working on:** Phase 2, branch `playground`. P1a `b2edc58`, P1b `f638798`, P1c committed 2026-10-30 (see log). **P1 is done.** Stopped before P2: it needs Jared's decisions.
- **Next session, start here:**
  1. **Jared decides P2's open questions** before Claude writes P2's Files / Do / Verify (PLAN says every step gets that detail before Codex starts; P2 is still an outline):
     - Pages data: commit the export (9,663,640 B shipped at P0c-3) under `site/playground/data/`, or build it in a workflow? P1a left this "a P2 decision".
     - Whether `site/playground/spike/` and `scripts/playground_spike.py` are deleted in P2, or kept as the measured reference until launch.
     - The §5.8 Meteor attribution budget and its "attribution incomplete" fixture (deferred to P2 in PLAN P1): is it still needed now that CCH runs full attribution in ≤ 83 ms?
  2. Push `playground` so CI checks the new Node step (`actions/setup-node@v4`, Node 22) — P1c Verify asks for CI green on push. Not yet pushed.
  3. Then P2 (Nov 10–16), launch ~Nov 17.
  - **Workflow (Jared, 2026-10-30 02:45):** Codex is back from the 03:40 session: Codex implements and writes tests, Claude reviews. If Codex hits a quota error, fall back to a Claude implementer subagent + adversarial Claude reviewer subagent and say so in the log entry. (P1a–P1b used Claude subagents.)
  - **Overnight 2026-10-30 (Jared):** autonomous from 03:40 — Claude commits each finished step itself as Jared, no co-author line, no push. Stop with a note here on anything needing Jared's call.
  - Leftovers:
     - Follow-up (P1a review #4): the Earth radius is in both `config/playground.toml` and `impact.py` `Snapper`; make one the source.
     - Codex notes `site/playground/spike/p0b-verification.txt` and `p0c-verification.txt`, `p0c-memory-verification.txt` are untracked; don't commit them.
     - Old spike files still sit in `data/playground-spike/` (harmless).
     - Check the first scheduled daily run (`results/2026-10-29/` on `main`).
     - Resume bullets await Jared's wording approval.
- **Done:** design, plan critique, Steps 0–13 + 12b. Fault suite `0c73497`. Step 12 code `31098b6`, CI test fix `b052a34`, bench `533b05b`; impact results 23→27, README draft and Step 12 Verify committed 2026-10-29.
- **Earlier checklist (MVP wrap-up, 2026-10-29; superseded by "start here" above):**
  1. ~~Jared commits Step 12 results + README~~ — done 2026-10-29.
  2. ~~Step 13 approval~~ — Jared approved 2026-10-29; PLAN Step 13 marked done. Fresh-clone check done 2026-10-29: `git clone` of `e6a18ab` → new venv → `pip install -e ".[dev]"` → `make setup` → `make test` `181 passed in 37.09s`, `make lint` clean (same Mac, so `~/.duckdb` spatial and `osmium-tool` were already present); CI run 40961646981 on a clean runner: `181 passed in 55.06s`, lint clean.
  3. ~~Step 12b — json_safe rounding fix~~ — done 2026-10-29, uncommitted (see log).
  4. ~~Close test issues #1 and #2~~ — closed 2026-10-29 with a comment (Jared approved).
  5. Resume bullet: draft from README numbers once Jared approves the README.
- **Bench result (`results/2026-10-27/metrics.json`, commit `0beac5d`, git_dirty false, M3 Max, 36 GB, threads 2, memory_limit 2GB):** wall 448.46 s, pipeline total 438.23 s, peak RSS 9797926912 B. Phases: extract 18.31/18.85, graph 26.33/30.20, prepare 23.88/20.76, route 299.54, diff 0.34, root_cause ~0 (nothing affected), count 5.92 (outside total). 655 MB pbf; 79670984 nodes, 7763376 ways, 85234 relations; 535394 drivable ways; graph 726182 vertices / 1660020 edges; LSCC 716812. LOW, 0 broken, 0 slowed of 5660 trips.
- **Fault suite result (`results/faults/261027/scores.json`, N=200, seed 2027, full check every 10th run):** incremental==full 22/22; root cause single 355/355 and batch 355/355 trips; joint 0/0; impact rate 19/200 (9.5%, "network redundancy, not accuracy"). 220 runs (200 single + 20 batches of 10). Setup: extract 18.19 s, baseline 309.80 s; mean run 125.96 s single / 125.05 s batch. Log: 29322.42 s real, 13977993216 B max RSS. README caveat: the 355 trips come from only 19 faults, so the trips aren't independent tests; batch and single share the same 355 because the batches regroup the same 200 faults.
- **Earlier notes (kept for reference):**
  - **Step 10 — CI.** Done 2026-10-29: run 40838310758 green (`132 passed in 49.57s`), badge shows "passing". Commits `c72c53c` + `eaf1149`.
  - **Step 11 — Daily job.** Written and reviewed, offline checks pass (2026-10-29). Waiting on Jared: commit + push, set Settings → Pages → Source = GitHub Actions, then the three dispatches in PLAN Step 11 Verify (a: 2026-10-28, then 2026-10-27 → "already done"; b: test_high; c: 2099-01-01). In dispatch (a), read the run's duration and confirm it wasn't OOM-killed: GitHub's 16 GB runner vs the ~7.8–8.5 GB peak is still unverified.
  - **Step 12 — code only.** `metrics.py`, `scripts/bench.sh` and `scripts/check_outputs.py` can be written now.
  - **Step 13 — README text.** Can be drafted now, with fault numbers left blank.
  - **While the fault suite runs, do not:** run `make bench` or the four impact runs (they skew both timings; run them after it finishes); edit `faults.py`, `impact.py`, `rootcause.py`, `graph.py`, `extract.py` or `sql/` (a crash-resume would mix code versions); commit `results/faults/261027/` before `scores.json` exists.
  - **Fault run started (Claude, 2026-10-28 16:09:54):** `nohup caffeinate -i /usr/bin/time -l .venv/bin/route-impact faults --snapshot 261027 --n 200 --seed 2027 --full-check-every 10 > data/fault-run-261027.log 2>&1 &` from code `3200567`. Writes `results/faults/261027/{faults.json,progress.jsonl,scores.json}`. Other sessions may edit PROGRESS.md again.
    - **Check progress:** `pgrep -fl "route-impact faults"` (running?) and `wc -l results/faults/261027/progress.jsonl` (done at 220). Done when `scores.json` exists and the log ends with `/usr/bin/time` output.
    - **Expected finish:** about 23:00–00:30. Estimated from the rehearsal (setup 330.3 s; unchecked run ~85 s; a full check adds ~300 s, ×22). Not measured.
    - **If it died:** rerun the same command without `--fresh`; it resumes from `progress.jsonl`. If the last progress line is truncated, delete that one line first.
    - **Rehearsal that passed (n=10, scratchpad):** 1889.29 s real, 12461473792 B max RSS; full-checked runs [0, 10], incremental==full 2/2, root cause single 8/8, batch 8/8, impact rate 1/10.
    - **Finished 2026-10-29 00:18**, 220/220; committed `0c73497`. Numbers are under "Fault suite result" above.
  - **Step 9b real-data checks (Claude, 2026-10-28; outputs in the session scratchpad, not `results/`):**
    - Bay Bridge what-if (10 ways): 667.68 s real, 7794311168 B max RSS; impact.json 374,105 B, impact.geojson 1,942,107 B (25 of 349 trips). Still 348 joint / 1 confirmed: the undeleted Yerba Buena tunnel splits each route into two separate runs. Jared, 2026-10-28: keep both spans. DESIGN §5.7 and the PLAN 9b Verify now note this.
    - `route-impact faults --snapshot 261027 --n 10 --seed 2027`: 4873.03 s real, 12240011264 B max RSS, 11 runs (10 single + 1 batch). Setup: extract 17.9 s, baseline 307.4 s. Per run mean 410.2 s, of which compare_full 73.6%, new_graph 17.9%; apply 0.1–0.3 s; root cause ≤ 5.7 s. Scores: incremental==full 11/11, root cause single 8/8 and batch 8/8 (all 8 trips from one fault), impact rate 1/10.
    - Implication: the in-memory fault design would save at most the new_graph share (17.9%). The full-recompute check dominates. Projected Step 12 (setup + runs × measured means): N=200 all-full 25.2 h · full on every 10th run 8.6 h; N=100 12.6 h / 4.3 h; N=50 6.4 h / 2.2 h. Impact rate 1/10 means few faults produce scored trips — the root-cause denominator will be small.
  - **Watch:**
    - Peak RSS ≈ 8 GB for a full impact run (two graphs); root cause adds one O(E) CSR copy per candidate check plus one Python pass over OLD roads and NEW edges per run — unmeasured on NorCal. Time both in Step 11.
    - Two independent slowdowns that each exceed `slow_seconds` are labelled `joint`; after Step 9b only if they are not contiguous on the OLD path (DESIGN §5.7).
    - `scripts/feasibility.py:31-32` still hardcodes the city filter. Switch it to `trips.filter_places` when a step names that file.
  - **Follow-ups (not blocking):** remove the unused `segments` temp table (`segments.sql:21-25`). Have Step 3 emit a `speed_source` column so `graph.py:70-80` stops duplicating the maxspeed parser.
  - **Still open from earlier reviews:**
    - `extract()` finds `sql/` and `config/` via the source checkout (`parents[2]`), so it needs the editable install (`ci.yml` uses `pip install -e`; Step 11's workflow must too).
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

### 2026-10-30 — P1c: JS core promoted + `node --test` against the oracle
- **Agent:** Codex (`codex exec --sandbox workspace-write`, ~4 min), Claude review + a one-line loader fix, Claude reran Verify. Overnight autonomous run; Claude committed as Jared.
- **Did:** Moved `cch.js`, `procedure.js`, `engine.js` into `site/playground/core/` and the two test suites, `dijkstra.mjs` and `grid6_order.json` into `site/playground/core/test/`. Changed only the import paths in the spike files. New `load.mjs`: a generic export loader that checks the sha256 and length of each array; presets are optional. New `oracle.test.mjs`: every `tests/fixtures/playground/<case>/` gives the same `canonical()` result as the oracle's `expected.json`. `procedure.js` changes: numeric run-tuple sort and rows sorted by trip in `canonical()`; Meteor hit test rewritten in the oracle's `segment_distances2` order of operations (`k = R*π/180`, the segment as a difference of scaled points, `cx*cx+cy*cy <= r*r`), with R taken from `meta.earth_radius_m` (6371008.8 fallback only for the format-0 spike data, which lacks the key); duplicate way ids rejected. Makefile `test-js` (`make test` = pytest, then test-js). CI: `actions/setup-node@v4` Node 22. AGENTS.md Test line (Claude).
- **Changed:** `site/playground/core/{cch.js,engine.js,procedure.js,load.mjs}`, `site/playground/core/test/{cch.test.mjs,procedure.test.mjs,dijkstra.mjs,oracle.test.mjs,fixtures/grid6_order.json}` (renames from `site/playground/spike/`), `site/playground/spike/{worker.js,measure.js,check.mjs,cch_bench.mjs}`, `Makefile`, `.github/workflows/ci.yml`, `AGENTS.md`, `PLAN.md` (P1c status only), `PROGRESS.md`.
- **Verify (Claude reran):**
  - `make test-js` → `# tests 47` `# pass 47` `# fail 0` (12 oracle fixtures + duplicate-id + Meteor-at-r + run-sort tests + the moved suites).
  - `node site/playground/spike/check.mjs` → `All 34 cases identical; Python presets identical. Drift: {"affected_set":0,"classification":0,"baseline_path":0,"candidate_sets":0,"confirmed_attribution":0,"added_ms":6}`.
  - `node --expose-gc site/playground/spike/cch_bench.mjs` → `{"after_load_rss":199950336,"after_50_rss":259555328,"growth":59604992}`; `data/playground-spike/cch_engine_node.json`: `peak_load_rss_bytes` 209764352, `memory_gate_pass: true` (limit 300000000).
  - `make test` → `264 passed in 37.16s` then JS 47/47; `make lint` → `All checks passed!` / `46 files already formatted`.
  - CI on push: **not run** (not pushed).
- **Review (Claude, diff + PLAN P1c):**
  1. *Fixed:* Codex stopped with every fixture failing `Order hash mismatch`. My brief required checking `cch_order.bin.gz` against the manifest's `output_sha256`, but the identity-order fixtures have no such field. `load.mjs` now checks the hash when the manifest has one; otherwise it requires `method == "identity"` and an order that really is 0..n−1. `meta.files` still checks the gzip's sha256 either way.
  2. *Fixed:* Codex wrote its blocker notes to `site/playground/core/P1C_NOTES.md` (not a named file). Deleted.
  3. No other findings. The scope matches the file list; spike edits are import paths only; the Meteor order matches the oracle line by line; the duplicate check runs before the Flip one-way check, the same order as the oracle.
- **Gotchas:** Codex's sandbox can't write `.git/index`, so its `git mv` went to a temporary index. Claude staged the renames, and git detects them as renames. `node --test` with a quoted glob needs Node ≥ 21.

### 2026-10-30 — P1b: Python oracle (`route-impact playground-oracle`)
- **Agent:** Claude subagent (code + tests, two passes); adversarial Claude subagent (review + fuzz); Claude (reran Verify)
- **Did:**
  - `src/route_impact/playground_oracle.py` was written from the PLAN spec (canonical-v1 table) without reading `procedure.js`. It reads the shipped arrays with hash checks and applies a Stomp, Flip, Meteor or compound edit as a mask change.
  - The initial edit gets a full recompute of every trip (scipy, origin chunks of ≤ 64). A two-sided check against the path-rule candidates follows: Flip may make untouched trips faster (§5.4); Stomp and Meteor may not change them at all.
  - Counterfactuals (uncapped §5.8: singles, then maximal runs) reroute only the affected trips.
  - CLI: `playground-oracle --data DIR (--case JSON | --stress FILE --output OUT [--jobs N] | --write-presets)`. `--write-presets` refuses format 0.
  - 12 hand-built fixtures in `tests/fixtures/playground/`, built by `tests/build_playground_fixtures.py` through P1a's `write_export`.
- **Changed:** `src/route_impact/playground_oracle.py` (new), `src/route_impact/cli.py`, `tests/build_playground_fixtures.py` (new), `tests/test_playground_oracle.py` (new, 67 tests), `tests/fixtures/playground/**` (new, 12 directories, 116 KB), `PLAN.md`, `PROGRESS.md`.
- **Verify (Claude reran):**
  - `make test` → `264 passed in 39.09s`; `make lint` → `All checks passed!`, `46 files already formatted`.
  - Real data (local): `/usr/bin/time -l route-impact playground-oracle --data data/playground-spike --stress results/playground/stress_set.json --output <scratch>`, before the fixes: 256.89 s real, 571,506,688 B max RSS (parent process only).
  - Claude's own comparison, with the numeric run sort on both sides: `34/34 equal` to `reference-ms.json` (818 affected rows, 601 with confirmed runs).
  - After the fixes, the implementer's run gave 265.32 s and `34/34` again by Claude's script. Presets `bay_bridge` and `university_ramp` match the spike's `presets.json` by canonical shape (implementer's comparison).
- **Review (adversarial Claude):** 7 findings, none blocking. The reviewer fuzzed ~600 random graphs against its own brute-force version: 0 mismatches.
  - Fixed:
    - #2 `--write-presets` overwrote format-0 directories;
    - #3 no multi-way Flip or duplicate-run fixtures (added `flip_pair`, `repeated_run`, and a test for a single plus a run on one row);
    - #4 the full-recompute check was one-sided;
    - #6 stress-run errors lacked case ids, duplicate ids collapsed silently, and the export reloaded per case (now once per worker);
    - #7 swapped lat/lon was accepted (taps outside the box now raise), twins weren't validated at load (`check_twins` added), and two wrong test comments.
  - JS side, moved to P1c in PLAN: #1, the Meteor floating-point order differs from JS by 1 ulp in `k`, so JS switches to the oracle's order; #5, duplicate way ids are rejected in JS too.
- **Deviations:**
  - `--jobs` and `--output` are beyond the PLAN's CLI signature: a process pool, because scipy's Dijkstra holds the GIL.
  - Each worker process keeps the export in a `functools.cache` set up by the pool initializer. That is per-process state, accepted against AGENTS.md's "no global state" because the pool needs it.
  - Presets also carry `drawn` (the first 25 non-broken rows), matching the spike.
- **Gotchas:**
  - Each worker uses ~184 MB on the Bay export, so 8 workers is ~1.5 GB.
  - Spike `meta.json` (format 0) has no `earth_radius_m`; for format 0 only, the oracle falls back to the toml.
  - `du` shows the fixtures as 1.2 MB because of block size; the content is 116 KB.
- **Commit (Jared):**
  - `git add src/route_impact/playground_oracle.py src/route_impact/cli.py tests/build_playground_fixtures.py tests/test_playground_oracle.py tests/fixtures/playground PLAN.md PROGRESS.md`
  - `git commit -m "Add playground oracle: full recompute + uncapped attribution (P1b)"`

### 2026-10-30 — P1a: production exporter (`route-impact export-playground`)
- **Agent:** Claude subagent (code + tests, two passes); adversarial Claude subagent (review); Claude (plan, reran Verify)
- **Did:**
  - Ported the spike exporter into `src/route_impact/playground.py`: format v1, constants in `config/playground.toml` (copied into `meta.json`), and a shared `write_export` writer that P1b will reuse.
  - CLI: `route-impact export-playground --snapshot YYMMDD --db PATH [--trips] [--out] [--order routingkit|identity] [--config] [--thresholds] [--demo-faults]`.
  - The output is written to a temp directory and swapped into place only on success. Git state and the RoutingKit binary are checked before the graph build, and `meta.json` records `git_commit` and `git_dirty`. The DuckDB file is opened read-only.
- **Changed:** `src/route_impact/playground.py` (new), `src/route_impact/cli.py`, `config/playground.toml` (new), `tests/test_playground_export.py` (new, 16 tests), `PLAN.md` (P1 sub-steps, Review log, status), `PROGRESS.md`.
- **Verify (Claude reran):**
  - `make test` → `197 passed in 38.30s`; `make lint` → `All checks passed!`, `43 files already formatted`.
  - Real export: `route-impact export-playground --snapshot 261027 --db data/playground-spike/261027.duckdb --out <scratch>/p1a-claude --order routingkit`, exit 0, 2:14.77. Counts: 213,910 vertices, 551,760 edges, 2,057 trips, 3,603 excluded; `TOTAL shipped: 9651695 B`.
  - Claude's own hash script: `21/21 match` against the spike's `meta.json`: all 17 arrays, `cch_order.bin.gz`, `way_names`, `trip_labels`, `excluded_trips`. The post-fix export (`p1a-export2`) also gives `21/21`. Its shipped total is 9,651,716 B, because `meta.json` gains `git_dirty`.
- **Review (adversarial Claude):** 8 findings, none blocking.
  - Fixed:
    - #1 non-atomic output;
    - #2 late git and binary checks, plus no dirty flag;
    - #3 untested `--data-dir` and auto-extract (removed; `--db` is now required);
    - #5 weak CSR assertions;
    - #6 `round_ms` exact-half pair (added 0.0025 → 3);
    - #8 the west-box LSCC check compared `cut_graph` with itself (now an independent scipy check).
  - Kept:
    - #4: the Earth radius lives in both the toml and `impact.py` `Snapper`. Fixing it needs `impact.py`, outside P1a, so it's a follow-up.
    - #7: the determinism test runs both exports in one interpreter. This is a recorded limitation; there's no dependency on hash order today.
  - Extra CLI flags `--config`, `--thresholds` and `--demo-faults` are a deviation from the spec, matching other subcommands; one CLI test covers `--config`.
- **Gotchas:**
  - The order hash matches only with this Mac's `data/cch_order` binary.
  - `--out` replacement deletes the old directory whole if it contains a `meta.json`; a non-empty directory without one is refused.
  - `make` needs the venv activated (`source .venv/bin/activate`).
- **Commit (Jared):**
  - `git add src/route_impact/playground.py src/route_impact/cli.py config/playground.toml tests/test_playground_export.py PLAN.md PROGRESS.md`
  - `git commit -m "Add export-playground: production Bay graph exporter (P1a)"`

### 2026-10-30 — P0c Verify: browser acceptance run
- **Agent:** Claude
- **Did:**
  - Served the spike with `scripts/serve_spike.py 8781`; I changed `.claude/launch.json` so the server sends the cross-origin isolation headers.
  - Cold-reloaded with the pane visible, then ran the full stress set: 50 toll-plaza edits first, then 36 cases × 5 repeats.
  - Saved `window.__summary` through a one-shot local POST receiver in the scratchpad, then composed `feasibility.json` with a gate evaluation.
- **Changed:** `results/playground/feasibility.json` (new), `PLAN.md` (P0c-3 status), `PROGRESS.md`.
- **Verify:** page status `Complete. All repeats match the integer reference.`; `gate_pass: true`.
  - Every case ≤ 2,000 ms: max median 82.69 ms (`bay_bridge_toll_plaza_500`).
  - Each file ≤ 5 MB: max gzip 2,850,841 B.
  - Transfer: 9,727,543 B = graph data 9,670,840 + spike code 56,703. Excluded: tiles, and the harness-only oracle files at 687,488 B. The page total is 10,415,031 B.
  - Cold load verified: true.
  - Page ready: 644.03 ms.
  - Memory: 261,603,328 B (Node fallback).
- **Gotchas:**
  - `measureUserAgentSpecificMemory` throws SecurityError in the Claude pane even when `crossOriginIsolated` is true.
  - MapLibre is cross-origin, so its transferSize reads 0 and it isn't counted.
  - Browser reset_ms rose from 48 → 1,298 ms over the run; the cause is unexplained and it's outside the gate.
  - The pane viewport was 248 px wide.
- **Commit (Jared):**
  - `git add results/playground/feasibility.json PLAN.md PROGRESS.md`
  - `git commit -m "Record P0c browser acceptance run: gate passed"`

### 2026-10-30 — P0c-3: worker memory fix
- **Agent:** Claude (diagnosis, brief, review, reruns); Codex (code + tests)
- **Did:**
  - Diagnosis: there was no leak. With `gc()` forced between samples, heapUsed stayed at 53.3 MB and ArrayBuffers at 196.6 MB across all 50 edits. The old +161 MB of RSS growth was GC lag. The real problem was the live footprint of ~250 MB:
    - precomputed triangles: 49.9 MB;
    - `saveBase` copy: 32.7 MB;
    - the procedure's `wayEdges` arrays and `wayIndex` Map: 48 MB of heap;
    - Set-based elimination temporaries during the topology build.
  - Fixes:
    - the engine uses on-demand triangles; on the real data the outputs were identical and the toll plaza went 65.1 → 66.2 ms;
    - reset now undoes the outstanding update logs (LIFO) instead of copying back a saved base, with a full re-customize as the fallback after an exception;
    - way→edges is a typed CSR, and OSM id lookup is a binary search over a sorted Float64Array (all 180,633 ids are unique, so this matches the Map);
    - `buildCCH` elimination uses typed linked lists with slot reuse instead of Sets;
    - the bench forces GC before each sample and records heap, ArrayBuffers and peak RSS.
- **Changed:** `site/playground/spike/{cch.js,engine.js,procedure.js,cch_bench.mjs,test/cch.test.mjs,test/procedure.test.mjs}`, `PROGRESS.md`.
- **Verify (Claude reran):**
  - `node --test site/playground/spike/test/*.test.mjs` → `tests 32, pass 32, fail 0`. Plain `node --test <dir>/` fails on Node 22.14, so use the glob.
  - `node --expose-gc site/playground/spike/cch_bench.mjs`:
    - `{"after_load_rss":207306752,"after_50_rss":261603328,"growth":54296576}`; `memory_gate_pass: true`;
    - live bytes 106,155,623 → 106,810,255;
    - peak load RSS 217,104,384 B;
    - triangle mode on-demand;
    - max median 75.15 ms (toll plaza 500 m).
  - `node site/playground/spike/check.mjs` → `All 34 cases identical; Python presets identical. Drift: {...,"confirmed_attribution":0,"added_ms":6}` (2:11.6).
  - `ruff check .` → `All checks passed!`; `ruff format --check .` → `41 files already formatted`.
- **Review (Claude):** no blocking findings.
  - The remaining +54 MB of RSS growth over 50 edits is allocator retention from update-log churn: live bytes grew only 0.65 MB.
  - Not done: a byte-level comparison of `first`/`upper` between the old and new `buildCCH` on the real data. Covered indirectly: all 34 stress cases are identical against the independent reference, and the fixture tests compare on-demand against precomputed triangles.
- **Gotchas:** browser worker memory (`measureUserAgentSpecificMemory`) is still unmeasured; that happens in the acceptance run.
- **Commit (Jared):**
  - `git add site/playground/spike/cch.js site/playground/spike/engine.js site/playground/spike/procedure.js site/playground/spike/cch_bench.mjs site/playground/spike/test/cch.test.mjs site/playground/spike/test/procedure.test.mjs`
  - `git commit -m "Cut CCH worker memory: on-demand triangles, log-based reset (P0c-3)"`

### 2026-10-29 — Step 12b: keep small fractions in impact.json
- **Agent:** Codex (code + tests, two passes); Claude (review, reruns, Verify)
- **Did:** `json_safe` now rounds finite floats to 6 significant digits instead of 2 decimals. Review found `report.md` relied on the old rounding (`share * 100:g` printed `55.5556%`), so Step 12b's Files were extended to `report.py` + `tests/test_report.py` and the share now prints with `:.3g` (`55.6%`, `0.00383%`). Downloaded 261028 and reran all five days.
- **Changed:** `src/route_impact/impact.py`, `tests/test_impact.py`, `src/route_impact/report.py`, `tests/test_report.py`, `results/2026-10-2{4,5,6,7,8}/impact.json`, `PLAN.md`.
- **Verify:**
  - `pytest tests/test_impact.py -q` → `39 passed in 2.04s`; `make test` → `181 passed in 35.98s`; `make lint` → `All checks passed!`, `37 files already formatted`.
  - Reruns 23→24 … 27→28 (log `data/impact-rerun-12b.log`): all `LOW LOW: no rule fired broken=0 slowed=0`, `exit=0`.
  - `python scripts/check_outputs.py results/ --expect-impact 4` → `Summary: metrics=1 impact=5 scores=1 failures=0`.
  - `git diff results/`: 5 files, 1 line each — `"high_slowed_share": 0.01` → `0.005`. No other change (report.md and impact.geojson identical).
- **Review (Claude):** no blocking findings. Nit: delays in `report.md` still use `:g` minutes (`report.py:101`), so they can show 6 digits (pre-existing). The new `test_json_safe_preserves_small_threshold` tests `json_safe` directly, not through `compute_impact`; acceptable since `compute_impact` returns `json_safe(...)` of `asdict(thresholds)`.
- **Gotchas:** the local 27→28 rerun matched the GitHub Actions bot commit (`76d814b`) byte for byte apart from the threshold line — same output on Mac and the runner.

### 2026-10-29 — Step 13: README draft
- **Agent:** Claude (drafted; Jared approves)
- **Did:** Rewrote `README.md`: what/why (release sign-off), quickstart, how it works, real-snapshot results table (five days), benchmark, US 199 example, fault-suite scores with per-type breakdown and caveats, limitations, layout.
- **Changed:** `README.md`, `PLAN.md` (Step 13 status), `PROGRESS.md`.
- **Verify:**
  - Number trace: script extracted 83 numeric tokens from README and searched `results/**/*.json`, `results/**/*.md`, `config/*.toml`; 26 not found directly, each accounted for: computed from `scores.json` (`seconds.runs` mean compare_full 290.41 / compare_incremental 28.50 over the 22 checked runs; per-fault affected-trip counts 103, 99, 61, 43 → top four = 306; per-type counts 134/105), `ram_bytes` 38654705664 = 36 GiB, cron `0 6 * * *`, 61 places from `trips.csv`, 0.5% = toml 0.005, 9 min 15 s from the Step 11 Verify entry, 16 GB = GitHub runner spec; rest are snapshot ids, list numbers, Python version, "US 199", "~650 MB" (input 654,880,314 B).
  - US 199: scratchpad script using `extract` + `build_graph` + `segment_costs` on 261026/261027 → `OLD segments on [1566890644, 1566890645]: 2; ways still in NEW: []`, both segments present in NEW at same cost, `changed segments: 0`.
  - `make test` → `170 passed in 34.50s` (existing `.venv`, not a fresh clone); `make lint` → `All checks passed!`, `37 files already formatted`.
- **Review:** pending Jared's read-through.
- **Gotchas:** Dropped the fault suite's total wall time and RSS from the README: they only exist in `data/fault-run-261027.log` (gitignored), not in `results/`. `bad_maxspeed` and `downgrade_class` affected 0 trips out of 28 each — stated in README.

### 2026-10-29 — Step 12 Verify: impact runs 23→27 + output check
- **Agent:** Claude (ran the impact runs on Jared's Mac; Jared ran the bench earlier)
- **Did:** The four impact runs had not actually started in the earlier session (no process, no outputs). Ran them in sequence under `caffeinate -i` + `/usr/bin/time -l`, log `data/impact-runs-1029.log`. Then ran the Step 12 output check and diffed the 26→27 rerun against the committed file.
- **Changed:** new `results/2026-10-2{4,5,6}/` (impact.json, report.md, impact.geojson); `results/2026-10-27/impact.json` (rerun), new `results/2026-10-27/{report.md,impact.geojson}`; `PLAN.md` (Step 12 status).
- **Verify:**
  - Runs (all `LOW LOW: no rule fired broken=0 slowed=0`, `exit=0`): 23→24 415.01 s real, 9776594944 B max RSS · 24→25 408.16 s, 9609805824 B · 25→26 410.36 s, 9952739328 B · 26→27 419.91 s, 10008182784 B.
  - `python scripts/check_outputs.py results/ --expect-impact 4` → `OK` for impact.json 24–28, metrics.json 27, scores.json (n = 200); `Summary: metrics=1 impact=5 scores=1 failures=0`; exit 0.
  - `git diff results/2026-10-27/impact.json`: only `"candidates": []` and `"culprits": []` added (keys introduced by Step 7 after the Step 6 file was committed). Metrics identical (LOW, 0/0, rerouted 142, changed_segments 29).
- **Review:** n/a (no code change). Step 12 code was reviewed in the entry below.
- **Gotchas:**
  - **Bug found (not fixed — `impact.py` is outside this step):** `json_safe` (`src/route_impact/impact.py:290`) rounds *every* float to 2 decimals. Every impact.json records `high_slowed_share: 0.01` while `config/thresholds.toml` and `load_thresholds` give 0.005, and a real `gravity_share_*` below 0.005 would be written as 0.0. The risk decision is unaffected (it uses unrounded in-memory values); all five committed days have shares of exactly 0.0, so no committed result is wrong. Fix: round only seconds/metres, or keep full precision for shares and thresholds. Needs its own step + a test.
  - Peak RSS for one impact run on the Mac is ~9.6–10.0 GB (not the ~8 GB noted earlier).

### 2026-10-29 — Step 11 Verify: GitHub dispatches
- **Agent:** Claude (Jared dispatched)
- **Did:** Ran the four Step 11 Verify dispatches on GitHub and checked runs, commits, issues and the Pages map.
- **Changed:** `PROGRESS.md` only. Bot commit `76d814b` on origin/main (`results/2026-10-28/impact.json`, `report.md`, `impact.geojson`).
- **Verify:**
  - (a) run 40838962434, `date=2026-10-28`: success, 9m15s total (07:59:19→08:08:34Z); "Run daily impact" 07:59:39→08:08:11Z; downloads 624M each at ~12–15 MB/s; output `LOW LOW: no rule fired broken=0 slowed=0 output=results/2026-10-28/impact.json`; bot commit rebased and pushed; `pages` job deployed. Not OOM-killed (peak RSS on the runner not measured). Map `https://jar-narvz.github.io/route-impact/site/?date=2026-10-28` → HTTP 200, renders "No affected routes or confirmed culprits in this file.", no console errors; `results/2026-10-28/impact.geojson` → 200.
  - (b) run 40840231384, `date=2026-10-27`: success, log `results/2026-10-27 already done; skipping`, no commit.
  - (c) run 40840259018, `test_high=true`: cancelled before starting (see gotcha). Rerun alone: runs 40840662303 (31s) and 40840922338 (25s), both success; opened `[test] HIGH risk: fixture town_v1 → town_v2` issues #1 and #2; no commits (origin/main still ends at `76d814b`).
  - (d) run 40840270536, `date=2099-01-01`: failure as expected, log `norcal-981231.osm.pbf not published on Geofabrik`, exit 1, `pages` skipped, no commit, no issue.
- **Review:** n/a (no code change).
- **Gotchas:** `concurrency: group: daily, cancel-in-progress: false` still allows only **one pending** run per group: dispatching (d) while (c) was queued behind (b) cancelled (c). Dispatch tests one at a time. Same applies if a manual run is queued when the 06:00 UTC cron fires. The 2099 failure names the OLD file (day before), which is correct behaviour.

### 2026-10-29 — Step 12 code: benchmark and output validation
- **Agent:** Codex
- **Did:** Added the benchmark module with real OLD→NEW extraction, graph construction, incremental routing and root-cause timings; snapshot counts and environment metadata; BSD/GNU time parsing and RSS merge. Added the portable bench wrapper, Make target and stdlib output checker, plus 28 offline test cases covering fixture benchmarking, captured resource logs, merge/error paths, synthetic schema failures and committed results.
- **Changed:** `src/route_impact/metrics.py`, `scripts/bench.sh`, `scripts/check_outputs.py`, `Makefile` (bench target/help only), `tests/test_metrics.py`, `tests/test_check_outputs.py`, `PROGRESS.md` (this log entry only).
- **Verify:** All four required commands exited 0, using the existing venv via `PATH="$PWD/.venv/bin:$PATH"`. Actual output excerpts:

```text
$ make test
python -m pytest
============================= test session starts ==============================
platform darwin -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0
rootdir: /Users/jarednarvaez/route-impact
configfile: pyproject.toml
collected 160 items

============================= 160 passed in 35.50s =============================
$ make lint
ruff check . && ruff format --check .
All checks passed!
32 files already formatted
$ python scripts/check_outputs.py results/
OK results/2026-10-27/impact.json
OK results/faults/261027/scores.json n = 200
Summary: metrics=0 impact=1 scores=1 failures=0
$ bash -n scripts/bench.sh
```

  Follow-up Verify (Codex, 2026-10-29): all three commands exited 0 with `PATH="$PWD/.venv/bin:$PATH"`; actual output excerpts:

```text
$ make test
python -m pytest
============================= test session starts ==============================
platform darwin -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0
rootdir: /Users/jarednarvaez/route-impact
configfile: pyproject.toml
collected 170 items

============================= 170 passed in 37.28s =============================
$ make lint
ruff check . && ruff format --check .
All checks passed!
32 files already formatted
$ python scripts/check_outputs.py results/
OK results/2026-10-27/impact.json
OK results/faults/261027/scores.json n = 200
Summary: metrics=0 impact=1 scores=1 failures=0
```

- **Review:** Claude, 2026-10-29: reran `make test` (160 passed in 35.20s), `make lint` (clean), `check_outputs.py results/` (impact OK, scores OK n = 200), `bash -n` OK. Files touched match the step. Findings: (1) `metrics.py:135-165` `seconds.total` (and the `/usr/bin/time` wall/RSS) include an extra full ST_ReadOSM scan of NEW for row counts — total ≠ pipeline time; (2) `metrics.py:110-111` snapping index + way loading for both snapshots are inside total but in no phase; (3) `git_commit` doesn't record a dirty tree, so commit Step 12 before benching; (4) `bench.sh:21` buffers all stderr until exit — no progress shown during a long run. None blocks; (1)–(3) are a small follow-up before the real run. Step 12 not done until the Mac runs pass Verify.
- **Gotchas:** No full NorCal files were run. Only one committed daily impact currently exists; `--expect-impact 4` will fail until Jared runs the remaining comparisons. Metrics schema uses `seconds` for phases and `risk_level` for the impact level; `wall_seconds` is added by `add-rss`. `diff` is residual impact summary/risk/selection/JSON work; segment differencing is inside the route timer. Total includes preparation, counting and temporary-DB cleanup, so phase sums need not equal total. The count query performs an additional raw NEW PBF scan. The checker accepts null score percentages only for zero denominators, matching the committed joint score. The initial fixture test exposed sandbox denial of macOS CPU sysctl; the required platform.processor() fallback now handles that, and all checks above passed afterward. Existing PLAN.md and untracked .claude/.codex changes were left untouched. Current state was not edited.
  Follow-up Gotchas (Codex, 2026-10-29): superseding the timing caveat above, `seconds.total` now stops immediately after `impact_from_graphs`, before counting and temporary-DB cleanup. `prepare_old` / `prepare_new` time node preparation and way loading inside total; `count` times the drivable count and raw NEW PBF scan outside total. `/usr/bin/time` wall_seconds and peak_rss_bytes still cover the whole process, including count. Added `git_dirty` from tracked-only porcelain status, with both git fields null when git is missing; the checker requires a boolean and reports `WARN dirty tree` on an otherwise OK metrics line. Tests cover the fixture phase keys and pipeline-sum lower bound (excluding count), clean/dirty/missing git, missing new phase keys, missing/null/nonboolean git_dirty and the non-failing warning. Changed only metrics.py, check_outputs.py, their two test files and this entry's Verify/Gotchas. No full NorCal files, staging or commits; Current state, PLAN.md and docs/DESIGN.md were not edited. Follow-up awaits Claude review.

### 2026-10-29 — Step 11: Daily job
- **Agent:** Codex (Claude reviewed; Claude edited PLAN Step 11 first)
- **Did:** `daily.yml`: cron `0 6 * * *` + `workflow_dispatch(date, test_high)`, job `run` (contents/issues write, 300-min timeout) runs `scripts/daily.sh`; job `pages` deploys `site/` + `results/` only when the run committed. `daily.sh`: date defaults to yesterday UTC (OLD = day before); skips if `results/<date>/` exists; downloads via `scripts/download.sh`, retrying "not published" 3 × 20 min on scheduled runs only; calls `route-impact impact` directly, 0 → bot commit, 1 → commit + issue (report.md capped at 60000 bytes + map link), else fail; `test_high` runs the town fixture pair, opens a `[test]` issue, commits nothing; `DAILY_DRY_RUN=1` echoes git/gh.
- **Changed:** `.github/workflows/daily.yml` (new), `scripts/daily.sh` (new). Claude: `PLAN.md` Step 11 (Verify (a) moved to 2026-10-28 because `results/2026-10-27/` was committed in Step 6; schedule/retry decision recorded).
- **Verify:** Offline only so far. YAML parses; `bash -n` ok (shellcheck not installed). `DAILY_DRY_RUN=1 TEST_HIGH=true` → `HIGH HIGH: 1 intercity trip broken broken=1 slowed=0`, then `DRY RUN: gh issue create --title '[test] HIGH risk: fixture town_v1 → town_v2' …`, exit 0. `DATE=2026-10-27` → `results/2026-10-27 already done; skipping`, exit 0. `DATE=2099-01-01` → `norcal-981231.osm.pbf not published on Geofabrik`, exit 1, no file left in `data/`. `DATE=2026-02-30` → `Invalid DATE`, exit 1. `TEST_HIGH=yes` → exit 1. Pending: the three GitHub dispatches.
- **Review:** Claude — approved. Minor, accepted: the `[test]` issue's map link points at `?date=2026-10-02`, which isn't on Pages; a dispatch with an empty date is treated as scheduled (gets retries); if `git push` fails after a HIGH, the issue isn't opened, but the run fails and GitHub notifies.
- **Gotchas:** Pushes made with `GITHUB_TOKEN` don't trigger other workflows, so Pages deploys inside `daily.yml`, not on push. Pages must be enabled once by hand.

### 2026-10-29 — Step 10: CI
- **Agent:** Codex (Claude reviewed)
- **Did:** Added a CI workflow (push, pull_request, workflow_dispatch) on ubuntu-latest + Python 3.11: pip cache keyed on `pyproject.toml`, `~/.duckdb/extensions` cached, `pip install -e ".[dev]"`, then `make setup`, `make lint`, `make test`. Read-only `contents` permission, per-ref concurrency with cancel-in-progress, 15-min timeout. Added the CI badge under the README title.
- **Changed:** `.github/workflows/ci.yml` (new), `README.md` (badge line).
- **Verify:** Local only so far (the real Verify needs a push). `ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'` → parses. `nice -n 19 make lint` → `All checks passed!` / `28 files already formatted`. `nice -n 19 make test` → `132 passed in 34.42s` (run at low priority while the fault suite was at run 213/220). Pending: Actions run green + badge renders after Jared pushes.
- **Review:** Claude — approved; diff limited to the two named files, no secrets, no data downloads.
- **First push (run 40838010314, 2026-10-29):** failed at Test, `3 failed, 129 passed`: `test_extract.py` builds PBFs with the `osmium` binary, which the runner lacks. Claude added an apt `osmium-tool` step to `ci.yml`; re-verify on the next push.
- **Verify (GitHub):** run 40838310758 (`eaf1149`) → green in 1m22s; Lint `All checks passed!`, Test `132 passed in 49.57s`; README badge SVG reads "passing". **Step 10 done.**
- **Gotchas:** duckdb is unpinned, so the extension cache key uses `pyproject.toml`; a DuckDB version bump just misses the cache (extension dirs are versioned) and `make setup` reinstalls. Codex was told not to run tests while the fault suite ran.

### 2026-10-28 — Step 9c: sampled full checks and resumable fault suite
- **Agent:** Codex
- **Did:** Added configurable full checks on indices 0, K, 2K in singles-then-batches order (default K=10); unchecked runs record full_checked=false, null equality and compare_full=0.0. Persisted each finished run's index, faults, score contributions, affected trip ids, phase and setup timings as sorted strict JSON, followed by flush and fsync. Final scores are reduced from the persisted records in suite order; equality counts only checked runs. Resume re-samples faults deterministically, validates the manifest, rejects duplicate/out-of-range progress indices and skips completed runs. Added --full-check-every/--fresh, Make defaults/help and 15 offline test cases covering sampling, crash/resume equivalence, score reconstruction, manifest mismatches, invalid indices, fresh starts and CLI errors.
- **Changed:** `src/route_impact/faults.py`, `src/route_impact/cli.py`, `Makefile`, `tests/test_faults.py`, `PROGRESS.md`.
- **Verify:** Both required commands exited 0 using the existing venv via `PATH="$PWD/.venv/bin:$PATH"`; fixtures only, offline. Actual final output:

```text
$ make test
python -m pytest
============================= test session starts ==============================
platform darwin -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0
rootdir: /Users/jarednarvaez/route-impact
configfile: pyproject.toml
collected 132 items

tests/test_extract.py ......                                             [  4%]
tests/test_faults.py ................................................... [ 43%]
                                                                         [ 43%]
tests/test_graph.py .............                                        [ 53%]
tests/test_impact.py .............................                       [ 75%]
tests/test_report.py ..........                                          [ 82%]
tests/test_rootcause.py ................                                 [ 94%]
tests/test_smoke.py .                                                    [ 95%]
tests/test_trips.py ......                                               [100%]

============================= 132 passed in 34.80s =============================
$ make lint
ruff check . && ruff format --check .
All checks passed!
28 files already formatted
```

- **Review:** Awaiting Claude review; Claude owns the n=10 rehearsal and n=200 real run.
- **Gotchas:** No network and no `data/*.osm.pbf` execution. Pre-existing `PLAN.md`, `docs/DESIGN.md` edits and untracked `.claude/` were left untouched. `--fresh` removes the manifest, progress and stale scores before starting the new suite. Malformed progress stops with a line-specific error rather than discarding completed records. Setup timings come from the first persisted run; resume still rebuilds the baseline and re-samples before validation. Crash test raises on run index 2, preserves exactly two lines, resumes with only six remaining apply_faults calls and matches uninterrupted scores excluding seconds; rebuilding completed scores makes zero apply_faults calls and reproduces scores including saved timings. No commit.

### 2026-10-28 — Step 9b: small outputs, contiguous-run culprits, fault timing
- **Agent:** Codex
- **Did:** Added shared nonmutating impact serialization that drops trip paths/segments only on disk and records changed_segment_count; both CLI impact and what-if use it. Capped map trips at 25 by broken status, descending weight and trip id, retained all confirmed culprits including run members, rounded coordinates to six decimals and compacted GeoJSON. Added map coverage counts/notice and relative site/?src= links for non-date reports. Added contiguous OLD-path run confirmation after single-edit checks, reusing indexed restoration edges, aggregating/ranking runs across trips, reporting member details/geometry and scoring only all-expected runs as correct. Added raw perf_counter extraction/baseline/per-run phase durations and single/batch total means. Added ten offline regression cases, plus updated existing affected expectations.
- **Changed:** `src/route_impact/impact.py`, `src/route_impact/rootcause.py`, `src/route_impact/report.py`, `src/route_impact/faults.py`, `src/route_impact/cli.py`, `site/index.html`, `tests/test_rootcause.py`, `tests/test_report.py`, `tests/test_faults.py`, `PROGRESS.md`.
- **Verify:** Both required commands exited 0 using the existing venv via `PATH="$PWD/.venv/bin:$PATH"`; fixtures only, offline. Actual output:

```text
$ make test
python -m pytest
============================= test session starts ==============================
platform darwin -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0
rootdir: /Users/jarednarvaez/route-impact
configfile: pyproject.toml
collected 117 items

tests/test_extract.py ......                                             [  5%]
tests/test_faults.py ....................................                [ 35%]
tests/test_graph.py .............                                        [ 47%]
tests/test_impact.py .............................                       [ 71%]
tests/test_report.py ..........                                          [ 80%]
tests/test_rootcause.py ................                                 [ 94%]
tests/test_smoke.py .                                                    [ 94%]
tests/test_trips.py ......                                               [100%]

============================= 117 passed in 16.75s =============================
$ make lint
ruff check . && ruff format --check .
All checks passed!
28 files already formatted
```

- **Review:** Claude — pending. NorCal what-if size/culprit checks, browser map check, and real-data n=10 timed suite remain for Claude per PLAN. The scope-blocker entry below is preserved; PLAN.md and docs/DESIGN.md were not edited by Codex.
- **Gotchas:** Intentional expectation changes: (1) bad_maxspeed on consecutive T1 ways 50+51 now confirms `run/way_changed/50+way_changed/51`; its batch score moves from joint to confirmed. The replacement fixture joint test uses ways 50+52, separated by unchanged 51, and verifies each fault individually exceeds slow_seconds. (2) The synthetic independent-slowdown and single-restore boundary tests now insert an unchanged segment between edits so they still test independent causes and the strict recovery boundary; their expected single-edit behavior is unchanged. (3) impact.json drops old_path/new_path/changed_segments and adds changed_segment_count; in-memory payloads retain geometry, and both serialization paths plus CLI report re-render are covered. (4) GeoJSON intentionally changes path ordering, coordinate precision, whitespace and adds trips_shown/trips_total; all culprit features remain, even with a cap of zero in the run-member regression. (5) Non-date Markdown Map links now resolve relative to the report and pass a source relative to site/; date Pages links stay unchanged. (6) scores.json timing values vary between runs; seeded fault lists remain deterministic. evaluate_faults accepts extraction/baseline seconds from run_suite (defaults 0.0 when evaluating an already prepared baseline); per-run totals include measurement/serialization/scoring overhead in addition to the named phases. The what-if CLI prints a run key when the top culprit is a run, avoiding a missing scalar id. An initial focused lint pass caught a duplicated timing keyword during implementation; corrected before all passing checks. No network, data/*.osm.pbf processing, staging or commits.

### 2026-10-28 — Step 9b: scope blocker
- **Agent:** Codex
- **Did:** Read AGENTS.md, PLAN.md Step 9b (Why/Do/Verify), and DESIGN §5.7/§5.9/§5.10; inspected the current serialization call sites. Stopped under AGENTS.md's instruction: "If another file needs changing, stop and note it in PROGRESS.md instead."
- **Changed:** `PROGRESS.md` only.
- **Verify:** Not run: no implementation changes were made, so there is no `make test` / `make lint` output to report.
- **Review:** Claude — stop was correct; the omission was Claude's. `cli.py` added to PLAN Step 9b Files; Codex relaunched.
- **Gotchas:** `cli.py:110` directly calls `json.dumps(payload, ...)` before `write_report` uses the same payload's paths. The requested shared serialization helper must be called at that JSON write to strip paths only on disk while preserving them for GeoJSON. Step 9b lists impact.py, rootcause.py, report.py, faults.py, site/index.html and three test files, but omits cli.py. No workaround that changes the in-memory payload or globally alters JSON serialization was introduced. No network, data/*.osm.pbf runs, staging or commits. PLAN.md and docs/DESIGN.md remain untouched.

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
