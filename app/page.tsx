/**
 * app/page.tsx
 *
 * 랜딩 페이지. 로그인하지 않아도 볼 수 있는 유일한 화면입니다.
 * 실제 랜딩(Hero + 제품 흐름 + 스크린샷)은 STEP 12에서 만듭니다.
 */

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims);

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-10 bg-muted/30 p-6">
      <div className="max-w-xl space-y-5 text-center">
        <h1 className="text-3xl font-bold leading-snug tracking-tight sm:text-4xl">
          유튜브, 뭘 올려야 할지
          <br />
          고민하지 마세요.
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground">
          AI가 당신의 채널에 맞는 영상 아이디어부터 제목, 썸네일,
          <br className="hidden sm:inline" />
          영상 기획, 업로드 일정까지 한 곳에서 만들어드립니다.
        </p>
      </div>

      {/*
        이 프로젝트의 Button은 @base-ui/react 기반이라 asChild(Slot)가 없습니다.
        그래서 Button 안에 Link를 넣지 않고,
        Link 자체에 buttonVariants()가 만든 클래스를 입혀 버튼처럼 보이게 합니다.

        Button 안에 Link를 중첩하면 <button> 안에 <a>가 들어가
        HTML 규격에도 어긋나고 키보드 동작도 깨집니다.
      */}
      <div className="flex w-full max-w-xs flex-col gap-3">
        {isLoggedIn ? (
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
            대시보드로 이동 →
          </Link>
        ) : (
          <Link
            href="/login"
            className={cn(buttonVariants({ size: "lg" }), "w-full")}
          >
            무료로 시작하기 →
          </Link>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        STEP 2-D — 임시 랜딩 화면입니다.
      </p>
    </main>
  );
}
