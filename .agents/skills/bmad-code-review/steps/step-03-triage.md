---
raw_findings_file: '' # set at runtime: aggregate reviewer output
triaged_findings_file: '' # set at runtime: normalized + triaged findings
execution_mode_resolved: '' # set at runtime: "subagent" | "sequential"
failed_layers: '' # set at runtime: comma-separated list of failed layers
review_run_dir: '' # set at runtime: artifact directory for this review run
---

# Step 3: Triage

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
- Be precise. When uncertain between categories, prefer the more conservative classification.

## INSTRUCTIONS

1. **Load `{raw_findings_file}` first.** Treat it as the source of truth for reviewer outputs. If it is missing, fall back to the per-layer files in `{review_run_dir}`. Preserve backward compatibility with older runs when possible.

2. **Normalize** findings into a common format.
   - Preferred input format is the JSON envelope defined in Step 2.
   - Legacy inputs may still appear:
     - Adversarial (Blind Hunter): markdown list of descriptions
     - Edge Case Hunter: JSON array with `location`, `trigger_condition`, `guard_snippet`, `potential_consequence` fields
     - Acceptance Auditor: markdown list with title, AC/constraint reference, and evidence
   - If a layer's output does not match its expected format, attempt best-effort parsing and record parsing issues for the user.

   Convert all to a unified list where each finding has:
   - `id` -- sequential integer
   - `source` -- `blind`, `edge`, `auditor`, or merged sources (e.g., `blind+edge`)
   - `title` -- one-line summary
   - `detail` -- full description
   - `location` -- file and line reference (if available)

3. **Deduplicate.** If two or more findings describe the same issue, merge them into one:
   - Use the most specific finding as the base (prefer edge-case JSON with location over adversarial prose).
   - Append any unique detail, reasoning, or location references from the other finding(s) into the surviving `detail` field.
   - Set `source` to the merged sources (e.g., `blind+edge`).

4. **Classify** each finding into exactly one bucket:
   - **decision_needed** -- There is an ambiguous choice that requires human input. The code cannot be correctly patched without knowing the user's intent. Only possible if `{review_mode}` = `"full"`.
   - **patch** -- Code issue that is fixable without human input. The correct fix is unambiguous.
   - **defer** -- Pre-existing issue not caused by the current change. Real but not actionable now.
   - **dismiss** -- Noise, false positive, or handled elsewhere.

   If `{review_mode}` = `"no-spec"` and a finding would otherwise be `decision_needed`, reclassify it as `patch` (if the fix is unambiguous) or `defer` (if not).

5. **Drop** all `dismiss` findings. Record the dismiss count for the summary.

6. **Persist triage output** to `{triaged_findings_file}` with:
   - `execution_mode_resolved`
   - `failed_layers`
   - `dismiss_count`
   - `decision_needed`
   - `patch`
   - `defer`
   - `all_findings`

7. If `{failed_layers}` is non-empty, report which layers failed before announcing results. If zero findings remain after dropping dismissed AND `{failed_layers}` is non-empty, warn the user that the review may be incomplete rather than announcing a clean review.

8. If zero findings remain after triage (all rejected or none raised): state "✅ Clean review — all executed layers passed." If any review layers failed, do not announce a clean review without the incompleteness warning.


## NEXT

Read fully and follow `./step-04-present.md`
