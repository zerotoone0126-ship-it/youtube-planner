/**
 * app/onboarding/page.tsx
 *
 * STEP 3-B — 실제 5문항 온보딩 폼(OnboardingForm)을 보여줍니다.
 *
 * 이 파일 자체는 여전히 "게이트 역할"만 합니다:
 *   - 로그인 안 했으면 /login
 *   - 이미 온보딩 끝냈으면 /dashboard
 *   - 그 외에는 온보딩 폼을 보여줌
 *
 * 실제 문항 UI와 상태 관리는 전부 components/onboarding/onboarding-form.tsx
 * 안에 있습니다. 이 페이지는 그 컴포넌트를 감싸는 틀만 담당합니다.
 *
 * ⚠️ 이전 버전에 있던 임시 completeOnboarding() Server Action은 삭제했습니다.
 *    실제 저장 로직은 STEP 3-C에서 이 폼과 연결하는 새 Server Action으로 다시 만듭니다.
 *
 * (app) 그룹 밖에 있는 이유:
 * (app)/layout.tsx 이 "온보딩 안 했으면 /onboarding으로 보내기"를 하는데,
 * 이 페이지가 그 안에 있으면 자기 자신으로 무한히 리다이렉트됩니다.
 */

import { redirect } from "next/navigation";
import { signOut } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;

  if (!userId) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, onboarding_completed")
    .eq("id", userId)
    .single();

  // 이미 온보딩을 끝냈으면 대시보드로 보냅니다.
  if (profile?.onboarding_completed) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>채널 설정</CardTitle>
          <CardDescription>
            {profile?.display_name ?? "회원"}님, 반갑습니다. 채널 정보를
            입력하면 AI가 맞춤 아이디어를 만들어드립니다.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <OnboardingForm />

          <div className="border-t pt-4">
            <form action={signOut}>
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                className="w-full"
              >
                로그아웃
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
