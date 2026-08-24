# docs/plan-step-4-2-upload-vertical-slice.md

STEP 4-2. 목표: 디자인이 아니라 **브라우저 실제 MP4 선택 → `create_video_analysis` → Supabase Storage TUS 업로드 → `mark_video_analysis_uploaded` → DB 상태 반영**이 실제 staging 환경에서 처음부터 끝까지 성공하는 것. production migration은 적용하지 않는다. staging 프로젝트(`youtube-planner-staging`, ref `btyihqzfgbjpzgxienkp`)를 이번 단계의 개발/검증 환경으로 계속 사용한다.

## 1. 조사 결과

- **패턴**: 쓰기는 전부 Server Action(`"use server"` 파일, `lib/actions/*.ts`), 읽기는 Server Component. 클라이언트 검증 → 서버 재검증 이중 구조(`lib/validations/*.ts` + action 내부). `redirect()`는 항상 try/catch 바깥에 둔다. `.update()...select().single()`로 RLS가 조용히 0행을 반영하는 상황을 항상 감지한다(`lib/actions/onboarding.ts` 패턴).
- **Supabase 클라이언트**: `lib/supabase/server.ts`(서버), `lib/supabase/client.ts`(브라우저 — 지금까지 Google 로그인 버튼 하나에서만 사용), `lib/supabase/proxy.ts`(미들웨어, 세션 갱신 + 로그인 라우트 가드).
- **인증**: Google OAuth가 이미 완전히 동작한다 — `app/(auth)/login/page.tsx` → `GoogleSignInButton`(`signInWithOAuth`) → `app/auth/callback/route.ts`(`exchangeCodeForSession`) → `/dashboard`. **다만 이 OAuth는 production 프로젝트(`fwjebymvfcmwbrystlro`)에만 설정돼 있고, 방금 만든 staging 프로젝트에는 Google Cloud/Supabase Auth 쪽 redirect 설정이 안 되어 있을 가능성이 높다** — 이 세션은 Google Cloud Console이나 Supabase Auth 설정 화면에 접근할 방법이 없어 직접 구성할 수 없다. 그래서 staging 검증 전용으로 아래 3장의 임시 이메일/비밀번호 로그인을 추가한다.
- **라우트**: `app/(app)/layout.tsx`가 로그인 + `profiles.onboarding_completed`를 이중으로 확인해 미완료면 `/onboarding`으로 보낸다. `/dashboard`는 STEP 2-D의 확인용 임시 화면. `/upload`는 아직 없다.
- **CLI 연결**: `supabase/.temp/linked-project.json`이 **production**(`fwjebymvfcmwbrystlro`)에 링크돼 있다. `npm run types`나 `supabase db push`를 지금 그대로 실행하면 production을 대상으로 하므로, staging 작업 중에는 실행하지 말 것. staging 마이그레이션/타입은 이번 STEP에서 Supabase MCP로 직접 처리했다(2장).
- **업로드 관련 코드/라이브러리**: 없음. `tus-js-client`, `uppy` 등 미설치. `components/ui/`에 progress bar 컴포넌트 없음(shadcn 스타일로 새로 추가).
- **`.env.local`**: `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 2개만 있고 production을 가리킴 — service-role 키 등 민감한 값은 없음. 이번 STEP 동안 staging 값으로 바꿔둔다(4장).

## 2. Staging DB 준비 (이미 완료)

`0001`~`0009` 전부 staging에 적용 완료(STEP 4-1). 이번 STEP에서 실제 검증을 위해 추가로 한 것:
- `lib/database.types.ts`를 staging 프로젝트 기준으로 재생성(Supabase MCP `generate_typescript_types`) — `video_analyses` 테이블과 RPC 7개 타입이 새로 들어옴.
- staging에 STEP 4-2 검증 전용 테스트 계정 1개(이메일/비밀번호, `onboarding_completed=true`, 채널 1개 포함)를 직접 SQL로 생성 — Google OAuth가 staging에 없기 때문에 이 계정으로만 실제 브라우저 로그인이 가능하다.

## 3. 최소 vertical slice 구조 (요청하신 10단계 그대로)

업로드 로직(엔진)과 UI를 분리한다 — 나중에 디자인을 통째로 바꿔도 로직은 그대로 재사용한다.

```
lib/upload/constants.ts          — 업로드 제약값 한 곳에 모음 (파일 크기 상한, 허용 mime)
lib/upload/video-upload-engine.ts — TUS 업로드 상태 머신 (React 비의존, tus-js-client 래핑)
lib/validations/video-upload.ts   — 클라이언트 사전 확인용 Zod 스키마 (UX 목적만)
lib/actions/video-analyses.ts     — Server Action: createVideoAnalysis / confirmVideoUploaded / cancelVideoAnalysis
components/upload/video-upload.tsx — UI (드래그앤드롭/선택, 진행률, 상태, 실패, 재시도, 취소)
app/(app)/upload/page.tsx          — 이번 vertical slice를 확인하는 전용 페이지
```

흐름: 파일 선택(클라이언트 사전 확인: mime, 50MB) → `createVideoAnalysis()` 호출(같은 시도 안에서는 `client_request_id`를 재사용해 재시도해도 새 행이 안 생기게 함) → 반환된 `storage_path`를 그대로 TUS `objectName`으로 사용 → `tus-js-client`로 resumable upload(`x-upsert` 미사용, chunkSize 6MB, `uploadDataDuringCreation:true`) → 진행률을 `onProgress`로 표시 → 성공 시 `confirmVideoUploaded()`가 `mark_video_analysis_uploaded`를 호출하고 반환된 `status`/`file_size_bytes`를 화면에 그대로 보여줌 → 실패 시 에러 메시지 + "재시도"(같은 파일이면 tus의 fingerprint로 이어서 업로드, `findPreviousUploads()`) + "취소"(`cancel_video_analysis` 호출 + `upload.abort(true)`).

## 4. Free plan 제약 반영

`lib/upload/constants.ts`의 `MAX_UPLOAD_BYTES = 50 * 1024 * 1024` 하나로만 관리한다. 2GB/30분은 이번 STEP에서 강제하지 않고, 상수 옆에 "Pro 전환 후 이 값과 `videos` 버킷의 `file_size_limit`을 함께 올릴 것"이라는 주석만 남긴다. 클라이언트 확인은 UX용일 뿐이고, 진짜 신뢰 경계는 여전히 Supabase 플랫폼의 전역 업로드 상한(현재 50MB)이다 — DB/Storage 정책은 이번 STEP에서 넓히지 않는다.

## 5. 이번 STEP에서 하지 않는 것 (요청하신 그대로)

Cloud Run 분석, Cloud Tasks, STT/OCR, AI report, 결과 페이지, billing, production migration 적용 — 전부 손대지 않는다. `/dashboard`는 그대로 두고 `/upload`만 새로 추가한다.
