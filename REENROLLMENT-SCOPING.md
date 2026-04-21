# Re-Enrollment 2026-27 Form — Scoping Doc

One-page brief so a fresh thread can pick this up and build cleanly. Written 2026-04-21 after Full-Time 2026-27 shipped.

**Read these first (in this order):**
1. `FORM-BUILDING-LESSONS.md` — cross-form lessons, don't skip
2. `SCHOOL-FORM-NOTES.md` — the Full-Time 2026-27 form is the parent of this one
3. `RELEASE-AND-ACKNOWLEDGMENT.md` — canonical legal text, paste-ready
4. This file

---

## Who it's for

Currently-enrolled River Tech students (2025-26) re-enrolling for 2026-27. The school already has their intake info on file. This form exists so returning families don't re-fill forty fields to tell us what we already know.

---

## Fields to KEEP

Things that CAN change year-to-year, or that we need to confirm each year.

**Family-level:**
- Parent/guardian name(s) — confirm current
- Email address — primary contact, confirm current
- Phone number — confirm current
- Home address — may have moved
- Emergency contact name + phone — may have changed
- Authorized pickups — may have changed
- Signature (typed full name)
- Signature date
- Release and Acknowledgment — single checkbox agreeing to the full canonical block

**Per-child (for each child being re-enrolled):**
- Child's full name — confirm identity
- Grade for 2026-27 (one up from last year, but confirm — some may repeat)
- Days chosen for 2026-27 (may differ from this year's schedule)
- Medical info / allergies / medications — may have changed; critical to refresh
- Any program track changes (Performing Arts, Technology, Double Major, if the Full-Time form uses those)

---

## Fields to CUT

Things we already have from their original enrollment. Don't re-collect.

- Photo upload — confirmed by Dan, not needed for returning students
- Report card upload — school already has their grades in-house
- Previous school
- Academic history
- Student strengths / interests / learning style
- Why you're choosing River Tech
- First-time-discovery questions of any kind

---

## Fee

- **$200/household** through **Saturday, April 25, 2026 at 3:00 PM Pacific** — "early re-enrollment"
- **$250/household** starting Saturday 3:00 PM onward — "open re-enrollment"
- **Manual swap.** Hardcode $200 at launch. Dan sends a one-line message on Saturday to flip it to $250. Henry changes one number, pushes, done. No auto-swap.
- Same Stripe Checkout flow as Full-Time. Same live key from SECRETS.md.
- Non-refundable, charged at submission. Tuition is billed separately.

---

## Release and Acknowledgment

Use the canonical block from `RELEASE-AND-ACKNOWLEDGMENT.md` as-is. All 7 sections, single checkbox. Do not reword — Dan has approved that exact text.

---

## What to reuse from Full-Time (pages/register-school-2026-27.html + .js + school-Code.gs)

- Overall HTML structure, CSS, hero styling
- JS field validation pattern
- Apps Script backend structure (doPost, row construction, Stripe session creation, redirect to success page)
- Stripe Checkout integration (same live key)
- Success page pattern — copy `register-school-2026-27-success.html`, adjust copy to say "Welcome back!" or similar
- Canonical release block (paste from RELEASE-AND-ACKNOWLEDGMENT.md)

## What's new for Re-Enrollment

- **New file names:** `pages/register-school-reenroll-2026-27.html` + `assets/js/register-school-reenroll-2026-27.js` + success page variant (suggested)
- **New Sheet:** "Re-Enrollment 2026-27" — much narrower than Full-Time's 161 cols; estimate ~40-50 cols
- **New Apps Script project** (or second deployment of existing — confirm approach with Dan before building). Script needs its own Sheet ID, its own Drive refs (if any uploads remain — photo cut, report card cut, so probably NO Drive folder needed)
- **New registration ID prefix:** suggest `RE-` (Re-Enrollment) vs. Full-Time's `RT-`
- **$200 initial, $250 after manual swap** — single dollar-amount constant in both HTML display and Apps Script Stripe session
- **Success page copy** — warmer, "welcome back" tone; no "we'll be in touch about orientation" messaging (they're already oriented)

---

## Wiring into the site (don't forget — this is the box that got missed last time)

After shipping, update:
- `pages/enrollment.html` — add a third CTA button "Re-Enrollment (Current Families)" next to Full-Time and Homeschool, pointing to the new form
- Consider an email blast to current families with the direct link (Dan's call, not part of the build)

Final checklist in `FORM-BUILDING-LESSONS.md` applies in full — work through every box before declaring done.

---

## Questions that may surface mid-build (flag to Dan, don't decide alone)

- Do we ask about changes to enrollment status (going from 4-day to 5-day, switching tracks)? Or is this just "same deal, next year"?
- Do we want a text field for "anything you'd like us to know about your child this year?" — short, optional, one box. Catches things the school wouldn't know otherwise.
- Do we separately confirm parent custody / legal status info, or trust what's on file?
- Does the Release text language about photographs/media need to be re-agreed each year, or is consent ongoing? (Recommend: re-agree every year via the single checkbox. Safer.)

---

## Change log

- **2026-04-21** — initial scoping by Henry after Full-Time shipped. Dan-approved cuts: photo, report card, intake/discovery fields. Dan-approved fee: $200 → $250 manual swap at Sat April 25 3 PM Pacific.
