---
deferred_work_file: '{implementation_artifacts}/deferred-work.md'
triaged_findings_file: '' # set at runtime: normalized + triaged findings
raw_findings_file: '' # set at runtime: reviewer artifact manifest
review_run_dir: '' # set at runtime: artifact directory for this review run
date: '' # set at runtime: current datetime loaded during workflow initialization
new_status: '' # set at runtime: "done" | "in-progress"
decision_needed_count: 0 # set at runtime
patch_count: 0 # set at runtime
defer_count: 0 # set at runtime
dismiss_count: 0 # set at runtime
fixed_count: 0 # set at runtime
action_count: 0 # set at runtime
---

# Step 4: Present and Act

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
- When `{spec_file}` is set, always write findings to the story file before offering action choices.
- `decision_needed` findings must be resolved before handling `patch` findings.

## INSTRUCTIONS

### 0. Load triage artifacts

If `{triaged_findings_file}` exists, load it first and use it as the canonical source for counts and finding buckets. If it does not exist, fall back to the in-memory triage state from Step 3.

After loading, compute and persist:

- `{decision_needed_count}` = number of `decision_needed` findings
- `{patch_count}` = number of `patch` findings
- `{defer_count}` = number of `defer` findings
- `{dismiss_count}` = dismissed finding count from Step 3
- initialize `{fixed_count}` = `0`
- initialize `{action_count}` = `0`

### 1. Clean review shortcut

If zero findings remain after triage (all dismissed or none raised): state that and proceed to section 6 (Sprint Status Update).

### 2. Write findings to the story file

If `{spec_file}` exists and contains a Tasks/Subtasks section, append a `### Review Findings` subsection. Write all findings in this order:

1. **`decision_needed`** findings (unchecked):
   `- [ ] [Review][Decision] <Title> — <Detail>`

2. **`patch`** findings (unchecked):
   `- [ ] [Review][Patch] <Title> [<file>:<line>]`

3. **`defer`** findings (checked off, marked deferred):
   `- [x] [Review][Defer] <Title> [<file>:<line>] — deferred, pre-existing`

Also append each `defer` finding to `{deferred_work_file}` under a heading `## Deferred from: code review ({date})`. If `{spec_file}` is set, include its basename in the heading (e.g., `code review of story-3.3 (2026-03-18)`). One bullet per finding with description.

### 3. Present summary

Announce what was written:

> **Code review complete.** `{decision_needed_count}` `decision_needed`, `{patch_count}` `patch`, `{defer_count}` `defer`, `{dismiss_count}` dismissed as noise.

If `{spec_file}` is set, add: `Findings written to the review findings section in {spec_file}.`
Otherwise add: `Findings are listed above. No story file was provided, so nothing was persisted.`
If `{review_run_dir}` is set, add: `Raw reviewer artifacts saved under {review_run_dir}.`

### 4. Resolve `decision_needed` findings

If `decision_needed` findings exist, present each one with its detail and the options available. The user must decide — the correct fix is ambiguous without their input. Walk through each finding (or batch related ones) and get the user's call. Once resolved, each becomes a `patch`, `defer`, or is dismissed.

If the user chooses to defer, ask: Quick one-line reason for deferring this item? (helps future reviews): — then append that reason to both the story file bullet and the `{deferred_work_file}` entry.

**HALT** — I am waiting for your numbered choice. Reply with only the number (or "0" for batch). Do not proceed until you select an option.

### 5. Handle `patch` findings

If `patch` findings exist (including any resolved from step 4), HALT. Ask the user:

If `{spec_file}` is set, present all three options (if `{patch_count}` > 3, also show option 0):

> **How would you like to handle the `{patch_count}` `patch` findings?**
> 0. **Batch-apply all** — automatically fix every non-controversial patch (recommended when there are many)
> 1. **Fix them automatically** — I will apply fixes now
> 2. **Leave as action items** — they are already in the story file
> 3. **Walk through each** — let me show details before deciding

If `{spec_file}` is **not** set, present only the "fix automatically" and "walk through each" choices (omit the "leave as action items" choice because nothing was written to a file). If `{patch_count}` > 3, also show option 0:

> **How would you like to handle the `{patch_count}` `patch` findings?**
> 0. **Batch-apply all** — automatically fix every non-controversial patch (recommended when there are many)
> 1. **Fix them automatically** — I will apply fixes now
> 2. **Walk through each** — let me show details before deciding

**HALT** — I am waiting for your numbered choice. Reply with only the number (or "0" for batch). Do not proceed until you select an option.

- **Option 0** (only when >3 findings): Apply all non-controversial patches without per-finding confirmation. Skip any finding that requires judgment. Set `{fixed_count}` to the number fixed and `{action_count}` to the number skipped. Present a summary of changes made and any skipped findings.
- **Option 1**: Apply each fix. After all patches are applied, set `{fixed_count}` to the number fixed, set `{action_count}` to any unresolved remainder, and present a summary of changes made. If `{spec_file}` is set, check off the items in the story file.
- **Option 2** (only when `{spec_file}` is set): Done — findings are already written to the story. Set `{fixed_count}` = `0` and `{action_count}` = `{patch_count}`.
- **Option 3** (only when `{spec_file}` is set): Walk through each finding with full detail, diff context, and a suggested fix. After walkthrough, re-offer the applicable options above.
- **Option 2** (when `{spec_file}` is not set): Walk through each finding with full detail, diff context, and a suggested fix. After walkthrough, re-offer the applicable options above.

  **HALT** — I am waiting for your numbered choice. Reply with only the number (or "0" for batch). Do not proceed until you select an option.

**✅ Code review actions complete**

- `decision_needed` resolved: `{decision_needed_count}`
- Patches handled: `{fixed_count}`
- Deferred: `{defer_count}`
- Dismissed: `{dismiss_count}`

### 6. Update story status and sync sprint tracking

Skip this section if `{spec_file}` is not set.

#### Determine new status based on review outcome

- If all `decision_needed` and `patch` findings were resolved (fixed or dismissed) AND no unresolved HIGH/MEDIUM issues remain: set `{new_status}` = `done`. Update the story file Status section to `done`.
- If `patch` findings were left as action items, or unresolved issues remain: set `{new_status}` = `in-progress`. Update the story file Status section to `in-progress`.

Save the story file.

#### Sync sprint-status.yaml

If `{story_key}` is not set, skip this subsection and note that sprint status was not synced because no story key was available.

If `{sprint_status}` file exists:

1. Load the FULL `{sprint_status}` file.
2. Find the `development_status` entry matching `{story_key}`.
3. If found: update `development_status[{story_key}]` to `{new_status}`. Update `last_updated` to current date. Save the file, preserving ALL comments and structure including STATUS DEFINITIONS.
4. If `{story_key}` not found in sprint status: warn the user that the story file was updated but sprint-status sync failed.

If `{sprint_status}` file does not exist, note that story status was updated in the story file only.

#### Completion summary

> **Review Complete!**
>
> **Story Status:** `{new_status}`
> **Issues Fixed:** `{fixed_count}`
> **Action Items Created:** `{action_count}`
> **Deferred:** `{defer_count}`
> **Dismissed:** `{dismiss_count}`

### 7. Next steps

Present the user with follow-up options:

> **What would you like to do next?**
> 1. **Start the next story** — run `dev-story` to pick up the next `ready-for-dev` story
> 2. **Re-run code review** — address findings and review again
> 3. **Done** — end the workflow

**HALT** — I am waiting for your choice. Do not proceed until the user selects an option.
