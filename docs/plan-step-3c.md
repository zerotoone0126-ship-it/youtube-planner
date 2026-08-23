# STEP 3-C 구현 계획 — 온보딩 실제 저장 연결

작성일: 2026-08-23
전제: `research-step-3c.md` 참고. **이 계획 문서 작성 시점에 STEP 3-C의 초안 구현이 이미 코드베이스에 존재합니다.** 아래 내용은 "처음부터 새로 설계"가 아니라, 그 기존 구현을 사용자가 제시한 체크리스트 기준으로 검증하고, 필요한 조정 사항을 승인받기 위한 계획입니다. 이번 응답에서 코드/SQL은 수정하지 않았습니다.

---

## A. 구현 후 전체 데이터 흐름

```
1. 사용자가 /onboarding에서 5문항 입력 (OnboardingForm, 클라이언트 state)
2. "채널 설정 완료하기" 클릭 → onSubmit → preventDefault
3. onboardingSchema.safeParse(form) — 클라이언트 1차 검증
   실패 시: 필드별 에러 메시지 표시, 여기서 중단 (서버 호출 없음)
4. 검증 통과 → startTransition(async () => { submitOnboarding(result.data) })
   - 버튼이 disabled 상태로 바뀌고 "저장 중..."으로 텍스트 변경
5. [서버] submitOnboarding(input) 실행
   5-1. createClient()로 요청 스코프 Supabase 서버 클라이언트 생성
   5-2. supabase.auth.getClaims() → userId 확인
        - 없으면 redirect("/login") (여기서 함수 종료)
   5-3. onboardingSchema.safeParse(input) — 서버 재검증
        - 실패 시 { error: { code: "invalid_input", message } } 반환
   5-4. channels에서 user_id로 기존 행 조회 (select id, maybeSingle)
        - 조회 자체가 실패하면 에러 반환
   5-5. 기존 행 있으면 update, 없으면 insert (channels)
        - 실패 시 에러 반환 (사용자에게 code/message 노출, 콘솔에 상세 로그)
   5-6. channels 저장 성공 확인 후에만 profiles.onboarding_completed = true 업데이트
        - .select().single()로 실제 반영 여부까지 확인
        - 실패 시 에러 반환
   5-7. 전부 성공 → redirect("/dashboard")
6. [클라이언트] 성공 시: 서버의 redirect가 그대로 네비게이션을 일으켜 /dashboard로 이동
   (submitOnboarding 호출부 코드로 돌아오지 않음)
   실패 시: response.error를 serverError state에 저장 → alert 박스 렌더링, 버튼 다시 활성화
7. /dashboard 진입 시 app/(app)/layout.tsx가 다시 onboarding_completed를 확인 —
   true이므로 통과, 대시보드 렌더링
```

이 흐름은 현재 `lib/actions/onboarding.ts` + `components/onboarding/onboarding-form.tsx`의 실제 코드와 일치합니다 (research 문서 1절 참고).

---

## B. 수정/추가 파일

기존 구현이 이미 아래 파일들로 구성되어 있습니다. "수정 이유"는 이미 반영된 이유를 설명하는 것이며, 별도 승인 없이는 추가로 손대지 않을 것을 원칙으로 합니다.

### B-1. `lib/validations/onboarding.ts` (기존, 변경 없음)
- 이유: 클라이언트/서버 공용 단일 검증 규칙. STEP 3-A 산출물 그대로.
- 재사용: `onboardingSchema`, `OnboardingInput` 타입을 서버 Action에서 그대로 import.

### B-2. `lib/actions/onboarding.ts` (신규 — 이미 존재)
- 이유: `channels`/`profiles` 쓰기를 담당하는 유일한 Server Action. `lib/actions/auth.ts`의 파일 분리 컨벤션을 그대로 따름.
- 추가된 로직: 인증 확인 → 서버 재검증 → 기존 채널 조회 → insert/update 분기 → 프로필 업데이트 → redirect.
- 재사용: `createClient()`(`lib/supabase/server.ts`), `ChannelInsert` 타입(`lib/types.ts`), `.select().single()` 에러 체크 패턴(STEP 2-D).

### B-3. `components/onboarding/onboarding-form.tsx` (기존 파일 수정 — 이미 반영됨)
- 이유: STEP 3-B의 "검증하기(임시)" 버튼을 실제 저장 버튼으로 교체.
- 추가된 로직: `useTransition` 기반 pending 처리, `submitOnboarding` 호출, `serverError` state와 에러 alert 박스.
- 재사용: 5문항 UI, `toggleCategory`, 필드별 에러 표시(`errors` state)는 STEP 3-B에서 그대로 가져옴 — 변경 없음.

### B-4. `app/onboarding/page.tsx` (기존 파일 수정 — 이미 반영됨)
- 이유: 임시 `completeOnboarding()` inline Server Action과 임시 버튼 제거, `<OnboardingForm />`으로 교체.
- 게이트 로직(로그인/온보딩 완료 확인)은 변경하지 않음.

### B-5. (검토만 하고 이번엔 만들지 않는 것) 새 마이그레이션 파일
- `channels.user_id`에 unique 제약을 추가하는 안은 **F, D절에서 별도로 다룸.** 사용자 승인 전에는 만들지 않음.

---

## C. Server Action 설계 (현재 구현 기준 정리)

- **입력값**: `unknown` 타입으로 받음 (타입 단언 없이 `safeParse`로 좁힘 — `any` 미사용).
- **Zod validation**: `onboardingSchema.safeParse(input)`. 실패 시 `{ error: { code: "invalid_input", message } }` 반환하고 즉시 종료.
- **인증 확인**: `supabase.auth.getClaims()` → `claims?.claims.sub`. 없으면 `redirect("/login")`.
- **DB 저장(channels)**: `user_id` 기준 조회 후 insert 또는 update. payload 타입은 `ChannelInsert`.
- **profile 업데이트**: `channels` 저장 성공 확인 후 `profiles.onboarding_completed = true`, `.select("id, onboarding_completed").single()`로 실제 반영 확인.
- **에러 반환**: 모든 실패 지점에서 `{ error: { code, message } }` 형태로 통일 (STEP 2-D의 `PostgrestError` 필드명 규칙과 호환). 콘솔에는 `details`/`hint`까지 포함한 전체 로그.
- **redirect**: 성공 시에만 `redirect("/dashboard")`. `try/catch`로 감싸지 않음 (redirect의 내부 동작과 충돌 방지 — 기존 `signOut()` 패턴과 동일).

이 설계는 사용자가 제시한 흐름과 요구사항을 모두 충족하며, 추가 변경이 필요하다고 판단하지 않습니다.

---

## D. 중복 제출 방지 전략

현재 DB 구조(‑ `channels.user_id`에 unique 제약 없음, research 2-2절) 기준으로 두 단계로 나눠 제안합니다.

1. **이미 적용된 최소 방어 (그대로 유지 권장)**
   - 제출 버튼 `disabled={isPending}` — 같은 화면에서의 연타를 원천 차단.
   - 저장 전 "기존 채널 조회 → 있으면 update" — 순차적 재시도 시 중복 방지.
   - 결론: **단일 사용자, 단일 탭 기준의 통상적인 MVP 사용 패턴에서는 이 정도로 충분하다고 판단합니다.**

2. **선택적 강화 (승인 필요 — 스키마 변경 수반)**
   - `alter table channels add constraint channels_user_id_key unique (user_id);` 추가
   - Server Action에서 `insert(...).select().single()` 대신 `upsert(payload, { onConflict: "user_id" }).select().single()`로 교체
   - 장점: 두 탭 동시 제출 같은 극단적 동시성 상황까지 DB 레벨에서 완전히 차단
   - 단점: "한 사용자가 여러 채널을 가질 수 있다"는 현재 스키마의 설계 여지(주석에 명시됨)를 영구히 제거함 — 나중에 멀티채널 기능을 추가하려면 이 제약을 다시 풀어야 함
   - **무조건 upsert를 쓰지 않은 이유**: 현재 스키마가 의도적으로 "1인 다채널" 가능성을 열어두고 있고(0001 마이그레이션 주석), MVP 요구사항도 "사용자당 1개"이지 "DB가 강제해야 한다"까지는 명시되어 있지 않기 때문입니다. 이 트레이드오프는 제가 임의로 결정하지 않고 F절의 확인 필요 항목으로 남깁니다.

---

## E. 실패 처리 (부분 실패 시나리오)

시나리오: `channels` 저장 성공 → `profiles.onboarding_completed` 업데이트 실패.

- **데이터 상태**: `channels`에는 최신 값이 있지만 `profiles.onboarding_completed`는 여전히 `false`.
- **사용자 경험**: 화면에 에러 alert가 뜨고, 버튼이 다시 활성화됨. `(app)/layout.tsx`는 여전히 이 사용자를 `/onboarding`으로 보내므로 "붕 뜬" 상태(온보딩은 끝났는데 채널이 없는 등)가 발생하지 않음.
- **재시도 시**: `channels` 조회에서 기존 행을 찾아 update로 처리(insert 아님) → 같은 값으로 다시 저장되고, 이번엔 profiles 업데이트만 다시 시도됨. 결과적으로 최종 일관성이 확보됨.
- **트랜잭션/RPC 필요 여부**: **불필요하다고 판단합니다.** 실패 중간 상태가 관찰 가능한 버그로 이어지지 않고, 재시도로 자연 복구되기 때문입니다. RPC 도입은 이 시점에는 과도한 설계로 보며, 채택하지 않는 쪽을 추천합니다. (다른 의견이 있다면 F절에서 확인)

---

## F. 보안 검토

- **인증**: 모든 쓰기 작업 직전에 서버에서 `getClaims()`로 세션을 검증. 미인증 요청은 `/login`으로 종료됨. ✅ 문제 없음.
- **RLS**: `channels`(select/insert/update/delete), `profiles`(select/update) 정책이 이미 `(select auth.uid()) = user_id` 형태로 존재. 이번 기능에 필요한 정책은 전부 갖춰져 있음. ✅ 추가 정책 불필요.
- **클라이언트 입력 신뢰 여부**: 클라이언트가 보내는 값에는 `user_id`가 없고, 5개 입력 필드만 존재. 서버가 `onboardingSchema`로 다시 검증. ✅ 클라이언트 입력을 그대로 신뢰하는 지점 없음.
- **user_id 처리**: 오직 서버의 `getClaims().data.claims.sub`에서만 얻으며, DB 쓰기 시에도 이 값만 사용. ✅ 문제 없음.
- **남은 위험**: D절에서 다룬 동시 이중 제출 시 `channels` 행 중복 생성 가능성(보안 취약점은 아니고 데이터 정합성 문제) — 승인 필요 항목.

---

## G. UX

- **submit 중 disabled**: 이미 구현됨 (`disabled={isPending}`).
- **로딩 표시**: 버튼 텍스트가 "저장 중..."으로 바뀜. 별도 스피너는 없음 — 현재 프로젝트에 스피너 컴포넌트가 없고, MVP 단계에서 텍스트 변경만으로 충분하다고 판단. (확인 필요: 스피너 아이콘을 추가하고 싶다면 `lucide-react`가 이미 설치되어 있어 쉽게 추가 가능하지만, 새 컴포넌트 설치는 필요 없음)
- **validation error**: 필드 바로 아래 빨간 텍스트로 표시 (STEP 3-B와 동일한 스타일 유지).
- **server error**: 카드 상단에 destructive alert 박스로 code/message 표시 (STEP 2-D 스타일 재사용).

추가 변경 제안 없음.

---

## H. 테스트 계획

| # | 시나리오 | 확인 방법 | 기대 결과 |
|---|---|---|---|
| 1 | 정상 제출 | 5문항 모두 정상 입력 후 제출 | `/dashboard`로 이동, `channels`에 새 행 생성, `profiles.onboarding_completed = true` |
| 2 | 잘못된 데이터 강제 제출 | 브라우저 콘솔에서 `submitOnboarding({ categories: [] })`처럼 직접 호출 (또는 개발자 도구로 네트워크 요청 조작) | 서버가 `invalid_input` 에러 반환, DB 변경 없음 |
| 3 | 로그인하지 않은 상태 | 로그아웃 후 콘솔에서 `submitOnboarding(정상데이터)` 직접 호출 시도 (또는 세션 쿠키 삭제 후 재시도) | `/login`으로 redirect, DB 변경 없음 |
| 4 | 중복 제출 (순차) | 1차 제출 성공 후 Supabase에서 `profiles.onboarding_completed`를 다시 false로 돌리고 재제출 | `channels` 행 개수 그대로(1개), 값만 갱신 |
| 5 | 이미 onboarding 완료된 사용자 | 완료 상태로 `/onboarding` 접속 | 폼이 안 보이고 즉시 `/dashboard`로 redirect |
| 6 | DB 저장 실패 | Supabase에서 일시적으로 `channels` 테이블의 authenticated GRANT를 제거하거나, RLS 정책을 임시로 끄고 테스트(테스트 후 반드시 원복) | 화면에 에러 alert 표시, 콘솔에 상세 로그, 페이지 이동 없음 |
| 7 | 새로고침 | 폼 입력 중 새로고침 | 입력값 초기화됨 (의도된 동작 — 별도 임시저장 기능 없음, 확인 필요 항목 아님, 명시적 비범위) |
| 8 | 저장 성공 후 `/dashboard` 이동 | 시나리오 1과 동일 관찰 | 별도 클릭 없이 자동 navigate 확인 (Server Action 직접 호출 + redirect 조합이 이 프로젝트에서 처음 쓰이므로 반드시 실제 브라우저에서 확인) |
| 9 (추가 제안) | 동시 이중 제출 | 개발자 도구 Network 탭 쓰로틀링 후 버튼을 빠르게 두 번 클릭 시도 (disabled 처리로 실제로는 막힐 가능성이 높음 — "막히는지"를 확인하는 것이 테스트 목적) | 요청이 1번만 나가는지, 또는 2번 나가도 `channels` 행이 1개만 남는지 확인 |

---

## I. 최종 검증 명령

`package.json` 확인 결과 스크립트: `dev`, `build`, `start`, `lint`, `types`. `test` 스크립트는 없음(별도 테스트 러너 미설치 상태 — 확인 필요: 이후 스텝에서 테스트 러너 도입 여부는 별도 논의).

```powershell
npx.cmd tsc --noEmit
npm.cmd run lint
npm.cmd run build
```

- `tsc --noEmit`: 타입 오류 확인 (channels insert/update 분기의 유니온 타입, `ChannelInsert` 할당 등)
- `lint`: ESLint 규칙 위반(미사용 import 등) 확인
- `build`: Next.js가 라우트/Server Action을 실제로 번들링하는 과정에서 `tsc`가 못 잡는 문제(예: 서버 전용 모듈이 클라이언트 번들에 섞이는 문제)까지 확인 가능하므로 포함을 권장

---

## 확인 필요 (임의로 결정하지 않은 항목)

1. **`channels.user_id` unique 제약 추가 여부** (D절) — 추가하면 동시 이중 제출을 DB 레벨에서 완전 차단하지만, "1인 다채널" 확장 가능성을 스키마에서 제거하게 됩니다.
2. **부분 실패에 RPC/트랜잭션 도입 여부** (E절) — 현재는 불필요하다고 판단했으나, 더 강한 원자성 보장을 원하시면 별도 Postgres 함수 작성이 필요합니다.
3. **저장 중 로딩 표시에 스피너 아이콘 추가 여부** (G절) — 현재는 텍스트 변경만 있습니다.
4. **시나리오 6, 9 테스트를 실제로 수행할지, 아니면 시나리오 1·4·5·8 위주로 검증하고 넘어갈지** — 6번은 RLS/GRANT를 임시로 건드려야 해서 운영 환경에서는 권장하지 않고 로컬에서만 해볼 만한 테스트입니다.

---

## 다음 단계

계획을 검토한 뒤 승인받기 전까지 구현하지 않겠습니다.
