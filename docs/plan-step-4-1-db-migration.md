# docs/plan-step-4-1-db-migration.md

STEP 4-1의 plan 문서입니다. **이 문서는 계획이며, 아래 SQL은 초안(제안)입니다. 이번 STEP에서 마이그레이션을 실행하거나 production DB를 변경하지 않았습니다.** `docs/research-step-4-1-db-analysis.md`의 조사 결과를 전제로 합니다.

이 버전은 1차 초안에 대한 사용자 검토 피드백(10개 항목)을 반영한 개정판입니다. 이번 조사에서 기존 코드베이스에 대한 새로운 사실이 발견되지는 않았으므로 `research-step-4-1-db-analysis.md`는 수정하지 않았습니다.

---

## 0. 이 STEP의 목적과 범위 (재확인)

STEP 4-1의 목적은 **영상 분석 작업의 상태/소유권/결과/실패 정보를 안전하게 저장할 DB 구조를 확정하는 것**입니다. Cloud Run 분석 파이프라인이나 STT/OCR 실제 구현은 이 STEP의 범위가 아닙니다. 이번 STEP에서 하지 않는 것은 15장에 다시 명시합니다.

---

## 1. 1차 초안 대비 변경 요약

| # | 1차 초안 | 이번 개정 | 이유 |
|---|---|---|---|
| 1 | idempotency = `queued→processing` CAS 한 줄 | 생성(client_request_id) / launcher(run_token 발급) / worker(run_token 검증) / 회수(stale-lock) 4계층 | launcher가 두 번 호출되면 CAS 이전에 Job 자체가 두 번 뜰 수 있음 (5장) |
| 2 | storage 삭제 = 매일 버킷 전체 스캔 | `storage_deleted_at` 컬럼 기반 DB 쿼리(일반 케이스) + 저빈도 버킷 스캔(계정삭제로 인한 orphan 전용 백스톱) | 매일 전체 스캔은 불필요하게 비쌈. 계정삭제 케이스만 별도 설명 필요 (6장) |
| 3 | `storage_path` GENERATED 컬럼 | 일반 `text` 컬럼 + CHECK 제약 | GENERATED는 나중에 규칙을 바꿀 때 컬럼을 드롭/재생성해야 함(Postgres 제약). CHECK는 제약만 교체하면 됨. 보안 성격은 동일(9-3장) |
| 4 | `mark_video_analysis_uploaded`가 소유권만 확인 | Storage에 실제 파일이 존재하는지, 크기가 얼마인지까지 같은 함수 안에서 확인 후 `file_size_bytes`를 Storage 메타데이터에서 직접 채움 | "업로드됐다"는 클라이언트 주장이 아니라 Storage의 사실을 확인해야 함(7장) |
| 5 | Storage RLS에 UPDATE 조건이 소유 폴더까지만 | 소유 폴더 + `video_analyses.status='pending'`일 때만 UPDATE 허용 | 업로드 완료 후 내용을 몰래 바꿔치기하는 경로를 차단(6-3장) |
| 6 | 상태 8종 후보 검토 | 7종 유지, `launching` 상태 대신 `run_token`으로 동일한 목적 달성 | 상태를 늘리지 않고도 launcher idempotency를 확보할 수 있음(4장) |
| 7 | CHECK 5개 | CHECK 9개 + "DB가 강제할 것 vs 애플리케이션이 담당할 것" 원칙 명시 | (11장) |
| 8 | `channel_id`는 단순 FK만 | 생성을 RPC로 일원화하고 그 안에서 소유권 확인. 별도 composite FK/트리거는 불필요하다고 판단(근거 명시) | (8장) |
| 9 | `report`/`raw_metrics`에 `schema_version` | 유지 + `pipeline_version`(컬럼)과의 관계를 명확히 구분 | (9장) |
| 10 | 개인정보/시크릿 금지 목록 없음 | 금지 목록 + `execution_id` 컬럼으로 사용자 노출 메시지와 내부 로그 분리 | (10장, 12-7) |

---

## 2. 예시 스키마 비평 (유지)

1차 초안의 컬럼별 비평은 대부분 유효합니다. 이번 개정에서 바뀐 판단만 다시 적습니다.

| 컬럼 | 1차 판단 | 최종 판단 |
|---|---|---|
| `storage_path` | generated column | **일반 컬럼 + CHECK** (6장 근거) |
| `channel_id` | nullable, `on delete set null`, FK만 | 동일 + **소유권 검증은 생성 RPC 안에서**(별도 composite FK/트리거 불필요, 8장) |
| (신규) `run_token` | — | fencing token, 5장 |
| (신규) `execution_id` | — | 사용자 노출 메시지와 내부 로그 분리, 10장/12-7 |
| (신규) `storage_deleted_at` | — | cleanup 추적, 6장 |

---

## 3. 최종 제안 스키마

```sql
create table if not exists public.video_analyses (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  channel_id          uuid references public.channels(id) on delete set null,

  genre               text not null,

  -- 결정적 경로. GENERATED 컬럼이 아니라 일반 컬럼 + CHECK로 구현한 이유는 6-1장 참고.
  -- 값 자체는 create_video_analysis() RPC 안에서만 채워짐(7-2장) — 클라이언트가
  -- 직접 이 값을 지정하는 경로는 애초에 존재하지 않음.
  storage_path        text not null,

  status              text not null default 'pending',
  current_stage       text,     -- 의도적으로 CHECK 없음 (STEP 4-0 결과 반영, 1차 research 문서 7장)
  progress            smallint,

  duration_sec        numeric(10, 2),
  file_size_bytes     bigint,

  raw_metrics         jsonb,
  report              jsonb,

  error_code          text,
  error_message       text,     -- 정제된 메시지만 (10장)
  execution_id        text,     -- Cloud Run Job 실행 ID, Cloud Logging 상호참조용 (10장)

  pipeline_version    text not null default 'v1',

  -- processing 진입 횟수(재시도 상한)와, 매 진입마다 새로 발급되는 fencing token
  -- (오래된/좀비 실행이 새 실행의 결과를 덮어쓰지 못하게 막음, 5장).
  attempt_count       integer not null default 0,
  run_token           uuid,

  -- 분석 생성 요청의 멱등 키. 사용자별로만 유일하면 충분 (5-1장).
  client_request_id   uuid,

  -- 원본 파일이 실제로 remove()로 삭제 완료된 시각 (6-2장).
  storage_deleted_at  timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  started_at          timestamptz,
  finished_at         timestamptz,

  constraint video_analyses_genre_check
    check (genre in ('game', 'story', 'info')),

  constraint video_analyses_status_check
    check (status in ('pending', 'uploaded', 'queued', 'processing',
                       'completed', 'failed', 'cancelled')),

  constraint video_analyses_storage_path_check
    check (storage_path = user_id::text || '/' || id::text || '/original.mp4'),

  constraint video_analyses_progress_check
    check (progress is null or progress between 0 and 100),

  constraint video_analyses_duration_check
    check (duration_sec is null or duration_sec >= 0),

  constraint video_analyses_file_size_check
    check (file_size_bytes is null or file_size_bytes > 0),

  constraint video_analyses_error_code_check
    check (error_code is null or error_code in
      ('upload_failed', 'unsupported_format', 'processing_timeout',
       'pipeline_error', 'internal_error')),

  constraint video_analyses_attempt_count_check
    check (attempt_count >= 0),

  constraint video_analyses_finished_after_started_check
    check (started_at is null or finished_at is null or finished_at >= started_at),

  constraint video_analyses_completed_has_report_check
    check (status <> 'completed' or report is not null),

  constraint video_analyses_failed_has_error_code_check
    check (status <> 'failed' or error_code is not null)
);
```

`raw_metrics`/`report`의 버저닝 형태는 8장, `current_stage`에 CHECK가 없는 이유는 위 주석대로 STEP 4-0 결과(research 문서 7장) 반영입니다.

---

## 4. 상태 머신

7개 상태를 유지합니다. `launching`이라는 8번째 상태를 검토했으나 추가하지 않았습니다 — launcher가 `queued→processing` 전이 시점에 새 `run_token`을 발급해 "이 실행이 현재 유효한 실행권을 쥐고 있다"는 사실을 상태 값이 아니라 `run_token` 값으로 표현하기 때문입니다. 상태를 늘리지 않고도 5장의 idempotency 요구를 충족합니다. `pending`도 "업로드 대기 중"이라는 의미가 이미 명확해 `awaiting_upload`로 바꾸지 않았습니다.

| 상태 | 누가 바꾸는가 | 허용되는 이전 상태 | 설정되는 timestamp/컬럼 | retry 가능? |
|---|---|---|---|---|
| `pending` | 서버(RPC `create_video_analysis`, `authenticated` 세션으로 호출) | (초기 생성) | `created_at` | 해당 없음 |
| `uploaded` | 사용자(RPC `mark_video_analysis_uploaded`) | `pending` | `file_size_bytes` (Storage 메타데이터에서) | 같은 상태 재호출은 멱등하게 no-op |
| `cancelled` | 사용자(RPC `cancel_video_analysis`) | `pending`, `uploaded`, `queued` | — | 아니오(종결 상태) |
| `queued` | 서버(신뢰된 컨텍스트, Cloud Tasks 큐잉 성공 후) | `uploaded` | — | 해당 없음 |
| `processing` | **launcher**(service_role, CAS) | `queued` | `started_at`, `run_token`(재발급), `attempt_count`(+1) | 예 — stale-lock 회수로 `queued`로 되돌아간 뒤 재시도 |
| `completed` | **worker**(service_role, `run_token` 일치 조건부 CAS) | `processing` | `finished_at`, `report`, `progress=100` | 아니오(종결 상태) |
| `failed` | **worker**(service_role, `run_token` 일치 조건부 CAS) 또는 stale-lock 회수 작업 | `processing`, `queued`(launcher 자체 실패 시) | `finished_at`, `error_code`, `error_message` | `error_code`로 재시도 가능/불가능 구분 |

"launcher"와 "worker"는 둘 다 `service_role`을 쓰는 신뢰된 서버 컨텍스트이지만, **DB 관점에서는 서로 다른 실행 단위**로 구분합니다 — launcher는 Job을 시작하기 *직전*의 얇은 서비스, worker는 Job 컨테이너 자체입니다. 이 구분이 5장의 핵심입니다.

---

## 5. Idempotency / 중복 실행 방지 설계 — 계층별

한 줄 CAS로는 부족하다는 지적이 맞습니다. 실제 흐름(`업로드 → row 생성 → Cloud Tasks → launcher → Cloud Run Job → worker`) 각 구간마다 별도의 방어가 필요합니다. 아래 4계층은 **각자 독립적으로 유효**하며, 어느 하나가 뚫려도 다음 계층이 막습니다.

### 5-1. A. 분석 생성 (row 자체의 중복 생성 방지)

`client_request_id`(클라이언트가 "분석 시작" 버튼을 누르는 순간 1회 생성, 재시도 시 재사용)에 **사용자별** 유니크 제약을 겁니다. 전역 유니크가 아니라 `(user_id, client_request_id)`로 스코프한 이유는, 클라이언트가 uuid를 생성하는 방식이라 전역 충돌 가능성은 사실상 없지만, 그래도 "내 재시도 키가 남의 것과 우연히 겹쳐 내 생성 요청이 실패하는" 시나리오 자체를 원천적으로 없애기 위함입니다.

```sql
create unique index if not exists video_analyses_user_client_request_key
  on public.video_analyses (user_id, client_request_id)
  where client_request_id is not null;
```

생성 자체를 RPC로 일원화합니다(7-2장). 같은 `client_request_id`로 재호출되면 새로 만들지 않고 기존 행을 그대로 반환합니다 — `lib/actions/onboarding.ts`의 upsert-by-lookup 패턴과 동일한 원리입니다.

### 5-2. B. Enqueue / Launcher — Job이 실제로 두 번 시작되는 것을 막음

**여기가 1차 초안에서 가장 부족했던 지점입니다.** Cloud Tasks가 launcher를 거의 동시에 두 번 호출하면, worker 내부에서만 CAS를 하는 설계로는 **두 Job이 모두 시작되어 버린 뒤**에야 한쪽이 걸러집니다. 이미 시작된 쪽은 FFmpeg 실행, STT/OCR/LLM 호출 등 **과금이 발생하는 작업까지 진행했을 수 있습니다.**

그래서 실행권 획득을 **launcher가 Job을 시작하기 직전**으로 앞당깁니다:

```sql
-- launcher가 Cloud Run Admin API의 jobs.run()을 호출하기 *전에* 실행 (service_role)
update public.video_analyses
set status = 'processing',
    started_at = now(),
    run_token = gen_random_uuid(),
    attempt_count = attempt_count + 1
where id = $1
  and status = 'queued'
returning run_token;
```

- 영향받은 행이 **1개면** 이 launcher 인스턴스가 실행권을 획득한 것 — 반환된 `run_token`을 Cloud Run Job 실행 인자(컨테이너 환경변수 오버라이드)로 넘기고 `jobs.run()`을 호출합니다.
- 영향받은 행이 **0개면** 이미 다른 launcher 호출이 실행권을 가져간 것 — **이 launcher는 `jobs.run()`을 아예 호출하지 않고 즉시 종료합니다.** Job 자체가 중복 시작되는 것을 여기서 막는 것이 핵심입니다.

`run_token`을 매번 새로 발급하는 이유는 C에서 설명합니다. `queued`라는 상태 이름 하나를 CAS 조건으로 재사용하므로 별도의 "launching" 상태가 필요 없습니다(4장).

이중 안전장치로, Cloud Tasks 자체의 결정적 task 이름(`video-{id}`)도 큐 레벨에서 완전 중복 enqueue를 줄여줄 수 있지만, 이건 보조 수단입니다. Cloud Tasks의 정확한 dedup 윈도우는 GCP 쪽 사양이라 이 문서가 값을 보증하지 않습니다 — **진짜 보장은 위 DB CAS입니다.**

### 5-3. C. Worker — 오래된/좀비 실행이 결과를 덮어쓰지 못하게

Worker(Cloud Run Job 컨테이너)는 시작 시 `analysis_id`와 `run_token`을 실행 인자로 받습니다. **결과를 쓰는 모든 UPDATE에 `run_token` 일치 조건을 포함시킵니다**:

```sql
-- 진행 중 갱신
update public.video_analyses
set current_stage = $2, progress = $3
where id = $1 and run_token = $4 and status = 'processing';

-- 완료
update public.video_analyses
set status = 'completed', report = $2, progress = 100, finished_at = now()
where id = $1 and run_token = $3 and status = 'processing'
returning *;

-- 실패
update public.video_analyses
set status = 'failed', error_code = $2, error_message = $3,
    execution_id = $4, finished_at = now()
where id = $1 and run_token = $5 and status = 'processing'
returning *;
```

영향받은 행이 0개라는 것은 "그사이 stale-lock 회수 작업이 이 행을 이미 `queued`나 `failed`로 되돌렸고, 어쩌면 새 실행(새 `run_token`)이 이미 시작됐다"는 뜻입니다 — 즉 **이 worker는 이제 좀비 실행이므로 자신의 결과를 버리고 조용히 종료해야 합니다.** 이전 실행이 뒤늦게 완료되어 최신 실행의 결과를 덮어쓰는 사고를 막는 것이 `run_token`의 목적입니다(요청하신 "오래된 retry나 이전 실행이 완료된 결과를 덮어쓰지 못하게").

**중요한 실무 지침**: worker는 이 확인을 최종 결과를 쓸 때만 하지 말고, **STT/OCR/LLM처럼 과금이 발생하는 외부 API를 호출하기 직전마다** 가볍게 `select run_token from video_analyses where id=$1`로 재확인하는 것을 권장합니다. 이미 좀비가 된 실행이 몇 분째 계속 도는 동안 불필요한 유료 API를 계속 호출하는 것을 조기에 막기 위함입니다.

이 설계는 "필요 이상의 분산락 시스템"이 아니라 **컬럼 하나(uuid)와 WHERE 절 조건**입니다 — 별도의 락 서비스나 분산 합의 시스템을 도입하지 않았습니다.

### 5-4. Stale-lock 회수 (worker가 죽어서 영원히 `processing`인 경우)

```sql
-- 주기적 실행 (pg_cron 또는 별도 스케줄러, service_role)
update public.video_analyses
set status = case when attempt_count >= 3 then 'failed' else 'queued' end,
    error_code = case when attempt_count >= 3 then 'processing_timeout' else null end,
    error_message = case when attempt_count >= 3
                          then '반복된 처리 시간 초과로 재시도를 중단했습니다.' else null end,
    current_stage = null,
    run_token = null
where status = 'processing'
  and started_at < now() - interval '30 minutes' -- 잠정값, STEP 4-0 처리시간 실측 후 조정
returning id, status;
```

`queued`로 되돌아간 행은 다음 Cloud Tasks 재시도(또는 별도 재큐잉 로직)가 다시 5-2의 launcher CAS를 거쳐 **새 `run_token`으로** 처리를 재개합니다. 이 시점에 이전 실행이 뒤늦게 응답해도 5-3의 `run_token` 불일치로 걸러집니다 — 4계층이 서로 맞물리는 지점입니다.

### 5-5. D. Billing (이번 STEP에서 구현하지 않음, 설계상 막히지 않는지만 확인)

미래의 사용량 차감(billing)은 **5-3의 완료 CAS(`processing→completed`)가 정확히 한 번만 성공한다는 사실**에 편승시키는 것을 권장합니다 — 예를 들어 향후 billing 이벤트를 이 완료 UPDATE와 **같은 트랜잭션** 안에서, `analysis_id`에 대한 유니크 제약을 가진 별도 테이블(또는 `video_analyses`에 `billed boolean not null default false` 컬럼)에 기록하면, "정확히 한 번 완료"와 "정확히 한 번 과금"이 같은 원자성 경계를 공유하게 됩니다. 이번 STEP은 이 컬럼/테이블을 만들지 않지만, 위 설계가 이런 확장을 막지 않는다는 것은 확인했습니다.

---

## 6. Storage 설계

### 6-1. `storage_path`를 generated column에서 일반 컬럼 + CHECK로 변경

1차 초안에서 generated column을 제안했던 이유(클라이언트가 임의 경로를 지정 못하게)는 여전히 유효한 목표지만, 수단을 바꿉니다.

| | GENERATED 컬럼 (1차) | 일반 컬럼 + CHECK (이번 개정) |
|---|---|---|
| 임의 경로 지정 방지 | O (컬럼 자체가 insert 대상에서 빠짐) | O (CHECK가 값의 형태를 강제) |
| 나중에 규칙을 바꾸는 비용 | Postgres는 GENERATED 컬럼의 계산식을 `ALTER`로 못 바꿈 — 컬럼을 드롭하고 재생성해야 함(파괴적) | `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ...`로 제약만 교체 (일반적인 마이그레이션) |
| proxy/thumbnail/artifact 등 추가 파일 확장 | 이 컬럼은 원본 파일 하나만 표현 — 추가 파일은 애초에 이 컬럼과 무관 | 동일 |
| 확장자가 여러 개로 늘어나는 경우 | 계산식 자체를 못 바꾸므로 사실상 컬럼 재설계 필요 | CHECK를 `storage_path = ... || '/original.' || upload_ext`처럼 바꾸고 `upload_ext` 컬럼(CHECK로 제약된 허용 목록)을 추가하는 정도로 확장 가능 |

**결론**: 보안 성격은 동일하고, 미래 변경 비용은 일반 컬럼 쪽이 명확히 낮으므로 **일반 컬럼 + CHECK로 변경**합니다.

**proxy/thumbnail/artifact 확장에 대한 확인**: 이런 부가 파일들은 `{user_id}/{id}/` 접두사 아래 `proxy.mp4`, `frames/{n}.jpg` 등으로 자유롭게 추가할 수 있고, 이를 위해 `video_analyses`에 컬럼을 추가할 필요가 없습니다. 필요하면 `report`/`raw_metrics`의 jsonb 안에서 상대 경로로 참조하면 충분합니다(8장). 즉 `storage_path` 컬럼의 역할은 "원본 파일이 어디 있는지"로 한정되고, 이 스코프 한정이 확장성을 막지 않습니다.

**V1 범위 한정**: 업로드는 `video/mp4`만 허용, 파일명은 항상 `original.mp4`로 고정합니다. 실제 상한(최대 길이/바이트)은 제품 결정이 필요하며 이 문서가 확정하지 않습니다.

### 6-2. 삭제 — 세 가지 경우와 계정 삭제 시 orphan 문제

**요청하신 핵심 우려에 대한 답**: `user_id`가 `on delete cascade`이므로 계정이 삭제되면 `public.video_analyses` 행은 즉시, 되돌릴 수 없이 사라집니다. **하지만 이것이 orphan 파일을 발견 못 하게 만들지는 않습니다** — 실제 파일의 경로 정보는 `public.video_analyses.storage_path`가 아니라 **`storage.objects.name`(Supabase가 관리하는 시스템 테이블)에도 독립적으로 존재**하기 때문입니다. `storage.objects`는 `public.video_analyses`를 참조하는 FK가 없고, 우리 테이블이 사라진다고 같이 사라지지 않습니다. 즉 **정리 작업이 `public.video_analyses`가 아니라 `storage.objects`를 기준으로 스캔하면, DB 행이 이미 사라졌어도 파일을 찾아낼 수 있습니다.**

이 사실을 바탕으로 세 경우를 하나의 메커니즘으로 통합하되, 빈도를 다르게 둡니다(효율과 완전성을 함께 잡기 위함).

**공통 원칙**: 어떤 경우든 실제 삭제는 **cron/스케줄러 → Edge Function(service_role) → `supabase.storage.from('videos').remove([path])`** 형태로만 이뤄집니다. `storage.objects`에 대한 직접 SQL DELETE는 어떤 경로에서도 사용하지 않습니다. `storage.objects`를 **읽는 것**(SELECT)은 일반 SQL로 해도 무방합니다 — 금지되는 것은 DELETE뿐입니다.

**경우 1. 분석 성공 후 보관기간(retention) 만료** — 고빈도(예: 매일), DB 쿼리 기반, 버킷 스캔 불필요:
```sql
select id, storage_path from public.video_analyses
where status = 'completed'
  and storage_deleted_at is null
  and finished_at < now() - interval 'N days'; -- N은 개인정보 처리방침과 함께 별도 결정
```
Edge Function이 각 행에 대해 `remove([storage_path])` 호출 → 성공 시 `update video_analyses set storage_deleted_at = now() where id = $1`.

**경우 2. 분석 실패 후 cleanup** — 위와 동일 쿼리, `status='failed'`, 더 짧은 보관기간.

**경우 3. 사용자 계정 삭제** — 저빈도(예: 매주) **백스톱 전용**, `storage.objects`를 직접 스캔:
```sql
-- Edge Function 내부에서 읽기 전용으로 조회 (service_role)
select name from storage.objects where bucket_id = 'videos';
```
각 오브젝트 경로 `{user_id}/{analysis_id}/original.mp4`에서 `{analysis_id}`를 파싱해 `public.video_analyses`에 해당 id가 있는지 확인 → **없으면**(계정 삭제로 cascade됐거나, 사용자가 종결 상태 행을 직접 삭제한 경우) `remove()` 호출.

이 경우 3은 경우 1·2를 놓쳤을 때의 백스톱 역할도 겸하므로, 별도의 "삭제 대기열" 테이블 없이도 세 경우 전부를 커버합니다. `delete_after` 컬럼은 추가하지 않았습니다 — 보관 기간 N이 아직 확정되지 않은 상태에서 행마다 만료 시각을 미리 못박는 것보다, 쿼리 시점에 `finished_at + N일`로 계산하는 편이 정책 변경에 더 유연하기 때문입니다. 대신 `storage_deleted_at` 하나만 추가해, 경우 1·2를 버킷 스캔 없이 효율적인 DB 쿼리로 처리할 수 있게 했습니다(요청하신 "최소한의 필드만 도입" 원칙에 맞춰 3개 후보 중 1개만 채택).

정확한 Storage `list()` API의 페이지네이션 한도 등 구현 세부사항은 이 STEP의 범위가 아니므로, 실제 구현 시 Supabase 공식 문서로 재확인이 필요합니다.

### 6-3. Storage RLS — TUS 업로드에 필요한 최소 권한

```sql
-- INSERT: 본인 폴더에만 (업로드 시작)
create policy "video_objects_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- UPDATE: 본인 폴더 + 해당 오브젝트에 대응하는 video_analyses 행이 'pending'인 동안만.
-- TUS 재개형 업로드는 업로드 도중 오브젝트 메타데이터가 여러 번 갱신되므로
-- 일반적으로 INSERT뿐 아니라 UPDATE 권한도 필요합니다(정확한 요구사항은 STEP 4-2
-- 구현 시 Supabase 공식 resumable upload 문서로 재확인 필요 — 이번 STEP에서 확정하지 않음).
-- status가 'pending'을 벗어나면(=mark_video_analysis_uploaded가 업로드 완료를
-- 확인한 뒤) 더 이상 같은 경로를 덮어쓸 수 없게 만들어, "업로드 완료 확인 후
-- 내용을 몰래 바꿔치기"하는 경로를 차단합니다.
create policy "video_objects_update_own_while_pending"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.video_analyses va
      where va.storage_path = storage.objects.name
        and va.user_id = (select auth.uid())
        and va.status = 'pending'
    )
  );

-- SELECT: 만들지 않음. V1은 원본 영상 재생/미리보기 UI가 없음(1차 문서 5장과 동일).
-- DELETE: authenticated에게 절대 부여하지 않음. 사용자가 진행 중이거나 완료된
-- 파일을 Storage API로 직접 지워 video_analyses 상태와 어긋나는 것을 원천 차단.
-- 삭제는 항상 service_role + remove()로만 (6-2장).
```

### 6-4. 백엔드 읽기

Cloud Run Job은 `service_role` 키로 읽습니다(RLS 우회). 이 프로젝트에 `service_role` 사용 전례가 없으므로(research 문서 3장), 새 서버 전용 클라이언트 파일과 환경변수를 새로 설계해야 하며 `NEXT_PUBLIC_` 접두사를 절대 붙이지 않습니다.

---

## 7. RLS 정책 및 RPC 함수

### 7-1. 왜 기존 "소유자면 전권한" 패턴을 그대로 쓰면 안 되는가 (유지)

`channels` 등 기존 테이블과 달리 `video_analyses.status`/`report`/`raw_metrics`는 사용자가 아니라 신뢰된 백엔드만 채워야 합니다. 이번 개정에서는 여기서 한 걸음 더 나가, **INSERT조차 일반 정책으로 열어두지 않고 RPC로 일원화**합니다(7-2, 8장 근거).

### 7-2. RPC 3개

**① `create_video_analysis`** — 유일한 생성 경로. `client_request_id` 멱등 처리, `channel_id` 소유권 확인, `storage_path` 계산을 모두 이 함수 하나가 담당합니다.

```sql
create or replace function public.create_video_analysis(
  p_genre text,
  p_channel_id uuid default null,
  p_client_request_id uuid default null
)
returns public.video_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_row     public.video_analyses;
  v_id      uuid;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  -- 멱등 생성: 같은 client_request_id로 이미 만든 행이 있으면 그대로 반환
  if p_client_request_id is not null then
    select * into v_row
    from public.video_analyses
    where user_id = v_user_id
      and client_request_id = p_client_request_id;

    if found then
      return v_row;
    end if;
  end if;

  -- channel_id 소유권 확인 (다른 사용자의 채널을 연결하지 못하게, 8장)
  if p_channel_id is not null and not exists (
    select 1 from public.channels
    where id = p_channel_id and user_id = v_user_id
  ) then
    raise exception 'channel not found or not owned by caller';
  end if;

  v_id := gen_random_uuid();

  insert into public.video_analyses (id, user_id, channel_id, genre,
                                      storage_path, client_request_id)
  values (
    v_id, v_user_id, p_channel_id, p_genre,
    v_user_id::text || '/' || v_id::text || '/original.mp4',
    p_client_request_id
  )
  returning * into v_row;

  return v_row;
end;
$$;
```

**② `mark_video_analysis_uploaded`** — 업로드 완료 확인. 소유권만이 아니라 **Storage에 실제로 파일이 존재하는지, 크기가 얼마인지**까지 확인 후 `file_size_bytes`를 채웁니다. MIME/코덱의 최종 검증은 하지 않습니다(요청하신 대로 — Postgres 함수 안에서 미디어를 직접 분석하지 않으며, 그 검증은 이후 FFmpeg 파이프라인의 몫입니다).

```sql
create or replace function public.mark_video_analysis_uploaded(p_id uuid)
returns public.video_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.video_analyses;
  v_object record;
begin
  -- 행을 잠그고 소유권 + 현재 상태 확인 (동시 호출 레이스 방지)
  select * into v_row
  from public.video_analyses
  where id = p_id
    and user_id = (select auth.uid())
    and status = 'pending'
  for update;

  if not found then
    return null; -- 소유가 아니거나 이미 전이됨 — 멱등하게 null 반환, 에러 아님
  end if;

  -- 클라이언트 주장이 아니라 Storage가 기록한 사실을 확인.
  -- mimetype 확인은 저비용 sanity check일 뿐 보안 경계가 아님(9-8장) —
  -- Storage의 metadata.mimetype은 업로드 시 클라이언트가 보낸 Content-Type을
  -- 그대로 반영하므로 스푸핑 가능. 진짜 검증은 여전히 Cloud Run Job의 ffprobe.
  select * into v_object
  from storage.objects
  where bucket_id = 'videos' and name = v_row.storage_path;

  if not found then
    return null; -- 업로드가 실제로 끝나지 않음
  end if;

  update public.video_analyses
  set status = 'uploaded',
      file_size_bytes = (v_object.metadata ->> 'size')::bigint
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;
```

**③ `cancel_video_analysis`** — 1차 초안과 동일.

```sql
create or replace function public.cancel_video_analysis(p_id uuid)
returns public.video_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.video_analyses;
begin
  update public.video_analyses
  set status = 'cancelled'
  where id = p_id
    and user_id = (select auth.uid())
    and status in ('pending', 'uploaded', 'queued')
  returning * into v_row;

  return v_row;
end;
$$;
```

**세 함수 공통 하드닝 체크리스트** (요청하신 항목 그대로):
- `security definer` — 함수 소유자 권한으로 실행
- `set search_path = ''` — 스키마 이름을 항상 명시하도록 강제(기존 `handle_new_user()`와 동일한 관례)
- 호출자 인증 검사 — 세 함수 모두 내부에서 `(select auth.uid())`로 소유권을 다시 확인하므로, **사용자가 PostgREST로 직접 호출해도** 자기 소유가 아닌 행을 건드릴 수 없음
- EXECUTE 권한은 `authenticated`에만, `anon`에는 명시적으로 `revoke`(7-4장)

### 7-3. 테이블 RLS 정책

생성이 RPC로 일원화되므로(security definer는 호출자 RLS를 우회) **일반 INSERT 정책은 아예 만들지 않습니다.** UPDATE 정책도 여전히 없습니다(업로드완료/취소는 RPC, 나머지는 `service_role`).

```sql
alter table public.video_analyses enable row level security;

drop policy if exists "video_analyses_select_own" on public.video_analyses;
create policy "video_analyses_select_own"
  on public.video_analyses for select to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "video_analyses_delete_own_terminal" on public.video_analyses;
create policy "video_analyses_delete_own_terminal"
  on public.video_analyses for delete to authenticated
  using ( (select auth.uid()) = user_id
          and status in ('completed', 'failed', 'cancelled') );
```

`pending`/`uploaded`/`queued`/`processing` 상태의 행을 삭제하지 못하게 막는 이유: 이미 Cloud Tasks에 큐잉됐거나 Job이 실행 중인 행이 사라지면 워커가 결과를 쓰려 할 때 행이 없어 에러가 나거나, id가 재사용될 경우 결과가 엉뚱하게 섞일 위험이 있습니다.

### 7-4. Grants

```sql
grant usage on schema public to authenticated;

revoke all on table public.video_analyses from authenticated;
grant select, delete on table public.video_analyses to authenticated;
revoke all on table public.video_analyses from anon;

grant execute on function public.create_video_analysis(text, uuid, uuid) to authenticated;
grant execute on function public.mark_video_analysis_uploaded(uuid) to authenticated;
grant execute on function public.cancel_video_analysis(uuid) to authenticated;

revoke execute on function public.create_video_analysis(text, uuid, uuid) from anon;
revoke execute on function public.mark_video_analysis_uploaded(uuid) from anon;
revoke execute on function public.cancel_video_analysis(uuid) from anon;
```

---

## 8. `channel_id` 소유권 확인 — 왜 composite FK나 트리거가 필요 없는가

검토한 세 가지 방법:

| 방법 | 내용 | 판단 |
|---|---|---|
| composite FK | `channels`에 `unique(id, user_id)` 추가 후 `foreign key (channel_id, user_id) references channels(id, user_id)` | 컬럼 단위 `on delete set null`은 Postgres 15+에서만 지원되는 문법이라 실제 배포된 Postgres 버전 확인이 선행돼야 함(이번 STEP에서 확인 안 됨) — 불필요하게 버전 의존적 |
| BEFORE INSERT/UPDATE 트리거 | 매 insert/update마다 `channels.user_id` 대조 | 동작은 하지만, **이 테이블에 UPDATE 경로 자체가 없다면** 상시 검사할 대상이 없음 |
| **생성 RPC 안에서 1회 확인** | 7-2장의 `create_video_analysis` | **채택** |

**근거**: 7-3장에서 이미 `video_analyses`에 대한 일반 UPDATE 정책을 만들지 않기로 했고, 두 RPC(`mark_video_analysis_uploaded`, `cancel_video_analysis`)도 `channel_id`를 건드리지 않습니다. 즉 **이 스키마에서 `channel_id`는 생성 시점 이후 절대 바뀌지 않습니다.** 따라서 "생성되는 그 순간에만" 소유권을 확인하면 충분하고, 상시 트리거나 composite FK 같은 더 무거운 장치는 불필요합니다. 이것이 "가장 단순하고 안전한 방법"이라고 판단한 근거입니다. 만약 나중에 `channel_id`를 변경하는 기능이 추가된다면, 그 변경 경로(새 RPC든 무엇이든)에도 동일한 소유권 확인을 반드시 넣어야 합니다.

---

## 9. JSONB 버저닝 — `pipeline_version`과 `schema_version`의 관계

두 값은 서로 다른 것을 가리키며 독립적으로 바뀔 수 있습니다.

| | 무엇을 가리키는가 | 어디 저장되는가 | 바뀌는 시점 |
|---|---|---|---|
| `pipeline_version` (컬럼) | 이 분석에 사용된 **전체 파이프라인/알고리즘 조합**이 무엇인지(굵은 단위) | `video_analyses.pipeline_version` | 채택된 신호/알고리즘 구성이 바뀔 때(STEP 4-0의 채택/제외 판정이 갱신될 때) |
| `raw_metrics.schema_version` / `report.schema_version` (jsonb 내부) | 그 jsonb **문서의 구조(형태)**가 무엇인지(가는 단위) | jsonb 값 자체 | 같은 파이프라인이라도 저장 형식(키 이름, 중첩 구조)이 바뀔 때 |
| `raw_metrics.signals.<name>.schema_version` (jsonb 내부, 신호별) | **개별 신호 하나**의 구조 | jsonb 값 자체 | 그 신호 하나만 바뀔 때(다른 신호나 파이프라인 전체에 영향 없음) |

예: `pipeline_version`은 그대로 `'v1'`인데 `report`에 필드 하나를 추가하는 구조 변경이 있으면 `report.schema_version`만 오릅니다. 반대로 STEP 4-0에서 제외된 `tile_max_diff`를 완전히 빼고 새 신호를 추가하는 알고리즘 교체가 있으면 `pipeline_version`이 `'v2'`로 오릅니다.

**STEP 4-0 결과를 반영한 원칙**: 이 문서/애플리케이션 어디에도 `whole_frame_diff`, `tile_max_diff` 같은 **특정 신호 이름을 DB 컬럼이나 CHECK 제약으로 고정하지 않습니다.** 신호 목록은 전적으로 jsonb 내부의 데이터이며, 제외된 신호는 그냥 앞으로 안 쓰면 됩니다. **읽는 쪽(애플리케이션)은 알려지지 않았거나 없는 키를 항상 "값 없음"으로 처리해야 하며 에러를 던지면 안 됩니다** — 이렇게 해야 신호 추가/제외가 스키마 마이그레이션 없이(additive) 가능하고, `schema_version`은 실제로 호환이 깨지는 **구조적** 변경(키 이름 변경, 타입 변경)에만 올립니다.

---

## 10. 개인정보/에러 정보 — 금지 목록과 분리 원칙

`error_message`, `raw_metrics`, `report` 어디에도 다음을 저장하지 않습니다:

- `service_role` 키, API 키, 어떤 형태의 provider secret
- signed URL 전체(발급하더라도 URL 문자열 자체를 로그성 필드에 남기지 않음)
- 스택트레이스, 내부 파일시스템 경로
- 사용자 영상의 불필요한 원문 데이터(예: STT 전체 원문, 프레임 원본 이미지 base64) — `report`는 **사용자에게 보여줄 관찰/요약**만 담고, 대용량 1차 원시 데이터는 필요하면 Storage에 별도로 두고 경로만 참조

**사용자 노출 정보와 내부 observability 로그를 분리**하기 위해 `execution_id`(Cloud Run Job 실행 ID) 컬럼을 추가했습니다(3장). `error_message`는 항상 정제된 한두 문장만 담고, 실제 예외/스택트레이스는 Cloud Logging에만 남긴 뒤 필요하면 `execution_id`로 상호 참조합니다.

**왜 DB CHECK로 이 목록을 강제하지 않는가**: jsonb/text 컬럼에 "시크릿처럼 보이는 패턴이 없는가"를 정규식 CHECK로 검사하는 것은 오탐/누락이 잦아 신뢰할 수 없는 방어입니다(예: 시크릿이 아닌데 우연히 패턴에 걸리거나, 정말 시크릿인데 패턴을 피해감). 그래서 이 목록은 **애플리케이션 레이어의 규율**로 강제합니다 — `report`를 만드는 코드가 **허용된 필드만 담는 명시적 Zod 스키마**(화이트리스트, `plan-v1-revised.md`에 이미 명시된 방향과 일치)를 통과해야만 저장하고, 임의 필드를 그대로 통과시키는 permissive 스키마를 쓰지 않는 것이 실질적 방어입니다.

---

## 11. DB constraint 설계 원칙 — 무엇을 DB가 강제하고, 무엇을 애플리케이션이 담당하는가

**DB(CHECK)가 강제하는 것 — 파이프라인/알고리즘이 바뀌어도 항상 참이어야 하는 구조적 불변식**:

| 제약 | 왜 DB 레벨인가 |
|---|---|
| `progress between 0 and 100` | 값의 범위 자체가 절대적 |
| `duration_sec >= 0` | 음수 길이는 항상 버그 |
| `file_size_bytes > 0` | 0 이하 크기는 항상 버그 |
| `genre in (...)` | 안정적인 열거값(기존 컨벤션) |
| `status in (...)` | 시스템 정합성의 핵심, 안정적 |
| `storage_path = ...` | 보안 불변식(9-1장) |
| `finished_at >= started_at` | 시간 순서는 항상 참이어야 함 |
| `status='completed' → report is not null` | "완료인데 결과 없음"은 항상 애플리케이션 버그 |
| `status='failed' → error_code is not null` | "실패인데 원인 코드 없음"은 항상 애플리케이션 버그 |

**애플리케이션(Zod/코드)이 담당하는 것 — 알고리즘/제품 요구사항에 따라 바뀔 수 있는 것**:

- `current_stage`의 허용 값 목록(파이프라인 내부 기술 명칭, 계속 바뀜)
- `raw_metrics`/`report`의 내부 구조(STEP 4-0 결과에 따라 신호가 추가/제외됨, 9장)
- `error_message`의 내용 규율(10장)
- Storage에 실제 파일이 존재하는지, MIME/코덱이 유효한지(Postgres CHECK는 다른 테이블/외부 API를 참조하는 검증을 표현할 수 없음 — 오직 같은 행의 컬럼 값만으로 판단 가능한 immutable 표현식만 허용되는 Postgres의 구조적 한계이기도 함. 그래서 Storage 존재 확인은 7-2장처럼 함수 안의 절차적 코드로 처리)
- `channel_id` 소유권(8장 — RPC에서 1회 확인, 상시 제약이 아님)

---

## 12. 인덱스

```sql
create index if not exists video_analyses_user_created_idx
  on public.video_analyses (user_id, created_at desc);

create index if not exists video_analyses_user_status_idx
  on public.video_analyses (user_id, status);

create index if not exists video_analyses_channel_id_idx
  on public.video_analyses (channel_id)
  where channel_id is not null;

create unique index if not exists video_analyses_user_client_request_key
  on public.video_analyses (user_id, client_request_id)
  where client_request_id is not null;

-- stale-lock 회수 작업이 매번 스캔하는 대상 (5-4장)
create index if not exists video_analyses_processing_started_idx
  on public.video_analyses (started_at)
  where status = 'processing';

-- 보관기간 만료 cleanup 쿼리가 스캔하는 대상 (6-2장)
create index if not exists video_analyses_pending_cleanup_idx
  on public.video_analyses (status, finished_at)
  where storage_deleted_at is null and status in ('completed', 'failed');
```

---

## 13. `updated_at` 트리거

새 함수를 만들지 않고 기존 `public.set_updated_at()`을 재사용합니다.

```sql
drop trigger if exists set_updated_at on public.video_analyses;
create trigger set_updated_at
  before update on public.video_analyses
  for each row execute function public.set_updated_at();
```

---

## 14. 마이그레이션/롤백 계획

### 14-1. 새로 만드는 객체

- 테이블: `public.video_analyses` (3장)
- 함수: `create_video_analysis`, `mark_video_analysis_uploaded`, `cancel_video_analysis` (7-2장)
- 트리거: `video_analyses`에 대한 `set_updated_at` (기존 함수 재사용)
- 인덱스: 6개 (12장)
- RLS 정책: `video_analyses`에 2개(select/delete) + `storage.objects`에 2개(insert/update) (7-3, 6-3장)
- Grants: `video_analyses` 테이블(select/delete) + 3개 함수(execute) (7-4장)

### 14-2. 기존 객체 변경

없음. 기존 6개 테이블, 기존 함수(`handle_new_user`, `set_updated_at`), 기존 RLS 정책 중 어느 것도 수정하지 않습니다. `channels`가 새로 참조되지만(FK) `channels` 자체 정의는 무변경입니다.

### 14-3. 파일 구성 (제안, 기존 번호 체계 연장)

```
supabase/migrations/
  0005_video_analyses_table.sql        -- 3장 테이블 정의
  0006_video_analyses_functions.sql    -- 7-2장 RPC 3개
  0007_video_analyses_rls.sql          -- 7-3장(테이블) + 6-3장(storage.objects) RLS
  0008_video_analyses_triggers_indexes.sql -- 12, 13장
  0009_video_analyses_grants.sql       -- 7-4장
```

1차 초안의 4파일 구성에서 "함수" 파일이 하나 늘었습니다 — 함수가 RLS보다 먼저 존재해야 grants가 의미를 가지므로, 순서는 `테이블 → 함수 → RLS → 트리거/인덱스 → grants`입니다. Storage 버킷 생성/`storage.objects` RLS는 기존 4개 마이그레이션이 `storage` 스키마를 건드린 적이 없으므로, 별도 관리하되 STEP 4-2(업로드 UI) 시점에 함께 정리하는 것을 제안합니다(0007에 초안만 포함).

### 14-4. 롤백 전략

```sql
-- 역순
drop function if exists public.cancel_video_analysis(uuid);
drop function if exists public.mark_video_analysis_uploaded(uuid);
drop function if exists public.create_video_analysis(text, uuid, uuid);
drop table if exists public.video_analyses; -- 인덱스/정책/트리거는 함께 삭제됨
```

`video_analyses`를 참조하는 기존 테이블이 없으므로(FK가 나가는 방향만 있음) 롤백이 기존 데이터에 미치는 영향은 없습니다.

### 14-5. 기존 데이터 영향

없음.

### 14-6. 적용 순서

`0005 → 0006 → 0007 → 0008 → 0009` — 함수가 RLS보다, 테이블이 함수보다 먼저 있어야 합니다.

---

## 15. 검증 방법 (실행은 이후 STEP)

1. **RLS 격리**: 서로 다른 두 계정으로 각각 행을 만들고, 상대 계정 세션으로 select/delete 시도 → 거부 확인.
2. **INSERT 위조 불가 확인**: `authenticated`로 `video_analyses`에 직접 `insert` 시도(RPC 우회) → grants 자체가 없어 권한 오류인지 확인.
3. **`create_video_analysis` 소유권 확인**: 다른 사용자의 `channel_id`를 넘겨 호출 → 예외 발생 확인.
4. **`create_video_analysis` 멱등성 확인**: 같은 `client_request_id`로 2번 호출 → 행이 1개만 생기고 같은 행이 반환되는지 확인.
5. **launcher CAS 동시성 확인**: 같은 `id`에 대해 `queued→processing` UPDATE를 동시에 2번 실행 → 정확히 1번만 영향받고 `run_token`이 1개만 발급되는지 확인.
6. **worker fencing 확인**: 임의로 `run_token`을 다른 값으로 바꾼 뒤 이전 토큰으로 완료 UPDATE 시도 → 0행 영향(거부) 확인.
7. **stale-lock 회수 확인**: `started_at`을 과거로 강제 설정 후 회수 쿼리 실행 → `queued`(또는 `attempt_count>=3`이면 `failed`)로 바뀌는지 확인.
8. **`mark_video_analysis_uploaded` 확인**: Storage에 파일을 올리지 않은 상태로 호출 → `null` 반환(전이 안 됨) 확인. 파일을 올린 뒤 호출 → `file_size_bytes`가 Storage 메타데이터와 일치하는지 확인.
9. **Storage RLS pending-scope 확인**: 업로드 완료(`status`가 `pending`을 벗어남) 후 같은 경로에 UPDATE 시도 → 거부 확인.
10. **cleanup 쿼리 확인**: `storage_deleted_at`이 null이고 `finished_at`이 보관기간을 넘은 완료 행이 정확히 조회되는지, `remove()` 후 `storage_deleted_at`이 채워지는지 확인.
11. **계정 삭제 orphan 확인**: 테스트 계정을 삭제한 뒤(`auth.users` 삭제) `storage.objects`에 해당 경로 오브젝트가 남아있는지, 백스톱 스캔이 이를 찾아 `remove()`하는지 확인.
12. **롤백 리허설**: 스테이징에서 14-4의 SQL을 실제로 실행해보고 기존 6개 테이블에 영향이 없는지 확인.
13. **타입 재생성 확인**: `npm run types` 실행 후 `lib/database.types.ts`에 `video_analyses`가 반영되는지 확인.

---

## 16. 예상 리스크 (갱신)

- **4계층 idempotency는 1차 초안보다 구현 복잡도가 높습니다.** 다만 각 계층이 독립적으로 검증 가능한 단순 SQL 조건(WHERE 절 하나)이라, 복잡도가 "분산락 시스템" 수준으로 늘어난 것은 아닙니다.
- **Storage RLS의 UPDATE 정책이 `public.video_analyses`를 서브쿼리로 참조**합니다 — 이는 일반적인 패턴이지만, `storage.objects`에 대한 쓰기마다 우리 테이블을 조회하는 추가 비용이 있습니다. TUS 업로드 중 매우 잦은 PATCH가 발생한다면 이 비용을 실측해야 합니다(이 STEP에서는 실측하지 않음).
- **TUS 재개형 업로드가 정확히 어떤 Storage RLS 동작(INSERT만/INSERT+UPDATE)을 요구하는지는 Supabase 공식 문서로 재확인이 필요한 채로 남아 있습니다** — 6-3장에 이미 명시.
- **`storage_path`를 일반 컬럼 + CHECK로 바꾼 결과, 값 자체는 여전히 `create_video_analysis` RPC 하나만 채웁니다** — 이 RPC를 우회하는 새로운 생성 경로가 미래에 실수로 추가되면 CHECK가 마지막 방어선이 됩니다(정상 동작).
- **stale-lock 타임아웃(30분)과 재시도 상한(3회)은 여전히 잠정값**입니다. 실제 처리시간 실측 후 조정 필요.
- **`service_role` 키 관리 체계는 이 STEP에서 값을 정하지 않았습니다** — Cloud Run 배포 설계 STEP의 몫.
- **`genre` CHECK 3종 고정은 기존 컨벤션을 따른 결과이며, 장르가 자주 늘어나면 재검토 필요.**

---

## 17. 이번 STEP에서 하지 않은 것 (재확인)

마이그레이션 실행, production DB 변경, Cloud Run 구현, Cloud Tasks 구현, STT/OCR 구현, 실제 영상 분석 파이프라인 구현, 결제 로직 구현, 대규모 UI 변경 — 전부 진행하지 않았습니다. 위 SQL은 전부 **제안 초안**이며, 사용자 검토 후 승인받은 뒤에만 실제 마이그레이션 파일 작성 및 적용으로 넘어갑니다.

---

## 18. 실제 migration 구현 시 확정할 최종 설계 (요약표)

| 항목 | 확정 내용 |
|---|---|
| **`video_analyses` 컬럼** | `id, user_id, channel_id, genre, storage_path, status, current_stage, progress, duration_sec, file_size_bytes, raw_metrics, report, error_code, error_message, execution_id, pipeline_version, attempt_count, run_token, client_request_id, storage_deleted_at, created_at, updated_at, started_at, finished_at` (24개, 3장) |
| **status 목록** | `pending, uploaded, queued, processing, completed, failed, cancelled` (7종, 4장) |
| **인덱스/유니크** | `(user_id, created_at desc)`, `(user_id, status)`, `(channel_id) partial`, `(user_id, client_request_id) unique partial`, `(started_at) where processing`, `(status, finished_at) where 미정리` (6개, 12장) |
| **RLS 정책 — `video_analyses`** | select(본인), delete(본인+종결상태) — insert/update 정책 없음(RPC로 대체) (7-3장) |
| **RLS 정책 — `storage.objects`** | insert(본인 폴더), update(본인 폴더+대응 행이 pending) — select/delete 없음 (6-3장) |
| **RPC/SECURITY DEFINER 함수** | `create_video_analysis`, `mark_video_analysis_uploaded`, `cancel_video_analysis` (3개, 7-2장) — 전부 `search_path=''`, 좁은 EXECUTE grant |
| **Storage bucket/path/policies** | 버킷 `videos`(private), 경로 `{user_id}/{id}/original.mp4`, V1은 `video/mp4`만 (6-1장) |
| **Idempotency 방식** | 생성(`client_request_id` unique) + launcher(`queued→processing` CAS, `run_token` 발급) + worker(`run_token` 일치 조건부 쓰기) + 회수(stale-lock, `attempt_count` 상한) — 4계층 (5장) |
| **Cleanup 방식** | `storage_deleted_at` 기반 일일 DB 쿼리(성공 retention/실패) + 저빈도 `storage.objects` 전체 스캔(계정삭제 orphan 백스톱) — 항상 Storage API `remove()`로만 (6-2장) |
| **Migration 파일** | 5개: `0005_table → 0006_functions → 0007_rls → 0008_triggers_indexes → 0009_grants` (14-3장) |

위 표가 이번 개정의 최종 설계입니다. 이 내용으로 승인해 주시면 다음 단계에서 실제 마이그레이션 파일 작성으로 넘어가겠습니다.

> **읽는 순서 참고**: 위 표는 승인 시점(구현 착수 전)의 설계입니다. 실제 구현 중 19장(RPC 3→4개, PUBLIC grant 보완, 인덱스 파일 위치)과 20장(DELETE 정책 제거, `client_request_id` race 수정, worker RPC 3개 추가로 총 7개, CHECK 11개로 정정, blocker 목록)에서 확정된 변경이 이 표보다 우선합니다. 최종 상태를 확인하려면 19장·20장·22장(blocker)을 함께 보세요.

---

## 19. 구현 단계에서 확정된 세부사항 (addendum — 승인 후 실제 SQL 작성 중 발견)

사용자 승인 후 실제 마이그레이션 SQL(`supabase/migrations/0005~0009`)을 작성하는 과정에서, 이 문서의 설계를 뒤집지 않는 범위 안에서 아래 3가지가 구체화/보완되었습니다. 임의로 바꾼 것이 아니라 모두 근거를 남깁니다.

1. **RPC가 3개에서 4개로 늘었습니다.** 이 문서의 5-2장은 launcher CAS(`queued→processing`)를 launcher 코드 안의 인라인 SQL로 제안했습니다. 그런데 STEP 4-1 구현을 지시한 메시지에서 "launcher 실행권 획득"을 명시적으로 RPC 예시 중 하나로 요청했으므로, `acquire_video_analysis_run(uuid)`라는 별도 함수로 캡슐화했습니다(`0006_video_analyses_functions.sql`). 조건(`WHERE status='queued'`)과 반환값(성공 시 새 `run_token`이 채워진 행, 실패 시 `null`)은 이 문서 5-2장과 완전히 동일합니다 — 호출 형태만 인라인 SQL에서 함수로 바뀌었습니다. `service_role`에만 EXECUTE를 부여하고 `authenticated`/`anon`에는 명시적으로 막습니다.
2. **함수 grants에 `revoke ... from public`을 추가했습니다.** 이 문서 7-4장의 grants 예시는 `authenticated`/`anon`에 대한 grant/revoke만 다뤘습니다. 그런데 Postgres는 함수를 생성하면 기본적으로 `EXECUTE` 권한을 `PUBLIC`(모든 역할)에 부여합니다 — 테이블이 기본적으로 아무 권한도 안 주는 것과 반대입니다. 이 기본값을 명시적으로 닫지 않으면, 특히 `acquire_video_analysis_run`처럼 `service_role` 전용이어야 하는 함수가 `PUBLIC` 기본값 때문에 사실상 누구나 실행 가능한 상태로 남을 위험이 있었습니다. 그래서 `0009_video_analyses_grants.sql`에서 4개 함수 전부에 대해 `revoke execute ... from public`을 먼저 실행한 뒤 필요한 역할에만 좁게 grant하도록 보완했습니다. 이 문서의 grants "정신"(최소 권한)과 어긋나지 않고, 오히려 그 정신을 완성하는 수정입니다.
3. **`client_request_id` 유니크 인덱스의 파일 위치.** 이 문서 14-3장은 인덱스를 전부 `0008_video_analyses_triggers_indexes.sql`에 두는 것으로 설명했습니다. 그런데 실제 기존 마이그레이션(`0001_init_tables.sql`)을 다시 확인한 결과, 업무 규칙을 강제하는 unique index(`content_projects_idea_id_key`)는 성능용 인덱스 파일이 아니라 **테이블 정의 파일 안에서 테이블 생성 직후에** 만드는 것이 기존 관례였습니다. `client_request_id` 유니크 제약도 같은 성격(멱등성을 보장하는 업무 규칙)이므로, 이 관례를 그대로 따라 `0005_video_analyses_table.sql`(테이블 파일)에 두었습니다. `0008`에는 순수 조회 성능용 인덱스 5개만 남습니다.

이 세 가지 모두 구현 세션의 최종 보고서(`plan과 구현 사이에 달라진 점`)에도 동일하게 기록했습니다.

---

## 20. Production 적용 전 검토에서 확정된 수정사항 (addendum — 2026-08-24, dry-run 검증 완료)

19장까지의 초안을 사용자가 검토한 뒤, production 적용 전 4가지 수정 지시와 로컬 dry-run 검증 지시를 받았습니다. 아래는 그 수정 내용과 실제로 로컬 Postgres 하네스에서 검증한 결과입니다(검증 방법은 21장 참고).

### 20-1. `video_analyses` 사용자 직접 DELETE 제거

`video_analyses_delete_own_terminal` 정책(완료/실패/취소 상태에 한해 본인 DELETE 허용)을 완전히 제거했습니다. Storage 원본이 남아있는 상태에서 DB 행이 먼저 사라지면 `storage_path`/`storage_deleted_at` 정보를 잃어 orphan 파일이 생길 위험이 있었기 때문입니다. `0009`의 테이블 grant에서도 `delete` 권한 자체를 제거했습니다(정책이 없어 RLS로도 막히지만, 최소 권한 원칙상 권한 자체를 주지 않음).

분석 기록 삭제가 필요해지면(향후 STEP) `서버 엔드포인트/service_role → Storage API remove() → 성공 확인 → DB 행 삭제` 순서로만 처리해야 한다는 설계 의도를 `0007`에 주석으로 남겼습니다. 계정 삭제의 정상 경로도 "먼저 해당 사용자의 Storage prefix를 remove()로 정리 → 그 다음 `auth.users` 삭제"가 되어야 하며, 6-2장의 orphan reconciliation(전체 버킷 스캔)은 이 정상 흐름이 지켜지지 못한 비정상 종료 상황만 잡아내는 백스톱으로 역할을 한정했습니다. 계정 삭제 흐름 자체(엔드포인트 등)는 여전히 이 STEP의 범위 밖입니다.

### 20-2. `create_video_analysis`의 `client_request_id` race 제거

"SELECT 존재 확인 → 없으면 INSERT" 방식은 두 요청이 동시에 도착하면 둘 다 "존재하지 않음"을 보고 INSERT를 시도해 한쪽이 `unique_violation`을 받을 수 있는 실제 race였습니다. `INSERT ... ON CONFLICT (user_id, client_request_id) WHERE client_request_id is not null DO NOTHING` + 충돌 시 재조회 방식으로 교체했습니다. Postgres가 동일 대상에 대한 동시 INSERT를 내부적으로 직렬화해 처리하므로 예외가 발생하지 않습니다. **21장의 진짜 2세션 병렬 테스트로 실측 검증했습니다.**

### 20-3. worker 쓰기를 DB-level invariant로 캡슐화 (RPC 3개 신규 추가)

이전에는 "service_role이 애플리케이션에서 `WHERE run_token = ...`를 직접 붙이기로 약속"하는 방식이었고, 이는 DB가 강제하는 게 아니라 애플리케이션 관례였습니다. 아래 3개 SECURITY DEFINER RPC로 캡슐화해 `id + run_token + status='processing'` 조건을 함수 본문에 고정했습니다(총 RPC 7개로 증가, `0006`):

- `update_video_analysis_progress(p_id, p_run_token, p_stage, p_progress)` — 진행 상태 갱신
- `complete_video_analysis(p_id, p_run_token, p_report, p_raw_metrics, p_duration_sec)` — 완료 처리
- `fail_video_analysis(p_id, p_run_token, p_error_code, p_error_message)` — 실패 처리

3개 모두 `service_role` 전용이며, `0009`에서 `revoke execute ... from public` 후 `service_role`에만 grant, `authenticated`에서 명시적으로 revoke했습니다.

### 20-4. CHECK constraint 개수 정정

이전 보고에서 "9개"라고 잘못 집계했습니다. `0005_video_analyses_table.sql`을 실제 DB 카탈로그(`pg_constraint`)에서 직접 조회해 **11개**임을 확인했습니다: `genre, status, storage_path, progress, duration_sec, file_size_bytes, error_code, attempt_count, finished_after_started, completed_has_report, failed_has_error_code`. 테이블 DDL 자체는 처음부터 이 11개 그대로였고, 숫자만 잘못 세었던 보고 오류였습니다.

### 20-5. `videos` 버킷 `file_size_limit` — production 적용 전 blocker로 명시

`file_size_limit`은 여전히 `null`입니다. 임의의 숫자를 넣지 않았습니다 — V1 업로드 정책에서 상한을 정하는 것은 이 STEP의 범위 밖이며, **이 값이 결정되기 전까지는 production 적용을 진행하면 안 되는 blocker**로 22장에 명시합니다.

### 20-6. 미검증 항목의 표시 방식

Storage `metadata`의 size 키 이름(`0006`의 `mark_video_analysis_uploaded` 주석)과 TUS resumable upload에 필요한 정확한 RLS 권한(`0007`의 B-2 섹션 주석)은 여전히 "확정"이 아니라 "소스 코드 조사로 확인했으나 이 프로젝트의 실제 Supabase 인스턴스로는 미확인"으로 표시되어 있습니다. 스테이징에서 실제 파일 업로드 후 재확인이 필요합니다(22장 blocker 참고).

---

## 21. Dry-run 검증 결과 (2026-08-24, 로컬 Postgres 하네스)

**중요한 전제**: 이 검증은 실제 Supabase가 아니라 로컬 Postgres 16에 Supabase의 핵심 요소(`auth.users`, `auth.uid()`, `storage.buckets`/`storage.objects`, `storage.foldername()`, `anon`/`authenticated`/`service_role` 롤)를 최소한으로 재현한 환경에서 실행했습니다. Supabase 자체의 PostgREST 계층, Storage API 서버, 실제 파일 업로드 경로, Auth 서버 동작은 포함하지 않습니다. 즉 "SQL/RLS/함수 로직이 실제로 이렇게 동작하는가"는 검증했지만, "Supabase 플랫폼 전체가 이렇게 동작하는가"까지 보장하지는 않습니다 — 특히 20-6의 두 미검증 항목은 이 dry-run으로도 해소되지 않습니다(로컬 하네스의 `storage.objects.metadata`는 우리가 직접 넣은 값이라, 실제 Supabase Storage 백엔드가 채우는 키 이름과 같다는 보장이 없기 때문입니다).

### 21-1. 실행 절차

1. 기존 프로젝트의 실제 `0001~0004` 마이그레이션(사용자 폴더에서 그대로 가져옴)을 하네스 DB에 적용
2. `0005~0009`(이번 수정본) 적용 — 에러 없음
3. `pg_constraint`/`pg_proc`를 직접 조회해 CHECK 11개, 함수 7개 확인 (20-4)
4. `supabase/tests/video_analyses_test_scenarios.sql`(수정본, 아래 21-2) 전체 실행
5. `supabase/tests/concurrency/run_concurrency_tests.sh`(신규, 진짜 2세션 병렬) 실행
6. `supabase/migrations/rollback/video_analyses_rollback.sql` 적용 → 함수/정책/인덱스/트리거/테이블이 전부 사라졌는지 카탈로그로 직접 확인
7. `0005~0009` 재적용 → 전체 테스트 스위트 재실행
8. `0005~0009`를 롤백 없이 한 번 더 그대로 재실행 → 멱등성(`if not exists`/`create or replace`/`drop ... if exists`) 확인

### 21-2. 순차 테스트 스위트 실행 중 발견하고 수정한 버그 4건

기존 시나리오 파일을 그대로 실행하지 않고 실제로 돌려본 결과, 로직 자체와는 무관한 **테스트 스크립트/하네스 설정의 버그 4건**을 발견해 함께 고쳤습니다(운영 SQL의 버그가 아님을 분명히 합니다):

1. 임시 테이블 `_t_fixtures`가 `authenticated`/`service_role`로 SET ROLE한 뒤에는 접근 권한이 없어 `permission denied` — 생성 직후 명시적으로 grant하도록 수정.
2. `storage.objects`에는 SELECT 정책이 없으므로(설계상 의도) `authenticated` 컨텍스트에서 방금 INSERT한 행을 곧바로 SELECT로 재확인하면 "존재하지 않음"으로 항상 거짓 실패 — 존재 확인을 RLS를 우회하는 컨텍스트로 분리.
3. `update_video_analysis_progress`의 `p_progress smallint` 인자에 정수 리터럴(`30` 등)을 그대로 넘기면 Postgres가 `integer→smallint` 암시적 캐스팅을 함수 오버로드 탐색에서 허용하지 않아 "함수가 존재하지 않음" 에러 — 호출부에 `::smallint` 명시.
4. `video_analyses` 테이블에 `authenticated`의 UPDATE/DELETE 테이블 권한(GRANT) 자체가 없어(RLS 정책 부재보다 앞선 권한 계층), 사용자가 직접 UPDATE/DELETE를 시도하면 "0행"이 아니라 `permission denied` 하드 에러가 남 — 관련 테스트(2-4, 2-9)를 예외를 기대하는 형태로 수정.

네 건 모두 실제로 하네스에서 실행해서 발견했고, 추측으로 고치지 않았습니다.

### 21-3. 순차 테스트 스위트 결과 — 30개 시나리오 전부 PASS

기존 20개에 이번 지시로 추가한 4개 보안 시나리오(2-6/2-7/2-8: `authenticated`가 worker 전용 RPC 3개를 실행할 수 없음, 2-9: `authenticated`가 completed 행을 DELETE할 수 없음)를 더해 24개, 재확인용 하위 검증까지 포함해 총 30개의 `PASS` 로그가 출력되었고 `FAIL`/`ERROR`는 0건이었습니다. 정상 흐름 7개, 보안 9개(2-1~2-9), 중복/Retry 4개, Storage edge case 4개, cleanup 1개 — 세부 목록은 `docs/step-4-1-migration-test-plan.md`(갱신본)에 반영했습니다.

### 21-4. 진짜 2세션 병렬 동시성 테스트 결과 — 전부 PASS

`bash` 백그라운드 프로세스로 실제 별도 psql 세션 2개를 동시에 띄워 검증했습니다(단일 세션 순차 실행이 아님):

- **A. `create_video_analysis` 동일 `client_request_id` 동시 호출**: 두 세션 모두 예외 없이 성공, 둘 다 같은 `id` 반환, DB에는 정확히 1개 행만 생성됨 (20-2 수정의 실측 증거).
- **B. `acquire_video_analysis_run` 동시 호출**: 두 세션 중 정확히 하나만 실행권(run_token) 획득, `attempt_count`는 정확히 1, `status`는 정확히 한 번만 `processing`으로 전이됨.

두 경우 모두 `unique_violation`이나 다른 예외가 전혀 발생하지 않았습니다. 이 스크립트는 `supabase/tests/concurrency/run_concurrency_tests.sh`로 저장했고, 로컬/스테이징 어디서든 재실행 가능합니다.

### 21-5. Rollback → 재적용 사이클 결과 — 정상

롤백 적용 후 `pg_proc`/`pg_indexes`/`pg_policy`에서 관련 객체가 전부 사라졌음을 카탈로그 직접 조회로 확인했습니다. `videos` 버킷은 (이전 dry-run 시도들이 남긴 테스트용 `storage.objects` 잔여 행 때문에) "오브젝트가 남아있어 건너뜀" 가드가 정확히 동작해 삭제되지 않았습니다 — 이는 버그가 아니라 14-4/rollback 스크립트의 안전장치가 의도대로 작동한 것입니다(실제 production 롤백 시에도 같은 방식으로 안전하게 막힙니다). 이후 `0005~0009`를 재적용하고 21-3의 테스트 스위트를 다시 전부 통과시켰습니다. 마지막으로 롤백 없이 `0005~0009`를 한 번 더 재실행해 멱등성도 확인했습니다.

### 21-6. 이 dry-run이 증명하지 못하는 것

- 실제 Supabase Storage 백엔드가 채우는 `metadata` 키 이름 (20-6, 여전히 미확정)
- 실제 TUS resumable upload가 요구하는 정확한 `storage.objects` RLS 권한 (20-6)
- Supabase PostgREST를 통한 실제 HTTP 호출 경로에서의 동작(권한/에러 형식 등)
- Supabase Auth의 실제 JWT 발급/검증 경로(이 하네스는 `set_config`로 클레임을 직접 주입해 시뮬레이션함)
- 매우 큰 동시성(수십~수백 동시 요청)에서의 성능/락 경합 — 이번 검증은 정확성(2세션)만 확인했고 부하는 다루지 않음

---

## 22. Production 적용을 막는 Blocker 목록

| # | Blocker | 설명 | 해소 방법 |
|---|---|---|---|
| 1 | `videos` 버킷 `file_size_limit`이 미정(`null`) | 임의 숫자를 넣지 않았음 — V1 업로드 상한 정책 자체가 아직 결정되지 않음 | 제품 결정 후 `0007`의 `insert into storage.buckets`를 `update`로 반영 |
| 2 | Storage `metadata` size 키 이름 미확인 | 소스 코드 조사(supabase/storage GitHub) 근거이나 이 프로젝트의 실제 Supabase 인스턴스로 직접 확인한 적 없음 | 스테이징에서 실제 업로드 1건 후 `select metadata from storage.objects ...`로 재확인 |
| 3 | TUS resumable upload에 필요한 정확한 RLS 권한 미확인 | `video_objects_update_own_while_pending`이 실제 TUS 흐름에 충분한지 Supabase 공식 문서로 재검증 필요 | STEP 4-2(업로드 UI) 구현 시 공식 문서 대조 |
| 4 | 진짜 동시성은 로컬 하네스에서만 검증됨 | 21-4의 병렬 테스트는 로컬 Postgres 2세션 기준 — 실제 Supabase 프로젝트(커넥션 풀러, PostgREST 경유)에서도 동일하게 동작하는지는 미확인 | 스테이징 Supabase 프로젝트에서 `run_concurrency_tests.sh` 재실행 권장 |
| 5 | 계정 삭제 흐름 자체가 아직 없음 | 20-1에서 "정상 경로는 Storage 정리 후 사용자 삭제"라고 설계 의도만 남겼을 뿐, 실제 계정 삭제 기능/엔드포인트는 이 프로젝트에 아직 없음 | 계정 삭제 기능을 만들 때 이 순서를 지키도록 별도 STEP에서 구현 |
| 6 | stale-lock 회수 로직 미구현 | `attempt_count`/`processing_started_idx`는 준비만 되어 있고, 실제로 오래된 processing 행을 회수하는 배치는 아직 없음 | 별도 STEP |
| 7 | Storage cleanup 배치(remove() 호출) 미구현 | `storage_deleted_at`/`pending_cleanup_idx`는 준비만 되어 있고, 실제 cron/Edge Function은 아직 없음 | 별도 STEP |

1~3번은 이번 지시에서 명시적으로 "확정으로 표시하지 말라"고 한 항목이며, 4번은 이번 지시로 신규 발견/추가된 항목입니다. 5~7번은 이전 보고에서도 이미 범위 밖으로 명시했던 항목을 다시 한 번 명확히 blocker 목록에 정리한 것입니다.

**22장은 23장으로 갱신되었습니다 — 아래 23장이 최신 blocker 목록입니다.** 이 표는 22장 작성 시점(2026-08-24, Storage 재검토 이전)의 스냅샷으로 남겨둡니다.

---

## 23. Storage RLS 재검토 (addendum — 2026-08-24, 공식 문서 기준 최종 수정)

22장까지 보고한 뒤, 사용자가 최신 Supabase 공식 문서를 기준으로 Storage RLS를 마지막으로 재검토하라고 지시했습니다. 이번 라운드는 새로운 SQL 작성이 아니라 **`0006`/`0007`/rollback/테스트 스크립트의 수정**입니다.

### 23-1. `storage.objects` SELECT 정책 신규 추가

**근거**: Supabase 공식 troubleshooting 문서("Storage error: 403 Forbidden... on upload")는 Storage API가 업로드 시 `INSERT ... RETURNING *`로 메타데이터를 반환하는데, SELECT 정책이 없거나 방금 만든 행을 커버하지 못하면 RETURNING이 빈 결과가 되고 이를 403으로 처리한다고 명시합니다. INSERT만 있고 SELECT가 없으면 업로드 자체가 실패할 수 있다는 뜻입니다.
출처: https://supabase.com/docs/guides/troubleshooting/storage-error-403-forbidden-new-row-violates-row-level-security-policy-on-upload-a94384

**설계**: `video_objects_select_own_while_pending` 정책을 요청받은 대로 최대한 좁게 추가했습니다 — `bucket_id='videos'` + 첫 번째 path segment가 `auth.uid()` + 대응 `video_analyses` 행이 본인 소유이며 아직 `pending`. 업로드가 끝나 상태가 `pending`을 벗어나면 이 SELECT 권한도 함께 사라지므로, "업로드 완료 후 원본을 영구적으로 조회/다운로드할 수 있는 권한"은 열리지 않습니다.

### 23-2. `storage.objects` UPDATE 정책 완전 제거

**근거 1(공식 문서)**: Storage Access Control 가이드는 "업로드에 필요한 유일한 RLS 정책은 INSERT 권한이며, upsert 기능으로 덮어쓰기를 허용하려면 SELECT와 UPDATE 권한을 추가로 부여해야 한다"고 명시합니다 — UPDATE는 upsert(덮어쓰기) 전용입니다.
출처: https://supabase.com/docs/guides/storage/security/access-control

**근거 2(공식 블로그, 구현 설명)**: "Storage v3: Resumable Uploads" 블로그는 재개형(TUS) 업로드가 **마지막 청크가 도착했을 때에만 `storage.objects`에 INSERT**한다고 설명합니다 — 업로드 도중의 PATCH 청크는 이 테이블을 건드리지 않습니다. 즉 upsert를 쓰지 않는 한 UPDATE가 발생할 SQL 경로 자체가 없습니다.
출처: https://supabase.com/blog/storage-v3-resumable-uploads

**결론**: V1은 결정적 경로에 대해 upsert/overwrite를 쓰지 않기로 했으므로(`x-upsert: true`를 클라이언트에서 보내지 않음), `video_objects_update_own_while_pending` 정책을 완전히 제거했습니다. `storage.objects`에는 이제 INSERT·SELECT 정책 2개만 존재합니다(로컬 하네스에서 `pg_policy`로 직접 확인).

**남은 불확실성**: TUS 업로드 내부의 완료(finalize) 처리가 문서화되지 않은 별도 경로로 UPDATE를 시도할 가능성까지는 원본 소스 코드로 100% 확인하지 못했습니다 — GitHub 저장소의 파일 트리 브라우징이 이번 조사 환경에서 robots.txt로 차단되어 열람할 수 없었습니다(추측 대신 이 사실 자체를 남깁니다). 그래서 이 판단은 **staging TUS smoke test로 실증 검증이 필요**합니다. 만약 업로드 완료 단계에서 권한 오류가 나면, `0007`에 그대로 남겨둔 복구용 SQL(주석 안에 포함)을 즉시 적용하면 됩니다.

### 23-3. Storage metadata `size` 키 — blocker 상태 변경

Supabase 공식 문서(Platform → Manage your usage → Storage size)의 실제 운영 SQL 예시가 `(metadata->>'size')::int` 형태만 사용하고 `contentLength`는 어디에도 언급하지 않는 것을 확인했습니다. 근거 없는 `contentLength` fallback을 제거하고 `size` 키 하나만 사용하도록 `mark_video_analysis_uploaded`를 단순화했습니다.
출처: https://supabase.com/docs/guides/platform/manage-your-usage/storage-size

**상태 변경**: "미확정" → **"공식 문서 기준 확인됨"**. 다만 요청하신 대로, 이 프로젝트의 실제 Supabase 인스턴스로 직접 확인한 것은 아니므로 staging smoke test에서 재확인하는 검증 항목(23-5의 시나리오 6)으로는 계속 유지합니다.

### 23-4. V1 업로드 정책 — bucket plan 확인 결과

`file_size_limit` 2GB를 migration에 넣기 전에 production Supabase 프로젝트의 plan을 사용자에게 직접 확인했습니다: **현재 Free plan**입니다.

Supabase 공식 문서(Storage → Uploads → Limits)에 따르면:
- Free plan: project 전체 전역 업로드 상한이 **50MB를 넘을 수 없음**
- Pro/Team: **최대 500GB**까지 설정 가능, Enterprise는 그 이상 협의 가능
- 버킷별 `file_size_limit`은 **전역 상한보다 클 수 없음** ("it can't be higher than this global limit")
출처: https://supabase.com/docs/guides/storage/uploads/file-limits

**결론**: 지금 Free plan에서는 버킷에 2GB를 설정해도 전역 50MB 상한 때문에 실제로는 50MB에서 막힙니다 — 오히려 "설정값과 실제 동작이 다르다"는 혼란만 만듭니다. 그래서 `0007`의 `file_size_limit`은 여전히 `null`로 두었고, **"Free plan으로는 이 서비스가 필요로 하는 파일 크기를 받을 수 없다"는 사실을 환경 blocker로 23-5에 명시**합니다. Pro 이상으로 업그레이드하거나, V1 범위(최대 영상 길이/용량)를 Free plan 한도에 맞게 재조정하는 제품 결정이 실제 migration 적용보다 먼저 필요합니다.

최대 영상 길이(30분) 제한은 Storage 계층의 문제가 아니라 애플리케이션 계층의 검증입니다 — `duration_sec` 컬럼은 CHECK로 상한을 걸지 않았는데(0005), 업로드 시점에는 아직 실제 재생 길이를 알 수 없고(ffprobe는 이후 파이프라인 STEP의 몫, plan 7-2장 원칙) DB에서 미디어를 직접 분석하지 않기로 했기 때문입니다. 30분 제한은 클라이언트/서버 애플리케이션 코드에서 강제해야 합니다 — 이 STEP(DB 스키마)의 범위 밖입니다.

### 23-5. Staging smoke test — 실행 주체와 한계

이 세션에는 실제 production/staging Supabase 프로젝트에 대한 자격 증명(anon key, service_role key, 로그인 세션 등)이 전혀 없고, 안전 규칙상 service_role 키를 다루거나 요청하는 것 자체가 금지되어 있습니다. 따라서 **요청하신 10단계 smoke test를 이 세션이 직접 실행하지 못했습니다** — 실행하지 않은 것을 실행했다고 보고하지 않습니다. 대신 그 10단계를 그대로 반영한 실행 절차서를 만들어 전달합니다(별도 문서, 아래 참고). 실제 실행은 사용자 또는 팀이 staging 프로젝트에서 수행해야 합니다.

로컬 Postgres 하네스에서는 이번에 수정한 RLS 로직 자체(INSERT/SELECT 허용 범위, UPDATE 전면 차단, pending 상태 만료)를 SQL 레벨로 재검증했습니다 — `video_analyses_test_scenarios.sql`에 시나리오 4개를 신규 추가(1-2b, 1-2c, 1-3b, 2-10)했고, 기존 시나리오까지 합쳐 총 34개 전부 PASS했습니다. 다만 이는 TUS 프로토콜 자체나 Storage API 서버, 실제 JWT 발급 경로를 재현하지 않으므로 23-2의 "남은 불확실성"을 대체하지 못합니다.

---

## 24. Production 적용을 막는 최종 Blocker 목록 (22장을 대체)

| # | Blocker | 설명 | 해소 방법 |
|---|---|---|---|
| 1 | **Free plan으로는 목표 파일 크기(2GB)를 받을 수 없음** (신규 확정) | 전역 Storage 업로드 상한이 Free plan에서 50MB로 고정 — 버킷 설정과 무관하게 이 이상은 거부됨 | Pro 이상으로 업그레이드, 또는 V1 목표 파일 크기/영상 길이를 50MB 한도에 맞게 재조정하는 제품 결정 |
| 2 | TUS 업로드 완료 시 UPDATE 필요 여부 — 문서상 불필요로 결론, 원본 소스 코드로 100% 확인은 못함 | 공식 문서 2건(Access Control, Storage v3 블로그)이 UPDATE 불필요를 뒷받침하지만, GitHub 코드 브라우징이 이번 세션에서 막혀 완전한 소스 확인은 못함 | staging TUS smoke test(아래 5번)에서 업로드가 끝까지 성공하는지 확인 — 실패 시 0007에 남겨둔 복구 SQL 즉시 적용 |
| 3 | Storage `metadata->>'size'` 키 — 공식 문서로는 확인됨, 이 프로젝트 실측은 아직 | 공식 문서 기준으로는 해소되었으나 이 프로젝트의 실제 Supabase 인스턴스로 직접 조회한 적은 없음 | staging smoke test 시나리오 6에서 실제 업로드 후 `select metadata ...`로 재확인 |
| 4 | **Staging smoke test 미실행** (이 세션이 실행 불가) | 이 세션에 production/staging Supabase 자격 증명이 없고, 안전 규칙상 service_role 키를 다루지 않음 | `docs/step-4-1-storage-smoke-test-checklist.md`(신규 전달)를 사용자/팀이 실제 staging 프로젝트에서 실행 |
| 5 | 진짜 동시성은 로컬 하네스에서만 검증됨 | 21-4의 병렬 테스트는 로컬 Postgres 2세션 기준 — 실제 Supabase(커넥션 풀러, PostgREST 경유)에서는 미확인 | staging에서 `run_concurrency_tests.sh` 재실행 권장 |
| 6 | 계정 삭제 흐름 자체가 아직 없음 | 20-1의 설계 의도만 존재, 실제 기능 없음 | 별도 STEP |
| 7 | stale-lock 회수 로직 미구현 | 준비만 되어 있음 | 별도 STEP |
| 8 | Storage cleanup 배치(remove() 호출) 미구현 | 준비만 되어 있음 | 별도 STEP |

1번이 이번 라운드의 핵심 신규 발견입니다 — 이전까지는 "2GB가 확정 안 됨"이라고만 썼지만, 지금은 "**현재 plan으로는 애초에 불가능**"이라는 더 정확하고 더 강한 blocker로 바뀌었습니다.


## 25. 실제 staging Supabase smoke test (addendum — 2026-08-24, Round C)

23-5장에서 "이 세션은 실제 Supabase 자격증명이 없어 smoke test를 실행할 수 없다"고 썼으나, 사용자 요청으로 Supabase MCP 커넥터를 이 세션에 연결해 실제로 검증을 시도했습니다. 그 결과 아래와 같이 **부분적으로만** 실제 환경 검증이 가능했습니다 — 무엇이 실제로 검증됐고 무엇이 안 됐는지 정확히 구분해서 남깁니다.

### 25-1. Staging 프로젝트 프로비저닝

연결된 조직(zerotoone)에는 production으로 추정되는 `youtube-planner` 프로젝트 1개만 있고 별도 staging이 없었습니다. production에 아무것도 적용하지 않기 위해, 사용자 승인 하에 완전히 분리된 새 프로젝트 `youtube-planner-staging`(project ref: `btyihqzfgbjpzgxienkp`, region: ap-northeast-2, 비용: $0/월 — Free tier)을 생성했습니다. 이 프로젝트에 `0001`~`0009` 전체 마이그레이션(기존 6개 테이블 + video_analyses + RLS + RPC 7개 + 트리거/인덱스 + grants)을 순서대로 적용했고, `pg_policy`/`pg_constraint` 카탈로그 직접 조회 및 Supabase Advisors(security)로 스키마가 의도대로 적용됐음을 확인했습니다.

### 25-2. 검증 가능했던 범위 vs 불가능했던 범위 (중요)

이 세션의 네트워크 환경을 실제로 테스트한 결과, 두 가지 제약이 확인됐습니다:

- 이 샌드박스의 bash 네트워크는 패키지 레지스트리 등 허용 목록에 있는 호스트로만 나갈 수 있고, `btyihqzfgbjpzgxienkp.supabase.co`(staging 프로젝트 도메인)는 그 목록에 없어 `curl`이 403으로 차단됨을 직접 확인했습니다.
- Claude in Chrome 브라우저 확장이 이 세션에 연결돼 있지 않아, 브라우저를 통한 우회도 불가능했습니다.

Supabase MCP 커넥터(`execute_sql`, `apply_migration` 등)는 프로젝트의 **Postgres 데이터베이스에 대한 직접 SQL 접근**만 제공하고, Auth 회원가입/로그인이나 Storage TUS 업로드 같은 **HTTP API 호출 자체를 만드는 기능은 없습니다.** 그래서:

- **실제로 검증됨**: `authenticated`/`anon` 롤 컨텍스트를 real Postgres 세션에서 `set role` + `set_config('request.jwt.claims', ...)`로 재현해, RLS 정책과 RPC 함수의 로직을 실제 staging Postgres(17.6.1, 진짜 Supabase 인프라) 위에서 직접 실행 — 로컬 하네스 재현이 아니라 진짜 인스턴스입니다.
- **검증되지 않음**: 실제 GoTrue 회원가입/로그인으로 발급된 JWT, 실제 TUS resumable upload(pause/resume 포함), Storage API(storage-api 서비스)의 HTTP 레벨 동작 자체. 이 부분은 이 세션에서 외부 인터넷에 접근할 방법이 없어 실행하지 못했습니다 — 사용자에게 이 사실을 알리고 계속 진행할지 확인 후, "지금은 Postgres 레벨 검증만 진행"으로 명시적 승인을 받았습니다.

### 25-3. 실제 staging Postgres에서 수행한 테스트 (11개, 전부 PASS)

테스트 사용자 2명을 `auth.users`에 직접 생성(실제 Supabase의 진짜 `auth.users` 스키마 — `confirmed_at`이 generated column이라는 점 등 로컬 하네스와 다른 세부사항을 이번에 처음 확인)하고, 아래를 순서대로 실행했습니다. 모두 실제 staging 프로젝트의 실제 Postgres에서 실행한 결과입니다.

| # | 테스트 | 결과 |
|---|---|---|
| 1-1 | `create_video_analysis` 호출 | PASS — `status='pending'`, `storage_path` 결정적 계산 확인 |
| 1-2 | 본인 폴더에 `storage.objects` INSERT | PASS |
| 1-2b | 본인이 방금 만든 pending 오브젝트 SELECT | PASS — `metadata->>'size'` 정확히 반영 |
| 1-2c | pending 상태에서 UPDATE(덮어쓰기) 시도 | PASS — 0행 (UPDATE 정책 없음 확인) |
| 2-10 | 다른 user가 pending 오브젝트 SELECT 시도 | PASS — 0행 |
| 2-3 | 다른 user 폴더에 INSERT 시도 | PASS — RLS 거부 |
| 1-3 | `mark_video_analysis_uploaded` | PASS — `status='uploaded'`, `file_size_bytes`가 `metadata->>'size'`와 정확히 일치 |
| 1-3b | 업로드 완료 이후 본인 SELECT 시도 | PASS — 0행 (영구 다운로드 권한 없음 확인) |
| 4-4 | 업로드 완료 이후 overwrite(UPDATE) 시도 | PASS — 0행 |
| A-1/A-2 | 동일 `client_request_id`로 `create_video_analysis` 2회 호출(같은 메시지 내 병렬 dispatch) | PASS — 둘 다 예외 없이 성공, 같은 행 반환, DB에는 정확히 1행 |
| B-1/B-2/B-3 | 동일 분석에 `acquire_video_analysis_run` 2회 호출(병렬 dispatch) | PASS — 정확히 한 호출만 실행권 획득(`attempt_count=1`, `status='processing'`), 다른 호출은 `null` |

A-1/A-2, B-1/B-2/B-3는 같은 메시지 안에서 두 `execute_sql` 호출을 동시에 보내 실제 겹침을 시도했습니다 — 로컬 하네스처럼 `clock_timestamp()` 동기화로 완벽한 겹침을 강제한 것은 아니라서 나노초 단위 동시성까지 보장하는 실험은 아니지만, 두 호출 모두 예외 없이 끝났고 결과가 "정확히 하나만 성공"이라는 CAS 로직의 핵심 속성을 실제 인프라에서 재확인했습니다.

### 25-4. 예상 밖의 발견 2가지

1. **`storage.objects`에 실제 SQL DELETE 방지 트리거가 있습니다.** 테스트 정리 중 `delete from storage.objects ...`가 `ERROR: 42501: Direct deletion from storage tables is not allowed. Use the Storage API instead.`로 즉시 거부됐습니다(`storage.protect_delete()` 트리거). 이 프로젝트가 처음부터 지켜온 "`storage.objects` SQL DELETE 금지, 항상 Storage API `remove()`만" 원칙을 Supabase 플랫폼 자체가 DB 레벨에서 강제하고 있다는 뜻으로, 우리 설계 원칙과 정확히 일치하는 좋은 확인입니다. (이 트리거 때문에 테스트로 만든 가짜 `storage.objects` 행 1개는 정리하지 못하고 staging 프로젝트에 남아 있습니다 — 실제 파일이 없는 메타데이터뿐인 테스트 행이고 disposable staging 프로젝트이므로 위험은 없습니다.)
2. **`storage.objects`에는 `(bucket_id, name)` unique 제약이 DB 레벨에 없습니다.** "동일 경로 재업로드 거부"와 "업로드 완료 후 overwrite 거부"는 RLS나 DB 제약이 아니라 Storage API(storage-api 서비스)의 애플리케이션 로직(기존 경로 존재 확인 후 400/409 반환)으로 구현되어 있다는 뜻입니다. 즉 이 두 속성은 **HTTP 레벨 테스트로만 검증 가능**하고, 이번 Postgres 레벨 검증 범위 밖입니다 — 공식 문서(resumable-uploads 가이드의 "Concurrency" 절)의 서술과 일치하지만, 우리 마이그레이션의 SQL이 이 속성을 보장하는 것은 아니라는 점을 명확히 해둡니다.

### 25-5. 수정된 SQL

없습니다. `0005`~`0009`는 이전 라운드(23장)에서 전달한 내용 그대로이며, 이번 라운드의 실제 staging 테스트 결과 코드 변경이 필요한 문제는 발견되지 않았습니다.

### 25-6. 남은 blocker (24장 갱신)

24장의 8개 항목 중 #4("staging smoke test 미실행")를 다음과 같이 좁혀서 갱신합니다: Postgres/RLS/RPC 레벨은 이번에 실제 staging에서 검증 완료. 남은 것은 TUS 업로드·실제 로그인 JWT·Storage API HTTP 레벨(특히 위 25-4의 2번 — 중복 경로/overwrite 거부)이며, 이는 이 세션의 네트워크 제약으로 미실행 상태입니다. 나머지 24장 항목(Free plan 50MB 한도, 계정 삭제 흐름, stale-lock 회수, Storage cleanup 배치)은 변경 없이 유지됩니다.

`youtube-planner-staging` 프로젝트(ref: `btyihqzfgbjpzgxienkp`)는 삭제하지 않고 남겨뒀습니다 — 이후 실제 인터넷 접근이 가능한 환경(연결된 Chrome, 또는 사용자 팀의 로컬/CI 환경)에서 TUS/로그인 HTTP 테스트를 이어서 진행할 때 재사용할 수 있습니다.
