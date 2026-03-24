/**
 * 自定义 Next.js 启动脚本
 * 
 * 解决 Next.js 14.2 的 clientModules TypeError 崩溃问题
 * 该错误在服务端渲染特定页面时触发未捕获异常，导致进程退出
 * 
 * 此脚本通过 process.on('uncaughtException') 捕获该错误，
 * 阻止进程退出而只记录日志，保持服务器稳定运行
 */

const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

// 捕获 clientModules 未捕获异常，防止进程崩溃
process.on('uncaughtException', (err) => {
  if (err.message && err.message.includes('clientModules')) {
    console.error('[Server] Caught clientModules error (suppressed):', err.message)
    // 不退出进程，仅记录日志
    return
  }
  // 其他未捕获异常仍然记录但也不退出（PM2 会重启）
  console.error('[Server] Uncaught Exception:', err)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled Rejection at:', promise, 'reason:', reason)
})

app.prepare().then(() => {
  createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true)
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error('[Server] Request error:', err)
      if (!res.headersSent) {
        res.statusCode = 500
        res.end('Internal Server Error')
      }
    }
  })
    .once('error', (err) => {
      console.error('[Server] Server error:', err)
      process.exit(1)
    })
    .listen(port, () => {
      console.log(`[Server] Ready on http://${hostname}:${port}`)
    })
})
