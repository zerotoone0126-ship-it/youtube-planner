/**
 * lib/supabase/proxy.ts
 *
 * 모든 요청보다 먼저 실행되어 로그인 세션을 갱신합니다.
 *
 * 왜 필요한가:
 *   Supabase 세션(access token)은 1시간이면 만료됩니다.
 *   만료 전에 갱신해서 새 토큰을 쿠키에 다시 심어줘야 하는데,
 *   Server Component에서는 쿠키를 쓸 수 없습니다.
 *   그래서 쿠키를 쓸 수 있는 유일한 곳인 여기서 처리합니다.
 *
 *   이 파일이 없거나 잘못되면 → 새로고침할 때마다 로그아웃되는 증상이 납니다.
 *   설계 문서 §09에서 "가장 오래 잡아먹는 문제"로 꼽은 바로 그 부분입니다.
 *
 * ⚠️ @supabase/ssr 0.12 부터 setAll의 두 번째 인자로 headers가 들어옵니다.
 *    이 헤더(Cache-Control: no-store 등)를 응답에 붙이지 않으면,
 *    CDN이 "로그인 쿠키가 담긴 응답"을 캐시해서
 *    다른 사용자에게 내 세션이 전달될 수 있습니다.
 *    인터넷의 옛날 예제들에는 이 인자가 없습니다. 따라 하지 마세요.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // 1) 이번 요청이 갱신된 쿠키를 바로 볼 수 있게 반영
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          // 2) 갱신된 요청으로 응답을 다시 만들고
          supabaseResponse = NextResponse.next({ request });

          // 3) 브라우저에 새 쿠키를 내려보냄
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });

          // 4) 캐시 금지 헤더를 붙임 (CDN이 세션을 캐시하지 못하게)
          Object.entries(headers).forEach(([key, value]) => {
            supabaseResponse.headers.set(key, value);
          });
        },
      },
    },
  );

  // ⚠️⚠️ 아래 getClaims() 호출과 위 createServerClient() 사이에
  //      절대 다른 코드를 넣지 마세요.
  //
  //      세션 갱신은 getClaims()가 불릴 때 일어나고,
  //      그 결과가 setAll을 통해 응답에 실립니다.
  //      사이에 응답을 만드는 코드가 끼면 갱신된 쿠키를 잃어버립니다.
  //
  //      getSession()이 아니라 getClaims()를 쓰는 이유:
  //      getSession()은 쿠키 값을 그대로 믿습니다(위조 가능).
  //      getClaims()는 토큰 서명을 검증합니다.
  await supabase.auth.getClaims();

  // 라우트 가드(로그인 안 하면 /login으로 보내기)는 2-D에서 여기에 추가합니다.

  // ⚠️ 반드시 supabaseResponse를 그대로 반환해야 합니다.
  //    새 NextResponse를 만들어 반환하면 갱신된 쿠키가 사라집니다.
  return supabaseResponse;
}
