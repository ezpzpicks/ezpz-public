import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/public-data",
          has: [{ type: "query", key: "sport", value: "NCAAF" }],
          destination: "/api/ncaaf-public-data",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
