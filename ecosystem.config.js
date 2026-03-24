/**
 * PM2 进程管理配置文件
 * 用于在阿里云服务器上运行 Next.js 应用
 */

module.exports = {
  apps: [
    {
      name: 'tiktok-ai-mcn',
      script: 'server.js',
      cwd: '/var/www/tiktok-ai-mcn',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // 日志配置
      error_file: '/var/log/pm2/tiktok-ai-mcn-error.log',
      out_file: '/var/log/pm2/tiktok-ai-mcn-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // 自动重启配置
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',

      // 优雅重启
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // 崩溃保护：最少运行 10s 才算有效启动，最多重启 50 次，每次间隔 3s
      min_uptime: '10s',
      max_restarts: 50,
      restart_delay: 3000,
    },
  ],
};








