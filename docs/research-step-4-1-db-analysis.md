# docs/research-step-4-1-db-analysis.md

STEP 4-1의 리서치 문서입니다. **조사만 진행했으며 코드/마이그레이션 변경은 없습니다.** 아래 내용은 모두 실제 코드베이스(`C:\Users\joonr\Desktop\youtube-planner`)를 직접 읽고 확인한 결과이며, 추측한 내용은 "추정" 또는 "미확인"으로 명시했습니다.

관련 문서: `results-step-4-0-feasibility-poc.md`(기술 검증 결과), `research-video-analysis-v1-feasibility.md` / `plan-v1-revised.md` / `plan-step-4-0-feasibility-poc.md`(이미 프로젝트에 존재하던 인프라 설계 문서 — 4장에서 설명).

---

## 1. 조사 범위와 방법

`supabase/migrations/*.sql` 4개, `lib/supabase/*.ts` 3개, `lib/actions/*.ts` 2개, `lib/types.ts`, `lib/database.types.ts`, `lib/validations/onboarding.ts`, `app/**` 전체(페이지·레이아웃·라우트 핸들러), `components/onboarding/onboarding-form.tsx`, `package.json`, `next.config.ts`, `AGENTS.md`, `tsconfig.json`, `supabase/.temp/linked-project.json`, 그리고 `docs/` 아래 기존 리서치·계획 문서(`research-video-analysis.md`, `research-video-analysis-v1-feasibility.md`, `plan-v1-revised.md`, `plan-step-4-0-feasibility-poc.md`)를 실제로 열어 전문을 확인했습니다. 코드베이스 전체 디렉터리 트리(`node_modules` 제외)도 재귀적으로 조회해 Storage 설정 파일(`supabase/config.toml`)이나 별도 Route Handler가 더 있는지 확인했습니다.

`service_role`/`SUPABASE_SERVICE_ROLE` 문자열과 `process.env.*` 참조는 `.ts`/`.tsx`/`.json`/`.sql` 전체에서 grep으로 직접 검색해 결과를 아래 3장에 그대로 반영했습니다(추측 아님).

`.env.local`은 존재 자체만 확인했고 **내용은 열지 않았습니다** — 코드에서 참조하는 환경변수 이름만으로 어떤 키가 쓰이는지 충분히 확인 가능했고, 시크릿 값을 다룰 이유가 없었기 때문입니다.

---

## 2. 현재 DB 구조

### 2-1. 테이블 6개 요약

| 테이블 | 역할 | user_id 소유 | 비고 |
|---|---|---|---|
| `profiles` | `auth.users`와 1:1, 온보딩 완료 여부 | PK 자체가 `auth.users.id` | insert/update만 허용, delete 정책 없음(계정 삭제로만 사라짐) |
| `channels` | 온보딩 5문항 + AI 채널 전략 | FK `user_id` | MVP는 사용자당 1개, 구조는 다건 허용 |
| `video_ideas` | AI가 생성한 아이디어 풀 | FK `user_id` + `channel_id` | append-only 성격, `updated_at` 없음 |
| `content_projects` | 서비스 중심 엔티티(영상 1개=1행) | FK `user_id` + `channel_id` | `idea_id`는 `on delete set null`로 유일하게 cascade가 아님 |
| `checklist_items` | 촬영/편집 체크리스트 | FK `user_id` + `project_id` | |
| `ai_generations` | AI 호출 기록(과금 분석용) | FK `user_id` | 로그 성격, update/delete 정책 자체가 없음 |

`video_analyses`가 다루려는 "영상 분석"은 이 6개 중 어느 것과도 겹치지 않는 새 엔티티입니다. 다만 `channels`(선택적 연결 대상), `profiles`/`auth.users`(소유자) 두 곳과는 직접 연결됩니다.

### 2-2. 확인된 컨벤션 (4개 마이그레이션 파일 원문 기준)

- **PK**: 독립 테이블은 전부 `uuid primary key default gen_random_uuid()`. 유일한 예외는 `profiles.id` — default 없이 `auth.users.id`를 그대로 씀.
- **FK**: 사용자 소유 행은 전부 `references auth.users(id) on delete cascade`. 자식-of-자식 테이블(`checklist_items.project_id`)은 가장 가까운 부모를 통해 cascade. 유일한 예외가 `content_projects.idea_id → video_ideas(id) on delete set null` — "아이디어가 지워져도 프로젝트는 살아남아야 한다"는 명시적 이유가 주석으로 남아있음.
- **타임스탬프**: `timestamptz not null default now()`만 사용. `updated_at`은 6개 중 4개에만 있고, 없는 2개(`video_ideas`, `ai_generations`)는 "수정하지 않는 데이터"라는 이유가 주석에 명시됨.
- **enum**: **네이티브 Postgres enum을 전혀 쓰지 않음.** 제약이 필요한 모든 문자열 컬럼은 `text` + `check (... in (...))`. 예: `channels_video_style_check`, `content_projects_status_check`.
- **jsonb**: `json`은 전혀 안 쓰고 `jsonb`만 사용. 리스트형은 `'[]'::jsonb` 기본값, 단일 객체형("아직 생성 안 됨"을 표현)은 nullable + 기본값 없음.
- **인덱스**: `(user_id, 정렬/필터 컬럼)` 복합 인덱스를 선호하고 `user_id` 단독 인덱스는 따로 안 만듦(왼쪽부터 쓰인다는 이유가 주석에 명시). nullable 컬럼에는 partial index(`where scheduled_date is not null`)를 씀. `content_projects_idea_id_key`처럼 partial unique index로 "선택적 1:1"도 구현함.
- **RLS**: 모든 정책이 예외 없이 `(select auth.uid()) = user_id`(또는 `profiles`는 `= id`) 형태, `to authenticated`로 스코프. **의도적으로 정책을 빼는 경우가 있음** — `profiles`는 delete 정책 없음(계정 삭제는 `auth.users` 삭제 cascade로만), `ai_generations`는 update/delete 정책 없음("변조되지 않는 기록이어야 비용 분석에 쓸 수 있다"는 이유가 주석에 명시).
- **Grants(`0004_grants.sql`)**: 전 테이블에 `revoke all` 후 필요한 권한만 좁게 `grant`. `profiles`는 `select, update`만(insert 없음 — 트리거가 대신 만듦). `ai_generations`는 `select, insert`만(update/delete 없음, RLS와 이중 방어). `anon`은 어떤 테이블에도 권한 없음.
- **트리거**: `public.handle_new_user()`(`auth.users` insert 시 `profiles` 자동 생성, `security definer` + `set search_path = ''`)와 `public.set_updated_at()`(범용 `updated_at` 갱신 트리거, `updated_at` 있는 4개 테이블에 개별 부착)이 이미 존재. **새 테이블에 `updated_at`이 필요하면 이 기존 함수를 재사용하면 되고, 새로 만들 필요가 없습니다.**
- **마이그레이션 스타일**: 순차 CLI 마이그레이션 체인이 아니라 **몇 번을 다시 실행해도 안전한 SQL Editor 스크립트**로 작성됨(`create table if not exists`, `drop policy if exists` 후 재생성, `on conflict do nothing`). 파일명은 `NNNN_설명.sql` 4자리 순번.

### 2-3. `lib/database.types.ts`와의 교차 확인

`npm run types`(`supabase gen types typescript`)로 자동 생성된 이 파일을 실제로 읽어 위 6개 테이블 정의와 대조했고, 마이그레이션 파일에서 읽은 스키마와 **완전히 일치**함을 확인했습니다(컬럼명, nullable 여부, FK 관계 전부). 즉 마이그레이션 파일이 실제 배포된 DB 상태를 정확히 반영하고 있다고 신뢰할 수 있습니다.

---

## 3. Auth 구조

- **3개의 Supabase 클라이언트 생성 지점**이 존재하고 역할이 분리되어 있습니다.
  - `lib/supabase/client.ts` — `createBrowserClient`(클라이언트 컴포넌트용)
  - `lib/supabase/server.ts` — `createServerClient`(서버 컴포넌트/Server Action용, 요청마다 새로 생성해야 함)
  - `lib/supabase/proxy.ts`의 `updateSession()` — 세 번째 `createServerClient` 인스턴스, `proxy.ts`(Next.js 16의 middleware) 안에서 세션 쿠키를 매 요청 갱신하는 용도
  - 셋 다 `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`만 사용합니다. **`service_role` 키 사용처는 코드 전체(`.ts`/`.tsx`/`.json`/`.sql`, `node_modules` 제외)에서 grep으로 확인한 결과 단 한 곳도 없습니다.** `process.env.*` 참조 전체를 grep해도 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NODE_ENV` 세 가지뿐입니다.
  - **이것이 의미하는 바**: STEP 4-1 이후 Cloud Run 워커가 필요로 할 `service_role` 키 사용은 이 프로젝트에서 **처음 도입되는 패턴**입니다. 참고할 기존 코드가 없으므로, 새 서버 전용 클라이언트 파일(예: `lib/supabase/admin.ts`)과 새 환경변수(예: `SUPABASE_SERVICE_ROLE_KEY` — **`NEXT_PUBLIC_` 접두사를 붙이면 절대 안 됨**, 브라우저 번들에 노출되기 때문)를 새로 설계해야 합니다. STEP 4-1의 plan 문서에 이 신규 패턴에 대한 명시적 원칙을 남겨야 합니다.
- **인증 확인 방식**: `supabase.auth.getClaims()`를 일관되게 사용하고 `getSession()`은 어디서도 쓰지 않습니다. `getClaims()`는 JWT를 암호학적으로 검증하고, `getSession()`은 쿠키 값을 그대로 신뢰합니다 — 이 프로젝트의 명확한 보안 컨벤션이며, 새로 만드는 인증 체크도 반드시 `getClaims()`를 따라야 합니다.
- **로그인 게이트가 3단계로 분산되어 있습니다**:
  1. `proxy.ts`(루트) + `lib/supabase/proxy.ts`의 `updateSession()` — 정적 파일을 제외한 모든 요청에서 세션 쿠키를 갱신만 함. **DB 조회는 하지 않음**(주석에 명시: "매 요청마다 도는 코드라 DB 왕복을 넣으면 앱 전체가 느려진다").
  2. `app/(app)/layout.tsx` — `(app)` 그룹(로그인 전용 영역)에 실제로 들어올 때만 `getClaims()` + `profiles.onboarding_completed` DB 조회. 미인증이면 `/login`, 온보딩 미완료면 `/onboarding`으로 리다이렉트. 프로필 조회 자체가 실패(null)해도 안전 쪽으로(온보딩 화면) 보냄.
  3. `app/onboarding/page.tsx` — 자체적으로도 동일한 인증/온보딩 체크를 반복(무한 리다이렉트 방지를 위해 `(app)` 그룹 밖에 위치하기 때문).
  - **미인증 사용자 접근 처리**: 위 계층 전체에서 예외 없이 `redirect("/login")` 패턴이며, `redirect()` 호출은 항상 try/catch 바깥에 있음(Next.js의 `redirect()`는 내부적으로 throw하므로 catch에 걸리면 안 됨 — Server Action 컨벤션에서도 동일하게 반복됨).
- **Route Handler**: `app/auth/callback/route.ts` **단 하나**가 이 코드베이스의 유일한 Route Handler 사례입니다(디렉터리 전체 재귀 조회로 확인). OAuth 콜백 전용이며, 다음 패턴을 보여줍니다: open-redirect 방지(`next` 파라미터가 `/`로 시작하고 `//`로 시작하지 않는지 검증), `x-forwarded-host` 기반 `baseUrl` 계산(Vercel의 CDN 뒤 배포 대응), 에러 케이스별 `?error=` 코드 분기. **이 패턴은 STEP 4-1 이후 Cloud Tasks가 호출할 콜백 엔드포인트를 설계할 때 그대로 참고할 유일한 선례이지만, 결정적인 차이가 있습니다**: 이 콜백은 브라우저(사용자)가 호출하므로 쿠키 기반 사용자 세션이 있지만, Cloud Tasks가 호출하는 엔드포인트는 사용자 세션이 전혀 없는 서버-to-서버 호출입니다. 즉 **인증 방식 자체를 이 선례에서 그대로 가져올 수 없고, OIDC 토큰 검증(Cloud Tasks가 서비스 계정으로 서명한 토큰) 또는 별도 공유 시크릿 검증을 새로 설계해야 합니다.** 이 설계는 STEP 4-1(DB) 범위가 아니라 이후 Cloud Run/Cloud Tasks 구현 STEP의 몫이지만, DB 스키마가 "누가 이 행을 쓸 수 있는가"를 결정하는 데는 지금 영향을 줍니다(5장 참고).

---

## 4. Storage 현황

**현재 이 프로젝트에는 Storage 관련 코드/설정이 전혀 없습니다.** 확인한 근거:
- `supabase/config.toml` 자체가 존재하지 않음(디렉터리 재귀 조회로 확인 — 버킷 설정 파일이 아예 없다는 뜻).
- 코드베이스 전체에서 `supabase.storage`, `.from(...).upload`, signed URL 발급 등 Storage 관련 호출이 단 한 곳도 없음.
- `storage.objects`에 대한 RLS 정책도 마이그레이션 어디에도 없음(4개 마이그레이션은 전부 `public` 스키마 테이블만 다룸).

즉 이 부분은 "기존 코드를 수정"하는 것이 아니라 **완전히 새로 만드는 것**입니다 — 참고할 기존 패턴이 없으므로 STEP 4-1 plan 문서는 이미 이 프로젝트의 다른 리서치 문서(`research-video-analysis-v1-feasibility.md` 9장, `plan-v1-revised.md` 8장)에 문서화된 설계를 코드/DB 관점에서 이어받아야 합니다(4장 참고).

---

## 5. 기존 앱 패턴

### 5-1. Server Action 컨벤션 (`lib/actions/onboarding.ts`, `lib/actions/auth.ts`)

- 파일 최상단 `"use server"`.
- 클라이언트에서 Zod로 이미 검증한 값도 **서버에서 동일한 Zod 스키마로 다시 검증**(코멘트: "클라이언트 검증은 사용자 편의, 서버 검증은 진짜 방어선").
- **멱등한 upsert-by-lookup 패턴**: `user_id`로 기존 행을 먼저 조회 → 있으면 update, 없으면 insert. 재시도(중복 클릭, 네트워크 재전송)로 같은 작업이 두 번 실행돼도 중복 행이 생기지 않음. **이 패턴은 STEP 4-1의 idempotent 생성 요구사항(요청 5)과 구조적으로 거의 동일하며, 그대로 참고/확장할 수 있습니다.**
- **쓰기 직후 `.select(...).single()`을 강제**해서, RLS에 막혀 조용히 0행이 업데이트된 상황을 "성공"으로 오인하지 않고 명시적 에러로 잡아냄.
- `redirect(...)` 호출은 항상 try/catch **바깥**에 있음(3장 참고).
- Supabase의 `{ data, error }` 반환값 기반 실패와, 예외로 던져지는 실패(네트워크 오류 등)를 try/catch로 따로 처리.
- 부수효과 순서를 엄격히 지킴 — 예를 들어 "완료" 플래그를 세우기 전에 실제 데이터부터 씀.

### 5-2. Route Handler 패턴

3장에서 다룬 `app/auth/callback/route.ts`가 유일한 사례입니다.

### 5-3. TypeScript 타입 관리

- `lib/database.types.ts`는 `supabase gen types typescript`로 자동 생성 — **손으로 절대 편집하지 않음**(`npm run types`로만 갱신).
- `lib/types.ts`는 그 위에 손으로 얹는 보조 레이어. `Omit<Row<T>, "느슨한 컬럼"> & { 정밀한 컬럼 }` 패턴으로 `Json`/`string` 타입을 정밀한 유니온으로 좁히고, UI 라벨 맵과 순수 파생값 함수(`projectProgress()` 등)를 함께 둠.
- **알려진 함정**: jsonb 컬럼에 대응하는 타입은 반드시 `type`으로 선언해야 하며 `interface`로 선언하면 Supabase의 `Json` 타입 대입이 "Index signature is missing" 에러로 실패함(문서에 명시된 주의사항).

---

## 6. 놀라운 발견 — 이미 존재하는 인프라 설계 문서

코드베이스를 조사하던 중, `docs/` 아래에 **이번 STEP 4-1 요청에서 언급된 미래 아키텍처(업로드 → DB → Cloud Tasks → 얇은 launcher → Cloud Run Job → DB)와 사실상 동일한 내용이 이미 문서로 존재**한다는 것을 확인했습니다. 추측이 아니라 실제로 열어 확인한 내용입니다.

- **`research-video-analysis-v1-feasibility.md` 6장**: "DB webhook → Cloud Run 직접 실행 대신 Queue 기반 idempotent worker" — Cloud Tasks가 OIDC 토큰으로 Cloud Run을 호출하는 공식 패턴, "2xx만 성공, 나머지는 재시도"라는 at-least-once 배달 특성, 그래서 idempotency가 선택이 아니라 필수라는 결론, `UPDATE ... WHERE id=$1 AND status='pending'` 형태의 compare-and-swap 예시, stale-lock 타임아웃 필요성, `video_id` 기준 upsert 결과 저장까지 이미 구체적으로 적혀 있습니다.
- **`research-video-analysis-v1-feasibility.md` 9장**: Storage 설계 — 비공개 버킷 + `auth.uid()` prefix 경로 강제 + `storage.foldername(name)` 기반 RLS, TUS 재개형 업로드(수백MB~수GB 대응), 백엔드는 `service_role` 또는 단기 signed URL, **삭제는 Supabase 내장 기능이 없으므로 `pg_cron` + Edge Function으로 직접 구현**해야 한다는 결론까지 이미 조사되어 있습니다.
- **`plan-step-4-0-feasibility-poc.md` 1장**: "인프라 설계 정정" — Cloud Tasks의 `dispatch_deadline`(최대 30분)이 Cloud Run Job의 전체 처리 시간보다 짧을 수 있다는 문제를 지적하고, **"Cloud Tasks → 얇은 launcher Cloud Run 서비스 → `jobs.run`(비동기 Long-Running Operation) → Cloud Run Job(독립 실행, 완료는 DB로 스스로 보고)"** 구조로 이미 정정되어 있습니다. 또한 **"파일 삭제는 `storage.objects` 테이블에 직접 DELETE 금지, 반드시 Storage API `remove()`를 써야 한다"**는 제약(이번 STEP 4-1 요청에서 사용자가 다시 강조한 바로 그 제약)이 이미 이 문서에 근거와 함께 명시되어 있습니다.
- **`plan-v1-revised.md` 6장**: 이번 STEP 4-1 요청에 첨부된 예시 `video_analyses` 스키마(id/user_id/channel_id/genre/storage_path/status/current_stage/progress/duration_sec/file_size_bytes/raw_metrics/report/error_code/error_message/pipeline_version/created_at/started_at/completed_at)는 **바로 이 문서의 6장과 문자 그대로 일치**합니다. 즉 사용자가 예시로 제시한 스키마는 이미 이 프로젝트 안에 초안으로 존재하던 것입니다.

**이것이 STEP 4-1 설계에 갖는 의미**: 이번 plan 문서는 "완전히 새로 설계"하는 것이 아니라, **이미 프로젝트에 기록된 아키텍처 결정과의 정합성을 유지하면서, 실제 DB 코드(2장의 컨벤션)와 STEP 4-0 검증 결과(7장)를 반영해 다듬는 작업**입니다. 기존 문서의 결론(예: Cloud Tasks+launcher+Job 구조, service_role 기반 워커 읽기, pg_cron+Edge Function 삭제)을 뒤집을 이유가 조사 중 발견되지 않았으므로, plan 문서는 이를 그대로 전제로 삼고 그 위에서 DB 스키마·RLS·idempotency를 구체화합니다. 다만 이 문서들은 **아직 구현되지 않은 계획**이라는 점은 명확히 구분해서 다룹니다(실제 코드는 여전히 3개 Supabase 클라이언트 + 6개 테이블뿐).

---

## 7. STEP 4-0 결과가 스키마 설계에 미치는 영향

STEP 4-0 최종 판정(`results-step-4-0-feasibility-poc.md`)을 요약하면:

| 판정 | 항목 |
|---|---|
| 제외 후보 | 현재 threshold/detector 휴리스틱 그대로의 visual-change 검출(pooled F1=0.412), `legacy_whole_frame_lowmotion_baseline`, `tile_max_diff`/`tile_topk_mean` |
| 조건부 개선 후보 | MAFD/scene-change raw signal 자체의 기술적 가능성 |
| 소표본 채택 후보(방향성) | `calibrated_whole_frame_diff_signal`, `optical_flow_mag`, `ssim_change` |
| 환경 제약으로 미검증 | 한국어 STT, 한국어 OCR |

**이 결과가 뜻하는 것은 명확합니다: 어떤 분석 기술도 "이걸로 확정"이라고 부를 수 있는 단계가 아닙니다.** 따라서 DB 스키마는:
- `raw_metrics`/`report`를 특정 신호 이름(예: `whole_frame_diff` 컬럼)으로 고정하는 대신 **버저닝 가능한 jsonb 구조**로 설계해야 합니다(8장에서 구체적 형태 제안).
- `current_stage`처럼 파이프라인 내부 기술 명칭을 담는 컬럼은, `status`처럼 안정적인 상태 값과 달리 **CHECK 제약으로 값 목록을 DB에 고정하지 않는 편이 낫습니다** — 검증 중인 기술의 이름이 바뀔 때마다 마이그레이션이 필요해지는 결합을 피하기 위함입니다. 이는 2장에서 확인한 "제약값은 항상 CHECK" 컨벤션에서 의도적으로 벗어나는 지점이며, plan 문서에서 그 이유를 명시합니다.
- STT/OCR이 "환경 제약으로 미검증"인 채로 V1을 시작할 수도 있다는 전제를 스키마가 막지 않아야 합니다 — 즉 `report`의 특정 필드(자막 관련 등)가 항상 채워진다고 가정하는 NOT NULL 제약을 걸면 안 됩니다.

---

## 8. 발견된 제약/리스크 목록 (Plan 설계에 직접 영향)

1. **`service_role` 사용 전례가 전혀 없음** — STEP 4-1 이후 처음 도입되는 패턴이므로, plan 문서에 새 클라이언트 파일/환경변수 명명 규칙을 명시해야 함(3장).
2. **Storage 관련 코드/설정이 0에서 시작** — 버킷 생성, RLS, 경로 정책 전부 신규 설계(4장).
3. **Route Handler 사례가 1개뿐이고, 그 사례의 인증 방식(사용자 쿠키 세션)은 Cloud Tasks 콜백에 그대로 못 씀** — DB 설계가 "이 행을 누가 쓸 수 있는가"를 얼마나 서버 신뢰 경계에 의존할지 결정해야 함(3장, plan 문서 5-6장에서 RLS/RPC 설계로 구체화).
4. **`video_analyses`는 기존 6개 테이블과 성격이 다름** — 나머지 테이블은 전부 "사용자가 직접 CRUD하는 데이터"이지만, `video_analyses`는 "사용자가 만들지만 결과는 신뢰할 수 있는 백엔드만 쓸 수 있어야 하는 데이터"입니다. 기존의 "소유자면 select/insert/update/delete 다 허용" RLS 패턴을 그대로 복사하면 사용자가 PostgREST를 직접 호출해 `status='completed'`나 `report`를 위조할 수 있는 취약점이 생깁니다. plan 문서 6장에서 이 차이를 반영한 RLS/권한 설계를 제시합니다.
5. **기존 문서(6장)에 이미 architecture가 있지만 미구현** — plan 문서는 이를 뒤집지 않되, "계획 문서에 적혀 있다"와 "실제로 존재한다"를 구분해서 서술해야 합니다.

---

## 9. STEP 4-1 설계에 대한 영향 요약

이 조사 결과는 `docs/plan-step-4-1-db-migration.md`에서 다음과 같이 반영됩니다: 예시 스키마를 실제 컨벤션(2장) 기준으로 비평, `video_analyses`의 RLS를 기존 "소유자 전권한" 패턴에서 벗어나 신뢰 경계(4장 리스크 3, 4)를 반영한 형태로 재설계, idempotency를 기존 upsert-by-lookup 패턴(5-1)의 연장선에서 compare-and-swap으로 구체화, Storage/삭제 정책을 기존 리서치 문서(6장)의 결론을 그대로 이어받아 DB 스키마 관점에서 구체화, `raw_metrics`/`report`를 STEP 4-0 결과(7장)에 맞춰 버저닝 가능한 구조로 설계.
