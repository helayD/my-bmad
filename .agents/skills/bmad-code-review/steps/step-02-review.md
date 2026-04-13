---
failed_layers: '' # set at runtime: comma-separated list of layers that failed or returned empty
execution_mode_requested: '' # set at runtime: "auto" | "subagent" | "sequential"
execution_mode_resolved: '' # set at runtime: "subagent" | "sequential"
review_run_dir: '' # set at runtime: artifact directory for this review run
blind_output_file: '' # set at runtime
edge_output_file: '' # set at runtime
auditor_output_file: '' # set at runtime
raw_findings_file: '' # set at runtime
---

# Step 2: Review

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
- The Blind Hunter subagent receives NO project context — diff only.
- The Edge Case Hunter subagent receives diff and project read access.
- The Acceptance Auditor subagent receives diff, spec, and context docs.
- The parent agent is the only coordinator. Reviewer subagents do not spawn more subagents.

## INSTRUCTIONS

1. **Resolve execution mode.**
   - Determine the requested mode using this precedence:
     1. explicit `{execution_mode_requested}` captured from the user's invocation in Step 1
     2. optional config value `code_review_execution_mode`
     3. default `"auto"`
   - Determine whether capability probing is enabled using optional config value `code_review_capability_probe` (default `true`).
   - When probing is enabled, use the host runtime capability probe when available (for example `runtime.canLaunchSubagents?.()`).
   - If probing is enabled:
     - if the requested mode is `"auto"`, resolve to `"subagent"` when runtime support exists, otherwise `"sequential"`
     - if the requested mode is `"subagent"` but runtime support does not exist, resolve to `"sequential"`
     - if the requested mode is `"sequential"`, keep `"sequential"`
   - If probing is disabled, honor the requested mode strictly. If runtime cannot satisfy `"subagent"`, stop with a clear error instead of silently degrading.
   - Persist the result in `{execution_mode_resolved}` and announce it to the user.

2. **Prepare artifact paths for this run.**
   - Ensure `{review_run_dir}` exists.
   - Set:
     - `{blind_output_file}` = `{review_run_dir}/blind.json`
     - `{edge_output_file}` = `{review_run_dir}/edge.json`
     - `{auditor_output_file}` = `{review_run_dir}/auditor.json`
     - `{raw_findings_file}` = `{review_run_dir}/raw-findings.json`
   - Store any reviewer prompts or execution notes that would help replay the run in the same directory.

3. **Use a shared reviewer output contract.** Every reviewer must return ONLY a JSON object in this shape:

```json
{
  "layer": "blind|edge|auditor",
  "status": "ok|no_findings|failed",
  "summary": "one short paragraph",
  "findings": [
    {
      "title": "short finding title",
      "detail": "full explanation",
      "location": "path:line or null",
      "severity": "high|medium|low|unknown",
      "evidence": "diff evidence or reasoning",
      "rule_or_ac": "acceptance criterion, invariant, or null",
      "trigger_condition": "edge case trigger or null",
      "potential_consequence": "user-visible or system consequence"
    }
  ],
  "parsing_notes": []
}
```

4. **Execute the review layers.**
   - If `{review_mode}` = `"no-spec"`, note to the user: "Acceptance Auditor skipped — no spec file provided."
   - If `{execution_mode_resolved}` = `"subagent"`:
     - Launch the applicable reviewer layers in parallel as separate subagents without full conversation context.
     - **Blind Hunter**: receives `{diff_output}` only. No spec, no context docs, no project access. Invoke via the `bmad-review-adversarial-general` skill and require the shared JSON contract.
     - **Edge Case Hunter**: receives `{diff_output}` and read access to the project. Invoke via the `bmad-review-edge-case-hunter` skill and require the shared JSON contract.
     - **Acceptance Auditor** (only if `{review_mode}` = `"full"`): receives `{diff_output}`, the content of `{spec_file}`, and any loaded context docs. Its job is to compare implementation to requirements and return the shared JSON contract.
     - Save each raw result to its corresponding file as soon as it returns.
   - If `{execution_mode_resolved}` = `"sequential"`:
     - Run the same reviewer lenses inline, one after another, preserving the same isolation boundaries as closely as possible.
     - Write each result to the same output files so downstream steps do not care whether execution was parallel or sequential.

5. **Failure handling and repair.**
   - If any reviewer fails, times out, returns empty output, or violates the JSON contract, append the layer name to `{failed_layers}`.
   - Preserve the raw response anyway in the layer file when possible.
   - If the response is close to valid, do one best-effort repair pass to coerce it into the shared contract without inventing findings. If repair fails, keep the layer marked as failed and continue.

6. **Persist the aggregate handoff artifact.**
   - Build `{raw_findings_file}` containing:
     - `execution_mode_requested`
     - `execution_mode_resolved`
     - `review_mode`
     - `failed_layers`
     - `layers`: array of the successful reviewer payloads
     - `artifacts`: file paths for `blind`, `edge`, and `auditor`
   - This file is the authoritative handoff into Step 3.


## NEXT

Read fully and follow `./step-03-triage.md`
