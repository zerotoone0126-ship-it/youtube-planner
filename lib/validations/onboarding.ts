/**
 * lib/validations/onboarding.ts
 *
 * 온보딩 5문항의 검증 규칙(Zod 스키마)입니다.
 *
 * 왜 폼 UI보다 이 파일을 먼저 만드나요?
 *
 *   "무엇이 유효한 값인가"를 한 곳에 정의해두면,
 *   화면(클라이언트)과 저장 로직(Server Action)이 같은 규칙을 공유합니다.
 *
 *   특히 Server Action 쪽 검증이 중요합니다 — 브라우저 개발자 도구로
 *   화면의 검증은 우회할 수 있지만, 서버에서 다시 검증하면 막을 수 있습니다.
 *   "클라이언트 검증은 사용자 편의, 서버 검증은 진짜 방어선"이 원칙입니다.
 *
 * lib/types.ts 의 CHANNEL_CATEGORIES 등을 그대로 가져다 씁니다.
 * 값 목록을 두 군데(타입 파일, 검증 파일)에 따로 적으면
 * 나중에 하나만 고치고 다른 하나를 잊어버리는 실수가 생기기 때문입니다.
 */

import { z } from "zod";
import {
  CHANNEL_CATEGORIES,
  VIDEO_STYLES,
  PRIMARY_GOALS,
  UPLOAD_FREQUENCIES,
} from "@/lib/types";

export const onboardingSchema = z.object({
  /** Q1. 채널 카테고리 — 1~2개.
   *  DB의 channels_categories_len_check 제약과 정확히 같은 규칙입니다. */
  categories: z
    .array(z.enum(CHANNEL_CATEGORIES))
    .min(1, "최소 1개는 선택해주세요.")
    .max(2, "최대 2개까지만 선택할 수 있어요."),

  /** Q2. 영상 형태 */
  videoStyle: z.enum(VIDEO_STYLES, "영상 형태를 선택해주세요."),

  /** Q3. 가장 중요한 목표 */
  primaryGoal: z.enum(PRIMARY_GOALS, "가장 중요한 목표를 선택해주세요."),

  /** Q4. 채널 소개 — AI가 아이디어를 만들 때 가장 중요하게 보는 입력입니다.
   *  너무 짧으면 AI가 참고할 정보가 없으므로 최소 길이를 둡니다. */
  description: z
    .string()
    .trim()
    .min(10, "채널 소개를 10자 이상 적어주세요.")
    .max(500, "500자 이내로 적어주세요."),

  /** Q5. 목표 업로드 빈도 */
  uploadFrequency: z.enum(UPLOAD_FREQUENCIES, "목표 업로드 빈도를 선택해주세요."),
});

/**
 * z.infer로 스키마에서 타입을 뽑아냅니다.
 * 타입을 손으로 또 적지 않아도 됩니다 — 스키마가 바뀌면 타입도 자동으로 따라옵니다.
 */
export type OnboardingInput = z.infer<typeof onboardingSchema>;
