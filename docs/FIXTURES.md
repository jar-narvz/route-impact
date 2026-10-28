# Test fixture design (Step 1)

Claude-owned design for `tests/fixtures/`. Codex builds the files from this; Claude reviews against it.

## 1. How expected values are computed
**Decided (Jared, 2026-10-28):** travel times and vertex/edge counts in `expected.json` come from `scripts/fixture_oracle.py`, a plain-Python Dijkstra over the fixture XML (haversine, R = 6,371,008.8 m; tagged `maxspeed` in mph; the drivable/access/direction rules of DESIGN §5.3–5.4). It must not import anything from `src/route_impact/`. Kept/excluded way ids, which trips break or slow, and culprits are hand-written below, and the oracle checks them.
*Why:* haversine lengths on lat/lon grids aren't exactly hand-computable, and an independent re-implementation still catches bugs in the real SQL + scipy pipeline. *Risk:* if the oracle and the pipeline share a misreading of a rule, both are wrong together. The hand-written structural answers below are the guard.
**Isolation check:** for each `town_v2` edit, the oracle applies that edit **alone** to v1. A trip's culprit is the only edit that changes its time. If two edits change one trip, the fixture is redesigned rather than the expectation fudged.

## 2. Nodes
Every way carries an explicit `maxspeed` (mph). Lat grows north, lon grows east.
- **Grid** 5×5, id `1RC` (R = row 0–4 south→north, C = col 0–4 west→east): lat `37.800 + 0.005·R`, lon `-122.300 + 0.005·C`. Ids 100–144.
- **Motorway** 200–204: lat 37.8275, lon = grid cols 0–4.
- **Roundabout ring** (east of grid, around lat 37.810, lon -122.274): 300 W (37.8100, -122.2755), 303 S (37.8090, -122.2740), 302 E (37.8100, -122.2725), 301 N (37.8110, -122.2740). Plus 310 (37.8100, -122.2700) east exit end, 320 (37.8125, -122.2740) north spur end.
- **Bridge** 500 (37.8030, -122.2930), 501 (37.8070, -122.2890).
- **Parallel detour** 600 (37.8160, -122.2975), midway between 130 and 131, 0.001° north.
- **Island** 400 (37.7950, -122.2800), 401 (37.7950, -122.2750).
- **Spur ends** 700 (37.7970, -122.2900), 701 (37.8150, -122.2900), 702 (37.8050, -122.2770), 703 (37.8230, -122.2950).
- **Lollipop** 800 (37.8170, -122.2830), 801 (37.8190, -122.2840), 802 (37.8190, -122.2820).
- **Places** (not on any way): 900 `Westville` (37.7990, -122.3010) pop 12000; 901 `Easton` (37.8105, -122.2695) pop 8000.

## 3. Ways
Grid streets are `residential` 25 mph, except **row 2 (id 12) and col 2 (id 22) are `tertiary` 35 mph** ("Main St"/"Center Ave"). That makes 122 the only fast turn, so disconnecting it changes times (a plain grid has too many equal-cost paths).

| Id | Feature | Nodes | Tags | Kept? |
|---|---|---|---|---|
| 10–14 | grid rows 0–4 | 1R0→1R4 | residential 25 (12: tertiary 35) | yes |
| 20–24 | grid cols 0–4 | 10C→14C | residential 25 (22: tertiary 35) | yes |
| 23 | `oneway=-1` street | 103→143 | residential 25, `oneway=-1` (southbound only) | yes |
| 30 | motorway | 200→204 | motorway 65, `oneway=yes` | yes |
| 31 | on-ramp | 140→201 | motorway_link 35, `oneway=yes` | yes |
| 32 | off-ramp | 203→143 | motorway_link 35, `oneway=yes` | yes |
| 40 | roundabout, **no `oneway` tag**, closed way | 300→303→302→301→300 | primary 25, `junction=roundabout` | yes (implied one-way, counter-clockwise) |
| 41 | roundabout connector | 124→300 | residential 25 | yes |
| 42 | east exit | 302→310 | tertiary 30 | yes |
| 43 | north spur (makes 301 a vertex) | 301→320 | residential 25 | yes |
| 50, 51, 52 | bridge approach / **bridge over row 1, no shared node** / approach | 101→500, 500→501, 501→123 | secondary 50; 51 adds `bridge=yes layer=1` | yes |
| 53 | parallel to row 3 between 130 and 131 | 130→600→131 | tertiary 35 | yes (beats 13's 130→131, per oracle) |
| 54 | self-intersecting (lollipop) | 133→800→801→802→800 | residential 25 | yes (800 repeated → vertex) |
| 55 | island access road | 104→400 | residential 25 | yes |
| 56 | island street | 400→401 | residential 25 | yes |
| 60 | `service` | 102→700 | service 15 | **no** |
| 61 | `access=private` | 132→701 | residential 25, `access=private` | **no** |
| 62 | `vehicle=no` | 141→703 | residential 25, `vehicle=no` | **no** |
| 63 | `access=no` + `motorcar=yes` | 114→702 | residential 25, `access=no`, `motorcar=yes` | yes |

## 4. `town_v2` edits (each with its expected effect)
`town_v2.osm` = v1 plus exactly these five edits. Edit ids are used as culprit labels in `expected.json`.

| Edit | Change | Expected effect |
|---|---|---|
| E1 bridge deleted | remove way 51 (approaches 50, 52 stay) | T1 **slowed**: reroutes over the grid |
| E2 one-way flipped | way 23: `oneway=-1` → `oneway=yes` | T2 **slowed**: can't go south on col 3 |
| E3 intersection disconnected | way 22 uses new node 1220 (same coords as 122) in place of 122; way 12 keeps 122 | T4 **slowed**: no Main St ↔ Center Ave turn |
| E4 maxspeed lowered | way 41: 25 → 10 mph | T3 **slowed** |
| E5 island | remove way 55 | T5 **broken**: 400–401 has no link to the rest |

## 5. `town_v2_split` edits (must produce zero impact)
`town_v2_split.osm` = v1 plus only these. Every directed segment `(a → b)` and its cost is unchanged, so all trips are unchanged and no culprit is reported (DESIGN §5.13).

| Edit | Change | Why segments don't change |
|---|---|---|
| S1 split | way 10 → way 10 (100→102) + new way 70 (102→104), same tags | same node pairs |
| S2 merge | ways 55 + 56 → one way 55 (104→400→401), same tags | same node pairs |
| S3 new mid-road junction | new way 71: 600→611 (611 at 37.8170, -122.2975), residential 25 | 600 becomes a vertex and edge 53 splits, but its segments are untouched. The new spur only adds options and can't slow a trip |

## 6. Named trips and expected outcomes
Endpoints are node ids. Times on v1/v2 come from the oracle. "Status" and "culprit" are hand-written, and the oracle's isolation check (§1) must agree.

| Trip | From → to | Exercises | v2 status | Culprit |
|---|---|---|---|---|
| T1 | 101 → 123 | bridge (fast diagonal) | slowed | E1 / way 51 |
| T2 | 133 → 113 | `oneway=-1` (two blocks of col 3, southbound) | slowed | E2 / way 23 |
| T3 | 124 → 310 | connector, roundabout W→S→E | slowed | E4 / way 41 |
| T4 | 120 → 142 | fast turn at 122 | slowed | E3 / node 122 |
| T5 | 100 → 401 | island | broken | E5 / way 55 |
| T6 | 320 → 310 | roundabout direction: must go N→W→S→E (3 arcs), not N→E (1 arc) | unchanged | — |
| T7 | 130 → 131 | parallel ways: picks way 53 | unchanged | — |
| T8 | 114 → 702 | `access=no` + `motorcar=yes` is routable | unchanged | — |
| T9 | 140 → 144 | control | unchanged | — |

Structural assertions (hand-written, checked by the oracle and later by Step 2 tests):
- Kept ways: all except 60, 61, 62. Excluded: 60 (service), 61 (private), 62 (`vehicle=no`).
- Vertices include 800 (repeated in way 54), 300 (closed way 40), 301 (spur 43). Neither 500 nor 501 is shared with way 11 (grade separation).
- On v1 no route uses col 3 (way 23) northbound, because `oneway=-1` makes it southbound only.
- v1 compared with v1: zero broken, zero slowed.
- The motorway and ramps (30–32) are on no named trip's shortest path, because the grid is faster for every pair the oracle searched (first design used 140 → 103, and the isolation check caught that it never touched col 3). They are covered structurally only: Step 2 tests assert their edges are one-way.

## `expected.json` shape
```json
{
  "versions": {"town_v1": {"vertices": 0, "edges": 0, "kept_ways": [], "excluded_ways": []}, "town_v2": {}, "town_v2_split": {}},
  "trips": {"T1": {"from": 101, "to": 123, "seconds": {"town_v1": 0.0, "town_v2": 0.0, "town_v2_split": 0.0}, "v2_status": "slowed", "culprit": {"edit": "E1", "way": 51}}},
  "self_compare": {"broken": 0, "slowed": 0}
}
```
Unreachable = `null`. Times are rounded to 0.01 s, and tests compare with tolerance 0.05 s.
