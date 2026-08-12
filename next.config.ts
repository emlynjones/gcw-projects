import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  experimental: {
    serverActions: { bodySizeLimit: "20mb" }, // backup restore uploads a full JSON export
  },
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/oauth/resource-metadata" },
      { source: "/.well-known/oauth-protected-resource/mcp", destination: "/api/oauth/resource-metadata" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/oauth/as-metadata" },
    ];
  },
};

export default nextConfig;
