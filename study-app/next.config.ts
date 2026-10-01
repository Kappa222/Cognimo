import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse relies on pdfjs-dist's pdf.worker.mjs resolved relative to the
  // module. Bundling route handlers breaks that resolution (fake worker setup
  // fails with "Cannot find module ... pdf.worker.mjs"), so keep both
  // packages on native Node.js require instead.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
