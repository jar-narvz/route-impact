# P5 playground: independent design review

Reviewer: independent product-design pass (Claude subagent), 2026-11-03. No code or docs edited.
Method: headless Chrome over CDP with the real GPU (`GPU=1`, `cdp_gpu.mjs`), at 375×812 (dpr 2, mobile emulation) and 1280×800 (dpr 1), dark and light. I captured: home (loading and ready), the Bay Bridge preset, ready state, traffic at zoom 10/13/15, Stomp (45473226), Flip (6320410) and a Meteor at 37.825,-122.315, each before, mid-animation (fx time scale 0.1) and after, plus details open on mobile.
Screenshots: `/private/tmp/claude-501/-Users-jarednarvaez-route-impact/e8b1b7ea-8545-4e74-aded-6cec906763b1/scratchpad/review_design/` (`<vp>_<theme>_<state>.png`; result text is in `<vp>_<theme>_info.json`).
Benchmarks: spec `docs/PLAYGROUND_UI.md` §4–§6, plus the checklists of no-ai-slop (specific copy, no filler, no decorative effects that mean nothing), ui-ux-pro-max (one primary CTA, contrast, consistent components, data-viz legibility) and designer-skills (dark/light parity, hierarchy, empty states). I worked from my existing knowledge of these three repos and did not fetch them in this pass.

## Findings (most severe first)

### 1. The root-cause panel can't tell its rows apart and undersells the headline preset
- **Where:** result details, all viewports and themes. The copy comes from `core/summary.js:21-29`, the row is built at `app.js:706`, and the truncation is `style.css:96` (`.road-name` ellipsis).
- **What's wrong:** In the Meteor result, all five "Roads that mattered" rows read `Dwight D. Eisenhower Highway + …`. The ellipsis cuts off the "+ 10 more roads" suffix, which is the only part that differs between rows. In the Bay Bridge preset, the one row that "mattered" is `Dwight D. Eisenhower Highway · 1 road · 1 trip`, drawn with a full-width bar, while the real cause sits in a plain line under it: `Several roads together: 170 trips`. Root-cause tracing is the project's selling point. A recruiter who taps the one-tap demo sees it credit 1 trip out of 171.
- **Fix:** Move "+ N roads" out of the name and into the caption line ("11 roads · 45 trips"). Give each group a distinguishing name: the least common name in the group, or a direction or ramp label (for example "I-80 W approach"). Never let five rows start with the same 28 characters. When `several_together` is larger than the top row, show it as the first ranked row, with its own bar ("All 10 Bay Bridge roads together · 170 trips"), above the singles.

### 2. Light theme makes the live traffic and the baseline network disappear
- **Where:** 375 and 1280, light, in ready, traffic z10/z13/z15 and the preset. Paint is set at `app.js:361-363`, car colors in `fx.js`.
- **What's wrong:** In light, cars and the trip-weighted network are faint gray dashes on the white OpenFreeMap roads. At z13 you have to squint to find any traffic on I-980. At z15 there is none at all. Rerouted paths are 1.5–2.5 px black lines at 0.85 opacity, with white cars over them, so they read as railway dashes. The spec asks for 3 px. Dark theme looks great. Light theme drops the two features the owner asked for, live traffic and the detours.
- **Fix:** In light, draw cars as `--fg` ink with normal blending and at least 3 px. Raise the `baseline` opacity for light (0.18 to about 0.35). Draw `after` at a solid 3 px, as §4.5 says, with no cars on top in light. Check the result with the same z13 screenshot.

### 3. The effects break the monochrome rule: orange fireball, orange debris, pink cracks
- **Where:** all viewports, both themes, in the Stomp and Meteor mid-animation frames. Code: `fx.js:134` (`hot ? [1,.6,.25]`, orange chips, always on for Meteor and 35% of chips for Stomp) and `fx.js:164` (meteor trail `[1,.5+hot*.45,.15+hot*.6]`).
- **What's wrong:** §6.1 says "No hue except the red handover". The meteor is an orange stock fireball, and Stomp throws amber sparks. Amber already means "slowed" in this UI, so the effect brings in a data color with no meaning. On light theme the orange-white glow is washed out on gray water, when the spec asks for ink. This is the one place the page looks like a generic game template, which is the AI-slop look the owner wanted to avoid.
- **Fix:** Use white or gray additive particles in dark and black or gray ink in light. Keep red only on the final crack and rim cool-down.

### 4. Flip looks like destruction and reports a contradiction
- **Where:** Flip result, all viewports and themes. The red comes from `app.js:365`: the `hit` layer is always `--broken`.
- **What's wrong:** After the flip, the reversed road is drawn red, the same color as a destroyed road, and nothing shows its new direction once the chevrons fade. The summary says "6 trips rerouted around this unnamed road", but Flip doesn't block the road, so "around" is wrong. Details then show "Affected trips (0)" for those same 6 trips. The big "6" has no label, unlike the three labelled stats used everywhere else.
- **Fix:** Draw flipped roads in `--route` with static chevrons pointing in the new direction. Change the copy to "6 trips changed route after this road was reversed". Either list the rerouted trips under Affected trips or hide the section when it is 0. Add a `REROUTED` label under the number.

### 5. The light home screen: map labels collide with the headline, and the Bay box cuts through the copy
- **Where:** home, 375 light (worst) and 375 dark. The scrim is `style.css:40` (72% `--bg`).
- **What's wrong:** In light, "Berkeley" overlaps the `ROUTE-IMPACT / PLAYGROUND` label, and "Daly City", "San Bruno" and "San Mateo" run through the H1. The 72% white scrim is not enough over the positron labels. In both themes the dashed Bay box rectangle cuts across the copy block, and its bottom edge sits just above Start. The first screen a recruiter sees looks layered by accident.
- **Fix:** While `data-home="true"`, set `text-opacity` to 0 on the basemap symbol layers and hide `bay-box`, or raise the light scrim to about 88%. The traffic behind the scrim then reads as texture, not text.

### 6. The summary card: a red zero, an unexplained "+102 MIN", and dead space
- **Where:** result summary, mobile, both themes. Code: `style.css:81`, `:88`, `:89`.
- **What's wrong:** `0 BROKEN` is shown in alarm red, which signals a problem where there is none. `+102 MIN` doesn't say what it measures: total over 45 trips, per trip, or something else. `+2,899 MIN` for the Meteor reads like 48 hours of delay to a newcomer. "Details" sits alone on its own row, with about 40 px of empty space above and below it. The card ends up about 176 css px tall and covers the detour it is describing.
- **Fix:** Render zero stats in `--fg-3`. Label the third stat `MIN ADDED, TOTAL` or show the per-trip mean. Put the Details button on the same line as the secondary "hit … · … mattered" line (grid `1fr auto`) and remove `margin-top`. That saves about 50 px.

### 7. Copy: internal jargon and counts that don't add up
- **Where:** summary line, all states. `core/summary.js:21,29`.
- **What's wrong:** "Stomp hit 1 road · 1 mattered", "Bay Bridge hit 10 roads" and "Meteor hit 155 roads · 101 mattered" make the tool or preset the actor, and use "mattered", a glossary term, as a bare adjective. The Meteor details then say "Show all 12", and nothing explains how 101 roads become 12 rows. By the no-ai-slop rules, numbers should explain themselves.
- **Fix:** For example: "155 roads closed. 101 of them, in 12 groups, changed someone's trip." For the preset: "Bay Bridge closed (10 roads)."

### 8. Mobile details covers the whole map, and is mostly empty when there is little to show
- **Where:** 375, details open. `style.css:93` (`height: 70dvh`).
- **What's wrong:** For the Meteor, the open sheet runs from under the top bar to the dock. Tapping a road row "selects and flies to the roads", but the map behind it can't be seen. For Flip, the same 70 dvh holds three short items, followed by about 100 px of blank surface.
- **Fix:** Use `max-height: 70dvh` with content height instead of a fixed `height`. When a road row is tapped on phones, collapse the card to its summary and then fly, so the user sees the result of the tap.

### 9. Destroyed roads are drawn far outside the meteor circle
- **Where:** Meteor result, all viewports (most visible at 1280 dark).
- **What's wrong:** Whole OSM ways turn red, so the Bay Bridge line runs red from the crater to the edge of the panel, and ramps poke out of the ring. That contradicts the spec's "shock ring runs out to the exact radius" and looks like a bug.
- **Fix:** For display only, clip the `hit` geometry at the circle. The routing stays per-way. Alternatively, draw the parts outside the circle at `--broken` 40% with a dash, and say so in the footnote.

### 10. The meteor size control looks like a form
- **Where:** dock with Meteor selected, all viewports. `style.css:70-72`.
- **What's wrong:** The native radio dots inside bordered pills (`◉ 500 m | ○ 1.5 km`) sit directly under the filled segmented weapon control. That is two visual languages for the same kind of choice, and on dark the unchecked dot is a gray blob.
- **Fix:** Visually hide the `input` (keep it for accessibility) and mark the checked label with `--surface-2` plus `--border-strong` and `--fg` text. That matches §5.2's "segmented" control.

### 11. Traffic reads as noise at z10 and vanishes at z15
- **Where:** ready, z10/z13/z15, both themes.
- **What's wrong:** At z13 dark, traffic is excellent: dashes stream along I-980 and I-580. At z15, where 3D buildings and the Stomp camera live, there are only a few cars on 14th St, and none in light. At z10 the cars blend into the bright baseline. The "live traffic" feature only works across a narrow zoom band.
- **Fix:** Raise the per-way car count (or the minimum size in px) as zoom goes up, so screen density stays roughly constant. Dim the baseline below z11 so cars separate from it. Also, in light at z15 the building walls render as dark slivers at pitch 0. Lighten the wall gray.

### 12. The attribution button floats and jumps around
- **Where:** all game states, mobile. `style.css:125` (`bottom: var(--map-footer-bottom, 120px)`).
- **What's wrong:** The round "i" sits mid-map on the right edge and moves with the card. With details open (light Flip), it lands just under Rebuild, at the top of the screen. It's a stray control in a layout that is otherwise disciplined.
- **Fix:** Keep the compact attribution fixed at the bottom-right above the dock, at one height. Put the full "© OpenStreetMap · OpenFreeMap" credit in the details footnote line.

## What works
- The dark ready state: the trip-weighted network glowing on near-black is striking and honest, because its density comes from real trip counts. It's the best screenshot in the project.
- The type and tokens are disciplined: Geist plus tabular mono numbers, one filled primary per view, hairline 12 px panels and no shadows or blur. It reads as Vercel-grade, not a template.
- The Stomp ribbon follows the real road shape and cools into the red closed line. It is geo-anchored and physical, as asked.
- The Bay Bridge preset on desktop: the white detours over the San Mateo and Richmond bridges tell the story in one glance.
- The home copy is specific (2,057 trips, a dated snapshot, "no server"), uses no adjectives, and offers a clear Start / one-tap-demo pair.

## Note (not a finding, not reproduced)
In one 1280×800 run (both themes), the Meteor result rendered with no red roads and no rerouted paths 3 s after the card appeared. I had dropped `fxTimeScale` to 0.1 mid-effect and set it back to 1. A clean re-run without the time-scale change drew everything (`rv_1280_after-flip_5000.png`). It is probably an artifact of the test hook, but the reveal gate may get stuck if the fx clock changes speed during an effect.

## Re-check (after P5c-1)

Re-ran the same capture script (`review2.mjs`, which is `review.mjs` writing to a new folder) with `GPU=1` at 375×812 (dpr 2, mobile) and 1280×800, dark and light, plus a DOM probe of the meteor size control. New screenshots: `/private/tmp/claude-501/-Users-jarednarvaez-route-impact/e8b1b7ea-8545-4e74-aded-6cec906763b1/scratchpad/review_design/after/` (result text in `*_info.json`). Each finding is judged against what `review_triage.md` says should now be true.

| # | Status | Evidence |
|---|---|---|
| D1 | **Partly fixed** | In the preset, "Several roads together · 10 roads · 170 trips" is now the top ranked row, which is good. In the Meteor result, though, all 5 rows still have the same headline ("Dwight D. Eisenhower Highway"). The "distinguishing" part is a raw OSM id ("Road 123741276"), and row 3 repeats it ("Road 123741276 · Road 123741276"). Ids mean nothing to a visitor, and the first and third rows share one. |
| D2 | **Partly fixed** | Light detours are now bold 3 px black lines (1280 light preset), and dark streaks show on I-580/I-980 at z13. At z15 in light there are still no cars at all (`375x812_light_traffic_z15.png`). |
| D3 | **Fixed (accepted part)** | Stomp debris is now white/gray with no amber chips (`m_dark_stomp2.png`). The meteor stays warm, which matches the triage rejection. |
| D4 | **Partly fixed** | The road is now white, not red, a "REROUTED" label was added, and "Affected trips (0)" is gone. But there are no static direction arrows on the flipped road (`f_zoom.png`), and the copy now repeats itself and gets cut off at 2 lines: "Flip reversed this unnamed road. 6 trips changed route after this…", even with details open. |
| D5 | **Fixed** | Light home has no map labels and no Bay box behind the copy (`375x812_light_home.png`). |
| D6 | **Fixed** | The zero renders gray (`s_card.png`), the label reads "ADDED MIN", and Details sits on the summary line. The card is about 50 px shorter. |
| D7 | **Regressed** | The new copy is false. The preset says "Bay Bridge hit 10 roads. 1 of them carried trips.", while the top row says those 10 roads together carried 170 trips. "Stomp hit 1 road. 1 of them carried trips." also reads badly. The count is the "mattered" set, not the roads that carried trips. "Show all 12 groups" is fixed. |
| D8 | **Fixed** | The Flip details sheet now fits its content (`375x812_light_flip_details.png`). The Meteor sheet is still capped near full height, as intended. |
| D9 | **Rejected; line present** | The details footnote now ends with "Whole roads close if any part is inside the circle." The red still extends past the ring, as expected. |
| D10 | **Regressed** | The radio dots are gone, so the only selected cue is `#141414` vs `#0a0a0a` with border `#3d3d3d` vs `#262626`, and the text color is the same. On dark, the selected size can't be told apart (`sizes_ui.png`). |
| D11 | **Partly fixed** | z10 is calmer, with motorway streaks only. z15 is unchanged: about 8 cars on one street in dark and none in light. The triage put that out of scope or under D2. The light building-wall slivers at pitch 0 are unchanged. |
| D12 | **Partly fixed** | The button no longer jumps with the card. It now floats alone at the top left of the home screen, a stray "i" above the copy (`375x812_light_home.png`). With mobile details open, it peeks out from behind the top edge of the card (`375x812_dark_meteor_details.png`). |

### New issues introduced by the fixes
1. **The summary sentence contradicts the root-cause rows** (D7 rewrite, `core/summary.js`). "1 of them carried trips" next to "10 roads · 170 trips" is a factual error on the headline demo. Fix: "10 roads closed. Together they changed 171 trips." Or keep a count that matches what it measures.
2. **Raw OSM ids are used as visible names** (D1). "Road 123741276" breaks the "one term, human words" copy rule, and it repeats within a row. Fix: use the next distinct `name` or `ref` (for example I-80 or the ramp name), else the nearest place, and never the id.
3. **The selected meteor size is invisible on dark** (D10). Fix: fill the checked option with `--route` / `--on-route`, as the weapon dock does, or at least use `--fg` text and a `--fg-3` border.
4. **A flipped road looks the same as a rerouted path** (D4). Both are `--route` white, and the arrows are missing. Fix: add the specified static chevrons, or draw the flipped road dashed.
5. **The 1-trip row's bar shrinks to a dot** that reads as a stray period (1280 light preset, row 2), because the bar is 1/170 of the top row's width. Fix: set a minimum bar width of 8 px, or hide the bar below 2%.

## Final re-check (after P5c-2)

Same capture script (`review3.mjs`, writing to `final/`) with `GPU=1` at 375×812 (dpr 2, mobile) and 1280×800, dark and light, plus a DOM probe of the meteor size control. Screenshots: `/private/tmp/claude-501/-Users-jarednarvaez-route-impact/e8b1b7ea-8545-4e74-aded-6cec906763b1/scratchpad/review_design/final/`.

| # | Status | Evidence |
|---|---|---|
| D1 | **Fixed** | Meteor rows now have distinct names: "Dwight D. Eisenhower Highway · 161 trips", "Unnamed road · 10 trips", "Maritime Street", "West Grand Avenue". No OSM ids are shown. In the preset, "Several roads together · 170 trips" is the top row. |
| D2 | **Not fixed (z15 light)** | `375x812_light_traffic_z15.png` still shows zero cars. Light z13 streaks and the 3 px black detours are still good. |
| D3 | **Fixed (accepted part)** | Stomp debris stays neutral. The warm meteor stays, as triaged. |
| D4 | **Fixed** | The flipped road is dashed white with chevrons in the new direction (`375x812_dark_flip_after.png`). The copy is one line: "Flip reversed Unnamed road." |
| D5 | **Fixed** | Light home has no labels, no Bay box and no "i" (`375x812_light_home.png`). |
| D6 | **Fixed** | The zero is gray, the label reads "ADDED MIN", and the card is compact. |
| D7 | **Fixed** | The summary is "Bay Bridge hit 10 roads." / "Meteor hit 155 roads.", with no contradicting clause. |
| D8 | **Fixed** | The Flip details sheet fits its content, and the Meteor sheet is capped. |
| D9 | **Rejected; line present** | The footnote reads "Whole roads close if any part is inside the circle." |
| D10 | **Fixed** | The selected size is an inverted white fill: `rgb(255,255,255)` background and `rgb(0,0,0)` text (`sizes_ui.png`). |
| D11 | **Partly fixed** | z10 is calm (motorways only). z15 is still sparse in dark and empty in light. The light building-wall slivers are unchanged. |
| D12 | **Fixed** | No "i" on home, and none peeking out behind the open card. On desktop it sits under the panel. |
| N1 summary contradiction | **Fixed** | The road-count clause was removed. |
| N2 OSM ids as names | **Fixed** | No "Road 123…" strings remain in any `*_info.json`. |
| N3 meteor size invisible | **Fixed** | See D10. |
| N4 flipped road looks like a detour | **Fixed** | It is dashed and carries chevrons, so it is distinct from the solid detours. |
| N5 1-trip bar shrinks to a dot | **Fixed** | Bars have a minimum width of 8 px (`1280x800_light_preset.png`, row 2). |

### New issues (clearly visible)
1. **Merged rows' road counts add up to more than the roads hit.** The Meteor summary says "155 roads", but the rows total 90 + 73 + 36 + 3 = 202. "Maritime Street · 36 roads · 1 trip" is not plausible. The merge sums road counts across groups that share ways. Fix: count the distinct way ids in the union, the same way trips are counted.
2. **"Flip reversed Unnamed road."** has a capital U in the middle of a sentence. Use "an unnamed road" when there is no name.
