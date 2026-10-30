# route-impact
[![CI](https://github.com/jar-narvz/route-impact/actions/workflows/ci.yml/badge.svg)](https://github.com/jar-narvz/route-impact/actions/workflows/ci.yml)

Measures how a day of OpenStreetMap edits changes navigation in Northern California.

Every day it takes two consecutive [Geofabrik](https://download.geofabrik.de/north-america/us/california/norcal.html) snapshots, builds a road graph from each, routes the same fixed set of trips on both, and reports which trips **broke** (no route any more) or got **slower**. Each affected trip is traced to the map edit that caused it, and the day gets a risk level: LOW, MEDIUM or HIGH. A HIGH day opens a GitHub issue, and closing that issue is the human sign-off. The idea is a release gate for map data: before a day's edits ship to a navigation product, someone should know which routes they change.

Real breakages are rare, so the tool is also evaluated by **fault injection**: it deliberately breaks real roads (deletes a bridge, flips a one-way, disconnects an intersection) and checks whether it names the right culprit.

**Results map:** https://jar-narvz.github.io/route-impact/site/?date=2026-10-28 · daily reports live in [`results/`](results/).

**Fault playground:** https://jar-narvz.github.io/route-impact/site/playground/: break Bay Area roads yourself and watch the sampled trips reroute, live in your browser.

## Quickstart
Needs Python 3.11+ and GNU Make. `make setup` installs DuckDB's `spatial` extension once (network needed).

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
make setup
make test                               # fixtures only: no network, no big file
make download DATE=261026               # dated NorCal snapshot, checksum-verified (~650 MB)
make download DATE=261027
make impact OLD=261026 NEW=261027       # -> results/2026-10-27/
```

Other commands:
- `route-impact what-if --snapshot 261027 --delete-way <id>` (also `--flip-oneway`, `--disconnect-node`): what would this one edit break?
- `make faults SNAPSHOT=261027 N=200 SEED=2027`: the fault suite, written to `results/faults/261027/`.
- `make bench SNAPSHOT=261027`: timings and peak memory, written to `results/2026-10-27/metrics.json`.

`route-impact impact` exits **0** for LOW/MEDIUM, **1** for HIGH and **2** for a tool error, so a crash is never mistaken for a quiet day. The daily workflow calls the CLI directly rather than `make`, because Make turns every failure into exit 2.

## How it works
Full design with the reasoning behind each decision: [docs/DESIGN.md](docs/DESIGN.md).

1. **Extract** (DuckDB + `spatial`, `ST_ReadOSM`). SQL pulls drivable, publicly accessible ways, their nodes, and city/town nodes into one DuckDB file per snapshot. Service roads (driveways, parking aisles) are left out. Car access follows OSM precedence: `motorcar` → `motor_vehicle` → `vehicle` → `access`.
2. **Graph** (`scipy.sparse.csgraph`). Vertices are junctions and way ends. Edges are runs of **segments**, where a segment is one directed step `a → b` between consecutive nodes, with its own length and travel time. Speed comes from `maxspeed` or from a per-class default in [`config/speeds.toml`](config/speeds.toml). Motorways and roundabouts are treated as one-way unless tagged otherwise.
3. **Trips** ([`config/trips.csv`](config/trips.csv), committed). There are two sets:
   - **Intercity:** every ordered pair of the 61 places with population ≥ 50,000, weighted by `pop_A × pop_B`, so SF ↔ San Jose counts for more than two small towns.
   - **Local:** 2,000 seeded random trips of 2–30 km. Freeways are redundant, so real breaks tend to happen locally.

   Trips are stored as coordinates, not node ids, so the same set works for months of snapshots.
4. **Snapping.** On OLD, each endpoint snaps to the largest strongly connected component. On NEW it keeps the **same node** and routes on the **full** graph. If NEW's component were used instead, a newly cut-off destination would slide onto a surviving road and the break would disappear.
5. **Incremental reroute.** The tool compares segments, not ways: a segment is *changed* if NEW lacks it or has it slower. Only trips whose OLD path uses a changed segment get rerouted. This is exact, not approximate: if every segment on the old path still exists at the same or lower cost, the trip can't break or get slower. Tests check that incremental equals full recompute. Comparing segments also means a pure way split or merge counts as no change at all.
6. **Root cause by counterfactual.** For each affected trip, the changed segments on its old path are grouped into candidate edits (deleted or changed way, disconnected node). A candidate is **confirmed** only if putting back just that edit's OLD segments lets the trip recover. If no single edit does, contiguous runs of edits are tried. If nothing confirms, the trip is labelled *joint cause* rather than forced onto one culprit.
7. **Risk + outputs.** Each day writes `results/<date>/impact.json` (the source of truth), `report.md`, and `impact.geojson` (capped at 25 trips) for the [static Leaflet map](site/index.html). Thresholds live in [`config/thresholds.toml`](config/thresholds.toml):
   - **HIGH:** any broken intercity trip, ≥ 10 broken local trips, or ≥ 0.5% of gravity-weighted intercity travel slowed by ≥ 5 min.
   - **MEDIUM:** any broken trip, or any intercity trip slowed by ≥ 2 min.
   - **LOW:** otherwise.

A GitHub Actions workflow runs this every day at 06:00 UTC on yesterday's snapshot pair. It commits the results, opens an issue on HIGH, and publishes the map to GitHub Pages.

## Results on real snapshots
Five consecutive days of Geofabrik NorCal snapshots, 5,660 trips each (3,660 intercity + 2,000 local). Source: `results/<date>/impact.json`.

| NEW date | OLD → NEW | Risk | Broken | Slowed ≥ 2 min | Rerouted | Got faster | Changed segments on trip paths |
|---|---|---|---|---|---|---|---|
| [2026-10-24](results/2026-10-24/report.md) | 261023 → 261024 | LOW | 0 | 0 | 54 | 4 | 22 |
| [2026-10-25](results/2026-10-25/report.md) | 261024 → 261025 | LOW | 0 | 0 | 10 | 5 | 49 |
| [2026-10-26](results/2026-10-26/report.md) | 261025 → 261026 | LOW | 0 | 0 | 39 | 1 | 25 |
| [2026-10-27](results/2026-10-27/report.md) | 261026 → 261027 | LOW | 0 | 0 | 142 | 5 | 29 |
| [2026-10-28](results/2026-10-28/report.md) | 261027 → 261028 | LOW | 0 | 0 | 19 | 2 | 81 |

The 2026-10-28 row came from the scheduled GitHub Actions job; the others were run locally. Every day changed segments on some trips' paths, and the reroute found an equally fast or faster alternative each time. That's what most days look like, and it's why the fault suite below exists.

**Benchmark** (`results/2026-10-27/metrics.json`: one full 261026 → 261027 run on an Apple M3 Max with 36 GB RAM; DuckDB 2.0.0 with `threads = 2` and `memory_limit = 2GB`):

| | |
|---|---|
| Input | 654,880,314 B `.osm.pbf`: 79,670,984 nodes, 7,763,376 ways, 85,234 relations |
| Drivable ways | 535,394 |
| Graph | 726,182 vertices, 1,660,020 edges; largest strongly connected component 716,812 vertices |
| Time per snapshot | extract 18.31 / 18.85 s · graph 26.33 / 30.20 s · prepare 23.88 / 20.76 s (OLD / NEW) |
| Time for the comparison | route 299.54 s · segment diff 0.34 s · root cause ≈ 0 s (no affected trips) |
| Pipeline total | 438.23 s (448.46 s wall) |
| Peak RSS | 9,797,926,912 B (`/usr/bin/time -l`) |

Routing dominates the run. On GitHub's hosted runner, the scheduled daily job for 2026-10-28, including downloading both snapshots, finished in 9 min 15 s.

### Example: a deletion that is not a breakage (US 199)
On 26 → 27, ways [`1566890644`](https://www.openstreetmap.org/way/1566890644) and [`1566890645`](https://www.openstreetmap.org/way/1566890645) on US 199 (Redwood Highway, near Crescent City) were deleted in a cleanup edit. A gate that counts edits ("2 highway ways deleted") would flag this. But both were short stubs whose node pairs live on in other ways, and running the tool's own segment diff on just those two ways finds **0 changed segments**: both `a → b` steps still exist in 261027 at the same travel time. So no trip is rerouted, no culprit is named, and the day stays LOW, which is correct, because the road is still drivable. This is why segments are compared, not ways.

## Evaluation: injected faults
200 seeded faults (seed 2027) injected one at a time into snapshot 261027, plus the same 200 regrouped into 20 batches of 10. Faults are sampled only from roads that lie on at least one trip's path, since a fault on an unused road correctly changes nothing. Source: [`results/faults/261027/scores.json`](results/faults/261027/scores.json); the fault list is in `faults.json` next to it.

| Score | Result | What it means |
|---|---|---|
| Incremental = full recompute | **22 / 22** | Correctness check on the reroute shortcut. It ran on every 10th run, not all 220, because the full recompute dominates the run time (mean 290.41 s vs 28.50 s for incremental on those 22 runs). |
| Root cause, single faults | **355 / 355** affected trips | The top-ranked confirmed culprit was the injected fault. |
| Root cause, batches of 10 | **355 / 355** affected trips | Same, with 9 other injected faults in the graph at the same time. |
| Joint-cause trips | 0 | No trip needed more than one edit to explain it. |
| Impact rate | **19 / 200** faults (9.5%) | Faults that broke or slowed at least one trip by ≥ 2 min. This measures the **road network's redundancy**, not the tool's accuracy. |

By fault type (single runs):

| Fault | Injected | Affected ≥ 1 trip | Affected trips |
|---|---|---|---|
| `delete_bridge` | 29 | 6 | 134 |
| `delete_way` | 29 | 3 | 105 |
| `flip_oneway` | 29 | 2 | 100 |
| `add_oneway` | 29 | 5 | 9 |
| `disconnect_node` | 28 | 3 | 7 |
| `bad_maxspeed` | 28 | 0 | 0 |
| `downgrade_class` | 28 | 0 | 0 |

**How to read this honestly:**
- The 355 trips come from only 19 faults, so they aren't 355 independent tests. The four biggest faults account for 306 of them (103, 99, 61 and 43 trips).
- The batch score covers the same 355 trips, because the batches regroup the same 200 faults.
- Slowing a single way (`bad_maxspeed`, `downgrade_class`) never pushed a trip past the 2-minute threshold. A detour of similar length was always nearby.
- The root-cause score only covers **connectivity-type faults** (deleted ways and bridges, one-way changes, disconnected nodes), because those were the only ones that affected a trip. It says nothing about attributing slowdowns.
- These are scores on **injected** faults, not a real-world catch rate.

Each single run took 125.96 s on average, after a one-time 18.19 s extract and 309.80 s of baseline routing, on the Mac described below.

## Fault playground
The same method as a game you run in the browser. Pick **Stomp** (delete the road you tap), **Flip** (reverse a one-way) or **Meteor** (delete every road within 500 m of the tap). The page reroutes the affected sampled trips and shows how many broke, how many slowed by 2 minutes or more, the added minutes, and which destroyed roads actually mattered: the same restore-one-edit root cause as the daily pipeline.

- **What it routes:** the Bay Area box (37.2–38.1° N, 122.6–121.7° W) from snapshot 261027: 213,910 vertices, 551,760 directed edges and 180,633 OSM ways, with 2,057 sampled trips fully inside the box (`site/playground/data/meta.json`). Python exports the graph with the pipeline's own road rules; the browser never rebuilds it.
- **How it's fast enough:** exact routing with customizable contraction hierarchies (CCH) in plain JavaScript, inside a Web Worker. An edit only re-customizes the changed part of the hierarchy. The node order is computed offline with RoutingKit. Shipped data is 9,664,256 B gzipped.
- **How it's checked:** an independent Python oracle fully recomputes every case on the same exported graph. On a frozen set of 15 cases (both presets as live edits, 10 seeded Stomps, 3 Meteors) the browser matched it 15/15, and 75/75 drawn routes were valid against the shipped arrays (`results/playground/p2_browser_check.json`). In that run the worker answered each case in 93.8 ms or less, and 50 Meteor/Rebuild cycles through the real page stayed flat (median 117.6 ms from tap to drawn result; MacBook Pro M3 Max).
- **Example:** deleting both Bay Bridge spans (10 ways) breaks 2 of the 2,057 sampled trips and slows 169 by 2 minutes or more, adding 2,859 minutes in total (`results/playground/p2_oracle.json`).

Playground limits:
- **One frozen snapshot and a bounded box.** Detours outside the box don't exist, so some numbers are worse than on the full NorCal graph.
- **Sampled trips only.** "No sampled trip used these roads" doesn't mean an edit is harmless.
- **Not total traffic.** Added minutes are summed over the sampled trips delayed by 2 minutes or more; broken trips are counted separately, not as minutes.
- **Accessibility:** it works without a pointer (arrow keys plus Enter at a crosshair) and respects reduced motion. Results are announced through an ARIA live region; this has not yet been tested with a screen reader.
- Timings are from one laptop; phone performance hasn't been measured.

## Limitations
- **No turn restrictions, no traffic.** Routes use free-flow travel times from speed limits and class defaults. Turn-restriction relations are ignored, so a broken restriction is invisible and some routes are shorter than in reality.
- **Thresholds are provisional.** They were set against snapshots 261023–261027, which had almost no major-road change. That's too little history to calibrate on, so they need revisiting after a few weeks of daily runs.
- **Single-road slowdowns are mostly invisible.** A wrong speed limit or a downgraded road class on one road rarely delays any trip by 2 minutes, because routes go around it. In the fault suite, 0 of 56 such faults affected a trip. This is arguably correct (if no trip gets slower, navigation isn't hurt), but speed-tag vandalism is only caught on roads with no nearby alternative.
- **Injected faults are not a real-world catch rate.** The scores show the tool finds the culprit for faults *it injected* into the graph tables. They say nothing about how often real bad edits happen, or whether every kind would be caught.
- **Reversible roads** (`oneway=alternating|reversible`) are treated as two-way.
- **Service roads are excluded**, so an endpoint in a parking lot snaps to the nearest street, and a broken driveway is out of scope.
- **Trips are a sample.** A broken road that no trip uses is not reported. The fault suite samples only roads on at least one trip path for the same reason.
- Peak memory on GitHub's 16 GB runner has not been measured. The daily run completes there, but the peak RSS above is from a Mac.

## Repository layout
| Path | What |
|---|---|
| `sql/extract/` | SQL that builds `roads`, `road_nodes`, `places` (`drivable.sql` holds the drivable list) |
| `sql/faults/` | one mutation per fault type |
| `src/route_impact/` | CLI, graph, trips, impact, risk, root cause, report, faults, metrics |
| `config/` | speeds, thresholds, trips, demo faults |
| `site/index.html` | static results map |
| `site/playground/` | fault playground: page, Web Worker, CCH engine (`core/`), shipped Bay data |
| `tests/browser/` | browser harness that checks the playground against the Python oracle (not shipped) |
| `results/` | daily outputs, fault suite scores, benchmark |
| `docs/DESIGN.md` · `PLAN.md` · `PROGRESS.md` | design and reasoning · build plan · build log |
