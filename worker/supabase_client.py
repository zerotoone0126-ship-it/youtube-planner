"""
worker/supabase_client.py

Cloud Run Job worker가 4개의 service_role RPC(acquire_video_analysis_run/
update_video_analysis_progress/complete_video_analysis/fail_video_analysis)를
호출하는 어댑터입니다.

⚠️ 이 파일은 service_role Supabase key로 동작합니다. worker/main.py의 나머지
   로직은 이 파일이 정의하는 VideoAnalysesRpcClient 프로토콜에만 의존하므로,
   테스트(worker/tests/)에서는 이 실제 구현 대신 가짜(fake) 구현을 주입해서
   네트워크나 supabase 패키지 설치 없이 로직을 검증할 수 있습니다.

⚠️ 이번 세션은 PyPI가 막혀 있어 `pip install supabase`를 실제로 실행하지
   못했습니다. 아래 SupabaseVideoAnalysesClient 구현은 supabase-py의
   `create_client(url, key)` / `client.rpc(name, params).execute()` 공식
   패턴을 따랐지만, 실제 import/실행으로 검증되지 않았습니다 — 배포 전
   실제 환경에서 최소 한 번은 직접 확인이 필요합니다(README:
   docs/plan-step-4-3a-orchestration.md 후속 STEP 참고).
"""

from __future__ import annotations

import os
from typing import Any, Optional, Protocol

VideoAnalysisRow = dict[str, Any]


class VideoAnalysesRpcClient(Protocol):
    """worker/main.py가 의존하는 RPC 표면. 실제 구현과 테스트용 가짜 구현이 공유합니다."""

    def acquire_video_analysis_run(
        self, analysis_id: str, execution_id: str
    ) -> Optional[VideoAnalysisRow]:
        ...

    def update_video_analysis_progress(
        self, analysis_id: str, run_token: str, stage: str, progress: int
    ) -> Optional[VideoAnalysisRow]:
        ...

    def complete_video_analysis(
        self,
        analysis_id: str,
        run_token: str,
        report: dict[str, Any],
        raw_metrics: Optional[dict[str, Any]] = None,
        duration_sec: Optional[float] = None,
    ) -> Optional[VideoAnalysisRow]:
        ...

    def fail_video_analysis(
        self,
        analysis_id: str,
        run_token: str,
        error_code: str,
        error_message: Optional[str] = None,
    ) -> Optional[VideoAnalysisRow]:
        ...


class SupabaseVideoAnalysesClient:
    """
    실제 구현. service_role key로 만든 supabase-py 클라이언트를 감쌉니다.

    RPC가 "획득/갱신 실패"를 뜻하는 NULL을 반환하는 경우, PostgREST를 거친
    supabase-py 응답은 `data`가 None이거나 빈 값(dict/list)으로 내려올 수
    있습니다 — 여기서는 둘 다 실패로 취급합니다. 프론트엔드
    lib/actions/video-analyses.ts의 `if (!data)` 관례와 동일한 판단입니다.
    """

    def __init__(self, url: str, service_role_key: str) -> None:
        # 지연 import: supabase 패키지가 설치되어 있지 않은 테스트 환경에서도
        # 이 모듈 자체(그리고 Protocol/가짜 구현)는 import할 수 있게 합니다.
        from supabase import create_client  # type: ignore[import-not-found]

        # ⚠️ service_role_key는 여기서도, 다른 어디에서도 절대 로그로 남기지 않습니다.
        self._client = create_client(url, service_role_key)

    def _call(self, fn_name: str, params: dict[str, Any]) -> Optional[VideoAnalysisRow]:
        response = self._client.rpc(fn_name, params).execute()
        data = response.data
        if not data:
            return None
        return data

    def acquire_video_analysis_run(
        self, analysis_id: str, execution_id: str
    ) -> Optional[VideoAnalysisRow]:
        return self._call(
            "acquire_video_analysis_run",
            {"p_id": analysis_id, "p_execution_id": execution_id},
        )

    def update_video_analysis_progress(
        self, analysis_id: str, run_token: str, stage: str, progress: int
    ) -> Optional[VideoAnalysisRow]:
        return self._call(
            "update_video_analysis_progress",
            {
                "p_id": analysis_id,
                "p_run_token": run_token,
                "p_stage": stage,
                "p_progress": progress,
            },
        )

    def complete_video_analysis(
        self,
        analysis_id: str,
        run_token: str,
        report: dict[str, Any],
        raw_metrics: Optional[dict[str, Any]] = None,
        duration_sec: Optional[float] = None,
    ) -> Optional[VideoAnalysisRow]:
        params: dict[str, Any] = {
            "p_id": analysis_id,
            "p_run_token": run_token,
            "p_report": report,
        }
        if raw_metrics is not None:
            params["p_raw_metrics"] = raw_metrics
        if duration_sec is not None:
            params["p_duration_sec"] = duration_sec
        return self._call("complete_video_analysis", params)

    def fail_video_analysis(
        self,
        analysis_id: str,
        run_token: str,
        error_code: str,
        error_message: Optional[str] = None,
    ) -> Optional[VideoAnalysisRow]:
        params: dict[str, Any] = {
            "p_id": analysis_id,
            "p_run_token": run_token,
            "p_error_code": error_code,
        }
        if error_message is not None:
            params["p_error_message"] = error_message
        return self._call("fail_video_analysis", params)


def build_client_from_env() -> SupabaseVideoAnalysesClient:
    """
    SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수로 실제 클라이언트를
    만듭니다. Next.js 쪽 NEXT_PUBLIC_SUPABASE_URL과 이름이 다른 이유: 이
    worker는 브라우저에 노출되는 값이 아니라 별도의 Cloud Run Job 컨테이너
    환경변수이므로, NEXT_PUBLIC_ 접두사를 붙이지 않습니다(붙이면 오히려
    "브라우저에 노출돼도 되는 값"이라는 잘못된 신호를 줍니다).
    """
    url = os.environ["SUPABASE_URL"]
    service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return SupabaseVideoAnalysesClient(url, service_role_key)
