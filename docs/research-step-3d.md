# STEP 3-D 리서치 — STEP 3(온보딩) 전체 마무리 점검

작성일: 2026-08-23
범위: 새 기능 추가 없음. STEP 3-A~C로 완성된 온보딩 흐름 전체를 다시 훑어 위험 요소·정리할 점을 찾는 것이 목적. 코드 변경 없음.

## 0. 점검 범위로 확정된 것 (사용자 확인 완료)

이전 응답에서 STEP 3-D가 가리킬 수 있는 3가지(① 대시보드에 채널 데이터 반영 ② STEP 3 전체 마무리 점검 ③ 사실상 STEP 4로 진행) 중 **②를 선택하셨습니다.** 즉 이번 STEP은 새 화면·새 기능을 만들지 않고, 이미 완성된 3-A~C를 전체적으로 다시 훑는 회고/점검입니다.

---

## 1. 전체 흐름 재확인 (파일 단위로 다시 추적)

```
proxy.ts (루트) → lib/supabase/proxy.ts: updateSession()
  └ 로그인 안 됨 + 보호 경로 → /login
  └ 로그인 됨 + /login 접근 → /dashboard
       ↓
app/(app)/layout.tsx  (( app ) 그룹 진입 시)
  └ 로그인 안 됨 → /login (이중 방어)
  └ onboarding_completed 아님/조회 실패 → /onboarding
       ↓
app/onboarding/page.tsx  ((app) 그룹 밖)
  └ 로그인 안 됨 → /login
  └ 이미 완료 → /dashboard
  └ 그 외 → <OnboardingForm />
       ↓
components/onboarding/onboarding-form.tsx
  └ 클라이언트 상태 + onboardingSchema.safeParse (클라이언트 1차 검증)
  └ 통과 시 submitOnboarding(result.data) 호출 (useTransition)
       ↓
lib/actions/onboarding.ts: submitOnboarding()
  └ getClaims() 재확인 → 없으면 /login
  └ onboardingSchema.safeParse (서버 재검증)
  └ channels 기존 행 조회 → insert 또는 update
  └ channels 성공 확인 후 profiles.onboarding_completed = true
  └ 성공 → redirect("/dashboard")
  └ 실패 지점마다 { error: { code, message } } 반환
       ↓
app/(app)/dashboard/page.tsx
  └ 로그인/프로필 조회 (STEP 2-D 임시 화면, 이번 점검 범위 아님)
```

**결론**: 3-A~C 사이에 끊긴 연결, 중복 가드, 서로 모순되는 리다이렉트 조건은 발견되지 않았습니다. `/onboarding`이 `(app)` 그룹 밖에 있어야 하는 이유(무한 리다이렉트 방지)도 실제 코드와 주석이 일치합니다.

---

## 2. 지금까지 실행/검증된 것과 아직 안 된 것

| 검증 | 상태 |
|---|---|
| `npx.cmd tsc --noEmit` | ✅ 통과 확인됨 (STEP 3-C 승인 메시지에서) |
| 실제 브라우저 제출 → `/dashboard` 이동 | ✅ 확인됨 |
| `channels`/`profiles` 실데이터 확인 | ✅ 확인됨 |
| 재시도(같은 채널 update) | ✅ 확인됨 |
| `npm.cmd run lint` | ❌ 아직 한 번도 실행 안 함 (이 대화 전체에서 처음 나옴) |
| `npm.cmd run build` | ❌ 아직 한 번도 실행 안 함 |

`package.json`에 `lint`, `build` 스크립트가 이미 있는데도(리서치 3-C 문서에서도 확인했던 내용) 지금까지 `tsc`만 돌려봤습니다. `lint`는 미사용 import 같은 걸, `build`는 `tsc`가 못 잡는 문제(예: 서버 전용 코드가 클라이언트 번들에 섞이는 문제, Next.js 라우트 타입 검사)까지 잡아낼 수 있어 "마무리 점검" 단계에 자연스럽게 포함될 항목입니다.

---

## 3. 코드 재검토에서 발견한 것

### 3-1. (진짜 위험 요소) `submitOnboarding()`에 "예상치 못한 예외"에 대한 방어가 없음

`lib/actions/onboarding.ts`를 다시 읽어보면, 지금까지 처리한 실패는 전부 **Supabase가 `{ data, error }` 형태로 정상 반환한 경우**(RLS 차단, 제약조건 위반 등 — `error` 필드가 채워진 경우)입니다.

그런데 다음과 같은 경우는 `{ data, error }`가 아니라 **JS 예외(throw)**로 나타날 수 있습니다.

- 일시적인 네트워크 장애로 Supabase에 요청 자체가 도달하지 못한 경우
- Supabase 쪽 일시 장애(5xx)로 fetch가 중간에 실패하는 경우

지금 코드는 이런 경우를 잡는 `try/catch`가 전혀 없습니다. 이 예외는 `submitOnboarding()` 밖으로, 다시 `onboarding-form.tsx`의 `startTransition(async () => { ... })` 안으로 그대로 전파됩니다. 이 프로젝트 어디에도 `error.tsx`(Next.js 에러 바운더리)가 없다는 것도 함께 확인했습니다 (`app/` 디렉터리 전체를 다시 나열해 확인 — `layout.tsx`/`page.tsx`류만 있고 `error.tsx`는 없음).

결과적으로 이런 드문 상황에서는 "저장에 실패했습니다" 같은 안내 대신, 처리되지 않은 에러가 발생할 수 있습니다 (Next.js 기본 에러 처리로 넘어감 — 사용자에게는 불친절한 화면).

이건 온보딩만의 문제가 아니라 **프로젝트 전체에 아직 에러 바운더리가 없다는, 더 큰 범위의 사실**이기도 합니다. 이번 STEP 3-D에서 앱 전역 에러 바운더리까지 만드는 건 범위를 벗어난다고 판단했고(마무리 "점검"이지 새 인프라 추가가 아님), **온보딩 저장 함수 하나에 한정된 최소한의 안전망**만 계획 문서에서 제안합니다.

### 3-2. (사소함, 선택) 파일 상단 주석이 완료된 상태를 반영하지 못함

- `app/onboarding/page.tsx`의 파일 설명 첫 줄이 여전히 `"STEP 3-B — 실제 5문항 온보딩 폼(OnboardingForm)을 보여줍니다."`로 되어 있습니다. 실제로는 3-C까지 반영된 최종 상태입니다.
- `components/onboarding/onboarding-form.tsx`의 설명도 `"STEP 3-C부터: ..."`처럼 과정형으로 적혀 있습니다.

기능에는 전혀 영향 없는 주석 문구 차이입니다. 정상 동작 중인 코드에 순수 문구 수정을 위해 다시 손대는 게 오히려 불필요한 diff/재검증 부담을 만들 수 있어, 계획 문서에서는 "권장하지 않음(그대로 둠)"으로 결론 내렸습니다 — 다만 원하시면 쉽게 반영 가능한 항목이라 선택지로만 남겨둡니다.

### 3-3. 중복 제출 방지 — 재확인

STEP 3-C 승인 시 "unique 제약 추가하지 않음 / RPC 도입하지 않음"으로 이미 결정하셨습니다. 이번 재검토에서도 그 결정을 뒤집을 새로운 근거는 발견하지 못했습니다. 그대로 유지를 제안합니다.

### 3-4. 보안 — 재확인

- `user_id`는 여전히 서버의 `getClaims()`에서만 취득 (변경 없음)
- RLS/GRANT 파일들, 이번에도 다시 열어봤지만 온보딩 흐름에 필요한 정책은 이미 다 있고 손댈 곳 없음 (STEP 3-C 리서치와 동일 결론)

### 3-5. 기존 패턴 재사용 — 이번 점검에서 새로 정리된 것

STEP 3 전체를 거치며 이 프로젝트에 아래 두 가지 **재사용 가능한 패턴**이 새로 확립되었다는 걸 이번에 명확히 정리해둘 만합니다 (향후 STEP 4 이후 새 기능 만들 때 그대로 따라가면 됩니다):

1. **도메인별 3파일 세트**: `lib/validations/<도메인>.ts`(Zod 스키마) + `lib/actions/<도메인>.ts`(Server Action) + `components/<도메인>/<도메인>-form.tsx`(폼) — 온보딩에서 처음 만들어짐.
2. **Server Action을 `<form action>`이 아니라 직접 함수 호출로 쓰는 패턴** — 폼 상태가 단순 `<input name>`으로 표현하기 어려울 때 사용. `lib/actions/auth.ts`의 `<form action={signOut}>` 패턴과는 다른, 두 번째 유효한 패턴으로 이 프로젝트에 공존하게 됨.

---

## 4. 결론

- 새로 만들 화면/기능 없음 (사용자 확정).
- **위험 요소 1건**: `submitOnboarding()`에 예외 안전망 없음 → 계획 문서에서 최소 수정안 제안.
- **검증 공백 1건**: `lint`/`build` 미실행 → 계획 문서의 최종 검증 단계에 포함.
- **선택 사항 1건(비권장)**: 주석 문구 정리 — 하지 않는 쪽을 제안.
- 그 외(중복 제출 방지, 보안, RLS/GRANT, 기존 패턴 재사용)는 STEP 3-C 때 이미 검증된 결론이 그대로 유효함을 재확인했습니다.
