/**
 * components/dev-login-form.tsx
 *
 * STEP 4-2 staging 검증 전용 이메일/비밀번호 로그인 폼.
 * login/page.tsx에서 NEXT_PUBLIC_ENABLE_DEV_LOGIN=true 일 때만 렌더링됩니다.
 * 프로덕션에서는 이 컴포넌트 자체가 화면에 나타나지 않습니다.
 */

"use client";

import { useState, useTransition } from "react";
import { devSignInWithPassword } from "@/lib/actions/dev-auth";
import { Button } from "@/components/ui/button";

export function DevLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await devSignInWithPassword({ email, password });
      // 성공하면 devSignInWithPassword 내부에서 redirect()가 실행되어
      // 여기까지 돌아오지 않습니다. 여기 도달했다는 것 자체가 실패라는 뜻입니다.
      if (result?.error) {
        setError(result.error.message);
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-2 rounded-md border border-dashed border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/20"
    >
      <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
        STEP 4-2 staging 검증 전용 로그인 (프로덕션에서는 보이지 않습니다)
      </p>

      <input
        type="email"
        placeholder="staging 테스트 이메일"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="username"
        required
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <input
        type="password"
        placeholder="비밀번호"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        required
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" variant="outline" className="w-full" disabled={isPending}>
        {isPending ? "로그인 중..." : "(dev) 이메일로 로그인"}
      </Button>
    </form>
  );
}
