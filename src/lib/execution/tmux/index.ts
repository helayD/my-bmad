/**
 * tmux adapter — public API surface.
 *
 * Consumers import from this barrel rather than reaching into submodules directly.
 */

export { buildSessionName, parseSessionName } from "./naming";
export {
  isTmuxAvailable,
  createSession,
  killSession,
  hasSession,
  resolvePanePid,
  isValidSessionName,
  type TmuxCreateResult,
} from "./client";
export {
  TMUX_ERROR_CODES,
  type TmuxErrorCode,
  TmuxAdapterError,
  mapTmuxError,
} from "./errors";
