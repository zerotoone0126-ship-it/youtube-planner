/**
 * lib/actions/dev-auth.ts
 *
 * STEP 4-2 staging 전용 이메일+비밀번호 로그인.
 *
 * 배경: 새로 만든 youtube-planner-staging 프로젝트에는 아직 프로덕션의
 * Google OAuth 클라이언트/redirect 설정이 되어 있지 않습니다 (Google Cloud
 * Console + Supabase Auth 대시보드에서 수동으로 설정해야 하고, 이 세션은
 * 그 설정에 접근할 방법이 없습니다). 그래서 vertical slice를 실제로
 * 눌러보려면 임시 로그인 경로가 필요합니다.
 *
 * ⚠️ NEXT_PUBLIC_ENABLE_DEV_LOGIN=true 일 때만 동작합니다 (서버에서도
 *    다시 확인합니다 — 클라이언트 쪽에서 폼을 숨기는 것만으로는 막히지
 *    않으므로 이중 방어).
 * ⚠️ production .env에는 이 값을 절대 넣지 마세요.
 * ⚠️ STEP 4-2 staging 검증이 끝나면 이 파일과 로그인 페이지의 관련 UI를
 *    제거하거나, 최소한 .env.local의 플래그를 반드시 꺼두세요.
 */

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type DevSignInResult = { error: { message: string } } | undefined;

export async function devSignInWithPassword(input: {
  email: string;
  password: string;
}): Promise<DevSignInResult> {
  if (process.env.NEXT_PUBLIC_ENABLE_DEV_LOGIN !== "true") {
    return { error: { message: "이 로그인 방법은 비활성화되어 있습니다." } };
  }

  if (!input.email || !input.password) {
    return { error: { message: "이메일과 비밀번호를 입력해주세요." } };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) {
    return { error: { message: `로그인에 실패했습니다: ${error.message}` } };
  }

  // redirect는 내부적으로 에러를 던져 흐름을 중단시킵니다. try/catch로 감싸지 않습니다.
  redirect("/dashboard");
}
