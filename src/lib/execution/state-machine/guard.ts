/**
 * Development-time guard to prevent direct Task.status updates.
 *
 * In development mode, this module provides utilities to detect and warn about
 * direct Prisma status modifications that bypass the state machine.
 *
 * Production usage: This guard is informational only. The state machine is the
 * authoritative layer; enforcement comes from code review and integration points.
 */

const FORBIDDEN_DIRECT_STATUS_UPDATE = process.env.NODE_ENV === "development";

export function assertNoDirectStatusUpdate(): void {
  if (!FORBIDDEN_DIRECT_STATUS_UPDATE) return;
  // In a full implementation, this would be hooked into Prisma middleware.
  // For now, the constraint is enforced through code review and integration.
  // See: src/lib/execution/state-machine/README.md for the enforcement pattern.
}

export function warnIfDirectStatusUpdate(source: string): void {
  if (FORBIDDEN_DIRECT_STATUS_UPDATE) {
    console.warn(
      `[StateMachine Guard] Direct Task.status modification detected at: ${source}\n` +
      "All status changes must go through transitionTask() in src/lib/execution/state-machine/transitioner.ts",
    );
  }
}
