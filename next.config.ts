import type { NextConfig } from "next";

/**
 * Security headers and Content-Security-Policy-Report-Only configuration.
 * Per PayPal JS SDK v6 CSP requirements (https://developer.paypal.com/sdk/js/configuration/#link-contentsecuritypolicy),
 * script-src, frame-src, connect-src, and img-src must permit https://*.paypal.com and https://*.paypalobjects.com.
 */
export const PAYPAL_CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.paypal.com https://*.paypalobjects.com",
  "frame-src 'self' https://*.paypal.com https://*.paypalobjects.com",
  "connect-src 'self' https://*.paypal.com https://*.paypalobjects.com",
  "img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com",
  "style-src 'self' 'unsafe-inline' https://*.paypalobjects.com",
  "font-src 'self' data: https://*.paypalobjects.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

export const SECURITY_HEADERS = [
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    value: PAYPAL_CSP_REPORT_ONLY,
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
