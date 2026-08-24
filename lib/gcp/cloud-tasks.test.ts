/**
 * lib/gcp/cloud-tasks.test.ts
 *
 * ⚠️ 이 파일은 이번 세션에서 npm install이 막혀 있어 실제로 실행되지
 * 않았습니다(코드만 작성됨, 검증되지 않음) — 최종 보고서 참고. `@google-cloud/tasks`의
 * CloudTasksClient를 vi.mock으로 대체해서 실제 GCP 호출 없이 검증하도록
 * 작성했습니다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const createTaskMock = vi.fn();
const queuePathMock = vi.fn(
  (project: string, location: string, queue: string) =>
    `projects/${project}/locations/${location}/queues/${queue}`,
);
const taskPathMock = vi.fn(
  (project: string, location: string, queue: string, task: string) =>
    `projects/${project}/locations/${location}/queues/${queue}/tasks/${task}`,
);

// vi.fn().mockImplementation(() => ({...}))는 화살표 함수라 `new`로 호출할 수
// 없습니다("is not a constructor"). 실제 class를 써서 `new CloudTasksClient()`가
// 정상적으로 인스턴스를 만들 수 있게 합니다 — 인스턴스 메서드는 그대로
// 바깥의 공유 mock 함수(queuePathMock/taskPathMock/createTaskMock)를 참조하므로
// 기존 검증 방식은 바뀌지 않습니다.
class MockCloudTasksClient {
  queuePath = queuePathMock;
  taskPath = taskPathMock;
  createTask = createTaskMock;
}

vi.mock("@google-cloud/tasks", () => {
  return {
    CloudTasksClient: MockCloudTasksClient,
    protos: {
      google: {
        cloud: {
          tasks: {
            v2: {
              HttpMethod: { POST: 2 },
            },
          },
        },
      },
    },
  };
});

const ENV_KEYS = [
  "GCP_PROJECT_ID",
  "GCP_LOCATION",
  "GCP_CLOUD_TASKS_QUEUE",
  "GCP_CLOUD_RUN_JOB",
  "GCP_TASKS_OAUTH_SERVICE_ACCOUNT_EMAIL",
] as const;

function setValidEnv() {
  process.env.GCP_PROJECT_ID = "test-project";
  process.env.GCP_LOCATION = "asia-northeast3";
  process.env.GCP_CLOUD_TASKS_QUEUE = "video-analysis-queue";
  process.env.GCP_CLOUD_RUN_JOB = "video-analysis-worker";
  process.env.GCP_TASKS_OAUTH_SERVICE_ACCOUNT_EMAIL =
    "tasks-invoker@test-project.iam.gserviceaccount.com";
}

beforeEach(() => {
  createTaskMock.mockReset();
  queuePathMock.mockClear();
  taskPathMock.mockClear();
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("buildVideoAnalysisTaskId", () => {
  it("analysisId로 결정적인 task id를 만든다", async () => {
    const { buildVideoAnalysisTaskId } = await import("./cloud-tasks");
    expect(buildVideoAnalysisTaskId("abc-123")).toBe("video-analysis-abc-123");
  });
});

describe("buildCloudRunJobsRunUrl", () => {
  it("Cloud Run Admin API의 jobs.run 엔드포인트를 만든다 (Cloud Run 서비스 URL이 아님)", async () => {
    const { buildCloudRunJobsRunUrl } = await import("./cloud-tasks");
    expect(
      buildCloudRunJobsRunUrl({ projectId: "p", location: "asia-northeast3", jobName: "j" }),
    ).toBe("https://run.googleapis.com/v2/projects/p/locations/asia-northeast3/jobs/j:run");
  });
});

describe("enqueueVideoAnalysisTask", () => {
  it("필수 환경변수가 비어 있으면 던진다", async () => {
    const { enqueueVideoAnalysisTask } = await import("./cloud-tasks");
    await expect(enqueueVideoAnalysisTask("analysis-1")).rejects.toThrow(/GCP_PROJECT_ID/);
    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it("성공하면 outcome:'created'를 반환하고, ANALYSIS_ID만 override로 담아 OAuth 토큰으로 호출한다", async () => {
    setValidEnv();
    createTaskMock.mockResolvedValueOnce([{}]);
    const { enqueueVideoAnalysisTask } = await import("./cloud-tasks");

    const result = await enqueueVideoAnalysisTask("analysis-1");

    expect(result).toEqual({ outcome: "created" });
    expect(createTaskMock).toHaveBeenCalledTimes(1);

    const [{ task }] = createTaskMock.mock.calls[0];
    expect(task.name).toContain("video-analysis-analysis-1");
    expect(task.httpRequest.oauthToken).toEqual({
      serviceAccountEmail: "tasks-invoker@test-project.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/cloud-platform",
    });

    const body = JSON.parse((task.httpRequest.body as Buffer).toString("utf-8"));
    expect(body).toEqual({
      overrides: {
        containerOverrides: [{ env: [{ name: "ANALYSIS_ID", value: "analysis-1" }] }],
      },
    });
  });

  it("ALREADY_EXISTS(gRPC code 6)는 성공으로 취급한다 — 문자열 메시지 파싱이 아니라 숫자 코드로 판별한다", async () => {
    setValidEnv();
    createTaskMock.mockRejectedValueOnce({
      code: 6,
      message: "이 문자열은 절대 파싱 대상이 아니어야 한다",
    });
    const { enqueueVideoAnalysisTask } = await import("./cloud-tasks");

    const result = await enqueueVideoAnalysisTask("analysis-1");
    expect(result).toEqual({ outcome: "already_exists" });
  });

  it("ALREADY_EXISTS가 아닌 다른 gRPC 에러는 그대로 던진다", async () => {
    setValidEnv();
    createTaskMock.mockRejectedValueOnce({ code: 5, message: "NOT_FOUND" });
    const { enqueueVideoAnalysisTask } = await import("./cloud-tasks");

    await expect(enqueueVideoAnalysisTask("analysis-1")).rejects.toMatchObject({ code: 5 });
  });
});
