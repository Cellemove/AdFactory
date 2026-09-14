---
description: PR title and description for the current changes — clean, non-technical, big changes only
---

Look at the current diff (staged + unstaged changes, or the branch's diff
against `main` if that reads better for the scope of work) and produce a PR
title and description the user can paste straight into GitHub.

Audience: **non-engineering stakeholders and reviewers skimming a PR list.**
No file paths, no function or variable names, no framework or library jargon,
no line counts. Describe what changed for someone using the app, not how the
code does it.

**Only the big changes.** Skip small fixes, tidy-ups, refactors, typo fixes,
or anything a user would never notice. If everything in the diff is minor,
say so plainly rather than padding the list.

Output format, exactly:

```
Title: <One line, plain language, under 70 characters>

Summary
- <Big change 1, one line, plain language>
- <Big change 2, one line, plain language>

Test plan
- [ ] <What to click or try to confirm change 1 works>
- [ ] <What to click or try to confirm change 2 works>
```

Rules:

- The title names the outcome, not the mechanism — "Fix avatar selection
  crash," not "Fix null currentTarget read in setForm updater."
- Each summary bullet is one short sentence. If a change needs more than a
  sentence to explain in plain language, it's too technical — simplify it or
  cut it.
- The test plan should be things a non-engineer could actually do in the app
  (click X, try Y, confirm Z shows up) — not "run the test suite."
- Do not include the git attribution footer — that gets added separately when
  the PR is actually created.
- If asked to also create the PR (not just draft the message), follow the
  standard PR-creation flow: check status/diff/log, push if needed, then
  `gh pr create` with this content as the body.
