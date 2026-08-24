-- ============================================================
-- YouTube Planner — 0010 queue_video_analysis
-- STEP 4-3A: migration drift reconciliation
--
-- ⚠️ 이 파일은 로컬 저장소에 없던 마이그레이션을 "재현"한 것입니다.
-- staging(btyihqzfgbjpzgxienkp)에는 이미 이 내용 그대로 적용되어 있고
-- (version 20260824124434, supabase_migrations.schema_migrations에서 확인,
-- pg_get_functiondef로 원문 대조 완료 — docs/research-step-4-3a-orchestration.md
-- 3장 참고), 이 STEP(4-3A)에서 이 파일을 다시 remote에 적용하지 않습니다.
-- 파일명의 타임스탬프 접두사(20260824124434_)는 supabase_migrations.schema_migrations의
-- 실제 version 값과 동일하게 맞췄습니다 — 나중에 CLI로 마이그레이션 이력을
-- 비교할 때 이미 적용된 버전으로 정확히 인식되게 하기 위함입니다.
--
-- 내용은 0006/0009와 동일한 관례(SECURITY DEFINER, search_path='', PUBLIC/anon
-- 명시적 차단, authenticated+service_role만 허용)를 따릅니다 — queue_video_analysis는
-- uploaded 상태의 분석을 큐에 등록하는 유일한 authenticated 경로입니다.
--
-- 주의: 이 파일은 production에는 아직 적용되지 않았습니다.
-- ============================================================

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

  return v_row;
end;
$$;

revoke all on function public.queue_video_analysis(uuid) from public;
revoke all on function public.queue_video_analysis(uuid) from anon;
grant execute on function public.queue_video_analysis(uuid) to authenticated;
grant execute on function public.queue_video_analysis(uuid) to service_role;
