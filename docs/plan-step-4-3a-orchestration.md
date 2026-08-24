# docs/plan-step-4-3a-orchestration.md

STEP 4-3A 계획 문서. **승인 전에는 구현하지 않습니다.** 목표: `uploaded → queued →
processing → completed`가 실제 GCP 리소스 없이(로컬 검증) 또는 결제 활성화 후
staging에서 한 번 end-to-end로 흐르는 orchestration vertical slice. FFmpeg 실분석은
넣지 않음 — worker는 고정된 dummy report만 저장.

## A. Architecture

```
[브라우저]
   │ (STEP 4-2에서 이미 완료: 업로드 → mark_video_analysis_uploaded → status=uploaded)
   ▼
[Next.js Server Action: queueVideoAnalysis(analysisId)]
   │ 1) auth 확인
   │ 2) queue_video_analysis RPC (사용자 세션, service_role 불필요)
   │    uploaded → queued  (null 반환 시: 이미 queued/취소됨/소유 아님 → 멱등하게 처리)
   │ 3) 성공 시에만 Cloud Tasks에 태스크 생성
   │    - 태스크 이름: analysis-<analysis_id> (결정적, dedup용)
   │    - payload: { analysis_id }
   │    - target: launcher(Cloud Run 서비스) HTTP 엔드포인트, OIDC 인증
   ▼
[Cloud Tasks 큐] --(재시도/백오프는 Cloud Tasks가 관리)--> [launcher: 작은 Cloud Run 서비스]
   │ 1) analysis_id 파싱/검증(형식만 — 존재 여부는 다음 스텝에서 자연히 드러남)
   │ 2) acquire_video_analysis_run(analysis_id) 호출 (service_role)
   │    - null 반환 → 이미 처리 중/끝남/존재하지 않음 → 바로 200 OK 반환, Job 시작 안 함
   │    - 행 반환 → run_token 확보, 다음 단계로
   │ 3) Cloud Run Jobs `jobs.run()`을 overrides로 호출
   │    - env: ANALYSIS_ID=<id>, RUN_TOKEN=<run_token 확보값>
   │ 4) jobs.run() 호출 자체가 성공하면 200 OK 즉시 반환 (Job 완료를 기다리지 않음 —
   │    Cloud Tasks의 HTTP timeout보다 실제 분석 시간이 훨씬 길 수 있어서 fire-and-forget)
   ▼
[Cloud Run Job 실행: Python worker, 1회 실행 후 종료]
   │ 1) 환경변수로 ANALYSIS_ID, RUN_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY(Secret Manager) 수신
   │ 2) service_role Supabase 클라이언트 생성
   │ 3) (STEP 4-3A dummy) storage.objects에서 원본이 실제로 존재하는지 저수준 확인만 수행
   │    (real ffprobe/ffmpeg 분석은 하지 않음 — STEP 4-3B)
   │ 4) update_video_analysis_progress(id, run_token, stage, progress) 1~2회 호출(진행 상태 실측)
   │ 5) 성공 시 complete_video_analysis(id, run_token, report={version:"step-4-3a", message:"orchestration test completed"})
   │    예외 발생 시 fail_video_analysis(id, run_token, error_code, error_message) — 시크릿/스택트레이스는
   │    error_message에 절대 넣지 않고, 상세 로그는 Cloud Logging + execution_id로만 상호 참조
```

**책임 분리 이유**: `queue_video_analysis`는 사용자 세션으로 충분(RLS/SECURITY DEFINER가 이미 소유권을 확인) → Next.js Server Action이 그대로 처리. `acquire_video_analysis_run` 이후 전부는 service_role 전용 RPC라 신뢰된 서버 컨텍스트가 필요 → Next.js(Vercel 등, GCP 밖 가정)가 아니라 GCP 안의 launcher/worker가 담당. Cloud Tasks는 launcher만 트리거할 수 있으므로(연구 문서 4장) launcher가 반드시 별도 컴포넌트로 존재해야 함.

## B. 실제 변경/신규 파일 목록

### 신규 파일

| 경로 | 역할 |
|---|---|
| `supabase/migrations/0010_queue_video_analysis.sql` | staging에 이미 적용된 것과 **동일한 내용**을 로컬에 재현(J장) — 이번 승인에서 "파일만 생성, 재적용은 안 함"으로 명확히 구분 |
| `lib/actions/video-analyses.ts`에 함수 추가 | `queueVideoAnalysis(analysisId)` — 기존 파일 수정(신규 파일 아님, C장) |
| `lib/tasks/cloud-tasks-client.ts` | `@google-cloud/tasks` 래핑, 결정적 태스크 이름 생성 + `ALREADY_EXISTS`를 성공으로 처리하는 로직 |
| `worker/` (새 최상위 디렉터리, Next.js 앱과 분리된 별도 Python 프로젝트) | |
| `worker/main.py` | Cloud Run Job 컨테이너의 진입점 — dummy 분석 로직 |
| `worker/supabase_client.py` | service_role Supabase 클라이언트 생성 + 7개 RPC(이 중 4개: acquire/update_progress/complete/fail) 호출 래퍼 |
| `worker/requirements.txt` | `supabase`(python), 이번 단계는 `ffmpeg-python` 등 미포함(연구 문서 9장, "지금은 최소 의존성") |
| `worker/Dockerfile` | `python:3.12-slim` 기반, FFmpeg **미포함**(STEP 4-3B에서 추가) |
| `worker/.env.example` | 로컬 테스트용 환경변수 틀(실제 값은 커밋 안 함 — `.gitignore`의 `.env*`가 이미 커버) |
| `launcher/` (새 최상위 디렉터리, 별도 초경량 서비스) | |
| `launcher/main.py` (또는 Node — E장에서 결정) | Cloud Tasks로부터 HTTP POST 수신 → `acquire_video_analysis_run` → `jobs.run()` 호출 |
| `launcher/Dockerfile` | |
| `docs/step-4-3a-local-test-guide.md` | 로컬에서 launcher/worker를 GCP 없이 검증하는 절차(G장) |

### 수정 파일

| 경로 | 변경 내용 |
|---|---|
| `lib/actions/video-analyses.ts` | `queueVideoAnalysis(analysisId)` 함수 추가(기존 3개 함수와 동일한 컨벤션) |
| `lib/database.types.ts` | `queue_video_analysis` RPC 타입 추가 — **재생성은 `mcp__Supabase__generate_typescript_types`로, 승인 후 구현 단계에서** |
| `lib/types.ts` | 필요 시 `VideoAnalysisStatus`에 이미 있는 `queued`/`processing` 등은 STEP 4-1에서 이미 반영되어 있어 추가 변경 불필요(확인됨) — 변경 없음으로 예상, 구현 중 재확인 |
| `components/upload/video-upload.tsx` | 업로드 완료(`confirmed`) 카드에 "분석 시작(큐에 등록)" 버튼 추가 → `queueVideoAnalysis` 호출, 이후 상태(`queued`/`processing`/`completed`/`failed`)를 폴링해서 화면에 표시(D장 참고) |
| `app/(app)/upload/page.tsx` | 큰 변경 없음 — 필요 시 안내 문구만 추가 |
| `.env.local` | 변경 없음(worker/launcher는 별도 프로세스라 자기 자신의 `.env`를 가짐) |

**불필요한 추상화를 만들지 않기 위해 하지 않는 것**: 별도 "enqueue endpoint"(Next.js API route)를 새로 만들지 않음 — Server Action이 이미 서버 전용 코드이므로 브라우저에 노출되지 않고, RPC 호출 직후 같은 요청 안에서 Cloud Tasks 생성까지 처리하는 것이 가장 단순함(연구 문서 결론).

## C. 각 파일의 책임 (핵심만)

- **`queueVideoAnalysis`**(Next.js): `queue_video_analysis` RPC 호출 → 성공(행 반환) 시에만 Cloud Tasks 생성 시도 → Cloud Tasks 생성이 실패하면 지수 백오프로 즉시 2~3회 재시도 → 그래도 실패하면 에러를 사용자에게 보이되 **DB는 이미 `queued`로 남아있음을 로그에 명시**(F장 "고아 queued" 시나리오 대응, 완전 자동복구는 이번 스코프 밖).
- **`cloud-tasks-client.ts`**: 태스크 이름을 `analysis-${analysisId}`로 고정, `create()` 호출 시 `ALREADY_EXISTS` gRPC 에러 코드를 catch해서 "이미 큐에 있음"으로 간주(에러 아님).
- **`launcher/main.py`**: (1) 요청 바디에서 `analysis_id` 추출 및 UUID 형식 검증만(존재 여부 검증 안 함) (2) `acquire_video_analysis_run` 호출 (3) null이면 200 즉시 반환 (4) 행이 있으면 `run_token`을 받아 `jobs.run()`을 overrides와 함께 호출하고 그 응답(성공/실패)만 기다렸다가 200/5xx 반환 — Job의 실제 완료는 기다리지 않음.
- **`worker/main.py`**: 환경변수 필수값(ANALYSIS_ID, RUN_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) 존재 확인(없으면 시크릿 값 자체를 로그에 남기지 않고 "환경변수 누락" 메시지만 남기고 non-zero exit) → storage 오브젝트 존재 확인 → progress 갱신 1~2회 → dummy report로 `complete_video_analysis` → 예외 발생 시 `fail_video_analysis`.
- **`worker/supabase_client.py`**: `supabase-py`의 동기 `create_client()` + `.rpc()`만 사용(연구 문서 6장 — 이 워크로드는 배치 1회 실행이라 비동기 클라이언트의 알려진 이슈를 감수할 이유가 없음).

## D. 상태 전이

```
pending --(mark_video_analysis_uploaded)--> uploaded
uploaded --(queue_video_analysis, Next.js)--> queued
queued --(acquire_video_analysis_run, launcher)--> processing
processing --(update_video_analysis_progress, worker, 0회 이상)--> processing(진행률만 갱신)
processing --(complete_video_analysis, worker)--> completed   [report not null 제약]
processing --(fail_video_analysis, worker)--> failed           [error_code not null 제약]
pending/uploaded/queued --(cancel_video_analysis, 사용자)--> cancelled  [processing 이후는 취소 불가 — 기존 설계]
```

`/upload` 테스트 화면은 `queued` 이후 상태를 실시간으로 보려면 폴링이 필요(Realtime 구독은 이번 스코프 밖 — 불필요한 abstraction을 피하기 위해 3~5초 간격의 단순 폴링으로 충분, STEP 4-3A는 dummy라 몇 초 안에 끝남).

## E. Idempotency 계층 (연구 문서 7장 요약 + 이번 STEP에서 새로 추가되는 부분)

| 계층 | 이미 있음? | 이번 STEP에서 할 일 |
|---|---|---|
| Cloud Tasks 태스크 이름 dedup | 신규 | `cloud-tasks-client.ts`에서 결정적 이름 생성 + `ALREADY_EXISTS` 처리 |
| `acquire_video_analysis_run` CAS | 이미 있음(0006) | launcher에서 **반드시 jobs.run() 호출 전에** 사용하도록 구현(설계상 이미 정해져 있던 순서를 실제로 지킴) |
| `run_token` fencing | 이미 있음(0006) | launcher가 acquire의 반환값에서 run_token을 그대로 꺼내 worker의 env override로 전달 — worker는 run_token을 자기가 생성하지 않고 launcher가 준 값만 사용 |

launcher/Node 언어 결정: launcher는 `worker`와 별개로 Python 또는 Node 둘 다 가능(가벼운 HTTP 핸들러 + 2번의 외부 API 호출만 함) — **Python으로 통일**을 제안(worker와 동일 언어라 컨테이너 빌드/의존성 관리가 단순해지고, `supabase-py`를 launcher에서도 재사용 가능). 이견 있으면 승인 시 알려주세요.

## F. 실패 시나리오별 대응

| # | 시나리오 | 대응 |
|---|---|---|
| 1 | `queue_video_analysis` 성공 + Cloud Tasks 생성 실패 | Next.js가 즉시 2~3회 재시도(지수 백오프) → 계속 실패하면 사용자에게 에러 표시 + 서버 로그에 `analysis_id`와 "queued이지만 태스크 없음" 명시. **자동 복구 없음(알려진 한계, I장 참고)** — 사용자가 새로고침 후 다시 "분석 시작"을 누르면 `queue_video_analysis`가 이미 `queued`라 null 반환 → 이 경우 UI가 "이미 대기 중"으로 표시하고 새 태스크는 만들지 않아야 함(=재시도 버튼이 사실상 막혀 있음). 완전한 해결은 STEP 4-3A 범위 밖(9장/I장에 후속 과제로 명시). |
| 2 | Cloud Tasks 생성 성공 + 클라이언트 응답 유실 | 브라우저가 재시도해도 `queue_video_analysis`가 null 반환 → 새 태스크 생성 안 함 → 기존 태스크가 정상 진행되므로 문제 없음 |
| 3 | 태스크 중복(Cloud Tasks 자체 재시도) | 결정적 이름이라 두 번째 생성 시도는 `ALREADY_EXISTS`(처리됨) — 이미 있는 태스크가 다시 실행돼 launcher를 두 번 호출해도 시나리오 4로 흡수됨 |
| 4 | Job 중복(launcher가 두 번 호출됨) | 두 번째 `acquire_video_analysis_run` 호출이 null(이미 `processing`) → Job 시작 안 함, 비용 발생 없음 |
| 5 | worker crash (complete 이전) | Cloud Run Job 자체 `maxRetries`가 같은 실행/같은 run_token으로 재시도(연구 문서 4장) — 재시작된 worker가 마무리하면 정상 완료. 재시도 상한을 넘기면 Job은 실패로 끝나지만 **DB는 `processing`에 영구히 멈춤** — 별도 타임아웃 감지 배치가 없으므로 이번 STEP에서는 해결하지 않음(후속 과제) |
| 6 | complete 이후 뒤늦은 재시도 도착 | `status='processing'` 조건이 이미 안 맞음 → 자동 무시(기존 설계) |
| 7 | Supabase 일시 장애 | worker: RPC 호출에 지수 백오프 재시도(예: 3회) → 그래도 실패하면 `fail_video_analysis` 시도 → 그마저 실패하면 그냥 non-zero exit로 종료해 Job 자체 재시도에 위임 |
| 8 | secret 누락 | worker 시작 시 필수 환경변수 존재만 확인(값은 로그에 안 남김) → 없으면 즉시 non-zero exit로 종료, "SUPABASE_SERVICE_ROLE_KEY missing" 같은 메시지만 로그 |
| 9 | invalid analysis_id | `acquire_video_analysis_run`이 대상 행을 못 찾아 null → launcher가 Job을 시작하지 않고 200 반환 — DB에 아무 기록도 안 남는 것이 정상 동작 |
| 10 | cancelled 상태의 분석 | `acquire_video_analysis_run`의 WHERE절이 `status='queued'`만 통과시키므로 cancelled는 절대 acquire 안 됨 |
| 11 | stale `run_token` | `update_progress`/`complete`/`fail`의 조건 불일치로 조용히 무시(영향 행 0개) — worker는 이 경우 "내 실행은 더 이상 유효하지 않다"고 판단하고 조용히 종료해야 함(로그만 남김, 에러로 취급 안 함) |

## G. 로컬 테스트 전략 (GCP 리소스 없이)

결제가 활성화되지 않은 오늘 할 수 있는 것 — `docs/step-4-3a-local-test-guide.md`에 정리할 내용:

1. **DB 레벨**: Supabase MCP `execute_sql`로 `queue_video_analysis` → `acquire_video_analysis_run` → `update_video_analysis_progress` → `complete_video_analysis`를 staging에서 순서대로 직접 호출해보고 상태 전이/제약을 재확인(이미 STEP 4-1에서 한 것과 같은 방식, 이번엔 0010 포함).
2. **worker 단독 실행**: `worker/.env`에 staging `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`(사용자가 Supabase 대시보드에서 직접 발급/복사 — 이 세션은 절대 다루지 않음)를 채우고, `ANALYSIS_ID`/`RUN_TOKEN`을 위 1번에서 만든 실제 값으로 넣어 `python worker/main.py`를 로컬에서 직접 실행 — Cloud Run 없이 로직만 검증.
3. **launcher 단독 실행**: 로컬에서 `python launcher/main.py`를 띄우고 `curl`로 직접 POST — 실제 GCP `jobs.run()` 호출은 결제 활성화 전이라 모킹(환경변수로 "dry-run" 모드를 둬서, 실제 API 호출 대신 로그만 남기고 성공 처리하는 스위치를 하나 두는 것을 제안 — 승인 시 이견 있으면 알려주세요).
4. **Docker 빌드만 로컬에서 확인**: `docker build`까지는 결제 없이도 가능 — 이미지가 뜨는지, 필수 환경변수 누락 시 의도대로 종료하는지 로컬 `docker run`으로 확인.

## H. GCP billing 활성화 후 실제 staging E2E 검증 절차 (미리 정리, 지금 실행 안 함)

1. 필요 API 활성화: Cloud Run Admin API, Cloud Tasks API, Secret Manager API, (필요 시) Artifact Registry API.
2. Secret Manager에 `SUPABASE_SERVICE_ROLE_KEY` 등록(사용자가 직접, 이 세션은 값을 다루지 않음).
3. `worker`/`launcher` 이미지를 각각 Artifact Registry에 push, launcher는 Cloud Run **서비스**로, worker는 Cloud Run **Job**으로 배포.
4. IAM 배선(연구 문서 5장 표 그대로): launcher 런타임 서비스 계정에 `roles/run.jobsExecutorWithOverrides`, worker 런타임 서비스 계정에 `roles/secretmanager.secretAccessor`, Cloud Tasks OIDC 서비스 계정에 launcher에 대한 `roles/run.invoker`, Next.js가 쓰는 서비스 계정에 `roles/cloudtasks.enqueuer`.
5. Cloud Tasks 큐 생성.
6. `/upload`에서 실제 업로드 → 확인 → "분석 시작" 클릭 → `queued → processing → completed`가 화면에서 실시간(폴링)으로 바뀌는지 눈으로 확인.
7. 강제 실패 테스트: 존재하지 않는 analysis_id로 launcher를 직접 curl(F장 9번 재현), worker 컨테이너를 의도적으로 비정상 종료시켜 Job 재시도 확인(F장 5번 재현).
8. 위 과정에서 나온 실제 로그/결과를 STEP 4-3A 완료 보고서에 기록.

## I. Rollback 방법

- **DB**: `0010_queue_video_analysis.sql`은 이미 staging에 적용되어 있고 되돌릴 필요 없음(멀쩡하게 동작 확인됨, 3장). 만약 향후 문제가 생기면 `queue_video_analysis` 함수만 `DROP FUNCTION`하고 grants를 되돌리는 별도 rollback SQL을 그때 작성(기존 `supabase/migrations/rollback/` 디렉터리 관례를 따름 — 이번 STEP에서는 작성 안 함, 필요성 없음).
- **GCP 리소스**: 이번 STEP은 실제 리소스를 만들지 않으므로 롤백 대상 자체가 없음. 결제 활성화 후 실제 배포하게 되면, Cloud Run Job/서비스/Cloud Tasks 큐를 삭제하는 것만으로 완전히 되돌릴 수 있음(상태는 전부 Supabase DB에 있고 GCP 쪽은 stateless).
- **알려진 한계(자동 복구 없음, F장 1/5번)**: "고아 `queued`"와 "영구 `processing` 정지"는 이번 STEP에서 해결하지 않음 — STEP 4-3A 완료 보고서에 명시적으로 남기고, 필요하면 STEP 4-3B 이전에 별도 reconciliation 작업으로 다룰 것을 제안.

## J. `0010` 로컬 migration reconciliation 방법 (계획만, 지금 실행 안 함)

승인 후 구현 단계에서 할 일(지금은 안 함):

1. `mcp__Supabase__execute_sql`로 이미 확인한 `queue_video_analysis`의 실제 `pg_get_functiondef` 원문(연구 문서 3장)을 **그대로** `supabase/migrations/0010_queue_video_analysis.sql`에 옮겨 적는다 — staging에 이미 있는 것과 다시 만드는 게 아니라 "이미 있는 것을 로컬 파일로 문서화"하는 것.
2. 기존 0009 관례(먼저 `revoke ... from public`, 필요한 role에만 `grant`)를 그대로 따라 grants 섹션도 포함 — 실측한 grant 목록(연구 문서 2장 표)과 정확히 일치시킨다.
3. **이 파일을 만든 뒤에도 staging에 다시 적용하지 않는다** — 이미 적용되어 있으므로 재적용은 아무 효과가 없거나(멱등, `create or replace function`이라 안전은 함) 불필요한 위험. `supabase_migrations.schema_migrations`에 이미 버전이 기록되어 있어 로컬 CLI로 `supabase db push`를 하더라도 스킵됨 — 다만 **로컬 CLI가 production(`fwjebymvfcmwbrystlro`)에 링크되어 있다는 기존 경고(STEP 4-2 조사)가 여전히 유효**하므로, `supabase db push`류 명령은 계속 쓰지 않는다.
4. `lib/database.types.ts`를 `mcp__Supabase__generate_typescript_types`로 재생성해 `queue_video_analysis` 타입을 포함시킨다.
5. production에는 이 마이그레이션을 이번 STEP에서도, 승인 후 구현 단계에서도 적용하지 않는다 — production 적용은 STEP 4-3A/B 전체가 끝나고 별도로 사용자 승인을 받는 시점의 일이다.

---

## 요약 (승인 요청)

1. **조사한 현재 상태**: STEP 4-1/4-2 DB 계약은 문서와 실측이 완전히 일치. 단 `0010_queue_video_analysis`가 로컬 마이그레이션 파일과 `database.types.ts`에는 없이 staging DB에만 존재(migration drift, 실측 확정). Next.js 쪽엔 service_role 코드가 전혀 없음(worker가 처음).
2. **발견한 문제/위험**: (a) migration drift, (b) "고아 `queued`"와 "영구 `processing`"에 대한 자동 복구 경로가 현재 DB 설계엔 없음(둘 다 이번 STEP 범위 밖으로 명시, 후속 과제), (c) Cloud Tasks는 Cloud Run Job을 직접 못 트리거하므로 별도 launcher 컴포넌트가 필수(예상보다 컴포넌트가 하나 더 필요).
3. **추천 architecture**: Next.js(큐잉+태스크생성) → Cloud Tasks → launcher(Cloud Run 서비스, acquire+jobs.run 호출) → worker(Cloud Run Job, Python, dummy report).
4. **만들거나 수정할 파일**: B장 표 그대로 — 신규 `worker/`, `launcher/`, `lib/tasks/cloud-tasks-client.ts`, `supabase/migrations/0010_*.sql`(재현용, 재적용 안 함), 로컬 테스트 가이드 문서. 수정은 `lib/actions/video-analyses.ts`(+1 함수), `components/upload/video-upload.tsx`(+버튼/폴링), `lib/database.types.ts`(재생성).
5. **STEP 4-3A 구현 범위**: dummy report만 저장하는 orchestration vertical slice. 실제 FFmpeg 분석, Cloud Tasks 큐/Cloud Run 리소스의 실제 생성, production 적용은 전부 제외.
6. **승인하시면 다음에 정확히 할 일**: (1) `0010` 마이그레이션 파일 재현(재적용 없음) + 타입 재생성, (2) `queueVideoAnalysis` 서버 액션 + Cloud Tasks 클라이언트 코드 작성, (3) `worker/`, `launcher/` Python 프로젝트 뼈대 + Dockerfile 작성(FFmpeg 미포함), (4) G장의 로컬 검증(GCP 리소스 없이) 실행 및 결과 보고. 결제 활성화 후의 H장 절차는 별도 승인 시점에 진행.
