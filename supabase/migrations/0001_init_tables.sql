-- ============================================================
-- YouTube Planner — 0001 초기 테이블 생성
-- STEP 1-C : 테이블 6개 + RLS 활성화
--
-- Supabase SQL Editor에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다 (if not exists 사용).
-- ============================================================


-- ------------------------------------------------------------
-- 1. profiles — 사용자 프로필
--    auth.users(로그인 계정)와 1:1로 연결됩니다.
--    id가 곧 로그인한 사용자의 id입니다.
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id                    uuid primary key
                        references auth.users(id) on delete cascade,
  email                 text,
  display_name          text,
  onboarding_completed  boolean     not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);


-- ------------------------------------------------------------
-- 2. channels — 온보딩으로 받은 채널 정보 + AI가 만든 전략
--    MVP에서는 사용자당 1개만 만들지만, 구조는 여러 개를 허용합니다.
-- ------------------------------------------------------------
create table if not exists public.channels (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,

  -- 온보딩에는 채널 이름을 묻는 질문이 없습니다.
  -- 전략 생성 시 AI가 후보를 제안하고 설정에서 수정합니다. 그래서 null 허용.
  name              text,

  categories        text[]      not null default '{}',   -- Q1 (1~2개)
  video_style       text        not null,                -- Q2
  primary_goal      text        not null,                -- Q3
  description       text        not null,                -- Q4 (AI 품질의 핵심 입력)
  upload_frequency  text        not null,                -- Q5

  -- AI가 생성한 채널 전략
  -- { concept, targetAudience, contentDirection, recommendedCategories[] }
  strategy          jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint channels_video_style_check
    check (video_style in ('shorts', 'long', 'both')),
  constraint channels_primary_goal_check
    check (primary_goal in ('views', 'subs', 'revenue', 'promo', 'brand')),
  constraint channels_upload_frequency_check
    check (upload_frequency in ('w1', 'w2', 'w3', 'daily')),
  constraint channels_categories_len_check
    check (cardinality(categories) between 1 and 2)
);


-- ------------------------------------------------------------
-- 3. video_ideas — AI가 생성한 영상 아이디어 풀
--    "이 아이디어로 프로젝트를 만들었는가"는 여기 저장하지 않습니다.
--    content_projects.idea_id 한 곳에서만 관리합니다.
-- ------------------------------------------------------------
create table if not exists public.video_ideas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id)      on delete cascade,
  channel_id   uuid not null references public.channels(id) on delete cascade,

  title        text not null,
  category     text not null,
  description  text,
  reason       text,

  saved        boolean not null default false,

  created_at   timestamptz not null default now(),

  constraint video_ideas_category_check
    check (category in ('도전', '호기심', '결과', '실험', '스토리', '정보'))
);


-- ------------------------------------------------------------
-- 4. content_projects — ★ 이 서비스의 중심 엔티티
--    영상 하나 = 이 테이블의 한 행.
--    제목 후보 / 썸네일 / 영상 기획을 jsonb로 이 안에 담습니다.
-- ------------------------------------------------------------
create table if not exists public.content_projects (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id)      on delete cascade,
  channel_id        uuid not null references public.channels(id) on delete cascade,

  -- 아이디어와 프로젝트를 잇는 유일한 연결점.
  -- 아이디어 없이 직접 만든 프로젝트도 허용하므로 null 가능.
  -- 아이디어가 삭제돼도 프로젝트는 살아남아야 하므로 set null.
  idea_id           uuid references public.video_ideas(id) on delete set null,

  working_title     text not null,   -- 아이디어에서 가져온 초기 제목
  selected_title    text,            -- 사용자가 확정/수정한 최종 제목

  -- [{ title, angle, reason }, ...]
  title_candidates  jsonb not null default '[]'::jsonb,

  -- { selectedText, composition: { left, center, right, emphasis }, candidates: [...] }
  thumbnail         jsonb,

  -- { goal, targetViewer, hook, closing, sections: [...], generatedForTitle }
  -- generatedForTitle : 이 기획을 만들 때의 제목.
  --                     현재 제목과 다르면 "기획이 낡았다"고 안내합니다.
  plan              jsonb,

  status            text not null default 'IDEA',
  scheduled_date    date,
  published_at      timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint content_projects_status_check
    check (status in ('IDEA', 'PLANNING', 'FILMING', 'EDITING', 'SCHEDULED', 'PUBLISHED'))
);


-- 아이디어 1개당 프로젝트 1개만 허용합니다.
-- "where idea_id is not null" 이 붙은 partial unique index이므로,
-- 아이디어 없이 만든 프로젝트(idea_id = null)는 몇 개든 만들 수 있습니다.
create unique index if not exists content_projects_idea_id_key
  on public.content_projects (idea_id)
  where idea_id is not null;


-- ------------------------------------------------------------
-- 5. checklist_items — 촬영 / 편집 체크리스트
--    개별 항목을 자주 토글하므로 jsonb가 아니라 별도 테이블로 둡니다.
--    진행률(= 완료 수 / 전체 수)도 이 테이블에서 계산합니다.
-- ------------------------------------------------------------
create table if not exists public.checklist_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id)              on delete cascade,
  project_id  uuid not null references public.content_projects(id) on delete cascade,

  type        text    not null,             -- filming | editing
  content     text    not null,             -- 체크리스트 문구
  completed   boolean not null default false,
  sort_order  integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint checklist_items_type_check
    check (type in ('filming', 'editing'))
);


-- ------------------------------------------------------------
-- 6. ai_generations — AI 호출 기록 (기록 전용)
--    사용자를 차단하는 용도로 쓰지 않습니다.
--    기능별 호출 횟수 / 성공률 / 토큰 사용량을 남겨 비용 분석에만 사용합니다.
-- ------------------------------------------------------------
create table if not exists public.ai_generations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  kind        text    not null,
  tokens_in   integer,
  tokens_out  integer,
  succeeded   boolean not null default true,

  created_at  timestamptz not null default now(),

  constraint ai_generations_kind_check
    check (kind in ('strategy', 'ideas', 'titles', 'thumbnail', 'plan'))
);


-- ============================================================
-- RLS 활성화
--
-- 지금은 "켜기"만 합니다. 정책(policy)은 0002에서 만듭니다.
-- RLS를 켜고 정책이 없으면 → 모두 차단됩니다. 이게 안전한 기본값입니다.
-- 반대로 RLS를 끄면 → 누구나 전부 읽고 쓸 수 있습니다.
-- ============================================================
alter table public.profiles         enable row level security;
alter table public.channels         enable row level security;
alter table public.video_ideas      enable row level security;
alter table public.content_projects enable row level security;
alter table public.checklist_items  enable row level security;
alter table public.ai_generations   enable row level security;
