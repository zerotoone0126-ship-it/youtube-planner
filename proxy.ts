/**
 * proxy.ts  (프로젝트 최상단)
 *
 * Next.js 16부터 middleware.ts 가 proxy.ts 로 이름이 바뀌었습니다.
 * 내보내는 함수 이름도 middleware 가 아니라 proxy 입니다.
 *
 * 인터넷 자료 대부분은 아직 middleware.ts 로 되어 있습니다.
 * 그 이름으로 만들면 Next.js 16에서는 실행되지 않거나 경고가 뜹니다.
 */

import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  /**
   * 이 목록에 해당하지 않는 모든 경로에서 실행됩니다.
   * 정적 파일(_next/static, 이미지 등)에서는 세션 갱신이 필요 없으므로 제외합니다.
   * 매 요청마다 도는 코드라 제외 목록이 중요합니다.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
