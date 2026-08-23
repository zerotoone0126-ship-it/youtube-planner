/**
 * lib/actions/onboarding.ts
 *
 * 온보딩 폼을 실제로 저장하는 Server Action입니다.
 *
 * STEP 2-D의 completeOnboarding()과 다른 점:
 *   그때는 페이지 파일(app/onboarding/page.tsx) 안에 "use server" 함수를
 *   직접 넣고, <form action={completeOnboarding}>처럼 폼에 바로 연결했습니다.
 *
 *   이번에는 이 함수를 별도 파일로 분리하고, 컴포넌트에서 일반 함수처럼
 *   import해서 호출합니다 (components/onboarding/onboarding-form.tsx 참고).
 *   이렇게 하는 이유: 이 폼은 카테고리 다중 선택 · 버튼형 단일 선택 등
 *   HTML의 기본 <input name="..."> 방식으로 표현하기 애매한 상태가 많아서,
 *   먼저 화면(state)에서 Zod로 검증한 "정리된 값"을 만든 다음 그 값을
 *   그대로 서버로 넘기는 방식이 더 단순합니다.
 *
 *   "use server"가 파일 맨 위에 있으면 그 파일의 모든 export 함수가
 *   전부 Server Action이 됩니다 (파일 하나 = Server Action 모음).
 *
 * ⚠️ 클라이언트에서 이미 검증했더라도 여기서 다시 검증합니다.
 *    브라우저 개발자 도구로 fetch를 직접 조작하면 클라이언트 검증은 우회할 수 있지만,
 *    여기(서버)에서 막으면 이상한 값이 DB에 들어갈 수 없습니다.
 */

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { onboardingSchema } from "@/lib/validations/onboarding";
import type { ChannelInsert } from "@/lib/types";

export type SubmitOnboardingResult = {
  error: { code: string; message: string };
};

export async function submitOnboarding(
  input: unknown
): Promise<SubmitOnboardingResult | undefined> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;

  if (!userId) {
    redirect("/login");
  }

  const parsed = onboardingSchema.safeParse(input);

  if (!parsed.success) {
    console.error("[onboarding] 서버 측 검증 실패", parsed.error.issues);
    return {
      error: {
        code: "invalid_input",
        message: "입력값이 올바르지 않습니다. 새로고침 후 다시 시도해주세요.",
      },
    };
  }

  const { categories, videoStyle, primaryGoal, description, uploadFrequency } =
    parsed.data;

  const channelPayload: ChannelInsert = {
    user_id: userId,
    categories,
    video_style: videoStyle,
    primary_goal: primaryGoal,
    description,
    upload_frequency: uploadFrequency,
  };

  /**
   * ⚠️ STEP 3-D에서 추가: 아래 DB 작업들은 지금까지 "Supabase가 { error }를
   * 정상적으로 돌려주는 실패"만 처리하고 있었습니다. 네트워크 장애처럼
   * 요청 자체가 예외(throw)를 던지는 경우는 방어가 없었습니다.
   *
   * 그래서 DB 읽기/쓰기 구간만 try로 감쌉니다.
   *
   * ⚠️ redirect("/dashboard")는 일부러 이 try 블록 밖(함수 맨 끝)에 둡니다.
   *    redirect()는 내부적으로 예외를 던져서 동작하는 함수라(lib/actions/auth.ts 참고),
   *    try 안에 넣으면 "성공해서 리다이렉트하는 것"까지 catch가 가로채
   *    실패로 오인하는 심각한 버그가 생깁니다.
   */
  try {
    /**
     * 재시도 대비: 이미 이 사용자의 channels 행이 있으면(예: 채널 저장은 성공했는데
     * 그다음 profiles 업데이트에서 실패해 사용자가 다시 제출한 경우) 새로 만들지 않고
     * 있는 행을 업데이트합니다. 그렇지 않으면 재시도할 때마다 중복 채널이 쌓입니다.
     */
    const { data: existingChannel, error: lookupError } = await supabase
      .from("channels")
      .select("id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      console.error("[onboarding] channels 조회 실패", {
        userId,
        code: lookupError.code,
        message: lookupError.message,
      });
      return {
        error: {
          code: lookupError.code || "channel_lookup_failed",
          message: lookupError.message,
        },
      };
    }

    const channelWrite = existingChannel
      ? await supabase
          .from("channels")
          .update(channelPayload)
          .eq("id", existingChannel.id)
          .select("id")
          .single()
      : await supabase
          .from("channels")
          .insert(channelPayload)
          .select("id")
          .single();

    if (channelWrite.error || !channelWrite.data) {
      console.error("[onboarding] channels 저장 실패", {
        userId,
        code: channelWrite.error?.code,
        message: channelWrite.error?.message,
        details: channelWrite.error?.details,
        hint: channelWrite.error?.hint,
      });
      return {
        error: {
          code: channelWrite.error?.code || "channel_save_failed",
          message: channelWrite.error?.message || "채널 정보 저장에 실패했습니다.",
        },
      };
    }

    /**
     * channels 저장이 끝난 뒤에만 onboarding_completed를 true로 바꿉니다.
     * 순서를 바꾸면 "온보딩은 끝났다고 표시됐는데 채널 정보는 없는" 상태가 생깁니다.
     *
     * .select().single()이 필요한 이유는 STEP 2-D에서 겪은 문제와 같습니다:
     * .update()만 쓰면 RLS가 막아 0행이 바뀌어도 error가 null입니다.
     */
    const { data: updatedProfile, error: profileError } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true })
      .eq("id", userId)
      .select("id, onboarding_completed")
      .single();

    if (
      profileError ||
      !updatedProfile ||
      updatedProfile.onboarding_completed !== true
    ) {
      console.error("[onboarding] profiles 업데이트 실패", {
        userId,
        code: profileError?.code,
        message: profileError?.message,
        updatedProfile,
      });
      return {
        error: {
          code: profileError?.code || "profile_update_failed",
          message: profileError?.message || "온보딩 완료 처리에 실패했습니다.",
        },
      };
    }

    console.log("[onboarding] 완료", {
      userId,
      channelId: channelWrite.data.id,
    });
  } catch (err) {
    // 네트워크 장애 등, 위 DB 호출이 { error }가 아니라 예외로 실패한 경우.
    console.error("[onboarding] 예상치 못한 오류", err);
    return {
      error: {
        code: "unexpected_error",
        message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      },
    };
  }

  redirect("/dashboard");
}
