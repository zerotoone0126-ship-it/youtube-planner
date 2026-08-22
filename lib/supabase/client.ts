/**
 * lib/supabase/client.ts
 *
 * 브라우저(Client Component)에서 쓰는 Supabase 클라이언트.
 *
 * 세션은 쿠키에 저장되고, 이 클라이언트는 document.cookie를 통해 읽습니다.
 * "use client" 가 붙은 컴포넌트에서만 사용하세요.
 *
 * 우리 앱에서는 거의 쓰지 않습니다.
 * 데이터 읽기는 Server Component가, 쓰기는 Server Action이 담당하기 때문입니다.
 * 실제 사용처는 "Google로 시작하기" 버튼 하나뿐입니다 (2-D).
 */

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
