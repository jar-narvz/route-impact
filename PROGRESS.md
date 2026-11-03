# PROGRESS.md — route-impact

## Current state
- **P5 redesign (2026-11-03): local Verify done.** Monochrome page, home screen, WebGL effects and traffic, two independent reviews (3 fix rounds). Harness 18/18 + 15/15 + 18/18 (animations on) on the GPU, `make test` 314 + 265, lint clean, ledger 9,998,364 B. **Open (Jared):** commit (commands in the newest log entry), push, then the iPhone `?perf` JSON, the deployed transfer and the live smoke test. Also still open: Step 11b run 2 (item 4 below).
- **Working on:** Phase 2 on `main`. **P1, P2 and P4 are done**; README pass and resume bullets done 2026-11-02 (bullets approved, in the newest log entry). Open: Step 11b live Verify run 2 (item 4). Next phase P3 is after Nov 4.
- **Next session, start here:**
  1. ~~P2's open questions~~ — decided 2026-10-30, PLAN decision 16: commit the 261027 export under `site/playground/data/`; delete the spike files in P2 (memory gate moves to `core/test/` first); no Meteor attribution budget. P2 detail (P2a–P2e) written 2026-10-30, Codex critique 10/10 accepted (PLAN Review log). P2a–P2d committed and on `main` (`5ddb70b`; `playground` fast-forwarded into `main`; CI green on both). **The playground is live** at https://jar-narvz.github.io/route-impact/site/playground/ (`e9ee428`, Pages run 41143931349). ~~(1) Daily → `pages.yml` paths~~ — exercised by scheduled runs, no dispatch needed: failed Daily 41196974293 (2026-10-31, snapshot 404) → Pages 41200117069 `skipped`; publishing Daily 41306368351 (2026-11-01) → Pages 41309441377 `success` on the bot's result commit `5e97b7b`, and `results/2026-10-31/impact.json` returns 200 on the live site. ~~P2e phone run~~ — done 2026-11-01 (iPhone 14, Chrome: cold load ≤ ~1 s, everything else barely noticeable; VoiceOver skipped). **P2 is closed.** Polish follow-ups are in the P2e part 1 log entry. **Next: P4 per decision 18.** Detail P4a–P4c written 2026-11-01, Codex critique 8 accepted + 2 in part (PLAN Review log). **P4a done 2026-11-02** (phone gate pass, Large ships; see log). Decision 18 amended: Meteor fall 600 / 1,040 ms by size. **P4b done 2026-11-02**; **P4c-1 done 2026-11-02** (crosshair, named results, size-scaled Meteor marker; see log). **Start here next session:** (a) Step 11b run 2: `gh run list --workflow daily.yml -L 1`, then `gh run view <id> --log | grep -E 'Cache restored|already present|old=|new='` and step times via `gh run view <id> --json jobs`; record it in the Step 11b log entry and mark Step 11b done in PLAN. (b) ~~P4c~~ and ~~README/resume pass~~ done 2026-11-02 (see log). (c) Then Jared's call: P3 detail (Quake, Tornado, stacked edits with undo; `grep -n 'P3 — More weapons' PLAN.md`) or the small follow-ups below. Read to resume: the P4 block in PLAN (`grep -n 'P4 — Polish' PLAN.md`).
  2. ~~P1c CI red~~ — fixed by `352dede` (portable fixture gzip); CI run 41116882066 on `db3054f` green: `264 passed in 58.88s`, JS `# pass 47` `# fail 0`, lint clean. **P1c Verify complete.**
  3. **Daily job failed 2026-10-30** (run 41051491538): retry fix on `main` as `167f37f` (main CI 41116698061 green). Exercised 2026-10-31 (run 41196974293: three 404 attempts over ~45 min, then a clean failure).
  4. ~~Geofabrik stalled~~ — resumed; Daily 2026-11-01 published `results/2026-10-31/` (download 32 of 39 min, impact ~7 min, no OOM on the runner). **Fallback + cache now proposed as PLAN decision 19 / Step 11b (2026-11-01):** chain OLD to the newest result, up to a 3-day window, then a fresh start with a note; cache NEW's pbf for tomorrow's OLD. Jared approved 2026-11-01; Codex critique 10 points, 9 accepted + #3 in part (PLAN Review log). Step 11b implemented by Codex and reviewed by Claude (offline Verify green, DESIGN §5.11 updated). Pushed as `8ef39c1` (plan `1f4d7d1`, critique `b02a792`); CI 41401285220 green. **Live Verify run 1 done 2026-11-02** (Daily 41461034907: chained old=261031, cache miss as expected, saved `norcal-pbf-261101`; see Step 11b log). **Next: Claude checks run 2 of the live Verify:** the first publishing scheduled run after `8ef39c1` (expected 2026-11-02, NEW=261101) logs a `df` line and saves the cache `norcal-pbf-261101`; the next one logs "Cache restored from key: norcal-pbf-<old>" and "`norcal-<old>.osm.pbf` already present, checksum OK", with about one download less. Read the step timings with `gh run view <id> --json jobs`, record the run IDs in the Step 11b log entry, then mark Step 11b done in PLAN. Read to resume for this item: `sed -n 173,212p PLAN.md` (Step 11b) and `sed -n 699,712p PLAN.md` (decision 19).
  5. Then P4a → P4b → P4c, launch ~Nov 17.
  - **Workflow (Jared, 2026-10-30 02:45):** Codex is back from the 03:40 session: Codex implements and writes tests, Claude reviews. If Codex hits a quota error, fall back to a Claude implementer subagent + adversarial Claude reviewer subagent and say so in the log entry. (P1a–P1b used Claude subagents.)
  - **Overnight 2026-10-30 (Jared):** autonomous from 03:40 — Claude commits each finished step itself as Jared, no co-author line, no push. Stop with a note here on anything needing Jared's call.
  - Leftovers:
     - Follow-up (P1a review #4): the Earth radius is in both `config/playground.toml` and `impact.py` `Snapper`; make one the source.
     - Codex notes `site/playground/spike/p0b-verification.txt` and `p0c-verification.txt`, `p0c-memory-verification.txt` are untracked; don't commit them.
     - Old spike files still sit in `data/playground-spike/` (harmless).
     - Check the first scheduled daily run (`results/2026-10-29/` on `main`).
     - ~~Resume bullets await Jared's wording approval~~ — approved 2026-11-02.
     - P4c review follow-ups: worker-side way check for share links (removes the cold-cache 10,291,040 B case); a hash pasted while the page shows an error is ignored.
- **Done:** design, plan critique, Steps 0–13 + 12b. Fault suite `0c73497`. Step 12 code `31098b6`, CI test fix `b052a34`, bench `533b05b`; impact results 23→27, README draft and Step 12 Verify committed 2026-10-29.
- **Earlier checklist (MVP wrap-up, 2026-10-29; superseded by "start here" above):**
  1. ~~Jared commits Step 12 results + README~~ — done 2026-10-29.
  2. ~~Step 13 approval~~ — Jared approved 2026-10-29; PLAN Step 13 marked done. Fresh-clone check done 2026-10-29: `git clone` of `e6a18ab` → new venv → `pip install -e ".[dev]"` → `make setup` → `make test` `181 passed in 37.09s`, `make lint` clean (same Mac, so `~/.duckdb` spatial and `osmium-tool` were already present); CI run 40961646981 on a clean runner: `181 passed in 55.06s`, lint clean.
  3. ~~Step 12b — json_safe rounding fix~~ — done 2026-10-29, uncommitted (see log).
  4. ~~Close test issues #1 and #2~~ — closed 2026-10-29 with a comment (Jared approved).
  5. ~~Resume bullet~~ — approved 2026-11-02.
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

### 2026-11-03 — P5 follow-up: Meteor impact shake (Jared's request)
- **Step:** P5 polish. **Agent:** Claude (small visual change; checked in headless Chrome on the GPU).
- **Did:** On Meteor impact the map canvas shakes for 560 ms: damped, seeded jitter that peaks at 7 px × scale (capped at 14 px), with a slight zoom that eases out so the canvas edges never show. Only the canvas element moves (CSS transform through the Web Animations API), not the camera, so hit tests, traffic and the UI are unaffected. It is skipped under reduced motion, in still mode, when the tab is hidden, and when a replay resumes more than 0.25 s after impact. Clear/Rebuild cancels it. It follows the slow-mo `timeScale`.
- **Changed:** `site/playground/fx.js`, `docs/PLAYGROUND_UI.md`, `results/playground/p5b_browser_check.json` (re-run on this code).
- **Verify:**
  - Probe at 375×812: one `animate` call, duration 560; the first transform `matrix(1.0647, 0, 0, 1.0647, -6.4, -3.2)` at 733 ms after firing a 1.5 km meteor; transform back to `none` at 1,324 ms.
  - The frame paused mid-shake shows no canvas edges.
  - `make test-js` `# pass 265` `# fail 0`; lint clean.
  - Harness `?animations=1` on the GPU: "PASS 15/15 cases; 2/2 presets; 75/75 drawn paths valid." Animation checks all pass (reduced_motion, rapid_edit included). Counts after 50 cycles equal the counts after 1.
- **Review:** not reviewed by a second agent (one small, isolated function).
- **Gotchas:** the shake is invisible under swiftshader (frames too slow to catch it); use `GPU=1`.

### 2026-11-03 — P5: monochrome redesign, effects, traffic, reviews (**local Verify done**)
- **Step:** P5a + P5b + P5c (PLAN decision 20; spec docs/PLAYGROUND_UI.md). **Agents:** Codex implemented P5a, P5b-1…4 and review rounds P5c-1/2. Claude subagents did the work that needs a visual loop, because Codex's sandbox can't launch Chrome: the effects/traffic fixes (P5b-5) and review round 3. Two fresh Claude subagents did the design critique and the adversarial QA. Codex reviewed the subagent code (2 + 2 findings). Claude planned, triaged and verified.
- **Did:**
  - Home screen.
  - Monochrome Geist UI with grayscale basemap (`mono.js`).
  - Two-state result card.
  - Custom WebGL layer (`fx.js`, pure math in `fxmath.js`) with:
    - geo-anchored effects in metres;
    - meteor fall, trail, flash, shock ring, crater and sinking buildings;
    - Stomp dust, debris and glowing cracks;
    - Flip chevrons.
  - Trip-weighted traffic that recycles cars into the view.
  - Accessibility, share-link and error-handling fixes from the reviews.
- **Changed:**
  - `site/playground/{index.html,style.css,app.js,worker.js,fx.js}`
  - `site/playground/core/{summary.js,mono.js,fxmath.js,protocol.js}` + tests and two style fixtures
  - `scripts/playground_bytes.py`
  - `tests/browser/playground_verify.js`
  - `results/playground/{p5a_browser_check,p5b_browser_check,p5_perf_mac,p5b_bytes,p5a_bytes,p5_external_bytes}.json`
  - `results/playground/p5/` (8 screenshots, `checks.json`, `review_design.md`, `review_qa.md`, `review_triage.md`)
  - README playground section; PLAYGROUND.md §5.9 pointer; PLAN P5 status
- **Verify (actual):**
  - **Harness, headless Chrome on the M3 Max GPU (ANGLE Metal), each run alone, final code:**
    - P4 set with animations off: PASS, "18/18 cases; 2/2 presets; 100/100 drawn paths valid."
    - P2 defaults: PASS, "15/15 cases; 2/2 presets; 75/75 drawn paths valid."
    - P4 set with animations on: PASS, 18/18, 100/100.
    - Counts after cycles 1 and 50 are equal in all three: 10 sources, 56 layers, 1 fx layer, 2 features.
    - Fire medians, first 10 → last 10: 151.5→144.4 ms, 149.6→139.3 ms and 646.9→646.9 ms (the last is the animation deadline).
  - **Scale:** Meteor ring at z13→14 is 66.30→132.60 px (ratio 2.000) and matches the overlay within 0 px.
  - **Lifecycle:** after 3 theme switches and a context loss/restore, 1 fx layer and 3 buffers / 3 programs, as on first load.
  - **Reduced motion:** 0 frames scheduled and traffic frozen.
  - **Hidden tab:** no traffic frames while hidden, and traffic resumes.
  - **`?perf` at 1280×800 on the GPU:** p50/p95/p99 16.7/16.7/16.8 ms, 0 frames over 50 ms, 5,921 cars, no ladder steps.
  - **Screens:** contrast 0 failures on 46 screens, both themes, 7 viewports. Layout pairs left over are clipped scroll content and full-width text boxes, checked by eye.
  - **Tests:** `make test`: 314 passed, JS `# tests 265 # pass 265 # fail 0`. `make lint` clean.
  - **Ledger:** `scripts/playground_bytes.py --output results/playground/p5b_bytes.json` → 9,998,364 B, pass.
- **Review:**
  - The design review (12 findings) and the QA review (7) were triaged in `results/playground/p5/review_triage.md`. 17 were accepted, D3 was accepted in part, and D9 was rejected: the model closes whole ways, so the drawing must not clip them.
  - The re-checks after each round added N1–N4 and R1–R2; all were fixed.
  - Codex reviews:
    - P5b-5: 2 accepted, fixed. View-span clipping; expired trails stop allocating.
    - Round 3: C1 rejected, because rotation is disabled. C2 accepted: Claude enforced the car cap on resize, checked 6,000 → 3,000.
- **Gotchas:**
  - The in-app browser pane reports `document.hidden`, so all browser checks used headless Chrome over CDP. `--use-angle=metal` gives the real GPU headless.
  - Under swiftshader, the harness `rapid_edit` row is flaky: a 100 ms sleep stretches to ~700 ms. It passed 8/8 on the GPU.
  - `counts().fx_layers` used `getStyle().layers`, which never lists custom layers in 4.7.1. Fixed to `map.getLayer('fx')`.
  - The meteor fall was invisible because its approach ran along the camera's line of sight at pitch 55.
  - `scripts/playground_bytes.py` defaults to `p5a_bytes.json`, so later runs overwrote the P5a-time figure. That file now holds the final total, the same as `p5b_bytes.json`.
  - Screenshots: 8 curated ones are committed; the full set of 46 stays in the scratchpad (17 MB). In `1280x800_dark_meteor.png` the size control shows 500 m although the test hook fired 1.5 km (the hook doesn't move the control).
  - Remaining limits are in the README: traffic only on roads sampled trips use; phone frame rate not measured.
- **Next (Jared):**
  - Commit and push.
  - On iPhone 14, open the deployed `?perf`, run the check and paste the JSON → `results/playground/p5_perf_iphone.json`.
  - Then Claude measures the deployed transfer (`p5_transfer.json`) and runs the live smoke test at 375×812 and 1280×800.

### 2026-11-03 — P5a review round 1 fixes
- **Agent:** Codex.
- **Did:** Hid and faded game chrome around home; kept prose in Geist and stats as nowrap items; reduced home to Start and Bay Bridge; moved the loading bar to the button edge and removed it at ready; styled the theme ghost button with sun/moon icons. Used compact attribution and observed card/dock/status geometry. Gave Details its own row and explicit open/closed labels with chevrons; constrained the scroll region above the dock and removed collapsed trips from layout. Generated kind/id/duration trip copy in summary.js and rendered status words/dots with right-aligned mono durations. Thinned affected paths and removed the CSS named-color table except transparent/black/white.
- **Changed:** `site/playground/{index.html,style.css,app.js}`, `site/playground/core/{summary.js,mono.js}`, `site/playground/core/test/{summary.test.mjs,app.test.mjs,mono.test.mjs}`, `results/playground/p5a_bytes.json`, `PROGRESS.md`.
- **Verify:** Actual final output (JS TAP footer; Python session output; Ruff output; ledger footer):

```text
$ make test-js
node --test 'site/playground/core/test/*.test.mjs'
1..197
# tests 197
# suites 0
# pass 197
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 9973.664958
$ .venv/bin/python -m pytest
============================= test session starts ==============================
platform darwin -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0
rootdir: /Users/jarednarvaez/route-impact
configfile: pyproject.toml
collected 314 items

tests/test_check_outputs.py .......................                      [  7%]
tests/test_daily.py .............................................        [ 21%]
tests/test_extract.py ......                                             [ 23%]
tests/test_faults.py ................................................... [ 39%]
                                                                         [ 39%]
tests/test_graph.py .............                                        [ 43%]
tests/test_impact.py .......................................             [ 56%]
tests/test_metrics.py ...............                                    [ 61%]
tests/test_playground_export.py ................                         [ 66%]
tests/test_playground_oracle.py ........................................ [ 78%]
...........................                                              [ 87%]
tests/test_report.py ................                                    [ 92%]
tests/test_rootcause.py ................                                 [ 97%]
tests/test_smoke.py .                                                    [ 98%]
tests/test_trips.py ......                                               [100%]

============================= 314 passed in 41.70s =============================
$ .venv/bin/ruff check scripts/playground_bytes.py && .venv/bin/ruff format --check scripts/playground_bytes.py
All checks passed!
1 file already formatted
$ python3 scripts/playground_bytes.py --output results/playground/p5a_bytes.json
  "total_bytes": 9979537,
  "limit": 10000000,
  "pass": true
$ git diff --check
```

- **Review:** Pending Claude; no browser rerun by Codex in this round.
- **Gotchas:** Read revised PLAYGROUND_UI §4.5 and §5.3. The first regression run exposed the need to retain transparent's alpha in the reduced table and keep theme icons static for the existing share-page DOM double; both corrected before the passing run. New tests cover trip copy, unknown named-color passthrough, loading/ready status, home visibility/prose/stats, Details labels, attribution geometry and overlay styling. Existing P5a work and PLAN.md edits were present at task start; PLAN.md and docs were not edited. No commit or push.

### 2026-11-02 — README pass for the Nov 3–4 deadline
- **Agent:** Claude.
- **Did:** Added the 2026-10-31 and 2026-11-01 daily rows (from `results/<date>/impact.json` `metrics`: rerouted / improved / changed_segments); explained the missing 10-29/10-30 days and the 0-change 11-01 day; described the Step 11b chaining + cache in "How it works"; added the 10-31 runner time; added the playground's first-visit transfer; fixed "Mac described below" → "above".
- **Changed:** `README.md`, `PROGRESS.md`.
- **Verify (every new number traced):** 10-31 row 339 / 2 / 43 and 11-01 row 0 / 0 / 0 from `impact.json`. 11-01 is real, not a duplicate snapshot: Geofabrik md5 `ae55960d…` (261031) vs `246c5c58…` (261101), sizes 655,172,903 vs 655,196,573 B. Failed runs: 41051491538 log "norcal-261029.osm.pbf not published on Geofabrik" (404, then a 502), 41196974293 404s; 261029 exists now, so it was late, not skipped. 9 min 15 s = run 40838962434 (07:59:19 → 08:08:34), a **workflow_dispatch**, so the README no longer calls it scheduled. 39 min 14 s = run 41306368351; downloads ended 12:56:40 after the step started 12:25:09 = 31 min 31 s. 9,914,015 B from `results/playground/p4_transfer.json`.
- **Resume bullets — approved by Jared 2026-11-02** (sources: `results/2026-10-27/metrics.json`, `results/faults/261027/scores.json`, `results/playground/`; 87.5M = 87,519,594 rows truncated, 438 s = 438.23 s pipeline total):
  > Built a daily release gate in Python, DuckDB and SQL that measures how OpenStreetMap edits change navigation across Northern California: routes 5,660 population-weighted trips on two 726,182-vertex road graphs built from 87.5M map elements in 438 s, traces each broken or slowed route to the responsible edit by counterfactual restore, and runs daily in GitHub Actions with a LOW/MEDIUM/HIGH sign-off.

  > Evaluated it with 200 seeded injected faults: named the injected fault as the top culprit for all 355 affected trips (from the 19 faults that changed any route), alone and in batches of 10; verified the incremental reroute equals full recompute in 22/22 checks.

  > Built a browser playground that reroutes 2,057 Bay Area trips live as users delete roads, using exact customizable contraction hierarchies in a Web Worker; matched an independent Python oracle on 15/15 cases, with 395–537 ms median response on an iPhone 14.
- **Gotchas:** PROGRESS earlier said "scheduled" for the 10-28 job; it was the Step 11 dispatch (a).

### 2026-11-02 — P4c part 3: deployed transfer + live smoke test (**P4c done, P4 done**)
- **Agent:** Claude.
- **Did:** After Jared pushed `1cdf596` (Pages run 41553294023 success, CI 41553294015 success), measured the deployed transfer and ran the live smoke test with the pane shown.
- **Changed:** `results/playground/p4_transfer.json` (new), `PLAN.md` (P4 status), `PROGRESS.md`.
- **Verify:**
  - **Transfer (`curl -H 'Accept-Encoding: gzip'`, size_download, same method as P2e; file list from the live page's resource timeline + `meta.json`):** own code 36,308 B (13 files, incl. new `core/share.js`) + MapLibre 4.7.1 JS+CSS 220,234 B + data 9,657,473 B (24 files) = **9,914,015 B ≤ 10,000,000** (tiles excluded). Road-link replay refetches `way_osm_id` + `way_oneway` (377,025 B); on the live page both came from the HTTP cache (`transferSize` 0) because the worker fetched the same URLs first. With a cold cache this path would total 10,291,040 B, over the limit; recorded in the JSON, not in `total_bytes`.
  - **Smoke, 375×812 light:** deployed `app.js` contains the `presetLabel` fix. Bay Bridge preset → "Bay Bridge hit 10 roads: 2 trips broken, 169 slowed by 2 min or more, 2,859 added minutes of 2,057 sampled trips." (hash `#preset=bay_bridge`); University Ave ramp → "6 trips rerouted, none slowed by 2 min or more" (`#preset=university_ramp`); Rebuild cleared the hash. Live `#stomp=45473226` link → "Stomp hit 1 road", 45 slowed.
  - **Crosshair:** the page picks by nearest geometry in the worker (no `queryRenderedFeatures`), so the check was: Enter on `#map` picks the same way as `fireAt` (the pointer path) at the crosshair point. 375×812 peek / half / full (sheet top 644 / 406 / 72): point y 322 / 203 / 36, same way each time (262959263, 262959263, 223629630). Drawn crosshair top equals sheet top / 2 when the sheet's 220 ms `transitionend` fires (220–233 ms). 1280×800 dark: point (846, 400), right of the card (right 396), Enter = tap (105121033, "No sampled trip used Gravina Loop"). After resize: 900×800 → (656, 400) desktop rule; 899×800 → (449.5, 200) phone rule.
  - No console errors on the live page. CI on `1cdf596`: success.
- **Review:** measurement and checks only; no code changed.
- **Gotchas:** with fixed-time waits the drawn crosshair seemed to lag 1–2 s; the pane renders slowly, so wait on `transitionend` instead. The first crosshair run re-read the point after Rebuild moved the sheet; read it immediately before Enter.

### 2026-11-02 — P4c part 2: PLAYGROUND.md + browser Verify (share links)
- **Agent:** Claude.
- **Did:** Wrote `docs/PLAYGROUND.md` §5.11 (share-link decision, grammar, history) and updated the non-goal, crosshair and edge-case lines. Browser-pane checks of share links against the local server (`?test`). Found and fixed one bug: a replayed `#preset=` link showed the raw name ("bay_bridge hit 10 roads") because `replayShare` took the label from the worker's list, not the button's rule; moved the rule into one `presetLabel()` used by both, and fixed the `share.test.mjs` case that expected the raw name.
- **Changed:** `docs/PLAYGROUND.md`, `site/playground/app.js`, `site/playground/core/test/share.test.mjs`, `PROGRESS.md`.
- **Verify (browser pane, localhost:8781):**
  - Each form loaded fresh from a link gives the same result text and hit way ids as the hand-made edit: `#stomp=45473226` (1 hit, 0 broken / 45 slowed), `#flip=6320410` (1 hit), `#meteor=37.80441,-122.2712,500` (179 hits; hand edit fired at 37.8044123,-122.2711987 and the page rounded it to the link's 5 decimals), `#preset=bay_bridge` (10 hits; text matched only after the label fix). Rebuild cleared the hash.
  - Invalid links pasted into the address bar (`#flip=6323509` two-way, `#stomp=999999999999` unknown, `#stomp=0123`, `#meteor=37.8,-122.4,123`): each showed "This share link is invalid or unavailable. Pick a new edit.", cleared the hash, no result; console errors: none.
  - Pasted valid `#stomp=45473226` replayed exactly once (1 live-region reveal in 6 s).
  - Back: three edits (Stomp, Flip, Large Meteor) left `history.length` at 14, equal to the 14 page loads and pasted hashes before them, so no hash entries were added.
  - `make test` → `314 passed in 40.49s`, JS `# pass 196` `# fail 0` (after the test fix); `make lint` clean.
- **Not done:** crosshair `queryRenderedFeatures` check (P4c-1 already verified the geometry at peek/half/full and both sides of the breakpoint; the window wasn't visible, which freezes transitions) → do it in the live smoke test with the pane shown. Deployed transfer (`p4_transfer.json`, include the lazy way-array requests) and live smoke test need the push.
- **Review:** Claude's own fix is a 3-line refactor plus one test expectation; Codex to review if Jared wants.
- **Gotchas:** the browser served a cached `app.js` after the edit; `fetch('./app.js', {cache: 'reload'})` before navigating fixed it. A hidden pane makes awaited Meteor edits never settle.

### 2026-11-02 — P4c part 1: share link + README
- **Agent:** Codex
- **Did:** Added a pure raw-hash parser/serializer for Stomp, Flip, Meteor and compound presets, with exact single-key grammar, bounded five-decimal coordinates, size/preset membership and exported-way/one-way validation. Added offline grammar and real-page wiring tests. Committed results write the share hash with `history.replaceState`; Rebuild clears it. Load-time and pasted hashes replay through the existing edit path; invalid links clear to the normal page with a short notice. Cancellation prevents a stale lookup or result from replacing a newer edit. Added a copyable result link and updated only the README playground section with both sizes, sharing and exact phone-gate values.
- **Changed:** `site/playground/core/share.js` (new), `site/playground/core/test/share.test.mjs` (new), `site/playground/app.js`, `site/playground/style.css`, `site/playground/index.html`, `README.md`, `PROGRESS.md`.
- **Verify:** All three required commands exited 0. `make test` and `make lint` used `PYENV_VERSION=3.11.14 PATH="$PWD/.venv/bin:$PATH"`. Actual output excerpts below (individual TAP cases/timings omitted; Python output and TAP totals pasted verbatim):

```text
$ node --test site/playground/core/test/share.test.mjs
1..65
# tests 65
# suites 0
# pass 65
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 124.484542
$ PYENV_VERSION=3.11.14 PATH="$PWD/.venv/bin:$PATH" make test
python -m pytest
============================= test session starts ==============================
platform darwin -- Python 3.11.14, pytest-9.2.0, pluggy-1.7.0
rootdir: /Users/jarednarvaez/route-impact
configfile: pyproject.toml
collected 314 items

tests/test_check_outputs.py .......................                      [  7%]
tests/test_daily.py .............................................        [ 21%]
tests/test_extract.py ......                                             [ 23%]
tests/test_faults.py ................................................... [ 39%]
                                                                         [ 39%]
tests/test_graph.py .............                                        [ 43%]
tests/test_impact.py .......................................             [ 56%]
tests/test_metrics.py ...............                                    [ 61%]
tests/test_playground_export.py ................                         [ 66%]
tests/test_playground_oracle.py ........................................ [ 78%]
...........................                                              [ 87%]
tests/test_report.py ................                                    [ 92%]
tests/test_rootcause.py ................                                 [ 97%]
tests/test_smoke.py .                                                    [ 98%]
tests/test_trips.py ......                                               [100%]

============================= 314 passed in 40.79s =============================
/Applications/Xcode.app/Contents/Developer/usr/bin/make test-js
node --test 'site/playground/core/test/*.test.mjs'
1..196
# tests 196
# suites 0
# pass 196
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 9679.93125
$ PYENV_VERSION=3.11.14 PATH="$PWD/.venv/bin:$PATH" make lint
ruff check . && ruff format --check .
All checks passed!
50 files already formatted
```

- **Review:** Claude, 2026-11-02. Reran Verify: share 65/65, pytest 314 passed, JS 196 pass, lint clean. Fixed README float `394.9999999999709 ms` → `395 ms` (float error in `p4_phone_gate.json`, not a rounded measurement) and "1500 m" → "1,500 m". Follow-ups, not blocking: `loadWayLookup` refetches way arrays on the main thread instead of asking the worker; a hash pasted while the page shows an error is ignored. Still open: `docs/PLAYGROUND.md` (Claude), browser-pane checks, deployed transfer + smoke test.
- **Gotchas:** Road-link replay lazily reads and SHA-256-verifies the existing `way_osm_id.bin.gz` and `way_oneway.bin.gz` URLs on the main thread, cached as one lookup promise; Meteor and preset links do not load those arrays again. This preserves the allowed file scope and keeps geometry in the worker; Claude should include these requests/cache behavior in the deployed transfer check. The history API's own `replaceState` writes emit no `hashchange`, so they do not replay. Phone timing values are copied verbatim from `results/playground/p4_phone_gate.json`, including the unrounded Bay Bridge median; `?timing` bypasses animations. P4c-1 crosshair/naming code was not redone. No browser-pane checks, deployed transfer measurement, live smoke test, network access, staging or commits. `PLAN.md`, `docs/DESIGN.md` and `docs/PLAYGROUND.md` were not edited. Existing untracked `.claude/` and `.codex/` directories were left untouched.

### 2026-11-02 — P4c-1: crosshair + named no-impact results; size-scaled Meteor marker (**done**)
- **Agent:** Codex (crosshair, naming, tests); Claude (Meteor size scaling per Jared, review, browser Verify).
- **Did:**
  - Crosshair positioned by JS at the centre of the unobscured map: above the sheet's top edge on phones (read from its rect, so mid-transition is right), right of the card + 16 px on desktop. Recomputed on render, sheet height change, `transitionend`, resize, breakpoint change and weapon change. Enter fires at `map.unproject()` of that same pixel. `?test` hook: `crosshairPoint()`.
  - `summary.js`: single-road Stomp/Flip no-impact messages name the road ("No sampled trip used X", "N trips rerouted around X, none slowed…"); a null name reads "this unnamed road". Meteor, presets and multi-road unchanged.
  - **Jared's request (2026-11-02): different Meteor sizes animate at different sizes.** `METEOR_SIZES[].scale` = √(r/500) now drives duration (600 × scale), marker radius (12 × scale px) and drop height (200 × scale px), so both sizes fall at the same speed and Large starts higher and lands later. The drop is capped at the tap's height minus the marker and 8 px, so it never starts above the visible map.
- **Changed:** `site/playground/{app.js,style.css}`, `site/playground/core/summary.js`, `site/playground/core/test/{summary.test.mjs,app.test.mjs}`, `PLAN.md` (P4c split into P4c-1 + P4c, Claude).
- **Review (Claude):** no findings on Codex's part. The Meteor-scale change is Claude's own and not reviewed by Codex.
- **Verify (Claude, pane shown):**
  - Crosshair (real Tab focus to the map, 375×812, half height): drawn centre (188, 203) = fire point = centre of the visible map (sheet top 406). Computed point at peek / half / full: y = 288 / 203 / 36 for sheet tops 576 / 406 / 72. Enter fired the Meteor at the crosshair.
  - 1280×800: (846, 400), right of the card (card right 396). 900×800: (656, 400) desktop rule; 899×800: (450, 200) phone rule.
  - Named results through the real page (sheet + live region): way 28357724 → "10 trips rerouted around Sinclair Freeway, none slowed by 2 min or more"; way 517296940 → "1 trip rerouted around this unnamed road, …".
  - Meteor sizes mid-fall at 375×812: Small 12 px marker; Large visibly larger, starting higher, capped below the map top.
  - `make test` → `314 passed in 40.02s`, JS `# pass 131` `# fail 0` (new: Large drop + cap case); `make lint` clean.
  - The crosshair check compared geometry (drawn centre = unprojected point) rather than `queryRenderedFeatures`; Enter uses `crosshairPoint()` by construction.
- **Gotchas:**
  - The local `http.server` lets the browser cache ES modules: the first named-result check ran an old `summary.js`. Refresh with `fetch(file, {cache: 'reload'})` and reload before browser checks after code edits.
  - One JS run took 366 s under high machine load (load average ~9–10); rerun quiet: 9.7 s. Not a code regression.

### 2026-11-02 — P4b: impact animations (**done**)
- **Agent:** Codex (code, harness, page tests); Claude (review, one design fix, browser Verify).
- **Did:**
  - Tap pulse for every weapon; Meteor: falling marker + shock ring to the chosen radius over `METEOR_SIZES[].duration_ms` = round(600 × √(r/500)) → 600 / 1,039 ms; Stomp: steady highlight along the road (no flashing); Flip: arrows sweeping in the new direction. One transient canvas, removed on completion, replacement or Rebuild.
  - Reveal at max(result ready, animation end); an edit token re-checked before committing results and the announcement; a new tap, Rebuild or worker error cancels the animation, its frame and its timer. `?timing` still bypasses the wait.
  - Reduced motion: no animation, static end state (final ring) still drawn; a mid-animation preference change jumps to the end. `?test` hook gains `setReducedMotion`, `animationsRunning`, `animationFramesScheduled`, `staticOutline`, `fireRoad`.
  - Harness: `?animations=1` runs the 50 cycles with animations on, plus weapon-result, rapid-edit, Rebuild-mid-animation, reduced-motion and preference-change checks.
- **Changed:** `site/playground/{app.js,style.css}`, `site/playground/core/test/app.test.mjs`, `tests/browser/playground_verify.js`; **outside the step's file list (Claude):** `site/playground/core/protocol.js`, `site/playground/core/test/protocol.test.mjs`; new `results/playground/p4b_browser_check.json`.
- **Review (Claude):**
  1. **Fixed by Claude (design):** Codex's first version re-fetched, re-hashed and decompressed `way_osm_id`, `geometry_offsets` and `geometry_coords` (3,461,258 B gzipped) on the main thread to draw the Stomp/Flip road, and held `ready` until that finished, adding work and memory to an already ~2–2.5 s phone cold load. The cause was my brief forbidding worker/protocol edits. The worker already holds the geometry, so the `pick` reply now carries an additive `line` ([lon, lat] points in OSM order); `loadRoadGeometry`/`pickedLine` are removed. Protocol tests now expect `line`, built independently in the test.
  2. `afterDraw` now waits for a MapLibre `render` event instead of two animation frames. The harness's draw timings use it; compute-only cycles are unaffected in practice (P4a 117.6 ms-class values not re-measured here).
  3. Effect colour is hardcoded `#e9a23b`, not a theme token (minor).
  4. The Meteor fall offset is a fixed 110 px, independent of zoom (fine at the default zoom).
- **Verify (Claude, browser pane shown):**
  - `make test` → `314 passed in 43.38s`, JS `# pass 117` `# fail 0`; `make lint` clean; `node --check` OK.
  - Harness `?set=…p4_verify_set.json&oracle=…p4_oracle.json&expected=18&animations=1`: **PASS**: 18/18 equal to the oracle, 2/2 presets, 100/100 paths, real-page Large Meteor equal; animation checks weapon_results, rapid_edit, rebuild, reduced_motion, preference_change all pass. 50 cycles with animations on: sources 10 / layers 55 after cycle 1 = cycle 50; fire median first 10 = 633.8 ms, last 10 = 633.3 ms (includes the 600 ms fall). Saved as `p4b_browser_check.json`.
  - A first run showed cycles 49–50 at ~1,000 ms and one 1,008 ms Rebuild: the pane had gone hidden (background timers clamp to ~1 s). Rerun with the pane shown: no cycle over 800 ms, no Rebuild over 100 ms.
  - Screenshot mid-fall (Large, toll plaza): marker above the tap, ring growing, "Routing sampled trips…" underneath.
  - Transfer: P4b adds no files or assets; the deployed-size check is P4c's final step.
  - **Jared's phone check (2026-11-02, after Pages deployed `26763e4`):** "looks good", but asked for bigger, more noticeable effects. iOS Reduce Motion: not separately confirmed (covered by the harness's reduced_motion and preference_change checks).
  - **Follow-up (Claude, same day):** effect sizes moved into one `EFFECT` table in `app.js` and enlarged: line 3 → 6 px (round caps), tap pulse 5–22 → 8–38 px, Meteor marker 7 → 12 px falling from 200 px (was 110), Flip arrows 7 → 12 px every 40 px (was 28). `app.test.mjs` expectations updated. Pane-visible check at 375×812: the larger Meteor and pulse render; during a Stomp the result stays null until the effect ends (~500 ms), then appears. `make test` → `314 passed in 44.80s`, JS `# pass 117`; lint clean.
- **Gotchas:** the pane hides whenever the app window loses focus; re-show it right before each browser timing run, and check `tabs_context` if a run stalls.

### 2026-11-01 — P4a: two Meteor sizes + measured phone gate (**done 2026-11-02**)
- **Agent:** Codex (code); Claude (review, verify set, oracle, browser harness, keyboard check).
- **Did:**
  - Meteor size radio group (Small 500 m default, Large 1,500 m) from one `METEOR_SIZES` table in `app.js`; ring, hit test and the `?test` hook use the chosen radius. Meteor lat/lon rounded to 5 decimals in `runEdit` before the worker request.
  - `?timing`: "fire → result: N ms" readout, the ring drawn whole (animation wait bypassed), and a "Run phone gate" button: the 3 stress Meteors at 1,500 m × 3 runs with a Rebuild between, copyable JSON with medians and a verdict.
  - `playground_verify_set.py --meteor-radii` (default `500`); harness parameterized by URL query (P2 defaults) with a real-page Large Meteor check (hit way set + routing vs the oracle).
- **Changed:** `site/playground/{app.js,index.html,style.css}`, `site/playground/core/test/app.test.mjs` (new, page wiring with a DOM/worker double), `scripts/playground_verify_set.py`, `tests/browser/playground_verify.{html,js}`, `results/playground/{p4_verify_set.json,p4_oracle.json,p4_browser_check.json}` (new).
- **Verify (Claude):**
  - Default verify set `cmp` equal to `p2_verify_set.json`; `--meteor-radii 500,1500` → 18 cases.
  - `route-impact playground-oracle … --stress results/playground/p4_verify_set.json` → 309.02 s real (ran alongside `make test`). The 15 P2 outputs are equal to `p2_oracle.json`. At 1,500 m: toll plaza 155 ways / 173 affected (3 broken, 170 slowed); SF Financial 1,201 / 200 (69 broken, 131 slowed); Union Square 1,652 / 202 (72 broken, 130 slowed).
  - **Harness (P4 params, pane visible): 18/18 equal to the oracle, 2/2 presets, 100/100 drawn paths valid, real-page Large Meteor equal.** Worker latency at 1,500 m: 142.7 / 194.7 / 211.2 ms (toll plaza 500 m 95.3 ms vs P2d's 93.8). 50 cycles pass (sources 10 / layers 55 after cycle 1 = cycle 50). **Harness with defaults: 15/15, 2/2, 75/75** (P2 unchanged).
  - Keyboard-only (375×812): Tab → Meteor, Space, Tab → size group, ArrowRight → Large; announcement "Meteor size: Large 1,500 m"; both options 168×44 px.
  - `make test` → `314 passed in 46.21s`, JS `# pass 109` `# fail 0`; `make lint` clean; `node --check` OK.
  - **Phone gate (Jared, 2026-11-02, after `fa95081` deployed by Pages run 41406592676):** iPhone 14, Chrome on iOS 18.6.2, `?timing` → Run phone gate. Medians at 1,500 m: toll plaza 395 ms, SF Financial 482 ms, Union Square 537 ms; max run 575 ms; **verdict pass (≤ 2,000 ms), Large ships.** Saved as `results/playground/p4_phone_gate.json` (+ `device`, `code_commit`, `pages_run`).
  - Jared, by hand (not recorded): Mac about 200 ms, iPhone 500–600 ms, highest seen ~900 ms; phone cold load ~2–2.5 s (P2e: ≤ ~1 s; P4a added no data, so likely the network; P4c re-measures transfer).
- **Review (Claude):** no blocking findings.
  1. The harness's reference hit set is a JS reimplementation of the oracle's segment-distance test, because canonical-v1 records only the hit count. The routing comparison (incl. `ways_hit`) still goes to the Python oracle.
  2. `style.css:166` repeats the base `.weapons` `bottom` rule (harmless).
  3. Layer count is 55 where P2d recorded 63; it's the same before/after 50 cycles, so not a leak. Likely the remote basemap style changed; not investigated.
- **Gotchas:**
  - **A hidden browser pane runs the page as a throttled background page:** CSS transitions stay at `currentTime 0` (looked like a layout bug; it wasn't, and my CSS patch was reverted), the real-page cycle check hangs at cycle 1, and latencies read 4–5× high. Show the pane (`show_pane preview`) before any browser timing or animation check.
  - Large is deployed before its phone gate; if the gate fails, P4a removes it from `METEOR_SIZES` in a follow-up commit.
  - **Decision 18 amended (Jared, 2026-11-02):** the Meteor's fall scales with size, 600 ms × √(r / 500 m) → 600 / 1,040 ms. PLAN P4b updated.

### 2026-11-01 — P2e (part 2): Jared's phone run; P2 closed (**done**)
- **Agent:** Jared (phone run); Claude (record, close).
- **Did:** Jared opened the deployed playground on his own phone and ran the PLAN P2e phone check: cold load, the Bay Bridge preset, a Meteor on the Bay Bridge toll plaza (Oakland approach, ~37.825, -122.315), and Fire → Rebuild ×10.
- **Changed:** `PLAN.md` (P2 and P2e status → done), `PROGRESS.md`.
- **Verify (Jared, reported in chat; timed by feel, not instrumented):**
  - Device: **iPhone 14, Chrome** (Chrome on iOS uses WebKit, so this covers the Safari engine, not desktop-class Blink).
  - Cold load: "less or about 1 second".
  - Bay Bridge preset, toll-plaza Meteor, Rebuild ×10: "short enough where it's barely noticeable"; no slowdown or reload reported.
  - **No Meteor over 2 s → decision 16's revisit clause doesn't fire; the attribution cap stays off.**
  - VoiceOver: not run. The README keeps "has not yet been tested with a screen reader" (`README.md:129`).
  - Earlier P2e parts: deploy + live smoke test + transfer 9,907,730 B (part 1 entry below); Daily → Pages paths (Current state item 1). `make test`/`make lint`: no code changed since `8ef39c1`, CI 41401285220 green.
- **Review:** these are rough human timings, so nothing from this run goes in the README as a number.
- **Gotchas:** for P4, "barely noticeable" on an iPhone 14 means the large Meteor isn't ruled out by time; P4's own Verify must still time it, since a bigger radius touches more roads.

### 2026-11-01 — Step 11b: Daily chained window + snapshot cache (code done; live Verify pending)
- **Agent:** Codex.
- **Did:** Added the pure daily planner and CLI with one completeness predicate for skipping/chaining, UTC dates, explicit-date behavior, capped windows, fresh-start notes and warnings for ignored incomplete/future results. Daily restores OLD by hardlink before checksum verification, falls back once on an unpublished chained OLD, preserves retries for the fresh OLD and NEW, stages exactly NEW's two verified files after publishing, logs disk space, and carries notes to stdout, the job summary and the bot commit body. The workflow checks out `main`, plans before downloads and uses exact snapshot cache keys. Reports label windows longer than one day while preserving fixture labels. Offline shell tests use fake download, routing, git and issue commands in temporary directories, including the existing test-HIGH and dry-run paths.
- **Changed:** `src/route_impact/daily.py` (new), `tests/test_daily.py` (new), `scripts/daily.sh`, `.github/workflows/daily.yml`, `src/route_impact/report.py`, `tests/test_report.py`, `PROGRESS.md` (this entry only).
- **Verify:** Ran both required commands with `source .venv/bin/activate`, without network access. Actual final summary/output lines from the final runs:
  - `make test` (exit 0; Python summary and JavaScript final lines):
    ```text
    ============================= 314 passed in 42.58s =============================
    1..105
    # tests 105
    # suites 0
    # pass 105
    # fail 0
    # cancelled 0
    # skipped 0
    # todo 0
    # duration_ms 9825.181083
    ```
  - `make lint` (exit 0):
    ```text
    ruff check . && ruff format --check .
    All checks passed!
    49 files already formatted
    ```
- **Review (Claude, 2026-11-01):** I reran Verify: `314 passed in 43.33s`, JS `# pass 105` `# fail 0`, lint clean. `python -m route_impact.daily plan --today 2026-11-02` on the real `results/` → `old=261031 new=261101 gap_days=1`, no warnings (all six dated dirs are complete). Diff stays within the step's Files. No blocking findings. Non-blocking:
  1. `scripts/daily.sh:174` — after a fallback, `log_note` prints the planner's note a second time, so the job summary repeats it. Cosmetic.
  2. `.github/workflows/daily.yml:72` — the save step's implicit `success()` skips the cache if `daily.sh` fails after the push (e.g. `gh issue create` errors). The next run just downloads. Acceptable.
  3. `src/route_impact/daily.py:76` — the incomplete-dir warning repeats on every run until the dir is fixed. That's intended: it stays visible.
  Claude updated DESIGN §5.11. **Offline Verify complete. Live Verify waits on two scheduled runs after Jared pushes.**
- **Gotchas:** Live cache save/restore, checksum-hit logs and Actions step timings require the two post-merge scheduled runs specified in PLAN; these were not run in this offline session. An initial lint run caught UTC-alias and explicit subprocess `check` conventions in the new files; corrected before the final passing checks above. No real downloads, routing on full snapshots, git staging, commits, pushes or issues were performed. `Current state`, `PLAN.md` and `docs/DESIGN.md` were not edited. Existing untracked `.claude/` and `.codex/` were left untouched.
- **Live Verify, run 1 of 2 (Claude, 2026-11-02):** scheduled Daily 41461034907 on `a490ee6` → success, published `results/2026-11-01/` (`a67a958`). Log: `new=261101`, `old=261031` (chained to the last result); `Cache not found for input keys: norcal-pbf-261031` (expected on the first run); both pbfs `downloaded, checksum OK` (14:20:57 → 14:28:34 and → 14:38:33, so ~17.5 min of downloads); `df` logged before and after; `Cache saved with key: norcal-pbf-261101`. Step `Run daily impact` 14:20:57 → 14:47:04 (26 min 7 s); whole job 14:20:41 → 14:47:11. **Still needed:** run 2 (expected 2026-11-03, NEW=261102) must log `Cache restored from key: norcal-pbf-261101` and `norcal-261101.osm.pbf already present, checksum OK`, with one download fewer.

### 2026-10-30 — P2e (part 1): Pages workflow, README, PLAYGROUND.md (**in progress**)
- **Agent:** Codex (`pages.yml`, `daily.yml`); Claude (README section, `docs/PLAYGROUND.md`, review).
- **Did:**
  - `playground` was fast-forwarded into `main` by Jared after CI run 41141757457 (P2d, `5ddb70b`) passed: lint clean, `264 passed in 53.61s`, JS 105/105. CI on `main` (run 41141831136) also passed.
  - New `.github/workflows/pages.yml` is the only Pages deploy. Triggers: push to `main` on `site/**`, `results/**` or itself; `workflow_run` of Daily `completed` on `main`; `workflow_dispatch`. The job runs unless it's a `workflow_run` whose conclusion isn't `success`. It checks out `ref: main`, uses `concurrency: pages`, and keeps the unchanged `cp -R site results _site/` build. `daily.yml` loses its `pages` job and the `publish` output (`daily.sh` still writes `publish=`; harmless, left alone).
  - README gets a "Fault playground" section plus the link under the intro and two layout rows. Its numbers come from `site/playground/data/meta.json`, `results/playground/p2_browser_check.json` and `p2_oracle.json`; the memory-gate numbers are left out because they live in gitignored `data/`.
  - `docs/PLAYGROUND.md`: F4, §5.5 (radius 500 m) and §5.8 (no cap; equality with the oracle) updated for decision 16.
- **Changed:** `.github/workflows/pages.yml` (new), `.github/workflows/daily.yml`, `README.md`, `docs/PLAYGROUND.md`, `PROGRESS.md`.
- **Verify (Claude, after Jared pushed `e9ee428`):**
  - The push started CI run 41143931444 and **Pages run 41143931349 → `deploy: success`**. The live `…/site/playground/`, `…/site/playground/data/meta.json` and the results map `…/site/` all return 200.
  - **Deployed data = committed data:** all 24 files in `meta.json` fetched from Pages are byte-identical to `site/playground/data/` (9,664,256 B). `cch_order_input.bin` and `cch_order_output.bin` return 404 there.
  - **Live smoke test (browser pane):**
    - Phone 375×812, light: loads; Bay Bridge preset → "Bay Bridge hit 10 roads: 2 trips broken, 169 slowed by 2 min or more, 2,859 added minutes of 2,057 sampled trips."; University Ave ramp → "6 trips rerouted, none slowed by 2 min or more"; a live Stomp via keyboard at the crosshair → "No sampled trip used these roads", with the destroyed road drawn in red.
    - Desktop 1280×800, dark: the left card with the Bay Bridge result, red spans, before/after routes and the box all render.
    - No console errors at either size. The results map `…/site/?date=2026-10-28` loads without console errors.
  - **Live transfer (`curl -H 'Accept-Encoding: gzip'`, size_download):** own code 29,649 B (12 files) + MapLibre 4.7.1 JS 211,495 + CSS 9,113 B + data 9,657,473 B = **9,907,730 B ≤ 10,000,000** (tiles excluded).
  - Screenshots (gitignored): `data/playground-bench/p2e-screens/`.
  - **Not yet run:** a failed Daily dispatch triggering `pages.yml` with the job skipped, and a successful Daily deploying through `workflow_run` (Jared dispatches). Jared's phone run.
- **Follow-ups (polish, not blocking):**
  1. The keyboard crosshair sits at the map's centre, which is at the sheet's top edge at half height and hidden at full. It should use the centre of the visible map area.
  2. The University Ave ramp preset is a no-impact example; consider a damaging preset.
  3. No-impact Stomp/Flip results don't name the road.
  4. The trips list shows ids only (no place names shipped).
  5. `daily.sh` still writes an unused `publish=` output.
- **Review (Claude):** the workflow matches PLAN P2e and critique #3. No findings.

### 2026-10-30 — P2d: keyboard, screen reader, reduced motion; browser == oracle (**done**)
- **Agent:** Codex (code); Claude generated the check set, ran the oracle and the browser harness, did the keyboard-only run, and fixed two focus bugs.
- **Did:**
  - Focusable map (`role=application`) with a centre crosshair; arrows pan, `+`/`-` zoom, Enter fires the selected weapon at the crosshair, Escape returns to the selected weapon. MapLibre's own keyboard handler is disabled.
  - Tab order fixed in the DOM. A single `.sr-only` live region. Reduced motion: camera duration 0, ring drawn whole at once, CSS transitions and animations off.
  - The `?test` hook (`window.__playground`) and the protocol `debug: true` flag, both for the harness.
  - New `scripts/playground_verify_set.py` and `tests/browser/playground_verify.{html,js}`.
- **Changed:** `site/playground/{app.js,index.html,style.css}`, `site/playground/core/protocol.js`, `site/playground/core/test/protocol.test.mjs`, `scripts/playground_verify_set.py`, `tests/browser/playground_verify.{html,js}`, `results/playground/{p2_verify_set.json,p2_oracle.json,p2_browser_check.json}`.
- **Verify (Claude):**
  - `python scripts/playground_verify_set.py --seed 2027 --data site/playground/data --output results/playground/p2_verify_set.json` → 15 cases. A rerun to a temp path is byte-identical (`cmp`).
  - `route-impact playground-oracle --data site/playground/data --stress results/playground/p2_verify_set.json --output results/playground/p2_oracle.json` → 136.13 s real. Outputs: bay_bridge_live 10 ways / 171 affected (2 broken, 169 slowed); toll plaza 56 / 170 slowed; sf_financial 230 / 2 broken; sf_union_square 187 / 59 broken; stomp_01 45 slowed; the other 9 Stomps and the University ramp affect 0.
  - **Harness (browser pane, `tests/browser/playground_verify.html`):** **15/15 cases equal to the oracle, 2/2 presets equal to their live runs, 75/75 drawn paths valid** (origin, destination, connected, active under the edit, Σ ms = distance_ms; broken-trip cases draw none). Per-case worker latency 3.8–93.8 ms (toll plaza the max).
  - **50 Meteor/Rebuild cycles through the real page:** pass.
    - Sources 10 / layers 63 after cycle 1 = after cycle 50.
    - Fire-to-render median: first 10 = 124.95 ms, last 10 = 115.15 ms. Rebuild: 24.85 → 23.15 ms.
    - P0's reset growth (~48 → ~1,298 ms) does not occur.
  - Saved to `results/playground/p2_browser_check.json` (read from `window.__p2result`; adds `code_commit` 9f76513 + `code_dirty: true`, since `git_commit` in it is the export's).
  - **Keyboard-only run (375×812, key presses only):**
    - Initial Tab order: Stomp, Flip, Meteor, map, grabber, Peek, Half, Full, Recenter, Theme. Collapsed results are skipped and Rebuild is disabled before an edit.
    - With results showing: map, then the 3 MapLibre attribution links (legitimate links, left in place), grabber, Peek, Half, Full, the road row, its OSM link, Bay Bridge, University Ave ramp, Rebuild, Recenter, Theme.
    - Space selects Meteor; arrows pan; Enter at the crosshair → "Meteor hit 49 roads: 1 trip broken…". Stomp → "2 trips rerouted, none slowed by 2 min or more". Flip (on a one-way road) → the same. Bay Bridge preset → 2 / 169 / 2,859. University Ave ramp → "6 trips rerouted, none slowed by 2 min or more". Full shows the 171-trip list; Peek collapses; Rebuild clears.
    - **MutationObserver: exactly one announcement per result.** Rebuild only clears the region.
  - 18 interactive elements, **none under 44 px** (computed rects). Collapsed (`inert`) content holds no focusable element. The OSM link has `target=_blank rel=noopener` and the label "View Dwight D. Eisenhower Highway on OpenStreetMap".
  - **Reduced motion:** the pane can't emulate `prefers-reduced-motion`. A runtime frame count with `matchMedia` overridden was inconclusive: MapLibre's own render frames dominate (normal 44, reduced 92, from the instant camera jump's tile loads). Checked in code instead: every camera move uses `reducedMotion() ? 0 : …`; the ring uses `fraction = 1` with no reschedule; CSS `@media (prefers-reduced-motion: reduce)` turns off all transitions and animations.
  - `make test` → `264 passed in 38.29s`, JS `# pass 105`; `make lint` clean; `node --check` OK.
  - **Screen reader:** not run. The README must say "announced through an ARIA live region; not yet tested with a screen reader" unless Jared's P2e VoiceOver pass works.
- **Review (Claude; keyboard-run findings, fixed in `app.js`):**
  1. **Focus lost after a preset.** `renderResults` replaces the Try these buttons, so the pressed button vanished and focus fell to the page. The focused preset is now remembered by `data-preset` and refocused.
  2. **Focus lost after Rebuild.** Rebuild disables itself; a focused button that becomes disabled drops focus. Focus now moves to the selected weapon (or Stomp).
  3. "Several roads together: 0" is hidden when the count is 0.
  - Product note for Jared: the University Ave ramp preset is a no-impact example (6 rerouted, none slowed) — honest, but weak as a "Try these" showcase.

### 2026-10-30 — P2c follow-up: typed display + median-of-5 gate (**P2c done**)
- **Agent:** Codex (code); Claude reran the gate and rechecked the browser. Jared agreed to Claude's recommendation (PLAN decision 17).
- **Did:**
  - `engine.js` no longer builds GeoJSON.
  - `protocol.js` sends each edit's before (first 25 affected trips), after and hit lines as `{coords: Float32Array, offsets: Uint32Array, ids: Float64Array}`; `worker.js` transfers the 9 buffers.
  - `app.js` builds the FeatureCollections on the main thread once per reply; layer order unchanged.
  - `make bench-js` runs the whole-protocol bench in 5 fresh processes and gates on the median.
- **Changed:** `site/playground/core/{engine.js,protocol.js}`, `site/playground/core/test/{protocol.test.mjs,cch_bench.mjs}`, `site/playground/{worker.js,app.js}`, `Makefile`, `PLAN.md` (decision 17, gate wording; Claude).
- **Verify (Claude reran):**
  - `make bench-js` → RSS after 50 edits **266,518,528 / 264,126,464 / 268,009,472 / 261,996,544 / 261,177,344 B; median 264,126,464; max 268,009,472; gate PASS**. Every run is under 300 MB, not just the median. heapUsed 5.83 MB in every run. Codex's own run: median 262,963,200, max 271,482,880 (one run at 181,911,552).
    - Before the trim: median ≈ 292 MB, 6 of 8 runs passing. The engine alone (P2a): 266–280 MB. So the per-edit display churn is gone.
  - `make test` → `264 passed in 38.80s`, JS `# pass 104` `# fail 0`; `make lint` clean; `node --check` OK.
  - **Browser (375×812):** the Bay Bridge preset renders identically (2 / 169 / 2,859 of 2,057; red spans above the routes; precomputed tag). Tapping "Dwight D. Eisenhower Highway" sets it pressed (the selected layer reads from the new hit features; at overview zoom the 2-point way is too short to confirm by eye). Its OSM link goes to `https://www.openstreetmap.org/way/661905446`. No console errors.
- **Review (Claude):** `engine.js`'s removed `geojson()` had no other users (oracle tests compare `canonical()`, which ignores it). The display builder keeps the engine's 25-trip cap and order. No findings.

### 2026-10-30 — P2c: weapons and results (**not done: memory gate passes 6 of 8 runs**)
- **Agent:** Codex, two runs (the build, then memory and UI fixes from Claude's browser findings); Claude reviewed, made three fixes, and ran the browser and memory checks.
- **Did:**
  - `core/pick.js`: a typed-array CSR grid for the nearest-way pick, 20 px tolerance.
  - `core/summary.js`: all sheet wording, including miss / no-candidates / rerouted-none / damage, one-road vs attribution, plurals, and road groups with unique names + way count.
  - The `protocol.js` `pick`. The baseline is now one line per unique way (47,350 ways / 117,603 points instead of 331,995 / 795,528), sent as transferred typed arrays.
  - `app.js`: the weapon toolbar; Stomp / Flip via `pick`; the 500 m Meteor with an animated ring plus a centre marker; damage numbers; before / after / hit layers; the mattered list with OSM links and highlighting; Try these; the trips list; Rebuild; a short visible status plus one hidden `aria-live` announcement.
  - `cch_bench.mjs` now measures the **whole worker protocol** (PLAN P2c "Worker memory").
- **Changed:** `site/playground/core/{pick.js,summary.js,protocol.js}`, `site/playground/core/test/{pick,summary,protocol}.test.mjs`, `site/playground/core/test/cch_bench.mjs`, `site/playground/{app.js,worker.js,index.html,style.css}`, `PLAN.md` (P2c files: `protocol.js` and the worker-memory bullet).
- **Verify (Claude):**
  - `make test` → `264 passed in 41.42s`, JS `# pass 104` `# fail 0`; `make lint` clean; `node --check` OK.
  - **Browser (375×812):**
    - Bay Bridge preset: "Bay Bridge hit 10 roads", precomputed, **2 broken / 169 slowed / 2,859 added min of 2,057 sampled trips** (= oracle preset: added_ms 171,529,790). Single road "Dwight D. Eisenhower Highway · 1 trip"; "Several roads together: 170". Destroyed spans in red.
    - Live Meteor, downtown SF (37.8002, −122.4228): "Meteor hit 168 roads", 2 broken.
    - Meteor elsewhere in SF: "No sampled trip used these roads" + note.
    - Stomp in Oakland: "1 trip rerouted, none slowed by 2 min or more".
    - Flip on a two-way road: "This road is two-way", nothing run.
    - Rebuild clears everything back to peek.
    - Theme switch with the preset shown keeps routes, highlights and results.
    - One `role=status` live region (`.sr-only`) holds the announcement.
    - No console errors.
  - Node check of the same Meteor through the protocol: 223 / 302 ways hit at two SF points, so the engine path matches the page.
  - Screenshots (gitignored): `data/playground-bench/p2c-screens/`.
  - **Memory (`make bench-js`, whole protocol, 8 runs):** RSS after 50 pick + toll-plaza edits 297,713,664 / 325,369,856 / 279,429,120 / 287,096,832 / 285,392,896 / 298,729,472 / 301,432,832 / 283,672,576 B. **6 of 8 ≤ 300,000,000**, median ≈ 292 MB. heapUsed flat at 5.64 MB; after load 217–239 MB.
    - For scale: the engine alone measured 266–280 MB (P2a), and the first P2c build 412 MB (Map grid + per-trip baseline GeoJSON). What remains above the engine is allocator retention from per-edit display objects.
- **Review (Claude):**
  1. *Fixed (memory, by Codex on Claude's brief):* the first P2c build held 412 MB after 50 edits through the protocol. The picker's string-keyed Map of arrays added +30 MB heap; building the per-trip baseline GeoJSON left RSS at ~380 MB. Now typed CSR + a unique-way baseline as transferred typed arrays.
  2. *Fixed (UI, by Codex):* "1 trips"; road groups repeating names ("Van Ness Avenue" ×16) and one OSM link per way; empty headings; the status line repeating the full announcement; Meteor invisible at overview zoom (centre marker added).
  3. *Fixed (Claude):* the selected weapon showed near-white text on grey while hovered (`button:not(:disabled):hover` out-ranked `.weapons [aria-pressed]`).
  4. *Fixed (Claude):* destroyed roads were hidden under the grey "before" routes (the `hit` layer sat below them); now above.
  5. Open (polish): no-impact Stomp/Flip results don't name the road; the trips list shows ids only ("Trip ic-00001 · intercity") because no place names are shipped.
  6. My first browser Meteor showed "Missed" because my click hit water during a camera animation (stale screenshot), not a bug; confirmed by intercepting the worker message.

### 2026-10-30 — P2b: page shell (map, sheet, buttons, themes, load and error states)
- **Agent:** Codex (`codex exec --sandbox workspace-write`; no network, so it wrote the page blind); Claude reviewed, fixed four browser-found problems, and ran Verify in the browser pane (local `python3 -m http.server 8781` from the repo root; `.claude/launch.json` config `playground`).
- **Did:** New `site/playground/{index.html,app.js,style.css}`:
  - MapLibre 4.7.1 with OpenFreeMap `positron` / `dark`, the Bay box outline, and all 2,057 baseline trips as one faint line layer from the worker's `load` reply;
  - a three-height sheet (grabber plus Peek / Half / Full buttons) that becomes a left card at ≥ 900 px;
  - round Rebuild / recenter / theme buttons;
  - theme tokens on `:root` and `[data-theme="dark"]`;
  - loading, no-WebGL (`?nowebgl` hook), no-Worker, worker/fetch error with Retry, and basemap-failure states;
  - the box caveat, and the snapshot footer read from `meta.json`.
  - App state is one object, and a single idempotent `addOverlays(map)` re-adds every app source and layer, including empty `hit` / `before` / `after` placeholders for P2c.
- **Changed:** `site/playground/{index.html,app.js,style.css}` (new); `.claude/launch.json` (local, untracked: the spike server config was replaced by `playground`).
- **Verify (Claude, browser pane):**
  - **Phone 375×812, light:** the map, box and trips render; the sheet's Peek, Half and Full all work. The attribution sits just above the sheet at every height (JS: attribution bottom 72 = sheet top 72 at full). Collapsed content has 0 focusable elements (`inert`).
  - **Dark:** after the theme toggle, the box and trips are re-added and the attribution matches the theme.
  - **Desktop 1280×800:** a floating card at the left; the box is fitted clear of it.
  - **`?nowebgl`:** a plain background with "WebGL is unavailable…", no map and no Retry.
  - **Data missing** (`site/playground/data` renamed; tested on `127.0.0.1` to bypass `localhost`'s HTTP cache): "The Bay road network could not load: meta.json: HTTP 404" with Retry. Restoring the data and pressing Retry gives a ready page with no console errors; `ship_playground_data.py --check` OK afterwards.
  - Console: no errors. The only messages are 3 warnings from OpenFreeMap's positron style (`Image "circle-11" could not be loaded`), from the third-party style, not page code.
  - `node --check site/playground/app.js` OK; `make test` → `264 passed in 39.14s`, JS 78/78; `make lint` clean.
  - Screenshots (gitignored, local): `data/playground-bench/p2b-screens/{phone-light-peek.jpg,phone-dark-peek.jpg,phone-dark-half.jpg,desktop-light.png}`.
- **Review (Claude; browser findings, all fixed):**
  1. **Theme switch dropped every overlay.** `map.setStyle(url)` diffs styles by default; when the diff succeeds, MapLibre removes the app's layers and doesn't fire `style.load`, so `addOverlays` never ran. Now `setStyle(url, {diff: false})`.
  2. **Dark trips hidden under basemap roads.** Layers went below the style's *first* symbol layer, but the dark style has a symbol layer before its roads. Now they go below the first symbol layer after the last `line` / `fill` layer.
  3. **Attribution half-styled in dark** (the link kept a light background). It now uses `--sheet-bg` / `--muted`, and links inherit.
  4. **Retry cut off below peek height on errors.** `fail()` raises the sheet to half, and the worker's `Error: ` prefix is trimmed from the message.
  - Noted, not changed: at full height on a phone the sheet covers the lower round buttons (Apple Maps does the same). First paint can take several seconds while OpenFreeMap tiles arrive; the sheet shows loading in the meantime.

### 2026-10-30 — P2a follow-up: packed names → memory gate passes (**P2a done**)
- **Agent:** Codex (code + tests); Claude reviewed, made one change, and reran Verify. Jared chose "pack the names" over raising the gate.
- **Did:** New `core/packed.js`: `packJsonArray(bytes)` indexes each element's byte range in one scan, without creating strings; `get(i)` runs `JSON.parse` on just that slice. `load.mjs`, `worker.js` and `protocol.js` use it (`a.way_names.get(w)`, `a.trip_labels.get(t)`; an empty or null name shows as `null`). `trip_labels` elements turned out to be objects, so the scanner also accepts objects. Claude made that `{allowObjects: true}` for every `json_arrays` entry (all from our exporter) instead of a `'trip_labels'` name check repeated in two files.
- **Changed:** `site/playground/core/{packed.js,load.mjs,protocol.js}`, `site/playground/core/test/{packed.test.mjs,protocol.test.mjs}`, `site/playground/worker.js`, `PLAN.md` (P2a file list, by Claude).
- **Verify (Claude reran):**
  - `make bench-js` ×3 → `memory_gate_pass: true` each time; RSS after 50 edits 273,367,040 / 268,419,072 / 279,822,336 B (limit 300,000,000); heapUsed after GC 5.50 MB (was 11.7 MB with parsed names).
  - `make test` → `264 passed in 39.53s`, JS `# tests 78` `# pass 78`; `make lint` clean.
  - `ship_playground_data.py --check` OK.
  - Transfer: data 9,664,256 + own code gzip -9 14,559 (now with `packed.js`) + MapLibre 220,135 = **9,898,950 B** (headroom 101,050).
- **Gotcha (found before the P2a commit):** `.gitignore` line 1 `data/` matched every directory named `data`, so `site/playground/data/` was ignored and `git add` would refuse it. Changed to `/data/` (repo root only). `git check-ignore` confirms the root `data/` is still ignored and `site/playground/data/` no longer is; no other `data` directory exists in the tree.
- **Review (Claude):** the scanner is spec-correct for the cases that matter. A backslash always consumes the next byte, and `\u` checks 4 hex digits, so a quote inside a string can't end it early. The 500-array fuzz round-trips with `JSON.stringify`. Out-of-range `get` throws `RangeError`. No findings beyond the `allowObjects` unification.

### 2026-10-30 — P2a: shipped data, worker, spike removal (**not done: memory gate fails**)
- **Agent:** Codex (`codex exec --sandbox workspace-write`, code + tests); Claude ran the real export and the shipping script, reviewed the diff with two small fixes and a rename, and reran Verify.
- **Did:**
  - Exported 261027 to `data/playground-261027/` (`export-playground --order routingkit`: 134.34 s real, peak 4,889,163,072 B; `--write-presets`: 103.62 s, `presets.json.gz` gzip 12,357 B), then `scripts/ship_playground_data.py` copied the 24 shipped files into `site/playground/data/`. `cch_order_input.bin` and `cch_order_output.bin` stayed behind.
  - New: `core/protocol.js` (load / pick stub / edit / reset; display fields `ways`, `hit_geojson`, per-row `trip_label`, `trip_ms`), `core/latest.js`, `worker.js` (feature checks, fetch, sha256, lengths, order rule, in-order queue), `core/test/protocol.test.mjs`. `cch_bench.mjs` moved to `core/test/` with an export-dir argument; `make bench-js`. Spike files and the two spike scripts deleted; the untracked spike notes moved to `data/playground-spike/notes/`.
- **Changed:** `scripts/ship_playground_data.py`, `site/playground/{worker.js,data/}`, `site/playground/core/{protocol.js,latest.js}`, `site/playground/core/test/{protocol.test.mjs,cch_bench.mjs}`, `Makefile`; deleted `site/playground/spike/*` (tracked), `scripts/playground_spike.py`, `scripts/serve_spike.py`.
- **Verify (Claude reran):**
  - `python scripts/ship_playground_data.py --check site/playground/data` → OK; 24 files = `meta.json` + its 23 listed files.
  - Largest file `geometry_coords.bin.gz` 2,850,841 B; all ≤ 5,000,000 B.
  - Transfer rule: data 9,664,256 B (directory sum = `meta.total_shipped_bytes`) + own code gzip -9 13,349 B (`worker.js`, `core/{cch,engine,latest,procedure,protocol}.js`; no page yet) + MapLibre 220,135 B = **9,897,740 B ≤ 10,000,000** (headroom 102,260 B).
  - Privacy: no `/Users/`, `/home/`, `jarednarvaez` or `jarjar` in any decompressed shipped file.
  - `make test` → `264 passed in 38.78s`, JS `# tests 61` `# pass 61`; `make lint` clean.
  - **`make bench-js` → `memory_gate_pass: false`.** After 50 toll-plaza edits RSS was 353,845,248 / 320,176,128 / 335,872,000 B (three runs; limit 300,000,000).
    - The old P1c bench (from git, `node-data.mjs`) on the spike data today: 274,841,600 / 269,942,784 B, pass.
    - The new loader on the spike data: 326,483,968 B, fail. The new loader on the shipped data with `json_arrays` removed from `meta.json`: 266,108,928 / 273,154,048 B, pass.
    - **Cause:** `load.mjs` (and the worker) parse `way_names` (180,633 strings) and `trip_labels`; the old bench loader never did. heapUsed after GC 11.7 MB vs 5.5 MB, and RSS retention over 50 edits rises from ~55 MB to ~100 MB. Live bytes stay flat (113.28 → 113.06 MB), so it isn't a leak. The browser page needs the names, so the shipped page's footprint is the higher one; P0c's browser acceptance didn't load names either.
- **Review (Claude, diff + PLAN P2a):**
  1. *Fixed:* `protocol.js` overwrote the engine's attribution `label` with the trip label (renaming the former to `attribution_label`). That invites P2c bugs and changes what `canonical()` sees. Now `label` is untouched and the trip label is `trip_label`; the test was updated.
  2. *Fixed:* `worker.js` fetched `meta.json` twice (it is listed in `meta.files`).
  3. *Fixed:* `cch_bench.mjs` had an `import` below a `const`.
  4. Not fixed (minor): `protocol.js` builds a second `createProcedure` (~5 MB) beside the engine's, for `path` and `hitWays`; `engine.js` doesn't expose its own. That's outside P2a's files.
  5. The worker's in-order queue is untested in Node (it needs `fetch`); P2d's harness drives the real worker.
- **Gotchas:** `meta.json` has `git_dirty: true` because untracked `.claude/` and `.codex/` count in `git status --porcelain`. Codex's sandbox can't write `.git/index`, so the moves and deletions are unstaged.

### 2026-10-30 — Portable fixture gzip (fix outside PLAN, Jared approved)
- **Agent:** Claude (small fix, no Codex). Not independently reviewed.
- **Did:** CI run 41115457353 failed `test_fixture_builder_is_deterministic_and_committed` on `('stomp', 'cch_order.bin.gz')`, the first `.gz` file checked. `gzip.compress` takes the header's OS byte from zlib: `0x13` on this Mac (zlib 1.2.12), `0x03` on Linux. New `playground.gzip_bytes` writes a fixed header (mtime 0, XFL 2, OS 255) around a level-9 raw deflate stream plus CRC32/ISIZE; `_write_gzip` uses it, and the `gzip` import is gone from `playground.py`. Regenerated the 12 fixtures with `python tests/build_playground_fixtures.py`. The spike exporter (`scripts/playground_spike.py`) is unchanged; its data isn't committed.
- **Changed:** `src/route_impact/playground.py`, `tests/fixtures/playground/*/` (every `.gz` + `meta.json`; no `expected.json` changed), `PROGRESS.md`.
- **Verify (Claude):** `gzip_bytes` output equals `gzip.compress(raw, mtime=0)` except byte 10 (the OS byte), and round-trips, for empty, 1-byte, 100 kB random and 150 kB repetitive input. `cmp` on `stomp/edge_ms.bin.gz` old vs new: first difference at char 10; header `...0213` → `...02ff`. Only `.gz` and `meta.json` sha256 lines changed (276 files, 264+/264−). `make lint` clean; `make test` → `264 passed in 39.25s`, JS 47/47. Linux: CI run 41116882066 (`db3054f`, Ubuntu) → `264 passed in 58.88s`, JS 47/47 — the committed fixtures now match a Linux rebuild.
- **Gotchas:** Bay exports made before this fix have different `.gz` sha256s; re-export before comparing hashes.

### 2026-10-30 — Daily download retry + Node 24 actions (fix outside PLAN, Jared approved)
- **Agent:** Claude (small fix, no Codex). Not independently reviewed.
- **Did:** The first scheduled Daily run (41051491538) downloaded 261028, got 404 for 261029 (unpublished), waited 1200 s, then got HTTP 502 on the checksum manifest and exited 1 — `daily.sh` only retried "not published". `download.sh` now passes `--retry 3 --retry-delay 30` to both curls and reports HTTP 000/5xx as "Geofabrik temporarily unavailable"; a failed pbf transfer says "temporarily unavailable" too (the `.part` file resumes). `daily.sh` retries both messages on scheduled runs. Workflows: `checkout@v5`, `setup-python@v6`, `cache@v5` (the lowest majors on `node24`, checked in each `action.yml`), clearing the Node 20 deprecation warning. `setup-node@v4` → `@v5` is left for a separate commit on `playground` (main has no Node step).
- **Changed:** `scripts/download.sh`, `scripts/daily.sh`, `.github/workflows/daily.yml`, `.github/workflows/ci.yml`, `PROGRESS.md`.
- **Verify (Claude):** fake `curl` on PATH returning each code: 404 → "not published on Geofabrik"; 502 and 000 → "Geofabrik temporarily unavailable (HTTP …)"; 403 → "Failed to fetch checksum manifest" (not retried); every call carried `--retry 3`. `daily.sh` with a fake download that prints the 502 message, `DAILY_RETRIES=2 DAILY_RETRY_SECONDS=0`: "Snapshot 261028 unavailable; retrying in 0 seconds" then "unavailable after 2 attempts". `bash -n` OK; `make lint` clean; `make test` → `264 passed in 39.93s`, JS 47/47. The patch `git apply --check`s cleanly on `main`. Workflow changes not run on GitHub yet.
- **Gotchas:** today's run would have failed anyway — Geofabrik hasn't published 261029 (see Current state item 4). Retries are bounded: 3 curl retries × 30 s inside each of `DAILY_RETRIES` (3) attempts 1200 s apart.

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
