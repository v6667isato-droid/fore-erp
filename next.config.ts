import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// 只在 `next dev` 時生效（讓本機開發可存取 Cloudflare bindings），build/Vercel 上為 no-op
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/employee-portal",
        destination: "/employee/dashboard",
        permanent: true,
      },
      {
        source: "/employee-portal/",
        destination: "/employee/dashboard",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
