# STEP 3-C 리서치 — 온보딩 실제 저장 연결

작성일: 2026-08-23
범위: 코드 조사만. 코드/SQL 변경 없음.

## 0. 중요 — 현재 저장소의 실제 상태

이 리서치를 시작하기 전에, 로컬 프로젝트 파일을 직접 다시 읽어 확인한 결과를 먼저 밝힙니다.

**`lib/actions/onboarding.ts`와 그 파일을 사용하도록 수정된 `components/onboarding/onboarding-form.tsx`, `app/onboarding/page.tsx`가 이미 디스크에 존재합니다.** 파일 수정 시각(mtime)을 보면 바로 이전 대화 턴에서 만들어진 것과 일치합니다. 즉 "STEP 3-C 구현"이 요청하신 리서치보다 먼저 한 번 진행된 상태입니다.

이 문서와 `plan-step-3c.md`는 그 사실을 숨기지 않고, **이미 있는 구현을 코드베이스의 "현재 상태"로 간주해 조사·평가**하는 방식으로 작성했습니다. 즉 이번 리서치는 "무엇을 새로 만들어야 하는가"가 아니라 "이미 만들어진 것이 안전한 패턴인가, 위험 요소는 없는가"를 검증하는 성격입니다. 실제 파일 수정은 이번 응답에서 하지 않았습니다 (요청하신 대로 `.md` 두 개만 작성).

---

## 1. 현재 온보딩 구조

### 1-1. 파일 목록과 역할

| 파일 | 역할 |
|---|---|
| `app/onboarding/page.tsx` | 서버 컴포넌트. 로그인 확인 → 이미 온보딩 끝났으면 `/dashboard` → 그 외엔 `<OnboardingForm />` 렌더링 + 로그아웃 버튼 |
| `components/onboarding/onboarding-form.tsx` | 클라이언트 컴포넌트. 5문항 상태 관리, 클라이언트 Zod 검증, `submitOnboarding()` 호출, pending/에러 UI |
| `lib/validations/onboarding.ts` | STEP 3-A에서 만든 `onboardingSchema` (Zod) — 클라이언트/서버 공용 |
| `lib/actions/onboarding.ts` | Server Action `submitOnboarding()` — 서버 재검증 + `channels` upsert-like 저장 + `profiles.onboarding_completed` 업데이트 + `redirect("/dashboard")` |
| `lib/types.ts` | `CHANNEL_CATEGORIES`, `VIDEO_STYLES`, `PRIMARY_GOALS`, `UPLOAD_FREQUENCIES`, `ChannelInsert` 등 — 온보딩 스키마와 Server Action이 그대로 재사용 |

### 1-2. 로그인 → 온보딩 → 대시보드 흐름

- `proxy.ts` (루트) → `lib/supabase/proxy.ts`의 `updateSession()`: 모든 요청에서 세션 갱신 + "로그인 안 했으면 `/login`" 가드만 담당. **DB 조회는 하지 않음** (주석에 이유 명시: 모든 요청마다 실행되므로 느려짐).
- `app/(app)/layout.tsx`: `(app)` 라우트 그룹(현재 `dashboard`만 포함) 진입 시 재확인 — 로그인 안 했으면 `/login`, `profiles.onboarding_completed`가 falsy(또는 프로필 조회 자체가 실패)면 `/onboarding`.
- `app/onboarding/page.tsx`: `(app)` 그룹 **밖**에 위치. 이유는 파일 주석에 명시 — `(app)/layout.tsx`가 온보딩 미완료 시 `/onboarding`으로 보내는데, 이 페이지가 `(app)` 안에 있으면 무한 리다이렉트가 생김.
- `app/onboarding/page.tsx` 자체도 로그인 확인 + "이미 완료했으면 `/dashboard`"를 독립적으로 다시 함 (레이아웃과 별개의 경로이므로 중복 방어가 필요).

이 3중 구조(proxy → layout → onboarding page)는 STEP 2에서 이미 확립되어 검증된 패턴이며, 이번 조사에서 이 흐름에 손댈 이유를 찾지 못했습니다.

---

## 2. Supabase 구조 (실제 마이그레이션 파일 기준)

### 2-1. `profiles` 테이블 (`0001_init_tables.sql`)

```
id                    uuid primary key references auth.users(id) on delete cascade
email                 text
display_name          text
onboarding_completed  boolean not null default false
created_at            timestamptz not null default now()
updated_at            timestamptz not null default now()
```

- `onboarding_completed`는 `boolean not null default false` — nullable이 아니므로 "값이 없어서 falsy"가 아니라 항상 `true`/`false` 둘 중 하나입니다. (`app/(app)/layout.tsx`의 `!profile?.onboarding_completed` 체크는 "프로필 조회 자체가 실패해 `profile`이 `null`인 경우"까지 방어하려는 것이지, 컬럼 값 자체가 null일 가능성 때문이 아닙니다.)
- `id`가 곧 `auth.users.id`이자 로그인한 사용자의 id입니다. 별도의 "profile id"는 없습니다.
- 행 생성: 앱 코드가 아니라 `0003_triggers_indexes.sql`의 `handle_new_user()` 트리거(`security definer`)가 가입 시 자동 생성. `on conflict (id) do nothing`으로 중복 삽입에 안전.

### 2-2. `channels` 테이블 (`0001_init_tables.sql`)

```
id                uuid primary key default gen_random_uuid()
user_id           uuid not null references auth.users(id) on delete cascade
name              text                                    -- nullable (온보딩에서 안 물어봄)
categories        text[]  not null default '{}'           -- Q1
video_style       text    not null                        -- Q2
primary_goal      text    not null                        -- Q3
description       text    not null                        -- Q4
upload_frequency  text    not null                         -- Q5
strategy          jsonb                                   -- AI가 나중에 채움 (STEP 4+)
created_at / updated_at

check (video_style in ('shorts','long','both'))
check (primary_goal in ('views','subs','revenue','promo','brand'))
check (upload_frequency in ('w1','w2','w3','daily'))
check (cardinality(categories) between 1 and 2)
```

**중요**: `channels`에는 `user_id`에 대한 **unique 제약이 없습니다.** 코드 주석("MVP에서는 사용자당 1개만 만들지만, 구조는 여러 개를 허용합니다")과 실제 DB 스키마가 일치합니다 — 즉 DB 레벨에서는 "한 사용자당 채널 1개"를 강제하지 않고, **앱 레벨(Server Action)의 로직으로만** 그 규칙을 지키고 있습니다. 이는 STEP 3-C 위험 요소 판단에 직접 영향을 주는 사실입니다 (아래 8절 참고).

### 2-3. `profiles` ↔ `channels` 관계

- 외래키는 `channels.user_id → auth.users(id)`이지 `profiles.id`를 직접 참조하지 않습니다. 다만 `profiles.id`와 `auth.users.id`가 항상 같은 값이므로 실질적으로 `channels.user_id = profiles.id`로 취급해도 무방합니다 (이 프로젝트 전체에서 이미 이렇게 쓰고 있습니다 — `video_ideas`, `content_projects` 등 다른 테이블도 전부 동일 패턴).
- "profile id"와 "channel id"는 서로 다른 개념입니다: `profiles.id` = 로그인 사용자 id, `channels.id` = 채널 자체의 고유 id (사용자당 이론상 여러 개 가능한 구조). 온보딩 저장 시 사용해야 하는 키는 `user_id`이지 `channels.id`가 아닙니다.

### 2-4. RLS 정책 (`0002_rls_policies.sql`)

- 공통 조건: `(select auth.uid()) = user_id` (profiles는 `= id`)
- `profiles`: select/insert/update만 존재 (delete 없음 — cascade로 처리)
- `channels`: select/insert/update/delete 전부 존재
- 이미 `submitOnboarding()`이 필요로 하는 두 동작(`channels` insert 또는 update, `profiles` update)에 대한 정책이 **이미 전부 존재**합니다. 새 RLS 정책이 필요하지 않습니다.

### 2-5. GRANT (`0004_grants.sql`)

- `channels`: `select, insert, update, delete` → `authenticated`
- `profiles`: `select, update`만 (insert 없음 — profiles insert는 트리거가 `security definer`로 하므로 앱에는 권한을 주지 않음)
- 이 조합은 `submitOnboarding()`이 하는 일(채널 insert/update, 프로필 update)과 정확히 일치합니다. 추가 GRANT 불필요.

### 2-6. Supabase 클라이언트 생성 방식

- `lib/supabase/server.ts`의 `createClient()` — Server Component/Server Action 전용, `await cookies()` 기반, 요청마다 새로 생성(모듈 스코프에 캐시하지 않음 — 파일 주석에 이유 명시: 캐시하면 다른 사용자 세션이 섞임).
- `lib/supabase/client.ts` — 브라우저 전용, 현재 Google 로그인 버튼 한 곳에서만 사용.
- `lib/supabase/proxy.ts`의 `updateSession()` — proxy 전용, `request.cookies`/`NextResponse` 기반의 별도 쿠키 처리.
- `lib/actions/onboarding.ts`는 `lib/supabase/server.ts`의 `createClient()`를 그대로 재사용하고 있습니다 (다른 인증 사용자 조회 방식을 새로 만들지 않음).

---

## 3. 기존 프로젝트 패턴 (재사용 대상)

| 패턴 | 위치 | 내용 |
|---|---|---|
| Server Action 파일 구조 | `lib/actions/auth.ts` | 파일 최상단 `"use server"`, 그 파일의 모든 export가 Action. `lib/actions/onboarding.ts`도 동일 컨벤션 사용 |
| 인증된 사용자 조회 | `app/(app)/layout.tsx`, `app/onboarding/page.tsx`, `lib/supabase/proxy.ts` | `await supabase.auth.getClaims()` → `data?.claims.sub`. **`getSession()`은 어디서도 서버 신뢰 목적으로 쓰지 않음** (proxy.ts 주석: getSession은 쿠키를 그대로 믿어 위조 가능, getClaims는 서명 검증) |
| redirect 처리 | `lib/actions/auth.ts`, `app/(app)/layout.tsx` | `next/navigation`의 `redirect()`. "redirect는 내부적으로 에러를 던지므로 try/catch로 감싸면 안 됨"이 반복 명시된 규칙 |
| update 실패 감지 | STEP 2-D에서 확립 | `.update(...).eq(...).select(...).single()` 뒤 `error` **그리고** 반환된 행의 실제 값까지 확인. `.update()`만 쓰면 RLS가 막아도 error가 null인 PostgREST 특성 때문 |
| 에러 응답 형태 | `PostgrestError` 실측 확인 완료(이전 STEP) | `{ code, message, details, hint }` |
| 서버 검증 | 새로 만든 부분 (STEP 3-C) | 클라이언트와 동일한 `onboardingSchema.safeParse()`를 서버에서 재호출 — 스키마를 두 번 정의하지 않음 |
| pending 처리 | 새로 만든 부분 (STEP 3-C) | `useTransition` + `disabled={isPending}` — 이 프로젝트에서 폼 제출 pending 처리는 이번이 처음이라 참고할 기존 패턴은 없었음 (아래 계획 문서에서 이 부분을 별도로 검토) |
| Server Action 호출 방식 | 기존: `<form action={fn}>` (auth.ts, 구버전 onboarding) / 신규: 직접 함수 호출 (`lib/actions/onboarding.ts`) | 두 방식이 프로젝트 안에 공존하게 됨 — 이유는 이 폼의 입력이 FormData로 표현하기 어려운 다중/버튼형 선택이기 때문. **새로운 패턴이지만, 기존 "use server" 파일 컨벤션 자체는 재사용**하고 있어 완전히 이질적이지는 않음 |

**새로 만들어진 것 중 "기존에 이미 있던 걸 다시 만든 것"은 없습니다.** signOut과 별개의 도메인(onboarding)이라 파일을 분리한 것이 유일한 구조적 결정이고, 이는 `lib/actions/auth.ts` 하나만 존재하던 기존 상태에서 자연스러운 확장입니다.

---

## 4. 데이터 저장 흐름 검토

요청하신 기본 흐름:

```
OnboardingForm → 클라이언트 검증 → Server Action → 서버 재검증
→ 로그인 사용자 확인 → channels 저장 → profiles.onboarding_completed = true
→ /dashboard
```

**이 흐름은 현재 DB 구조와 정확히 맞습니다.** 근거:

- `channels`는 `user_id`만 있으면 저장 가능한 구조 (foreign key로 `channel_id`를 다른 테이블에서 먼저 요구하지 않음)
- `profiles.onboarding_completed`는 `channels`와 무관하게 독립적으로 업데이트 가능한 컬럼
- 두 테이블 다 RLS/GRANT가 이미 갖춰져 있어 추가 마이그레이션 없이 이 흐름을 구현할 수 있음

다만 한 가지, 순서가 중요합니다: **`channels` 저장 성공을 확인한 뒤에 `profiles.onboarding_completed`를 true로 바꿔야 합니다.** 반대 순서(프로필 먼저)로 하면, 채널 저장이 실패해도 사용자는 "온보딩 완료" 상태가 되어 `(app)/layout.tsx`를 통과하지만 정작 `channels` 데이터가 없는 상태가 됩니다. 이후 AI 기능(STEP 4)은 `channels`가 있다고 가정하고 동작할 것이므로, 이 순서는 단순 스타일 문제가 아니라 기능적으로 중요합니다.

**더 안전하거나 다른 방식이 필요한가?** — 조사 결과, 다음 두 가지가 이론적으로 더 강한 대안이지만 지금 단계에 필요하다고 보지 않습니다 (근거는 8절 "부분 실패" 항목 참고):

1. Postgres 함수(RPC)로 `channels` upsert + `profiles` update를 하나의 트랜잭션으로 묶기
2. `channels.user_id`에 `unique` 제약을 추가하고 Supabase의 `upsert(..., { onConflict: "user_id" })`를 사용

두 방법 모두 **스키마 변경(새 마이그레이션 파일)이 필요**하므로, 채택 여부는 리서치가 아니라 계획 문서에서 "확인 필요" 항목으로 넘깁니다.

---

## 5. 반드시 검토해야 할 문제 — 조사 결과

### 5-1. 인증

- 로그인하지 않은 사용자가 Server Action을 직접 호출할 수 있는가? → **가능은 하지만 무해합니다.** Server Action은 특정 URL로 노출된 엔드포인트라 이론적으로 아무나 POST를 보낼 수 있지만, 함수 내부에서 `await supabase.auth.getClaims()`로 **서버가 직접** 세션을 검증하고, 없으면 `redirect("/login")`으로 끝납니다. 클라이언트가 "나는 로그인했다"고 주장하는 값을 서버가 신뢰하는 구간이 없습니다.
- 클라이언트가 넘기는 값에 `user_id`가 포함되어 있는가? → **아니오.** `OnboardingForm`이 넘기는 `result.data`(=`OnboardingInput`)에는 `categories/videoStyle/primaryGoal/description/uploadFrequency`만 있고 사용자 식별 정보가 없습니다. `user_id`는 오직 서버에서 `getClaims()`로 얻은 값만 사용합니다. → **클라이언트 입력을 신뢰하지 않는 구조가 이미 맞습니다.**

### 5-2. 서버 검증

- 이미 `onboardingSchema.safeParse(input)`을 서버에서 다시 호출하고 있으며, **STEP 3-A와 동일한 스키마 파일을 import** — 규칙이 두 곳에서 어긋날 여지가 없습니다.

### 5-3. 중복 제출

- 현재 구현: `select ... where user_id = ? limit 1 maybeSingle()` → 있으면 update, 없으면 insert.
- 이 방식이 막는 것: **순차적인 재시도**(1차 시도 때 channels는 저장됐는데 profiles 업데이트가 실패해서 사용자가 다시 제출하는 경우) — 채널이 중복 생성되지 않고 기존 행이 갱신됩니다.
- 이 방식이 막지 못하는 것: **진짜 동시 요청 두 개**(예: 버튼을 빠르게 두 번 클릭해 서버에 요청이 겹쳐 도착하거나, 같은 계정을 두 탭에서 동시에 제출하는 경우) — 두 요청이 모두 "조회 시점엔 없음"을 보고 각각 insert를 실행하면 **DB에 채널이 2개 생성될 수 있습니다.** `channels.user_id`에 unique 제약이 없기 때문입니다 (2-2절 참고).
- 현재 완화책: 제출 버튼에 `disabled={isPending}`이 걸려 있어 **같은 화면에서 연타하는 흔한 경우는 이미 막혀 있습니다.** 다만 두 탭을 열어 각각 제출하는 경우까지는 막지 못합니다.

### 5-4. 부분 실패

- 시나리오: `channels` insert 성공 → `profiles.onboarding_completed` update 실패.
- 현재 결과: 사용자에게 에러가 표시되고, 콘솔에도 로그가 남습니다. DB에는 "채널은 있는데 온보딩은 미완료"인 상태가 남습니다.
- 이 상태가 문제인가? → **아니오, 오히려 안전한 쪽입니다.** `(app)/layout.tsx`는 `onboarding_completed`만 보고 `/onboarding`으로 보낼지 결정하므로, 이 상태의 사용자는 여전히 온보딩 화면으로 돌아옵니다. 그리고 재제출 시 5-3절의 "이미 있으면 update" 로직 덕분에 채널이 중복되지 않고 그대로 다시 시도됩니다. 즉 **회복 가능한 실패**입니다.
- 트랜잭션/RPC가 필요한 수준인가? → 조사 결과, 지금 단계에서는 **불필요하다고 판단됩니다.** 두 쓰기가 원자적이지 않아도 (a) 최종 일관성이 재시도로 자연스럽게 회복되고 (b) 실패 중간 상태가 다른 기능을 오작동시키지 않기 때문입니다. RPC 도입은 "과도한 설계"에 해당할 수 있어 계획 문서에서 채택하지 않는 쪽으로 제안하되, 최종 판단은 사용자 확인이 필요한 항목으로 남깁니다.

### 5-5. RLS

- `channels`, `profiles` 모두 이 흐름에 필요한 정책이 이미 존재 (2-4절). **추가 정책 불필요.**

### 5-6. 에러 처리

- 현재 `OnboardingForm`은 `serverError` state로 코드/메시지를 보여주는 alert 박스를 렌더링합니다 (STEP 2-D 때 만든 에러 표시 스타일 재사용). 사용자가 "아무 반응 없이 멈추는" 상태는 없습니다.

### 5-7. pending 상태

- `useTransition` + 버튼 `disabled`로 이미 처리되어 있어 연타로 인한 중복 요청 생성 가능성을 크게 줄여줍니다 (단, 5-3절에서 설명한 "완전한 방지"는 아님).

---

## 6. 기존 기능 보존 확인

아래 항목을 코드로 직접 대조한 결과, 모두 그대로 유지되어 있음을 확인했습니다.

- 로그인 안 한 사용자 → `/login`: `proxy.ts`/`lib/supabase/proxy.ts` 변경 없음
- 로그인 + 온보딩 미완료 → `/onboarding`: `app/(app)/layout.tsx` 변경 없음
- 온보딩 완료 → `/dashboard`: `app/onboarding/page.tsx` 상단의 `if (profile?.onboarding_completed) redirect("/dashboard")` 유지
- 5문항 UI, 카테고리 최대 2개 로직(`toggleCategory`): STEP 3-B와 동일한 로직, 제출 핸들러만 교체됨
- 기존 Zod validation: `onboardingSchema` 원본 그대로 재사용, 수정 없음
- 기존 페이지 스타일: `Card`/`CardHeader`/`CardContent` 구조 그대로
- 기존 인증 구조: `getClaims()` 패턴 그대로

불필요한 파일 수정이나 STEP 3-C와 무관한 리팩터링은 발견되지 않았습니다.

---

## 7. 재사용 가능한 코드 (요약)

- `onboardingSchema` (`lib/validations/onboarding.ts`) — 서버에서도 그대로 import
- `ChannelInsert` 타입 (`lib/types.ts`) — Server Action의 저장 payload 타입으로 그대로 사용 가능 (필드 구성이 정확히 일치)
- `createClient()` (`lib/supabase/server.ts`) — 다른 Server Action과 동일하게 사용
- `.select().single()` + 에러 체크 패턴 (STEP 2-D 유래) — profiles update뿐 아니라 channels insert/update에도 동일하게 적용 가능
- `"use server"` 파일 분리 컨벤션 (`lib/actions/*.ts`) — 새 도메인 Action 추가 시 그대로 따를 수 있음

---

## 8. 예상되는 문제점 (요약)

1. **동시 이중 제출 시 `channels` 중복 생성 가능** — DB에 `user_id` unique 제약이 없음. 버튼 `disabled` 처리로 흔한 경우는 막히지만, 두 탭/네트워크 재시도 같은 극단적 경우는 이론상 가능.
2. **두 단계 쓰기(channels → profiles)가 원자적이지 않음** — 다만 재시도 시 idempotent(멱등)하게 동작하도록 이미 설계되어 있어 실질적 위험은 낮음.
3. **Server Action을 `<form action>`이 아니라 직접 함수 호출로 쓰는 방식**이 이 프로젝트에 새로 도입됨 — 잘못된 패턴은 아니지만(Next.js 공식 지원 방식), 이 프로젝트에서는 첫 사례이므로 "성공 시 자동으로 `/dashboard`로 이동하는지"를 실제 브라우저에서 반드시 확인해야 함 (아직 실제 클릭 테스트로 재확인되지 않음 — 사용자의 최근 메시지가 3-B까지만 확인했다고 기술).

---

## 9. STEP 3-C 구현(재검토) 시 주의 사항

- `channels` insert/update 순서를 `profiles` 업데이트보다 반드시 먼저 유지할 것 (이미 그렇게 되어 있음 — 유지).
- `user_id`는 항상 서버의 `getClaims()` 결과에서만 가져올 것, 클라이언트 입력에 포함하지 말 것 (이미 그렇게 되어 있음 — 유지).
- `onboardingSchema`를 서버에서 다시 import해서 쓸 것, 별도 서버용 스키마를 새로 만들지 말 것 (이미 그렇게 되어 있음 — 유지).
- 중복 제출 방지를 DB 유니크 제약으로 강화할지 여부는 스키마 변경이 필요하므로 임의로 진행하지 말고 사용자 확인 필요.
- 부분 실패에 RPC/트랜잭션을 도입할지 여부도 사용자 확인 필요 (현재 결론: MVP 단계에서는 불필요해 보임).
