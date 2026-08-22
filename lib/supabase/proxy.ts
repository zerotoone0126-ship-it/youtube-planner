/**
 * lib/supabase/proxy.ts
 *
 * 모든 요청보다 먼저 실행되어 두 가지를 합니다.
 *   1. 로그인 세션 갱신 (2-C에서 만든 부분)
 *   2. 라우트 가드 — 로그인 안 한 사람을 /login으로 보내기 (2-D에서 추가)
 *
 * ⚠️ 여기서는 DB를 조회하지 않습니다.
 *    이 코드는 모든 요청마다 실행되기 때문에, DB 왕복을 넣으면
 *    앱 전체가 느려집니다.
 *    "온보딩을 했는가" 같은 DB가 필요한 판단은
 *    app/(app)/layout.tsx 에서 합니다.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/database.types";

/**
 * 로그인 없이 볼 수 있는 경로.
 * 그 외 모든 경로는 로그인이 필요합니다.
 */
function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/login") return true;
  if (pathname.startsWith("/auth/")) return true;
  return false;
}

/**
 * 리다이렉트할 때 갱신된 세션 쿠키를 함께 실어보냅니다.
 *
 * ⚠️ 이 함수 없이 그냥 NextResponse.redirect()를 반환하면
 *    방금 갱신한 쿠키가 사라져서, 리다이렉트될 때마다
 *    세션이 만료되는 이상한 버그가 생깁니다.
 */
function redirectWithCookies(url: URL, from: NextResponse): NextResponse {
  const response = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => {
    response.cookies.set(cookie);
  });
  return response;
}

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

  // ⚠️⚠️ createServerClient()와 getClaims() 사이에 코드를 넣지 마세요.
  //      세션 갱신은 getClaims()가 불릴 때 일어나고,
  //      그 결과가 setAll을 통해 응답에 실립니다.
  //
  //      getSession()이 아니라 getClaims()를 쓰는 이유:
  //      getSession()은 쿠키 값을 그대로 믿습니다(위조 가능).
  //      getClaims()는 토큰 서명을 검증합니다.
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = Boolean(data?.claims);

  const { pathname } = request.nextUrl;

  // 로그인 안 했는데 보호된 경로에 접근 → /login으로 보냄
  // 원래 가려던 주소는 next에 담아두었다가 로그인 후 그리로 돌려보냅니다.
  if (!isLoggedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return redirectWithCookies(url, supabaseResponse);
  }

  // 이미 로그인했는데 로그인 화면에 접근 → 대시보드로 보냄
  if (isLoggedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return redirectWithCookies(url, supabaseResponse);
  }

  // ⚠️ 반드시 supabaseResponse를 그대로 반환해야 합니다.
  //    새 NextResponse를 만들어 반환하면 갱신된 쿠키가 사라집니다.
  return supabaseResponse;
}
