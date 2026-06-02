const http = require('http');
const { exec } = require('child_process');
const crypto = require('crypto');

const PORT = 3001;
const SECRET = process.env.WEBHOOK_SECRET;
const REPO_PATH = '/var/www/tiktok-ai-mcn';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/') {
    if (!SECRET) {
      console.error('WEBHOOK_SECRET is not configured');
      res.writeHead(500);
      res.end('Webhook secret not configured');
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      // Verify signature
      const signature = req.headers['x-hub-signature-256'];
      if (signature) {
        const hmac = crypto.createHmac('sha256', SECRET);
        const digest = 'sha256=' + hmac.update(body).digest('hex');
        if (signature !== digest) {
          console.log('Invalid signature');
          res.writeHead(401);
          res.end('Invalid signature');
          return;
        }
      }

      console.log('Webhook received at', new Date().toISOString());
      res.writeHead(200);
      res.end('Deploying...');

      // Run deployment
      const cmd = 'cd ' + REPO_PATH + ' && git pull origin main && npm run build && pm2 restart tiktok-ai-mcn';
      exec(cmd, (error, stdout, stderr) => {
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
