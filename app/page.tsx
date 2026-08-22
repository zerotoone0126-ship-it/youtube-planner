/**
 * app/page.tsx
 *
 * 2-C 확인용 임시 화면입니다.
 * Server Component에서 Supabase 서버 클라이언트가 정상 동작하는지 눈으로 확인합니다.
 * 2-D에서 실제 랜딩 페이지로 교체합니다.
 */

import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function Home() {
  // Server Component에서 Supabase에 접속합니다.
  // await 두 번에 주의하세요 — createClient도 async 입니다.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>YouTube Planner</CardTitle>
          <CardDescription>
            STEP 2-C — Supabase 연결 확인용 화면입니다.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">서버 클라이언트</span>
            <Badge variant="secondary">연결됨</Badge>
          </div>

          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">로그인 상태</span>
            {claims ? (
              <Badge className="max-w-[220px] truncate">
                {String(claims.email ?? claims.sub)}
              </Badge>
            ) : (
              <Badge variant="outline">로그인 안 됨</Badge>
            )}
          </div>

          <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
            &quot;연결됨 / 로그인 안 됨&quot; 이 보이면 정상입니다.
            <br />
            로그인 기능은 다음 단계(2-D)에서 만듭니다.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
