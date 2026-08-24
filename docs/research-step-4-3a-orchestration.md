# docs/research-step-4-3a-orchestration.md

STEP 4-3A 연구 문서. **코드 작성 없음** — 아래는 실제로 저장소/staging DB/Google Cloud
공식 문서를 조사한 결과만 담습니다. 확인 못 한 부분은 추측하지 않고 "미확인"으로 표시합니다.

## 1. 코드베이스 조사 결과

### 1-1. 기존 계층 구조 (재사용 대상)

| 계층 | 파일 | 패턴 |
|---|---|---|
| DB 접근(쓰기) | `lib/actions/*.ts` (`"use server"`) | Server Action, `.rpc()`만 사용(일반 insert/update RLS 정책이 없는 테이블), 실패는 `{error}` 값으로 반환, 진짜 예외만 try/catch |
| DB 접근(읽기) | Server Component | 예: `app/(app)/upload/page.tsx`가 로그인 사용자의 채널을 직접 조회 |
| Supabase 클라이언트 | `lib/supabase/server.ts`(서버, anon/publishable 키 + 사용자 쿠키 세션), `lib/supabase/client.ts`(브라우저) | **service_role 키를 쓰는 코드는 저장소 어디에도 아직 없음** — Next.js 쪽은 전부 사용자 세션 기반. STEP 4-3A에서 service_role을 쓰는 코드는 worker(Python)가 처음이 됨 |
| 세션/라우트 가드 | `lib/supabase/proxy.ts` (middleware) | DB 조회 없음 — 세션 갱신 + 로그인 라우트 가드만 |
| 업로드 로직 | `lib/upload/video-upload-engine.ts` (React 비의존 상태 머신) + `components/upload/video-upload.tsx` (UI) | 로직/UI 분리 원칙 — STEP 4-3A도 동일 원칙을 따라야 함(launcher/worker 로직과 Next.js UI는 원래도 다른 런타임이라 자연히 분리됨) |
| 환경변수 | `.env.local` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_ENABLE_DEV_LOGIN`(STEP 4-2 staging 전용) | `SUPABASE_SERVICE_ROLE_KEY`, GCP 관련 키는 아직 어디에도 없음 |
| PoC 코드 | `poc/step4-0/scripts/*.py` + `*.sh` | STEP 4-0에서 만든 순수 Python + FFmpeg CLI 스크립트 모음(컷 검출, 저모션 검출, 오디오 라우드니스, OCR/STT 벤치마크). **Supabase 연동 없음, Docker화 안 됨.** STEP 4-3B(실제 분석)에서 이 스크립트들의 로직을 worker 안으로 옮겨오는 것이 자연스러운 다음 단계 — STEP 4-3A dummy worker의 언어를 Python으로 정하는 근거이기도 함(1-3 참고). |

### 1-2. `.gitignore` / secret 상태

`.env*` 패턴(슬래시 없음 → 모든 하위 폴더에 재귀 적용)이 이미 있어, 나중에 `worker/.env` 같은 걸 만들어도 자동으로 커밋 제외됩니다. 추가 `.gitignore` 수정 불필요.

### 1-3. 기존 테스트 구조

`npm test`류 자동화 테스트 없음(package.json에 test 스크립트 없음). `poc/step4-0`에 스크립트 단위의 수동 벤치마크/ground-truth 채점 도구는 있지만 CI/유닛테스트 프레임워크는 아님. STEP 4-3A 이후에도 자동화 테스트 프레임워크가 없다는 전제로 로컬 검증 전략(plan G장)을 짜야 함.

### 1-4. 기존 docs의 STEP 4-3 관련 내용

`docs/plan-step-4-1-db-migration.md`에 STEP 4-3 방향을 미리 언급한 부분(5장 launcher CAS, 10장 report/error_message 정제 원칙, `execution_id`/`run_token` 설계 근거)이 있고, 0006/0009 마이그레이션 파일 주석에도 "launcher"라는 용어가 이미 등장합니다(`acquire_video_analysis_run`의 comment: "launcher는 반드시 jobs.run()을 호출하기 전에 이 함수를 호출해야 하고..."). 즉 **"launcher가 acquire 성공 후에만 Job을 시작한다"는 설계는 이미 STEP 4-1 시점에 DB 함수 주석으로 확정되어 있었고, 이번 STEP 4-3A는 그 설계를 실제로 구현하는 단계입니다.** `docs/plan-step-4-2-upload-vertical-slice.md`에는 STEP 4-3 관련 내용 없음(범위 밖).

## 2. 현재 DB/RPC 계약 (staging 실측)

`pg_proc`/`pg_get_functiondef`/`information_schema.role_routine_grants`로 staging(`btyihqzfgbjpzgxienkp`)에서 직접 조회한 결과입니다(추측 없음).

| 함수 | 인자 | 조건 | 결과 | EXECUTE 권한 |
|---|---|---|---|---|
| `create_video_analysis` | `p_genre text, p_channel_id uuid default null, p_client_request_id uuid default null` | `channel_id` 소유권 체크, `client_request_id` 원자적 멱등(`INSERT ... ON CONFLICT`) | 새 행 또는 기존 행 | `authenticated`, `service_role` |
| `mark_video_analysis_uploaded` | `p_id uuid` | 소유자 + `status='pending'` + `storage.objects`에 실제 오브젝트 존재 | `pending→uploaded`, `file_size_bytes` 채움 | `authenticated`, `service_role` |
| `cancel_video_analysis` | `p_id uuid` | 소유자 + `status in (pending,uploaded,queued)` | `→cancelled` | `authenticated`, `service_role` |
| **`queue_video_analysis`** | `p_id uuid` | 소유자 + `status='uploaded'` | `→queued`, `current_stage='queued'`, `progress=0`, `error_code/message=null` | `authenticated`, `service_role` (0010 — 3장 참고) |
| `acquire_video_analysis_run` | `p_id uuid` | `status='queued'` (소유자 체크 없음 — 신뢰된 서버 컨텍스트 전용) | `→processing`, `started_at=now()`, `run_token=gen_random_uuid()`, `attempt_count+=1` | **`service_role`만** |
| `update_video_analysis_progress` | `p_id uuid, p_run_token uuid, p_stage text, p_progress smallint` | `run_token` 일치 + `status='processing'` | `current_stage`, `progress` 갱신 | **`service_role`만** |
| `complete_video_analysis` | `p_id uuid, p_run_token uuid, p_report jsonb, p_raw_metrics jsonb default null, p_duration_sec numeric default null` | `run_token` 일치 + `status='processing'` | `→completed`, `progress=100`, `finished_at=now()`, `report` 저장 | **`service_role`만** |
| `fail_video_analysis` | `p_id uuid, p_run_token uuid, p_error_code text, p_error_message text default null` | `run_token` 일치 + `status='processing'` | `→failed`, `finished_at=now()`, `error_code/message` 저장 | **`service_role`만** |

모든 함수 `SECURITY DEFINER`, `SET search_path = ''`. 실패해도 예외를 던지지 않고 `null`(영향받은 행 0개)을 반환하는 것이 공통 패턴 — 호출자가 "내 CAS가 실패했다"를 null로 판단해야 함(예외 캐치가 아니라 반환값 체크).

`video_analyses` CHECK 제약 중 이번 STEP과 직접 관련된 것: `status in ('pending','uploaded','queued','processing','completed','failed','cancelled')`, `completed`면 `report is not null` 필수, `failed`면 `error_code is not null` 필수, `error_code in ('upload_failed','unsupported_format','processing_timeout','pipeline_error','internal_error')`.

`storage.buckets`: `videos` 버킷은 `public=false`(비공개), `allowed_mime_types=['video/mp4']`, 버킷 레벨 `file_size_limit`은 안 걸려 있고 프로젝트 전역 Free plan 상한(50MB)에 의존(STEP 4-1에서 확인). worker는 **service_role**로 이 비공개 버킷의 원본을 읽어야 함 — RLS 정책(`video_objects_select_own_while_pending` 등)은 authenticated 사용자용이고 service_role은 애초에 RLS를 우회하므로 무관.

## 3. Migration drift 확인 (실측, 확정)

**드리프트가 실제로 존재합니다.** 아래는 staging에서 직접 조회한 사실입니다.

- `supabase_migrations.schema_migrations`에 기록된 버전 10개, 마지막 행: `version=20260824124434, name=0010_queue_video_analysis`.
- 로컬 저장소의 `supabase/migrations/` 디렉터리 실제 목록(디바이스에서 직접 조회): `0001_init_tables.sql` ~ `0009_video_analyses_grants.sql` **까지만 존재, `0010` 파일 없음.**
- `queue_video_analysis` 함수는 staging DB에 실제로 존재하며(`pg_get_functiondef`로 원문 확인), 사용자가 설명한 동작(`uploaded`+소유자 확인 → `queued`/`current_stage='queued'`/`progress=0`/`error_code,error_message=null`)과 **정확히 일치**합니다. `authenticated`/`service_role`/`postgres`에 EXECUTE 부여, `anon`은 없음 — 나머지 함수들과 동일한 grant 관례를 따름.
- `lib/database.types.ts`(STEP 4-2에서 재생성한 파일)에도 `queue_video_analysis`가 **없습니다** — 이 타입 파일을 생성한 시점(STEP 4-2) 이후에 0010이 staging에 적용되었기 때문. 즉 드리프트는 마이그레이션 파일뿐 아니라 TypeScript 타입에도 존재.
- `lib/actions/video-analyses.ts`, `lib/types.ts`에도 `queue_video_analysis`/`queueVideoAnalysis`를 호출하는 코드가 전혀 없음 — 프론트엔드도 아직 이 함수를 모름.

**결론: DB(실제 동작) > 로컬 migration 파일 > 로컬 TypeScript 타입 > 프론트엔드 코드 순으로 정보가 최신입니다.** 재현(reconciliation) 방법은 plan 문서 J장에 정리합니다 — 이번 단계에서는 파일을 만들지 않습니다(지시 준수).

## 4. Cloud Tasks → Cloud Run Job 공식 동작 (2026년 기준, 공식 문서 조사)

하위 에이전트가 `docs.cloud.google.com`/`cloud.google.com` 공식 문서를 직접 조사한 결과입니다. 인용 URL 포함.

- **네이티브 트리거 없음(확정)**: Cloud Tasks는 여전히 Cloud Run **Job** 실행을 직접 트리거하는 기능이 없습니다. Cloud Tasks의 HTTP target은 App Engine 또는 일반 HTTP 엔드포인트(Cloud Run **서비스**/Cloud Functions)만 호출할 수 있습니다. Cloud Run Jobs 실행 API(`jobs.run`)는 별도의 Admin API 호출입니다. 2026년 Cloud Tasks 릴리즈 노트 및 "Cloud Run at Next '26" 발표 모두에서 신규 네이티브 통합 언급 없음. — [Executing asynchronous tasks | Cloud Run](https://docs.cloud.google.com/run/docs/triggering/using-tasks), [Cloud Tasks release notes](https://docs.cloud.google.com/tasks/docs/release-notes)
- **현재 권장 패턴(확정)**: Cloud Tasks(HTTP target, OIDC 인증) → 작은 Cloud Run **서비스**("launcher") → 그 서비스가 Cloud Run Admin API `projects.locations.jobs.run`을 `overrides`와 함께 호출 → Job 실행 시작. — [Execute jobs | Cloud Run](https://docs.cloud.google.com/run/docs/execute/jobs)
- **`analysis_id` 전달 방식(확정)**: `overrides.containerOverrides[].env`로 환경변수 오버라이드. REST 예시:
  ```json
  {
    "overrides": {
      "containerOverrides": [
        { "env": [{ "name": "ANALYSIS_ID", "value": "<uuid>" }, { "name": "RUN_TOKEN", "value": "<uuid>" }] }
      ],
      "taskCount": 1,
      "timeout": "600s"
    }
  }
  ```
  gcloud 등가: `gcloud run jobs execute JOB_NAME --update-env-vars ANALYSIS_ID=<uuid>,RUN_TOKEN=<uuid> --region=REGION`. — [Execute jobs | Cloud Run](https://docs.cloud.google.com/run/docs/execute/jobs)
- **Cloud Tasks 태스크 이름 dedup(확정, 기존 가정 정정 필요)**: 결정적 이름(`analysis-<uuid>`)으로 태스크를 만들면 dedup되지만, 재사용 가능해지는 시점은 **최대 24시간**(레거시 `queue.yaml`/`queue.xml` 큐는 9일) 후입니다 — 영구 보장이 아닙니다. 너무 빨리 재사용하면 `ALREADY_EXISTS` 에러. Google은 순차/타임스탬프 기반 커스텀 ID가 큐 전체 지연/에러율을 높인다고 명시적으로 경고합니다. — [`projects.locations.queues.tasks.create`](https://docs.cloud.google.com/tasks/docs/reference/rest/v2/projects.locations.queues.tasks/create)
  **설계 함의**: 태스크 이름 dedup은 방어선(2차)일 뿐이고, 진짜 중복 방지는 DB의 `run_token`/CAS(1차, 영구)입니다 — 기존 DB 설계와 정확히 일치.
- **Cloud Run Jobs 실행 semantics(확정)**: `maxRetries` 기본 **3**, 0~10 설정 가능. Task timeout 기본 **10분**, 최대 **168시간(7일)**(GPU 태스크는 1시간). Job의 재시도는 Cloud Tasks의 재시도와 **완전히 별개** — Cloud Tasks가 launcher 호출을 재시도하면 **새 실행**이 생기고, Job 자체의 `maxRetries`는 **같은 실행 안의 같은 태스크**를 재시도하는 것. Google은 "태스크 재시작이 손상되거나 중복된 출력을 만들지 않아야 한다"고 명시 — worker의 idempotency 책임을 공식 문서도 강조. — [Set maximum retries for jobs](https://docs.cloud.google.com/run/docs/configuring/max-retries), [Set task timeout for jobs](https://docs.cloud.google.com/run/docs/configuring/task-timeout), [Jobs retries and checkpoints](https://docs.cloud.google.com/run/docs/jobs-retries)
  **미확인**: 비정상 종료(non-zero exit)와 timeout을 Job 재시도 로직이 다르게 취급하는지는 조사한 문서 원문에서 명시적으로 구분되지 않음 — 확정 못 함.
- **taskCount 기본/최대값**: 조사한 문서에서 구체적 숫자를 확인 못 함 — 미확인(설계에 영향 있으면 `gcloud run jobs execute --help` 등에서 추가 확인 필요).

## 5. IAM 요구사항 (공식 문서 조사, 확정 다수 + 일부 미확인)

| 대상 | 필요 역할 | 근거 |
|---|---|---|
| Cloud Tasks 태스크를 생성하는 주체(Next.js가 쓰는 GCP 서비스 계정) | `roles/cloudtasks.enqueuer` | [Cloud Tasks roles and permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/cloudtasks) |
| Cloud Tasks → launcher(Cloud Run 서비스) 호출용 OIDC 서비스 계정 | 대상 Cloud Run **서비스**에 대한 `roles/run.invoker` | [Executing asynchronous tasks](https://docs.cloud.google.com/run/docs/triggering/using-tasks) — ⚠️ 태스크 생성 주체가 이 OIDC 서비스 계정을 "actAs"하기 위한 `iam.serviceAccountUser` 와이어링의 정확한 문서 페이지는 이번 조사에서 확정 못 함(플래그) |
| launcher가 `jobs.run`(overrides 포함)을 호출하기 위한 권한 | **`roles/run.jobsExecutorWithOverrides`** (`run.jobs.runWithOverrides`) — `roles/run.jobsExecutor`만으로는 override 권한 없음. `roles/run.developer`도 가능하지만 필요 이상으로 넓음 | [Cloud Run IAM roles](https://docs.cloud.google.com/run/docs/reference/iam/roles) |
| Cloud Run Job의 런타임 서비스 계정 | `roles/secretmanager.secretAccessor`(Supabase service_role 키를 Secret Manager로 주입할 경우) | [Configure secrets for jobs](https://docs.cloud.google.com/run/docs/configuring/jobs/secrets) |

필요 API: Cloud Run Admin API(`run.googleapis.com`), Cloud Tasks API(`cloudtasks.googleapis.com`), Secret Manager API. Artifact Registry API/Cloud Build API는 컨테이너 이미지 빌드·저장에 실질적으로 필요하지만, 조사한 페이지에서 "이 API를 활성화하라"는 명시적 문구를 직접 확인하지는 못함(플래그).

## 6. Secrets 목록 (이번 STEP 기준)

| Secret | 용도 | 저장 위치(계획) | 절대 금지 |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | worker가 RLS 우회 + service_role 전용 RPC(`acquire/update_progress/complete/fail`) 호출, Storage 원본 읽기 | 로컬 테스트: `worker/.env`(gitignore 대상, 이미 커버됨). 배포: GCP Secret Manager → Cloud Run Job에 주입 | `NEXT_PUBLIC_*` 접두사, 브라우저 전달, 코드 하드코딩, git commit, 로그 출력 |
| GCP 서비스 계정 인증(Next.js → Cloud Tasks 생성용) | Cloud Tasks task 생성 API 호출 | 로컬: `gcloud auth application-default login`(ADC, JSON 키 불필요). 배포(Vercel 등 GCP 밖 호스팅 가정): 장기 JSON 키 대신 **Workload Identity Federation** 권장(이번 STEP에서 실제 배포 안 하므로 문서화만) | 위와 동일 + Supabase 키와 절대 혼용 금지(서로 다른 시스템의 서로 다른 자격증명) |
| launcher/Cloud Run Job 자체의 GCP 자격증명 | `jobs.run` 호출, Secret Manager 접근 | 각 서비스에 attach된 런타임 서비스 계정(메타데이터 서버로 자동 획득, 정적 키 불필요) | 정적 키 발급 자체를 피함(불필요) |

## 7. Idempotency/Retry 분석 (3계층, 기존 설계와 신규 설계 종합)

1. **Cloud Tasks 태스크 이름 dedup** (`analysis-<id>`, 최대 24시간 재사용 유예) — 얕은 방어선. Next.js가 같은 analysis_id로 두 번 태스크 생성을 시도해도 두 번째는 `ALREADY_EXISTS`로 막힘(코드에서 이 에러를 성공으로 취급해야 함).
2. **`acquire_video_analysis_run`의 DB CAS** (`status='queued'` 조건, 이미 있음) — launcher가 실제 `jobs.run()`을 부르기 *전에* 반드시 호출. null이면 launcher는 Job을 시작하지 않고 200 OK로 즉시 종료(비용 큰 작업 회피, 요구사항 4번 충족). 이게 진짜 1차 방어선.
3. **`run_token` fencing** (이미 있음) — launcher가 acquire에서 받은 `run_token`을 Job 실행의 env override로 그대로 전달. worker의 모든 쓰기(`update_progress`/`complete`/`fail`)는 이 토큰+`status='processing'`이 맞아야만 반영됨. Cloud Run Job 자체 내부 재시도(같은 실행, 같은 run_token)에도 안전 — 재시도된 워커가 뒤늦게 완료를 시도해도 이미 completed/failed로 전이된 뒤라면 조건이 안 맞아 조용히 무시됨.

이 3개는 서로 다른 실패 모드를 막습니다: (1)은 "요청 자체의 중복", (2)는 "Job을 두 번 시작하는 것", (3)은 "이미 끝난 실행의 결과가 새 실행을 덮어쓰는 것". 셋 다 있어야 완전하고, 이미 설계돼 있던 (2)(3)에 (1)을 얹는 것이 이번 STEP의 실제 작업.

## 8. Failure matrix 초안 (plan 문서 F장에서 시나리오별 대응으로 확장)

| 실패 지점 | 관찰 가능한 상태 | 위험 |
|---|---|---|
| `queue_video_analysis` 성공, Cloud Tasks 생성 실패 | DB: `queued`, GCP: 태스크 없음 | **고아 상태 — 기존 RPC로는 자동 복구 불가**(queue_video_analysis의 WHERE절이 `status='uploaded'`만 받으므로 재호출해도 no-op). plan에서 재시도/알림 전략 필요 |
| Cloud Tasks 생성 성공, Next.js→브라우저 응답 유실 | DB: `queued`, GCP: 태스크 있음, 브라우저: 에러로 보임 | 브라우저가 재시도하면 `queue_video_analysis`가 null 반환(이미 queued) → 이 경우 새 태스크를 만들지 않아야 함 |
| launcher가 중복 호출됨(Cloud Tasks 재시도) | 두 번째 호출 시점에 DB가 이미 `processing` 또는 이후 상태 | `acquire_video_analysis_run`이 null 반환 → launcher는 Job 시작 없이 200 반환 |
| Job 실행이 중복 시작됨(launcher 버그/재시도 겹침) | 두 실행이 같은 `analysis_id`, 다른(또는 같은) `run_token` | acquire는 딱 한 번만 성공하므로 이론상 발생 안 해야 함 — 발생한다면 launcher의 acquire→jobs.run 사이에 별도 버그가 있다는 신호 |
| worker crash (complete 이전) | DB: `processing`에 멈춤, `run_token` 남음 | Job 자체 재시도(같은 실행) 또는 영구적으로 멈춤 — 후자는 별도 타임아웃 감지가 필요(4-3A 범위 밖으로 명시, plan에 후속 과제로 기록) |
| complete 이후 뒤늦은 재시도 도착 | DB: 이미 `completed` | `complete/fail_video_analysis`의 `status='processing'` 조건에 안 맞아 자동 무시 |
| Supabase 일시 장애 | worker의 RPC 호출이 예외/타임아웃 | worker는 지수 백오프로 재시도, 최종 실패 시 `fail_video_analysis(error_code='internal_error')` 시도(그마저 실패하면 Cloud Run Job의 non-zero exit로 Job 자체 재시도에 위임) |
| secret 누락(Secret Manager 미마운트 등) | 컨테이너 시작 시 즉시 실패 | 로그에 secret 값 자체는 절대 출력하지 않고 "누락됨" 사실만 출력, non-zero exit로 Job 재시도 대상이 되게 함 |
| invalid analysis_id (존재하지 않는 UUID) | `acquire_video_analysis_run`이 null(대상 행 없음) | launcher가 정상적으로 Job 시작 안 하고 종료 — DB에 아무 흔적도 안 남는 것이 정상 |
| cancelled 상태의 분석에 대해 launcher가 호출됨 | `acquire_video_analysis_run`의 WHERE절이 `status='queued'`만 통과 | cancelled는 절대 통과 못 함 — 안전 |
| stale `run_token`으로 worker가 쓰기 시도 | 3계층 참고 | 조건 불일치로 조용히 무시(0행 반영) |

## 9. 구현 위험 요소

- **고아 `queued` 복구 경로가 DB 설계상 없음**(8장 1번째 행) — STEP 4-3A에서 Next.js 쪽 재시도로 상당 부분 완화 가능하지만, 완전한 해결(예: 주기적 reconciliation)은 이번 스코프 밖. plan에 "알려진 한계"로 명시해야 함.
- **launcher의 정체가 아직 없음** — Next.js(Vercel 등 non-GCP 가정)에서 직접 `jobs.run`을 호출하는 것도 기술적으로는 가능(GCP API는 어디서든 호출 가능)하지만, Cloud Tasks의 OIDC 인증 대상이 되려면 launcher가 GCP에서 HTTP로 도달 가능해야 하므로 별도 Cloud Run 서비스가 필요. 이 launcher를 Next.js 코드베이스와 별도 저장소/디렉터리로 관리할지는 plan B장에서 파일 목록으로 확정.
- **taskCount 기본값 등 일부 GCP 세부사항 미확인**(4장 참고) — 결제 활성화 후 실제 실행 전에 재확인 필요.
- **worker의 Storage 읽기 경로가 아직 한 번도 실측되지 않음** — STEP 4-1/4-2는 브라우저(anon/authenticated) 관점의 Storage 접근만 검증했고, service_role의 서버사이드 읽기는 이번이 처음. dummy worker 단계에서 최소한 "오브젝트 존재 확인" 정도는 실측해두는 게 안전(plan에 반영).

## 10. Production/Staging 경계 (재확인)

- 이번 조사에서 실행한 모든 SQL은 `execute_sql` 조회(SELECT류)만 — staging에 어떤 쓰기도 하지 않음.
- Production(`fwjebymvfcmwbrystlro`)에는 어떤 조회도 하지 않음.
- `.env.local`의 현재 값은 STEP 4-2에서 이미 staging(`btyihqzfgbjpzgxienkp`)으로 전환되어 있음(사용자가 로컬에 반영 완료).
- GCP 프로젝트(`youtube-planner-staging`)에는 이번 조사에서 어떤 API 호출도 하지 않음 — 전부 공식 문서 조사였고 실제 리소스 생성/변경 없음.
