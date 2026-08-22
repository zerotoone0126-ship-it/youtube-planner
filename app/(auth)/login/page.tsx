/**
 * app/(auth)/login/page.tsx
 *
 * 로그인 화면. 버튼 하나뿐입니다.
 *
 * (auth) 처럼 괄호로 묶은 폴더는 "라우트 그룹"입니다.
 * URL에는 나타나지 않습니다 → 이 페이지의 주소는 /login 입니다.
 * 나중에 이 그룹에만 다른 레이아웃을 적용하기 위해 미리 나눠둡니다.
 */

import Link from "next/link";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** 콜백에서 실패하면 ?error=... 를 붙여 여기로 돌려보냅니다. */
const ERROR_MESSAGE: Record<string, string> = {
  denied: "Google 로그인이 취소되었습니다.",
  missing_code: "인증 정보가 전달되지 않았습니다. 다시 시도해주세요.",
  exchange_failed: "로그인 처리에 실패했습니다. 다시 시도해주세요.",
};

export default async function LoginPage(props: {
  // Next.js 16에서 searchParams는 Promise입니다. await 필수.
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await props.searchParams;
  const message = error ? ERROR_MESSAGE[error] : null;

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm space-y-6">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">YouTube Planner</CardTitle>
            <CardDescription>
              영상 아이디어부터 업로드까지, 한 곳에서.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {message && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
              >
                {message}
              </p>
            )}

            <GoogleSignInButton next={next} />

            <p className="text-center text-xs leading-relaxed text-muted-foreground">
              계속하면 서비스 이용약관과
              <br />
              개인정보 처리방침에 동의하는 것으로 간주됩니다.
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/" className="underline underline-offset-4">
            홈으로 돌아가기
          </Link>
        </p>
      </div>
    </main>
  );
}
