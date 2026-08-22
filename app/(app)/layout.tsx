/**
 * app/(app)/layout.tsx
 *
 * 로그인한 사용자만 들어오는 영역의 공통 레이아웃.
 *
 * 두 가지 관문 역할을 합니다.
 *   1. 세션 확인 (proxy.ts에 이어 한 번 더 — 이중 방어)
 *   2. 온보딩 완료 여부 확인 → 안 했으면 /onboarding으로
 *
 * DB 조회가 필요한 판단을 proxy가 아니라 여기서 하는 이유:
 * proxy는 모든 요청마다 실행되므로 DB 왕복을 넣으면 앱 전체가 느려집니다.
 * 이 레이아웃은 실제로 로그인 영역에 들어올 때만 실행됩니다.
 *
 * 사이드바는 나중에 여기에 추가합니다.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;

  if (!userId) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .single();

  // 프로필을 못 읽은 경우(null)에도 온보딩으로 보냅니다.
  // 데이터가 불확실할 때는 앱을 진행시키지 않는 쪽이 안전합니다.
  if (!profile?.onboarding_completed) {
    redirect("/onboarding");
  }

  return <div className="min-h-svh">{children}</div>;
}
