/**
 * components/onboarding/onboarding-form.tsx
 *
 * 온보딩 5문항 폼입니다.
 *
 * STEP 3-C부터: "검증하기" 버튼이 실제로 저장까지 합니다.
 *   1. 화면(state)에서 Zod로 1차 검증
 *   2. 통과하면 lib/actions/onboarding.ts 의 submitOnboarding()을 호출
 *      (Server Action을 <form action={...}>이 아니라 일반 함수처럼 직접 호출합니다.
 *       이 폼은 다중 선택/버튼형 선택이 많아 FormData보다 정리된 JS 객체를
 *       바로 넘기는 편이 더 단순합니다.)
 *   3. 서버가 실패를 돌려주면 화면에 에러를 보여주고, 성공하면
 *      submitOnboarding 내부의 redirect("/dashboard")가 알아서 이동시킵니다.
 *      (성공 시에는 이 함수가 값을 반환하지 않고 그대로 페이지가 이동합니다)
 *
 * 단일 선택 문항(영상 형태 / 목표 / 업로드 빈도)은 라디오 컴포넌트를 새로 설치하지 않고,
 * 기존 Button(variant="outline" ↔ "default")을 토글하는 방식으로 만듭니다.
 *
 * ⚠️ 이 프로젝트의 Button은 @base-ui/react 기반이라 asChild가 없습니다.
 *    여기서는 Link와 엮지 않고 순수 버튼(type="button")으로만 쓰므로 문제되지 않습니다.
 */

"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  CHANNEL_CATEGORIES,
  VIDEO_STYLES,
  VIDEO_STYLE_LABEL,
  PRIMARY_GOALS,
  PRIMARY_GOAL_LABEL,
  UPLOAD_FREQUENCIES,
  UPLOAD_FREQUENCY_LABEL,
  type ChannelCategory,
  type VideoStyle,
  type PrimaryGoal,
  type UploadFrequency,
} from "@/lib/types";
import {
  onboardingSchema,
  type OnboardingInput,
} from "@/lib/validations/onboarding";
import { submitOnboarding } from "@/lib/actions/onboarding";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

/** 폼이 화면에서 들고 있는 상태.
 *  아직 아무것도 고르지 않은 상태를 표현해야 해서 null을 허용합니다.
 *  (검증 스키마의 OnboardingInput은 null을 허용하지 않는 "완성된 값"이라 서로 다릅니다) */
type FormState = {
  categories: ChannelCategory[];
  videoStyle: VideoStyle | null;
  primaryGoal: PrimaryGoal | null;
  description: string;
  uploadFrequency: UploadFrequency | null;
};

const INITIAL_STATE: FormState = {
  categories: [],
  videoStyle: null,
  primaryGoal: null,
  description: "",
  uploadFrequency: null,
};

type FieldErrors = Partial<Record<keyof OnboardingInput, string>>;

export function OnboardingForm() {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<{
    code: string;
    message: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleCategory(category: ChannelCategory) {
    setForm((prev) => {
      const alreadySelected = prev.categories.includes(category);

      if (alreadySelected) {
        return {
          ...prev,
          categories: prev.categories.filter((c) => c !== category),
        };
      }

      // 이미 2개를 골랐다면 더 이상 추가하지 않습니다 (DB 제약과 동일한 규칙).
      if (prev.categories.length >= 2) {
        return prev;
      }

      return { ...prev, categories: [...prev.categories, category] };
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);

    const result = onboardingSchema.safeParse(form);

    if (!result.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof OnboardingInput | undefined;
        if (key && !fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({});

    // startTransition: 서버 응답을 기다리는 동안 isPending을 true로 유지해
    // 버튼을 잠그고 "저장 중..." 문구를 보여줍니다.
    startTransition(async () => {
      const response = await submitOnboarding(result.data);

      // 성공하면 submitOnboarding 안에서 redirect("/dashboard")가 실행되어
      // 이 코드로 돌아오지 않습니다. 여기 도달했다는 건 실패했다는 뜻입니다.
      if (response?.error) {
        setServerError(response.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {serverError && (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3"
        >
          <p className="text-sm font-medium text-destructive">
            저장에 실패했습니다.
          </p>
          <dl className="space-y-1 font-mono text-xs text-destructive/90">
            <div className="flex gap-2">
              <dt className="shrink-0">code</dt>
              <dd className="break-all">{serverError.code}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0">msg</dt>
              <dd className="break-all">{serverError.message}</dd>
            </div>
          </dl>
          <p className="text-xs leading-relaxed text-destructive/80">
            터미널(npm run dev 창)에 전체 내용이 출력되어 있습니다.
          </p>
        </div>
      )}

      {/* Q1. 채널 카테고리 (최대 2개) */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          1. 채널 카테고리를 선택해주세요 (최대 2개)
        </legend>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {CHANNEL_CATEGORIES.map((category) => {
            const checked = form.categories.includes(category);
            const disabled = !checked && form.categories.length >= 2;

            return (
              <label
                key={category}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                  checked && "border-primary bg-primary/5",
                  disabled && "cursor-not-allowed opacity-50"
                )}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => toggleCategory(category)}
                />
                {category}
              </label>
            );
          })}
        </div>

        {errors.categories && (
          <p className="text-xs text-destructive">{errors.categories}</p>
        )}
      </fieldset>

      {/* Q2. 영상 형태 */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          2. 주로 어떤 형태의 영상을 만드시나요?
        </legend>

        <div className="flex flex-wrap gap-2">
          {VIDEO_STYLES.map((style) => (
            <Button
              key={style}
              type="button"
              variant={form.videoStyle === style ? "default" : "outline"}
              onClick={() => setForm((prev) => ({ ...prev, videoStyle: style }))}
            >
              {VIDEO_STYLE_LABEL[style]}
            </Button>
          ))}
        </div>

        {errors.videoStyle && (
          <p className="text-xs text-destructive">{errors.videoStyle}</p>
        )}
      </fieldset>

      {/* Q3. 가장 중요한 목표 */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          3. 가장 중요한 목표는 무엇인가요?
        </legend>

        <div className="flex flex-wrap gap-2">
          {PRIMARY_GOALS.map((goal) => (
            <Button
              key={goal}
              type="button"
              variant={form.primaryGoal === goal ? "default" : "outline"}
              onClick={() => setForm((prev) => ({ ...prev, primaryGoal: goal }))}
            >
              {PRIMARY_GOAL_LABEL[goal]}
            </Button>
          ))}
        </div>

        {errors.primaryGoal && (
          <p className="text-xs text-destructive">{errors.primaryGoal}</p>
        )}
      </fieldset>

      {/* Q4. 채널 소개 */}
      <fieldset className="space-y-3">
        <Label htmlFor="onboarding-description">
          4. 채널을 간단히 소개해주세요
        </Label>
        <Textarea
          id="onboarding-description"
          rows={4}
          placeholder="예: 초보 개발자를 위한 코딩 강의를 올립니다. 실습 위주로, 매주 하나씩 프로젝트를 완성하는 과정을 보여줍니다."
          value={form.description}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, description: event.target.value }))
          }
        />
        <div className="flex items-center justify-between text-xs">
          <span className="text-destructive">{errors.description}</span>
          <span className="text-muted-foreground">
            {form.description.trim().length} / 500자
          </span>
        </div>
      </fieldset>

      {/* Q5. 목표 업로드 빈도 */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          5. 목표하는 업로드 빈도는요?
        </legend>

        <div className="flex flex-wrap gap-2">
          {UPLOAD_FREQUENCIES.map((freq) => (
            <Button
              key={freq}
              type="button"
              variant={form.uploadFrequency === freq ? "default" : "outline"}
              onClick={() =>
                setForm((prev) => ({ ...prev, uploadFrequency: freq }))
              }
            >
              {UPLOAD_FREQUENCY_LABEL[freq]}
            </Button>
          ))}
        </div>

        {errors.uploadFrequency && (
          <p className="text-xs text-destructive">{errors.uploadFrequency}</p>
        )}
      </fieldset>

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="animate-spin" />
            저장 중...
          </>
        ) : (
          "채널 설정 완료하기"
        )}
      </Button>
    </form>
  );
}
