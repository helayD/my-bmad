---
name: bmad-code-review
description: 'Review code changes adversarially using isolated review layers, preferably with parallel subagents, then triage findings into actionable categories. Use when the user says "run code review" or "review this code".'
---

# Code Review

Use this skill when the user wants a serious review of code changes, a branch diff, staged work, or a story implementation.

## What This Skill Does

- Gathers the exact review target and optional spec/story context.
- Runs up to three review lenses:
  - **Blind Hunter**: diff-only adversarial review
  - **Edge Case Hunter**: edge-case and branching-path review with project read access
  - **Acceptance Auditor**: spec-versus-implementation review when a story/spec exists
- Prefers **parallel subagent execution** when runtime capabilities allow it or when the user explicitly asks for multiple reviewers.
- Falls back to **sequential inline execution** without blocking the workflow when subagents are unavailable.
- Persists raw reviewer outputs and triaged findings under `{implementation_artifacts}/review-output/<run-id>/` so later steps can resume, audit, or re-run cleanly.

## Core Execution Rules

- Only the **parent agent** orchestrates the review. Reviewer subagents do **not** spawn more subagents.
- Keep each reviewer isolated:
  - Blind Hunter gets the diff only.
  - Edge Case Hunter gets the diff plus project read access.
  - Acceptance Auditor gets the diff, spec/story, and loaded context docs.
- Require each reviewer to return a structured result so findings can be merged deterministically.
- Continue with surviving layers if one reviewer fails, times out, or returns unusable output.

## Typical Triggers

- "Run code review"
- "Review this diff"
- "Review staged changes"
- "Review this branch against main"
- "Use multiple reviewers / parallel subagents"

## Workflow

Follow the instructions in [workflow.md](./workflow.md).
