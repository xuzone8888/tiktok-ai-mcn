/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // 开发时忽略 ESLint 错误
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 开发时忽略 TypeScript 错误
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
