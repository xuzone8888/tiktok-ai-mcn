#!/usr/bin/env node

/**
 * 检查本地文件与服务器版本是否一致
 * 使用方法: node scripts/check-server-consistency.js <网站URL>
 * 例如: node scripts/check-server-consistency.js https://www.toryxai.com
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 要检查的关键文件列表
const KEY_FILES = [
  'package.json',
  'next.config.mjs',
  'src/app/layout.tsx',
  'src/app/page.tsx',
  'src/middleware.ts',
];

// 要检查的API路由
const API_ROUTES = [
  '/api/models/public',
  '/api/generate',
  '/api/tasks',
];

// 要检查的页面路由
const PAGE_ROUTES = [
  '/',
  '/dashboard',
  '/quick-gen',
  '/models',
  '/auth/login',
];

/**
 * 获取文件内容的哈希值
 */
function getFileHash(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return crypto.createHash('md5').update(content).digest('hex');
  } catch (error) {
    return null;
  }
}

/**
 * 获取本地文件的版本信息
 */
function getLocalFileInfo() {
  const info = {};
  const projectRoot = path.resolve(__dirname, '..');
  
  KEY_FILES.forEach(file => {
    const filePath = path.join(projectRoot, file);
    const hash = getFileHash(filePath);
    const stats = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
    
    info[file] = {
      exists: fs.existsSync(filePath),
      hash,
      size: stats ? stats.size : 0,
      modified: stats ? stats.mtime.toISOString() : null,
    };
  });
  
  return info;
}

/**
 * 获取package.json的版本信息
 */
function getLocalVersion() {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
    );
    return {
      name: packageJson.name,
      version: packageJson.version,
    };
  } catch (error) {
    return null;
  }
}

/**
 * 发送HTTP请求
 */
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const req = client.request(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ServerCheck/1.0)',
        ...options.headers,
      },
      timeout: options.timeout || 10000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

/**
 * 检查服务器端点是否可访问
 */
async function checkServerEndpoint(baseUrl, route) {
  try {
    const url = `${baseUrl}${route}`;
    const response = await fetch(url, { timeout: 5000 });
    return {
      route,
      accessible: response.status < 500,
      status: response.status,
      error: null,
    };
  } catch (error) {
    return {
      route,
      accessible: false,
      status: null,
      error: error.message,
    };
  }
}

/**
 * 从HTML中提取Next.js构建信息
 */
function extractBuildInfo(html) {
  const info = {};
  
  // 尝试提取Next.js版本
  const nextVersionMatch = html.match(/__NEXT_DATA__[^>]*>([^<]+)/);
  if (nextVersionMatch) {
    try {
      const data = JSON.parse(nextVersionMatch[1]);
      info.nextVersion = data.buildId || 'unknown';
    } catch (e) {
      // 忽略解析错误
    }
  }
  
  // 尝试提取构建时间
  const buildTimeMatch = html.match(/<!-- Built at: ([^>]+) -->/);
  if (buildTimeMatch) {
    info.buildTime = buildTimeMatch[1];
  }
  
  return info;
}

/**
 * 主检查函数
 */
async function checkServerConsistency(baseUrl) {
  console.log('🔍 开始检查服务器一致性...\n');
  console.log(`📡 目标服务器: ${baseUrl}\n`);
  
  // 获取本地文件信息
  console.log('📁 获取本地文件信息...');
  const localInfo = getLocalFileInfo();
  const localVersion = getLocalVersion();
  
  if (localVersion) {
    console.log(`   项目名称: ${localVersion.name}`);
    console.log(`   版本: ${localVersion.version}\n`);
  }
  
  // 检查服务器首页
  console.log('🌐 检查服务器可访问性...');
  try {
    const homeResponse = await fetch(baseUrl, { timeout: 10000 });
    
    if (homeResponse.status === 200) {
      console.log(`   ✅ 服务器可访问 (状态码: ${homeResponse.status})`);
      
      const buildInfo = extractBuildInfo(homeResponse.body);
      if (buildInfo.nextVersion) {
        console.log(`   📦 Next.js 构建ID: ${buildInfo.nextVersion}`);
      }
      if (buildInfo.buildTime) {
        console.log(`   🕐 构建时间: ${buildInfo.buildTime}`);
      }
    } else {
      console.log(`   ⚠️  服务器返回状态码: ${homeResponse.status}`);
    }
  } catch (error) {
    console.log(`   ❌ 无法访问服务器: ${error.message}`);
    return;
  }
  
  console.log('\n');
  
  // 检查关键页面
  console.log('📄 检查关键页面...');
  const pageResults = await Promise.all(
    PAGE_ROUTES.map(route => checkServerEndpoint(baseUrl, route))
  );
  
  pageResults.forEach(result => {
    const icon = result.accessible ? '✅' : '❌';
    const status = result.status ? ` (${result.status})` : '';
    const error = result.error ? ` - ${result.error}` : '';
    console.log(`   ${icon} ${result.route}${status}${error}`);
  });
  
  console.log('\n');
  
  // 检查API路由
  console.log('🔌 检查API路由...');
  const apiResults = await Promise.all(
    API_ROUTES.map(route => checkServerEndpoint(baseUrl, route))
  );
  
  apiResults.forEach(result => {
    const icon = result.accessible ? '✅' : '❌';
    const status = result.status ? ` (${result.status})` : '';
    const error = result.error ? ` - ${result.error}` : '';
    console.log(`   ${icon} ${result.route}${status}${error}`);
  });
  
  console.log('\n');
  
  // 显示本地文件信息摘要
  console.log('📋 本地关键文件摘要:');
  Object.entries(localInfo).forEach(([file, info]) => {
    const icon = info.exists ? '✅' : '❌';
    const size = info.exists ? ` (${(info.size / 1024).toFixed(2)} KB)` : '';
    console.log(`   ${icon} ${file}${size}`);
  });
  
  console.log('\n');
  console.log('✨ 检查完成！');
  console.log('\n提示:');
  console.log('  - 如果页面返回404，可能是路由配置问题');
  console.log('  - 如果API返回401/403，可能是认证问题');
  console.log('  - 如果所有端点都超时，可能是服务器问题或网络问题');
  console.log('  - 建议检查阿里云 PM2 和 webhook 部署日志以获取更多信息');
}

// 主程序
const baseUrl = process.argv[2];

if (!baseUrl) {
  console.error('❌ 错误: 请提供网站URL');
  console.error('使用方法: node scripts/check-server-consistency.js <网站URL>');
  console.error('例如: node scripts/check-server-consistency.js https://www.toryxai.com');
  process.exit(1);
}

// 验证URL格式
try {
  new URL(baseUrl);
} catch (error) {
  console.error('❌ 错误: 无效的URL格式');
  process.exit(1);
}

checkServerConsistency(baseUrl).catch(error => {
  console.error('❌ 检查过程中出错:', error.message);
  process.exit(1);
});








