-- ============================================================
-- YouTube Planner — 0005 video_analyses 테이블
-- STEP 4-1 : 영상 분석 작업의 상태/소유권/결과/실패 정보 저장
--
-- docs/plan-step-4-1-db-migration.md 3장(최종 제안 스키마)을 그대로 반영합니다.
-- 컬럼/제약을 plan 문서와 다르게 바꾼 곳은 없습니다.
--
-- Supabase SQL Editor에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다 (if not exists 사용) — 기존 4개 마이그레이션과 동일한 관례.
--
-- 주의: 이 파일은 아직 production에 적용되지 않았습니다 (STEP 4-1 승인 대기).
-- ============================================================


create table if not exists public.video_analyses (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,

  -- 영상 분석은 특정 채널에 종속된 기능이 아니므로 nullable.
  -- 채널이 삭제돼도 분석 결과는 살아남아야 하므로 set null
  -- (content_projects.idea_id와 동일한 근거, plan 8장 — channel_id 소유권 확인은
  -- FK가 아니라 create_video_analysis() RPC 안에서 이뤄집니다. 0006 참고).
  channel_id          uuid references public.channels(id) on delete set null,

  genre               text not null,

  -- 결정적 경로: {user_id}/{id}/original.mp4
  -- GENERATED 컬럼이 아니라 일반 컬럼 + CHECK로 구현합니다 (plan 6-1장 근거 —
  -- GENERATED 컬럼은 나중에 규칙을 바꿀 때 컬럼을 드롭/재생성해야 하지만
  -- CHECK는 제약만 교체하면 됩니다). 값 자체는 create_video_analysis() RPC 안에서만
  -- 채워지며, 이 테이블에 대한 일반 INSERT 정책 자체를 만들지 않으므로(0007 참고)
  -- 클라이언트가 이 값을 직접 지정하는 경로는 존재하지 않습니다. 이 CHECK는
  -- 그 경로가 실수로라도 생기는 경우를 막는 마지막 방어선입니다.
  storage_path        text not null,

  status              text not null default 'pending',

  -- 의도적으로 CHECK 없음. STEP 4-0 결과(research-step-4-1-db-analysis.md 7장)상
  -- 파이프라인 내부 기술이 아직 조건부/제외/미검증 단계라 이름이 바뀔 수 있어,
  -- DB에 값 목록을 고정하면 기술이 바뀔 때마다 마이그레이션이 필요해집니다.
  -- 허용 값은 애플리케이션(lib/types.ts의 union 타입)에서 관리합니다.
  current_stage       text,

  progress            smallint,

  duration_sec        numeric(10, 2),
  file_size_bytes     bigint,

  -- 버저닝 가능한 jsonb (plan 9장). 형태는:
  --   { "schema_version": 1, "signals": { "<신호명>": { "schema_version": 1, "value": {...} } } }
  -- 특정 신호 이름을 DB 레벨에서 고정하지 않습니다 — STEP 4-0에서 제외된 신호
  -- (tile_max_diff 등)는 그냥 앞으로 안 쓰면 됩니다.
  raw_metrics         jsonb,

  -- { "schema_version": 1, "pipeline_version": "v1", "observations": [...] }
  -- 사용자에게 그대로 노출되는 값이므로 다른 사용자 정보/외부 API 원문/내부 추론
  -- 과정을 담지 않습니다 (plan 10장). 애플리케이션의 Zod 화이트리스트 스키마가
  -- 이 규율을 강제합니다.
  report              jsonb,

  error_code          text,
  error_message       text,     -- 정제된 메시지만. 스택트레이스/시크릿 금지 (plan 10장)

  -- Cloud Run Job 실행 ID. error_message는 사용자 노출용 정제 메시지만 담고,
  -- 실제 상세 로그는 Cloud Logging에서 이 값으로 상호 참조합니다 (plan 10장).
  execution_id        text,

  pipeline_version    text not null default 'v1',

  -- processing 진입 횟수(재시도 상한 판정용, plan 5-4장)
  attempt_count       integer not null default 0,

  -- fencing token: processing 진입마다 새로 발급되어, 오래된/좀비 실행이
  -- 최신 실행의 결과를 덮어쓰지 못하게 막습니다 (plan 5-3장).
  -- acquire_video_analysis_run()이 발급하고, worker의 모든 쓰기가 이 값과
  -- 일치할 때만 성공합니다.
  run_token           uuid,

  -- 분석 생성 요청의 멱등 키. 사용자별로만 유일하면 충분합니다 (plan 5-1장).
  client_request_id   uuid,

  -- 원본 파일이 실제로 Storage API remove()로 삭제 완료된 시각 (plan 6-2장).
  -- null이면 아직 원본이 Storage에 남아있다는 뜻입니다.
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


-- 분석 생성 요청의 멱등 키 유니크 제약 (plan 5-1장).
-- 기존 프로젝트 관례상(content_projects_idea_id_key 참고) 업무 규칙을 강제하는
-- unique index는 인덱스 파일(0008)이 아니라 테이블 파일에 함께 둡니다.
create unique index if not exists video_analyses_user_client_request_key
  on public.video_analyses (user_id, client_request_id)
  where client_request_id is not null;


-- ============================================================
-- RLS 활성화
--
-- 지금은 "켜기"만 합니다. 정책(policy)은 0007에서 만듭니다.
-- RLS를 켜고 정책이 없으면 → 모두 차단됩니다(기존 6개 테이블과 동일한 안전 기본값).
-- 이 시점부터 마이그레이션 적용 완료(0007) 전까지는 authenticated/anon 누구도
-- 이 테이블에 접근할 수 없습니다.
-- ============================================================
alter table public.video_analyses enable row level security;
