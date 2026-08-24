/**
 * app/api/video-analyses/[id]/queue/route.test.ts
 *
 * ⚠️ 이 파일은 이번 세션에서 npm install이 막혀 있어 실제로 실행되지
 * 않았습니다(코드만 작성됨, 검증되지 않음) — 최종 보고서 참고.
 *
 * queueVideoAnalysis(서버 액션)와 enqueueVideoAnalysisTask(Cloud Tasks
 * 헬퍼)를 둘 다 mock해서, 이 route.ts 자체의 상태 코드 매핑 로직만
 * 검증합니다 — 실제 DB나 GCP를 전혀 건드리지 않습니다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const queueVideoAnalysisMock = vi.fn();
const enqueueVideoAnalysisTaskMock = vi.fn();

vi.mock("@/lib/actions/video-analyses", () => ({
  queueVideoAnalysis: queueVideoAnalysisMock,
}));

vi.mock("@/lib/gcp/cloud-tasks", () => ({
  enqueueVideoAnalysisTask: enqueueVideoAnalysisTaskMock,
}));

const VALID_ID = "11111111-1111-1111-1111-111111111111";

function makeRequest(id: string) {
  return new Request(`http://localhost/api/video-analyses/${id}/queue`, {
    method: "POST",
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  queueVideoAnalysisMock.mockReset();
  enqueueVideoAnalysisTaskMock.mockReset();
});

describe("POST /api/video-analyses/[id]/queue", () => {
  it("id가 UUID 형식이 아니면 400을 반환하고 RPC를 호출하지 않는다", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeRequest("not-a-uuid"), makeContext("not-a-uuid"));

    expect(res.status).toBe(400);
    expect(queueVideoAnalysisMock).not.toHaveBeenCalled();
    expect(enqueueVideoAnalysisTaskMock).not.toHaveBeenCalled();
  });

  it("로그인하지 않았으면 401을 반환한다", async () => {
    queueVideoAnalysisMock.mockResolvedValueOnce({
      error: { code: "not_authenticated", message: "로그인이 필요합니다." },
    });
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_ID), makeContext(VALID_ID));

    expect(res.status).toBe(401);
    expect(enqueueVideoAnalysisTaskMock).not.toHaveBeenCalled();
  });

  it("큐에 등록할 수 없는 상태면 409를 반환한다 (not_queueable — 존재하지 않음/소유 아님/잘못된 상태를 구분하지 않음)", async () => {
    queueVideoAnalysisMock.mockResolvedValueOnce({
      error: { code: "not_queueable", message: "지금은 이 분석을 큐에 등록할 수 없습니다." },
    });
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_ID), makeContext(VALID_ID));

    expect(res.status).toBe(409);
    expect(enqueueVideoAnalysisTaskMock).not.toHaveBeenCalled();
  });

  it("RPC 자체가 예상치 못하게 실패하면 500을 반환한다", async () => {
    queueVideoAnalysisMock.mockResolvedValueOnce({
      error: { code: "unexpected_error", message: "일시적인 오류가 발생했습니다." },
    });
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_ID), makeContext(VALID_ID));

    expect(res.status).toBe(500);
    expect(enqueueVideoAnalysisTaskMock).not.toHaveBeenCalled();
  });

  it("DB 전이와 Cloud Tasks 생성이 모두 성공하면 202를 반환한다", async () => {
    queueVideoAnalysisMock.mockResolvedValueOnce({
      data: { id: VALID_ID, status: "queued" },
    });
    enqueueVideoAnalysisTaskMock.mockResolvedValueOnce({ outcome: "created" });
    const { POST } = await import("./route");

    const res = await POST(makeRequest(VALID_ID), makeContext(VALID_ID));
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual({ data: { status: "queued", task: { outcome: "created" } } });
  });

  it(
    "DB 전이는 성공했는데 Cloud Tasks 생성이 실패하면 503을 반환하고, " +
      "DB를 uploaded로 되돌리는 어떤 호출도 하지 않는다",
    async () => {
      queueVideoAnalysisMock.mockResolvedValueOnce({
        data: { id: VALID_ID, status: "queued" },
      });
      enqueueVideoAnalysisTaskMock.mockRejectedValueOnce(new Error("Cloud Tasks unavailable"));
      const { POST } = await import("./route");

      const res = await POST(makeRequest(VALID_ID), makeContext(VALID_ID));

      expect(res.status).toBe(503);
      // queueVideoAnalysis는 정확히 한 번만 호출됩니다 — "실패했으니 되돌린다"는
      // 별도 호출이 존재하지 않는다는 뜻입니다(롤백 없음 요구사항).
      expect(queueVideoAnalysisMock).toHaveBeenCalledTimes(1);
    },
  );
});
