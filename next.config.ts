import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // STEP 4-3A: @google-cloud/tasks는 동적 require를 쓰는 Node 전용 패키지라
  // Turbopack이 서버 번들로 정적 분석/포함하려 하면 "Cannot find module as
  // expression is too dynamic"으로 실패합니다. serverExternalPackages에
  // 넣으면 번들링하지 않고 런타임에 require로 그대로 불러옵니다.
  serverExternalPackages: ["@google-cloud/tasks"],
};

export default nextConfig;
