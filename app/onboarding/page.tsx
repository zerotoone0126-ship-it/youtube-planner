/**
 * app/onboarding/page.tsx
 *
 * 2-D 확인용 임시 온보딩 화면입니다.
 * 실제 온보딩(5문항 폼)은 STEP 3에서 만들고, 이 파일은 그때 교체됩니다.
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

export default async function OnboardingPage(props: {
  // Next.js 16에서 searchParams는 Promise입니다. await 필수.
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const { error: errorCode, detail } = await props.searchParams;

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

  /**
   * ⚠️ 임시 코드입니다. STEP 3에서 실제 온보딩 폼으로 교체하며 삭제합니다.
   *
   * "use server"를 함수 안에 쓰면 그 함수 하나만 Server Action이 됩니다.
   */
  async function completeOnboarding() {
    "use server";

    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const id = data?.claims.sub;

    if (!id) {
      redirect("/login");
    }

    /**
     * ⚠️ .select().single() 이 반드시 필요합니다.
     *
     * .update() 만 쓰면 RLS가 막아서 0개 행이 바뀌어도 error가 null 입니다.
     * PostgREST는 "조건에 맞는 행이 없음"을 에러가 아닌 정상 응답으로 보기 때문입니다.
     * → 코드는 성공한 것처럼 흘러가고, DB는 그대로인 조용한 실패가 됩니다.
     *
     * .single() 을 붙이면 "정확히 1행"을 요구하므로,
     * 0행일 때 PGRST116 에러가 발생해 문제가 드러납니다.
     */
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true })
      .eq("id", id)
      .select("id, onboarding_completed")
      .single();

    if (error) {
      // 터미널에 전체 내용을 남깁니다. 화면에는 요약만 보냅니다.
      console.error("[onboarding] profiles UPDATE 실패", {
        userId: id,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });

      const params = new URLSearchParams({
        error: error.code || "update_failed",
        detail: error.message.slice(0, 200),
      });
      redirect(`/onboarding?${params.toString()}`);
    }

    // 에러는 없는데 값이 반영되지 않은 경우도 실패로 봅니다.
    if (!updated || updated.onboarding_completed !== true) {
      console.error("[onboarding] UPDATE는 통과했지만 값이 반영되지 않았습니다", {
        userId: id,
        updated,
      });

      const params = new URLSearchParams({
        error: "not_applied",
        detail: `반환된 행: ${JSON.stringify(updated)}`,
      });
      redirect(`/onboarding?${params.toString()}`);
    }

    console.log("[onboarding] 완료", updated);
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>채널 설정</CardTitle>
          <CardDescription>
            {profile?.display_name ?? "회원"}님, 반갑습니다. 채널 정보를
            입력하면 AI가 맞춤 아이디어를 만들어드립니다.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {errorCode && (
            <div
              role="alert"
              className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3"
            >
              <p className="text-sm font-medium text-destructive">
                온보딩 완료 처리에 실패했습니다.
              </p>
              <dl className="space-y-1 font-mono text-xs text-destructive/90">
                <div className="flex gap-2">
                  <dt className="shrink-0">code</dt>
                  <dd className="break-all">{errorCode}</dd>
                </div>
                {detail && (
                  <div className="flex gap-2">
                    <dt className="shrink-0">msg</dt>
                    <dd className="break-all">{detail}</dd>
                  </div>
                )}
              </dl>
              <p className="text-xs leading-relaxed text-destructive/80">
                {errorCode === "PGRST116"
                  ? "조건에 맞는 행이 0개입니다. RLS 정책이 막았거나 profiles에 내 행이 없습니다."
                  : "터미널(npm run dev 창)에 전체 내용이 출력되어 있습니다."}
              </p>
            </div>
          )}

          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            온보딩 5문항은 STEP 3에서 만듭니다.
            <br />
            지금은 아래 버튼으로 건너뛸 수 있습니다.
          </div>

          <form action={completeOnboarding}>
            <Button type="submit" size="lg" className="w-full">
              온보딩 완료로 표시 (임시)
            </Button>
          </form>

          <div className="border-t pt-4">
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm" className="w-full">
                로그아웃
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
