---
diff_output: '' # set at runtime
spec_file: '' # set at runtime (path or empty)
review_mode: '' # set at runtime: "full" or "no-spec"
story_key: '' # set at runtime when discovered from sprint status
execution_mode_requested: '' # set at runtime: "auto" | "subagent" | "sequential"
review_run_dir: '' # set at runtime: artifact directory for this review run
raw_findings_file: '' # set at runtime: aggregated raw reviewer outputs
triaged_findings_file: '' # set at runtime: triaged findings output
---

# Step 1: Gather Context

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
- The prompt that triggered this workflow IS the intent — not a hint.
- Do not modify any files. This step is read-only.

## INSTRUCTIONS

1. **Detect review intent from invocation text.** Check the triggering prompt for phrases that map to a review mode:
   - "staged" / "staged changes" → Staged changes only
   - "uncommitted" / "working tree" / "all changes" → Uncommitted changes (staged + unstaged)
   - "branch diff" / "vs main" / "against main" / "compared to {branch}" → Branch diff (extract base branch if mentioned)
   - "commit range" / "last N commits" / "{sha}..{sha}" → Specific commit range
   - "this diff" / "provided diff" / "paste" → User-provided diff (do not match bare "diff" — it appears in other modes)
   - When multiple phrases match, prefer the most specific match (e.g., "branch diff" over bare "diff").
   - **If a clear match is found:** Announce the detected mode (e.g., "Detected intent: review staged changes only"), continue through instruction 2 to capture any execution preference, then proceed directly to instruction 4 to construct `{diff_output}`. Skip the manual target-selection question in instruction 3.
   - **If no match from invocation text, check sprint tracking.** Look for a sprint status file (`*sprint-status*`) in `{implementation_artifacts}` or `{planning_artifacts}`. If found, scan for any story with status `review`. Handle as follows:
     - **Exactly one `review` story:** Set `{story_key}` to the story's key (e.g., `1-2-user-auth`). Suggest it: "I found story {{story-id}} in `review` status. Would you like to review its changes? [Y] Yes / [N] No, let me choose". If confirmed, use the story context to determine the diff source (branch name derived from story slug, or uncommitted changes), continue through instruction 2, then proceed to instruction 4. If declined, clear `{story_key}` and fall through to instruction 2.
     - **Multiple `review` stories:** Present them as numbered options alongside a manual choice option. Wait for user selection. If the user selects a story, set `{story_key}` to the selected story's key and use the selected story's context to determine the diff source as in the single-story case above, continue through instruction 2, then proceed to instruction 4. If the user selects the manual choice, clear `{story_key}` and fall through to instruction 2.
   - **If no match and no sprint tracking:** Fall through to instruction 2.

2. **Detect execution preference from invocation text.** Check for phrases that map to reviewer execution mode:
   - "parallel" / "subagent" / "sub-agent" / "multiple reviewers" / "different agents" / "different subagents" / "并行" / "子代" / "子代理" → set `{execution_mode_requested}` = `"subagent"`
   - "sequential" / "single reviewer" / "single pass" / "inline only" / "顺序" / "单线程" → set `{execution_mode_requested}` = `"sequential"`
   - If nothing explicit is found: set `{execution_mode_requested}` = `"auto"`
   - If an explicit preference is detected, announce it before proceeding.

3. HALT. Ask the user: **What do you want to review?** Present these options:
   - **Uncommitted changes** (staged + unstaged)
   - **Staged changes only**
   - **Branch diff** vs a base branch (ask which base branch)
   - **Specific commit range** (ask for the range)
   - **Provided diff or file list** (user pastes or provides a path)

4. Construct `{diff_output}` from the chosen source.
   - For **branch diff**: verify the base branch exists before running `git diff`. If it does not exist, HALT and ask the user for a valid branch.
   - For **commit range**: verify the range resolves. If it does not, HALT and ask the user for a valid range.
   - For **provided diff**: validate the content is non-empty and parseable as a unified diff. If it is not parseable, HALT and ask the user to provide a valid diff.
   - For **file list**: validate each path exists in the working tree. Construct `{diff_output}` by running `git diff HEAD -- <path1> <path2> ...`. If any paths are untracked (new files not yet staged), use `git diff --no-index /dev/null <path>` to include them. If the diff is empty (files have no uncommitted changes and are not untracked), ask the user whether to review the full file contents or to specify a different baseline.
   - After constructing `{diff_output}`, verify it is non-empty regardless of source type. If empty, HALT and tell the user there is nothing to review.

5. Ask the user: **Is there a spec or story file that provides context for these changes?**
   - If yes: set `{spec_file}` to the path provided, verify the file exists and is readable, then set `{review_mode}` = `"full"`.
   - If no: set `{review_mode}` = `"no-spec"`.

6. If `{review_mode}` = `"full"` and the file at `{spec_file}` has a `context` field in its frontmatter listing additional docs, load each referenced document. Warn the user about any docs that cannot be found.

7. Sanity check: if `{diff_output}` exceeds approximately 3000 lines, warn the user and offer to chunk the review by file group.
   - If the user opts to chunk: agree on the first group, narrow `{diff_output}` accordingly, and list the remaining groups for the user to note for follow-up runs.
   - If the user declines: proceed as-is with the full diff.

8. Prepare review artifact paths. Set:
   - `{review_run_dir}` = `{implementation_artifacts}/review-output/<timestamp-or-unique-id>`
   - `{raw_findings_file}` = `{review_run_dir}/raw-findings.json`
   - `{triaged_findings_file}` = `{review_run_dir}/triaged-findings.json`

### CHECKPOINT

Present a summary before proceeding: diff stats (files changed, lines added/removed), `{review_mode}`, `{execution_mode_requested}`, the planned artifact path `{review_run_dir}`, and loaded spec/context docs (if any). HALT and wait for user confirmation to proceed.


## NEXT

Read fully and follow `./step-02-review.md`
