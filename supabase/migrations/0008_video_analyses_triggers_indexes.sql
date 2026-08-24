-- ============================================================
-- YouTube Planner — 0008 video_analyses 트리거 + 인덱스
-- STEP 4-1
--
-- 새 트리거 함수는 만들지 않습니다 — 기존 public.set_updated_at()을 재사용합니다
-- (research 2-2장에서 확인한 기존 함수, 0003_triggers_indexes.sql 참고).
--
-- 업무 규칙을 강제하는 unique index(video_analyses_user_client_request_key)는
-- 기존 관례(content_projects_idea_id_key)에 따라 0005(테이블 파일)에 이미
-- 포함돼 있습니다 — 여기서는 순수 조회 성능용 인덱스만 다룹니다.
--
-- Supabase SQL Editor에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--
-- 주의: 이 파일은 아직 production에 적용되지 않았습니다 (STEP 4-1 승인 대기).
-- ============================================================


-- ============================================================
-- 1. updated_at 자동 갱신 트리거
-- ============================================================

drop trigger if exists set_updated_at on public.video_analyses;
create trigger set_updated_at
  before update on public.video_analyses
  for each row execute function public.set_updated_at();


-- ============================================================
-- 2. 인덱스
-- ============================================================

-- 목록 화면 (최신순)
create index if not exists video_analyses_user_created_idx
  on public.video_analyses (user_id, created_at desc);

-- 상태별 탭("진행 중" / "완료")
create index if not exists video_analyses_user_status_idx
  on public.video_analyses (user_id, status);

-- 채널별 조회 (선택적 연결이므로 partial index — content_projects_channel_id_idx와
-- 같은 원리이나, channel_id가 nullable이라는 점이 달라 partial로 둠)
create index if not exists video_analyses_channel_id_idx
  on public.video_analyses (channel_id)
  where channel_id is not null;

-- stale-lock 회수 작업이 매번 스캔하는 대상 (plan 5-4장)
create index if not exists video_analyses_processing_started_idx
  on public.video_analyses (started_at)
  where status = 'processing';

-- 보관기간 만료 cleanup 쿼리가 스캔하는 대상 (plan 6-2장)
create index if not exists video_analyses_pending_cleanup_idx
  on public.video_analyses (status, finished_at)
  where storage_deleted_at is null and status in ('completed', 'failed');
