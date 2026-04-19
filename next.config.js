/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produce a self-contained production build at `.next/standalone/` so the
  // Docker image (and Coolify's Nixpacks path) can ship a ~100 MB runtime
  // instead of bundling all of node_modules. See Dockerfile for the layout.
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.thecore.in" }
    ]
  }
};

module.exports = nextConfig;
