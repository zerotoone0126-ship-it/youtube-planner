# docs/step-4-1-migration-test-plan.md

`supabase/tests/video_analyses_test_scenarios.sql`(로컬/스테이징 전용, production 금지)의 시나리오 목록과 각각이 검증하는 요구사항입니다. 스크립트 자체가 실행 가능한 assertion이므로, 이 문서는 사람이 리뷰할 때 "왜 이 케이스가 필요한가"를 빠르게 확인하는 용도입니다.

pgTAP 등 별도 테스트 프레임워크는 이 프로젝트에 설치돼 있지 않아(`supabase/config.toml` 자체가 없음), 순수 PL/pgSQL `DO` 블록 + `RAISE EXCEPTION`으로 작성했습니다. 위에서부터 순서대로 실행해 에러 없이 끝까지 통과하면 전체 통과입니다.

## 0. SETUP

테스트 사용자 2명(`user_a`, `user_b`)을 `auth.users`에 직접 생성하고(로그인 흐름 자체를 테스트하는 것이 아니라 `auth.uid()`를 세션에서 `set_config('request.jwt.claims', ...)`로 시뮬레이션하는 표준 방식), `user_a` 소유 채널 1개를 만듭니다.

## 0-1. Storage RLS 정책 목록 (2026-08-24 갱신)

`storage.objects`에 대한 정책은 아래 2개뿐입니다 (하네스에서 `pg_policy` 카탈로그로 직접 확인, `polcmd`: `a`=INSERT, `r`=SELECT):

| 정책 | 명령 | 조건 요약 |
|---|---|---|
| `video_objects_insert_own` | INSERT | 본인 폴더(`storage.foldername(name)[1] = auth.uid()`) |
| `video_objects_select_own_while_pending` | SELECT | 본인 폴더 + 해당 경로의 `video_analyses` 행이 본인 소유이고 `status='pending'` |

UPDATE, DELETE 정책은 없습니다(2026-08-24 지시로 UPDATE 정책 제거, 근거는 `0007` 파일 주석 및 plan 문서 23-2장 참고). `video_analyses` 테이블에는 `video_analyses_select_own`만 있고 UPDATE/DELETE 정책은 없습니다(20장/23장).

## 1. 정상 흐름

| # | 시나리오 | 검증 내용 |
|---|---|---|
| 1-1 | `create_video_analysis` 호출 | 행 생성, `status='pending'`, `storage_path`가 결정적 형태로 계산됨 |
| 1-2 | storage upload 시뮬레이션 | 본인 폴더에 `storage.objects` insert 성공(= INSERT RLS 정책 확인 겸용) |
| 1-2b | 업로더 본인이 같은 컨텍스트에서 방금 만든 pending 오브젝트를 SELECT | 성공, `metadata->>'size'` 값 일치 (2026-08-24 신규 — `video_objects_select_own_while_pending` 정책 검증. 실제 Storage API의 `INSERT ... RETURNING *` 흐름을 시뮬레이션) |
| 1-2c | pending 상태에서 같은 경로에 UPDATE(덮어쓰기) 시도 | 0행 (2026-08-24 신규 — UPDATE 정책을 완전히 제거했으므로 pending 여부와 무관하게 항상 거부되어야 함을 확인) |
| 1-3 | `mark_video_analysis_uploaded` | `status='uploaded'`, `file_size_bytes`가 Storage 메타데이터에서 채워짐 |
| 1-3b | 업로드 완료(= pending 이탈) 이후 본인이 같은 오브젝트를 SELECT | 0행 (2026-08-24 신규 — "영구적인 광범위 SELECT 권한은 주지 않는다"는 요청을 검증. `video_objects_select_own_while_pending`의 pending 조건이 업로드 완료 시점부터 실제로 막는지 확인) |
| 1-4 | `queued` 전환 | `service_role`만 가능(authenticated UPDATE 정책 없음을 재확인) |
| 1-5 | `acquire_video_analysis_run` | `status='processing'`, `run_token` 발급, `attempt_count=1` |
| 1-6 | worker 진행 상태 갱신 | `update_video_analysis_progress` RPC 호출, 올바른 `run_token`이면 반영된 행 반환 (2026-08-24: 원시 UPDATE에서 RPC로 변경 — run_token 조건이 DB-level invariant가 되도록) |
| 1-7 | 완료 처리 | `complete_video_analysis` RPC 호출, `run_token` 일치 조건부로 `completed` 전이, `report` 필수 CHECK 통과 (2026-08-24: RPC로 변경) |

## 2. 보안 (전부 거부되어야 함)

| # | 시나리오 | 검증 내용 |
|---|---|---|
| 2-1 | 다른 user의 analysis SELECT | 0행 (SELECT RLS) |
| 2-2 | 다른 user의 `channel_id`로 생성 | 예외 발생 (`create_video_analysis` 내부 소유권 확인) |
| 2-3 | 다른 user의 storage path에 insert | RLS 거부 (`storage.foldername` 조건) |
| 2-4 | 사용자가 `status`/`report` 직접 UPDATE | 권한 오류(`permission denied`) — UPDATE 정책도 없지만, 애초에 `authenticated`에게 UPDATE 테이블 권한(GRANT) 자체가 없어 RLS 이전에 권한 계층에서 막힘 (2026-08-24 지시로 실제 동작에 맞게 수정 — 이전 버전은 "0행"을 기대했으나 하네스 실행 결과 하드 에러였음) |
| 2-5 | 사용자가 `acquire_video_analysis_run`(service_role 전용) 호출 | 권한 오류 (EXECUTE grant 없음) |
| 2-6 | 사용자가 `update_video_analysis_progress`(service_role 전용) 호출 | 권한 오류 (EXECUTE grant 없음, 2026-08-24 신규) |
| 2-7 | 사용자가 `complete_video_analysis`(service_role 전용) 호출 | 권한 오류 (EXECUTE grant 없음, 2026-08-24 신규) |
| 2-8 | 사용자가 `fail_video_analysis`(service_role 전용) 호출 | 권한 오류 (EXECUTE grant 없음, 2026-08-24 신규) |
| 2-9 | 사용자가 본인의 completed 분석 행을 직접 DELETE | 권한 오류(`permission denied`) — DELETE 정책과 DELETE 테이블 권한을 모두 제거했음을 검증 (2026-08-24 신규 — orphan storage 방지를 위해 사용자 직접 DELETE를 아예 막은 변경과 짝을 이루는 테스트) |
| 2-10 | user_b가 user_a의 pending 오브젝트를 경로를 알고 SELECT 시도 | 0행 (2026-08-24 신규 — `video_objects_select_own_while_pending` 정책이 "본인 폴더" 조건까지 정확히 강제하는지 검증. 경로를 알아도 타인 소유면 볼 수 없어야 함) |

## 3. 중복 / Retry

| # | 시나리오 | 검증 내용 |
|---|---|---|
| 3-1 | 동일 `client_request_id`로 2회 생성 (단일 세션 순차) | 행 1개만, 같은 행 반환 |
| 3-2 | launcher 2회 호출(Cloud Task retry 시뮬레이션, 단일 세션 순차) | 2차 호출은 실행권을 얻지 못함(0행) |
| 3-3 | stale(잘못된) `run_token`으로 worker update | `update_video_analysis_progress`가 `null` 반환 (2026-08-24: RPC 경유로 변경) |
| 3-4 | `completed` 이후 이전 worker의 재시도 update | `fail_video_analysis`가 `null` 반환, 결과 덮어쓰기 방지 (2026-08-24: RPC 경유로 변경) |

**⚠️ 3-1/3-2는 단일 세션 순차 실행이라 완전한 동시 레이스 재현이 아닙니다.** 진짜 동시성(두 개의 독립된 DB 세션이 실제로 겹치는 시점에 호출)은 별도 스크립트 `supabase/tests/concurrency/run_concurrency_tests.sh`로 검증합니다 — 아래 6장 참고. 이 스크립트는 2026-08-24 지시로 신규 작성했고, 로컬 하네스에서 실제로 실행해 두 케이스 모두 PASS를 확인했습니다(문서 하단 "실행 결과" 참고).

## 4. Storage edge case

| # | 시나리오 | 검증 내용 |
|---|---|---|
| 4-1 | 파일 없이 업로드 완료 RPC 호출 | `null` 반환, `status`는 `pending` 유지 |
| 4-2 | 예상 경로와 다른 파일명으로 업로드 | `null` 반환(정확히 `original.mp4` 경로만 인정) |
| 4-3 | 대용량(oversized) object | `file_size_bytes`가 Storage 메타데이터 값을 오차 없이 기록 — **버킷 `file_size_limit`이 아직 미정(6-1장)이라 버킷 레벨 거부 자체는 이 테스트로 검증 불가, 값 확정 후 별도 재검증 필요** |
| 4-4 | 업로드 완료 이후 overwrite 시도 | 0행 — (2026-08-24 갱신: UPDATE 정책 자체를 완전히 제거했으므로 "`pending`을 벗어나서" 막히는 게 아니라 애초에 UPDATE 정책이 없어서 항상 막힘. pending 동안도 막힌다는 것은 1-2c에서 이미 확인했고, 이 테스트는 "완료 이후에도 여전히 막힌다"는 것을 재확인) |

## 5. CLEANUP

테스트가 만든 `storage.objects`/`video_analyses`/`channels`/`auth.users` 행을 전부 제거합니다. 이 정리 단계에서만 `storage.objects`에 대한 SQL DELETE를 사용하며, 이는 실제 서비스 코드 경로가 아니라 테스트 자기 정리이므로 "Storage 삭제는 항상 Storage API `remove()`로만" 원칙의 예외가 아닙니다 — 실제 프로덕션 정리 로직에는 이 DELETE 문을 절대 재사용하지 않습니다.

## 6. 진짜 동시성 테스트 (`supabase/tests/concurrency/run_concurrency_tests.sh`)

2026-08-24 지시로 신규 작성. 위 1~5장의 스크립트는 전부 단일 psql 세션 안에서 순차적으로 실행되므로, "동시에 두 요청이 들어오면"이라는 시나리오를 진짜로 재현하지 못합니다(3-1/3-2의 주석 참고). 이 스크립트는 bash로 psql 프로세스 2개를 실제로 동시에 띄워서 검증합니다.

| # | 시나리오 | 검증 내용 |
|---|---|---|
| A-1 | 동일 `client_request_id`로 두 세션이 동시에 `create_video_analysis` 호출 | 두 세션 모두 예외(unique_violation 등) 없이 성공, 같은 `id` 반환 |
| A-2 | 위와 동일 상황 | DB에는 정확히 1개의 행만 생성됨 |
| B-1 | 동일 analysis에 대해 두 세션이 동시에 `acquire_video_analysis_run` 호출 | 정확히 한 세션만 실행권(run_token 있는 행) 획득, 다른 세션은 `null` |
| B-2 | 위와 동일 상황 | `attempt_count`가 정확히 1 (2가 아님 — 두 세션 모두 반영되면 이중 과금 위험) |
| B-3 | 위와 동일 상황 | `status`가 정확히 한 번만 `processing`으로 전이 |

**사용법**: `PGHOST=... PGPORT=... PGDATABASE=... PGUSER=... PGPASSWORD=... bash run_concurrency_tests.sh` (연결 정보를 생략하면 psql 기본 환경변수를 사용합니다). 로컬/스테이징 전용이며, 실행 후 스스로 만든 테스트 데이터를 정리합니다.

## 실행 결과 (2026-08-24, 로컬 Postgres 하네스에서 실제 실행)

⚠️ 아래는 실제 Supabase가 아니라 로컬 Postgres에 Supabase 핵심 요소(auth/storage 스키마, RLS, 세 가지 role)를 최소 재현한 환경에서의 결과입니다. 자세한 범위와 한계는 `plan-step-4-1-db-migration.md` 21장을 참고하세요.

- 1~5장(순차 스위트): 최초 실행 시 **30개 PASS, 0 FAIL** — 실행 도중 테스트 스크립트/하네스 설정의 버그 4건을 발견해 함께 수정했습니다(운영 SQL 버그 아님, 상세는 plan 21-2장).
- 6장(진짜 2세션 병렬): **A-1/A-2/B-1/B-2/B-3 전부 PASS**
- **(2026-08-24 재검증) Storage RLS 재설계 이후**: 1-2b/1-2c/1-3b/2-10 4개 시나리오를 추가해 총 **34개 PASS, 0 FAIL**로 재확인. 신규 `ytp_test2` 하네스에서 `rollback → 0005~0009 재적용 → 전체 재테스트` 사이클 포함 전부 정상.
- `rollback → 0005~0009 재적용 → 전체 재테스트`: 정상, 재테스트도 전부 PASS
- `0005~0009`를 롤백 없이 한 번 더 재실행: 에러 없음 (멱등성 확인)

## 실행 전 확인 사항

1. 로컬/스테이징 Supabase 프로젝트에 0005~0009가 이미 적용되어 있어야 합니다.
2. `mark_video_analysis_uploaded`의 `metadata->>'size'` 키 이름은 Supabase 공식 문서(`storage-size` 가이드 등)로 확인되었습니다(0006 함수 주석 참고, 2026-08-24 갱신 — 이전에는 "소스 코드 조사"로만 표기했으나 공식 문서 근거를 추가로 찾아 확정했습니다). 다만 이는 문서 기준 확인이며 이 프로젝트의 실제 Supabase Storage 버전에 대해 직접 실행해 확인된 것은 아닙니다 — 1-2/1-3/1-2b 시나리오가 통과하면 이 프로젝트에서도 해당 키가 맞다는 뜻이므로, 이 스크립트 자체가 그 검증을 겸합니다. 로컬 하네스에서는 이 값을 우리가 직접 넣었으므로 이 항목은 로컬 실행으로는 해소되지 않습니다 — 반드시 실제(또는 스테이징) Supabase 프로젝트에서 한 번 더 실행해야 합니다.
3. `service_role`로 `set role service_role;`이 동작하려면, 실행 계정이 그 역할로 전환할 권한이 있어야 합니다(Supabase SQL Editor는 기본적으로 가능).
4. 6장의 동시성 스크립트는 `psql` 커맨드라인 클라이언트가 필요합니다(Supabase SQL Editor는 웹 UI라 두 세션을 동시에 실행할 수 없으므로 이 스크립트는 로컬 `psql` 또는 CI에서 실행해야 합니다).
