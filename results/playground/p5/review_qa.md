# P5 playground: adversarial QA report

Tester: independent QA agent, no prior context. Date: 2026-11-03.
Target: `site/playground/` served at `http://127.0.0.1:8781/site/playground/`, driven by headless Chrome over CDP with Metal GPU (`GPU=1`). Real input came from CDP `Input.dispatchMouseEvent`, `dispatchTouchEvent` and `dispatchKeyEvent`. Failures were injected with `Network.setBlockedURLs` and `Network.emulateNetworkConditions`, attached to the page and, through `Target.setAutoAttach`, to its workers.
Scratch scripts: `/private/tmp/claude-501/-Users-jarednarvaez-route-impact/e8b1b7ea-8545-4e74-aded-6cec906763b1/scratchpad/review_qa/`. Every finding below was reproduced at least once. No code or docs were edited.

## Findings (most severe first)

### 1. A theme switch whose style fetch fails leaves a blank map, shows no message, and makes later taps throw — high

**Repro (`offline.mjs`, `offline2.mjs`)**
1. Load the page at 1280×800 and wait for "Tap a road to close it".
2. Go offline (the page plus its workers).
3. Press ← Route Impact, then the theme toggle, then Start.
4. Click the map with Stomp, or fire a Meteor.

**Expected:** spec §8 says a theme switch mid-effect draws the end state. A basemap failure should show the `map-error` line ("The basemap couldn't load… Routing still works"), and edits should keep working.

**Actual**
- The map goes plain white. The overlays, traffic, routes and crater are all gone (screenshot `offline_theme.png`).
- `#map-error` stays hidden, and the card keeps showing the previous result.
- `__playground.counts()` throws "Map style is not ready".
- A map click does nothing visible and logs `Uncaught Error: Style is not done loading.`
- `fireMeteor` rejects with `Uncaught (in promise) Error: Style is not done loading.` The card then still shows the old numbers while state has been cleared.
- The page recovers only when a later theme toggle succeeds online.
- The same uncaught error also fires online when the network is slow. Repro in `slowtheme.mjs`: 1500 ms latency, toggle the theme, Start, then click the map during the roughly 1 s style load.

**Console:** `Failed to load resource: net::ERR_INTERNET_DISCONNECTED https://tiles.openfreemap.org/styles/positron` (×2), then `Uncaught Error: Style is not done loading.`

**Likely cause**
- `app.js:473-487` (`setTheme`) sets `styleReady = false`.
- `fetchStyle` falls back to the bare style URL (`app.js:470`), which fails as well.
- The map `error` handler returns early after the first load (`app.js:582`), so nothing is shown.
- `fx` stays bound to the old style's building layers. The next `cancelEdit` (`app.js:838`) calls `fx.clear()` (`fx.js:191`), which reaches `sink()` and `map.setPaintProperty` (`fx.js:57-60`) and `querySourceFeatures` (`fx.js:66`) on a style that isn't loaded. Those calls throw out of `fireAt`/`runEdit` before the request is sent.

### 2. Start (and entry from a share link) leaves keyboard focus on `<body>`, not the selected weapon — medium

**Repro (`startfocus.mjs`, `kbd.mjs`)**
1. Open the page with no reduced motion, at 1280×800 or 375×812. Focus is on Start.
2. Press Enter (or click Start).

**Expected:** spec §5.1 says "Start moves focus to the selected weapon".

**Actual**
- `focusout start -> null`, and `document.activeElement` is `BODY` at both 50 ms and 350 ms. The next Tab restarts at the top bar.
- With `prefers-reduced-motion: reduce`, focus does land on Stomp. That shows the cause is the transition.
- The same happens on share-link entry and after a rejected link (`activeElement` stays `BODY` in `hashes.mjs`).

**Likely cause:** `style.css:56` transitions `visibility` on `#dock`/`#panel` over `--dur-2`. When `showHome(false)` calls `.focus()` (`app.js:151-166`, line 163), the dock is still computed `visibility: hidden` at transition progress 0, so the focus call is silently ignored.

### 3. Phone landscape (812×375): the result card is clipped, the Details button can't be seen, and tapping where it is fires a weapon — medium

**Repro (`sweep.mjs`, `land2.mjs`, `land3.mjs`)**
1. Open `#meteor=37.79,-122.41,1500` at 812×375 on mobile.
2. Wait for the result.

**Expected:** spec §8 lists phone landscape 812×375 as a supported check. Details should be visible and tappable.

**Actual**
- `#sheet` is 134 px tall with `overflow: hidden`, but `#summary` needs 176 px.
- The Details button (y 197-241) runs past the sheet's bottom edge (214), so it isn't visible (screenshot `sw_812x375_dark.png`).
- `elementFromPoint` at the button's centre returns `maplibregl-canvas`. A touch there changed the hash from `#meteor=37.79,-122.41,1500` to `#meteor=37.78074,-122.36709,1500`, which means a 1.5 km meteor fired. Details stayed closed.
- Only the top 17 px of the button responds to a click.
- Almost no map is visible between the card and the dock.

**Likely cause:** `style.css:80`. `max-height: calc(100dvh - var(--dock-height) - 104px …)` comes out at 134 px. The `max-height: 499px` block (`style.css:141-151`) only compacts the details state, not the summary.

### 4. "Bay Bridge closed" on home after a load failure hides the real error and shows a false share-link notice — medium

**Repro (`block3.mjs`, `nowebgl.mjs`)**
1. Block `edge_ms.bin.gz` in the worker, or open with `?nowebgl`.
2. Wait for the load error.
3. Press "Bay Bridge closed →" on the home screen.

**Expected:** the error and Retry stay as they were, with no edit attempted.

**Actual**
- With the blocked file, the error changes to "The Bay road network could not load: Load required before other messages", which is internal text. The notice "This share link is invalid or unavailable. Pick a new edit." also appears, though no share link was used.
- That notice survives a successful Retry: the screen reads "Tap a road to close it" with the stale notice under it.
- With `?nowebgl`, the screen shows the WebGL error, "Tap a road to close it" and the share notice all at once, and the weapons become enabled with no map.

**Likely cause**
- `startPreset` (`app.js:1184-1188`) calls `replayShare` whenever the phase isn't `loading`, including `error`. The `hashchange` handler does guard against `error`.
- `replayShare` then forces `state.phase = 'ready'` (`app.js:1122`).
- `loadNetwork` (`app.js:603`) never clears `state.shareNotice`.

### 5. Any non-share hash on the home URL pulls the visitor into the game with "share link is invalid" — low/medium

**Repro (`home.mjs`, `hashes.mjs`):** open `…/site/playground/#about`. The same happens with `#<img src=x onerror=alert(1)>` or `#aaaa…`.

**Expected:** these hashes don't match `#(stomp|flip|meteor|preset)=`, so the home screen should stay up (`skipHome` is false) and the hash should be ignored.

**Actual:** at 0.5 s the home screen shows with focus on Start. Once the roads load (about 9 s), the page switches to the game on its own, shows "This share link is invalid or unavailable", wipes the hash and drops focus to `BODY`. Nothing was injected (`alert` never fired).

**Likely cause:** `pendingShareHash = location.hash` stores any hash (`app.js:87`). After load it is replayed (`app.js:698-702`), and `replayShare` calls `showHome(false)` for any non-empty hash (`app.js:1116`).

### 6. After a miss, the URL still holds the previous edit, which the screen no longer shows — low

**Repro (`taps.mjs`, `twice.mjs`)**
1. Produce a result. A share link or a Stomp works.
2. Switch to Flip and tap a two-way road. Or Stomp on water (37.70, -122.35, z15).

**Expected:** after a miss, the hash and the screen agree. Either both keep the previous result, or both are cleared.

**Actual**
- The map drawing and the card are cleared, and the chip shows "This road is two-way. Flip needs a one-way road" or "No road here. Zoom in and tap a road".
- `location.hash` is still the old edit (for example `#meteor=37.91785,-122.25174,1500`). Reloading, or sharing the address-bar URL, replays an edit the user just watched disappear.
- The fallback `state.phase = state.result ? 'showing' : 'ready'` at `app.js:644` can't happen, because `fireAt` already called `cancelEdit()` and `clearDrawing()` (`app.js:1008-1010`). A mis-tap therefore always throws away the current result.

**Likely cause:** `app.js:1008-1010` clears the state without calling `writeShareHash('')`, and `app.js:643-646` returns to `ready`.

### 7. Load-failure copy leaks a JS error type, and the home screen gives no sign of the failure — low

**Repro (`block2.mjs`):** block `edge_ms.bin.gz` in the worker and wait on the home screen.

**Expected:** spec §5.4 says errors say what happened and what to do.

**Actual**
- The text reads "The Bay road network could not load: TypeError: Failed to fetch". It names no file and doesn't say "Retry".
- On the home screen, the Start progress line just disappears at 87% and Start looks ready. The error only shows after the visitor enters the game.
- The Retry button looks like plain text with no button styling (screenshot `block_edge.png`).
- Retry did recover once the block was lifted.

**Likely cause:** `app.js:630` only strips a leading `Error: `. Home has no error state.

## What held up

- **Hostile hashes (19 tried):** `#stomp=0`, `abc`, a 14-digit id, `1e5`, `#flip=NaN`, `NaN,NaN`, radius 999999999, `0,0` (outside the box), a missing radius, a trailing `%0A`, `<script>`/`<img onerror>`, `#preset=__proto__`/`constructor`, more than 5 decimals, a leading `+`, and a 100 KB hash. All were rejected cleanly with the notice and no exceptions; `alert` never ran. Valid meteor and preset links replayed correctly.
- **Rapid hash changes:** 20 back-to-back `hashchange`s across mixed valid and invalid hashes, followed by a `#stomp`, settled on the final hash's result. `history.back`/`forward` between hashes replayed or rebuilt correctly.
- **Rebuild mid-Meteor** (at 0.25× time scale): the pending promise rejected as "Edit cancelled", the overlays returned to the 2 baseline features, the fx buffers stayed at 3, and no errors were logged.
- **WebGL context loss mid-Meteor:** the result still revealed. Fx went to 0 buffers and 0 cars, and an edit during the loss still produced a result. After `restoreContext`, fx was back to 3 buffers and 3 programs, about 3,000 cars were moving, and later edits drew.
- **Theme switch mid-Meteor (online):** the effect settled to its end state (crater on, ring outline drawn), the result was kept, and the layers were rebuilt (fx layer present).
- **Long session:** 30 mixed edits (Meteor, Stomp, Flip) with periodic Rebuilds and 3 theme switches. Fx buffers stayed at 3, programs at 3 and sources at 10. Layer count followed the theme (56 dark, 64 light). Overlay features went back to 2 after Rebuild, and the JS heap fell to 52 MB after GC. No leak found.
- **Reduced motion:** traffic was drawn but requested 0 frames in 2 s. The Meteor result came back in 305 ms with no animation and the crater/ring end state drawn.
- **Rotation:** rotating 375×812 → 812×375 → 375×812 → 812×375 mid-animation gave a correct result, no errors, and a traffic cap that matched the new width.
- **Keyboard:** the map handled Enter (fires at the crosshair), arrow keys and `+`, and Escape returned focus to the selected weapon. Rebuild handed focus to Stomp. Back moved focus to Start. Inert home content stayed out of the Tab order.
- **Touch and layout:** dragging the summary up or down opened and closed details. A touch-scroll inside details scrolled 235 px without moving the map. No horizontal page scroll at 375, 390, 768, 899, 900, 1280 or 812 px wide, in either theme. 899 px used the phone layout and 900 px the panel layout. Stomp on water showed "No road here".

## Re-check (after P5c-1)

Re-ran the same scripts with `GPU=1` on 2026-11-03, against the same server, which a parallel harness was also using. No code edits. Scripts and screenshots are in `/private/tmp/claude-501/-Users-jarednarvaez-route-impact/e8b1b7ea-8545-4e74-aded-6cec906763b1/scratchpad/review_qa/` (new files start with `re_`).

| # | Verdict | Evidence |
|---|---|---|
| Q1 offline theme switch | **Fixed** (but see N2) | `offline.mjs`: after the failed positron fetch, `counts()` returns normally (56 layers, fx layer present). `fireMeteor` resolves to `showing` with a new result, and the uncaught "Style is not done loading" never appears. `offline2.mjs`: a real click while offline gives a Stomp result. `slowtheme.mjs` (1500 ms latency, 8 clicks during the style load): every click resolves and the console is empty. |
| Q2 Start focus | **Fixed** | `startfocus.mjs` at 1280 and 375, with motion on: focus is on `stomp` at 350 ms. It sits on `BODY` for under about 200 ms while the fade runs. Reduced motion focuses it at once. `kbd.mjs`: Enter on Start gives `stomp`; Back then Start gives `stomp`. In `hashes.mjs`, share-link entry and rejected links now land on the weapon (`active: stomp`/`meteor`). |
| Q3 landscape card | **Fixed** | `land2.mjs` at 812×375: the summary's scroll height (108) equals the sheet height (110) and the button sits at y 161-205, inside the sheet. `elementFromPoint` at its centre returns the button. `land3.mjs`: a touch at the button's centre opens details, and the hash is unchanged, so no meteor fired. The Flip link fits too (`re_land4.mjs`). Screenshot: `re_land_meteo.png`. |
| Q4 preset after a load error | **Fixed** | `block3.mjs`: "Bay Bridge closed" is disabled, the page stays on home, no internal text or share notice appears, and Retry recovers cleanly. `nowebgl.mjs`: the WebGL error stays, no share notice appears, and the weapons stay `aria-disabled=true`. |
| Q5 non-share hash pulls the visitor into the game | **Fixed** | `home.mjs`: `#about` still shows home with focus on Start at 9.5 s. `#<img…>` and `#aaaa…` also stay on home without a notice. |
| Q6 stale hash after a miss | **Fixed** | `taps.mjs`: after the two-way hint and after "No road here", `location.hash` is `""`. `twice.mjs`: Stomp on Sutter Street twice gives the same result both times. |
| Q7 load-failure copy and home state | **Fixed** | `block2.mjs`: the text reads "Couldn't load the road data. Check your connection and retry." `re_block_home.mjs`: `#home-error` is visible on home next to a `#home-retry` button, and the preset is disabled. |

**Regression sweep (all held up, no console errors):**
- Hostile hashes: 17 of the 19 are rejected with the notice, and `alert` never fired. The 2 non-share hashes now stay on home as intended.
- Back/forward and 20 rapid hash changes end on the last hash.
- Rebuild mid-Meteor rejects with "Edit cancelled" and leaves fx buffers at 3.
- Context loss and restore mid-Meteor: results keep working; fx goes 0 → 3 buffers, about 3,000 cars afterwards.
- Theme switch mid-Meteor draws the crater end state.
- The 30-edit leak loop keeps fx at 3/3 and features back at 2; heap is 52 MB after GC.
- Reduced motion requests 0 traffic frames; rotation mid-animation still gives a result.
- Keyboard order, Enter, Escape and Rebuild focus behave correctly.
- Touch-scrolling inside details doesn't move the map.
- No horizontal page scroll at any of the 7 viewports in either theme.

### New bugs

**N1. Regression: `#preset=` share links no longer replay, though the page still writes them and Copy link copies them — medium.**
- **Repro (`re_preset.mjs`, `hashes.mjs`):**
  1. On home, press "Bay Bridge closed →". The URL becomes `#preset=bay_bridge` and Copy link is visible.
  2. Open that URL in a new load.
- **Actual:** the home screen shows with focus on Start, the hash is ignored, and no result appears. Before P5c-1, the same URL replayed the Bay Bridge result ("Bay Bridge hit 10 roads").
- **Cause:** the new `isShare` (`app.js:32`) only matches `stomp|flip|meteor`. It gates `skipHome` (`app.js:33`), `pendingShareHash` (`app.js:88`) and the `hashchange` handler (`app.js:1177`). Meanwhile `revealResult`/`serializeShare` (`core/share.js:34`) still write `#preset=…`. The triage wording for Q5 ("only stomp/flip/meteor count") dropped the preset grammar that `share.js:23` still parses.

**N2. After a failed theme fetch, the basemap error can't be seen and the theme is half-applied — low/medium.**
- **Repro (`re_offline_vis.mjs`):**
  1. Show a result at 1280×800.
  2. Go offline.
  3. Back → theme toggle → Start.
- **Actual:**
  - `#map-error` holds "The basemap couldn't load. Check your connection and retry. Routing still works." But its parent `#status-area` is `hidden` while the result card shows, so it measures 0×0.
  - `data-theme` is `light` and the toggle reads "Dark theme", while the map keeps the old dark style. The page shows light UI chrome over a dark map with no explanation (screenshot `re_offline_theme.png`).
- **Likely cause:** the map error lives only in `#status-area`, which `renderSheet` hides whenever the card shows. `setTheme` commits `state.theme` and the tokens before the style fetch succeeds.

**N3. The selected Meteor size can barely be seen — low (WCAG 1.4.11 non-text contrast).**
- **Repro (`re_size.mjs`):** open `#meteor=37.79,-122.41,1500`. In the 812×375 screenshot `re_land_meteo.png`, neither "500 m" nor "1.5 km" looks selected.
- **Actual:**
  - Dark theme: the checked label is `#141414` with a `#3d3d3d` border; the unchecked one is transparent over the `#0a0a0a` surface with a `#262626` border.
  - Light theme: `#fafafa` vs `#fff`.
  - Both contrast ratios are about 1.1-1.3:1. The weapon dock above uses a solid white fill for its selected state.
- **Cause:** `style.css:71` (`#meteor-sizes label:has(:checked)`).

## Final re-check (after P5c-2)

Re-ran the same scripts with `GPU=1` on 2026-11-03. No code edits. New scripts and screenshots start with `f_`.

| # | Verdict | Evidence |
|---|---|---|
| N1 `#preset=` replay | **Fixed** | `re_preset.mjs`: "Bay Bridge closed" writes `#preset=bay_bridge`. Reopening that URL shows "Bay Bridge hit 10 roads" with focus on Stomp. `f_shares.mjs`: `#preset=university_ramp` replays; `#preset=nope` is rejected with the notice. |
| N2 theme rollback and visible error | **Fixed** (see N4) | `re_offline_vis.mjs` (offline theme switch): `data-theme` rolls back to `dark` and the toggle reads "Light theme". `#map-error` is now shown (1248×50) while the card is up. Edits still work. Going back online and toggling again loads light (64 layers). |
| N3 Meteor size contrast | **Fixed** | `re_size.mjs`: the checked size is a solid `#fff` fill with `#000` text, and the unchecked one is transparent with `#ededed` text. Selection follows the share link and clicks. |
| Q1 | Fixed (held) | `slowtheme.mjs`: 8 clicks during a slow style load all resolve, with no console errors. |
| Q2 | Fixed (held) | `startfocus.mjs`: focus is on `stomp` at 350 ms. Share links land focus on the matching weapon. |
| Q3 | Fixed (held) | `land2.mjs`/`land3.mjs` at 812×375: the Details centre hits the button and opens details; no meteor fires. |
| Q4 | Fixed (held) | `block3.mjs`: the preset is disabled after a load error, no notice appears, and Retry recovers. `nowebgl.mjs`: only the WebGL error shows. |
| Q5 | Fixed (held) | `home.mjs`: `#about` stays on home at 9.5 s. Back/forward and 20 rapid hash changes end correctly. |
| Q6 | Fixed (held) | `taps.mjs`: the hash is cleared after the two-way hint and after "No road here". `twice.mjs`: the same road gives the same result both times. |
| Q7 | Fixed (held) | `re_block_home.mjs`: `#home-error` and `#home-retry` are visible on home, and Retry recovers. |

**Share links of every kind (`f_shares.mjs`, 390×844):** each link replayed its result and kept its hash, with no console errors:
- `#stomp=22372600` and `#stomp=28841121`
- `#flip=6320410` and `#flip=28841121`
- `#meteor=…,500` and `#meteor=…,1500`
- `#preset=bay_bridge` and `#preset=university_ramp`

**Rebuild and context loss (`midfx.mjs`):** Rebuild mid-Meteor still rejects with "Edit cancelled". After context loss and restore, edits still produce results and fx is back to 3 buffers.

### New bug

**N4. On desktop, the basemap error banner covers the weapon dock — medium.**
- **Repro (`f_overlap.mjs`, 1280×800):**
  1. Show a result.
  2. Go offline.
  3. Back → theme toggle → Start.
- **Actual:**
  - `#map-error` is placed at x 16-1264, y 123-173: full width, on top of the 380 px panel.
  - It covers the lower 70% of Stomp, Flip and Meteor, so `elementFromPoint` returns `map-error` for all three (screenshot `f_offline.png`).
  - The banner also stretches across the map instead of sitting in the panel.
  - At 390×844 it sits above the card and the weapons stay clickable (`f_overlap_390.png`), so this affects the desktop layout (≥ 900 px) only.

Minor copy note, not counted as a bug: `#flip=6320410` reads "Flip reversed Unnamed road." with a capital U mid-sentence. Earlier copy said "this unnamed road".
