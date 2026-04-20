import {
  TASK_AGENT_TYPE_LABELS,
  TASK_AGENT_TYPE_VALUES,
  type TaskAgentType,
} from "@/lib/tasks";

export interface ExecutionAgentCatalogItem {
  type: TaskAgentType;
  label: string;
  description: string;
  dispatchHint: string;
}

export const EXECUTION_AGENT_CATALOG: Record<TaskAgentType, ExecutionAgentCatalogItem> = {
  codex: {
    type: "codex",
    label: TASK_AGENT_TYPE_LABELS.codex,
    description: "适合范围明确的实现、修复和代码落地任务。",
    dispatchHint: "更适合明确、可直接开始编码的任务。",
  },
  "claude-code": {
    type: "claude-code",
    label: TASK_AGENT_TYPE_LABELS["claude-code"],
    description: "适合调研、方案设计、重构和探索类任务。",
    dispatchHint: "更适合需要先整理思路或处理复杂上下文的任务。",
  },
};

export function isTaskAgentType(value: unknown): value is TaskAgentType {
  return typeof value === "string" && TASK_AGENT_TYPE_VALUES.includes(value as TaskAgentType);
}

export function getExecutionAgentLabel(agentType: TaskAgentType): string {
  return EXECUTION_AGENT_CATALOG[agentType].label;
}

export function getExecutionAgentCatalog(): ExecutionAgentCatalogItem[] {
  return TASK_AGENT_TYPE_VALUES.map((agentType) => EXECUTION_AGENT_CATALOG[agentType]);
}

// ── Agent Launch Command Resolution ─────────────────────────────────────────────

export interface AgentLaunchCommand {
  /** Resolved executable binary / script path */
  command: string;
  /** Argument list passed to the executable. MUST NOT contain unsanitized user content. */
  args: string[];
  /** Optional map of environment variable overrides */
  env?: Record<string, string>;
  /** Optional working directory override; defaults to project root */
  cwd?: string;
}

export interface AgentLaunchConfig {
  agentType: TaskAgentType;
  /** Human-readable reason for diagnostics */
  reason: string;
  /** Resolved launch command (command + args) */
  launchCommand: AgentLaunchCommand;
  /** Optional path to a task-context file to inject as env var or flag */
  taskContextPath?: string;
}

/**
 * Resolve the actual launch command for an agent type.
 *
 * The agent type label (e.g. "codex") is NOT itself a shell command.
 * This function maps it to a real executable + args template, enabling
 * supervisor to spawn the agent without hardcoding shell strings.
 *
 * Returns null when the agent type is not available on the current host.
 * Throws when the agent type is unknown (programming error).
 */
export function resolveAgentLaunchCommand(
  agentType: TaskAgentType,
  options?: {
    taskContextPath?: string;
    projectRoot?: string;
    supervisorSessionRef?: string;
  },
): AgentLaunchConfig {
  const reason = `${TASK_AGENT_TYPE_LABELS[agentType]} agent 启动配置`;

  switch (agentType) {
    case "codex": {
      const args = buildCodexArgs(options);
      return {
        agentType,
        reason,
        launchCommand: {
          command: "codex",
          args,
          env: buildCodexEnv(options),
          cwd: options?.projectRoot,
        },
        taskContextPath: options?.taskContextPath,
      };
    }

    case "claude-code": {
      const args = buildClaudeCodeArgs(options);
      return {
        agentType,
        reason,
        launchCommand: {
          command: "claude",
          args,
          env: buildClaudeCodeEnv(options),
          cwd: options?.projectRoot,
        },
        taskContextPath: options?.taskContextPath,
      };
    }

    default: {
      // Exhaustiveness check — should never reach here with valid TaskAgentType
      const _exhaustive: never = agentType;
      return _exhaustive as never;
    }
  }
}

function buildCodexArgs(options?: {
  taskContextPath?: string;
  supervisorSessionRef?: string;
}): string[] {
  const args = ["--yes"];
  if (options?.supervisorSessionRef) {
    args.push("--session", options.supervisorSessionRef);
  }
  if (options?.taskContextPath) {
    args.push("--context-file", options.taskContextPath);
  }
  return args;
}

function buildClaudeCodeArgs(options?: {
  taskContextPath?: string;
  supervisorSessionRef?: string;
}): string[] {
  const args = ["--yes", "--no-input"];
  if (options?.supervisorSessionRef) {
    args.push("--session", options.supervisorSessionRef);
  }
  if (options?.taskContextPath) {
    args.push("--context-file", options.taskContextPath);
  }
  return args;
}

function buildCodexEnv(options?: {
  supervisorSessionRef?: string;
}): Record<string, string> {
  const env: Record<string, string> = {};
  if (options?.supervisorSessionRef) {
    env.CODEX_SESSION_REF = options.supervisorSessionRef;
  }
  return env;
}

function buildClaudeCodeEnv(options?: {
  supervisorSessionRef?: string;
}): Record<string, string> {
  const env: Record<string, string> = {};
  if (options?.supervisorSessionRef) {
    env.CLAUDE_SESSION_REF = options.supervisorSessionRef;
  }
  return env;
}
