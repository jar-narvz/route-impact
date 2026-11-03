# Playground UI redesign (P5): monochrome

Design for PLAN Phase 2 step P5. It replaces the Apple Maps look described in PLAYGROUND §5.9. Routing, the engine, the exported data and the share-link grammar don't change.

Jared chose the theme on 2026-11-03 from five mockups (monochrome, risograph, kaiju, ops console, Apple Maps). He asked for: a home screen like Campus Crusher's, a UI that isn't "AI slop", effects that go beyond 2D sprites and stay the same size on the ground when the map zooms, and visible traffic on the roads.

Sources for the rules below: `petergyang/no-ai-slop` (a writing skill, applied here to UI copy), `nextlevelbuilder/ui-ux-pro-max-skill` (UX guidelines and anti-patterns), `owl-listener/designer-skills` (hierarchy, type scale, motion and critique checklists). All three were read on 2026-11-03. Where they conflict, this doc picks one value and says which.

## 1. Problems with the P4 page

Seen in Jared's two screenshots (2026-11-03) and a read of `app.js`:

1. **Unclear controls.** "Peek / Half / Full" are internal names. The grabber bar next to them looks like decoration and does the same thing as the three buttons.
2. **Duplicated text.** The peek status line and the half-sheet heading print the same sentence ("11 trips rerouted around 3rd Street…") one above the other.
3. **No reading order.** Status, caveat, sample note, numbers, headings and presets all share one size and weight, so nothing tells the eye where to start.
4. **The road list breaks.** A group row's name is every road joined by "+", which wraps to six lines, overflows its row and draws over the weapon toolbar (screenshot 2). Each row also repeats "OSM ↗" and "and 21 more" as text.
5. **Effects are flat stickers.** A 2D canvas draws fixed-pixel shapes, so a 500 m Meteor's marker is the same size at zoom 9 and zoom 15 and doesn't match the ring.
6. **The map is static.** Trips show up as one faint line layer, so nothing on screen suggests traffic until you break something.
7. **No way in.** The page opens straight into the tool, with no sentence about what it is and no link to the repo or to Jared.

## 2. Needs (not features)

- A first-time visitor knows what to do and why it matters within 10 seconds, before touching the map.
- After an edit, the visitor reads one number first and finds the cause second, without scrolling past repeated text.
- Every control says what it does in words or a standard icon with a label.
- Hits feel physical: they happen at a place on the ground and stay at that size when the map zooms.
- The roads look used before anything breaks, so a break visibly changes something.
- Recruiters can reach the repo and Jared from the first screen.

## 3. Non-goals

- No change to `core/engine.js`, `cch.js`, routing results, the exported data or the share-hash grammar.
- No new weapons (P3), no sound, no accounts or leaderboard, no build step or npm.
- No downloaded sprites, videos or 3D models: every effect is drawn by code, so it stays sharp, geo-anchored and inside the transfer budget.
- No per-trip car routing. Cars show where the sampled trips drive (density follows trip counts) but don't follow individual trips from origin to destination (§6.2 says why).
- The results map `site/index.html` keeps its look.

## 4. Visual system

### 4.1 Principles

- **Monochrome chrome, color only for data.** Interface, map and effects are black, white and grays. The only hues are the result categories: red = broken, amber = slowed. Rerouted trips are white (dark theme) or black (light theme). If a color isn't one of these, it doesn't belong.
- **One primary per view.** One filled button or number per screen; everything else is outline, ghost or text (von Restorff; ui-ux-pro-max "one primary CTA").
- **Lines, not boxes.** Panels are solid surfaces with a 1 px border. No glassmorphism, blur, glow on text, gradients on chrome, or drop shadows.
- **Numbers in mono.** Every count, time and distance uses Geist Mono with tabular figures, so values don't shift as they change.

### 4.2 Tokens (all in `style.css` `:root`, no raw hex elsewhere)

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `--bg` | `#000000` | `#ffffff` | page, home screen |
| `--surface` | `#0a0a0a` | `#ffffff` | sheet, panels |
| `--surface-2` | `#141414` | `#fafafa` | pressed, selected rows, segmented track |
| `--border` | `#262626` | `#eaeaea` | 1 px hairlines |
| `--border-strong` | `#3d3d3d` | `#d4d4d4` | hover, focus-adjacent |
| `--fg` | `#ededed` | `#171717` | primary text |
| `--fg-2` | `#a1a1a1` | `#5c5c5c` | secondary text (≥ 4.5:1 on `--surface`) |
| `--fg-3` | `#8a8a8a` | `#737373` | labels, captions (≥ 4.5:1 on `--surface`) |
| `--broken` | `#ff6166` | `#d92d33` | broken trips, destroyed roads |
| `--slowed` | `#f5a524` | `#a35200` | slowed trips |
| `--route` | `#ffffff` | `#000000` | rerouted paths, primary button fill |
| `--on-route` | `#000000` | `#ffffff` | text on `--route` |

Text is `#ededed`, not pure white (designer-skills dark-mode rule). The contrast claims are checked in Verify, not assumed.

### 4.3 Type

Geist (400, 500, 600) for text, Geist Mono (400, 500) for numbers and labels, from Google Fonts with `display=swap` and a system fallback. Scale (ratio about 1.25, sizes not nudged by 1–2 px):

| Role | Size / line height | Weight | Notes |
|---|---|---|---|
| Display (home title) | 44 px / 1.05 (34 px under 380 px wide) | 600 | letter-spacing −0.04em |
| Result number | 40 px / 1 | 500 mono | tabular |
| Heading | 20 px / 1.3 | 600 | −0.02em |
| Body | 16 px / 1.5 | 400 | phone body never below 16 px (picked over the 14 px minimum in critique-typography) |
| Secondary | 14 px / 1.45 | 400 | `--fg-2` |
| Label | 12 px / 1.3 | 500 mono | uppercase, +0.06em, `--fg-3` |

At most two weights per screen besides mono labels.

### 4.4 Space, shape, motion

- Spacing scale 4 / 8 / 12 / 16 / 24 / 32 / 48 px; nothing off-scale.
- Radius 8 px on controls, 12 px on panels, 999 px only on the round map buttons.
- Touch targets ≥ 44 × 44 px with ≥ 8 px between them.
- Motion tokens: `--dur-1` 100 ms (press), `--dur-2` 200 ms (fades, toggles), `--dur-3` 320 ms (sheet). Enter `cubic-bezier(0.2, 0, 0, 1)`, exit `cubic-bezier(0.3, 0, 1, 1)` at about 65% of the enter duration. Only `transform` and `opacity` animate in the chrome. Any animation can be interrupted by the next input.
- Focus ring: 2 px `--fg` outline with a 2 px offset on every control; never `outline: none` without it.

### 4.5 Map

- **Grayscale basemap.** The page fetches the OpenFreeMap `dark` / `positron` style JSON and rewrites colors before passing the style to MapLibre. `core/mono.js` (pure, Node-tested) only touches **color-valued positions**: paint properties whose name ends in `-color` (literal values, stop outputs, and the output arms of `interpolate`, `step`, `match`, `case`, `coalesce`), never match labels, property names or other strings. Literals (hex, `rgb[a]`, `hsl[a]`, and the named colors `transparent`, `black`, `white`; the two real styles use no other names, and the full CSS name table costs about 2 kB of the budget) and `rgb`/`rgba` expressions become the gray of equal relative luminance computed in linear-light sRGB, alpha preserved. Sprites can't be recolored, so `icon-image` is removed from every symbol layer and a symbol layer left with no `text-field` (e.g. `road_oneway` arrows, shields) is hidden; road and place labels stay, in gray. Raster layers (`ne2_shaded`) get `raster-saturation: -1`. A failed style fetch falls back to the unmodified style URL; a theme switch cancels an older pending fetch.
- **3D buildings.** A `fill-extrusion` layer on the basemap's `building` source layer (`render_height`, `render_min_height`, source id read from the fetched style), from zoom 14, colored in two grays. The camera may tilt (two-finger drag on touch, right-drag or Ctrl-drag with a mouse) up to 60°; rotation stays off. Recenter returns to pitch 0.
- Overlays: the Bay box as a 1 px dashed `--fg-3` line; destroyed roads `--broken` 4 px; rerouted paths `--route` 3 px drawn in (§6.3); the old paths of affected trips `--fg-3` 2 px.

## 5. Screens

### 5.1 Home (new)

Same page, a full-screen layer over the live map (the map and its traffic run behind a 72% `--bg` scrim). The worker starts loading the network as soon as the page opens, so most of the download happens while the visitor reads.

```
ROUTE-IMPACT / PLAYGROUND                 (label)

Break a road.
Watch the Bay reroute.                     (display)

2,057 real trips across the Bay Area, routed
in your browser on OpenStreetMap data from
27 Oct 2026. Close a road and see which trips
detour, which break, and which road caused it.   (body, numbers from meta.json)

[ Start ]   Bay Bridge closed →            (primary · ghost text button)

──────────────────────────────────────────
2,057 trips   180,633 roads   no server     (mono stats from meta.json)
How it works · GitHub · Jared Narvaez       (secondary links)
```

- **Start** is the one filled button. While the network loads it reads "Start" with a thin progress line under its label (real progress: the worker posts `{type: 'progress', loaded_bytes, total_bytes}` as each shipped file arrives, totals from `meta.json`); pressing it early enters the game anyway, where the loading state continues.
- **Bay Bridge closed →** runs the `bay_bridge` preset straight away: the one-tap answer to "show me something happen".
- Links: How it works → the README's playground section on GitHub; GitHub → the repo; Jared Narvaez → `https://github.com/jar-narvz` (no other personal link exists in the repo; Jared can swap in a site or LinkedIn later).
- Layout: left-aligned, max width 560 px, bottom-left on desktop, filling the screen on phones with the buttons in thumb reach.
- A share link (`#stomp=…` etc.) or `?test` skips the home screen. The in-game back button returns to it without reloading.
- While the home screen shows, everything behind it is `inert`; Start moves focus to the selected weapon, Back moves it to Start. Leaves with a 200 ms fade and a 12 px upward move of the copy; reduced motion: instant.

### 5.2 Game layout (phone, < 900 px)

```
┌─────────────────────────────────┐
│ ← Route Impact        ⟲   ◎     │  back · Rebuild (with label when active) · recenter
│                                 │
│            (map)                │
│                                 │
│  ┌ status chip ───────────────┐ │  one line; replaced by the result card
│  └────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ ▢ Stomp  ⇄ Flip  ◎ Meteor   │ │  weapon dock, always visible
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

- **Weapon dock** at the bottom: a segmented control, icon above label, the selected one filled `--route`. When Meteor is selected a second row slides in under it: `500 m | 1.5 km` (segmented, labelled "Meteor size" for screen readers). Stomp is selected on first entry, so the first tap on the map always does something.
- **Status chip** above the dock: exactly one line, the next action or state. "Tap a road to close it" (Stomp), "Tap a one-way road to reverse it" (Flip), "Tap anywhere to drop a 500 m meteor" (Meteor), "Routing 2,057 trips…", "No road here. Zoom in and tap a road", "This road is two-way. Flip needs a one-way road". The chip and the result card never show at once.
- **Top bar:** back (arrow + "Route Impact" wordmark) on the left; Rebuild and recenter on the right as 44 px round buttons. Rebuild shows its label "Rebuild" next to the icon whenever there is something to rebuild, and hides otherwise (no disabled button).
- The light/dark toggle moves to the home screen footer; the game follows it.

### 5.3 Result card (replaces peek / half / full)

Two states, **summary** and **details**, instead of three named heights:

- **Summary** (sits above the dock): what happened, in at most three lines.
  - Damage: three stats in a row, each a mono number over a label: `4 BROKEN` (red), `12 SLOWED` (amber), `+38 MIN` (fg). Under them one secondary line: "Meteor hit 214 roads · 9 mattered", where the second number is the count of distinct roads that appear in any confirmed single or confirmed run (PLAYGROUND glossary "mattered"); it is left out when zero. No sentence claims the listed roads explain all of the damage, because joint and "several together" causes exist.
  - No damage: one mono number and one sentence: `11` / "trips rerouted around 3rd Street. None lost 2 min or more." For a miss: "No roads inside the circle."
  - A chevron button on the right labelled "Details" (text, not just an icon) opens details. The card also opens when dragged up more than 24 px (10 px movement threshold), and closes when dragged down or on the chevron again.
- **Details** (card grows to about 70% of the screen, content scrolls inside, top bar stays visible). The Details button carries `aria-expanded` and `aria-controls`; only the collapsible region is `inert` when closed, never the button. Closing details returns focus to the Details button; when Rebuild hides itself, focus moves to the selected weapon:
  1. **Roads that mattered** — up to 5 rows, ranked by distinct trips (singles and runs are separate rows, as today; ties by lowest first way id). Each row: road name on one line (ellipsis, full name in `title` and the accessible name); a secondary line "3 roads · 28 trips"; a thin bar in `--fg-3` whose length is the share of the top row; an icon-only OSM link (`aria-label="Open 3rd Street on OpenStreetMap"`). A group is named after the name that occurs on the most of its ways (ties: the name of the lowest way id) plus "+ 4 more roads", never every name joined. The road name and the bar are one `<button>` (selects and flies to the roads); the OSM link is a separate control. Tapping a row highlights its roads on the map and flies to them. "Show all 12" expands the rest. "Several roads together: N trips" stays as one plain line when it applies.
  2. **Affected trips (24)** — collapsed by default; rows read `Trip 4127 · work` · `12.4 → 15.1 min` with a 6 px status dot (red/amber) plus the word, since color is never the only signal.
  3. **Copy link** — copies the share URL with the Clipboard API and changes to "Copied" for 2 s; falls back to selecting a text field.
  4. One footnote line in `--fg-3`: "Sampled trips only. Roads outside the Bay box aren't modelled. Snapshot 27 Oct 2026."
- Presets: "Bay Bridge closed" is on the home screen; both presets are in details under "Try a preset"; neither is in the summary.
- **Desktop (≥ 900 px):** the dock, status chip and card stack into one 380 px panel at the top left; details are always open there, with no chevron.

### 5.4 Copy rules

From no-ai-slop, applied to microcopy: sentence case; numbers instead of adjectives; active voice; no "successfully", "simply", "just", "please", "unlock", "seamless"; no em dashes in UI strings; errors say what happened and what to do; no exclamation marks; one term per thing ("trip", never also "route" or "journey"; "road", never also "way" in visible text). `core/summary.js` owns all result strings and is unit-tested.

## 6. Motion and effects

### 6.1 Effects layer (`site/playground/fx.js`)

**4.7.1 contract:** `{type: 'custom', renderingMode: '3d'}` with `onAdd(map, gl)`, `render(gl, matrix)` (4.7.1's signature; later versions pass an options object), `onRemove` freeing every buffer, texture and program. WebGL2 instancing when available, `ANGLE_instanced_arrays` on WebGL1, and if neither exists effects and traffic are off. Blending is set and restored around each draw; depth test on so buildings occlude effects. The layer is re-added after every `setStyle` (theme switch) and rebuilt after `webglcontextrestored`. P5b-1 is a prototype of just this contract (one ring and one rising particle with altitude, tilted camera, theme switch, forced context loss) before any effect work.

A MapLibre custom WebGL layer: one program for particles (instanced quads), one for rings and discs, one for road ribbons. Every effect is placed in Web Mercator world coordinates with sizes in metres, and particles carry an altitude in metres, so:

- effects stay the same size on the ground when the map zooms (Jared's request) and line up exactly with the Meteor's real radius;
- debris and smoke rise in 3D when the camera is tilted;
- they draw under the map labels and over the roads.

Dark theme draws light (additive white); light theme draws ink (normal blending, black and grays). No hue except the red handover in Stomp's road and the Meteor crater's rim, which end as the `--broken` destroyed-road color.

Why code instead of rendered assets: a sprite sheet or video is a fixed-pixel picture (the P4 problem), costs transfer bytes the budget doesn't have, and can't follow a road's shape. A shader effect follows the road, scales with the map and adds a few kilobytes.

### 6.2 Traffic

- Cars are small light quads (about 26 × 9 m, minimum 2 px) moving along the roads that the sampled trips use: the same ways as today's baseline layer. Each way gets cars in proportion to the number of sampled trips that use it, so busy roads look busy and empty roads stay empty. One-way roads run in their exported direction; two-way roads run both ways, offset 5 m to the right. Speed follows the road class (motorway fastest), sped up 30× so movement is visible at city zoom.
- Cars don't follow individual trips: the baseline is sent as unique ways, and ordering every trip's path for 2,057 trips is a protocol change for little visual gain. The density is the honest part: it comes from real trip counts.
- After an edit: cars on destroyed roads stop and fade within 400 ms; cars on a flipped road turn around; the rerouted trips' new paths get extra bright cars for as long as the result shows. Rebuild restores the starting traffic.
- Budget: at most 3,000 cars on phones (< 900 px) and 6,000 on desktop. **Fallback ladder**, driven by the 95th-percentile frame interval over a 3 s window: above 33 ms, halve the cars; still above, cut particle counts by half; still above, turn building extrusions off. Each step happens at most once per load and is logged in `?perf` output. Traffic pauses while the tab is hidden (no repaint requests) and resumes on return; under reduced motion it stops moving and requests no repaints (cars stay drawn where they are).
- Needs additive protocol fields: `load` returns, aligned with each baseline line, the OSM way id (`way_ids`, `Float64Array`), whether it is one-way (`oneway`, `Uint8Array`; the export can't distinguish `oneway=-1`, so those run in geometry order, a known caveat), the number of distinct sampled trips whose path uses that way (`weights`, `Uint16Array`, a trip counted once even if it uses the way twice) and its road class (`highway`, `Uint8Array`). The page keeps these typed arrays for traffic instead of only the MultiLineString. Hit roads that carry no baseline traffic simply have no cars to remove. No result changes.

### 6.3 Weapon choreography

All durations obey P4b's reveal rule: numbers and roads appear at `max(result ready, effect deadline)`. Each effect has a **deadline** (the durations below) that gates the reveal, and a **tail** (smoke, dust, sinking, traffic changes) that keeps playing after the reveal, is cancelled by the next edit or Rebuild, and never delays anything.

- **Tap feedback (all weapons, at once):** a 1 px white ring growing to 40 m over 180 ms.
- **Stomp (≤ 600 ms after the road pick):** the road heats white along its whole shape (ribbon 0 → 14 m wide, 120 ms), cracks branch off it (jagged segments 20–60 m, drawn in over 150 ms), 40 debris chips launch up to 60 m and fall with gravity, a gray dust ring rolls out to 120 m, then the ribbon cools into the red destroyed-road line. A 4 px camera shake for 150 ms.
- **Flip (≤ 600 ms):** a train of chevrons sweeps along the road in the new direction, the road line flashes once, and its cars turn around.
- **Meteor (600 ms small / 1,040 ms large, decision 18 amendment):** a streak falls from 2,500 m × scale at a 35° angle with a fading particle trail; on impact one bright disc (a single flash, inside WCAG 2.3.1), a shock ring runs out to the exact radius, buildings inside the circle sink into the ground, debris bursts and a few smoke columns rise and fade over 2.5 s. The map canvas shakes once on impact (560 ms, damped, stronger for the larger meteor; skipped under reduced motion). The crater stays as a darker disc with a thin rim until Rebuild.
  - *How buildings sink:* MapLibre 4.7.1's `within` only tests Point and LineString features, so it can't select building polygons. P5b-1 first checks in the browser whether OpenFreeMap building features carry feature ids. If they do: buildings whose rendered footprint centroid lies inside the circle (found with `querySourceFeatures`, also on tiles that load later) get feature-state `sunk`, and the extrusion's height and base use `['case', sunk, ['*', h, k], h]` with `k` animated 1 → 0. If they don't: sinking is dropped, the crater is a dust dome of particles instead, and that is recorded.
- **Reveal:** rerouted paths fade and widen in over 400 ms, all ways at once (display geometry is per way in OSM order, so a directed draw-in would run backwards on some ways); destroyed roads appear red.
- **Rebuild:** buildings rise back (320 ms), the crater and red roads fade out, traffic refills.
- **Camera:** on a hit the map eases to pitch 40° around the impact (Meteor also fits its radius); recenter returns to pitch 0. Skipped under reduced motion and in `?test` mode (tests set the camera themselves).
- **Reduced motion:** no effect animation, no shake, no camera moves, no moving traffic. End states still draw: the crater disc and rim, the sunk buildings, red roads, the new paths at full length.

## 7. Accessibility and states (kept from P2–P4)

Live-region announcement per committed result; keyboard crosshair with Enter to fire; Escape returns to the weapons; every icon button has an `aria-label`; the details panel is `inert` when closed; WebGL-missing and worker errors show their message with Retry. The home screen is a `role="dialog"`-free landmark section whose Start button gets focus on load.

## 8. Edge cases

- **Accessibility checks beyond P4:** VoiceOver pass on the home screen and a result; 200% browser zoom; phone landscape (812×375); touch-scrolling inside details doesn't drag the map.

- **Home screen pressed before loading ends:** the game shows "Loading roads 62%" in the status chip and the dock is disabled with that reason as its tooltip and accessible description.
- **WebGL context lost** (phones under memory pressure): effects and traffic stop; routing and results still work; restored on `webglcontextrestored`.
- **Theme switch mid-effect:** the effect is cancelled and its end state drawn, as with any other cancel.
- **Very long road names:** one line with ellipsis everywhere; the full name is in the accessible name.
- **A group whose roads are all unnamed:** "Unnamed road + 3 more roads".
- **Desktop at 900 px exactly:** panel layout; 899 px: phone layout (as P4c-1).
- **Fonts blocked:** system fallback with the same scale; numbers stay tabular via `font-variant-numeric`.
