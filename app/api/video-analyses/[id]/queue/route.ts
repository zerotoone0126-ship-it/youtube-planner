/**
 * app/api/video-analyses/[id]/queue/route.ts
 *
 * STEP 4-3A: 업로드가 끝난 분석을 실제로 처리 파이프라인에 태우는 진입점.
 *
 * 흐름 (확정된 architecture, 여기서 다시 설계하지 않음):
 *   브라우저 → 여기(POST) → queue_video_analysis RPC (사용자 세션, service_role
 *   아님) → 성공하면 Cloud Tasks에 task 하나 생성(lib/gcp/cloud-tasks.ts) →
 *   Cloud Tasks가 자체 재시도/backoff를 갖고 Cloud Run Admin API의 jobs.run을
 *   직접 호출 → Cloud Run Job execution 시작. 중간 Cloud Run Service는 없다.
 *
 * ⚠️ 이 라우트는 service_role을 쓰지 않습니다. lib/supabase/server.ts의
 *    createClient()는 요청을 보낸 사용자의 세션 쿠키로 동작하는 클라이언트이고,
 *    queue_video_analysis RPC 자체가 SECURITY DEFINER + auth.uid() 소유권
 *    검사로 안전합니다 — 이 라우트가 추가로 권한을 확인할 필요는 없습니다.
 *
 * 상태 코드:
 *   400 — id가 UUID 형식이 아님
 *   401 — 로그인 안 함
 *   409 — 큐에 등록할 수 없는 상태(존재하지 않음/소유 아님/uploaded나 이미
 *         queued가 아닌 상태 — 이 프로젝트의 기존 관례대로 이유를 구분해서
 *         알려주지 않습니다. cancelVideoAnalysis 등도 동일하게 처리)
 *   202 — DB 전이는 성공했고 Cloud Tasks에도 성공적으로(또는 이미 존재해서)
 *         task가 생성됨. 실제 처리는 비동기로 진행됨을 뜻함.
 *   500 — RPC 자체의 예상치 못한 실패(500 계열 DB/네트워크 오류 등)
 *   503 — DB 전이(queue_video_analysis)는 성공했지만 Cloud Tasks task 생성이
 *         실패함. 재시도 가능한 상태를 뜻하는 5xx.
 *
 * ⚠️ Cloud Tasks 생성이 실패해도 DB를 uploaded로 되돌리지 않습니다. 상태는
 *    queued로 그대로 둡니다 — queue_video_analysis는 0011 적용 후 이미
 *    queued인 행에 대해 멱등하게 동작하도록 설계되어 있어서, 브라우저가
 *    503을 받고 이 엔드포인트를 다시 호출해도 안전하게 재시도됩니다(0011
 *    미적용 상태에서는 재호출 시 409가 나는 게 알려진 차이이며 버그가
 *    아닙니다 — Analysis 문서 참고).
 */

import { NextResponse } from "next/server";
import { queueVideoAnalysis } from "@/lib/actions/video-analyses";
import { enqueueVideoAnalysisTask } from "@/lib/gcp/cloud-tasks";

// @google-cloud/tasks는 Edge 런타임에서 동작하지 않는 Node 전용 패키지입니다.
// Node runtime을 명시해서 이 라우트가 Edge로 번들링되지 않게 합니다.
export const runtime = "nodejs";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json(
      { error: { code: "invalid_id", message: "잘못된 분석 id입니다." } },
      { status: 400 },
    );
  }

  // 1) DB 전이: uploaded → queued (사용자 세션, RLS/RPC 소유권 검사 그대로 적용).
  const queueResult = await queueVideoAnalysis(id);

  if (queueResult.error) {
    if (queueResult.error.code === "not_authenticated") {
      return NextResponse.json({ error: queueResult.error }, { status: 401 });
    }
    if (queueResult.error.code === "not_queueable") {
      return NextResponse.json({ error: queueResult.error }, { status: 409 });
    }
    // RPC 자체가 실패한 그 외의 경우 — DB 전이가 일어나지 않았으므로 재시도해도
    // 안전하지만, 서버 쪽 원인이라 500으로 알립니다.
    return NextResponse.json({ error: queueResult.error }, { status: 500 });
  }

  // 2) DB 전이는 성공. 이제 Cloud Tasks에 실제 실행을 위임합니다.
  //    이 시점부터는 절대 DB를 uploaded로 되돌리지 않습니다 — 실패해도 queued로
  //    남겨두고 503만 반환합니다(위 파일 상단 주석 참고).
  try {
    const task = await enqueueVideoAnalysisTask(id);
    return NextResponse.json(
      { data: { status: "queued", task } },
      { status: 202 },
    );
  } catch (err) {
    // ⚠️ 절대 err 객체 전체를 로그로 남기지 않습니다 — GCP 클라이언트 라이브러리
    // 예외에는 요청 메타데이터가 실려 있을 수 있고, 여기엔 service_role key나
    // Authorization 헤더가 없다는 걸 보장할 수 없습니다. 메시지만, 그것도
    // 사람이 읽을 진단용으로만 남깁니다.
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[video-analyses/queue] Cloud Tasks 생성 실패, DB는 queued로 유지", {
      analysisId: id,
      message,
    });
    return NextResponse.json(
      {
        error: {
          code: "task_enqueue_failed",
          message: "처리 큐 등록에 실패했습니다. 잠시 후 다시 시도해주세요.",
        },
      },
      { status: 503 },
    );
  }
}
