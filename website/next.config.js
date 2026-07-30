/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true
};

module.exports = nextConfig;
