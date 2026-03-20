import type { NextConfig } from "next";

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
