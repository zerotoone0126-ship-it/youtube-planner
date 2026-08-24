#!/usr/bin/env bash
# ============================================================
# YouTube Planner — video_analyses 진짜 동시성 검증 스크립트
# STEP 4-1 (2026-08-24 지시로 추가)
#
# 목적: 아래 두 가지를 "실제로 동시에 실행되는 별도의 DB 세션 2개"로 검증합니다.
#
#   A. create_video_analysis — 동일 client_request_id로 두 세션이 동시에
#      호출해도: (1) DB row가 1개만 생기고, (2) 두 호출 모두 unique_violation
#      없이 성공하며, (3) 같은 행을 반환해야 합니다.
#
#   B. acquire_video_analysis_run — 동일 analysis에 대해 두 세션이 동시에
#      호출해도 정확히 한쪽만 실행권(run_token)을 얻어야 하고, attempt_count는
#      1만 증가해야 합니다(2가 아니라).
#
# supabase/tests/video_analyses_test_scenarios.sql은 단일 세션 순차 실행이라
# 완전한 동시성을 재현하지 못합니다(그 파일의 3-1/3-2 주석 참고). 이 스크립트는
# psql 프로세스 2개를 bash 백그라운드 job으로 실제로 동시에 띄워 검증합니다.
#
# 동시 도착을 흉내내는 방법: 먼저 "목표 시각(target_at) = 지금부터 2초 뒤"를
# 한 번 계산해서 두 세션 스크립트에 동일한 값으로 넘깁니다. 각 세션은 그
# 시각까지 짧은 pg_sleep으로 busy-wait한 뒤 거의 동시에 본 호출을 실행합니다.
# 두 세션 모두 같은 DB 서버의 시계를 기준으로 대기하므로 나노초 단위의 완벽한
# 동시성은 아니어도, 두 개의 독립된 트랜잭션이 겹치는 시점에 충돌하도록
# 만들기에는 충분합니다 — 애초에 "완벽한 동시성"은 어떤 방식으로도 증명할 수
# 없고, 우리가 실제로 검증하려는 것은 "겹치더라도 예외 없이 원자적으로
# 처리되는가"입니다.
#
# 사용법:
#   PGHOST=... PGPORT=... PGDATABASE=... PGUSER=... PGPASSWORD=... \
#     bash run_concurrency_tests.sh
#   (연결 정보를 안 주면 psql 기본 환경변수/설정을 그대로 사용합니다 — 로컬
#   기본 소켓 연결을 시도합니다)
#
# ⚠️ 로컬/스테이징 전용입니다. production에서 실행하지 마세요 — 이 스크립트는
# 테스트용 auth.users 행을 직접 만들고, 실행이 끝나면 스스로 정리합니다.
# 실행 전제: 0005~0009가 이미 적용된 데이터베이스.
# ============================================================

set -euo pipefail

PSQL="psql -v ON_ERROR_STOP=1 -X -q"
# -q(quiet)가 필요한 이유: -tAc만으로는 INSERT/UPDATE/DELETE의 "INSERT 0 1" 같은
# 명령 완료 태그가 여전히 출력되어(SELECT 결과와 달리 -t/-A로 안 걸러짐),
# `returning id` 값을 bash 변수로 캡처할 때 값 뒤에 태그가 섞여 UUID 파싱이
# 깨지는 문제가 있었습니다 — 실제로 이 스크립트를 실행해 보고 발견/수정.
WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

FAIL=0

echo "== 0. 픽스처 준비 =="

USER_A=$($PSQL -tAc "select gen_random_uuid();")

$PSQL -c "
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                         email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                         created_at, updated_at)
values ('${USER_A}', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'concurrency-test-a@example.invalid', 'x', now(),
        '{}', '{}', now(), now());
" > /dev/null

CHANNEL_A=$($PSQL -tAc "
insert into public.channels (user_id, categories, video_style, primary_goal, description, upload_frequency)
values ('${USER_A}'::uuid, array['정보'], 'shorts', 'views', '동시성 테스트 채널 설명 최소 10자.', 'w1')
returning id;
")

echo "user_a=${USER_A} channel_a=${CHANNEL_A}"


# ============================================================
# A. create_video_analysis — client_request_id 동시 호출 race
# ============================================================
echo ""
echo "== A. client_request_id 동시 생성 요청 (진짜 병렬 2세션) =="

REQ_ID=$($PSQL -tAc "select gen_random_uuid();")
TARGET_A=$($PSQL -tAc "select (clock_timestamp() + interval '2 seconds')::text;")

run_create_session() {
  local out_file="$1"
  $PSQL -t -A > "$out_file" 2>&1 <<SQL
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','${USER_A}','role','authenticated')::text, false);

do \$\$
declare
  v_target timestamptz := '${TARGET_A}'::timestamptz;
begin
  while clock_timestamp() < v_target loop
    perform pg_sleep(0.01);
  end loop;
end;
\$\$;

select (public.create_video_analysis('game', '${CHANNEL_A}'::uuid, '${REQ_ID}'::uuid)).id;

reset role;
SQL
}

run_create_session "$WORKDIR/race_a.out" &
PID_A=$!
run_create_session "$WORKDIR/race_b.out" &
PID_B=$!

set +e
wait "$PID_A"; STATUS_A=$?
wait "$PID_B"; STATUS_B=$?
set -e

echo "-- session A output --"; cat "$WORKDIR/race_a.out"
echo "-- session B output --"; cat "$WORKDIR/race_b.out"

if [ "$STATUS_A" -ne 0 ] || [ "$STATUS_B" -ne 0 ]; then
  echo "FAIL: A — 세션 프로세스가 0이 아닌 종료 코드를 반환함 (A=$STATUS_A, B=$STATUS_B)"
  FAIL=1
fi

if grep -qi "ERROR" "$WORKDIR/race_a.out" "$WORKDIR/race_b.out"; then
  echo "FAIL: A — 세션 출력에 ERROR가 있음 (unique_violation 등 원자성 실패 의심)"
  FAIL=1
fi

ID_A=$(grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$WORKDIR/race_a.out" | tail -1 || true)
ID_B=$(grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$WORKDIR/race_b.out" | tail -1 || true)

if [ -z "$ID_A" ] || [ -z "$ID_B" ]; then
  echo "FAIL: A — 두 세션 중 하나 이상이 유효한 id를 반환하지 않음 (A=$ID_A, B=$ID_B)"
  FAIL=1
elif [ "$ID_A" != "$ID_B" ]; then
  echo "FAIL: A — 두 세션이 서로 다른 id를 반환함 (A=$ID_A, B=$ID_B) — 같은 client_request_id인데 다른 행이 생성됨"
  FAIL=1
else
  echo "PASS: A-1 — 두 세션 모두 예외 없이 성공했고 같은 id를 반환함 (id=$ID_A)"
fi

ROW_COUNT=$($PSQL -tAc "select count(*) from public.video_analyses where user_id='${USER_A}'::uuid and client_request_id='${REQ_ID}'::uuid;")
if [ "$ROW_COUNT" != "1" ]; then
  echo "FAIL: A-2 — client_request_id 기준 DB row가 ${ROW_COUNT}개 (1이어야 함)"
  FAIL=1
else
  echo "PASS: A-2 — DB에는 정확히 1개의 row만 생성됨"
fi


# ============================================================
# B. acquire_video_analysis_run — launcher CAS 동시 호출 race
# ============================================================
echo ""
echo "== B. launcher 실행권 동시 획득 시도 (진짜 병렬 2세션) =="

ANALYSIS_ID=$($PSQL -tAc "select gen_random_uuid();")

$PSQL -c "
insert into public.video_analyses (id, user_id, channel_id, genre, storage_path, status)
values ('${ANALYSIS_ID}'::uuid, '${USER_A}'::uuid, '${CHANNEL_A}'::uuid, 'game',
        '${USER_A}/${ANALYSIS_ID}/original.mp4', 'queued');
" > /dev/null

TARGET_B=$($PSQL -tAc "select (clock_timestamp() + interval '2 seconds')::text;")

run_acquire_session() {
  local out_file="$1"
  $PSQL -t -A > "$out_file" 2>&1 <<SQL
set role service_role;

do \$\$
declare
  v_target timestamptz := '${TARGET_B}'::timestamptz;
begin
  while clock_timestamp() < v_target loop
    perform pg_sleep(0.01);
  end loop;
end;
\$\$;

select (public.acquire_video_analysis_run('${ANALYSIS_ID}'::uuid)).id;

reset role;
SQL
}

run_acquire_session "$WORKDIR/acquire_a.out" &
PID_C=$!
run_acquire_session "$WORKDIR/acquire_b.out" &
PID_D=$!

set +e
wait "$PID_C"; STATUS_C=$?
wait "$PID_D"; STATUS_D=$?
set -e

echo "-- session A output --"; cat "$WORKDIR/acquire_a.out"
echo "-- session B output --"; cat "$WORKDIR/acquire_b.out"

if [ "$STATUS_C" -ne 0 ] || [ "$STATUS_D" -ne 0 ]; then
  echo "FAIL: B — 세션 프로세스가 0이 아닌 종료 코드를 반환함 (A=$STATUS_C, B=$STATUS_D)"
  FAIL=1
fi

if grep -qi "ERROR" "$WORKDIR/acquire_a.out" "$WORKDIR/acquire_b.out"; then
  echo "FAIL: B — 세션 출력에 ERROR가 있음"
  FAIL=1
fi

WINNER_A=$(grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$WORKDIR/acquire_a.out" | tail -1 || true)
WINNER_B=$(grep -Eo '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$WORKDIR/acquire_b.out" | tail -1 || true)

WINNERS=0
[ -n "$WINNER_A" ] && WINNERS=$((WINNERS + 1))
[ -n "$WINNER_B" ] && WINNERS=$((WINNERS + 1))

if [ "$WINNERS" -ne 1 ]; then
  echo "FAIL: B-1 — 실행권을 획득한 세션 수가 ${WINNERS}개 (정확히 1개여야 함, 이중 Job 시작 위험)"
  FAIL=1
else
  echo "PASS: B-1 — 두 세션 중 정확히 하나만 실행권을 획득함 (winner=${WINNER_A:-$WINNER_B})"
fi

ATTEMPT_COUNT=$($PSQL -tAc "select attempt_count from public.video_analyses where id='${ANALYSIS_ID}'::uuid;")
FINAL_STATUS=$($PSQL -tAc "select status from public.video_analyses where id='${ANALYSIS_ID}'::uuid;")
if [ "$ATTEMPT_COUNT" != "1" ]; then
  echo "FAIL: B-2 — attempt_count가 ${ATTEMPT_COUNT} (1이어야 함 — 두 세션이 모두 반영되면 안 됨)"
  FAIL=1
else
  echo "PASS: B-2 — attempt_count가 정확히 1 (동시 호출 중 승자만 반영됨)"
fi
if [ "$FINAL_STATUS" != "processing" ]; then
  echo "FAIL: B-3 — status가 ${FINAL_STATUS} (processing이어야 함)"
  FAIL=1
else
  echo "PASS: B-3 — status가 processing으로 정확히 1번 전이됨"
fi


# ============================================================
# CLEANUP
# ============================================================
echo ""
echo "== 정리 =="
$PSQL -c "
delete from public.video_analyses where user_id = '${USER_A}'::uuid;
delete from public.channels where user_id = '${USER_A}'::uuid;
delete from auth.users where id = '${USER_A}'::uuid;
" > /dev/null
echo "테스트 데이터 정리 완료"

echo ""
if [ "$FAIL" -ne 0 ]; then
  echo "===== 결과: FAIL — 위 로그에서 FAIL 항목을 확인하세요 ====="
  exit 1
else
  echo "===== 결과: 전부 PASS ====="
  exit 0
fi
