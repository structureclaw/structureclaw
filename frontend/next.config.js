const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  turbopack: {
    root: __dirname,
  },
}

// Only inject NEXT_PUBLIC_API_URL when explicitly set (dev mode).
// In installed-package mode the env var is absent → api-base.ts returns ''
// and the browser uses same-origin relative URLs.
if (process.env.NEXT_PUBLIC_API_URL) {
  nextConfig.env = { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL }
}

module.exports = nextConfig
