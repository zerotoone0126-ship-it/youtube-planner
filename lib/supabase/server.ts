/**
 * lib/supabase/server.ts
 *
 * 서버(Server Component / Server Action / Route Handler)에서 쓰는 클라이언트.
 *
 * ⚠️ 요청마다 새로 만들어야 합니다.
 *    모듈 최상단에서 한 번 만들어 재사용하면, 다른 사용자의 세션이 섞입니다.
 *    그래서 상수가 아니라 함수로 내보냅니다.
 *
 * Next.js 16에서 cookies()는 비동기입니다. 그래서 이 함수도 async 입니다.
 * 사용할 때 await 를 빠뜨리지 마세요:
 *
 *     const supabase = await createClient();
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Component에서는 쿠키를 쓸 수 없어 여기서 에러가 납니다.
            // 정상입니다. 세션 갱신은 proxy.ts가 대신 처리합니다.
            //
            // ⚠️ 단, proxy.ts가 없거나 잘못되어 있으면
            //    이 catch가 문제를 조용히 삼켜서
            //    "새로고침하면 로그아웃되는" 증상이 됩니다.
          }
        },
      },
    },
  );
}
