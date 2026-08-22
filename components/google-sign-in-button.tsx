/**
 * components/google-sign-in-button.tsx
 *
 * "Google로 시작하기" 버튼.
 *
 * 이 파일은 앱에서 거의 유일하게 브라우저용 Supabase 클라이언트를 쓰는 곳입니다.
 * 로그인 시작은 브라우저를 Google로 "이동"시키는 동작이라 서버에서 할 수 없습니다.
 */

"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/** Google 공식 로고 */
function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.55Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.11 0 5.72-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.55-2.03-6.46-4.76H1.7v2.98A11.5 11.5 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.54 14.66a6.9 6.9 0 0 1 0-4.4V7.28H1.7a11.51 11.51 0 0 0 0 10.36l3.84-2.98Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.72 1.2 15.11 0 12 0 7.46 0 3.54 2.6 1.7 6.4l3.84 2.98C6.45 6.65 9 4.75 12 4.75Z"
      />
    </svg>
  );
}

export function GoogleSignInButton({ next }: { next?: string }) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSignIn() {
    setLoading(true);
    setFailed(false);

    const supabase = createClient();

    // Google 인증이 끝난 뒤 Supabase가 우리 앱의 이 주소로 돌려보냅니다.
    // window.location.origin 을 쓰면 localhost와 배포 환경에서 각각 알맞게 동작합니다.
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    if (next) {
      callbackUrl.searchParams.set("next", next);
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl.toString() },
    });

    // 성공하면 브라우저가 Google로 이동하므로 아래 코드는 실행되지 않습니다.
    if (error) {
      setFailed(true);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        onClick={handleSignIn}
        disabled={loading}
        variant="outline"
        size="lg"
        className="w-full gap-3"
      >
        <GoogleLogo />
        {loading ? "Google로 이동 중..." : "Google로 시작하기"}
      </Button>

      {failed && (
        <p className="text-center text-sm text-destructive">
          로그인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.
        </p>
      )}
    </div>
  );
}
