# PROGRESS.md — route-impact

## Current state
- **Working on:** —
- **Next up:** Step 0 — Scaffold the repo (Codex)
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

### 2026-10-28 — Review: Codex plan critique
- **Agent:** Codex (critique, read-only) · Claude (decisions + edits)
- **Did:** Ran the plan critique; accepted 8 points in full and 2 in part (table in PLAN.md → Review log). Updated DESIGN.md §2, §5.1–5.7, §5.9, §5.11, §5.13 and PLAN.md Steps 0–12, cut order, and decision log; added `make setup` and the CLI-exit-code note to AGENTS.md.
- **Changed:** `docs/DESIGN.md`, `PLAN.md`, `AGENTS.md`, `PROGRESS.md`
- **Verify:** n/a (docs only)
- **Review:** Claude weighed each Codex point against the design; Jared to confirm the revised cut order (map is now 2nd to cut).
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
