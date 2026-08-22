/**
 * app/(app)/dashboard/page.tsx
 *
 * 2-D 확인용 임시 대시보드입니다.
 * 실제 대시보드는 개발 순서 STEP 11에서 만듭니다.
 */

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

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, email, onboarding_completed, created_at")
    .eq("id", claims!.sub)
    .single();

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            안녕하세요, {profile?.display_name ?? "회원"}님 👋
          </CardTitle>
          <CardDescription>
            STEP 2-D — 로그인 확인용 임시 대시보드입니다.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">이메일</dt>
              <dd className="truncate">{profile?.email ?? "-"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">사용자 ID</dt>
              <dd className="truncate font-mono text-xs">{claims?.sub}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">온보딩</dt>
              <dd>{profile?.onboarding_completed ? "완료" : "미완료"}</dd>
            </div>
          </dl>

          <div className="border-t pt-4">
            {/* Server Action을 form의 action에 그대로 연결합니다.
                별도의 API 라우트나 fetch가 필요 없습니다. */}
            <form action={signOut}>
              <Button type="submit" variant="outline" className="w-full">
                로그아웃
              </Button>
            </form>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            이 화면이 보이고 새로고침해도 유지되면 로그인이 정상 동작하는
            것입니다.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
