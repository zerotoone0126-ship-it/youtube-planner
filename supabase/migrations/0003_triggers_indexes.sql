-- ============================================================
-- YouTube Planner — 0003 트리거 + 인덱스
-- STEP 1-E
--
-- 1) profiles 자동 생성 트리거
-- 2) updated_at 자동 갱신 트리거
-- 3) 인덱스
--
-- Supabase SQL Editor에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다.
-- ============================================================


-- ============================================================
-- 1. profiles 자동 생성 트리거
--
-- 사용자가 가입하면 auth.users에 행이 하나 생깁니다.
-- 그 순간 public.profiles에도 짝이 되는 행을 자동으로 만듭니다.
--
-- 이게 없으면 앱이 화면마다 "프로필이 있나?" 를 확인하고
-- 없으면 만들어주는 코드를 넣어야 합니다. DB가 보장해주는 게 훨씬 낫습니다.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer            -- 함수 소유자 권한으로 실행 → RLS를 통과해 profiles에 쓸 수 있음
set search_path = ''        -- 스키마 이름을 전부 명시하도록 강제 (보안 권장 설정)
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    -- Google 로그인은 이름을 raw_user_meta_data에 넣어줍니다.
    -- 키 이름이 상황에 따라 다르므로 순서대로 시도하고,
    -- 전부 없으면 이메일 앞부분(@ 앞)을 임시 이름으로 씁니다.
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  -- 이미 프로필이 있으면 조용히 넘어갑니다.
  -- 트리거가 실패하면 "가입" 자체가 실패하므로, 절대 에러를 내지 않게 합니다.
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 트리거를 만들기 전에 이미 가입한 계정이 있다면 프로필을 채워줍니다.
-- (지금은 사용자가 없으므로 아무 일도 일어나지 않습니다)
insert into public.profiles (id, email, display_name)
select
  u.id,
  u.email,
  coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    split_part(coalesce(u.email, ''), '@', 1)
  )
from auth.users u
on conflict (id) do nothing;


-- ============================================================
-- 2. updated_at 자동 갱신 트리거
--
-- 행을 수정할 때마다 updated_at을 지금 시각으로 바꿉니다.
-- 앱 코드에서 매번 updated_at을 챙겨 보내는 것보다 안전합니다.
-- (한 군데라도 빠뜨리면 그 값은 영원히 거짓말을 합니다)
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- updated_at 컬럼이 있는 4개 테이블에만 붙입니다.
-- video_ideas와 ai_generations는 created_at만 있고 수정하지 않는 데이터입니다.

drop trigger if exists set_updated_at on public.profiles;
create trigger set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.channels;
create trigger set_updated_at
  before update on public.channels
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.content_projects;
create trigger set_updated_at
  before update on public.content_projects
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.checklist_items;
create trigger set_updated_at
  before update on public.checklist_items
  for each row execute function public.set_updated_at();


-- ============================================================
-- 3. 인덱스
--
-- RLS 정책이 모든 쿼리에 "user_id = 내 id" 조건을 자동으로 붙입니다.
-- 즉 user_id는 이 앱에서 가장 자주 조회되는 컬럼입니다.
--
-- 복합 인덱스 (user_id, created_at) 는 "user_id만으로 찾기"에도 쓰입니다.
-- 인덱스는 왼쪽부터 순서대로 사용되기 때문입니다.
-- 그래서 user_id 단독 인덱스를 따로 만들지 않습니다.
-- ============================================================

-- channels : 사용자당 1개뿐이라 단순 조회만 합니다
create index if not exists channels_user_id_idx
  on public.channels (user_id);

-- video_ideas : /ideas 페이지에서 최신순으로 나열
create index if not exists video_ideas_user_created_idx
  on public.video_ideas (user_id, created_at desc);

-- video_ideas : 채널 삭제 시 연쇄 삭제를 빠르게
create index if not exists video_ideas_channel_id_idx
  on public.video_ideas (channel_id);

-- content_projects : /projects 목록 (최신순)
create index if not exists content_projects_user_created_idx
  on public.content_projects (user_id, created_at desc);

-- content_projects : 상태 필터 ("촬영중"만 보기)
create index if not exists content_projects_user_status_idx
  on public.content_projects (user_id, status);

-- content_projects : 대시보드의 "예정 콘텐츠"
-- 날짜가 없는 프로젝트는 인덱스에 넣지 않습니다 (partial index)
create index if not exists content_projects_user_scheduled_idx
  on public.content_projects (user_id, scheduled_date)
  where scheduled_date is not null;

-- content_projects : 채널 삭제 시 연쇄 삭제
create index if not exists content_projects_channel_id_idx
  on public.content_projects (channel_id);

-- checklist_items : 프로젝트 안에서 정렬 순서대로 조회
create index if not exists checklist_items_project_sort_idx
  on public.checklist_items (project_id, sort_order);

-- checklist_items : RLS가 매번 확인하는 컬럼
create index if not exists checklist_items_user_id_idx
  on public.checklist_items (user_id);

-- ai_generations : 기간별 사용량 분석
create index if not exists ai_generations_user_created_idx
  on public.ai_generations (user_id, created_at desc);
