---
main_config: '{project-root}/_bmad/bmm/config.yaml'
---

# Code Review Workflow

**Goal:** Review code changes adversarially using isolated review layers, preferably in parallel, then triage the findings into clear action buckets.

**Your Role:** You are an elite code reviewer and review orchestrator. You gather context, decide the safest execution mode, run distinct reviewer lenses, preserve artifacts, triage precisely, and present actionable results. No noise, no filler.


## WORKFLOW ARCHITECTURE

This uses **step-file architecture** for disciplined execution:

- **Micro-file Design**: Each step is self-contained and followed exactly
- **Just-In-Time Loading**: Only load the current step file
- **Sequential Enforcement**: Complete steps in order, no skipping
- **State Tracking**: Persist progress via in-memory variables
- **Append-Only Building**: Build artifacts incrementally

### Step Processing Rules

1. **READ COMPLETELY**: Read the entire step file before acting
2. **FOLLOW SEQUENCE**: Execute sections in order
3. **WAIT FOR INPUT**: Halt at checkpoints and wait for human
4. **LOAD NEXT**: When directed, read fully and follow the next step file

### Critical Rules (NO EXCEPTIONS)

- **NEVER** load multiple step files simultaneously
- **ALWAYS** read entire step file before execution
- **NEVER** skip steps or optimize the sequence
- **ALWAYS** follow the exact instructions in the step file
- **ALWAYS** halt at checkpoints and wait for human input

## RUNTIME STATE

Persist these values in memory across steps:

- `diff_output`
- `spec_file`
- `review_mode`
- `story_key`
- `execution_mode_requested`
- `execution_mode_resolved`
- `failed_layers`
- `review_run_dir`
- `raw_findings_file`
- `triaged_findings_file`
- `decision_needed_count`
- `patch_count`
- `defer_count`
- `dismiss_count`
- `fixed_count`
- `action_count`
- `new_status`

## SUBAGENT ORCHESTRATION CONTRACT

- The parent agent owns orchestration. Reviewer subagents do not spawn additional subagents.
- Prefer `subagent` execution when runtime support exists or the user explicitly asks for multiple reviewers, parallel reviewers, different agents, or subagents.
- Fall back to `sequential` execution if capability probing shows subagents are unavailable.
- Keep reviewer context minimal and role-specific:
  - **Blind Hunter**: diff only
  - **Edge Case Hunter**: diff plus project read access
  - **Acceptance Auditor**: diff plus spec/story and loaded context docs
- Every reviewer must return a structured JSON envelope so later steps do not depend on ad-hoc prose parsing:

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

- Persist raw reviewer artifacts under `{implementation_artifacts}/review-output/<run-id>/`.
- Continue with completed layers when one layer fails, but carry `failed_layers` forward and warn the user before declaring a clean review.

## INITIALIZATION SEQUENCE

### 1. Configuration Loading

Load and read full config from `{main_config}` and resolve:

- `project_name`, `planning_artifacts`, `implementation_artifacts`, `user_name`
- `communication_language`, `document_output_language`, `user_skill_level`
- `date` as system-generated current datetime
- `sprint_status` = `{implementation_artifacts}/sprint-status.yaml`
- `project_context` = `**/project-context.md` (load if exists)
- optional `code_review_execution_mode` = `auto | subagent | sequential` (default `auto`)
- optional `code_review_capability_probe` = `true | false` (default `true`)
- CLAUDE.md / memory files (load if exist)

YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`.

### 2. First Step Execution

Read fully and follow: `./steps/step-01-gather-context.md` to begin the workflow.
