/**
 * GitHub Webhook 服务器
 * 接收 GitHub push 事件，自动触发部署
 * 
 * 使用方法:
 * 1. 在服务器上运行: pm2 start webhook-server.js --name webhook
 * 2. 在 GitHub 仓库设置 Webhook: http://your-server:9000/webhook
 * 3. 设置 Secret (可选但推荐)
 */

const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');

// 配置
const PORT = 9000;
const SECRET = process.env.WEBHOOK_SECRET || ''; // 可选：GitHub Webhook Secret
const DEPLOY_SCRIPT = '/var/www/tiktok-ai-mcn/deploy/aliyun-deploy.sh';

const server = http.createServer((req, res) => {
  // 健康检查
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', time: new Date().toISOString() }));
    return;
  }

  // Webhook 处理
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      console.log(`[${new Date().toISOString()}] Received webhook request`);

      // 验证 GitHub 签名（如果设置了 SECRET）
      if (SECRET) {
        const signature = req.headers['x-hub-signature-256'];
        const expectedSignature = 'sha256=' + crypto
          .createHmac('sha256', SECRET)
          .update(body)
          .digest('hex');
        
        if (signature !== expectedSignature) {
          console.log('Invalid signature, rejecting request');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid signature' }));
          return;
        }
      }

      // 解析事件
      try {
        const payload = JSON.parse(body);
        const event = req.headers['x-github-event'];

        console.log(`Event: ${event}`);
        
        // 只处理 push 到 main 分支的事件
        if (event === 'push' && payload.ref === 'refs/heads/main') {
          console.log(`Push to main branch detected, triggering deploy...`);
          console.log(`Commit: ${payload.head_commit?.message || 'N/A'}`);
          
          // 执行部署脚本
          exec(`bash ${DEPLOY_SCRIPT}`, (error, stdout, stderr) => {
            if (error) {
              console.error(`Deploy error: ${error.message}`);
              return;
            }
            if (stderr) {
              console.error(`Deploy stderr: ${stderr}`);
            }
            console.log(`Deploy stdout: ${stdout}`);
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            message: 'Deploy triggered',
            commit: payload.head_commit?.message 
          }));
        } else {
          console.log(`Ignoring event: ${event}, ref: ${payload.ref || 'N/A'}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Event ignored' }));
        }
      } catch (parseError) {
        console.error('Failed to parse webhook payload:', parseError);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`GitHub Webhook Server started`);
  console.log(`Port: ${PORT}`);
  console.log(`Endpoint: http://your-server:${PORT}/webhook`);
  console.log(`Health: http://your-server:${PORT}/health`);
  console.log(`Secret: ${SECRET ? 'configured' : 'not configured'}`);
  console.log(`========================================`);
});

