/**
 * components/ui/progress.tsx
 *
 * 이 프로젝트에 아직 progress bar 컴포넌트가 없어 STEP 4-2에서 새로 추가합니다.
 * @base-ui/react에 Progress 프리미티브가 있는지 이 세션에서 확인할 방법이
 * 없어(패키지 버전을 직접 열어보지 못함), 다른 shadcn 컴포넌트와 같은
 * cva 스타일을 따르되 순수 div로 최소하게 구현했습니다. 나중에 실제
 * @base-ui/react Progress로 교체해도 이 파일을 쓰는 쪽(video-upload.tsx)의
 * props는 바뀌지 않습니다.
 */

import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
}: {
  /** 0~100 */
  value: number;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
