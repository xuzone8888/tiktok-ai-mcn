#!/usr/bin/env node
/**
 * Test VEO video download from server
 * 1. Query DB for completed VEO tasks with video URLs
 * 2. Test content endpoint accessibility
 * 3. Test direct video_url accessibility
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const https = require('https');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VEO_KEY = process.env.VEO3_GAORUI_API_KEY || '';

async function testUrl(url, label, headers = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'HEAD',
      family: 4,
      headers: { ...headers },
      timeout: 15000,
    }, (res) => {
      console.log(`  [${label}] Status: ${res.statusCode} | Content-Type: ${res.headers['content-type'] || 'N/A'} | Content-Length: ${res.headers['content-length'] || 'N/A'}`);
      resolve(res.statusCode);
    });
    req.on('error', (e) => {
      console.log(`  [${label}] ERROR: ${e.message}`);
      resolve(0);
    });
    req.on('timeout', () => {
      req.destroy();
      console.log(`  [${label}] TIMEOUT (15s)`);
      resolve(0);
    });
    req.end();
  });
}

async function main() {
  console.log('=== VEO Download Diagnostic ===');
  console.log('VEO3_GAORUI_API_KEY:', VEO_KEY ? `${VEO_KEY.substring(0, 10)}...` : 'NOT SET');
  console.log('');

  // 1. Query DB for VEO tasks
  const { data: tasks, error } = await supabase
    .from('generations')
    .select('task_id, model, status, result_url, video_url, created_at')
    .or('model.ilike.%veo%,model.ilike.%gaorui%')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.log('DB Error:', error.message);
    process.exit(1);
  }

  console.log(`Found ${tasks?.length || 0} completed VEO tasks:\n`);

  if (!tasks || tasks.length === 0) {
    console.log('No completed VEO tasks found. Trying all VEO tasks...');
    const { data: allTasks } = await supabase
      .from('generations')
      .select('task_id, model, status, result_url, video_url, created_at')
      .or('model.ilike.%veo%,model.ilike.%gaorui%')
      .order('created_at', { ascending: false })
      .limit(10);
    
    console.log(`All VEO tasks (${allTasks?.length || 0}):`);
    allTasks?.forEach(t => {
      console.log(`  Task: ${t.task_id} | Model: ${t.model} | Status: ${t.status} | URL: ${(t.result_url || t.video_url || 'NONE').substring(0, 80)}`);
    });
    
    // Even without completed tasks, test content endpoint with a fake ID
    console.log('\n=== Testing content endpoint with first task ID ===');
    if (allTasks && allTasks.length > 0) {
      const taskId = allTasks[0].task_id;
      const contentUrl = `https://gaorui.cc/v1/videos/${taskId}/content`;
      console.log(`URL: ${contentUrl}`);
      await testUrl(contentUrl, 'content-endpoint', { 'Authorization': `Bearer ${VEO_KEY}` });
    }
    process.exit(0);
  }

  for (const task of tasks) {
    console.log(`--- Task: ${task.task_id} ---`);
    console.log(`  Model: ${task.model} | Created: ${task.created_at}`);
    
    const videoUrl = task.result_url || task.video_url;
    if (videoUrl) {
      console.log(`  Video URL: ${videoUrl.substring(0, 120)}`);
      
      // Extract domain
      try {
        const domain = new URL(videoUrl).hostname;
        console.log(`  Domain: ${domain}`);
      } catch {}
      
      // Test direct URL
      await testUrl(videoUrl, 'direct-url');
    } else {
      console.log('  Video URL: NONE');
    }
    
    // Test content endpoint
    const contentUrl = `https://gaorui.cc/v1/videos/${task.task_id}/content`;
    await testUrl(contentUrl, 'content-endpoint', { 'Authorization': `Bearer ${VEO_KEY}` });
    
    console.log('');
  }
}

main().catch(console.error);
