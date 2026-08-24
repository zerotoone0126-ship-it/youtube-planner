# STEP 4-3A 구현 결과 보고서

architecture는 이미 확정되어 이번 STEP에서 다시 제안하지 않습니다. 아래는
구현 결과와 실행 가능했던 검증 결과, 그리고 실제로 부딪힌 한계에 대한
보고입니다.

## 1. Repository 조사 결과

- 이 저장소에는 App Router 동적 라우트(`app/api/**/[id]/**`)가 이번이
  처음입니다 — 기존에 `app/api/` 자체가 존재하지 않았습니다. 유일한 기존
  Route Handler 패턴은 `app/auth/callback/route.ts`(OAuth 콜백)였고, 이
  파일의 스타일(`Request`/`NextResponse`, `new URL(request.url)`)을
  새 라우트의 참고 패턴으로 그대로 따랐습니다.
- `mark_video_analysis_uploaded()`는 정확히 한 곳에서만 호출됩니다:
  `components/upload/video-upload.tsx`의 `confirmVideoUploaded()` 래퍼를
  통해, `engineState.status === "success"`가 되는 순간 `useEffect` +
  `confirmStartedForRef` 가드로 한 번만 호출됩니다. STEP 4-3A 큐 등록은
  이 confirm이 끝나 `confirmed` state가 채워지는 시점에 이어붙였습니다.
- Next.js는 16.3.2가 실제로 설치 대상으로 지정되어 있고(`package.json`),
  `proxy.ts`(구 `middleware.ts`) 및 async `params`/`searchParams` 관례가
  실제 코드로 확인됩니다 — 새 Route Handler도 `context.params`를
  `Promise<{ id: string }>`로 받고 `await`합니다.
- `tsconfig.json`은 strict, `"@/*": ["./*"]` 경로 별칭, `moduleResolution:
  "bundler"`. `eslint.config.mjs`는 flat config +
  `eslint-config-next/core-web-vitals`+`typescript`. 새 파일들은 이 관례를
  벗어나지 않게 작성했습니다(실제 lint 실행은 4번 섹션 참고).
- `worker/`, PoC, Dockerfile, Python 파일은 이번 STEP 이전에는 저장소 어디에도
  존재하지 않았습니다(`find`로 직접 확인) — "기존 PoC Dockerfile의 FFmpeg
  설정을 재사용"할 대상이 없었으므로, `worker/Dockerfile`은 표준
  `python:3.12-slim` 베이스로 새로 작성했습니다.
- `lib/database.types.ts`는 STEP 4-2 시점 스냅샷이라 `queue_video_analysis`가
  없었고, `mcp__Supabase__generate_typescript_types`로 staging
  (`btyihqzfgbjpzgxienkp`)에서 다시 생성해 갱신했습니다. 이 재생성된
  타입에서 `acquire_video_analysis_run`은 여전히 **구(舊) 1-인자
  시그니처**(`Args: { p_id: string }`)로 나옵니다 — 0011이 아직 remote에
  적용되지 않았기 때문이며 예상된 결과입니다. 이 함수는 Next.js/TypeScript
  코드에서 전혀 호출하지 않으므로(오직 Python worker의 service_role
  클라이언트만 새 2-인자 시그니처를 호출) 타입 불일치로 이어지지 않습니다.
- 조사 중 발견한 관련 없는 기존 이슈 2개(고치지 않고 보고만 함, 11번
  섹션에도 다시 언급):
  1. 저장소 루트에 `.gitignore`가 비어 있습니다(`.env.local`을 포함한 어떤
     파일도 무시하지 않음). `.env.local`이 실제로 로컬에 존재하는데
     git에 커밋되지 않게 막는 장치가 지금 하나도 없습니다.
  2. `package.json`의 `types` 스크립트가 staging이 아니라 **production**
     project ref(`fwjebymvfcmwbrystlro`)를 가리키고 있습니다. 개발자가
     아무 생각 없이 `npm run types`를 돌리면 production 스키마로 타입을
     생성하게 됩니다(쓰기 작업은 아니지만 project ref 혼선의 소지).

## 2. 변경/신규 파일 목록

| 경로 | 신규/수정 | 이유 |
|---|---|---|
| `supabase/migrations/20260824124434_0010_queue_video_analysis.sql` | 신규 | staging에 이미 적용된 마이그레이션을 로컬에 재현(drift 해소). remote 미적용. |
| `supabase/migrations/0011_orchestration_retry_safety.sql` | 신규 | `queue_video_analysis` 멱등화 + `acquire_video_analysis_run` execution-aware 재작성. remote 미적용. |
| `lib/database.types.ts` | 수정(전체 재생성) | staging에서 다시 생성해 `queue_video_analysis`를 포함하도록 갱신. |
| `lib/gcp/cloud-tasks.ts` | 신규 | Cloud Tasks에 `jobs.run` HTTP target task를 만드는 server-only 헬퍼. |
| `lib/gcp/cloud-tasks.test.ts` | 신규(미실행) | `CloudTasksClient` mock 기반 vitest 테스트. |
| `lib/actions/video-analyses.ts` | 수정(추가만) | `queueVideoAnalysis()` Server Action 추가. 기존 3개 함수는 그대로. |
| `app/api/video-analyses/[id]/queue/route.ts` | 신규 | 큐 등록 API. DB 전이 → Cloud Tasks enqueue. |
| `app/api/video-analyses/[id]/queue/route.test.ts` | 신규(미실행) | 라우트의 상태 코드 매핑 vitest 테스트. |
| `components/upload/video-upload.tsx` | 수정 | 업로드 확인(confirmed) 후 큐 등록 API를 자동 호출하도록 연결. |
| `package.json` | 수정 | `@google-cloud/tasks`, `vitest` 추가, `"test": "vitest run"` 스크립트 추가. |
| `.env.example` | 신규 | Next.js 앱용 환경변수 템플릿(GCP 변수 포함, 값 없음). |
| `vitest.config.ts` | 신규 | `@/*` 별칭 매핑 포함 최소 vitest 설정. |
| `worker/main.py` | 신규 | Cloud Run Job 엔트리포인트. |
| `worker/supabase_client.py` | 신규 | service_role RPC 어댑터 + 테스트용 Protocol. |
| `worker/requirements.txt` | 신규 | `supabase==2.31.0`(GitHub releases로 확인한 실제 최신 안정 버전). |
| `worker/Dockerfile` | 신규 | FFmpeg 없음, HTTP 서버 없음. |
| `worker/.env.example` | 신규 | worker용 환경변수 템플릿(값 없음). |
| `worker/tests/test_main.py` | 신규(실제 실행함) | stdlib unittest, 가짜 client로 오케스트레이션 로직 검증. |

## 3. 0010 마이그레이션 재현(reconciliation) 상태

`supabase_migrations.schema_migrations`(staging)를 직접 조회해 최신 적용
버전이 `20260824124434`(`0010_queue_video_analysis`)임을 확인했고,
`pg_get_functiondef`로 실제 함수 본문을 대조해 로컬 파일 내용이 정확히
일치하도록 재현했습니다. **remote(staging/production)에는 이 STEP에서
아무것도 다시 적용하지 않았습니다** — 이미 적용되어 있는 내용을 로컬 파일로
"따라잡은" 것뿐입니다.

## 4. 0011 마이그레이션 (전체 SQL, 사람 검수용 — remote 미적용)

`supabase/migrations/0011_orchestration_retry_safety.sql`의 전체 내용은
7번 섹션에서 전달한 파일 그대로이며, 요약하면:

- **A. `queue_video_analysis`**: `uploaded→queued` 전이를 시도하고 실패하면
  (이미 본인 소유의 `queued` 행이면) 상태를 바꾸지 않고 그대로 반환합니다 —
  Cloud Tasks 생성이 실패한 뒤 같은 큐잉 요청이 재시도될 때 안전합니다.
- **B. `acquire_video_analysis_run(p_id uuid, p_execution_id text)`**: 기존
  1-인자 시그니처를 `drop function if exists`로 제거하고 새로 만듭니다.
  최초 acquire(`queued→processing`), 같은 execution의 재시도(run_token만
  재발급해 이전 attempt를 fencing), 다른 execution/terminal 상태(null) 세
  가지 경로를 하나의 함수 안에서 두 개의 원자적 UPDATE로 구현했습니다.

이 파일은 로컬 파일로만 존재하며, staging/production 어디에도 적용하지
않았습니다. 사람이 검수 후 별도로 적용해야 합니다.

## 5. 큐 등록 흐름 (실제 코드 기준)

1. 브라우저가 업로드를 마치고 `confirmVideoUploaded()`가 성공하면
   (`components/upload/video-upload.tsx`), `confirmed` state가 채워지고
   두 번째 `useEffect`가 `POST /api/video-analyses/{id}/queue`를 자동
   호출합니다(`queueStartedForRef`로 중복 호출 방지).
2. Route Handler(`app/api/video-analyses/[id]/queue/route.ts`)가 `id`의
   UUID 형식을 검사(400)한 뒤, 사용자 세션 기반 `queueVideoAnalysis()`
   Server Action을 호출합니다. 이 액션은 `queue_video_analysis` RPC 하나만
   호출하며 **service_role을 쓰지 않습니다**.
3. RPC 실패를 `not_authenticated`(401) / `not_queueable`(409) / 그 외(500)로
   매핑합니다. `not_queueable`은 "존재하지 않음/소유 아님/큐잉 불가능한
   상태"를 구분하지 않고 뭉뚱그립니다 — `cancelVideoAnalysis` 등 기존
   관례와 동일한 information-disclosure 선택입니다.
4. DB 전이가 성공하면 `enqueueVideoAnalysisTask(id)`를 호출합니다. 성공하면
   202({data:{status:"queued", task:{outcome}}})를 반환합니다.
5. Cloud Tasks 생성이 실패하면(네트워크, GCP 자격증명 미설정 등) **DB를
   `uploaded`로 되돌리지 않습니다** — `queued`로 그대로 두고 503을
   반환합니다. 브라우저는 이 503에 대해 "큐 등록 다시 시도" 버튼을 보여주고,
   재시도는 0011 적용 후 `queue_video_analysis`의 멱등성에 의존합니다(0011
   미적용 상태에서 재시도하면 여전히 409가 나는 것이 현재의 알려진 차이입니다).

## 6. Cloud Task 페이로드 (실제 구현 코드 기준)

`lib/gcp/cloud-tasks.ts`의 `enqueueVideoAnalysisTask()`가 만드는 task:

- `name`: `client.taskPath(projectId, location, queue, "video-analysis-{analysisId}")`
  — 결정적 task ID로 Cloud Tasks 레벨 중복 방지.
- `httpRequest.url`: `https://run.googleapis.com/v2/projects/{GCP_PROJECT_ID}/locations/{GCP_LOCATION}/jobs/{GCP_CLOUD_RUN_JOB}:run`
  (Cloud Run **Admin API**의 jobs.run — Cloud Run 서비스 URL이 아님, 중간
  launcher 서비스 없음).
- `httpRequest.httpMethod`: `POST`, `Content-Type: application/json`.
- `httpRequest.body`: `{"overrides":{"containerOverrides":[{"env":[{"name":"ANALYSIS_ID","value":"<analysisId>"}]}]}}`
  — `ANALYSIS_ID`만 override, 다른 정적 설정(taskCount 등)은 건드리지 않음.
- `httpRequest.oauthToken`: `{ serviceAccountEmail, scope:
  "https://www.googleapis.com/auth/cloud-platform" }` — OIDC가 아니라 OAuth
  토큰(jobs.run이 Cloud Run Admin API 엔드포인트라서).
- `createTask()`가 던지는 에러의 `err.code === 6`(gRPC `ALREADY_EXISTS`,
  숫자 상수로만 판별, 문자열 파싱 없음)이면 `{outcome:"already_exists"}`로
  성공 취급. 그 외 에러는 그대로 다시 던져서 Route Handler가 503으로
  변환합니다.

## 7. Worker 흐름 (실제 코드 기준)

`worker/main.py`의 `run()`:

1. `acquire_video_analysis_run(analysis_id, execution_id)` 호출.
   `None`이면 로그만 남기고 즉시 `return 0`(비싼 작업 시작 안 함).
2. 성공하면 `run_token`을 꺼내고, `update_video_analysis_progress(...,
   stage="orchestration_test", progress=50)` → `complete_video_analysis(...,
   report={"version":"step-4-3a","message":"orchestration test completed"})`.
3. `complete_video_analysis`가 `None`을 반환하면(run_token이 이미
   fencing되어 stale) 아무것도 덮어쓰지 않고 `return 0`.
4. `update_progress`/`complete` 도중 예외가 나면 `CLOUD_RUN_TASK_ATTEMPT`와
   (기본값 1의) `--max-retries` 설정을 비교해 마지막 attempt인지 판단:
   마지막이 아니면 `fail_video_analysis`를 부르지 않고(그대로 `processing`
   상태로 남겨 같은 execution의 다음 attempt가 재획득하게 함) `return 1`;
   마지막이면 `sanitize_error()`로 만든 `(error_code="internal_error",
   error_message)`로 `fail_video_analysis`를 부른 뒤 `return 1`.
5. `acquire_video_analysis_run` 자체(또는 그 이전 단계)에서 예외가 나면
   `run_token`을 아직 모르므로 `fail_video_analysis`를 부를 방법이 없어
   attempt 위치와 무관하게 그냥 비정상 종료합니다(`main()`의 바깥쪽
   try/except).

`error_code`는 항상 `internal_error`로 고정했습니다 —
`video_analyses_error_code_check` CHECK 제약(staging에서
`pg_get_constraintdef`로 직접 대조)이 허용하는 값이 정확히
`upload_failed/unsupported_format/processing_timeout/pipeline_error/internal_error`
5개뿐이라서, 임의의 예외 클래스 이름을 그대로 보내면 이 CHECK 자체가
깨집니다.

`worker/supabase_client.py`는 실제 구현(service_role)과 테스트용 Protocol을
분리해 두었습니다 — `main.py`는 이 Protocol에만 의존합니다.

## 8. 테스트 실행 결과

**Python (`worker/tests/test_main.py`) — 이번 세션에서 실제로 실행하고
통과를 확인함:**

```
$ cd worker && python3 -m unittest discover -s tests -v
...
----------------------------------------------------------------------
Ran 15 tests in 0.005s

OK
```

15개 테스트 모두 통과: acquire=null 시 no-op, 정상 흐름, complete=null(stale
fencing) 시 fail 미호출, 마지막 attempt가 아닐 때 예외 발생 시 fail 미호출,
마지막 attempt일 때 fail 호출 + error_code가 정확히 `internal_error`인지,
acquire 자체 예외 시 fail 미호출, `sanitize_error` 길이 제한/타입명 포함,
`validate_env`/`build_execution_id`/`get_attempt_number`/`get_max_retries`
헬퍼. `supabase` 패키지가 실제로 설치되어 있지 않음(`python3 -c "import
supabase"` → `ModuleNotFoundError`)을 직접 확인한 상태에서 통과했으므로,
지연 import(dependency injection) 설계가 의도대로 동작함을 실증했습니다.

**TypeScript (`lib/gcp/cloud-tasks.test.ts`,
`app/api/video-analyses/[id]/queue/route.test.ts`) — 작성만 하고 이번
세션에서는 실행하지 못했습니다.** 이유는 9번 섹션 참고. `vitest`를
devDependency로 추가하고 `vitest.config.ts`를 작성했지만, 실제
`npm.cmd install && npm.cmd run test`는 사용자의 컴퓨터에서 직접 실행해서
확인해야 합니다.

## 9. Build / Lint / Typecheck 실행 결과 (전부 실제로 시도했고, 결과를 그대로 보고)

이 세션(클라우드 샌드박스)은 아래 네 가지가 전부 막혀 있어서, 이 저장소의
어떤 빌드/린트/타입체크/테스트도 신뢰할 수 있는 형태로 실행할 수
없었습니다 — 지어내지 않고 실제로 시도한 결과를 그대로 남깁니다:

- **npm install 계열이 전부 403**: `npm install`, `npx eslint`, `npx next
  build` 모두 `403 Forbidden - GET https://registry.npmjs.org/...`로
  실패. 이 세션의 `node_modules`에는 `@supabase`만 남아 있고 `next`,
  `vitest`, `@google-cloud/tasks`, `typescript` 타입 패키지 등이 전혀
  없습니다.
- **`tsc --noEmit`을 그래도 시도**: 전역 `tsc`(v5, `~/.npm-global/bin/tsc`)가
  있어서 실행은 됐지만, 379개 에러 전부가 `Cannot find module
  'next'/'vitest'/'@google-cloud/tasks'` 또는 `Cannot find name
  'process'/'Buffer'`류였습니다 — `@types/node`/`next`/`vitest`/`@google-cloud/tasks`가
  설치되어 있지 않아서 나는 노이즈이고, 이번에 작성한 코드의 실제 타입
  오류인지는 이 출력만으로 구분할 수 없습니다. 즉 "빌드 통과"를 주장할
  근거가 없습니다.
- **pip install도 막혀 있음**: `pip install --break-system-packages
  supabase` → `No matching distribution found for supabase`(PyPI 접근
  불가). `worker/supabase_client.py`의 `from supabase import
  create_client`가 실제로 동작하는지는 이 세션에서 검증하지 못했습니다.
- **Docker 데몬 없음**: `docker build`가 `dial unix
  /var/run/docker.sock: connect: no such file or directory`로 즉시
  실패. `worker/Dockerfile`을 실제로 빌드해보지 못했습니다.
- **이 세션에는 사용자 컴퓨터에서 셸 명령을 실행하는 도구(device shell)가
  없습니다** — 그래서 이 클라우드 샌드박스가 막혀 있는 4가지를 사용자의
  실제 Windows 머신에서 대신 실행해볼 방법도 이번 세션에는 없었습니다.

**결론: `npm.cmd install`, `npm.cmd run build`, `npm.cmd run lint`,
`npm.cmd run test`, `docker build`, worker의 `pip install -r
requirements.txt` — 이 6개는 전부 사용자가 실제 로컬 환경에서 직접
실행해서 확인해야 하는, 이번 세션이 못 채운 검증 공백입니다.** 유일하게
실제로 실행되고 통과가 확인된 것은 Python stdlib `unittest`
(`worker/tests/test_main.py`, 15/15 통과)뿐입니다.

## 10. 보안 검토

- **service_role key**: 코드, git, 브라우저, `NEXT_PUBLIC_*`, 테스트
  fixture, 로그 어디에도 값을 넣지 않았습니다. `.env.local`에 있는 키
  이름만(값은 절대 읽지 않고) 확인해서 `.env.example`을 만들었고, 실제로
  `SUPABASE_SERVICE_ROLE_KEY`는 지금 로컬 env에도 존재하지 않습니다(이번
  STEP 이전에는 필요한 곳이 없었기 때문). `.env.example`/`worker/.env.example`
  둘 다 값 없이 키 이름만 있습니다.
- **worker의 service_role 사용**: `worker/supabase_client.py`에서만
  service_role을 쓰고, 이 파일과 그 값은 Next.js 앱(브라우저로 전달될 수
  있는 어떤 경로)과 완전히 분리되어 있습니다.
- **route.ts는 service_role을 쓰지 않습니다** — `lib/supabase/server.ts`의
  쿠키 기반 사용자 세션 클라이언트만 사용합니다.
- **로깅**: `route.ts`는 Cloud Tasks 예외를 잡을 때 `err` 객체 전체가 아니라
  `err.message`만(그리고 truthy 체크 후 문자열만) 로그로 남깁니다.
  `worker/main.py`의 `sanitize_error()`도 예외 타입명 + `str(exc)`만
  500자로 잘라서 담고, service_role key/Google 자격증명/Authorization
  헤더/Secret Manager 페이로드가 애초에 예외 메시지에 실릴 수 있는
  코드 경로가 없습니다(어댑터가 그런 값을 예외에 담아 올리지 않음).
- **ALREADY_EXISTS 판별**은 숫자 gRPC 코드(`=== 6`)로만 하고, 에러
  메시지 문자열을 파싱하는 코드는 어디에도 없습니다.
- **이번 STEP과 직접 관련은 없지만 조사 중 발견한 것 — 1번 섹션에서도
  언급**: 저장소 루트 `.gitignore`가 비어 있어 `.env.local`을 막는 장치가
  없습니다. 이건 이 STEP의 범위 밖이라 고치지 않았지만, service_role key를
  다루게 될 다음 STEP 전에 반드시 짚어야 할 항목이라고 판단해 blocker로
  남깁니다.

## 11. 남은 Blocker (architecture 재제안 아님 — 구현 결과 기준으로만)

1. **stale-processing 회수 시스템 없음(의도된 공백)**: `run_token`을 아직
   모르는 단계에서 예외가 나거나(예: `acquire_video_analysis_run` 자체가
   실패) 컨테이너가 OOM 등으로 강제 종료되면, 마지막 attempt에서도
   `fail_video_analysis`가 호출되지 못하고 행이 `processing`에 영구히 남을
   수 있습니다. 이번 STEP은 이 reaper/heartbeat 시스템을 새로 만들지
   말라고 명시되어 있어 만들지 않았습니다 — 다음 STEP에서 다뤄야 합니다.
2. **TypeScript/Docker 쪽 실행 검증 공백**: 9번 섹션 그대로. `npm.cmd
   install && npm.cmd run build && npm.cmd run lint && npm.cmd run test`,
   그리고 `worker/`에서 `pip install -r requirements.txt` 및 `docker
   build -t video-analysis-worker .`를 로컬에서 직접 실행해 확인해야
   합니다. 코드는 실제 staging 스키마와 공식 문서(Cloud Tasks Node.js
   client v5.5.2, supabase-py v2.31.0 — 둘 다 WebFetch로 확인, 지어내지
   않음)를 대조해 작성했지만, 이 세션 안에서 컴파일/런타임으로 검증하지는
   못했습니다.
3. **`.gitignore`가 `.env*`를 막지 않음**: 이 STEP의 변경 범위 밖이라
   고치지 않았습니다. service_role key를 다루는 다음 STEP 전에 반드시
   해결이 필요합니다.
4. **`--max-retries` 실제 배포값과 `CLOUD_RUN_TASK_MAX_RETRIES`의 정합성**:
   이번 STEP은 실제 Cloud Run Job을 만들지 않았으므로 `DEFAULT_MAX_RETRIES=1`
   (지시사항의 "planned")이 실제 배포 설정과 일치하는지 검증되지 않았습니다.
   배포 시 `--max-retries` 값과 `CLOUD_RUN_TASK_MAX_RETRIES` 환경변수(또는
   기본값)를 반드시 맞춰야 "마지막 attempt" 판단이 정확합니다.
5. **GCP 리소스(Cloud Tasks 큐, Cloud Run Job, 서비스 계정, IAM)는 이번
   STEP에서 실제로 하나도 만들지 않았습니다** — 지시사항 그대로입니다.
   `.env.example`/`worker/.env.example`의 값들은 전부 비어 있고, 실제
   배포 시 사람이 채워야 합니다.
