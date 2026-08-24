-- ============================================================
-- YouTube Planner — 0011 orchestration retry safety
-- STEP 4-3A
--
-- ⚠️ 이 파일은 이번 STEP에서 remote(staging/production) 어디에도 적용하지
-- 않습니다. 사람이 검수한 뒤 별도로 적용합니다.
--
-- 이 마이그레이션이 바꾸는 것 2가지:
--   A. queue_video_analysis — uploaded→queued뿐 아니라 이미 queued인 행도
--      멱등하게 그대로 반환하도록 확장 (STEP 4-3A의 Cloud Tasks enqueue가
--      실패한 뒤 같은 요청이 재시도될 때, DB 전이는 이미 성공했으니 새
--      부작용 없이 안전하게 같은 결과를 돌려주기 위함).
--   B. acquire_video_analysis_run — Cloud Run Job의 execution_id를 인자로
--      받아, "같은 실행(execution)의 재시도(attempt)"와 "처음 보는 다른
--      실행"을 구분할 수 있게 함. Cloud Run Job의 자체 태스크 재시도
--      (maxRetries)는 같은 execution 안에서 일어나는데, 기존 1-인자
--      시그니처는 status='queued' 조건만 봐서 최초 attempt가 이미
--      processing으로 바꿔놓으면 재시도 attempt가 다시 acquire할 방법이
--      없었습니다 — 이 문제를 해결합니다.
--
-- 기존 관례 유지: SECURITY DEFINER, search_path='', PUBLIC/anon 명시적 차단,
-- comment on function으로 계약 문서화.
-- ============================================================


-- ------------------------------------------------------------
-- A. queue_video_analysis — 멱등 재시도 지원
--
-- 이전(0010): status='uploaded'인 경우만 처리, 그 외에는 무조건 null.
-- 이후: status='uploaded'면 전이하고, 이미 status='queued'(소유자 본인)면
--       아무 것도 바꾸지 않고 그 행을 그대로 반환. 그 외 상태는 여전히 null.
--
-- "이미 queued" 케이스에서 current_stage/progress/error_code/error_message를
-- 다시 초기화하지 않는 이유: 이미 큐에 들어간 뒤라면 launcher가 그 사이에
-- acquire해서 processing으로 넘어갔을 수도 있는데, 그 경우는 애초에 이
-- 두 번째 SELECT 분기에서 status='queued' 조건에 안 맞아 걸리지 않습니다
-- (이미 processing이면 null 반환 — 호출자는 "더 이상 큐잉 가능한 상태가
-- 아님"으로 해석해야 합니다. Route Handler는 이를 409로 매핑합니다).
-- ------------------------------------------------------------
create or replace function public.queue_video_analysis(p_id uuid)
returns public.video_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.video_analyses;
begin
  update public.video_analyses
  set status = 'queued',
      current_stage = 'queued',
      progress = 0,
      error_code = null,
      error_message = null
  where id = p_id
    and user_id = (select auth.uid())
    and status = 'uploaded'
  returning * into v_row;

  if found then
    return v_row;
  end if;

  -- 멱등 재시도: 이미 queued 상태인 본인 소유 행이면 상태를 건드리지 않고
  -- 그대로 반환한다. Cloud Tasks 생성이 실패한 뒤 같은 큐잉 요청이 다시
  -- 오는 경우가 정확히 이 경로를 탄다.
  select * into v_row
  from public.video_analyses
  where id = p_id
    and user_id = (select auth.uid())
    and status = 'queued';

  return v_row; -- 위 SELECT도 못 찾으면(다른 상태/소유 아님/존재 안 함) null
end;
$$;

comment on function public.queue_video_analysis(uuid) is
  'STEP 4-3A (0011): 분석을 큐에 등록한다. authenticated 전용. uploaded→queued 전이를 '
  '수행하거나, 이미 queued인 본인 소유 행이면 멱등하게 그대로 반환한다(Cloud Tasks 생성 '
  '실패 후 재시도 안전). 그 외 상태/소유 아님/존재하지 않음은 null.';

revoke all on function public.queue_video_analysis(uuid) from public;
revoke all on function public.queue_video_analysis(uuid) from anon;
grant execute on function public.queue_video_analysis(uuid) to authenticated;
grant execute on function public.queue_video_analysis(uuid) to service_role;


-- ------------------------------------------------------------
-- B. acquire_video_analysis_run — execution-aware 재작성
--
-- 기존 1-인자 시그니처(acquire_video_analysis_run(uuid))는 제거합니다.
-- 어떤 코드도 이 시그니처로 호출하지 않아야 하며(worker는 이번 STEP에서
-- 새 2-인자 시그니처만 사용하도록 작성됨), 남겨두면 "어느 걸 써야 하는지"
-- 혼란을 주는 stale API가 됩니다.
--
-- 새 계약 (p_id uuid, p_execution_id text):
--   1) 최초 acquire: status='queued' → processing 전이, execution_id 기록,
--      run_token 새로 발급, attempt_count+=1, started_at은 처음 한 번만 설정.
--   2) 같은 execution의 재시도: status='processing' AND execution_id=p_execution_id
--      → run_token만 새로 교체(이전 attempt를 fencing), attempt_count+=1,
--      status/execution_id/started_at은 그대로.
--   3) 다른 execution(status='processing' AND execution_id<>p_execution_id)
--      또는 terminal 상태(completed/failed/cancelled) → null. 호출자(launcher/
--      worker)는 이 경우 비싼 작업을 시작하지 말고 즉시 종료해야 한다.
--
-- 두 UPDATE 모두 원자적 단일 문장이라 동시 호출에도 안전 — Postgres가 같은
-- 대상 행에 대한 동시 UPDATE를 내부적으로 직렬화한다(create_video_analysis의
-- ON CONFLICT와 동일한 근거, 0006 참고).
-- ------------------------------------------------------------

drop function if exists public.acquire_video_analysis_run(uuid);

create or replace function public.acquire_video_analysis_run(
  p_id uuid,
  p_execution_id text
)
returns public.video_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.video_analyses;
begin
  if p_execution_id is null or btrim(p_execution_id) = '' then
    raise exception 'p_execution_id is required'
      using errcode = '22023';
  end if;

  -- 1) 최초 acquire: queued → processing
  update public.video_analyses
  set status = 'processing',
      execution_id = p_execution_id,
      started_at = coalesce(started_at, now()),
      run_token = gen_random_uuid(),
      attempt_count = attempt_count + 1
  where id = p_id
    and status = 'queued'
  returning * into v_row;

  if found then
    return v_row;
  end if;

  -- 2) 같은 Cloud Run execution의 재시도: run_token만 교체해 이전 attempt를 fence.
  update public.video_analyses
  set run_token = gen_random_uuid(),
      attempt_count = attempt_count + 1
  where id = p_id
    and status = 'processing'
    and execution_id = p_execution_id
  returning * into v_row;

  -- 3) 위 두 UPDATE 모두 못 찾으면(다른 execution/terminal 상태/존재하지 않음) null.
  return v_row;
end;
$$;

comment on function public.acquire_video_analysis_run(uuid, text) is
  'STEP 4-3A (0011): launcher/worker가 실행권을 획득하는 CAS. service_role 전용. '
  'p_execution_id로 "같은 Cloud Run execution의 재시도"와 "다른 execution"을 구분한다. '
  '최초 acquire는 queued→processing, 같은 execution 재시도는 run_token만 재발급, '
  '다른 execution/terminal 상태는 null — 호출자는 null이면 즉시 종료해야 한다.';

revoke all on function public.acquire_video_analysis_run(uuid, text) from public;
revoke all on function public.acquire_video_analysis_run(uuid, text) from anon;
revoke all on function public.acquire_video_analysis_run(uuid, text) from authenticated;
grant execute on function public.acquire_video_analysis_run(uuid, text) to service_role;
