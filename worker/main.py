"""
worker/main.py

STEP 4-3A Cloud Run **Job** entrypoint.

⚠️ 이건 Job이지 Service가 아닙니다 — HTTP 서버를 띄우지 않습니다. Cloud
   Tasks가 Cloud Run Admin API의 jobs.run을 직접 호출해서 execution을
   시작시키면, 그 execution의 컨테이너 안에서 이 스크립트가 한 번 실행되고
   끝납니다(lib/gcp/cloud-tasks.ts가 만드는 task가 그 호출입니다).

⚠️ 지금은 실제 처리 파이프라인(FFmpeg 등)이 없습니다. 이번 STEP은 큐→Cloud
   Tasks→Cloud Run Job→acquire→progress→complete로 이어지는 오케스트레이션
   자체가 실제로 동작하는지만 검증하는 더미 report를 남깁니다.

흐름 (지시사항 PART 9/10):
  1) 환경변수 검증
  2) execution_id = f"{CLOUD_RUN_JOB}/{CLOUD_RUN_EXECUTION}" 구성
  3) acquire_video_analysis_run(id, execution_id) — None이면 비싼 작업을
     시작하지 않고 즉시 종료(exit 0)
  4) run_token 추출 → update_video_analysis_progress → complete_video_analysis
  5) complete가 None이면(=run_token이 이미 fencing되어 stale) 아무것도
     덮어쓰지 않고 그냥 종료(exit 0)
  6) 예외 발생 시 CLOUD_RUN_TASK_ATTEMPT 기준으로:
     - run_token을 아직 모르는 단계(acquire 자체가 실패)에서 예외가 나면
       attempt와 무관하게 fail_video_analysis를 부를 방법이 없으므로 그냥
       비정상 종료(processing으로 남거나, 커밋 자체가 안 됐다면 여전히
       queued — 둘 다 다음 attempt/acquire가 안전하게 재시도 가능).
     - run_token을 이미 아는 단계(update_progress/complete 도중)에서 예외가
       나면: 마지막 attempt가 아니면 fail_video_analysis를 부르지 않고(=
       processing 상태를 그대로 두어 같은 execution의 다음 attempt가
       acquire의 "같은 execution 재시도" 분기로 재획득하게 함) 비정상
       종료. 마지막 attempt면 fail_video_analysis를 부른 뒤 비정상 종료.

지금 이 STEP에서 일부러 만들지 않는 것: "오래 processing에 멈춰 있는 행을
찾아서 회수하는" reaper/heartbeat 시스템. 그 시스템이 없다는 뜻은, run_token을
모르는 단계에서 예외가 나거나, worker 컨테이너 자체가 강제 종료되는 경우
(OOM kill 등) 마지막 attempt에서도 fail_video_analysis가 절대 호출되지 못하고
행이 processing에 영구히 남을 수 있다는 뜻입니다 — 이건 이번 STEP에서 임의로
확장하지 말라고 명시된 부분이라 blocker로 최종 보고서에 남깁니다.
"""

from __future__ import annotations

import os
import sys
from typing import Any

from supabase_client import VideoAnalysesRpcClient, build_client_from_env

REQUIRED_ENV_VARS = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANALYSIS_ID")

# Cloud Run Job이 실행 컨테이너에 자동으로 주입하는 값들 (사람이 직접 설정하지
# 않음). CLOUD_RUN_TASK_COUNT/CLOUD_RUN_TASK_INDEX도 자동 주입되지만 이번
# STEP의 로직(단일 task, 재시도 판단)에는 쓰이지 않아 필수값 검증에서
# 제외했습니다.
AUTO_ENV_VARS = ("CLOUD_RUN_JOB", "CLOUD_RUN_EXECUTION", "CLOUD_RUN_TASK_ATTEMPT")

# ⚠️ Cloud Run Job의 --max-retries 설정값은 CLOUD_RUN_TASK_ATTEMPT와 달리
# 자동으로 주입되는 환경변수가 아닙니다. "이번이 마지막 attempt인가"를
# 판단하려면 배포 시 설정한 --max-retries 값을 이 워커도 알아야 합니다.
# 지시사항의 "planned maxRetries=1"을 기본값으로 두되, CLOUD_RUN_TASK_MAX_RETRIES
# 환경변수로 오버라이드할 수 있게 해서 배포 설정이 바뀌어도 이 상수를 다시
# 배포하지 않고 맞출 수 있게 합니다. 이번 STEP은 실제 Cloud Run Job을 만들지
# 않으므로 이 기본값 자체는 실제 배포로 검증되지 않았습니다.
DEFAULT_MAX_RETRIES = 1

# video_analyses_error_code_check CHECK 제약(staging에서 pg_get_constraintdef로
# 직접 대조 확인)이 허용하는 값은 정확히 5개뿐입니다: upload_failed /
# unsupported_format / processing_timeout / pipeline_error / internal_error.
# 이 목록 밖의 값을 보내면 fail_video_analysis 자체가 DB에서 실패합니다.
# 이번 STEP은 오케스트레이션 자체만 시험하고 실제 처리 파이프라인이 없어서
# 항상 internal_error를 씁니다 — 실제 파이프라인이 붙는 이후 STEP에서
# unsupported_format/processing_timeout/pipeline_error로 세분화할 여지를
# 남겨둡니다.
ORCHESTRATION_FAILURE_ERROR_CODE = "internal_error"

DUMMY_REPORT: dict[str, Any] = {
    "version": "step-4-3a",
    "message": "orchestration test completed",
}
DUMMY_STAGE = "orchestration_test"
DUMMY_PROGRESS = 50


class WorkerConfigError(Exception):
    """필수 환경변수 누락 등, 재시도해도 의미 없는 설정 오류."""


def validate_env() -> None:
    missing = [name for name in (*REQUIRED_ENV_VARS, *AUTO_ENV_VARS) if not os.environ.get(name)]
    if missing:
        raise WorkerConfigError(f"필수 환경변수 누락: {', '.join(missing)}")


def build_execution_id() -> str:
    job = os.environ["CLOUD_RUN_JOB"]
    execution = os.environ["CLOUD_RUN_EXECUTION"]
    return f"{job}/{execution}"


def get_attempt_number() -> int:
    # Cloud Run Jobs 문서 기준 CLOUD_RUN_TASK_ATTEMPT는 0부터 시작합니다.
    return int(os.environ["CLOUD_RUN_TASK_ATTEMPT"])


def get_max_retries() -> int:
    raw = os.environ.get("CLOUD_RUN_TASK_MAX_RETRIES")
    if raw is None:
        return DEFAULT_MAX_RETRIES
    return int(raw)


def sanitize_error(exc: BaseException) -> tuple[str, str]:
    """
    예외를 DB에 안전하게 남길 수 있는 (error_code, error_message)로 변환합니다.

    error_code는 항상 ORCHESTRATION_FAILURE_ERROR_CODE(=internal_error)로
    고정합니다(위 CHECK 제약 설명 참고) — 예외 클래스 이름을 그대로 error_code로
    쓰지 않는 이유입니다.

    error_message는 예외 타입명 + str(exc)만 담고 500자에서 자릅니다.
    service_role key, Google 자격증명, Authorization 헤더, Secret Manager
    페이로드는 이 워커의 어떤 코드 경로에서도 예외 메시지에 실리지 않도록
    설계되어 있지만(어댑터가 그런 값을 절대 예외에 담아 올리지 않음),
    길이 제한은 예상 밖의 raw 응답 본문 등이 통째로 남는 것을 막는
    마지막 안전장치입니다.
    """
    message = f"{type(exc).__name__}: {exc}"
    return ORCHESTRATION_FAILURE_ERROR_CODE, message[:500]


def run(
    client: VideoAnalysesRpcClient,
    analysis_id: str,
    execution_id: str,
    attempt: int,
    max_retries: int,
) -> int:
    """
    실제 오케스트레이션 로직. main()이 조립한 의존성을 받아 동작하고 exit
    code를 돌려줍니다 — 테스트는 이 함수를 가짜 client로 직접 호출해서
    os.environ이나 실제 Supabase 접속 없이 검증합니다.
    """
    is_final_attempt = attempt >= max_retries

    acquired = client.acquire_video_analysis_run(analysis_id, execution_id)
    if acquired is None:
        print(
            "[worker] acquire 실패(다른 execution이 처리 중이거나 이미 terminal 상태) "
            f"analysis_id={analysis_id} execution_id={execution_id} attempt={attempt} — 종료"
        )
        return 0

    run_token = acquired["run_token"]
    duplicate_attempt = attempt > 0
    print(
        f"[worker] acquire 성공 analysis_id={analysis_id} execution_id={execution_id} "
        f"attempt={attempt} duplicate_attempt={duplicate_attempt}"
    )

    try:
        client.update_video_analysis_progress(analysis_id, run_token, DUMMY_STAGE, DUMMY_PROGRESS)
        completed = client.complete_video_analysis(analysis_id, run_token, DUMMY_REPORT)
    except Exception as exc:  # noqa: BLE001 — 재시도/실패 처리를 attempt 기준으로 분기하기 위해 의도적으로 광범위하게 잡음
        error_code, error_message = sanitize_error(exc)
        print(
            "[worker] 처리 중 예외 "
            f"analysis_id={analysis_id} execution_id={execution_id} attempt={attempt} "
            f"is_final_attempt={is_final_attempt} error_code={error_code}"
        )
        if is_final_attempt:
            client.fail_video_analysis(analysis_id, run_token, error_code, error_message)
        else:
            print(
                "[worker] 마지막 attempt가 아니므로 fail_video_analysis를 부르지 않고 "
                "processing 상태로 남깁니다(같은 execution_id의 다음 attempt가 재획득)"
            )
        return 1

    if completed is None:
        print(
            "[worker] complete 실패(run_token fencing — stale attempt) "
            f"analysis_id={analysis_id} execution_id={execution_id} attempt={attempt} — 종료"
        )
        return 0

    print(
        f"[worker] complete 성공 analysis_id={analysis_id} execution_id={execution_id} "
        f"attempt={attempt} stage={DUMMY_STAGE}"
    )
    return 0


def main() -> int:
    try:
        validate_env()
    except WorkerConfigError as exc:
        print(f"[worker] 설정 오류: {exc}")
        return 1

    analysis_id = os.environ["ANALYSIS_ID"]
    execution_id = build_execution_id()
    attempt = get_attempt_number()
    max_retries = get_max_retries()

    client = build_client_from_env()

    try:
        return run(client, analysis_id, execution_id, attempt, max_retries)
    except Exception as exc:  # noqa: BLE001
        # acquire_video_analysis_run 자체(또는 그 이전 단계)에서 예외가 난
        # 경우입니다. run_token을 아직 모르므로 fail_video_analysis를 부를
        # 방법이 없습니다 — attempt가 마지막이든 아니든 그냥 비정상 종료합니다.
        # acquire가 DB에 커밋되지 않았다면 행은 여전히 queued라 다음 acquire가
        # 안전하게 재시도할 수 있고, 커밋은 됐지만 응답을 못 받은 경우라면
        # 같은 execution_id의 다음 attempt가 acquire의 "같은 execution 재시도"
        # 분기(0011의 2번 UPDATE)로 다시 run_token을 받을 수 있습니다.
        error_code, _ = sanitize_error(exc)
        print(
            "[worker] acquire 이전/도중 예외(run_token 없음, fail_video_analysis 호출 불가) "
            f"analysis_id={analysis_id} execution_id={execution_id} attempt={attempt} "
            f"error_code={error_code}"
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
