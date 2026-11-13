import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Everything the app loads is same-origin (Supabase is only ever called from
// the server). 'unsafe-inline' scripts cover Next's inline bootstrap and the
// theme script in layout.tsx; 'unsafe-eval' is only needed by React's dev-mode
// error overlay. No upgrade-insecure-requests: demos run `next start` over
// plain http on localhost, where it would break every asset request.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // A package-lock.json in the user's home directory above this folder makes
  // Turbopack guess the wrong workspace root — pin it to this app.
  turbopack: { root: path.resolve(process.cwd()) },

  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,

  // Browsers still ask for /favicon.ico on their own; point them at the logo
  // the pages declare rather than answering with a 404.
  async redirects() {
    return [{ source: "/favicon.ico", destination: "/luxus-green-logo.webp", permanent: true }];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          // Ignored by browsers over plain http, so harmless on a demo laptop.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
