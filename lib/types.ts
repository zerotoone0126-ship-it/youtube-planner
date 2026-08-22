/**
 * lib/types.ts
 *
 * 앱 전체에서 쓰는 타입 정의.
 *
 * database.types.ts 는 Supabase CLI가 자동 생성하는 파일이라 손대지 않습니다.
 * 이 파일은 그 위에 두 가지를 얹습니다.
 *
 *   1. jsonb 컬럼의 실제 모양 (자동 생성기는 전부 Json = any 로 만듭니다)
 *   2. CHECK 제약이 걸린 text 컬럼을 정확한 값 목록으로 좁히기
 *      (자동 생성기는 그냥 string 으로 만듭니다)
 *
 * ⚠️ 중요 — 이 타입들은 "약속"이지 "검증"이 아닙니다.
 *    TypeScript는 DB에 실제로 뭐가 들어있는지 확인하지 못합니다.
 *    실제 검증은 AI 응답을 저장하기 전에 Zod가 합니다 (STEP 5).
 */

import type { Database } from "./database.types";

type Tables = Database["public"]["Tables"];
type Row<T extends keyof Tables> = Tables[T]["Row"];
type InsertRow<T extends keyof Tables> = Tables[T]["Insert"];

/* ============================================================
 * 1. 채널 — 온보딩 선택지
 *
 * "as const" 를 붙이면 배열의 값들이 그대로 타입이 됩니다.
 * 그래서 아래 두 가지를 한 번에 얻습니다.
 *   - 화면에서 map으로 돌릴 수 있는 실제 배열
 *   - 그 값만 허용하는 타입
 * ============================================================ */

/** Q1. 채널 카테고리 (최대 2개) */
export const CHANNEL_CATEGORIES = [
  "사업", "게임", "일상", "스토리", "정보",
  "뷰티", "운동", "AI", "재테크", "기타",
] as const;
export type ChannelCategory = (typeof CHANNEL_CATEGORIES)[number];

/** Q2. 영상 형태 */
export const VIDEO_STYLES = ["shorts", "long", "both"] as const;
export type VideoStyle = (typeof VIDEO_STYLES)[number];
export const VIDEO_STYLE_LABEL: Record<VideoStyle, string> = {
  shorts: "쇼츠",
  long: "롱폼",
  both: "둘 다",
};

/** Q3. 가장 중요한 목표 */
export const PRIMARY_GOALS = ["views", "subs", "revenue", "promo", "brand"] as const;
export type PrimaryGoal = (typeof PRIMARY_GOALS)[number];
export const PRIMARY_GOAL_LABEL: Record<PrimaryGoal, string> = {
  views: "조회수",
  subs: "구독자",
  revenue: "수익화",
  promo: "사업 홍보",
  brand: "개인 브랜딩",
};

/** Q5. 업로드 목표 */
export const UPLOAD_FREQUENCIES = ["w1", "w2", "w3", "daily"] as const;
export type UploadFrequency = (typeof UPLOAD_FREQUENCIES)[number];
export const UPLOAD_FREQUENCY_LABEL: Record<UploadFrequency, string> = {
  w1: "주 1회",
  w2: "주 2회",
  w3: "주 3회",
  daily: "매일",
};

/** 주당 업로드 횟수 — 대시보드의 "이번 주 업로드 1/2" 계산용 */
export const UPLOAD_FREQUENCY_PER_WEEK: Record<UploadFrequency, number> = {
  w1: 1,
  w2: 2,
  w3: 3,
  daily: 7,
};

/* ============================================================
 * 2. 아이디어 카테고리
 * ============================================================ */

export const IDEA_CATEGORIES = [
  "도전", "호기심", "결과", "실험", "스토리", "정보",
] as const;
export type IdeaCategory = (typeof IDEA_CATEGORIES)[number];

/* ============================================================
 * 3. 프로젝트 상태
 *
 * DB에는 영어 대문자로 저장하고, 화면에는 한글로 보여줍니다.
 * 한글을 그대로 저장하면 나중에 문구를 바꿀 때 DB를 손대야 합니다.
 * ============================================================ */

export const PROJECT_STATUSES = [
  "IDEA", "PLANNING", "FILMING", "EDITING", "SCHEDULED", "PUBLISHED",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  IDEA: "아이디어",
  PLANNING: "기획중",
  FILMING: "촬영중",
  EDITING: "편집중",
  SCHEDULED: "업로드 예정",
  PUBLISHED: "업로드 완료",
};

/* ============================================================
 * 4. 체크리스트 종류
 * ============================================================ */

export const CHECKLIST_TYPES = ["filming", "editing"] as const;
export type ChecklistType = (typeof CHECKLIST_TYPES)[number];
export const CHECKLIST_TYPE_LABEL: Record<ChecklistType, string> = {
  filming: "촬영",
  editing: "편집",
};

/* ============================================================
 * 5. AI 생성 종류 (ai_generations.kind)
 * ============================================================ */

export const AI_KINDS = ["strategy", "ideas", "titles", "thumbnail", "plan"] as const;
export type AiKind = (typeof AI_KINDS)[number];

/* ============================================================
 * 6. jsonb 컬럼의 실제 모양
 *
 * ⚠️ 여기서는 반드시 "type" 을 쓰고 "interface" 를 쓰지 않습니다.
 *
 *    Supabase의 Json 타입은 { [key: string]: Json } 형태인데,
 *    TypeScript에서 interface 로 만든 타입은 이런 형태에 할당되지 않습니다.
 *    (type 으로 만든 것만 됩니다. TypeScript의 오래된 규칙입니다)
 *
 *    interface 로 쓰면 나중에 DB에 저장할 때
 *    "Index signature is missing" 이라는 알 수 없는 에러가 납니다.
 * ============================================================ */

/** channels.strategy — 온보딩 직후 AI가 만드는 채널 전략 */
export type ChannelStrategy = {
  /** 채널 컨셉 한 문단 */
  concept: string;
  /** 주요 시청자 */
  targetAudience: string;
  /** 콘텐츠 방향 (예: "도전 → 과정 → 문제 → 해결 → 결과") */
  contentDirection: string;
  /** 추천 콘텐츠 카테고리 */
  recommendedCategories: string[];
  /** 채널명 후보 — 온보딩에서 이름을 묻지 않으므로 AI가 제안합니다 */
  nameSuggestions: string[];
};

/** 제목의 접근 각도 — 점수 대신 쓰는 분류 */
export const TITLE_ANGLES = ["curiosity", "number", "result", "contrast"] as const;
export type TitleAngle = (typeof TITLE_ANGLES)[number];
export const TITLE_ANGLE_LABEL: Record<TitleAngle, string> = {
  curiosity: "호기심형",
  number: "숫자형",
  result: "결과형",
  contrast: "대조형",
};

/** content_projects.title_candidates — 생성된 제목 후보 목록 */
export type TitleCandidate = {
  title: string;
  angle: TitleAngle;
  /** 왜 이 제목이 통하는지 한 줄 */
  reason: string;
};

/** 썸네일 화면 구성 */
export type ThumbnailComposition = {
  left: string;
  center: string;
  right: string;
  /** 강조 요소 (예: "큰 숫자 + 화살표") */
  emphasis: string;
};

export type ThumbnailCandidate = {
  /** 썸네일 문구 — 2~6단어 */
  text: string;
  composition: ThumbnailComposition;
};

/** content_projects.thumbnail */
export type ProjectThumbnail = {
  /** 사용자가 고른 문구 (아직 안 골랐으면 null) */
  selectedText: string | null;
  composition: ThumbnailComposition | null;
  candidates: ThumbnailCandidate[];
};

/** 영상 기획의 한 구간 */
export type VideoSection = {
  /** 화면에서 목록 렌더링과 순서 변경에 쓰는 고유 id */
  id: string;
  order: number;
  /**
   * 예상 길이 (예: "약 30초").
   * "0:00" 같은 실제 타임스탬프가 아닙니다 —
   * 아직 찍지도 않은 영상의 시각을 AI가 알 수 없기 때문입니다.
   */
  durationLabel: string;
  title: string;
  /** 이 구간의 목적 (예: "시청자의 궁금증 만들기") */
  purpose: string;
  content: string;
  /** 촬영 메모 */
  shootingNotes: string;
  /** 필요한 화면 */
  requiredVisuals: string;
};

/** content_projects.plan */
export type VideoPlan = {
  goal: string;
  targetViewer: string;
  hook: string;
  closing: string;
  sections: VideoSection[];
  /**
   * 이 기획을 만들 때 사용한 제목.
   * 현재 selected_title 과 다르면 "기획이 낡았다"고 안내합니다.
   * 자동 재생성은 하지 않습니다 — 사용자가 손으로 고친 내용이 날아가니까요.
   */
  generatedForTitle: string;
};

/* ============================================================
 * 7. 테이블 행 타입
 *
 * 자동 생성 타입에서 느슨한 컬럼만 골라 정확한 타입으로 교체합니다.
 * Omit<원본, "바꿀컬럼"> & { 바꿀컬럼: 새타입 } 패턴입니다.
 * ============================================================ */

export type Profile = Row<"profiles">;

export type Channel = Omit<
  Row<"channels">,
  "categories" | "video_style" | "primary_goal" | "upload_frequency" | "strategy"
> & {
  categories: ChannelCategory[];
  video_style: VideoStyle;
  primary_goal: PrimaryGoal;
  upload_frequency: UploadFrequency;
  strategy: ChannelStrategy | null;
};

export type VideoIdea = Omit<Row<"video_ideas">, "category"> & {
  category: IdeaCategory;
};

export type ContentProject = Omit<
  Row<"content_projects">,
  "status" | "title_candidates" | "thumbnail" | "plan"
> & {
  status: ProjectStatus;
  title_candidates: TitleCandidate[];
  thumbnail: ProjectThumbnail | null;
  plan: VideoPlan | null;
};

export type ChecklistItem = Omit<Row<"checklist_items">, "type"> & {
  type: ChecklistType;
};

export type AiGeneration = Omit<Row<"ai_generations">, "kind"> & {
  kind: AiKind;
};

/* ============================================================
 * 8. 삽입(INSERT)용 타입
 *
 * Row 와 달리 기본값이 있는 컬럼은 생략할 수 있습니다.
 * ============================================================ */

export type ChannelInsert = Omit<
  InsertRow<"channels">,
  "categories" | "video_style" | "primary_goal" | "upload_frequency" | "strategy"
> & {
  categories: ChannelCategory[];
  video_style: VideoStyle;
  primary_goal: PrimaryGoal;
  upload_frequency: UploadFrequency;
  strategy?: ChannelStrategy | null;
};

export type VideoIdeaInsert = Omit<InsertRow<"video_ideas">, "category"> & {
  category: IdeaCategory;
};

export type ContentProjectInsert = Omit<
  InsertRow<"content_projects">,
  "status" | "title_candidates" | "thumbnail" | "plan"
> & {
  status?: ProjectStatus;
  title_candidates?: TitleCandidate[];
  thumbnail?: ProjectThumbnail | null;
  plan?: VideoPlan | null;
};

export type ChecklistItemInsert = Omit<InsertRow<"checklist_items">, "type"> & {
  type: ChecklistType;
};

export type AiGenerationInsert = Omit<InsertRow<"ai_generations">, "kind"> & {
  kind: AiKind;
};

/* ============================================================
 * 9. 파생 값
 * ============================================================ */

/**
 * 프로젝트 진행률 (0~100).
 *
 * 설계 문서에서 정한 정의: 체크리스트 완료율.
 * 상태(status)로 계산하지 않습니다 — 그러면 "65%"가 임의의 숫자가 됩니다.
 * 계산식을 여기 한 곳에만 두어, 화면마다 다른 숫자가 나오는 일을 막습니다.
 */
export function projectProgress(items: Pick<ChecklistItem, "completed">[]): number {
  if (items.length === 0) return 0;
  const done = items.filter((item) => item.completed).length;
  return Math.round((done / items.length) * 100);
}

/**
 * 기획이 현재 제목 기준으로 최신인지.
 * false 면 기획 탭에 "제목이 바뀌었습니다" 배너를 띄웁니다.
 */
export function isPlanUpToDate(project: ContentProject): boolean {
  if (!project.plan) return true;
  const currentTitle = project.selected_title ?? project.working_title;
  return project.plan.generatedForTitle === currentTitle;
}
