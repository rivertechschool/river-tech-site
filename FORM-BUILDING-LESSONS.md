# Form-Building Lessons Learned

Running notebook of hard-earned lessons from building River Tech registration forms. Read this BEFORE starting a new form. Update it AFTER shipping a new form — whatever surprised you, whatever cost time, whatever you wish you'd known.

Forms shipped so far: RTD (Feb 2026), Homeschool 2026-27 (Apr 20), Field Trip (Apr 20), Full-Time 2026-27 (Apr 21), Re-Enrollment 2026-27 (Apr 21).

---

## Before you start

**1. Don't start from scratch. Start from the most recent form.**
Copy the HTML, JS, and Apps Script from the last shipped form. Rename, edit, adapt. You will reinvent bugs you already fixed if you try to write fresh.

**2. Reuse the canonical Release and Acknowledgment text.**
Paste from `river-tech-site/RELEASE-AND-ACKNOWLEDGMENT.md`. Do not reword the surviving sections. If the event is smaller (a workshop vs. full-year enrollment), you may DROP sections that don't apply, but do not rewrite the kept ones — Dan has already approved that exact wording.

**3. One checkbox covers the whole release block.**
Not one checkbox per section. The pattern: one big "I have read and agree to the Waiver and Release of Liability above" at the bottom.

**4. Read the per-form NOTES.md files first.**
`RTD-FORM-NOTES.md`, `HOMESCHOOL-FORM-NOTES.md`, `FIELD-TRIP-FORM-NOTES.md`, `SCHOOL-FORM-NOTES.md`. Each one holds Sheet IDs, Apps Script IDs, folder IDs, and form-specific gotchas. Don't guess — look them up.

---

## While building

**5. Work on disk, not in the sandbox.**
All form files must live in `river-tech-site/` on Dan's Mac from the first keystroke. The sandbox session can die and take unsaved work with it. This nearly lost the entire RTD form on 2026-04-20. Write directly to `pages/` and `assets/js/`.

**6. Sheet columns — reserve slots for the maximum family size.**
The full-time sheet has 161 columns: 35 family-level fields + (21 child fields × 6 child slots). A family with only 1 kid leaves 5 empty slots — that's fine. Don't build a variable-width sheet; the Apps Script expects fixed positions.

**7. The JS payload keeps fields the UI removed.**
When you delete a checkbox from the form (e.g. the standalone `cultureAgreed`), the Apps Script backend may STILL require that flag. Either update the backend OR keep sending `cultureAgreed: true` in the payload as a hard-coded value. Changing only the HTML/JS without the backend will reject every submission.

**8. Always hunt for orphans.**
After building a new form, grep the ENTIRE site for references to the old form it replaces. Update every button, every link, every "enroll now" CTA. Miss this and the form is invisible — like the Full-Time form was for its first day live (2026-04-21). Dan had to catch it.

---

## Show Dan the legal/policy text BEFORE editing the file

**9. Preview prose edits, don't just ship them.**
For any substantive change to legal/policy/acknowledgment prose (waivers, disclosures, consent language, school culture statements), show Dan the draft paragraph in chat FIRST. Wait for his read. Only then edit the file. This rule was earned on 2026-04-21 when Henry added an AI disclosure that was too long and too visible; Dan had to ask for it to be shortened.

This is NOT a "Four Gate" situation — don't ask about stakes. It's just a quick preview step.

Does NOT apply to: CSS tweaks, field order, button colors, form validation messages, commit messages.

---

## Testing

**10. Test with real data, then scrub.**
Use a live Stripe key so you can see the real Checkout flow, but abandon the session before paying. Submit a real-looking test row. Verify: sheet row appeared, Drive uploads landed in the right folders, Stripe session logged in the dashboard, email receipts (if any) fired. Then delete the test row, trash the test files, and move on.

**11. Apps Script curl POST can report failure while succeeding.**
If you POST to the Apps Script Web App URL via curl and get `Page Not Found` back, the backend MAY HAVE STILL EXECUTED. Check for side effects (new sheet row, new Drive file) BEFORE retrying. Retrying blind cost us 6 duplicate rows on 2026-04-20.

**11a. Verify a POST worked by reading the Executions log, not the curl response.**
Apps Script → Executions tab shows every invocation with Duration + Status. A completed `doPost` with Duration >2s means the FULL handler ran (Sheet + Stripe API + MailApp all called). A <1s completion usually means it fail-fast bailed early (e.g. missing Script Property). This is faster and more reliable than clicking into the execution for log details.

**11b. Apps Script editor needs the OWNER account signed into Chrome to redeploy.**
If the script is owned by `learn@rivertech.me` but Cowork's Chrome session is signed in only as `dhegelund@gmail.com`, opening `script.google.com/d/<id>/edit` returns "Access Denied — You're signed in as dhegelund@gmail.com." Tried `?authuser=1` but `myaccount.google.com/u/1/` also resolved to dhegelund — meaning the second account simply isn't in Chrome at all. Discovered when trying to flip the Re-Enrollment fee 200→250 on 2026-04-29. Workaround: ask Dan to sign learn@rivertech.me into Chrome once (then future Henry sessions can drive Apps Script redeploys autonomously), OR ask Dan to do the in-editor edit + redeploy himself when access is blocked. The on-disk `apps-script/<form>-Code.gs` does NOT auto-sync to the cloud — local edits are useless to Stripe Checkout until pushed into the editor and a new version is deployed.

**11c. Apps Script editor's "Select function to run" picker requires user-trusted clicks.**
Most of the Apps Script IDE responds to JS-synthesized events: Save button, Deploy menu, Manage Deployments dialog, Edit pencil, Version dropdown, Description input, Deploy button — all driveable from `mcp__Claude_in_Chrome__javascript_tool`. The exception is the function-run picker — it ignores synthesized click/keydown/space/enter events because the dispatched events have `isTrusted=false` and Closure JsAction filters them out (security feature). So Henry can't run `selfTest`, `deleteAllDataRows_TESTONLY`, or any one-off scrub function from the editor via JS. Workarounds: (a) hand the Run step to Dan, (b) add a doPost-callable scrub command to the deployed Web App and trigger it via curl, (c) use the Sheets v4 REST API directly with an OAuth token (more setup). For redeploys themselves, this isn't an issue — Deploy → Manage Deployments works fine via JS. But for ad-hoc cleanup runs of script functions, expect to hand off.

**12. GitHub Pages caches aggressively.**
After pushing a change, give it 30–90 seconds to deploy. If you pull a URL too early, you'll get the stale version and chase a bug that doesn't exist. Use a `?v=something-unique` query string to bypass your own browser cache — but the CDN still needs time.

---

## Git workflow (sandbox-specific)

**13. Git in the sandbox is broken. Use `osascript` to run git on the Mac.**
The sandbox creates lock files (`.git/index.lock`) it can't remove. Use `mcp__Control_your_Mac__osascript` to run `git add`, `git commit`, `git push` as the Mac user. It works cleanly.

**14. Always `git pull --rebase origin main` before push.**
There may be commits you didn't make (from other sessions or from Dan). A blind push will fail fast-forward. Rebase first.

---

## Shipping — the "it's not done until..." list

**A form is NOT done until ALL of these are true:**
- [ ] HTML, JS, and Apps Script all on disk under `river-tech-site/`.
- [ ] Apps Script deployed to a new Web App version (deploy → manage deployments → new version).
- [ ] The JS file has the correct Apps Script URL baked in.
- [ ] Sheet exists with the right number of columns and header row.
- [ ] Drive folders exist (photos, report cards, whatever the form uploads).
- [ ] Drive folders shared with a reviewer account at Viewer level. (Dan does this — Henry is blocked by safety rules.)
- [ ] E2E test: real submission → sheet row → Drive upload → Stripe Checkout session. Then scrub.
- [ ] Test data deleted from sheet AND Drive.
- [ ] Per-form NOTES.md file written or updated with Sheet ID, Apps Script ID, folder IDs, deploy steps.
- [ ] **New form linked from the existing site.** Button on `enrollment.html` (or the relevant hub page) points to the new form. All older references to the predecessor form are updated or removed.
- [ ] Commit + push. Verify live with a cache-bust URL.
- [ ] STATE.md updated to reflect the new live form.

Until every box is checked, the form is not done — it's "almost done", which is the same as "not done" from the family's perspective.

---

## Change log

- **2026-04-21** — initial draft after Full-Time 2026-27 shipped. Captured lessons from RTD, Homeschool, Field Trip, and Full-Time builds.
- **2026-04-21** — after Re-Enrollment 2026-27 shipped. Added 11a (Executions-log Duration as the fastest E2E-verify signal) and logged Re-Enrollment in the "shipped so far" list. Reconfirmed #11 (curl POST gotcha is real and repeatable).
- **2026-04-29** — after flipping Re-Enrollment fee 200→250. Added 11b (Apps Script redeploy requires OWNER account signed into Chrome). Dan signed in `learn@rivertech.me` mid-session, then Henry drove the full edit + save + redeploy from JS in Chrome (Version 2 deployed, doPost confirmed at 2.445s). Added 11c (the function-run picker is the one part of the IDE that won't accept synthesized clicks — `isTrusted` filter).
- **2026-04-29** — Cognito historical import (33 families). Added the next four lessons.

---

## Cognito + Apps Script deploys (added 2026-04-29 from the historical import)

**15. Cognito "All Fields" export = multiple worksheets, one per repeating section.**
The first sheet has only the parent-level fields (parent name, agreement checkboxes, payment summary). Per-family contact (FamilyInformation), per-child blocks (ChildInformationAndDetails), pickup persons (AuthorizedPickupAndDropoffInfor), per-child health (ChildSpecificHealthInformationS), educational history, and uploaded-file metadata all sit on **separate sheets within the same .xlsx**, joined to the parent row by `<FormName>_Id`. Read every sheet, not just `wb.active`. Burned 30 minutes thinking the export was thin when it wasn't.

**16. Pushing >25k-char Apps Script files into the live editor — use raw.githubusercontent.com.**
Steps:
1. Save edits locally.
2. From the Mac (osascript — sandbox git is broken per #13), `git add` + `git commit` + `git push origin main` so the new file is on GitHub.
3. In the Apps Script editor (Chrome MCP), run a small `javascript_tool` snippet that fetches the raw URL and assigns it via Monaco's API:
```js
(async () => {
  const r = await fetch('https://raw.githubusercontent.com/rivertechschool/river-tech-site/main/apps-script/<file>.gs');
  monaco.editor.getModels()[0].setValue(await r.text());
  return 'set, len=' + monaco.editor.getModels()[0].getValue().length;
})()
```
raw.githubusercontent.com sets `Access-Control-Allow-Origin: *`, so cross-origin fetch from script.google.com works. Single round trip. No clipboard, no chunking.

**17. The "New version" dropdown in Manage Deployments will silently roll you back if you misclick.**
The dropdown contains: `New version`, then every existing `Version N on …` ordered newest-first. The "currently deployed" version is highlighted with a gray background — easy to misread as "selected New version" on a quick glance. Hit deploy after the misclick and you've **rolled the live URL back to that older version, with the same Web App URL**. Symptom: `?action=list` (or any new endpoint added after that older version) suddenly returns wrong/missing fields. Recovery: open Manage Deployments again, edit pencil, dropdown, click `New version` for real, deploy. After every redeploy, *verify* with a known endpoint (`curl ?action=list&token=…` via Python urllib — see #18).

**18. Verify Apps Script doPost via Python urllib, not curl.**
curl follows the 302 → googleusercontent.com redirect with method GET (dropping the body), gets 405. Apps Script's doPost actually executes on the *first* request before the redirect, so the side-effect lands; but the curl response is misleading. Python's `urllib.request` handles the redirect cleanly and returns the JSON the doPost produced. Use it for any one-off endpoint check:
```python
req = urllib.request.Request(URL + '?action=import', data=body, method='POST',
                             headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(req, timeout=60) as r:
    print(json.loads(r.read().decode()))
```
This is the same gotcha as #11 from a different angle — the doPost works, just curl doesn't show it.

**19. Idempotent server-side dedup is the safe primitive for one-shot imports.**
The Apps Script `pipelineImport_` accepts an array of row objects keyed by sheet header name and dedups by lowercased `Parent 1 Email` against the live sheet. Re-running the same payload writes nothing. Combined with `dryRun: true` — which performs the same dedup logic but skips the append — this gives a safe rehearsal before commit. Always do `--dry` before `--commit`.
