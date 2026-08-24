-- ============================================================
-- YouTube Planner — 0009 video_analyses grants
-- STEP 4-1
--
-- 기존 0004_grants.sql과 동일한 원칙: revoke all 후 필요한 권한만 좁게 grant.
--
-- ⚠️ plan-step-4-1-db-migration.md 대비 추가된 부분 (문서에 남기는 이유):
-- Postgres는 함수를 만들면 기본적으로 EXECUTE 권한을 PUBLIC(모든 역할)에
-- 부여합니다 — 테이블과 반대되는 기본값입니다. plan 문서의 grants 예시는
-- authenticated/anon에 대한 grant/revoke만 다뤄 이 PUBLIC 기본값을 명시적으로
-- 닫지 않았습니다. 이번 구현에서는 모든 함수에 대해 `revoke ... from public`을
-- 먼저 실행해 이 gap을 막았습니다 — 특히 service_role 전용이어야 하는 함수
-- 4개(acquire_video_analysis_run/update_video_analysis_progress/
-- complete_video_analysis/fail_video_analysis)가 기본값 때문에
-- authenticated/anon에게도 실행 가능한 상태로 남는 것을 반드시 막아야 하기
-- 때문입니다.
--
-- (2026-08-24 지시로 변경) authenticated에 대한 video_analyses 테이블 DELETE
-- 권한도 제거했습니다 — 0007에서 DELETE 정책 자체를 없앴으므로 최소 권한
-- 원칙에 따라 권한도 함께 걷어냅니다.
--
-- Supabase SQL Editor에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--
-- 주의: 이 파일은 아직 production에 적용되지 않았습니다 (STEP 4-1 승인 대기).
-- ============================================================

grant usage on schema public to authenticated;
grant usage on schema public to service_role;

-- ------------------------------------------------------------
-- 테이블 grants
-- ------------------------------------------------------------

revoke all on table public.video_analyses from authenticated;
grant select on table public.video_analyses to authenticated;
-- insert/update/delete는 부여하지 않음 — 생성/전이는 전부 아래 함수 또는 service_role.
-- delete를 부여하지 않는 이유(2026-08-24 지시로 변경): 0007에 DELETE 정책 자체가
-- 없으므로 권한을 줘도 RLS가 항상 막지만, 불필요한 권한을 애초에 주지 않는
-- 최소 권한 원칙을 테이블 grant에도 동일하게 적용합니다.

revoke all on table public.video_analyses from anon;

-- service_role은 Supabase가 기본적으로 RLS/grants를 우회하는 역할이지만,
-- 기존 프로젝트의 "명시적으로 필요한 권한만 좁게 grant" 관례를 그대로 따라
-- 여기서도 명시적으로 선언합니다(방어적 문서화 목적, 동작 자체는 우회에 의존).
grant select, insert, update, delete on table public.video_analyses to service_role;


-- ------------------------------------------------------------
-- 함수 grants
--
-- 먼저 PUBLIC 기본 권한을 전부 닫고, 필요한 역할에만 좁게 부여합니다.
-- ------------------------------------------------------------

revoke execute on function public.create_video_analysis(text, uuid, uuid) from public;
revoke execute on function public.mark_video_analysis_uploaded(uuid) from public;
revoke execute on function public.cancel_video_analysis(uuid) from public;
revoke execute on function public.acquire_video_analysis_run(uuid) from public;
revoke execute on function public.update_video_analysis_progress(uuid, uuid, text, smallint) from public;
revoke execute on function public.complete_video_analysis(uuid, uuid, jsonb, jsonb, numeric) from public;
revoke execute on function public.fail_video_analysis(uuid, uuid, text, text) from public;

-- authenticated 전용 함수 3개
grant execute on function public.create_video_analysis(text, uuid, uuid) to authenticated;
grant execute on function public.mark_video_analysis_uploaded(uuid) to authenticated;
grant execute on function public.cancel_video_analysis(uuid) to authenticated;

-- anon에는 명시적으로 아무것도 부여하지 않음 (PUBLIC에서 이미 막혔지만
-- 0004_grants.sql의 "anon은 어떤 테이블에도 권한 없음"과 같은 명시성 원칙을
-- 함수에도 동일하게 적용)
revoke execute on function public.create_video_analysis(text, uuid, uuid) from anon;
revoke execute on function public.mark_video_analysis_uploaded(uuid) from anon;
revoke execute on function public.cancel_video_analysis(uuid) from anon;
revoke execute on function public.acquire_video_analysis_run(uuid) from anon;
revoke execute on function public.update_video_analysis_progress(uuid, uuid, text, smallint) from anon;
revoke execute on function public.complete_video_analysis(uuid, uuid, jsonb, jsonb, numeric) from anon;
revoke execute on function public.fail_video_analysis(uuid, uuid, text, text) from anon;

-- service_role 전용 함수 4개 — authenticated에는 절대 부여하지 않음
-- (2026-08-24 지시로 3개 추가: worker 쓰기를 DB invariant로 캡슐화한 RPC들)
grant execute on function public.acquire_video_analysis_run(uuid) to service_role;
grant execute on function public.update_video_analysis_progress(uuid, uuid, text, smallint) to service_role;
grant execute on function public.complete_video_analysis(uuid, uuid, jsonb, jsonb, numeric) to service_role;
grant execute on function public.fail_video_analysis(uuid, uuid, text, text) to service_role;

revoke execute on function public.acquire_video_analysis_run(uuid) from authenticated;
revoke execute on function public.update_video_analysis_progress(uuid, uuid, text, smallint) from authenticated;
revoke execute on function public.complete_video_analysis(uuid, uuid, jsonb, jsonb, numeric) from authenticated;
revoke execute on function public.fail_video_analysis(uuid, uuid, text, text) from authenticated;
