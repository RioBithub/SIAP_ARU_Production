const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
];

const nextConfig = {
  poweredByHeader: false,
  compress: true,
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  async headers() {
    const headers = process.env.SIAP_DEV_STAGING === "1"
      ? [...securityHeaders, { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }]
      : securityHeaders;
    return [{ source: "/(.*)", headers }];
  }
};
export default nextConfig;
