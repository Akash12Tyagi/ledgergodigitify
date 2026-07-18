import path from "node:path";
import type { NextConfig } from "next";
import withBundleAnalyzerInit from "@next/bundle-analyzer";

// Section 15/M8 hardening — `ANALYZE=true npx next build` opens an
// interactive treemap of every route's JS bundle, used to check the
// 250KB-per-route budget and find code-splitting opportunities. A no-op
// wrapper otherwise (Section 9: never affects a normal build).
const withBundleAnalyzer = withBundleAnalyzerInit({
  enabled: process.env.ANALYZE === "true",
});

// Section 2.5 — exact security headers, applied to every route.
// CSP connect-src is widened in development only, to allow the Turbopack HMR
// websocket; production keeps the literal spec list.
const isDev = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://res.cloudinary.com",
  `connect-src 'self' https://api.cloudinary.com${isDev ? " ws://localhost:* http://localhost:*" : ""}`,
  "font-src 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  // An unrelated package-lock.json in the parent directory (a different,
  // unrelated project of the machine owner's) makes Next.js's workspace-root
  // inference ambiguous. Pin it explicitly so builds are deterministic.
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
