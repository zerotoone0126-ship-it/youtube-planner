/**
 * lib/actions/video-analyses.ts
 *
 * video_analyses에 대한 Server Action 3개.
 *
 * ⚠️ 이 테이블에는 일반 insert/update RLS 정책이 없습니다(0007 참고) — 생성/전이는
 * 전부 0006의 SECURITY DEFINER RPC를 통해서만 가능합니다. 그래서 여기서는
 * onboarding.ts처럼 `.from("video_analyses").insert(...)`를 쓰지 않고
 * `.rpc(...)`만 씁니다.
 *
 * 세 함수 모두 onboarding.ts와 같은 원칙을 따릅니다:
 *   - 먼저 로그인 여부를 확인한다 (RPC 자체도 내부에서 auth.uid()를 확인하지만,
 *     여기서 먼저 걸러야 "로그인 안 했는데 이상한 에러"가 아니라 명확한
 *     안내를 줄 수 있습니다).
 *   - 실패는 예외가 아니라 { error } 값으로 돌려준다 (호출부에서 다루기 쉽게).
 *   - 네트워크 장애 같은 진짜 예외만 try/catch로 잡는다.
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type VideoAnalysisRow = Database["public"]["Tables"]["video_analyses"]["Row"];

export type VideoAnalysisActionResult =
  | { data: VideoAnalysisRow; error?: undefined }
  | { data?: undefined; error: { code: string; message: string } };

/**
 * 분석 행을 생성합니다 (`create_video_analysis` RPC).
 *
 * clientRequestId를 넘기면 같은 값으로 재시도해도 새 행이 생기지 않고
 * 기존 행을 그대로 돌려받습니다(0006의 `INSERT ... ON CONFLICT` 참고) — 브라우저에서
 * "재시도" 버튼을 눌렀을 때 중복 분석이 쌓이지 않게 하는 핵심 장치입니다.
 * 호출하는 쪽(컴포넌트)에서 파일을 선택한 시점에 한 번만 uuid를 만들고,
 * 같은 시도 동안은 그 값을 계속 재사용해야 합니다.
 */
export async function createVideoAnalysis(input: {
  genre: string;
  channelId?: string | null;
  clientRequestId: string;
}): Promise<VideoAnalysisActionResult> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) {
    return { error: { code: "not_authenticated", message: "로그인이 필요합니다." } };
  }

  try {
    // ⚠️ p_channel_id는 항상 명시적으로 보냅니다 (null이라도).
    // `input.channelId ?? undefined`로 쓰면 supabase-js가 body를 JSON으로
    // 직렬화할 때 undefined 값의 키를 통째로 빼버려서, PostgREST가 실제로는
    // { p_genre, p_client_request_id } 두 개짜리 요청으로 인식합니다 —
    // create_video_analysis(p_genre, p_channel_id, p_client_request_id)와
    // 매칭되지 않아 "Could not find the function ... in the schema cache"
    // 에러가 납니다. DB 함수 시그니처는 문제 없었고(0006 그대로), 이 액션이
    // 보내는 요청 바디가 3개 파라미터를 다 채우지 못한 게 원인이었습니다.
    const { data, error } = await supabase.rpc("create_video_analysis", {
      p_genre: input.genre,
      // ⚠️ 런타임 값은 여전히 null입니다(undefined 아님) — 위 주석 그대로,
      // undefined로 바꾸면 JSON body에서 키 자체가 빠져 STEP 4-2의 스키마
      // 캐시 불일치 버그가 재발합니다. 아래 캐스팅은 타입 레벨에서만
      // 필요합니다: 생성된 Database 타입의 create_video_analysis Args가
      // p_channel_id?: string (undefined만 허용)로 되어 있어서, 실제로
      // null을 보내는 이 코드가 TS2322로 막힙니다. 그래서 값은 그대로 두고
      // 타입만 넓혀 컴파일을 통과시킵니다.
      p_channel_id: (input.channelId ?? null) as string | undefined,
      p_client_request_id: input.clientRequestId,
    });

    if (error || !data) {
      console.error("[video-analyses] create_video_analysis 실패", {
        code: error?.code,
        message: error?.message,
      });
      return {
        error: {
          code: error?.code || "create_failed",
          message: error?.message || "분석 생성에 실패했습니다.",
        },
      };
    }

    return { data };
  } catch (err) {
    console.error("[video-analyses] create_video_analysis 예상치 못한 오류", err);
    return {
      error: { code: "unexpected_error", message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
    };
  }
}

/**
 * 업로드 완료를 확정합니다 (`mark_video_analysis_uploaded` RPC).
 *
 * storage.objects에 실제로 파일이 존재하는지는 이 RPC 내부에서 확인합니다
 * (0006 참고) — 여기서는 그냥 id만 넘기면 됩니다. RPC가 `null`을 돌려주면
 * "소유가 아니거나 이미 다른 상태"라는 뜻이지 에러가 아닙니다 — 그래도
 * 브라우저 쪽에는 실패로 보여줘야 하므로 error로 변환합니다.
 */
export async function confirmVideoUploaded(analysisId: string): Promise<VideoAnalysisActionResult> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) {
    return { error: { code: "not_authenticated", message: "로그인이 필요합니다." } };
  }

  try {
    const { data, error } = await supabase.rpc("mark_video_analysis_uploaded", {
      p_id: analysisId,
    });

    if (error) {
      console.error("[video-analyses] mark_video_analysis_uploaded 실패", {
        code: error.code,
        message: error.message,
      });
      return {
        error: { code: error.code || "confirm_failed", message: error.message || "업로드 확인에 실패했습니다." },
      };
    }

    if (!data) {
      return {
        error: {
          code: "upload_not_found",
          message: "업로드된 파일을 아직 찾을 수 없습니다. 업로드가 끝난 뒤 다시 시도해주세요.",
        },
      };
    }

    return { data };
  } catch (err) {
    console.error("[video-analyses] mark_video_analysis_uploaded 예상치 못한 오류", err);
    return {
      error: { code: "unexpected_error", message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
    };
  }
}

/** 사용자가 업로드를 취소했을 때 (`cancel_video_analysis` RPC). */
export async function cancelVideoAnalysis(analysisId: string): Promise<VideoAnalysisActionResult> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) {
    return { error: { code: "not_authenticated", message: "로그인이 필요합니다." } };
  }

  try {
    const { data, error } = await supabase.rpc("cancel_video_analysis", {
      p_id: analysisId,
    });

    if (error || !data) {
      console.error("[video-analyses] cancel_video_analysis 실패", {
        code: error?.code,
        message: error?.message,
      });
      return {
        error: { code: error?.code || "cancel_failed", message: error?.message || "취소 처리에 실패했습니다." },
      };
    }

    return { data };
  } catch (err) {
    console.error("[video-analyses] cancel_video_analysis 예상치 못한 오류", err);
    return {
      error: { code: "unexpected_error", message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
    };
  }
}

/**
 * 업로드가 끝난 분석을 큐에 등록합니다 (`queue_video_analysis` RPC, STEP 4-3A).
 *
 * `uploaded → queued` 전이. 0011 마이그레이션(아직 remote 미적용) 적용 후에는
 * 이미 `queued`인 본인 소유 행을 다시 호출해도 멱등하게 그대로 반환합니다 —
 * `app/api/video-analyses/[id]/queue/route.ts`가 Cloud Tasks 생성 실패 뒤
 * 재시도할 때 이 멱등성에 의존합니다. 0011 적용 전인 지금은 이미 queued인
 * 행을 다시 호출하면 기존 0010 동작대로 null(=not_queueable)이 반환됩니다 —
 * 이는 마이그레이션 미적용에 따른 알려진 차이이지 이 함수의 버그가 아닙니다.
 *
 * RPC가 null을 반환하는 경우(존재하지 않음/소유 아님/uploaded나 queued가
 * 아닌 상태)를 전부 "not_queueable" 하나의 에러 코드로 뭉뚱그립니다 — 어느
 * 이유인지 호출자에게 구분해서 알려주지 않는 것이 기존 프로젝트의 information
 * disclosure 관례(cancel_video_analysis 등도 이유를 구분하지 않고 null만 반환)와
 * 일치합니다.
 */
export async function queueVideoAnalysis(analysisId: string): Promise<VideoAnalysisActionResult> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) {
    return { error: { code: "not_authenticated", message: "로그인이 필요합니다." } };
  }

  try {
    const { data, error } = await supabase.rpc("queue_video_analysis", {
      p_id: analysisId,
    });

    if (error) {
      console.error("[video-analyses] queue_video_analysis 실패", {
        code: error.code,
        message: error.message,
      });
      return {
        error: { code: error.code || "queue_failed", message: error.message || "큐 등록에 실패했습니다." },
      };
    }

    if (!data) {
      return {
        error: {
          code: "not_queueable",
          message: "지금은 이 분석을 큐에 등록할 수 없습니다.",
        },
      };
    }

    return { data };
  } catch (err) {
    console.error("[video-analyses] queue_video_analysis 예상치 못한 오류", err);
    return {
      error: { code: "unexpected_error", message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." },
    };
  }
}
