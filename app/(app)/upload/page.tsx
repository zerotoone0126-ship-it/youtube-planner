/**
 * app/(app)/upload/page.tsx
 *
 * STEP 4-2 vertical slice를 실제로 눌러보기 위한 임시 테스트 화면입니다.
 * (app) 레이아웃의 인증+온보딩 게이트를 그대로 통과해야 들어올 수 있습니다.
 *
 * ⚠️ 최종 디자인이 아닙니다 — "업로드 로직이 실제 staging에서 성공하는지"만
 * 확인하기 위한 화면입니다. 이 화면이 성공적으로 동작한 뒤에만 UI를 넓힙니다.
 *
 * channel_id를 여기서 미리 조회해서 넘기는 이유: create_video_analysis()는
 * p_channel_id가 not null이면 "호출자가 그 채널의 소유자인지" RLS가 아니라
 * 함수 안의 명시적 EXISTS 체크로 검증합니다(0006). null을 넘기면 그 검증
 * 자체가 그냥 스킵되어 채널 소유권 체크 경로를 전혀 실행해보지 못합니다 —
 * 이 vertical slice의 목적이 실제 흐름을 검증하는 것이므로, 로그인한
 * 사용자의 실제 채널을 찾아서 넘깁니다. 채널이 아직 없으면(이론상 온보딩을
 * 통과했으면 최소 1개 있어야 함) null로 폴백합니다.
 */

import { createClient } from "@/lib/supabase/server";
import { VideoUpload } from "@/components/upload/video-upload";

export default async function UploadPage() {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;

  let channelId: string | null = null;
  if (userId) {
    const { data: channel } = await supabase
      .from("channels")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    channelId = channel?.id ?? null;
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">영상 업로드 (STEP 4-2 검증용)</h1>
        <p className="text-sm text-muted-foreground">
          이 화면은 최소 업로드 흐름을 실제 staging Supabase에서 검증하기 위한
          임시 화면입니다. 디자인은 이후 언제든 교체됩니다.
        </p>
        {!channelId && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            이 계정에 연결된 채널을 찾지 못했습니다 — channel_id 없이(=null)
            진행합니다. create_video_analysis의 채널 소유권 검증 경로는 이번
            시도에서는 실행되지 않습니다.
          </p>
        )}
      </div>

      <VideoUpload channelId={channelId} />
    </main>
  );
}
