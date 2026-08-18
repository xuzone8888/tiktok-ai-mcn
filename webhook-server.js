const http = require('http');
const { exec } = require('child_process');
const crypto = require('crypto');

const PORT = 3001;
const SECRET = process.env.WEBHOOK_SECRET;
const REPO_PATH = '/var/www/tiktok-ai-mcn';
const DEPLOY_BRANCH = 'main';
const ZERO_SHA = '0000000000000000000000000000000000000000';

// Prevent concurrent deploys: a burst of webhooks (e.g. multiple ref updates)
// must NOT spawn parallel `npm run build` runs, which can exhaust memory.
let deploying = false;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/') {
    if (!SECRET) {
      console.error('WEBHOOK_SECRET is not configured');
      res.writeHead(500);
      res.end('Webhook secret not configured');
      return;
    }

    // Accumulate raw Buffers — string concat (`body += chunk`) decodes each
    // chunk separately, so a multibyte UTF-8 char split across chunk
    // boundaries becomes U+FFFD and the HMAC no longer matches GitHub's
    // (computed over raw bytes). Small pushes fit one chunk and passed;
    // a 20-commit CJK push reliably 401'd (2026-07-05 delivery 3829506057).
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      // Verify signature — header is mandatory: skipping verification when
      // absent would let any unsigned POST reach the deploy trigger.
      const signature = req.headers['x-hub-signature-256'];
      if (!signature) {
        console.log('Missing signature header');
        res.writeHead(401);
        res.end('Missing signature');
        return;
      }
      const hmac = crypto.createHmac('sha256', SECRET);
      const digest = 'sha256=' + hmac.update(raw).digest('hex');
      const sigBuf = Buffer.from(signature);
      const digBuf = Buffer.from(digest);
      if (sigBuf.length !== digBuf.length || !crypto.timingSafeEqual(sigBuf, digBuf)) {
        console.log('Invalid signature');
        res.writeHead(401);
        res.end('Invalid signature');
        return;
      }

      // Only deploy on a real push to the deploy branch. Ignore branch/tag
      // deletions, pushes to other branches, and non-push events (e.g. a
      // branch-delete webhook used to trigger an unnecessary rebuild here,
      // which OOM-killed the build on this small host).
      const event = req.headers['x-github-event'] || '';
      let payload = {};
      try {
        payload = JSON.parse(raw.toString('utf8') || '{}');
      } catch (_) {
        payload = {};
      }

      const isPush = event === 'push';
      const isDeployBranch = payload.ref === 'refs/heads/' + DEPLOY_BRANCH;
      const isDelete = payload.deleted === true || payload.after === ZERO_SHA;

      if (!isPush || !isDeployBranch || isDelete) {
        console.log(
          'Skip deploy (event=' + event + ', ref=' + (payload.ref || '-') +
          ', deleted=' + (payload.deleted === true || payload.after === ZERO_SHA) + ')'
        );
        res.writeHead(200);
        res.end('Ignored');
        return;
      }

      if (deploying) {
        console.log('Deploy already in progress, ignoring concurrent trigger');
        res.writeHead(200);
        res.end('Deploy already in progress');
        return;
      }

      console.log('Webhook received (push to ' + DEPLOY_BRANCH + ') at', new Date().toISOString());
      res.writeHead(200);
      res.end('Deploying...');

      deploying = true;
      // ff-only: server checkout must never diverge from origin/main (a plain
      // pull could create a surprise merge commit on the server).
      // npm install: the old command skipped it, so any dependency change
      // bricked the deploy at build time.
      // --max-old-space-size=2048: this 3.4G host OOM-killed an uncapped
      // `next build` (SIGKILL in webhook-error.log); cap the heap so the
      // build spills to swap instead of dying.
      const cmd =
        'cd ' + REPO_PATH +
        ' && git fetch origin ' + DEPLOY_BRANCH +
        ' && git merge --ff-only origin/' + DEPLOY_BRANCH +
        ' && npm install --no-audit --no-fund' +
        ' && NODE_OPTIONS=--max-old-space-size=2048 npm run build' +
        ' && pm2 restart tiktok-ai-mcn';
      exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        deploying = false;
        if (error) {
          console.error('Deploy error:', error);
          return;
        }
        console.log('Deploy success:', stdout);
      });
    });
  } else {
    res.writeHead(200);
    res.end('Webhook server running');
  }
});

server.listen(PORT, () => {
  console.log('Webhook server listening on port', PORT);
});
