-- ============================================================
-- YouTube Planner — 0007 video_analyses RLS + Storage 버킷/정책
-- STEP 4-1
--
-- 두 부분으로 나뉩니다:
--   A. public.video_analyses 테이블 RLS (select/delete만 — insert/update 정책은
--      의도적으로 없음, 0006의 RPC와 service_role이 대신함)
--   B. Storage 버킷(`videos`) 생성 + storage.objects RLS
--
-- 기존 프로젝트가 storage 스키마를 건드린 전례가 없으므로(research 4장), B는
-- 이번 STEP에서 새로 도입하는 부분입니다. STEP 4-2(업로드 UI) 시점에 실제
-- 업로드 흐름과 맞춰 재검토가 필요할 수 있다는 점을 plan 16장에 남겼습니다.
--
-- Supabase SQL Editor에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다
-- (drop policy if exists 후 재생성).
--
-- 주의: 이 파일은 아직 production에 적용되지 않았습니다 (STEP 4-1 승인 대기).
-- ============================================================


-- ============================================================
-- A. public.video_analyses RLS 정책
--
-- 조건은 항상 (select auth.uid()) = user_id — 기존 6개 테이블과 동일한 관례.
-- INSERT/UPDATE/DELETE 정책은 만들지 않습니다:
--   - 생성은 create_video_analysis() RPC(SECURITY DEFINER)만 가능
--   - uploaded/cancelled 전이는 각각의 RPC(SECURITY DEFINER)만 가능
--   - queued/processing/completed/failed 전이와 report/raw_metrics 쓰기는
--     서버 신뢰 경계(service_role)만 가능, RLS를 우회하므로 정책 자체가 불필요
--   - DELETE는 authenticated에게 전혀 열지 않습니다 (아래 설명 참고)
-- 정책이 없는 명령(insert/update/delete)은 RLS가 켜진 테이블에서
-- authenticated에게 전부 차단됩니다(0005의 "RLS 활성화" 절 주석과 동일한 원칙).
-- ============================================================

drop policy if exists "video_analyses_select_own" on public.video_analyses;
create policy "video_analyses_select_own"
  on public.video_analyses for select to authenticated
  using ( (select auth.uid()) = user_id );

-- ------------------------------------------------------------
-- DELETE 정책은 의도적으로 두지 않습니다 (2026-08-24 지시로 변경).
--
-- 이전 설계는 completed/failed/cancelled 상태에 한해 본인 DELETE를 authenticated에게
-- 허용했습니다. 그러나 이 경우 Storage에 원본 파일이 아직 남아있는 상태에서
-- DB 행이 먼저 사라지면, storage_path/storage_deleted_at 정보를 잃어버려서
-- Storage object가 관리되지 않는 orphan으로 남을 위험이 있었습니다
-- (원본 삭제는 반드시 Storage API remove()가 성공한 뒤에 이뤄져야 하는데,
-- 사용자가 먼저 DB 행을 지워버리면 그 순서를 보장할 방법이 사라집니다).
--
-- V1에서는 authenticated 사용자에게 DELETE 권한/정책을 전혀 열지 않습니다.
-- 분석 기록 삭제가 필요해지면(향후 STEP), 반드시 다음 순서로만 처리합니다:
--   1. 서버 엔드포인트(또는 그에 준하는 신뢰 경계)가 삭제 요청을 받음
--   2. service_role로 Storage API remove()를 호출해 원본 파일 삭제
--   3. remove() 성공을 확인
--   4. 그 다음에만 service_role로 DB 행을 DELETE
-- storage.objects에 대한 SQL DELETE는 이 절차에서도 여전히 금지입니다 — 항상
-- Storage API remove()만 사용합니다(plan 6-2장 원칙 그대로).
--
-- 계정 삭제(auth.users 삭제 → video_analyses가 on delete cascade로 함께 삭제)의
-- 정상 경로도 같은 원칙을 따라야 합니다: 가능한 경우 "먼저 해당 사용자의
-- Storage prefix({user_id}/ 이하 전체)를 remove()로 정리 → 그 다음 auth.users
-- 삭제"가 정상 흐름이어야 합니다. plan 6-2장의 orphan reconciliation(주기적
-- 전체 버킷 스캔)은 이 정상 흐름이 지켜지지 못한 비정상 종료(예: 정리 작업
-- 도중 서버 크래시, 정리 로직 자체의 버그) 상황을 잡아내는 백스톱으로만
-- 유지합니다 — 정상 삭제 경로를 대체하는 메커니즘이 아닙니다. 계정 삭제 흐름
-- 자체(엔드포인트, 트리거 여부 등)는 이 STEP의 범위가 아니며, 여기서는
-- "DB가 삭제 순서를 강제하지 않으니 애플리케이션이 반드시 지켜야 한다"는
-- 설계 의도만 남깁니다.
-- ------------------------------------------------------------


-- ============================================================
-- B-1. Storage 버킷 생성
--
-- private 버킷. file_size_limit은 여전히 null입니다 — 임의의 숫자를 넣지
-- 않았습니다. 2026-08-24 지시로 V1 목표(최대 2GB)를 검토했으나, production
-- Supabase 프로젝트가 현재 Free plan이라는 것을 사용자에게 직접 확인했습니다.
-- Supabase 공식 문서(Storage → Uploads → Limits)에 따르면 project 전체의
-- 전역 업로드 파일 크기 상한이 plan별로 고정되어 있고:
--   - Free: 최대 50MB ("the limit can't exceed 50 MB")
--   - Pro/Team: 최대 500GB까지 설정 가능
--   - bucket별 file_size_limit은 이 전역 상한보다 클 수 없음
--     ("you can specify the maximum file size on a per bucket level but
--     it can't be higher than this global limit")
-- 즉 지금 이 프로젝트에서는 버킷에 2GB를 넣어도 전역 50MB 상한에 의해 그대로
-- 적용되지 않습니다 — 오히려 "설정은 2GB인데 실제로는 50MB에서 막힌다"는
-- 혼란만 만듭니다. 그래서 이번에도 임의로 숫자를 넣지 않고 null로 유지하고,
-- "Free plan에서는 실제 영상 분석 서비스에 필요한 크기를 못 받는다"는 사실을
-- 22장 blocker에 명시합니다 — Pro 이상으로 업그레이드하거나 V1 범위(최대 영상
-- 길이/용량)를 Free plan 한도에 맞게 재조정하는 제품 결정이 먼저 필요합니다.
-- 출처: https://supabase.com/docs/guides/storage/uploads/file-limits
--
-- allowed_mime_types는 V1 범위(video/mp4만)를 반영합니다(plan 6-1장).
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', false, null, array['video/mp4'])
on conflict (id) do nothing;


-- ============================================================
-- B-2. storage.objects RLS (plan 6-3장, 2026-08-24 지시로 재검토 후 수정)
--
-- INSERT: 본인 폴더에만 (업로드 시작/완료).
--
-- SELECT: 본인 폴더 + 대응하는 video_analyses 행이 자신의 것이며 아직
--   'pending'인 동안만 (신규 추가). Supabase 공식 troubleshooting 문서
--   ("Storage error: 403 Forbidden: 'new row violates row-level security
--   policy' on upload")에 따르면 Storage API는 업로드 시 `INSERT ...
--   RETURNING *`로 오브젝트 메타데이터를 클라이언트에 돌려주는데, 이때 SELECT
--   정책이 없거나 방금 만든 행을 커버하지 못하면 RETURNING이 빈 결과를 내고
--   Storage API가 이를 403으로 취급합니다. 그래서 "SELECT 정책을 INSERT 정책과
--   동일한 범위로 추가하라"고 명시적으로 권장합니다. 이 권장을 따르되, 범위는
--   요청받은 대로 최대한 좁게(본인 폴더 + 본인 소유 + pending 상태) 잡았습니다
--   — 업로드가 끝나 status가 'pending'을 벗어나면 이 SELECT 권한도 함께
--   사라지므로, 사용자는 업로드 완료 후 원본 영상을 Storage API로 조회/다운로드할
--   수 없습니다(요청하신 "영구적인 광범위 SELECT 권한은 주지 않는다" 원칙).
--   출처: https://supabase.com/docs/guides/troubleshooting/storage-error-403-forbidden-new-row-violates-row-level-security-policy-on-upload-a94384
--
-- UPDATE: 정책을 두지 않습니다 (기존 video_objects_update_own_while_pending
--   제거, 2026-08-24 지시로 재검토). 근거 두 가지:
--   1. Supabase 공식 Storage Access Control 문서: "the only RLS policy
--      required for uploading objects is to grant the INSERT permission...
--      To allow overwriting files using the upsert functionality you will
--      need to additionally grant SELECT and UPDATE permissions" — 즉 UPDATE는
--      upsert(덮어쓰기) 기능에만 필요하다고 명시돼 있습니다.
--      출처: https://supabase.com/docs/guides/storage/security/access-control
--   2. Supabase 공식 블로그("Storage v3: Resumable Uploads")의 TUS 구현 설명:
--      재개형(resumable) 업로드는 마지막 청크가 도착했을 때에만
--      `storage.objects`에 행을 INSERT합니다 — 즉 업로드 도중의 PATCH
--      청크들은 이 테이블을 건드리지 않고, 완료 시점의 단일 INSERT만
--      발생합니다. upsert를 쓰지 않는 한(=x-upsert 헤더를 보내지 않는 한)
--      UPDATE가 필요한 경로 자체가 없습니다.
--      출처: https://supabase.com/blog/storage-v3-resumable-uploads
--   V1은 결정적 경로(deterministic path)에 대해 upsert/overwrite를 아예 쓰지
--   않기로 했으므로(클라이언트가 `x-upsert: true`를 보내지 않음), 이 두 근거를
--   합치면 UPDATE 정책이 필요하지 않습니다. ⚠️ 다만 TUS 업로드 내부의 "완료
--   처리(finalize)"가 문서화되지 않은 다른 경로로 UPDATE를 시도할 가능성까지
--   원본 소스 코드로 100% 확인하지는 못했습니다(GitHub 코드 브라우징이 이번
--   조사 환경에서 robots.txt로 막혀 열람 불가 — 추측 대신 이 사실 자체를
--   남깁니다). 그래서 이 결정은 **STEP 4-2 전 staging TUS smoke test로 반드시
--   실증 검증**해야 합니다 — 업로드가 끝까지 성공하면 이 판단이 맞다는 뜻이고,
--   만약 업로드 완료 단계에서 permission denied/RLS 오류가 난다면 그것이 바로
--   "TUS 완료 처리에 UPDATE가 필요하다"는 실제 증거이므로, 그때는 아래 정책을
--   즉시 복구하면 됩니다:
--     create policy "video_objects_update_own_while_pending"
--       on storage.objects for update to authenticated
--       using (
--         bucket_id = 'videos'
--         and (storage.foldername(name))[1] = (select auth.uid())::text
--         and exists (
--           select 1 from public.video_analyses va
--           where va.storage_path = storage.objects.name
--             and va.user_id = (select auth.uid())
--             and va.status = 'pending'
--         )
--       );
--
-- DELETE: authenticated에게 절대 부여하지 않음 — 삭제는 항상 service_role +
--   Storage API remove()로만 이뤄집니다(plan 6-2장). storage.objects에 대한
--   직접 SQL DELETE는 이 프로젝트 어디에서도 사용하지 않습니다.
-- ============================================================

drop policy if exists "video_objects_insert_own" on storage.objects;
create policy "video_objects_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "video_objects_select_own_while_pending" on storage.objects;
create policy "video_objects_select_own_while_pending"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.video_analyses va
      where va.storage_path = storage.objects.name
        and va.user_id = (select auth.uid())
        and va.status = 'pending'
    )
  );

-- video_objects_update_own_while_pending 정책은 더 이상 존재하지 않습니다
-- (위 UPDATE 설명 참고 — 의도적으로 제거했습니다. 실수로 빠진 것이 아닙니다).
-- 혹시 이전 초안을 스테이징 등에 이미 수동 적용해본 적이 있다면 대비해
-- 명시적으로도 지웁니다(신규 환경에서는 애초에 없으므로 no-op).
drop policy if exists "video_objects_update_own_while_pending" on storage.objects;

-- DELETE 정책 없음 — 위 설명대로 의도적입니다.
