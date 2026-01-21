/**
 * GitHub Webhook Server for Automatic Deployment
 * 
 * 功能特性:
 * - 🔒 HMAC-SHA256 签名验证 (GitHub Secret)
 * - ⏳ 防抖动 (Debounce): 避免短时间内多次触发
 * - 📝 详细日志: 便于排查问题
 * - 🚀 零依赖: 仅使用 Node.js 原生模块
 * 
 * 环境变量:
 * - WEBHOOK_SECRET: GitHub Webhook Secret (必须)
 * - WEBHOOK_PORT: 监听端口 (默认 3001)
 * - DEPLOY_COOLDOWN: 防抖动冷却时间，秒 (默认 30)
 */

const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');

// ============ 配置 ============
const SECRET = process.env.WEBHOOK_SECRET || 'tiktok-ai-mcn-deploy-2026';
const PORT = parseInt(process.env.WEBHOOK_PORT, 10) || 3001;
const COOLDOWN_SECONDS = parseInt(process.env.DEPLOY_COOLDOWN, 10) || 30;
const PROJECT_DIR = '/var/www/tiktok-ai-mcn';
const DEPLOY_SCRIPT = path.join(PROJECT_DIR, 'deploy', 'deploy.sh');

// ============ 状态 ============
let isDeploying = false;
let lastDeployTime = 0;

// ============ 日志工具 ============
function log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const dataStr = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
    console.log(`[${timestamp}] [${level}] ${message}${dataStr}`);
}

// ============ 签名验证 ============
function verifySignature(payload, signature) {
    if (!signature) {
        log('WARN', 'Missing signature header');
        return false;
    }

    const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', SECRET)
        .update(payload)
        .digest('hex');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    } catch (e) {
        log('ERROR', 'Signature verification failed', { error: e.message });
        return false;
    }
}

// ============ 部署执行 ============
function runDeploy(commitMessage) {
    const now = Date.now();
    const timeSinceLastDeploy = (now - lastDeployTime) / 1000;

    // 防抖动检查
    if (timeSinceLastDeploy < COOLDOWN_SECONDS) {
        log('INFO', `Deploy skipped (cooldown: ${COOLDOWN_SECONDS - Math.floor(timeSinceLastDeploy)}s remaining)`);
        return;
    }

    // 防止并发部署
    if (isDeploying) {
        log('INFO', 'Deploy already in progress, skipping');
        return;
    }

    isDeploying = true;
    lastDeployTime = now;

    log('INFO', '🚀 Starting deployment...', { commit: commitMessage });

    const deploy = spawn('bash', [DEPLOY_SCRIPT], {
        cwd: PROJECT_DIR,
        env: { ...process.env, FORCE_COLOR: '1' }
    });

    deploy.stdout.on('data', (data) => {
        process.stdout.write(`[DEPLOY] ${data}`);
    });

    deploy.stderr.on('data', (data) => {
        process.stderr.write(`[DEPLOY:ERR] ${data}`);
    });

    deploy.on('close', (code) => {
        isDeploying = false;
        if (code === 0) {
            log('INFO', '✅ Deployment completed successfully');
        } else {
            log('ERROR', `❌ Deployment failed with exit code ${code}`);
        }
    });

    deploy.on('error', (err) => {
        isDeploying = false;
        log('ERROR', 'Deployment process error', { error: err.message });
    });
}

// ============ HTTP 服务 ============
const server = http.createServer((req, res) => {
    // 健康检查
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            isDeploying,
            lastDeployTime: lastDeployTime > 0 ? new Date(lastDeployTime).toISOString() : null
        }));
        return;
    }

    // 仅接受 POST 请求
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
    }

    let body = '';
    req.on('data', (chunk) => {
        body += chunk.toString();
    });

    req.on('end', () => {
        const signature = req.headers['x-hub-signature-256'];
        const event = req.headers['x-github-event'];

        log('INFO', 'Webhook received', { event, ip: req.socket.remoteAddress });

        // 验证签名
        if (!verifySignature(body, signature)) {
            log('WARN', 'Invalid signature, rejecting request');
            res.writeHead(401, { 'Content-Type': 'text/plain' });
            res.end('Unauthorized');
            return;
        }

        // 仅处理 push 事件
        if (event !== 'push') {
            log('INFO', `Ignoring event: ${event}`);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK - Event ignored');
            return;
        }

        // 解析 payload
        let payload;
        try {
            payload = JSON.parse(body);
        } catch (e) {
            log('ERROR', 'Failed to parse payload', { error: e.message });
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Bad Request');
            return;
        }

        // 检查是否是 main 分支
        const ref = payload.ref || '';
        if (ref !== 'refs/heads/main') {
            log('INFO', `Ignoring push to non-main branch: ${ref}`);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK - Not main branch');
            return;
        }

        // 获取 commit 信息
        const commitMessage = payload.head_commit?.message || 'Unknown commit';
        log('INFO', `Push to main detected`, { commit: commitMessage.substring(0, 100) });

        // 触发部署
        runDeploy(commitMessage);

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK - Deployment triggered');
    });

    req.on('error', (err) => {
        log('ERROR', 'Request error', { error: err.message });
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
    });
});

// ============ 启动服务 ============
server.listen(PORT, () => {
    log('INFO', `🎉 GitHub Webhook Server started`, { port: PORT });
    log('INFO', `Configuration`, {
        cooldownSeconds: COOLDOWN_SECONDS,
        projectDir: PROJECT_DIR
    });
});

// 优雅关闭
process.on('SIGTERM', () => {
    log('INFO', 'Received SIGTERM, shutting down...');
    server.close(() => {
        log('INFO', 'Server closed');
        process.exit(0);
    });
});
