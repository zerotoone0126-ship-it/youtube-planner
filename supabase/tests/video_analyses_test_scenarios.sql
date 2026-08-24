-- ============================================================
-- YouTube Planner — video_analyses 마이그레이션 검증 테스트
-- STEP 4-1
--
-- ⚠️ 로컬/스테이징 전용입니다. production에서 절대 실행하지 마세요 —
-- 이 스크립트는 테스트용 auth.users 행을 직접 만듭니다.
--
-- 실행 전제: 0005~0009가 이미 적용된 데이터베이스.
-- pgTAP 등 별도 테스트 프레임워크는 이 프로젝트에 설치돼 있지 않으므로
-- (supabase/config.toml 자체가 없음 — research 4장), 어떤 Postgres 클라이언트
-- (Supabase SQL Editor, psql 등)에서도 그대로 실행 가능한 순수 SQL + PL/pgSQL
-- DO 블록 방식으로 작성했습니다.
--
-- ⚠️ 역할 전환 방식에 대한 설계 노트: PL/pgSQL DO 블록/함수 안에서는 SET ROLE을
-- 직접 실행할 수 없습니다(EXECUTE로 감싸도 role 전환이 함수 실행 컨텍스트에서
-- 기대대로 반영되지 않는 사례가 보고되어 있음 — PostgreSQL 메일링리스트
-- "SET LOCAL ROLE inside SECURITY INVOKER (LANGUAGE plpgsql) function" 참고).
-- 그래서 이 스크립트는 SET ROLE / RESET ROLE과 auth.uid() 시뮬레이션용
-- set_config()를 항상 DO 블록 "바깥"의 최상위 SQL 문으로 실행하고, DO 블록
-- 안에는 순수 테스트 로직(RPC 호출, 검증)만 둡니다. set_config는 세 번째
-- 인자를 true(트랜잭션 로컬)가 아니라 false(세션 레벨)로 줘서, 클라이언트가
-- 각 statement를 별도 트랜잭션으로 자동 커밋하더라도(psql/SQL Editor의
-- 정확한 트랜잭션 경계는 클라이언트마다 다를 수 있음) 세션이 끝나기 전까지는
-- 값이 유지되도록 했습니다.
--
-- 사용 방법: 위에서부터 순서대로 전체를 실행하십시오. 중간에 에러 없이
-- 끝까지 실행되면 모든 시나리오가 기대한 대로 동작한 것입니다. 각 DO 블록은
-- 성공 시 `RAISE NOTICE 'PASS: ...'`를 출력합니다.
--
-- 정리(clean-up)는 맨 마지막 섹션에 있습니다 — 반드시 실행해 테스트 데이터를
-- 남기지 마십시오.
--
-- 각 시나리오가 어떤 요청 항목에 대응하는지 주석에 명시했습니다.
-- ============================================================


-- ============================================================
-- 0. SETUP — 테스트 fixture
-- ============================================================

create temporary table _t_fixtures (
  key   text primary key,
  value text
);

-- 이 임시 테이블은 (superuser/postgres 등) 이 스크립트를 실행하는 role이 소유합니다.
-- 이후 SET ROLE authenticated/service_role로 전환해서 이 테이블을 읽고 쓰므로,
-- 명시적으로 grant하지 않으면 "permission denied for table _t_fixtures"가 납니다
-- (실제로 이 스크립트를 하네스에서 실행해 보고 발견/수정한 문제 — 2026-08-24).
grant select, insert, update, delete on _t_fixtures to authenticated, service_role;

-- 테스트용 사용자 2명. auth.identities는 만들지 않습니다 — 실제 로그인 흐름을
-- 테스트하는 것이 아니라 auth.uid()를 세션에서 직접 시뮬레이션하기 때문입니다.
do $$
declare
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-user-a@example.invalid', 'x', now(), '{}', '{}', now(), now()),
    (v_user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'test-user-b@example.invalid', 'x', now(), '{}', '{}', now(), now());

  insert into _t_fixtures (key, value) values
    ('user_a', v_user_a::text),
    ('user_b', v_user_b::text);

  raise notice 'PASS: 0 — 테스트 사용자 2명 생성';
end;
$$;

-- user_a 컨텍스트로 전환 (최상위 SQL문 — DO 블록 밖에서 실행)
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

-- categories는 기본값('{}')이 자체 CHECK(cardinality 1~2)를 위반하므로
-- 반드시 명시적으로 넣어야 함 (0001_init_tables.sql의 기존 제약 확인 결과).
do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_channel_a uuid;
begin
  insert into public.channels (user_id, categories, video_style, primary_goal, description, upload_frequency)
  values (v_user_a, array['정보'], 'shorts', 'views', '테스트 채널 설명입니다 최소 10자 이상.', 'w1')
  returning id into v_channel_a;

  insert into _t_fixtures (key, value) values ('channel_a', v_channel_a::text);

  raise notice 'PASS: 0 — user_a 소유 channel 생성 (%)', v_channel_a;
end;
$$;

reset role;


-- ============================================================
-- 1. 정상 흐름 (happy path) — user_a
-- ============================================================

-- 1-1. 로그인 사용자 analysis 생성
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_channel_a uuid := (select value::uuid from _t_fixtures where key = 'channel_a');
  v_row public.video_analyses;
  v_req_id uuid := gen_random_uuid();
begin
  v_row := public.create_video_analysis('game', v_channel_a, v_req_id);

  if v_row.id is null or v_row.status <> 'pending' or v_row.user_id <> v_user_a
     or v_row.storage_path <> v_user_a::text || '/' || v_row.id::text || '/original.mp4' then
    raise exception 'FAIL: 1-1 create_video_analysis 결과가 기대와 다름: %', v_row;
  end if;

  insert into _t_fixtures (key, value) values
    ('analysis_id', v_row.id::text),
    ('client_request_id', v_req_id::text);

  raise notice 'PASS: 1-1 — analysis 생성 성공 (id=%, storage_path=%)', v_row.id, v_row.storage_path;
end;
$$;

reset role;

-- 1-2. storage upload (실제 업로드를 시뮬레이션 — Storage 백엔드가 업로드 완료 시
--      만드는 storage.objects 행을 대신 삽입한다. metadata 키는 Supabase 공식
--      문서(guides/platform/manage-your-usage/storage-size)의 `size` 키 기준
--      — 0006 함수 주석 참고. 2026-08-24 지시로 SELECT 정책이 추가되었으므로
--      이 테스트도 함께 갱신했습니다.)
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_path text := v_user_a::text || '/' || v_analysis_id::text || '/original.mp4';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('videos', v_path, v_user_a::text,
          jsonb_build_object('size', 12345678, 'mimetype', 'video/mp4', 'eTag', 'test-etag'));

  raise notice 'PASS: 1-2 — 본인 경로에 storage object INSERT가 예외 없이 통과함 (RLS insert 정책 확인)';
end;
$$;

-- 1-2b. 방금 만든 오브젝트를 같은 authenticated 컨텍스트(role 유지)에서 SELECT로
-- 재확인 (2026-08-24 신규 — video_objects_select_own_while_pending 정책 검증).
-- 실제 Supabase Storage API는 INSERT ... RETURNING *로 메타데이터를 클라이언트에
-- 돌려주므로, 이 SELECT가 실패하면 실제 환경에서는 업로드가 403으로 실패합니다
-- (0007 B-2 주석의 공식 troubleshooting 문서 근거 참고).
do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_path text := v_user_a::text || '/' || v_analysis_id::text || '/original.mp4';
  v_metadata jsonb;
begin
  select metadata into v_metadata
  from storage.objects
  where bucket_id = 'videos' and name = v_path;

  if v_metadata is null or (v_metadata ->> 'size')::bigint <> 12345678 then
    raise exception 'FAIL: 1-2b 업로더 본인이 방금 만든 pending 오브젝트를 SELECT로 볼 수 없음(또는 메타데이터 불일치): %', v_metadata;
  end if;

  raise notice 'PASS: 1-2b — 업로더 본인은 pending 상태인 자기 오브젝트를 SELECT로 볼 수 있음 (RETURNING 시뮬레이션)';
end;
$$;

-- 1-2c. 아직 pending인 상태에서 같은 경로에 UPDATE(덮어쓰기) 시도 → 0행
-- (2026-08-24 신규 — UPDATE 정책을 완전히 제거했으므로, 이전 설계와 달리
-- "pending 동안은 허용"이 아니라 pending이든 아니든 항상 거부되어야 합니다.
-- storage.objects의 UPDATE 테이블 권한 자체는 Supabase가 authenticated에게
-- 기본적으로 부여해 두므로(RLS가 실질적 게이트), 정책 부재는 permission denied가
-- 아니라 RLS 0행으로 나타납니다 — video_analyses 테이블과는 다른 권한 모델임에
-- 유의.)
do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_path text := v_user_a::text || '/' || v_analysis_id::text || '/original.mp4';
  v_affected int;
begin
  update storage.objects
  set metadata = jsonb_build_object('size', 1, 'mimetype', 'video/mp4')
  where bucket_id = 'videos' and name = v_path;

  get diagnostics v_affected = row_count;
  if v_affected <> 0 then
    raise exception 'FAIL: 1-2c pending 상태에서도 UPDATE(덮어쓰기)가 반영됨 — UPDATE 정책이 없어야 함';
  end if;

  raise notice 'PASS: 1-2c — UPDATE 정책이 없으므로 pending 상태에서도 덮어쓰기가 거부됨 (0행)';
end;
$$;

reset role;

-- 1-3. upload 완료 확정
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_row public.video_analyses;
begin
  v_row := public.mark_video_analysis_uploaded(v_analysis_id);

  if v_row.status <> 'uploaded' or v_row.file_size_bytes <> 12345678 then
    raise exception 'FAIL: 1-3 mark_video_analysis_uploaded 결과가 기대와 다름: %', v_row;
  end if;

  raise notice 'PASS: 1-3 — 업로드 완료 확정, file_size_bytes=%가 Storage 메타데이터에서 채워짐', v_row.file_size_bytes;
end;
$$;

reset role;

-- 1-3b. 업로드 완료(status가 pending을 벗어남) 이후에는 본인이라도 더 이상 그
-- 오브젝트를 SELECT로 볼 수 없어야 함 (2026-08-24 신규 — "영구적인 광범위 SELECT
-- 권한은 주지 않는다"는 요청을 실제로 검증. video_objects_select_own_while_pending
-- 정책의 pending 조건이 정확히 이 시점부터 막는지 확인합니다.)
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_path text := v_user_a::text || '/' || v_analysis_id::text || '/original.mp4';
  v_count int;
begin
  select count(*) into v_count
  from storage.objects
  where bucket_id = 'videos' and name = v_path;

  if v_count <> 0 then
    raise exception 'FAIL: 1-3b 업로드 완료 이후에도 본인이 원본 오브젝트를 SELECT로 볼 수 있음 (영구 SELECT 권한 누수)';
  end if;

  raise notice 'PASS: 1-3b — 업로드 완료 이후에는 본인도 원본 오브젝트를 SELECT할 수 없음 (pending 조건 만료, 영구 다운로드 권한 없음)';
end;
$$;

reset role;

-- 1-4. queued 전환 (서버 신뢰 컨텍스트 — 이 전이에는 RPC가 없고 authenticated에도
--      UPDATE 정책이 없으므로 service_role로만 가능함을 그대로 재현)
set role service_role;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
begin
  update public.video_analyses set status = 'queued' where id = v_analysis_id;

  if (select status from public.video_analyses where id = v_analysis_id) <> 'queued' then
    raise exception 'FAIL: 1-4 queued 전환 실패';
  end if;

  raise notice 'PASS: 1-4 — service_role로 queued 전환 성공';
end;
$$;

reset role;

-- 1-5. launcher CAS 성공
set role service_role;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_row public.video_analyses;
begin
  v_row := public.acquire_video_analysis_run(v_analysis_id);

  if v_row.id is null or v_row.status <> 'processing' or v_row.run_token is null or v_row.attempt_count <> 1 then
    raise exception 'FAIL: 1-5 acquire_video_analysis_run 결과가 기대와 다름: %', v_row;
  end if;

  insert into _t_fixtures (key, value) values ('run_token_1', v_row.run_token::text);

  raise notice 'PASS: 1-5 — launcher CAS 성공, run_token=% 발급', v_row.run_token;
end;
$$;

reset role;

-- 1-6. 올바른 run_token으로 worker 진행 상태 갱신
-- (2026-08-24 지시로 변경: 원시 UPDATE 대신 update_video_analysis_progress RPC 경유.
--  이 RPC가 없으면 "run_token 조건은 개발자가 붙이기로 약속한 것"일 뿐 DB가
--  강제하는 게 아니라는 지적을 받아 0006에 함수로 캡슐화했습니다.)
set role service_role;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_token uuid := (select value::uuid from _t_fixtures where key = 'run_token_1');
  v_result public.video_analyses;
begin
  v_result := public.update_video_analysis_progress(v_analysis_id, v_token, 'ffmpeg', 30::smallint);

  if v_result.id is null or v_result.current_stage <> 'ffmpeg' or v_result.progress <> 30 then
    raise exception 'FAIL: 1-6 update_video_analysis_progress 결과가 기대와 다름: %', v_result;
  end if;

  raise notice 'PASS: 1-6 — 올바른 run_token으로 진행 상태 갱신 성공 (RPC 경유, DB-level invariant)';
end;
$$;

reset role;

-- 1-7. completed (2026-08-24 지시로 변경: complete_video_analysis RPC 경유)
set role service_role;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_token uuid := (select value::uuid from _t_fixtures where key = 'run_token_1');
  v_result public.video_analyses;
begin
  v_result := public.complete_video_analysis(
    v_analysis_id, v_token,
    jsonb_build_object('schema_version', 1, 'pipeline_version', 'v1', 'observations', '[]'::jsonb)
  );

  if v_result.id is null or v_result.status <> 'completed' then
    raise exception 'FAIL: 1-7 complete_video_analysis 결과가 기대와 다름: %', v_result;
  end if;

  raise notice 'PASS: 1-7 — completed 전이 성공 (RPC 경유, DB-level invariant)';
end;
$$;

reset role;


-- ============================================================
-- 2. 보안 — 전부 실패(거부)해야 함
-- ============================================================

-- 2-1. 다른 user의 analysis SELECT → 0행
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_b'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_count int;
begin
  select count(*) into v_count from public.video_analyses where id = v_analysis_id;

  if v_count <> 0 then
    raise exception 'FAIL: 2-1 다른 user가 남의 analysis를 조회할 수 있음';
  end if;

  raise notice 'PASS: 2-1 — 다른 user는 남의 analysis를 SELECT할 수 없음 (0행)';
end;
$$;

reset role;

-- 2-2. 다른 user의 channel_id로 생성 시도 → 예외
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_b'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_channel_a uuid := (select value::uuid from _t_fixtures where key = 'channel_a');
  v_failed boolean := false;
begin
  begin
    perform public.create_video_analysis('game', v_channel_a, gen_random_uuid());
  exception when others then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL: 2-2 다른 user의 channel_id로 생성이 성공해버림';
  end if;

  raise notice 'PASS: 2-2 — 다른 user의 channel_id로는 생성 실패 (소유권 검증 동작)';
end;
$$;

reset role;

-- 2-3. 다른 user의 storage path 접근(insert) 시도 → RLS 거부
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_b'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_user_b uuid := (select value::uuid from _t_fixtures where key = 'user_b');
  v_failed boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('videos', v_user_a::text || '/' || gen_random_uuid()::text || '/original.mp4',
            v_user_b::text, '{}'::jsonb);
  exception when others then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL: 2-3 다른 user의 폴더에 오브젝트를 만들 수 있음';
  end if;

  raise notice 'PASS: 2-3 — 다른 user의 storage path에는 insert 불가 (RLS 거부)';
end;
$$;

reset role;

-- 2-4. 사용자가 status/report를 직접 UPDATE 시도 → 권한 오류
-- (2026-08-24 지시로 수정한 실제 동작: 이 테이블은 UPDATE 정책이 없을 뿐 아니라
-- 애초에 authenticated에게 UPDATE 테이블 권한(GRANT) 자체를 준 적이 없습니다
-- (0009 참고 — insert/update/delete를 아예 grant하지 않음). 그 결과 RLS가
-- "조용히 0행"으로 걸러내기 전에, Postgres 권한 시스템이 먼저
-- "permission denied for table video_analyses"로 하드 에러를 냅니다. 이전
-- 버전의 이 테스트는 "0행"을 기대했는데, 실제로 하네스에서 실행해 보니 권한
-- 자체가 없어 예외가 난다는 걸 확인했습니다 — 오히려 RLS 0행보다 더 강한
-- 차단(권한 계층에서부터 막힘)이므로 목적(사용자가 직접 못 바꾼다)은 동일하게
-- 달성되고, 테스트만 그 실제 동작에 맞게 수정합니다.
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_failed boolean := false;
begin
  begin
    update public.video_analyses
    set status = 'failed', report = '{"fake":"data"}'::jsonb
    where id = v_analysis_id;
  exception when insufficient_privilege then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL: 2-4 사용자가 자기 analysis의 status/report를 직접 UPDATE할 수 있음';
  end if;

  raise notice 'PASS: 2-4 — 사용자는 status/report를 직접 UPDATE할 수 없음 (UPDATE 테이블 권한 자체가 없음, permission denied)';
end;
$$;

reset role;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
begin
  if (select status from public.video_analyses where id = v_analysis_id) <> 'completed' then
    raise exception 'FAIL: 2-4 status가 실제로 바뀜 (1-7에서 completed로 끝났어야 함)';
  end if;
  raise notice 'PASS: 2-4 (재확인) — status가 UPDATE 시도 전후로 변하지 않음';
end;
$$;

-- 2-5. 사용자가 service-only RPC(acquire_video_analysis_run) 실행 시도 → 권한 오류
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_failed boolean := false;
begin
  begin
    perform public.acquire_video_analysis_run(v_analysis_id);
  exception when others then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL: 2-5 authenticated가 service_role 전용 RPC를 실행할 수 있음';
  end if;

  raise notice 'PASS: 2-5 — authenticated는 acquire_video_analysis_run을 실행할 수 없음 (EXECUTE grant 없음)';
end;
$$;

reset role;

-- 2-6/2-7/2-8. authenticated가 worker 전용 RPC 3개를 실행 시도 → 전부 권한 오류
-- (2026-08-24 지시로 신규 추가 — worker 쓰기를 RPC로 캡슐화한 것과 짝을 이루는 보안 테스트.
--  EXECUTE 권한 검사는 함수 본문 진입 전에 이뤄지므로 인자 값 자체는 임의여도 됨.)
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.update_video_analysis_progress(gen_random_uuid(), gen_random_uuid(), 'x', 0::smallint);
  exception when others then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL: 2-6 authenticated가 update_video_analysis_progress를 실행할 수 있음';
  end if;

  raise notice 'PASS: 2-6 — authenticated는 update_video_analysis_progress를 실행할 수 없음 (EXECUTE grant 없음)';
end;
$$;

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.complete_video_analysis(gen_random_uuid(), gen_random_uuid(), '{}'::jsonb);
  exception when others then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL: 2-7 authenticated가 complete_video_analysis를 실행할 수 있음';
  end if;

  raise notice 'PASS: 2-7 — authenticated는 complete_video_analysis를 실행할 수 없음 (EXECUTE grant 없음)';
end;
$$;

do $$
declare
  v_failed boolean := false;
begin
  begin
    perform public.fail_video_analysis(gen_random_uuid(), gen_random_uuid(), 'internal_error', null);
  exception when others then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL: 2-8 authenticated가 fail_video_analysis를 실행할 수 있음';
  end if;

  raise notice 'PASS: 2-8 — authenticated는 fail_video_analysis를 실행할 수 없음 (EXECUTE grant 없음)';
end;
$$;

reset role;

-- 2-9. 사용자가 본인의 completed 분석 행을 직접 DELETE 시도 → 권한 오류
-- (2026-08-24 지시로 신규 추가 — video_analyses DELETE 정책 및 DELETE grant를
-- 완전히 제거한 것을 실제로 검증. 1-7에서 analysis_id는 이미 'completed' 상태.
-- 0009에서 authenticated에게 DELETE 테이블 권한 자체를 주지 않았으므로, 2-4와
-- 마찬가지로 RLS 0행이 아니라 permission denied 하드 에러가 남 — 실제로
-- 하네스에서 실행해 확인.)
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
  v_failed boolean := false;
begin
  begin
    delete from public.video_analyses where id = v_analysis_id;
  exception when insufficient_privilege then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL: 2-9 사용자가 자신의 completed 분석 행을 직접 DELETE할 수 있음';
  end if;

  raise notice 'PASS: 2-9 — 사용자는 completed 행도 직접 삭제할 수 없음 (DELETE 테이블 권한 자체가 없음, orphan storage 방지)';
end;
$$;

reset role;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id');
begin
  if not exists (select 1 from public.video_analyses where id = v_analysis_id) then
    raise exception 'FAIL: 2-9 (재확인) 행이 실제로 사라짐';
  end if;
  raise notice 'PASS: 2-9 (재확인) — 행이 그대로 남아있음';
end;
$$;

-- 2-10. 다른 user의 pending 오브젝트를 SELECT 시도 → 0행
-- (2026-08-24 신규 — video_objects_select_own_while_pending 정책이 "본인 폴더"
-- 조건까지 정확히 강제하는지 검증. user_a가 새 pending 업로드를 만들고,
-- user_b가 경로를 안다고 가정해도 볼 수 없어야 합니다.)
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_channel_a uuid := (select value::uuid from _t_fixtures where key = 'channel_a');
  v_row public.video_analyses;
  v_path text;
begin
  v_row := public.create_video_analysis('game', v_channel_a, gen_random_uuid());
  v_path := v_user_a::text || '/' || v_row.id::text || '/original.mp4';

  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('videos', v_path, v_user_a::text, jsonb_build_object('size', 111, 'mimetype', 'video/mp4'));

  insert into _t_fixtures (key, value) values ('cross_select_analysis_id', v_row.id::text);
end;
$$;

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_b'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'cross_select_analysis_id');
  v_path text := v_user_a::text || '/' || v_analysis_id::text || '/original.mp4';
  v_count int;
begin
  select count(*) into v_count
  from storage.objects
  where bucket_id = 'videos' and name = v_path;

  if v_count <> 0 then
    raise exception 'FAIL: 2-10 다른 user의 pending 오브젝트를 SELECT로 볼 수 있음';
  end if;

  raise notice 'PASS: 2-10 — 다른 user의 pending 오브젝트는 경로를 알아도 SELECT할 수 없음 (0행)';
end;
$$;

reset role;


-- ============================================================
-- 3. 중복 / Retry — 중복 실행/덮어쓰기가 발생하지 않아야 함
-- ============================================================

-- 3-1. 동일 client_request_id로 두 번 생성 → 행 1개만, 같은 행 반환
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_channel_a uuid := (select value::uuid from _t_fixtures where key = 'channel_a');
  v_req_id uuid := gen_random_uuid();
  v_row1 public.video_analyses;
  v_row2 public.video_analyses;
  v_count int;
begin
  v_row1 := public.create_video_analysis('story', v_channel_a, v_req_id);
  v_row2 := public.create_video_analysis('story', v_channel_a, v_req_id);

  if v_row1.id <> v_row2.id then
    raise exception 'FAIL: 3-1 같은 client_request_id인데 다른 행이 생성됨 (% vs %)', v_row1.id, v_row2.id;
  end if;

  select count(*) into v_count from public.video_analyses
  where user_id = v_user_a and client_request_id = v_req_id;

  if v_count <> 1 then
    raise exception 'FAIL: 3-1 client_request_id 기준 행이 %개 (1이어야 함)', v_count;
  end if;

  raise notice 'PASS: 3-1 — 동일 client_request_id 재호출은 새 행을 만들지 않고 기존 행 반환';
end;
$$;

reset role;

-- 3-2. launcher가 같은 행에 대해 두 번 호출(Cloud Task retry 시뮬레이션)
--      → 두 번째 호출은 null (0행 영향), Job을 시작하면 안 된다는 신호
--      ⚠️ 이 스크립트는 단일 세션 순차 실행이라 "완전한 동시 레이스"는 아닙니다.
--      실제 동시성 검증은 두 개의 병렬 DB 세션(psql 두 개, 또는 pgbench)으로
--      스테이징에서 별도 실행해야 합니다 — 여기서는 WHERE status='queued' 가드가
--      존재하고 실제로 상태를 바꾼다는 사실만 확인합니다.
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_channel_a uuid := (select value::uuid from _t_fixtures where key = 'channel_a');
  v_row public.video_analyses;
begin
  v_row := public.create_video_analysis('info', v_channel_a, gen_random_uuid());
  insert into _t_fixtures (key, value) values ('dup_test_analysis_id', v_row.id::text);
end;
$$;

reset role;
set role service_role;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'dup_test_analysis_id');
  v_first public.video_analyses;
  v_second public.video_analyses;
begin
  update public.video_analyses set status = 'queued' where id = v_analysis_id;

  v_first := public.acquire_video_analysis_run(v_analysis_id);   -- 1차 호출: 성공해야 함
  v_second := public.acquire_video_analysis_run(v_analysis_id);  -- 2차(retry) 호출: null이어야 함

  if v_first.id is null then
    raise exception 'FAIL: 3-2 1차 launcher 호출이 실패함';
  end if;
  if v_second.id is not null then
    raise exception 'FAIL: 3-2 2차(retry) launcher 호출이 실행권을 다시 획득함 — 이중 Job 시작 위험';
  end if;

  insert into _t_fixtures (key, value) values ('dup_test_run_token', v_first.run_token::text);

  raise notice 'PASS: 3-2 — 동일 행에 대한 두 번째 launcher 호출은 실행권을 얻지 못함 (0행)';
end;
$$;

reset role;

-- 3-3. stale run_token으로 worker update 시도 → null 반환
-- (2026-08-24 지시로 변경: update_video_analysis_progress RPC 경유)
set role service_role;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'dup_test_analysis_id');
  v_stale_token uuid := gen_random_uuid(); -- 실제 run_token이 아닌 값
  v_result public.video_analyses;
begin
  v_result := public.update_video_analysis_progress(v_analysis_id, v_stale_token, 'stt', 50::smallint);

  if v_result.id is not null then
    raise exception 'FAIL: 3-3 오래된/잘못된 run_token으로도 갱신이 반영됨: %', v_result;
  end if;

  raise notice 'PASS: 3-3 — 잘못된 run_token으로는 갱신이 반영되지 않음 (update_video_analysis_progress가 null 반환)';
end;
$$;

reset role;

-- 3-4. completed 이후 이전 worker가 다시 쓰려는 시도 → null 반환 (결과 덮어쓰기 방지)
-- (2026-08-24 지시로 변경: complete_video_analysis / fail_video_analysis RPC 경유)
set role service_role;

do $$
declare
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'dup_test_analysis_id');
  v_token uuid := (select value::uuid from _t_fixtures where key = 'dup_test_run_token');
  v_result public.video_analyses;
begin
  -- 정상 완료 (RPC 경유)
  v_result := public.complete_video_analysis(
    v_analysis_id, v_token,
    jsonb_build_object('schema_version', 1, 'pipeline_version', 'v1', 'observations', '[]'::jsonb)
  );

  if v_result.id is null or v_result.status <> 'completed' then
    raise exception 'FAIL: 3-4 사전 조건(정상 완료) 실패: %', v_result;
  end if;

  -- 같은(정상적이었던) run_token으로 뒤늦게 실패 처리 시도 — 이미 completed라 조건에 안 걸림
  v_result := public.fail_video_analysis(v_analysis_id, v_token, 'internal_error', '뒤늦은 재시도');

  if v_result.id is not null then
    raise exception 'FAIL: 3-4 completed 이후에도 이전 worker가 결과를 덮어쓸 수 있음: %', v_result;
  end if;

  if (select status from public.video_analyses where id = v_analysis_id) <> 'completed' then
    raise exception 'FAIL: 3-4 status가 completed에서 바뀜';
  end if;

  raise notice 'PASS: 3-4 — completed 이후 같은 run_token의 재시도(fail_video_analysis)도 결과를 덮어쓰지 못함';
end;
$$;

reset role;


-- ============================================================
-- 4. Storage edge case
-- ============================================================

-- 4-1. 파일 없이 upload 완료 RPC 호출 → null
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_channel_a uuid := (select value::uuid from _t_fixtures where key = 'channel_a');
  v_row public.video_analyses;
  v_result public.video_analyses;
begin
  v_row := public.create_video_analysis('game', v_channel_a, gen_random_uuid());
  -- storage.objects에 아무것도 올리지 않은 채로 바로 호출
  v_result := public.mark_video_analysis_uploaded(v_row.id);

  if v_result.id is not null then
    raise exception 'FAIL: 4-1 파일이 없는데도 업로드 완료로 처리됨';
  end if;
  if (select status from public.video_analyses where id = v_row.id) <> 'pending' then
    raise exception 'FAIL: 4-1 status가 pending에서 바뀜';
  end if;

  insert into _t_fixtures (key, value) values ('edge_analysis_id', v_row.id::text);

  raise notice 'PASS: 4-1 — 파일 없이 호출하면 null 반환, 상태는 pending 유지';
end;
$$;

reset role;

-- 4-2. 예상 path와 다른 이름으로 업로드된 object → mark_video_analysis_uploaded는 여전히 null
--      (본인 폴더 안이라 storage insert 자체는 허용되지만, 파일명이 다르므로 RPC가 못 찾음)
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'edge_analysis_id');
  v_wrong_path text := v_user_a::text || '/' || v_analysis_id::text || '/wrong_name.mp4';
  v_result public.video_analyses;
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('videos', v_wrong_path, v_user_a::text, jsonb_build_object('size', 999, 'mimetype', 'video/mp4'));

  v_result := public.mark_video_analysis_uploaded(v_analysis_id);

  if v_result.id is not null then
    raise exception 'FAIL: 4-2 잘못된 파일명의 object로도 업로드 완료 처리됨';
  end if;

  raise notice 'PASS: 4-2 — 예상 경로(original.mp4)와 다른 오브젝트는 업로드 완료로 인정되지 않음';
end;
$$;

reset role;

-- 4-3. 큰 용량(oversized) object — 현재 bucket.file_size_limit이 null(미정)이라
--      버킷 레벨 거부는 검증 불가(plan에서 의도적으로 미확정, 6-1장). 대신
--      file_size_bytes가 클라이언트 주장이 아니라 Storage 메타데이터의 실제 값을
--      오차 없이 그대로 기록하는지(기계적 정확성)만 확인합니다.
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_channel_a uuid := (select value::uuid from _t_fixtures where key = 'channel_a');
  v_row public.video_analyses;
  v_path text;
  v_huge bigint := 53687091200; -- 50GB
  v_result public.video_analyses;
begin
  v_row := public.create_video_analysis('game', v_channel_a, gen_random_uuid());
  v_path := v_user_a::text || '/' || v_row.id::text || '/original.mp4';

  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('videos', v_path, v_user_a::text, jsonb_build_object('size', v_huge, 'mimetype', 'video/mp4'));

  v_result := public.mark_video_analysis_uploaded(v_row.id);

  if v_result.file_size_bytes is distinct from v_huge then
    raise exception 'FAIL: 4-3 file_size_bytes(%)가 실제 메타데이터 값(%)과 다름', v_result.file_size_bytes, v_huge;
  end if;

  raise notice 'PASS: 4-3 — 대용량 값도 Storage 메타데이터 그대로 정확히 기록됨 (버킷 file_size_limit 확정 후 별도 재검증 필요)';
end;
$$;

reset role;

-- 4-4. 업로드 완료 이후 overwrite 시도 → RLS가 UPDATE 거부 (0행)
-- (2026-08-24 갱신: UPDATE 정책 자체를 완전히 제거했으므로, 이 케이스는
-- "pending을 벗어나서" 막히는 게 아니라 애초에 UPDATE 정책이 없어서 항상
-- 막힙니다. pending 동안도 막힌다는 것은 1-2c에서 이미 확인했고, 이 테스트는
-- "완료 이후에도 여전히(당연히) 막힌다"는 것을 재확인합니다.)
select set_config('request.jwt.claims',
  json_build_object('sub', (select value from _t_fixtures where key = 'user_a'), 'role', 'authenticated')::text,
  false);
set role authenticated;

do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_analysis_id uuid := (select value::uuid from _t_fixtures where key = 'analysis_id'); -- 1-3에서 이미 uploaded
  v_path text := v_user_a::text || '/' || v_analysis_id::text || '/original.mp4';
  v_affected int;
begin
  update storage.objects
  set metadata = jsonb_build_object('size', 1, 'mimetype', 'video/mp4')
  where bucket_id = 'videos' and name = v_path;

  get diagnostics v_affected = row_count;
  if v_affected <> 0 then
    raise exception 'FAIL: 4-4 업로드 완료(pending을 벗어난) 이후에도 본인 파일을 UPDATE할 수 있음';
  end if;

  raise notice 'PASS: 4-4 — status가 pending을 벗어난 뒤에는 같은 경로를 더 이상 UPDATE(바꿔치기)할 수 없음';
end;
$$;

reset role;


-- ============================================================
-- 5. CLEANUP — 테스트 데이터 전부 제거
--
-- 이 세션의 연결 role(테이블 소유자/슈퍼유저 — Supabase SQL Editor 기본 role)로
-- 실행합니다. RLS를 우회해 테스트 fixture를 전부 지웁니다.
--
-- storage.objects에 대한 SQL DELETE를 여기서만 사용합니다. 이는 실제 서비스
-- 코드 경로가 아니라 테스트 스스로 만든 데이터를 치우는 것이므로 "Storage
-- 삭제는 항상 Storage API remove()로만" 원칙의 예외가 아닙니다 — 실제 프로덕션
-- 정리 로직에는 이 DELETE 문을 절대 재사용하지 마십시오.
-- ============================================================

do $$
declare
  v_user_a uuid := (select value::uuid from _t_fixtures where key = 'user_a');
  v_user_b uuid := (select value::uuid from _t_fixtures where key = 'user_b');
begin
  delete from storage.objects where owner_id in (v_user_a::text, v_user_b::text);
  delete from public.video_analyses where user_id in (v_user_a, v_user_b);
  delete from public.channels where user_id in (v_user_a, v_user_b);
  delete from auth.users where id in (v_user_a, v_user_b); -- profiles는 cascade로 함께 삭제

  raise notice 'PASS: 5 — 테스트 데이터 정리 완료';
end;
$$;

drop table if exists _t_fixtures;
