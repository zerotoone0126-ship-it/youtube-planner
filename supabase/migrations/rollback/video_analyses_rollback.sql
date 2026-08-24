-- ============================================================
-- YouTube Planner — video_analyses 롤백 스크립트
-- STEP 4-1
--
-- ⚠️ 이 파일은 0005~0009와 함께 자동 적용되는 순번 마이그레이션이 아닙니다.
-- 의도적으로 `supabase/migrations/rollback/` 아래 별도 보관합니다 — 마이그레이션
-- 도구가 `supabase/migrations/` 안의 파일을 순서대로 전부 적용하는 방식이라면
-- 이 파일이 거기 섞여 있으면 의도치 않게 "정방향 마이그레이션"으로 실행될 수
-- 있기 때문입니다. 필요할 때 수동으로만 실행하십시오.
--
-- 순서: 정책(policy) → 함수(function) → 인덱스/제약(index/constraint) →
--       테이블/버킷(table/bucket) — 요청받은 순서 그대로, 각 객체가
--       video_analyses 테이블에 의존하므로 테이블을 마지막에 지웁니다.
--
-- ⚠️ 기존 프로젝트 객체(profiles/channels/video_ideas/content_projects/
-- checklist_items/ai_generations 및 그 정책/함수/인덱스)는 이 스크립트 어디에서도
-- 건드리지 않습니다. video_analyses 관련 이름만 명시적으로 지정했습니다 — 다른
-- 테이블에 영향을 주는 명령(예: cascade가 다른 테이블까지 전파되는 상황)은
-- 없습니다(video_analyses를 참조하는 기존 테이블이 없으므로 FK cascade로 인한
-- 부수 삭제도 발생하지 않습니다).
--
-- ⚠️ storage.objects에 대한 SQL DELETE는 이 스크립트에도 포함하지 않습니다
-- (plan의 확고한 제약 — 실제 파일 삭제는 항상 Storage API remove()로만).
-- 아래 버킷 삭제 섹션은 버킷이 비어있을 때만 실행되도록 가드를 걸었습니다.
-- ============================================================


-- ------------------------------------------------------------
-- 1. 정책 (policy)
-- ------------------------------------------------------------

-- video_objects_update_own_while_pending은 2026-08-24 지시로 제거되어 더 이상
-- 존재하지 않습니다(0007 B-2 참고) — 그래도 이전 초안을 어딘가 수동 적용한
-- 적이 있을 경우를 대비해 계속 drop 해둡니다(신규 환경에서는 no-op).
drop policy if exists "video_objects_update_own_while_pending" on storage.objects;
drop policy if exists "video_objects_select_own_while_pending" on storage.objects;
drop policy if exists "video_objects_insert_own" on storage.objects;

-- video_analyses에는 DELETE 정책 자체가 없습니다(2026-08-24 지시로 제거,
-- 0007 참고) — 여기서 지울 대상이 없습니다.
drop policy if exists "video_analyses_select_own" on public.video_analyses;


-- ------------------------------------------------------------
-- 2. 함수 (function)
--
-- (2026-08-24 지시로 3개 추가) worker 쓰기를 캡슐화한 RPC 3개도 함께 드롭합니다.
-- ------------------------------------------------------------

drop function if exists public.fail_video_analysis(uuid, uuid, text, text);
drop function if exists public.complete_video_analysis(uuid, uuid, jsonb, jsonb, numeric);
drop function if exists public.update_video_analysis_progress(uuid, uuid, text, smallint);
drop function if exists public.acquire_video_analysis_run(uuid);
drop function if exists public.cancel_video_analysis(uuid);
drop function if exists public.mark_video_analysis_uploaded(uuid);
drop function if exists public.create_video_analysis(text, uuid, uuid);


-- ------------------------------------------------------------
-- 3. 인덱스 / 제약 (index / constraint)
--
-- 테이블을 드롭하면 인덱스/제약/트리거는 자동으로 함께 삭제되지만, 요청하신
-- "policy → function → index/constraint → table/bucket" 순서를 그대로 따르기
-- 위해 명시적으로도 지웁니다.
-- ------------------------------------------------------------

drop trigger if exists set_updated_at on public.video_analyses;

drop index if exists public.video_analyses_pending_cleanup_idx;
drop index if exists public.video_analyses_processing_started_idx;
drop index if exists public.video_analyses_channel_id_idx;
drop index if exists public.video_analyses_user_status_idx;
drop index if exists public.video_analyses_user_created_idx;
drop index if exists public.video_analyses_user_client_request_key;


-- ------------------------------------------------------------
-- 4. 테이블 (table)
--
-- video_analyses를 참조하는 기존 테이블이 없으므로(FK가 나가는 방향만 있음)
-- 이 DROP이 다른 테이블에 영향을 주지 않습니다.
-- ------------------------------------------------------------

drop table if exists public.video_analyses;


-- ------------------------------------------------------------
-- 5. 버킷 (bucket) — 선택적, 안전 가드 포함
--
-- ⚠️ storage.objects 안에 이 버킷을 참조하는 오브젝트(실제 업로드된 파일의
-- 메타데이터)가 하나라도 남아있으면 삭제하지 않습니다 — 실제 파일이 남아있는
-- 상태에서 버킷 메타데이터만 지우면 관리되지 않는 orphan 파일이 생길 수 있고,
-- FK 위반으로 어차피 실패하지만 명시적으로 먼저 확인합니다.
-- 오브젝트가 남아있다면, 먼저 정상적인 정리 경로(Storage API remove())로
-- 전부 지운 뒤 이 섹션을 실행하십시오.
-- ------------------------------------------------------------

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'videos') then
    raise notice 'videos 버킷에 오브젝트가 남아있어 버킷 삭제를 건너뜁니다. '
      'Storage API remove()로 먼저 정리하십시오.';
  else
    delete from storage.buckets where id = 'videos';
  end if;
end;
$$;
