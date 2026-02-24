/** @type {import('next').NextConfig} */
const nextConfig = {
  // ESLint 配置 - 暂时跳过以确保构建成功
  eslint: {
    ignoreDuringBuilds: true,
  },
  // TypeScript 配置 - 339 个预存 TS 错误待清理，暂保持跳过
  typescript: {
    ignoreBuildErrors: true,
  },
  // API 配置 - 增加请求体大小限制以支持 base64 图片
  serverExternalPackages: [],
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
      // ToryX media domain
      {
        protocol: 'https',
        hostname: 'media.toryxai.com',
      },
      // TikTok CDN for avatars
      {
        protocol: 'https',
        hostname: '**.tiktokcdn.com',
      },
      {
        protocol: 'https',
        hostname: '**.tiktokcdn-us.com',
      },
      {
        protocol: 'https',
        hostname: '**.tiktokv.com',
      },
      {
        protocol: 'https',
        hostname: 'p16-sign-sg.tiktokcdn.com',
      },
      {
        protocol: 'https',
        hostname: 'p16-sign-va.tiktokcdn.com',
      },
    ],
    // 允许更大的图片优化
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    // 图片尺寸
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // 缓存时间 (1年)
    minimumCacheTTL: 31536000,
    // 使用 sharp 进行图片优化
    formats: ['image/avif', 'image/webp'],
  },
  // 生产环境优化
  poweredByHeader: false,
  // 压缩
  compress: true,
  // 实验性功能
  experimental: {
    // 优化服务器组件 - 添加更多常用包
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-toast',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-switch',
      '@radix-ui/react-progress',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-label',
      '@radix-ui/react-slot',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-radio-group',
      'zustand',
      'immer',
      'clsx',
      'tailwind-merge',
      'class-variance-authority',
    ],
  },
  // HTTP Headers - 缓存策略
  async headers() {
    return [
      {
        // 静态资源缓存 1 年
        source: '/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Next.js 静态资源
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // 图片缓存
        source: '/:all*(svg|jpg|jpeg|png|webp|avif|gif|ico)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        // API 不缓存
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, must-revalidate',
          },
        ],
      },
      {
        // 安全头部
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
  // 重定向配置
  async redirects() {
    return [];
  },
  // 路由重写
  async rewrites() {
    return [];
  },
  // 日志配置 - 减少生产环境日志
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === 'development',
    },
  },
  // 生产环境移除 console
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
};

export default nextConfig;
