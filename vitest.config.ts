/**
 * vitest.config.ts
 *
 * STEP 4-3A에서 이 저장소에 처음 추가하는 테스트 러너 설정입니다(기존에는
 * 어떤 테스트 프레임워크 설정도 없었습니다 — find로 확인).
 *
 * ⚠️ 이 세션은 npm/PyPI 네트워크가 막혀 있어 `npm.cmd install`을 실행하지
 *    못했고, 그래서 이 config와 아래 *.test.ts 파일들은 실제로 한 번도
 *    실행되지 않았습니다. worker/tests의 Python 테스트(실제 실행하고 통과
 *    확인함)와 다릅니다 — 최종 보고서의 "테스트 실행 결과" 항목 참고.
 *    로컬에서 `npm.cmd install && npm.cmd run test`로 반드시 직접 확인하세요.
 */

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
  },
});
