# docs/step-4-1-storage-smoke-test-checklist.md

## 목적과 실행 주체

이 문서는 **실제 스테이징 Supabase 프로젝트**에서 사람이(또는 팀의 CI가) 직접 실행해야 하는 10단계 smoke test 절차입니다.

이 세션(에이전트)은 실제 Supabase 프로젝트의 자격증명(anon key, service_role key 등)을 전혀 가지고 있지 않고, 안전 규칙상 **service_role key를 다루거나 요청할 수 없기 때문에** 이 테스트를 직접 실행하지 못했습니다. `supabase/tests/video_analyses_test_scenarios.sql`과 `supabase/tests/concurrency/run_concurrency_tests.sh`로 로컬 Postgres 하네스에서 RLS/함수 로직 자체는 검증했지만(plan 문서 21장/23-5장 참고), 그것은 **Postgres 로직 검증**이지 **실제 Supabase Storage API(TUS 포함)의 동작 검증**을 대체하지 않습니다. 아래 10단계는 반드시 실제 프로젝트에서 실행해 주세요.

## 사전 준비

- [ ] `0005`~`0009` 마이그레이션이 스테이징 프로젝트에 적용되어 있음 (production 아님 — 이 문서는 스테이징 전용)
- [ ] `videos` 버킷이 생성되어 있음 (private, `file_size_limit=null` — plan 23-4장 참고, Free 플랜 50MB 한도 확인 전까지 임의 값 넣지 않음)
- [ ] 실제 테스트 계정 2개(A, B)의 로그인 세션에서 발급된 진짜 JWT(access token)를 확보 (서비스 role key가 아닌, 일반 로그인 흐름으로 얻은 사용자 JWT)
- [ ] 테스트용 작은 MP4 파일 1개 (수 MB 수준, pause/resume을 눈으로 확인할 수 있을 정도의 크기 권장)
- [ ] TUS 클라이언트(예: `tus-js-client`, Supabase JS SDK의 `storage.from(...).upload()` resumable 옵션, 또는 `tusd` CLI 등 팀이 쓰는 도구)

## 10단계 절차

### 1. 실제 사용자 JWT로 analysis 생성

- [ ] 사용자 A의 JWT로 `create_video_analysis` RPC (또는 앱의 해당 API 엔드포인트) 호출
- [ ] 응답에서 `id`, `storage_path`(`{user_id}/{id}/original.mp4` 형태), `status='pending'` 확인
- [ ] 기록: analysis id = `__________`, storage_path = `__________`

### 2. 해당 경로로 작은 MP4를 TUS로 업로드 시작

- [ ] 1단계의 `storage_path`를 대상으로 TUS resumable upload 시작 (upsert 옵션은 사용하지 않음 — V1은 `x-upsert:true` 미사용)
- [ ] 업로드가 청크 단위로 진행되는지 확인 (즉시 완료되지 않고 최소 2개 이상 청크로 나뉘는 파일 사용 권장)

### 3. 업로드를 pause 했다가 resume

- [ ] 업로드 도중 클라이언트에서 중단(pause) — 네트워크 끊기 또는 클라이언트 중지로 시뮬레이션 가능
- [ ] 동일한 TUS upload URL/fingerprint로 resume하여 이어서 업로드되는지 확인 (처음부터 다시 올라가면 안 됨)

### 4. 업로드 완료

- [ ] TUS 업로드가 100%까지 완료됨
- [ ] 이 시점에 `storage.objects`에 해당 row가 실제로 생성되는지 확인 (Supabase 대시보드의 Storage 탐색기 또는 SQL Editor에서 `select * from storage.objects where name = '{storage_path}'` — **service_role 세션에서만**, 팀 내부 확인용)

### 5. `mark_video_analysis_uploaded` 호출

- [ ] 사용자 A의 JWT로 `mark_video_analysis_uploaded(analysis_id)` 호출
- [ ] 응답에서 `status='uploaded'` 확인

### 6. `metadata->>'size'` 값 검증

- [ ] 5단계 응답의 `file_size_bytes`가 실제로 업로드한 파일의 바이트 크기와 정확히 일치하는지 확인 (허용 오차 없이 정확히 같아야 함)
- [ ] 불일치하면: `0006_video_analyses_functions.sql`의 `mark_video_analysis_uploaded` 함수 주석에 있는 `contingency` 메모를 참고해 `metadata` 키 이름을 재조사해야 함 (현재는 공식 문서 기준 `size` 키만 사용, `contentLength` fallback 제거된 상태)
- [ ] 기록: 업로드한 실제 파일 크기 = `__________` bytes, `file_size_bytes` 응답값 = `__________` bytes → 일치 여부 `__________`

### 7. 같은 경로에 두 번째 업로드 시도 → 거부되어야 함

- [ ] 동일한 `storage_path`로 다시 TUS 업로드(새 파일 또는 같은 파일) 시도
- [ ] 실패해야 함 (V1은 upsert 미사용이므로 기존 오브젝트가 있으면 새 INSERT가 RLS 또는 Storage API 자체 충돌로 거부되어야 함)
- [ ] 실패 응답의 HTTP 상태 코드와 에러 메시지를 기록: `__________`

### 8. 사용자 B가 사용자 A의 경로에 접근 시도 → 거부되어야 함

- [ ] 사용자 B의 JWT로 사용자 A의 `storage_path`에 업로드/다운로드/조회 시도
- [ ] 전부 거부되어야 함 (`video_objects_insert_own`, `video_objects_select_own_while_pending` 정책의 "본인 폴더" 조건)
- [ ] 기록: 시도한 작업과 결과 `__________`

### 9. 업로드 완료 후 원본 오브젝트 overwrite 시도 → 거부되어야 함

- [ ] 5~6단계로 `uploaded` 상태가 된 이후, 사용자 A 본인이 같은 경로에 다시 업로드(덮어쓰기) 시도
- [ ] 거부되어야 함 (UPDATE RLS 정책이 아예 없음 — `0007` B-2 참고)
- [ ] 기록: 결과 `__________`

### 10. SELECT 정책이 과도한 다운로드 권한을 열지 않는지 확인

- [ ] `uploaded`로 전환된 이후(5단계 이후), 사용자 A 본인이 원본 파일을 계속 조회/다운로드할 수 있는지 확인 — **가능하면 안 됨** (`video_objects_select_own_while_pending` 정책은 `status='pending'`일 때만 허용하도록 설계됨)
- [ ] 여전히 조회/다운로드가 가능하다면: 정책의 pending 조건이 실제 환경에서 기대대로 동작하지 않는다는 뜻이므로 즉시 보고 필요 (로컬 하네스의 1-3b/2-10 테스트는 이 조건을 검증했지만 실제 Storage API 응답 캐싱 등 다른 경로로 우회될 가능성은 로컬에서 확인 불가)
- [ ] 기록: 결과 `__________`

## 판정 기준

10단계 전부 기대한 결과와 일치해야 "production 적용 가능"으로 판단할 수 있습니다. 하나라도 예상과 다르면:

1. 어느 단계에서 무엇이 다르게 동작했는지 정확히 기록
2. `0006`/`0007` 마이그레이션 또는 앱 코드 중 무엇을 고쳐야 하는지 판단
3. 수정 후 이 10단계를 처음부터 다시 실행 (부분 재실행 금지 — 상태가 이전 단계에 의존하므로)

## 주의사항

- 이 테스트는 **스테이징 프로젝트**에서 실행하십시오. **실제 production 프로젝트에 대해서는 이 문서의 절차든 다른 어떤 절차든 아직 마이그레이션 자체가 적용되어 있지 않으므로 실행할 수 없습니다.**
- 테스트 중 생성된 `video_analyses` 행과 `storage.objects` 오브젝트는 테스트 종료 후 정리하십시오. `storage.objects`에 대한 정리는 반드시 **Storage API의 `remove()`**를 사용하고, SQL `DELETE`는 사용하지 마십시오(orphan 방지 원칙 — plan 문서 20-1장 참고).
- service_role key는 이 체크리스트의 어느 단계에서도 클라이언트 코드나 프론트엔드에 노출되어서는 안 됩니다. 4단계의 내부 확인(대시보드/SQL Editor)만 service_role 컨텍스트를 사용하고, 나머지는 전부 사용자 JWT로 진행하십시오.
