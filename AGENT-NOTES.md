# AGENT-NOTES — read this before you touch anything

Hey future agent. This file is for you. Dan is the site owner (visionary of River Tech School). Read these notes before making changes so we stop repeating the same mistakes.

## 1. Nav menu fade — LOCKED SLOW. Do not speed up.

Dan has asked for slow menu/submenu fades at least **four separate times** across sessions (commits `ee91a2c`, `d1b6635`, `4d868c2`, `1e8bac1`, and the 2026-04-21 session that created this file). Every time a fresh agent looks at the CSS, something about 0.4–0.5s durations with `ease` timing looks "a bit slow" and gets trimmed. Then Dan has to ask again. **Stop doing this.**

Ground truth:

- `--nav-fade: 0.7s` and `--nav-fade-ease: ease-in-out` live in `assets/css/style.css` (`:root`).
- All three nav transitions reference those variables:
  - `.sidebar-submenu` (desktop hover submenus)
  - `.mobile-nav-overlay` (mobile hamburger panel)
  - `.mobile-submenu` (mobile nested submenus)
- `assets/js/main.js` uses `NAV_FADE_MS = 700` — **must stay in sync** with `--nav-fade`.

### Rules for future edits to nav fade

- If the page "feels laggy" to you: **that is intentional**. Leave it alone.
- If you must change it, the ONLY acceptable edit is changing `--nav-fade` + `NAV_FADE_MS` together, and only when Dan explicitly asks.
- Do not remove the two-stage `.open` + `.visible` fade on mobile — it's the only way iOS Safari reliably animates opacity after a `display` flip.
- Do not replace the `setTimeout(…, NAV_FADE_MS)` with a `transitionend` listener — it misfires on iOS when display flips.
- Do not swap `ease-in-out` back to `ease`. The gentler curve is deliberate.

## 2. Mobile nav implementation — LOCKED

The known-good mobile nav uses:

- `display: none/block` toggled via `.open` class
- `.visible` class for opacity fade (added on next frame after `.open`)
- `openSubmenu` / `closeSubmenu` helpers in `main.js`

Past "improvements" using `max-height`, `flex`, `grid`, or CSS `transform` broke the nav on iOS Safari. **Do not refactor it.** Do not migrate it to a framework. Do not "simplify" it.

If you need to adjust mobile nav for an unrelated change, confirm with Dan first.

## 3. Deploy gotchas

- Hosted on Netlify, auto-deploys from `main`.
- CSS cache-bust: bump the `?v=NN` on `<link rel="stylesheet" href="…/style.css?v=NN">` across all pages whenever you change `style.css`. Currently `v=26`.
- **Watch out for zero-byte commits.** In the 2026-04-21 session, an `edit` tool call reported success but wrote 0 bytes to `pages/our-culture.html`, then `git add -A && commit && push` blind-pushed a 312-line deletion. GitHub Pages served the empty file. Before committing a file you just edited, run `wc -c` on it to sanity-check it's not empty.
- Prefer `git add <specific files>` over `git add -A` when you know exactly what changed.

## 4. Culture / copy

- Culture page: `pages/our-culture.html`. Locked copy — every line has been negotiated with Dan and his wife and reviewed by teachers. Do not rewrite for "tone" unless asked. Specific landmines:
  - The LGBTQ paragraph wording is deliberate. Don't "soften" it.
  - The "Regional Roots" section was renamed from "Idaho Roots" on purpose. Don't swap it back.
  - Skip stock photos. Dan rejected all 19 candidates plus a Depositphotos option in one session.
  - No video in Grit section anymore (removed 2026-04-21).

## 5. Who's who

- **Dan Hegelund** — site owner, visionary of River Tech School, makes all final calls.
- **Assistant / Gabriel** — you. Christian school of performing arts & technology, grades 1-12, Post Falls ID.

## 6. When in doubt

Ask Dan before making changes to nav, mobile nav, or locked copy. Small, reversible changes are fine; "refactors" or "cleanups" of the above almost always create regressions.
