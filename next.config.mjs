/** @type {import('next').NextConfig} */
const nextConfig = {
  // ESLint 配置
  eslint: {
    ignoreDuringBuilds: true,
  },
  // TypeScript 配置
  typescript: {
    ignoreBuildErrors: true,
  },
  // 图片优化
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: '**.wuyinkeji.com',
      },
      {
        protocol: 'https',
        hostname: '**.aliyuncs.com',
      },
      {
        protocol: 'https',
        hostname: '**.ss2.life',
      },
      {
        protocol: 'https',
        hostname: '**.cloudflare.com',
      },
    ],
    // 允许更大的图片优化
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    // 图片尺寸
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },
  // 生产环境优化
  poweredByHeader: false,
  // 压缩
  compress: true,
  // 实验性功能
  experimental: {
    // 优化服务器组件
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },
};

export default nextConfig;
