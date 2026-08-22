/**
 * lib/actions/auth.ts
 *
 * Server Action — 브라우저에서 호출하지만 실제로는 서버에서 실행되는 함수.
 *
 * 파일 맨 위의 "use server" 가 그 표시입니다.
 * 이 파일의 함수들은 form의 action에 그대로 연결할 수 있고,
 * API 라우트를 따로 만들 필요가 없습니다.
 *
 * 앞으로 모든 "쓰기" 동작(제목 수정, 상태 변경, 체크 토글 등)이
 * 이 패턴을 따릅니다.
 */

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // redirect는 내부적으로 에러를 던져 흐름을 중단시킵니다.
  // 그래서 try/catch로 감싸면 안 됩니다.
  redirect("/login");
}
