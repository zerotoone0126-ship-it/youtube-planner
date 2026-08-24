/**
 * lib/validations/video-upload.ts
 *
 * 파일 선택 직후 브라우저에서 하는 사전 확인입니다. UX 목적만입니다 —
 * "이 파일은 확실히 거부될 테니 굳이 업로드를 시작하지 말자"는 정도의
 * 필터일 뿐, 진짜 MIME/컨테이너/코덱/길이 신뢰 검증은 하지 않습니다.
 *
 * 그 신뢰 검증은 이후 FFmpeg 파이프라인(ffprobe)의 몫으로 남겨둡니다
 * (docs/plan-step-4-1-db-migration.md 7-2장 원칙 그대로 — 여기서 미리
 * "이 정도면 통과"라고 판단해버리면, 나중에 실제 파이프라인이 하는 진짜
 * 검증과 클라이언트 판단이 어긋났을 때 어느 쪽을 믿어야 할지 애매해집니다).
 */

import { z } from "zod";
import { ALLOWED_VIDEO_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/upload/constants";

export const videoFileSchema = z
  .instanceof(File)
  .refine(
    (file) => (ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(file.type),
    { message: "MP4 파일만 업로드할 수 있어요." }
  )
  .refine((file) => file.size > 0, { message: "빈 파일은 업로드할 수 없어요." })
  .refine((file) => file.size <= MAX_UPLOAD_BYTES, {
    message: "지금은(Free plan) 50MB보다 작은 파일만 업로드할 수 있어요.",
  });

export type VideoFileValidationResult =
  | { ok: true }
  | { ok: false; message: string };

export function validateVideoFile(file: File): VideoFileValidationResult {
  const result = videoFileSchema.safeParse(file);
  if (result.success) return { ok: true };
  return { ok: false, message: result.error.issues[0]?.message ?? "선택한 파일을 업로드할 수 없어요." };
}
