/**
 * lib/upload/constants.ts
 *
 * 업로드 관련 제약값을 한 곳에 모아둡니다.
 *
 * ⚠️ 여기 값은 UX용 사전 확인일 뿐입니다 — 진짜 신뢰 경계는 항상 서버(Supabase
 * Storage/Postgres)입니다. 클라이언트에서 이 값으로 막아도, 우회해서 보낸
 * 요청은 서버 쪽 제약(현재는 Supabase 프로젝트의 전역 업로드 상한)이 막습니다.
 * (docs/plan-step-4-1-db-migration.md 24장 blocker #1 참고)
 *
 * STEP 4-2 기준: staging 프로젝트가 Free plan이라 전역 업로드 상한이 50MB입니다.
 * Pro로 전환하고 `videos` 버킷의 file_size_limit을 올릴 때, 이 값도 함께
 * 올려주세요 (V1 목표: 2GB / 최대 영상 길이 30분 — 길이 제한은 DB CHECK가 아니라
 * 이후 ffprobe 검증 단계에서 확인합니다. plan-step-4-1 23-4장 참고).
 */

/** 클라이언트 사전 확인용 파일 크기 상한 (bytes). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB — Free plan 전역 상한

/** `videos` 버킷이 허용하는 mime type과 동일하게 맞춥니다 (0007 B-1 참고). */
export const ALLOWED_VIDEO_MIME_TYPES = ["video/mp4"] as const;

/** TUS 업로드 청크 크기. Supabase 공식 문서: "it must be set to 6MB (for now) do not change it". */
export const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
