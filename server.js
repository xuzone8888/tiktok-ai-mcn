/**
 * Custom Next.js production server.
 *
 * PM2 is the recovery boundary for process-level failures. An uncaught
 * exception or unhandled rejection can leave the Next.js process in an
 * indeterminate state, so the server stops accepting new work and exits with
 * a non-zero status. PM2 can then replace it with a clean process.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')

const dev = process.env.NODE_ENV !== 'production'
const hostname = '0.0.0.0'
const port = parseInt(process.env.PORT || '3000', 10)
const fatalExitTimeoutMs = 5000
const fatalLogMaxChars = 8192

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

let server = null
let fatalExitStarted = false
let gracefulExitStarted = false

function formatFatalReason(reason) {
  let text
  if (reason instanceof Error) {
    text = reason.stack || `${reason.name}: ${reason.message}`
  } else {
    try {
      text = String(reason)
    } catch {
      text = '<unprintable fatal reason>'
    }
  }

  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /([?&](?:access_token|api_key|key|secret|signature|token)=)[^&\s]+/gi,
      '$1[REDACTED]'
    )
    .slice(0, fatalLogMaxChars)
}

function exitAfterFatal(kind, reason) {
  if (fatalExitStarted) return
  fatalExitStarted = true
  process.exitCode = 1

  try {
    console.error(`[Server] Fatal ${kind}; stopping for process-manager restart.`)
    console.error(formatFatalReason(reason))
  } catch {
    // Logging must never prevent a fatal shutdown.
  }

  const forceExitTimer = setTimeout(() => {
    process.exit(1)
  }, fatalExitTimeoutMs)
  forceExitTimer.unref()

  if (server?.listening) {
    server.close((closeError) => {
      if (closeError) {
        try {
          console.error('[Server] Error while closing after fatal failure:', closeError.message)
        } catch {
          // Preserve the original fatal-exit path.
        }
      }
      process.exit(1)
    })
    server.closeIdleConnections?.()
    return
  }

  setImmediate(() => process.exit(1))
}

function exitGracefully(signal) {
  if (gracefulExitStarted || fatalExitStarted) return
  gracefulExitStarted = true

  console.log(`[Server] Received ${signal}; shutting down.`)

  const forceExitTimer = setTimeout(() => {
    process.exit(0)
  }, fatalExitTimeoutMs)
  forceExitTimer.unref()

  if (!server?.listening) {
    process.exit(0)
    return
  }

  server.close(() => process.exit(0))
  server.closeIdleConnections?.()
}

process.on('uncaughtException', (error) => {
  exitAfterFatal('uncaughtException', error)
})

process.on('unhandledRejection', (reason) => {
  exitAfterFatal('unhandledRejection', reason)
})

process.on('SIGTERM', () => exitGracefully('SIGTERM'))
process.on('SIGINT', () => exitGracefully('SIGINT'))

app
  .prepare()
  .then(() => {
    server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true)
        await handle(req, res, parsedUrl)
      } catch (error) {
        console.error('[Server] Request error:', formatFatalReason(error))
        if (!res.headersSent) {
          res.statusCode = 500
          res.end('Internal Server Error')
        }
      }
    })

    server.once('error', (error) => {
      exitAfterFatal('server error', error)
    })

    server.listen(port, () => {
      console.log(`[Server] Ready on http://${hostname}:${port}`)
      if (process.send) {
        process.send('ready')
      }
    })
  })
  .catch((error) => {
    exitAfterFatal('startup error', error)
  })
