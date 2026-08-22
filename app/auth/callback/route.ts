/**
 * app/auth/callback/route.ts
 *
 * Google 인증이 끝나면 Supabase가 이 주소로 브라우저를 돌려보냅니다.
 * 주소에 붙어온 일회용 code를 실제 세션(쿠키)으로 바꾸는 것이 이 파일의 일입니다.
 *
 * 흐름:
 *   Google → Supabase(/auth/v1/callback) → 여기(?code=xxx) → /dashboard
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  const oauthError = searchParams.get("error");

  /**
   * next 파라미터는 로그인 후 돌아갈 경로입니다.
   *
   * ⚠️ 사용자가 보낸 값을 그대로 믿으면 안 됩니다.
   *    "https://악성사이트.com" 같은 값이 들어오면 우리 로그인 화면을 거쳐
   *    다른 사이트로 보내버리는 통로(open redirect)가 됩니다.
   *    그래서 "/"로 시작하되 "//"로 시작하지 않는 경로만 허용합니다.
   */
  const rawNext = searchParams.get("next");
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : "/dashboard";

  /**
   * 배포 환경에서 origin이 내부 주소로 잡히는 문제를 피합니다.
   *
   * Vercel은 CDN 뒤에서 앱을 실행하기 때문에 request.url의 주소가
   * 실제 사용자가 보는 주소와 다를 수 있습니다.
   * 그대로 쓰면 로그인 직후 http:// 내부 주소로 튕깁니다.
   */
  const forwardedHost = request.headers.get("x-forwarded-host");
  const isLocal = process.env.NODE_ENV === "development";
  const baseUrl = isLocal
    ? origin
    : forwardedHost
      ? `https://${forwardedHost}`
      : origin;

  // 사용자가 Google 화면에서 "취소"를 눌렀거나 권한을 거부한 경우
  if (oauthError) {
    return NextResponse.redirect(`${baseUrl}/login?error=denied`);
  }

  if (!code) {
    return NextResponse.redirect(`${baseUrl}/login?error=missing_code`);
  }

  const supabase = await createClient();

  // 일회용 code를 세션으로 교환합니다.
  // 이 호출이 성공하면 쿠키에 로그인 정보가 심어집니다.
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${baseUrl}/login?error=exchange_failed`);
  }

  return NextResponse.redirect(`${baseUrl}${next}`);
}
