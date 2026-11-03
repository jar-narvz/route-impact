# P5c review triage (Claude, 2026-11-03)

Sources: `review_design.md` (D1–D12) and `review_qa.md` (Q1–Q7), two fresh subagents with no history. Every finding is accepted or rejected with a reason. Fixes go to Codex in one brief (P5c-1); Claude re-verifies in headless Chrome.

## QA

| # | Finding | Decision | Reason / fix |
|---|---|---|---|
| Q1 | Offline theme switch blanks the map; `Style is not done loading` on taps | **Accept** | A failed style must keep the old style (or show the basemap error) and nothing may query an unloaded style. Guard fx `sink`/`querySourceFeatures` and map taps on `isStyleLoaded()`. |
| Q2 | Start leaves focus on `<body>` | **Accept** | Spec §5 says focus moves to the selected weapon. Focus after the visibility transition ends (or on `transitionend`), and also after a share-link entry. |
| Q3 | 812×375: collapsed card clipped, Details unreachable, tap fell through to the map | **Accept** | The P5b-6 fix covered only the open state. The collapsed card must fit at 375 px tall. |
| Q4 | Bay Bridge preset after a load error shows internal text and a false invalid-link notice | **Accept** | Presets are disabled outside the ready phases; Retry clears notices; internal message strings never reach the UI. |
| Q5 | Non-share hash (`#about`) pulls the visitor into the game ~9 s later | **Accept** | Only `#stomp=`, `#flip=` and `#meteor=` hashes count as share links; anything else is ignored. |
| Q6 | A miss after a result leaves the old edit in the URL | **Accept** | Clearing the screen also clears the hash (`history.replaceState`). Remove the dead branch. |
| Q7 | Load-failure copy shows `TypeError: Failed to fetch`; home shows no failure | **Accept** | Plain copy ("Couldn't load the road data. Check your connection and retry.") and the error plus Retry on the home screen too. |

## Design

| # | Finding | Decision | Reason / fix |
|---|---|---|---|
| D1 | Root-cause rows indistinguishable ("Dwight D. Eisenhower Highway + …"); the Bay Bridge preset credits 1 road | **Accept** | The core story. Row headline = the group's name, plus a distinguishing secondary part (the next distinct name, a ref, or a nearby place) that is never cut by the ellipsis. "Several roads together" becomes a real ranked row, not a footnote line. |
| D2 | Light theme: traffic invisible, detours too thin | **Accept** | Light theme uses ink streaks (dark gray, normal blending). Detour width 3 px per spec. |
| D3 | Orange meteor and debris break monochrome; amber means "slowed" | **Reject (partly)** | Warm light in the fall and impact is allowed by spec §6 (fire is physical, not data) and fades before the result settles. Accepted part: no amber on anything that stays after the reveal; persistent debris and embers fade to neutral gray. |
| D4 | Flip turns the road broken-red and shows no new direction; copy says "rerouted around"; "Affected trips (0)" for 6 trips | **Accept** | A flipped road isn't broken. Draw it white with static direction arrows in the new direction. Copy: "Flip reversed <name>". Affected-trips count must match the trips shown. |
| D5 | Light home: map labels collide with the headline; the Bay box crosses the copy | **Accept** | Hide the Bay box and map labels while on home (or a stronger scrim in light). |
| D6 | "0 BROKEN" in red; "+102 MIN" unlabeled; Details alone on a row | **Accept** | A zero count uses the neutral fg color. Label becomes "ADDED MIN". Details sits on the summary line. |
| D7 | "101 mattered" jargon; "Show all 12" unexplained | **Accept** | "Meteor hit 155 roads. 101 of them carried trips." The button says "Show all 12 groups". |
| D8 | Details sheet is a fixed 70 dvh, covers the map, empty for Flip | **Accept** | Height fits the content, capped at 70 dvh. |
| D9 | Meteor red roads extend beyond the circle | **Reject** | The model closes whole OSM ways that touch the circle (DESIGN.md). Clipping the drawing would misstate what was closed. Instead, one line in details: "Whole roads close if any part is inside the circle." |
| D10 | Meteor size radios look like a form | **Accept** | Segmented control that matches the weapon dock. |
| D11 | Traffic is noise at z10 and disappears at z15 | **Accept (partly)** | z15 in dark was fixed in P5b-5; z15 light is D2. At z ≤ 11, lower the streak alpha and show only motorway/trunk. |
| D12 | Attribution "i" floats mid-map and jumps with the card | **Accept** | Pin it to the top-left under the back button (or the bottom-left corner above the card), with no movement. |

## Round 2 (after the P5c-1 re-checks)

The QA re-check found Q1–Q7 fixed and no regressions in the earlier checks, plus 3 new bugs. The design re-check found D3, D5, D6 and D8 fixed; D1, D2, D4, D11 and D12 partly fixed; D7 and D10 worse. All of the following are **accepted**:

| # | Finding | Fix |
|---|---|---|
| N1 | `#preset=bay_bridge` share links no longer replay (regression from Q5) | `isShare` accepts every hash `core/share.js` writes, including `#preset=`. Add an app test that round-trips every share kind. |
| N2 | After a failed theme fetch with a result showing, the basemap error is hidden and the UI theme no longer matches the map | Roll the UI theme back when the style fetch fails, and show the error where it is visible while the card is up (a toast above the card). |
| N3 / D10 | The selected Meteor size is invisible (1.1–1.3:1) | The selected segment uses the same treatment as the selected weapon (inverted fg/bg), ≥ 3:1 for non-text. |
| D7 | "Bay Bridge hit 10 roads. 1 of them carried trips." contradicts the 170-trip row | Drop the road-count clause. The sentence is "<Weapon> hit N roads." Counts live in the rows. |
| D1 | Meteor rows share one headline told apart only by raw OSM ids, and one repeats its id | Never show an OSM id as a name. Rows with the same headline merge into one row (distinct-trip union, summed road count). Unnamed roads read "Unnamed road", with the OSM link icon as the only id. |
| D4 | No direction arrows; a flipped road looks like a rerouted path; copy repeats and gets truncated | Persistent fx chevrons along the flipped road in the new direction (static under reduced motion), and a dashed white line. Copy "Flip reversed <name>." on one line, not repeated. |
| D2 / D11 | Light theme z15 shows no cars | Light-theme ink streaks have the same pixel floors as dark ones. Verify at z15. |
| D12 | The "i" floats alone on the home screen and pokes out behind the open card | Hide it on home. On mobile it sits under the card's z-index, or the card covers it. |
| new | A 1-trip row's bar shrinks to a dot | Bars have a minimum width of 8 px, or are hidden when the row is the only one. |

## Round 3 (after the P5c-2 re-checks)

The QA re-check found N1–N3 fixed and Q1–Q7 still fixed. The design re-check found everything fixed except D2/D11 at z15. All of the following are **accepted**:

| # | Finding | Fix |
|---|---|---|
| D2 / D11 | z15 traffic is empty in light and sparse in dark | Debug with captures (the visual loop isn't available to Codex). |
| R1 | Merged Meteor rows overcount roads (90 + 73 + 36 + 3 = 202 > 155 hit) | Count distinct ways across a merged row, as trips already are. |
| R2 | "Flip reversed Unnamed road." | "Flip reversed an unnamed road." |
| N4 | At 1280×800 the basemap error banner covers the weapon buttons | On desktop the banner sits inside the panel flow or over the map area, never over controls. |

## Codex review of round 3

| # | Finding | Decision | Reason / fix |
|---|---|---|---|
| C1 | A rotated view's bounding box recycles cars onto off-screen roads | **Reject** | Rotation is disabled (`dragRotate: false`, `touchZoomRotate.disableRotation()`), so bearing is always 0. The pitched-view trapezoid's extra corners are a small known overshoot. |
| C2 | Shrinking below 900 px keeps 6,000 cars | **Accept** | `recycle()` now enforces the current cap (Claude, 2-line fix). Checked in headless Chrome: 6,000 cars at 1280 px → 3,000 after resizing to 600 px. |
