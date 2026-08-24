"""
worker/tests/test_main.py

stdlib unittest만 사용합니다(이번 세션은 pip install도 막혀 있어서 pytest 등
서드파티 테스트 프레임워크를 설치할 수 없었습니다 — supabase 패키지 자체도
설치하지 못했습니다). worker/main.py의 run()은 VideoAnalysesRpcClient
프로토콜에만 의존하므로, 여기서는 진짜 Supabase 클라이언트 대신 이 파일
안에서 정의한 가짜(Fake) 구현을 주입해서 네트워크 없이 오케스트레이션
로직만 검증합니다.

실행 방법:
    cd worker && python3 -m unittest discover -s tests -v

이 테스트는 이번 세션에서 실제로 실행되어 통과를 확인했습니다(아래
최종 보고서의 "테스트 실행 결과" 항목 참고) — 코드만 작성하고 실행해보지
않은 TS 쪽 vitest 파일과는 다릅니다.
"""

from __future__ import annotations

import os
import sys
import unittest
from typing import Any, Optional

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main as worker_main  # noqa: E402  (sys.path 조정 후 import)


class FakeClient:
    """
    VideoAnalysesRpcClient 프로토콜의 테스트용 가짜 구현.

    각 메서드가 호출된 인자를 calls에 기록해서, "fail_video_analysis가
    호출되지 않았다"처럼 부작용이 없었음을 직접 검증할 수 있게 합니다.
    """

    def __init__(
        self,
        acquire_result: Optional[dict[str, Any]] = None,
        complete_result: Optional[dict[str, Any]] = None,
        raise_on: Optional[str] = None,
        raise_exc: Optional[BaseException] = None,
    ) -> None:
        self.acquire_result = acquire_result
        self.complete_result = complete_result
        self.raise_on = raise_on
        self.raise_exc = raise_exc or RuntimeError("boom")
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    def _maybe_raise(self, name: str) -> None:
        if self.raise_on == name:
            raise self.raise_exc

    def acquire_video_analysis_run(self, analysis_id, execution_id):
        self.calls.append(("acquire_video_analysis_run", (analysis_id, execution_id)))
        self._maybe_raise("acquire_video_analysis_run")
        return self.acquire_result

    def update_video_analysis_progress(self, analysis_id, run_token, stage, progress):
        self.calls.append(
            ("update_video_analysis_progress", (analysis_id, run_token, stage, progress))
        )
        self._maybe_raise("update_video_analysis_progress")
        return {"status": "processing"}

    def complete_video_analysis(self, analysis_id, run_token, report, raw_metrics=None, duration_sec=None):
        self.calls.append(
            ("complete_video_analysis", (analysis_id, run_token, report, raw_metrics, duration_sec))
        )
        self._maybe_raise("complete_video_analysis")
        return self.complete_result

    def fail_video_analysis(self, analysis_id, run_token, error_code, error_message=None):
        self.calls.append(
            ("fail_video_analysis", (analysis_id, run_token, error_code, error_message))
        )
        return {"status": "failed"}

    def call_names(self) -> list[str]:
        return [name for name, _ in self.calls]


ANALYSIS_ID = "11111111-1111-1111-1111-111111111111"
EXECUTION_ID = "video-analysis-worker/exec-1"


class RunAcquireNullTests(unittest.TestCase):
    def test_acquire_none_exits_zero_and_does_no_expensive_work(self):
        client = FakeClient(acquire_result=None)
        exit_code = worker_main.run(client, ANALYSIS_ID, EXECUTION_ID, attempt=0, max_retries=1)

        self.assertEqual(exit_code, 0)
        self.assertEqual(client.call_names(), ["acquire_video_analysis_run"])


class RunHappyPathTests(unittest.TestCase):
    def test_success_calls_progress_then_complete_and_exits_zero(self):
        client = FakeClient(
            acquire_result={"run_token": "token-abc", "status": "processing"},
            complete_result={"status": "completed"},
        )
        exit_code = worker_main.run(client, ANALYSIS_ID, EXECUTION_ID, attempt=0, max_retries=1)

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            client.call_names(),
            ["acquire_video_analysis_run", "update_video_analysis_progress", "complete_video_analysis"],
        )
        # update_video_analysis_progress와 complete_video_analysis 둘 다
        # acquire가 돌려준 run_token을 그대로 써야 합니다(fencing 계약).
        _, (progress_id, progress_token, stage, progress) = client.calls[1]
        self.assertEqual(progress_token, "token-abc")
        self.assertEqual(stage, worker_main.DUMMY_STAGE)
        self.assertEqual(progress, worker_main.DUMMY_PROGRESS)

        _, (complete_id, complete_token, report, *_rest) = client.calls[2]
        self.assertEqual(complete_token, "token-abc")
        self.assertEqual(report, worker_main.DUMMY_REPORT)


class RunStaleCompleteTests(unittest.TestCase):
    def test_complete_none_is_treated_as_stale_and_does_not_fail(self):
        client = FakeClient(
            acquire_result={"run_token": "token-abc", "status": "processing"},
            complete_result=None,  # run_token fencing에 걸려 이미 stale
        )
        exit_code = worker_main.run(client, ANALYSIS_ID, EXECUTION_ID, attempt=0, max_retries=1)

        self.assertEqual(exit_code, 0)
        self.assertNotIn("fail_video_analysis", client.call_names())


class RunNonFinalAttemptFailureTests(unittest.TestCase):
    def test_exception_on_non_final_attempt_does_not_call_fail(self):
        client = FakeClient(
            acquire_result={"run_token": "token-abc", "status": "processing"},
            raise_on="complete_video_analysis",
            raise_exc=RuntimeError("network blip"),
        )
        # attempt=0, max_retries=1 → 0 < 1 이므로 마지막 attempt가 아님.
        exit_code = worker_main.run(client, ANALYSIS_ID, EXECUTION_ID, attempt=0, max_retries=1)

        self.assertEqual(exit_code, 1)
        self.assertNotIn("fail_video_analysis", client.call_names())


class RunFinalAttemptFailureTests(unittest.TestCase):
    def test_exception_on_final_attempt_calls_fail_with_sanitized_error(self):
        client = FakeClient(
            acquire_result={"run_token": "token-abc", "status": "processing"},
            raise_on="update_video_analysis_progress",
            raise_exc=RuntimeError("some possibly sensitive detail"),
        )
        # attempt=1, max_retries=1 → 1 >= 1 이므로 마지막 attempt.
        exit_code = worker_main.run(client, ANALYSIS_ID, EXECUTION_ID, attempt=1, max_retries=1)

        self.assertEqual(exit_code, 1)
        self.assertIn("fail_video_analysis", client.call_names())

        fail_call = next(call for call in client.calls if call[0] == "fail_video_analysis")
        _, (fail_id, fail_token, error_code, error_message) = fail_call
        self.assertEqual(fail_token, "token-abc")
        # error_code_check CHECK 제약이 허용하는 5개 값 중 하나여야 함.
        self.assertEqual(error_code, "internal_error")
        self.assertIn("RuntimeError", error_message)


class RunAcquireExceptionTests(unittest.TestCase):
    def test_exception_during_acquire_itself_propagates_to_caller(self):
        """
        run_token을 아직 모르는 단계의 예외는 run()이 스스로 삼키지 않고
        그대로 올려보냅니다 — fail_video_analysis를 부를 방법이 없다는
        걸 호출자(main())가 판단해야 하기 때문입니다. main()의 별도
        try/except가 이 경로를 다룹니다(test_main_config_and_exception 참고).
        """
        client = FakeClient(raise_on="acquire_video_analysis_run", raise_exc=RuntimeError("db down"))

        with self.assertRaises(RuntimeError):
            worker_main.run(client, ANALYSIS_ID, EXECUTION_ID, attempt=0, max_retries=1)

        self.assertNotIn("fail_video_analysis", client.call_names())


class SanitizeErrorTests(unittest.TestCase):
    def test_error_code_is_always_the_allowed_constant(self):
        code, _ = worker_main.sanitize_error(ValueError("x"))
        self.assertEqual(code, worker_main.ORCHESTRATION_FAILURE_ERROR_CODE)

    def test_message_is_truncated(self):
        long_exc = RuntimeError("x" * 1000)
        _, message = worker_main.sanitize_error(long_exc)
        self.assertLessEqual(len(message), 500)

    def test_message_includes_exception_type_name(self):
        _, message = worker_main.sanitize_error(KeyError("missing"))
        self.assertIn("KeyError", message)


class EnvHelperTests(unittest.TestCase):
    def setUp(self):
        self._saved_env = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._saved_env)

    def test_validate_env_raises_on_missing_required_var(self):
        os.environ.pop("SUPABASE_URL", None)
        os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
        os.environ.pop("ANALYSIS_ID", None)
        os.environ.pop("CLOUD_RUN_JOB", None)
        os.environ.pop("CLOUD_RUN_EXECUTION", None)
        os.environ.pop("CLOUD_RUN_TASK_ATTEMPT", None)

        with self.assertRaises(worker_main.WorkerConfigError):
            worker_main.validate_env()

    def test_validate_env_passes_when_all_present(self):
        os.environ.update(
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "not-a-real-key",
                "ANALYSIS_ID": ANALYSIS_ID,
                "CLOUD_RUN_JOB": "video-analysis-worker",
                "CLOUD_RUN_EXECUTION": "exec-1",
                "CLOUD_RUN_TASK_ATTEMPT": "0",
            }
        )
        worker_main.validate_env()  # 예외가 안 나면 통과

    def test_build_execution_id_matches_spec_format(self):
        os.environ["CLOUD_RUN_JOB"] = "video-analysis-worker"
        os.environ["CLOUD_RUN_EXECUTION"] = "exec-42"
        self.assertEqual(
            worker_main.build_execution_id(), "video-analysis-worker/exec-42"
        )

    def test_get_attempt_number_reads_env(self):
        os.environ["CLOUD_RUN_TASK_ATTEMPT"] = "3"
        self.assertEqual(worker_main.get_attempt_number(), 3)

    def test_get_max_retries_defaults_when_unset(self):
        os.environ.pop("CLOUD_RUN_TASK_MAX_RETRIES", None)
        self.assertEqual(worker_main.get_max_retries(), worker_main.DEFAULT_MAX_RETRIES)

    def test_get_max_retries_reads_override(self):
        os.environ["CLOUD_RUN_TASK_MAX_RETRIES"] = "3"
        self.assertEqual(worker_main.get_max_retries(), 3)


if __name__ == "__main__":
    unittest.main()
