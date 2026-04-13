---
name: bmad-dev-story
description: 'Execute story implementation from a context-rich story file, optionally orchestrating bounded subagents for exploration, coding, testing, and implementation handoff, until the story is ready for review. Use when the user says "dev this story [story file]" or "implement the next story in the sprint plan"'
---

# Dev Story

Use this skill when the user wants a story implemented end-to-end from the story file, including code changes, tests, story tracking updates, and review-ready handoff.

## What This Skill Owns

- Selects the story to implement from an explicit path or sprint tracking.
- Loads story context, dev notes, and project guidance before coding.
- Implements tasks and subtasks in story order until all acceptance criteria are satisfied.
- Updates only the permitted story sections:
  - Tasks/Subtasks checkboxes
  - Dev Agent Record
  - File List
  - Change Log
  - Status
- Moves the story to `review` only after implementation, testing, and validation are complete.

## Multi-Agent Collaboration Rules

- The **parent agent** is the only orchestrator.
- The parent agent owns:
  - story selection
  - sprint-status updates
  - story file edits
  - final completion decisions
- Subagents may be used for bounded work such as:
  - codebase exploration and context gathering
  - implementing a disjoint code slice
  - authoring tests for a disjoint test slice
  - validation and review-ready handoff summaries
- Subagents do **not** spawn more subagents.
- Subagents do **not** edit the story file or sprint-status file directly.
- When subagents are unavailable, the workflow degrades to sequential inline execution without blocking.

## Review Handoff Signals

A story is ready to hand off when all of these are true:

- Story `Status` is `review`
- `File List` is complete
- `Dev Agent Record` contains implementation and validation notes
- Any prior `Review Follow-ups (AI)` items were resolved or explicitly documented
- A concise implementation handoff summary is available for downstream review

## Workflow

Follow the instructions in [workflow.md](./workflow.md).
