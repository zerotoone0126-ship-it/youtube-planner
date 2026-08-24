/**
 * lib/gcp/cloud-tasks.ts
 *
 * STEP 4-3A: analysis_id 하나를 Cloud Tasks에 enqueue하는 server-only 헬퍼.
 *
 * ⚠️ 이 파일은 GCP Cloud Run **Job**의 `jobs.run` Admin API를 직접 목표로
 * 하는 Cloud Tasks HTTP target task를 만듭니다. 중간에 별도 Cloud Run
 * Service("launcher")는 없습니다 — 이건 이미 확정된 architecture이고
 * (docs/plan-step-4-3a-orchestration.md), 이 헬퍼 파일에서 다시 바꾸지
 * 않습니다.
 *
 * 인증은 OIDC가 아니라 OAuth 토큰입니다(`oauthToken`, scope는
 * cloud-platform) — jobs.run은 Cloud Run Admin API 엔드포인트라
 * Cloud Run 서비스 호출용 OIDC(run.invoker)가 아니라 일반 GCP API 호출용
 * OAuth 토큰이 필요합니다.
 *
 * 인증 자체(Application Default Credentials)는 이 파일이 만들지 않습니다 —
 * `CloudTasksClient`가 생성될 때 ADC를 자동으로 찾습니다
 * (`GOOGLE_APPLICATION_CREDENTIALS` 환경변수나 `gcloud auth application-default
 * login`으로 만들어둔 자격증명). 이 파일에는 어떤 credential JSON도, 어떤
 * 키 값도 절대 들어가지 않습니다.
 */

import { CloudTasksClient, protos } from "@google-cloud/tasks";

/**
 * gRPC 표준 상태 코드 중 ALREADY_EXISTS.
 * (google.rpc.Code.ALREADY_EXISTS == 6 — grpc/status_code_options.md 및
 * @grpc/grpc-js의 status.ALREADY_EXISTS와 동일한 값. 문자열 에러 메시지를
 * 파싱하지 않고 이 숫자 코드로만 판별합니다 — 지시사항 요구사항.)
 */
const GRPC_ALREADY_EXISTS_CODE = 6;

export type EnqueueVideoAnalysisTaskResult =
  | { outcome: "created" }
  | { outcome: "already_exists" };

/** 이 값이 곧 Cloud Tasks task ID입니다 — worker.test 등에서도 같은 함수를 재사용하세요. */
export function buildVideoAnalysisTaskId(analysisId: string): string {
  return `video-analysis-${analysisId}`;
}

export function buildCloudRunJobsRunUrl(config: {
  projectId: string;
  location: string;
  jobName: string;
}): string {
  return `https://run.googleapis.com/v2/projects/${config.projectId}/locations/${config.location}/jobs/${config.jobName}:run`;
}

/** 코드에 하드코딩하지 않고 항상 process.env에서 읽습니다 — 값이 없으면 즉시 실패. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[cloud-tasks] 환경변수 ${name}가 설정되지 않았습니다.`);
  }
  return value;
}

let cachedClient: CloudTasksClient | null = null;

/**
 * 모듈 스코프에서 한 번만 만들고 재사용합니다 — 요청마다 새로 만들 필요가
 * 없는 이유는 lib/supabase/server.ts의 Supabase 클라이언트와 다릅니다:
 * 이 클라이언트는 사용자별 세션 쿠키를 담지 않는(=요청 간 공유해도 안전한)
 * 서버 자신의 GCP 자격증명(ADC)만 사용합니다.
 */
function getTasksClient(): CloudTasksClient {
  if (!cachedClient) {
    cachedClient = new CloudTasksClient();
  }
  return cachedClient;
}

function isAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === GRPC_ALREADY_EXISTS_CODE;
}

/**
 * analysis_id 하나를 Cloud Tasks에 enqueue합니다.
 *
 * - task 이름은 `video-analysis-${analysisId}`로 결정적입니다 — 같은
 *   analysis_id로 두 번 호출해도(예: Next.js가 Cloud Tasks 생성에 성공한
 *   뒤 브라우저 응답이 유실되어 같은 요청이 재시도된 경우) 두 번째 호출은
 *   ALREADY_EXISTS를 받고, 이 함수는 그것을 에러가 아니라
 *   `{ outcome: "already_exists" }`로 돌려줍니다.
 * - ANALYSIS_ID만 execution-specific override로 보냅니다. taskCount 등
 *   정적 설정은 Cloud Run Job 자체 설정을 그대로 쓰고 여기서 override하지
 *   않습니다(요구사항 그대로).
 */
export async function enqueueVideoAnalysisTask(
  analysisId: string,
): Promise<EnqueueVideoAnalysisTaskResult> {
  const projectId = requireEnv("GCP_PROJECT_ID");
  const location = requireEnv("GCP_LOCATION");
  const queue = requireEnv("GCP_CLOUD_TASKS_QUEUE");
  const jobName = requireEnv("GCP_CLOUD_RUN_JOB");
  const serviceAccountEmail = requireEnv("GCP_TASKS_OAUTH_SERVICE_ACCOUNT_EMAIL");

  const client = getTasksClient();
  const parent = client.queuePath(projectId, location, queue);
  const taskId = buildVideoAnalysisTaskId(analysisId);
  const name = client.taskPath(projectId, location, queue, taskId);
  const url = buildCloudRunJobsRunUrl({ projectId, location, jobName });

  const requestBody = {
    overrides: {
      containerOverrides: [
        {
          env: [{ name: "ANALYSIS_ID", value: analysisId }],
        },
      ],
    },
  };

  const task: protos.google.cloud.tasks.v2.ITask = {
    name,
    httpRequest: {
      url,
      httpMethod: protos.google.cloud.tasks.v2.HttpMethod.POST,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify(requestBody), "utf-8"),
      oauthToken: {
        serviceAccountEmail,
        scope: "https://www.googleapis.com/auth/cloud-platform",
      },
    },
  };

  try {
    await client.createTask({ parent, task });
    return { outcome: "created" };
  } catch (err) {
    if (isAlreadyExistsError(err)) {
      return { outcome: "already_exists" };
    }
    throw err;
  }
}
