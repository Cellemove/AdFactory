---
description: High-level, non-technical status report on recent changes
---

Report on the changes made in this session (or, if the user named a scope in
`$ARGUMENTS`, on that scope instead).

Write for **non-engineering stakeholders**. The user forwards these reports
onward, so technical detail makes them unusable. No file paths, no function or
variable names, no line numbers, no framework or library jargon. Describe
user-visible outcomes ("scripts no longer hedge their claims"), never mechanics
("removed the Zod validator from the generation pipeline").

Use these three headings verbatim, omitting any heading that has no items:

```
Done

<Short title>: <One or two plain-English sentences on what changed and why it
matters to someone using the app.>
<Short title>: <...>

On Hold

<Short title>: <Why it is blocked — e.g. "Need clarification.">

Ready for Testing

Can test the changes using this link: https://ad-factory-git-staging2-cellemovecodes-projects.vercel.app/
```

Rules:

- Each item is `<Short title>: <explanation>`. The title names the work; the
  sentence explains the effect on someone using the app.
- Anything unverified, blocked, or awaiting a decision goes under **On Hold**
  with the reason. Never list something as Done if it has not actually been
  confirmed working.
- Include the **Ready for Testing** link whenever there is something to test.
- If work is finished locally but not yet pushed, say so plainly — the staging
  link will not show it until it is.
- Keep the whole report short. This is a status summary, not a changelog.
