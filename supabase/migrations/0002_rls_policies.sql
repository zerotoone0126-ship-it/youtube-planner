-- ============================================================
-- YouTube Planner — 0002 RLS 정책
-- STEP 1-D : 사용자 데이터 격리
--
-- 0001에서 RLS를 "켜기"만 했습니다(= 전부 차단).
-- 이 스크립트가 "본인 데이터만 허용"하는 열쇠를 만듭니다.
--
-- 모든 정책의 조건은 단 하나입니다:
--     (select auth.uid()) = user_id
--
-- Supabase SQL Editor에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다 (drop policy if exists 후 재생성).
-- ============================================================


-- ------------------------------------------------------------
-- 1. profiles
--    본인 프로필만 읽고 쓸 수 있습니다.
--    DELETE 정책은 일부러 만들지 않습니다.
--    → 프로필만 지우고 로그인 계정은 남는 어중간한 상태를 막습니다.
--      계정 삭제는 auth.users를 지우면 cascade로 함께 사라집니다.
-- ------------------------------------------------------------
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using ( (select auth.uid()) = id );

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check ( (select auth.uid()) = id );

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using      ( (select auth.uid()) = id )
  with check ( (select auth.uid()) = id );


-- ------------------------------------------------------------
-- 2. channels
-- ------------------------------------------------------------
drop policy if exists "channels_select_own" on public.channels;
create policy "channels_select_own"
  on public.channels for select to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "channels_insert_own" on public.channels;
create policy "channels_insert_own"
  on public.channels for insert to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "channels_update_own" on public.channels;
create policy "channels_update_own"
  on public.channels for update to authenticated
  using      ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "channels_delete_own" on public.channels;
create policy "channels_delete_own"
  on public.channels for delete to authenticated
  using ( (select auth.uid()) = user_id );


-- ------------------------------------------------------------
-- 3. video_ideas
-- ------------------------------------------------------------
drop policy if exists "video_ideas_select_own" on public.video_ideas;
create policy "video_ideas_select_own"
  on public.video_ideas for select to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "video_ideas_insert_own" on public.video_ideas;
create policy "video_ideas_insert_own"
  on public.video_ideas for insert to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "video_ideas_update_own" on public.video_ideas;
create policy "video_ideas_update_own"
  on public.video_ideas for update to authenticated
  using      ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "video_ideas_delete_own" on public.video_ideas;
create policy "video_ideas_delete_own"
  on public.video_ideas for delete to authenticated
  using ( (select auth.uid()) = user_id );


-- ------------------------------------------------------------
-- 4. content_projects
--    다른 사람의 프로젝트 URL을 주소창에 직접 입력해도
--    이 정책 때문에 아무 행도 돌아오지 않습니다.
-- ------------------------------------------------------------
drop policy if exists "content_projects_select_own" on public.content_projects;
create policy "content_projects_select_own"
  on public.content_projects for select to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "content_projects_insert_own" on public.content_projects;
create policy "content_projects_insert_own"
  on public.content_projects for insert to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "content_projects_update_own" on public.content_projects;
create policy "content_projects_update_own"
  on public.content_projects for update to authenticated
  using      ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "content_projects_delete_own" on public.content_projects;
create policy "content_projects_delete_own"
  on public.content_projects for delete to authenticated
  using ( (select auth.uid()) = user_id );


-- ------------------------------------------------------------
-- 5. checklist_items
-- ------------------------------------------------------------
drop policy if exists "checklist_items_select_own" on public.checklist_items;
create policy "checklist_items_select_own"
  on public.checklist_items for select to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "checklist_items_insert_own" on public.checklist_items;
create policy "checklist_items_insert_own"
  on public.checklist_items for insert to authenticated
  with check ( (select auth.uid()) = user_id );

drop policy if exists "checklist_items_update_own" on public.checklist_items;
create policy "checklist_items_update_own"
  on public.checklist_items for update to authenticated
  using      ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

drop policy if exists "checklist_items_delete_own" on public.checklist_items;
create policy "checklist_items_delete_own"
  on public.checklist_items for delete to authenticated
  using ( (select auth.uid()) = user_id );


-- ------------------------------------------------------------
-- 6. ai_generations — 기록 전용
--    UPDATE / DELETE 정책을 일부러 만들지 않습니다.
--    로그는 나중에 고쳐 쓰는 데이터가 아닙니다.
--    한 번 남은 기록이 변조되지 않아야 비용 분석에 쓸 수 있습니다.
-- ------------------------------------------------------------
drop policy if exists "ai_generations_select_own" on public.ai_generations;
create policy "ai_generations_select_own"
  on public.ai_generations for select to authenticated
  using ( (select auth.uid()) = user_id );

drop policy if exists "ai_generations_insert_own" on public.ai_generations;
create policy "ai_generations_insert_own"
  on public.ai_generations for insert to authenticated
  with check ( (select auth.uid()) = user_id );
