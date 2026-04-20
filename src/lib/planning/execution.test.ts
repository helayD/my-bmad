import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

const mockCreatePlanningArtifactWriter = vi.fn();
const mockCreateProjectContentProvider = vi.fn();
const mockScanProjectArtifacts = vi.fn();
const mockSyncArtifacts = vi.fn();
const mockExecutePlanningSkill = vi.fn();

vi.mock("@/lib/planning/artifact-writer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/planning/artifact-writer")>(
    "@/lib/planning/artifact-writer",
  );

  return {
    ...actual,
    createPlanningArtifactWriter: mockCreatePlanningArtifactWriter,
  };
});

vi.mock("@/lib/content-provider/project-provider", () => ({
  createProjectContentProvider: mockCreateProjectContentProvider,
}));

vi.mock("@/lib/artifacts/scanner", () => ({
  scanProjectArtifacts: mockScanProjectArtifacts,
}));

vi.mock("@/lib/artifacts/sync", () => ({
  syncArtifacts: mockSyncArtifacts,
}));

vi.mock("@/lib/planning/skill-executors", () => ({
  executePlanningSkill: mockExecutePlanningSkill,
}));

let planningRequestState: Record<string, unknown>;
let planningSteps: Array<Record<string, unknown>>;
let auditEvents: Array<Record<string, unknown>>;

function createStepRecord(input: {
  stepKey: string;
  skillKey: string;
  sequence: number;
  title: string;
  status?: string;
  retryCount?: number;
  details?: unknown;
}): Record<string, unknown> {
  return {
    id: `step-${input.stepKey}`,
    stepKey: input.stepKey,
    skillKey: input.skillKey,
    sequence: input.sequence,
    title: input.title,
    status: input.status ?? "pending",
    retryCount: input.retryCount ?? 0,
    details: input.details ?? null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    errorMessage: null,
    outputSummary: null,
    artifactPaths: [],
  };
}

const mockPlanningExecutionStepFindMany = vi.fn(async () =>
  planningSteps
    .map((step) => ({ ...step }))
    .sort((left, right) => Number(left.sequence) - Number(right.sequence)),
);
const mockPlanningExecutionStepCreateMany = vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
  for (const record of data) {
    planningSteps.push(
      createStepRecord({
        stepKey: String(record.stepKey),
        skillKey: String(record.skillKey),
        sequence: Number(record.sequence),
        title: String(record.title),
      }),
    );
  }

  return { count: data.length };
});
const mockPlanningExecutionStepUpdate = vi.fn(async ({ where, data }: { where: { planningRequestId_stepKey: { stepKey: string } }; data: Record<string, unknown> }) => {
  const target = planningSteps.find((step) => step.stepKey === where.planningRequestId_stepKey.stepKey);
  if (!target) {
    throw new Error("step-not-found");
  }

  Object.assign(target, data);
  return { ...target };
});
const mockPlanningExecutionStepUpdateMany = vi.fn(async ({
  where,
  data,
}: {
  where: { planningRequestId: string; stepKey: string; status: { in: string[] } };
  data: Record<string, unknown>;
}) => {
  const target = planningSteps.find((step) => (
    step.stepKey === where.stepKey
    && where.status.in.includes(String(step.status))
  ));

  if (!target) {
    return { count: 0 };
  }

  Object.assign(target, data);
  return { count: 1 };
});
const mockPlanningRequestUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
  Object.assign(planningRequestState, data);
  return { ...planningRequestState };
});
const mockAuditEventCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
  auditEvents.push(data);
  return data;
});

vi.mock("@/lib/db/client", () => ({
  prisma: {
    planningExecutionStep: {
      findMany: mockPlanningExecutionStepFindMany,
      createMany: mockPlanningExecutionStepCreateMany,
      update: mockPlanningExecutionStepUpdate,
    },
    planningRequest: {
      update: mockPlanningRequestUpdate,
    },
    auditEvent: {
      create: mockAuditEventCreate,
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        planningExecutionStep: {
          update: mockPlanningExecutionStepUpdate,
          updateMany: mockPlanningExecutionStepUpdateMany,
        },
        planningRequest: {
          update: mockPlanningRequestUpdate,
        },
        auditEvent: {
          create: mockAuditEventCreate,
        },
      }),
  },
}));

const { executePlanningRequest } = await import("@/lib/planning/execution");
const { PlanningArtifactWriteError } = await import("@/lib/planning/artifact-writer");

beforeEach(() => {
  vi.clearAllMocks();

  planningRequestState = {
    id: "planning-1",
    status: "planning",
    progressPercent: 45,
    nextStep: "准备执行规划",
    executionStartedAt: null,
    executionCompletedAt: null,
    executionFailedAt: null,
    artifactSummary: [],
    generatedArtifactCount: 0,
    lastExecutionErrorCode: null,
  };
  planningSteps = [];
  auditEvents = [];

  mockCreatePlanningArtifactWriter.mockResolvedValue({
    readArtifact: vi.fn().mockResolvedValue({
      exists: false,
      content: null,
      sha: null,
    }),
    writeArtifact: vi.fn(),
  });
  mockCreateProjectContentProvider.mockResolvedValue({
    getTree: vi.fn().mockResolvedValue({
      paths: [],
      rootDirectories: ["_bmad-output"],
    }),
  });
  mockScanProjectArtifacts.mockResolvedValue({ artifacts: [], errors: [] });
  mockSyncArtifacts.mockResolvedValue({ created: 1, updated: 0, deleted: 0, errors: [] });
});

describe("executePlanningRequest", () => {
  it("persists completed steps and marks the request awaiting confirmation on full success", async () => {
    mockExecutePlanningSkill
      .mockResolvedValueOnce({
        outputSummary: "已生成 PRD 草案。",
        writeResults: [
          {
            path: "_bmad-output/planning-artifacts/prd.md",
            mode: "create",
            commitSha: null,
            summary: "创建 PRD",
            cacheTags: [],
          },
        ],
        artifactSummary: [
          {
            path: "_bmad-output/planning-artifacts/prd.md",
            title: "PRD 草案",
            kind: "prd",
            summary: "已生成 PRD。",
            sourceSkillKey: "bmad-create-prd",
            status: "created",
          },
        ],
        errors: [],
      })
      .mockResolvedValueOnce({
        outputSummary: "已生成 Epics。",
        writeResults: [
          {
            path: "_bmad-output/planning-artifacts/epics.md",
            mode: "create",
            commitSha: null,
            summary: "创建 Epics",
            cacheTags: [],
          },
        ],
        artifactSummary: [
          {
            path: "_bmad-output/planning-artifacts/epics.md",
            title: "Epics",
            kind: "epics",
            summary: "已生成 Epics。",
            sourceSkillKey: "bmad-create-epics-and-stories",
            status: "created",
          },
        ],
        errors: [],
      });

    const result = await executePlanningRequest({
      workspaceId: "workspace-1",
      projectId: "project-1",
      planningRequestId: "planning-1",
      projectName: "Demo Project",
      userId: "user-1",
      rawGoal: "为项目添加用户反馈收集功能",
      selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
      repo: {
        id: "repo-1",
        owner: "demo",
        name: "demo",
        branch: "main",
        displayName: "demo",
        description: null,
        sourceType: "local",
        localPath: "/tmp/demo",
        lastSyncedAt: null,
      },
      executionStartedAt: null,
      artifactSummary: [],
    });

    expect(result.didExecute).toBe(true);
    expect(planningRequestState.status).toBe("awaiting-confirmation");
    expect(planningRequestState.generatedArtifactCount).toBe(2);
    expect(planningSteps.map((step) => step.status)).toEqual(["completed", "completed"]);
    expect(mockScanProjectArtifacts).toHaveBeenCalledTimes(2);
    expect(mockSyncArtifacts).toHaveBeenCalledTimes(2);
    expect(auditEvents.map((event) => event.eventName)).toContain("planningRequest.executionCompleted");
  });

  it("keeps previously completed steps when a later step fails", async () => {
    mockExecutePlanningSkill
      .mockResolvedValueOnce({
        outputSummary: "已生成 PRD 草案。",
        writeResults: [
          {
            path: "_bmad-output/planning-artifacts/prd.md",
            mode: "create",
            commitSha: null,
            summary: "创建 PRD",
            cacheTags: [],
          },
        ],
        artifactSummary: [
          {
            path: "_bmad-output/planning-artifacts/prd.md",
            title: "PRD 草案",
            kind: "prd",
            summary: "已生成 PRD。",
            sourceSkillKey: "bmad-create-prd",
            status: "created",
          },
        ],
        errors: [],
      })
      .mockRejectedValueOnce(new PlanningArtifactWriteError("PLANNING_ARTIFACT_WRITE_ERROR"));

    await expect(
      executePlanningRequest({
        workspaceId: "workspace-1",
        projectId: "project-1",
        planningRequestId: "planning-1",
        projectName: "Demo Project",
        userId: "user-1",
        rawGoal: "为项目添加用户反馈收集功能",
        selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
        repo: {
          id: "repo-1",
          owner: "demo",
          name: "demo",
          branch: "main",
          displayName: "demo",
          description: null,
          sourceType: "local",
          localPath: "/tmp/demo",
          lastSyncedAt: null,
        },
        executionStartedAt: null,
        artifactSummary: [],
      }),
    ).rejects.toThrow("规划工件写入失败");

    expect(planningRequestState.status).toBe("failed");
    expect(planningRequestState.generatedArtifactCount).toBe(1);
    expect(planningSteps.map((step) => step.status)).toEqual(["completed", "failed"]);
  });

  it("retries from the first failed step instead of rerunning completed steps", async () => {
    planningRequestState = {
      ...planningRequestState,
      status: "failed",
      executionStartedAt: new Date("2026-04-11T14:00:00.000Z"),
      artifactSummary: [
        {
          path: "_bmad-output/planning-artifacts/prd.md",
          title: "PRD 草案",
          kind: "prd",
          summary: "已生成 PRD。",
          sourceSkillKey: "bmad-create-prd",
          status: "created",
        },
      ],
      generatedArtifactCount: 1,
      lastExecutionErrorCode: "PLANNING_ARTIFACT_WRITE_ERROR",
    };
    planningSteps = [
      createStepRecord({
        stepKey: "generate-prd",
        skillKey: "bmad-create-prd",
        sequence: 1,
        title: "生成 PRD 工件",
        status: "completed",
        details: {
          artifactSummary: planningRequestState.artifactSummary,
        },
      }),
      createStepRecord({
        stepKey: "generate-epics-and-stories",
        skillKey: "bmad-create-epics-and-stories",
        sequence: 2,
        title: "生成 Epics 与 Story 草案",
        status: "failed",
        retryCount: 0,
      }),
    ];

    mockExecutePlanningSkill.mockResolvedValueOnce({
      outputSummary: "已生成 Epics。",
      writeResults: [
        {
          path: "_bmad-output/planning-artifacts/epics.md",
          mode: "create",
          commitSha: null,
          summary: "创建 Epics",
          cacheTags: [],
        },
      ],
      artifactSummary: [
        {
          path: "_bmad-output/planning-artifacts/epics.md",
          title: "Epics",
          kind: "epics",
          summary: "已生成 Epics。",
          sourceSkillKey: "bmad-create-epics-and-stories",
          status: "created",
        },
      ],
      errors: [],
    });

    const result = await executePlanningRequest({
      workspaceId: "workspace-1",
      projectId: "project-1",
      planningRequestId: "planning-1",
      projectName: "Demo Project",
      userId: "user-1",
      rawGoal: "为项目添加用户反馈收集功能",
      selectedSkillKeys: ["bmad-create-prd", "bmad-create-epics-and-stories"],
      repo: {
        id: "repo-1",
        owner: "demo",
        name: "demo",
        branch: "main",
        displayName: "demo",
        description: null,
        sourceType: "local",
        localPath: "/tmp/demo",
        lastSyncedAt: null,
      },
      executionStartedAt: planningRequestState.executionStartedAt as Date,
      artifactSummary: planningRequestState.artifactSummary,
    });

    expect(result.didExecute).toBe(true);
    expect(mockExecutePlanningSkill).toHaveBeenCalledTimes(1);
    expect(mockExecutePlanningSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        skillKey: "bmad-create-epics-and-stories",
      }),
    );
    expect(planningSteps[1]?.retryCount).toBe(1);
    expect(planningRequestState.status).toBe("awaiting-confirmation");
    expect(planningRequestState.generatedArtifactCount).toBe(2);
  });

  it("claims the next step atomically so a concurrent execute cannot rerun it", async () => {
    let releaseExecution: (() => void) | null = null;
    const firstStepStarted = new Promise<void>((resolve) => {
      mockExecutePlanningSkill.mockImplementationOnce(async () => {
        resolve();

        await new Promise<void>((release) => {
          releaseExecution = release;
        });

        return {
          outputSummary: "已生成 PRD 草案。",
          writeResults: [
            {
              path: "_bmad-output/planning-artifacts/prd.md",
              mode: "create",
              commitSha: null,
              summary: "创建 PRD",
              cacheTags: [],
            },
          ],
          artifactSummary: [
            {
              path: "_bmad-output/planning-artifacts/prd.md",
              title: "PRD 草案",
              kind: "prd",
              summary: "已生成 PRD。",
              sourceSkillKey: "bmad-create-prd",
              status: "created",
            },
          ],
          errors: [],
        };
      });
    });

    const firstRun = executePlanningRequest({
      workspaceId: "workspace-1",
      projectId: "project-1",
      planningRequestId: "planning-1",
      projectName: "Demo Project",
      userId: "user-1",
      rawGoal: "为项目添加用户反馈收集功能",
      selectedSkillKeys: ["bmad-create-prd"],
      repo: {
        id: "repo-1",
        owner: "demo",
        name: "demo",
        branch: "main",
        displayName: "demo",
        description: null,
        sourceType: "local",
        localPath: "/tmp/demo",
        lastSyncedAt: null,
      },
      executionStartedAt: null,
      artifactSummary: [],
    });

    await firstStepStarted;

    const secondRun = executePlanningRequest({
      workspaceId: "workspace-1",
      projectId: "project-1",
      planningRequestId: "planning-1",
      projectName: "Demo Project",
      userId: "user-1",
      rawGoal: "为项目添加用户反馈收集功能",
      selectedSkillKeys: ["bmad-create-prd"],
      repo: {
        id: "repo-1",
        owner: "demo",
        name: "demo",
        branch: "main",
        displayName: "demo",
        description: null,
        sourceType: "local",
        localPath: "/tmp/demo",
        lastSyncedAt: null,
      },
      executionStartedAt: null,
      artifactSummary: [],
    });

    const secondResult = await secondRun;
    expect(secondResult.didExecute).toBe(false);
    expect(mockExecutePlanningSkill).toHaveBeenCalledTimes(1);

    const release = releaseExecution as unknown as (() => void) | null;
    if (release) {
      release();
    }

    const firstResult = await firstRun;
    expect(firstResult.didExecute).toBe(true);
    expect(planningSteps.map((step) => step.status)).toEqual(["completed"]);
  });
});
