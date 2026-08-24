-- ============================================================
-- YouTube Planner — 0006 video_analyses RPC / SECURITY DEFINER 함수
-- STEP 4-1
--
-- 함수 7개:
--   1. create_video_analysis            — authenticated (분석 생성)
--   2. mark_video_analysis_uploaded     — authenticated (업로드 완료 확정)
--   3. cancel_video_analysis            — authenticated (사용자 취소)
--   4. acquire_video_analysis_run       — service_role 전용 (launcher 실행권 획득)
--   5. update_video_analysis_progress   — service_role 전용 (worker 진행 상태 갱신)
--   6. complete_video_analysis          — service_role 전용 (완료 처리)
--   7. fail_video_analysis              — service_role 전용 (실패 처리)
--
-- plan-step-4-1-db-migration.md 대비 변경 사항 (문서에 남기는 이유, 요청받은 내용):
--   - plan 5-2장은 launcher CAS를 launcher 코드 안의 인라인 SQL로 제안했으나,
--     "launcher 실행권 획득" RPC를 명시적으로 요청받아 acquire_video_analysis_run()
--     으로 캡슐화했습니다. 조건/반환값은 plan과 동일하고 호출 형태만 함수로 바뀌었습니다.
--   - Postgres는 함수 생성 시 기본적으로 EXECUTE 권한을 PUBLIC에 부여합니다
--     (테이블과 달리 함수는 기본이 "허용"입니다). plan 문서의 grants 예시는
--     authenticated/anon에 대한 grant/revoke만 다뤄 이 기본값을 명시적으로
--     닫지 않았습니다 — 이번 구현에서 모든 함수에 `revoke ... from public`을
--     선행시켜 이 gap을 막았습니다(0009에서도 동일하게 재확인).
--   - (2026-08-24 지시로 추가) create_video_analysis의 멱등 처리를
--     "SELECT 존재 확인 → 없으면 INSERT" 방식에서 INSERT ... ON CONFLICT ...
--     DO NOTHING + 충돌 시 재조회 방식으로 교체했습니다. 이전 방식은 동시에
--     들어온 두 요청이 모두 "존재하지 않음"을 보고 INSERT를 시도할 경우 한쪽이
--     unique_violation 예외를 받을 수 있는 실제 race였습니다(문서/보고서에서만
--     "멱등"이라 주장했을 뿐 SQL 레벨에서 원자적으로 보장되지 않았던 문제).
--   - (2026-08-24 지시로 추가) worker의 진행 상태 갱신/완료/실패 처리를 service_role의
--     "직접 UPDATE + WHERE run_token = ... 을 개발자가 붙이기로 약속"하는 방식에서
--     3개의 SECURITY DEFINER RPC(update_video_analysis_progress/complete_video_analysis/
--     fail_video_analysis)로 캡슐화했습니다. 각 함수 본문에 `run_token`+`status='processing'`
--     조건이 고정돼 있어, 이제는 "worker가 조건을 지키기로 약속한 애플리케이션 수준
--     관례"가 아니라 실제 DB 레벨 invariant입니다 — 이 함수를 거치지 않는 한 어떤
--     경로로도 조건 없이 결과를 덮어쓸 수 없습니다.
--
-- Supabase SQL Editor에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다
-- (create or replace function).
--
-- 주의: 이 파일은 아직 production에 적용되지 않았습니다 (STEP 4-1 승인 대기).
-- ============================================================


-- ------------------------------------------------------------
-- 1. create_video_analysis — 유일한 생성 경로 (authenticated)
--
-- 이 테이블에는 일반 INSERT RLS 정책을 만들지 않습니다(0007 참고).
-- SECURITY DEFINER 함수만이 행을 생성할 수 있고, 그 안에서:
--   - client_request_id로 멱등 처리 (이미 있으면 새로 안 만들고 그 행을 반환)
--   - channel_id 소유권 확인 (plan 8장 — 다른 사용자의 채널을 연결 못 하게)
--   - storage_path 계산 (클라이언트가 값을 지정하는 경로 자체가 없음)
-- 를 전부 담당합니다.
--
-- channel_id는 이후 어떤 경로로도 변경되지 않으므로(0007에 UPDATE 정책이 없고,
-- 다른 두 authenticated RPC도 channel_id를 건드리지 않음) 소유권 확인은
-- 생성 시점 1회로 충분합니다 — composite FK나 트리거를 별도로 두지 않는 이유입니다.
-- ------------------------------------------------------------
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

  -- channel_id 소유권 확인. 다른 사용자의 channel_id를 넘기면 여기서 즉시 실패.
  if p_channel_id is not null and not exists (
    select 1 from public.channels
    where id = p_channel_id and user_id = v_user_id
  ) then
    raise exception 'channel not found or not owned by caller';
  end if;

  v_id := gen_random_uuid();

  -- 원자적 멱등 생성 (2026-08-24 지시로 수정).
  -- 이전 구현은 "SELECT 존재 확인 → 없으면 INSERT" 순서였습니다. 두 요청이
  -- 거의 동시에 들어오면 둘 다 "존재하지 않음"을 본 뒤 INSERT를 시도해, 한쪽이
  -- unique_violation 예외를 받을 수 있는 실제 race였습니다 — "멱등"이라는
  -- 서술과 달리 SQL 레벨에서 원자적으로 보장되지 않았습니다.
  --
  -- INSERT ... ON CONFLICT (user_id, client_request_id) WHERE client_request_id
  -- is not null DO NOTHING은 video_analyses_user_client_request_key(0005의
  -- partial unique index)를 정확히 대상으로 합니다. Postgres는 동일 대상에
  -- 대한 동시 INSERT를 내부적으로 직렬화해서 처리하므로(두 번째 트랜잭션은
  -- 첫 번째가 끝날 때까지 대기했다가 충돌을 조용히 감지), 어느 세션에서도
  -- unique_violation 예외가 나지 않습니다.
  --
  -- p_client_request_id가 null이면 이 partial index의 대상이 아니므로
  -- (인덱스 조건 자체가 client_request_id is not null) 충돌이 발생할 수 없고
  -- 항상 새 행이 만들어집니다 — 멱등 키를 쓰지 않는 호출은 원래 설계대로
  -- 매번 새 분석을 만듭니다.
  insert into public.video_analyses (id, user_id, channel_id, genre,
                                      storage_path, client_request_id)
  values (
    v_id, v_user_id, p_channel_id, p_genre,
    v_user_id::text || '/' || v_id::text || '/original.mp4',
    p_client_request_id
  )
  on conflict (user_id, client_request_id) where client_request_id is not null
  do nothing
  returning * into v_row;

  if found then
    return v_row;
  end if;

  -- 여기 도달 = client_request_id가 not null이면서 동시에(또는 이전에) 같은
  -- 값으로 만든 행이 이미 있어 충돌했다는 뜻. 그 행을 그대로 반환합니다.
  -- (동시 요청은 "같은 논리적 요청의 재시도"라고 가정합니다 — genre/channel_id가
  -- 실제로 다른 두 요청이 같은 client_request_id를 재사용하는 경우는 호출자
  -- 책임이며, 이 함수는 먼저 커밋된 행을 그대로 반환합니다.)
  select * into v_row
  from public.video_analyses
  where user_id = v_user_id
    and client_request_id = p_client_request_id;

  if not found then
    -- 이론상 도달 불가능(충돌은 났는데 대상 행이 없음) — 방어적 예외.
    raise exception 'internal error: conflicting client_request_id row not found after insert conflict';
  end if;

  return v_row;
end;
$$;

comment on function public.create_video_analysis(text, uuid, uuid) is
  'STEP 4-1: 영상 분석 행을 생성하는 유일한 경로. authenticated 전용. '
  'client_request_id로 원자적 멱등(INSERT ... ON CONFLICT), channel_id 소유권을 내부에서 확인한다.';


-- ------------------------------------------------------------
-- 2. mark_video_analysis_uploaded — 업로드 완료 확정 (authenticated)
--
-- 소유권 + 현재 상태(pending)뿐 아니라, Storage에 실제로 파일이 존재하는지까지
-- 확인한 뒤에만 'uploaded'로 전이합니다. file_size_bytes는 클라이언트 주장이
-- 아니라 storage.objects의 메타데이터에서 직접 읽어옵니다.
--
-- storage.objects.metadata jsonb에서 파일 크기는 `size` 키로 읽습니다
-- (2026-08-24 지시로 재확인 후 단순화). 이전에는 supabase/storage 저장소의
-- ObjectMetadata 타입(소스 코드) 하나만 근거로 `size`/`contentLength` 두 키를
-- coalesce로 방어적으로 읽었는데, 이번에 Supabase 공식 문서
-- (Platform → Manage your usage → Storage size)의 실제 운영 SQL 예시를
-- 확인한 결과 `(metadata->>'size')::int` 형태만 사용되고 있고 `contentLength`는
-- 이 문서 어디에도 언급되지 않습니다. `contentLength`는 storage-api 내부
-- 구현에서 쓰이는 값일 뿐 문서화된 공개 계약이 아니라고 판단해, 근거 없는
-- fallback을 제거하고 공식 문서와 동일하게 `size` 키만 사용합니다.
-- 출처: https://supabase.com/docs/guides/platform/manage-your-usage/storage-size
--
-- ⚠️ 그래도 이 프로젝트가 실제로 붙어있는 Supabase 인스턴스의 storage.objects
-- 행을 직접 조회해 확인한 것은 아직 아닙니다(공식 문서 확인 ≠ 이 프로젝트에서의
-- 실측). **적용 전 검증 유지**: 테스트 업로드 1건 후 아래 SQL로 실제 키를
-- 재확인하십시오.
--   select metadata from storage.objects where bucket_id = 'videos' limit 1;
-- 만약 실제 키가 다르면 이 함수의 `size` 부분만 수정하면 되고, 다른 부분에는
-- 영향이 없습니다.
--
-- MIME/코덱의 최종 신뢰 판단은 여기서 하지 않습니다 — Postgres 함수 안에서
-- 미디어 파일을 직접 분석하지 않으며, 그 검증은 이후 FFmpeg 파이프라인(ffprobe)의
-- 몫입니다(plan 7-2장 원칙 그대로).
-- ------------------------------------------------------------
create or replace function public.mark_video_analysis_uploaded(p_id uuid)
returns public.video_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.video_analyses;
  v_object record;
  v_size   bigint;
begin
  -- 행을 잠그고 소유권 + 현재 상태 확인. 동시 호출 레이스를 막기 위해
  -- select ... for update로 잠근 뒤에만 storage.objects를 조회합니다.
  select * into v_row
  from public.video_analyses
  where id = p_id
    and user_id = (select auth.uid())
    and status = 'pending'
  for update;

  if not found then
    return null; -- 소유가 아니거나 이미 다른 상태로 전이됨 — 멱등하게 null, 에러 아님
  end if;

  -- 클라이언트 주장이 아니라 Storage가 기록한 사실을 확인.
  -- 예상 storage_path(v_row.storage_path)와 정확히 일치하는 오브젝트만 인정합니다.
  select * into v_object
  from storage.objects
  where bucket_id = 'videos'
    and name = v_row.storage_path;

  if not found then
    return null; -- 업로드가 실제로 끝나지 않음(또는 다른 경로에 올라감)
  end if;

  v_size := (v_object.metadata ->> 'size')::bigint;

  update public.video_analyses
  set status = 'uploaded',
      file_size_bytes = v_size
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.mark_video_analysis_uploaded(uuid) is
  'STEP 4-1: 업로드 완료를 확정한다. authenticated 전용. storage.objects에 '
  '실제 파일이 존재하는지 확인 후에만 pending→uploaded 전이하고 file_size_bytes를 '
  'Storage 메타데이터에서 채운다. MIME/코덱 최종 검증은 하지 않는다(ffprobe의 몫).';


-- ------------------------------------------------------------
-- 3. cancel_video_analysis — 사용자 취소 (authenticated)
-- ------------------------------------------------------------
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

  return v_row; -- 조건 불일치(다른 사람 소유 또는 이미 processing 이후)면 null
end;
$$;

comment on function public.cancel_video_analysis(uuid) is
  'STEP 4-1: 사용자가 자기 분석을 취소한다. authenticated 전용. '
  'pending/uploaded/queued 상태에서만 가능 — processing 이후는 협조적 취소(plan 4장)로만.';


-- ------------------------------------------------------------
-- 4. acquire_video_analysis_run — launcher 실행권 획득 (service_role 전용)
--
-- Cloud Tasks가 launcher를 중복 호출해도 Cloud Run Job 자체는 한 번만 시작되도록
-- 만드는 핵심 함수입니다(plan 5-2장, idempotency B 계층). launcher는 반드시
-- jobs.run()을 호출하기 *전에* 이 함수를 호출해야 하고, 반환값이 null이면
-- (= 영향받은 행이 0개) Job을 절대 시작하면 안 됩니다.
--
-- authenticated/anon에는 EXECUTE를 부여하지 않습니다 — Cloud Run launcher처럼
-- service_role로 접속하는 신뢰된 서버 컨텍스트만 호출해야 합니다(0009 grants 참고).
-- ------------------------------------------------------------
create or replace function public.acquire_video_analysis_run(p_id uuid)
returns public.video_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.video_analyses;
begin
  update public.video_analyses
  set status = 'processing',
      started_at = now(),
      run_token = gen_random_uuid(),
      attempt_count = attempt_count + 1
  where id = p_id
    and status = 'queued'
  returning * into v_row;

  -- null이면 이미 다른 launcher 호출/실행이 이 행을 선점한 것.
  -- 호출자(launcher)는 이 경우 jobs.run()을 호출하지 않고 즉시 종료해야 한다.
  return v_row;
end;
$$;

comment on function public.acquire_video_analysis_run(uuid) is
  'STEP 4-1: launcher가 Cloud Run Job을 시작하기 직전에 호출하는 실행권 획득 CAS. '
  'service_role 전용. null 반환 시 호출자는 Job을 시작하면 안 된다.';


-- ------------------------------------------------------------
-- 5. update_video_analysis_progress — worker 진행 상태 갱신 (service_role 전용)
--
-- (2026-08-24 지시로 신규 추가) 이전 구현은 이 갱신을 service_role이 애플리케이션
-- 코드에서 직접 UPDATE ... WHERE run_token = ... 형태로 하도록 "가정"했습니다.
-- 이는 개발자가 그 WHERE 절을 빠뜨리지 않기로 약속한 것일 뿐 DB가 강제하는
-- 것이 아니었습니다. 이 함수는 run_token+status='processing' 조건을 함수 본문에
-- 고정해, 어떤 호출 경로에서도 그 조건을 우회할 수 없게 만듭니다.
-- ------------------------------------------------------------
create or replace function public.update_video_analysis_progress(
  p_id uuid,
  p_run_token uuid,
  p_stage text,
  p_progress smallint
)
returns public.video_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.video_analyses;
begin
  update public.video_analyses
  set current_stage = p_stage,
      progress = p_progress
  where id = p_id
    and run_token = p_run_token
    and status = 'processing'
  returning * into v_row;

  -- null이면 run_token 불일치(오래된/좀비 실행) 또는 이미 종료된 실행.
  -- 호출자(worker)는 이 경우 자신의 실행이 더 이상 유효하지 않다고 간주해야 한다.
  return v_row;
end;
$$;

comment on function public.update_video_analysis_progress(uuid, uuid, text, smallint) is
  'STEP 4-1 (2026-08-24 추가): worker 진행 상태 갱신. service_role 전용. '
  'id+run_token+status=processing이 모두 일치할 때만 1행 반영 — DB 수준 invariant.';


-- ------------------------------------------------------------
-- 6. complete_video_analysis — 완료 처리 (service_role 전용)
--
-- (2026-08-24 지시로 신규 추가) run_token+status='processing' 조건이 함수 본문에
-- 고정돼 있어, 오래된 worker나 Cloud Tasks/Cloud Run의 뒤늦은 retry가 이미
-- completed/failed로 끝난 분석 결과를 덮어쓸 수 없다.
-- ------------------------------------------------------------
create or replace function public.complete_video_analysis(
  p_id uuid,
  p_run_token uuid,
  p_report jsonb,
  p_raw_metrics jsonb default null,
  p_duration_sec numeric default null
)
returns public.video_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.video_analyses;
begin
  update public.video_analyses
  set status = 'completed',
      progress = 100,
      finished_at = now(),
      report = p_report,
      raw_metrics = coalesce(p_raw_metrics, raw_metrics),
      duration_sec = coalesce(p_duration_sec, duration_sec)
  where id = p_id
    and run_token = p_run_token
    and status = 'processing'
  returning * into v_row;

  -- null이면 오래된/좀비 worker의 뒤늦은 완료 시도 — 이미 완료/실패/취소된
  -- 분석의 결과를 덮어쓰지 않는다. video_analyses_completed_has_report_check
  -- 제약이 이 함수를 우회한 completed 전이 자체를 추가로 막아준다.
  return v_row;
end;
$$;

comment on function public.complete_video_analysis(uuid, uuid, jsonb, jsonb, numeric) is
  'STEP 4-1 (2026-08-24 추가): 분석 완료 처리. service_role 전용. '
  'id+run_token+status=processing 조건이 함수 본문에 고정돼 있어, 오래된 실행/재시도가 '
  '이미 끝난 분석 결과를 덮어쓸 수 없다 — DB 수준 invariant.';


-- ------------------------------------------------------------
-- 7. fail_video_analysis — 실패 처리 (service_role 전용)
-- ------------------------------------------------------------
create or replace function public.fail_video_analysis(
  p_id uuid,
  p_run_token uuid,
  p_error_code text,
  p_error_message text default null
)
returns public.video_analyses
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.video_analyses;
begin
  update public.video_analyses
  set status = 'failed',
      finished_at = now(),
      error_code = p_error_code,
      error_message = p_error_message
  where id = p_id
    and run_token = p_run_token
    and status = 'processing'
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.fail_video_analysis(uuid, uuid, text, text) is
  'STEP 4-1 (2026-08-24 추가): 분석 실패 처리. service_role 전용. '
  'id+run_token+status=processing 조건이 함수 본문에 고정돼 있어, 오래된 실행/재시도가 '
  '이미 끝난 분석 결과를 덮어쓸 수 없다 — DB 수준 invariant.';
