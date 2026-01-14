// 检查HUPLUS历史上选择过模特的任务
const fs = require('fs');
const path = require('path');
const https = require('https');

// 读取环境变量
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    envVars[match[1].trim()] = value;
  }
});

const SUPABASE_URL = envVars.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;

function supabaseRequest(endpoint) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, SUPABASE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function main() {
  try {
    console.log('='.repeat(70));
    console.log('🔍 检查HUPLUS历史上选择过模特的任务');
    console.log('='.repeat(70));

    const userId = '3280837d-0e1b-499e-a435-6857c18c9516';
    
    // 获取所有视频任务（最多100条）
    const generations = await supabaseRequest(
      `/rest/v1/generations?user_id=eq.${userId}&type=eq.video&select=id,prompt,metadata,status,error_message,created_at&order=created_at.desc&limit=100`
    );

    console.log(`\n📊 HUPLUS总共有 ${generations?.length || 0} 条视频任务记录\n`);

    let withModel = [];
    let withoutModel = [];

    if (generations && generations.length > 0) {
      for (const gen of generations) {
        const metadata = gen.metadata || {};
        const modelId = metadata.modelId || metadata.ai_model_id || metadata.model_id;
        const modelName = metadata.modelName || metadata.model_name;
        
        if (modelId) {
          withModel.push({
            id: gen.id,
            createdAt: gen.created_at,
            status: gen.status,
            modelId,
            modelName,
            hasImage: !!(metadata.imageUrl || metadata.image_url),
            prompt: gen.prompt?.substring(0, 80)
          });
        } else {
          withoutModel.push({
            id: gen.id,
            createdAt: gen.created_at,
            status: gen.status,
            hasImage: !!(metadata.imageUrl || metadata.image_url)
          });
        }
      }
    }

    console.log('📈 统计:');
    console.log(`   选择了模特的任务: ${withModel.length}`);
    console.log(`   未选择模特的任务: ${withoutModel.length}`);

    if (withModel.length > 0) {
      console.log('\n' + '='.repeat(70));
      console.log('🎭 选择了模特的任务详情:');
      for (const task of withModel) {
        console.log(`\n   任务ID: ${task.id.substring(0, 8)}...`);
        console.log(`   创建时间: ${task.createdAt}`);
        console.log(`   状态: ${task.status}`);
        console.log(`   模特ID: ${task.modelId}`);
        console.log(`   模特名: ${task.modelName || '未记录'}`);
        console.log(`   有图片: ${task.hasImage ? '是' : '否'}`);
        console.log(`   提示词: ${task.prompt}...`);
      }
    } else {
      console.log('\n⚠️ HUPLUS历史上所有任务都没有记录模特选择信息！');
      console.log('   这说明前端提交任务时modelId没有正确传递到后端。');
    }

    // 检查最近带图片但没有模特的任务
    console.log('\n' + '='.repeat(70));
    console.log('📸 检查带图片但没有模特信息的任务:');
    
    const withImageNoModel = withoutModel.filter(t => t.hasImage);
    console.log(`\n   带图片但无模特的任务: ${withImageNoModel.length}/${withoutModel.length}`);
    
    if (withImageNoModel.length > 0) {
      console.log('\n   最近5条带图片的任务:');
      for (const task of withImageNoModel.slice(0, 5)) {
        console.log(`     - ${task.id.substring(0, 8)} | ${task.createdAt} | ${task.status}`);
      }
    }

    // 检查纯提示词任务的成功率
    const purePromptTasks = withoutModel.filter(t => !t.hasImage);
    const purePromptSuccess = purePromptTasks.filter(t => t.status === 'completed').length;
    console.log('\n📊 纯提示词任务统计:');
    console.log(`   总数: ${purePromptTasks.length}`);
    console.log(`   成功: ${purePromptSuccess}`);
    console.log(`   成功率: ${purePromptTasks.length > 0 ? ((purePromptSuccess / purePromptTasks.length) * 100).toFixed(1) : 0}%`);

  } catch (error) {
    console.error('执行错误:', error);
  }
}

main();
