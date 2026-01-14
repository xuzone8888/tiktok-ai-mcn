// 检查HUPLUS的模特选择和实际使用情况
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
    // 移除可能的引号
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    envVars[match[1].trim()] = value;
  }
});

const SUPABASE_URL = envVars.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('缺少Supabase环境变量');
  process.exit(1);
}

function supabaseRequest(endpoint, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, SUPABASE_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  try {
    console.log('='.repeat(60));
    console.log('🔍 检查HUPLUS的模特选择和使用情况');
    console.log('='.repeat(60));

    // 1. 先找到HUPLUS用户
    const users = await supabaseRequest('/rest/v1/profiles?or=(email.ilike.%25huplus%25,name.ilike.%25huplus%25)&select=id,email,name');
    
    if (!users || users.length === 0) {
      console.log('❌ 找不到HUPLUS用户');
      return;
    }

    const user = users[0];
    console.log('\n👤 用户信息:');
    console.log(`   ID: ${user.id}`);
    console.log(`   邮箱: ${user.email}`);
    console.log(`   名称: ${user.name}`);

    // 2. 获取HUPLUS的所有合约（聘用的模特）
    console.log('\n📋 获取HUPLUS的模特合约...');
    const contracts = await supabaseRequest(
      `/rest/v1/contracts?user_id=eq.${user.id}&select=*,ai_models(id,name,trigger_word,avatar_url)&order=created_at.desc`
    );

    console.log(`\n📊 HUPLUS的合约数量: ${contracts?.length || 0}`);
    if (contracts && contracts.length > 0) {
      console.log('\n🎭 合约详情:');
      for (const c of contracts) {
        const model = c.ai_models;
        const isExpired = new Date(c.end_date) < new Date();
        const statusEmoji = c.status === 'active' && !isExpired ? '✅' : '❌';
        console.log(`\n   ${statusEmoji} 模特: ${model?.name || 'Unknown'}`);
        console.log(`      模特ID: ${c.model_id}`);
        console.log(`      合约状态: ${c.status}`);
        console.log(`      到期时间: ${c.end_date} ${isExpired ? '(已过期)' : ''}`);
        console.log(`      触发词: ${model?.trigger_word || '❌ 未设置'}`);
      }
    }

    // 3. 获取HUPLUS最近的视频生成任务，检查模特使用情况
    console.log('\n' + '='.repeat(60));
    console.log('📹 检查HUPLUS最近的视频生成任务中的模特使用...');
    
    const generations = await supabaseRequest(
      `/rest/v1/generations?user_id=eq.${user.id}&type=eq.video&select=id,prompt,metadata,status,error_message,created_at&order=created_at.desc&limit=20`
    );

    console.log(`\n📊 最近20条视频任务分析:`);
    
    let modelUsageStats = {
      withModel: 0,
      withoutModel: 0,
      modelDetails: {}
    };

    if (generations && generations.length > 0) {
      for (const gen of generations) {
        const metadata = gen.metadata || {};
        const selectedModelId = metadata.modelId || metadata.ai_model_id;
        const selectedModelName = metadata.modelName || metadata.model_name;
        const triggerWord = metadata.triggerWord || metadata.trigger_word;
        const hasImage = !!metadata.imageUrl || !!metadata.image_url;
        
        console.log(`\n   📹 任务 ${gen.id.substring(0, 8)}...`);
        console.log(`      创建时间: ${gen.created_at}`);
        console.log(`      状态: ${gen.status}`);
        console.log(`      选择的模特ID: ${selectedModelId || '无'}`);
        console.log(`      选择的模特名: ${selectedModelName || '无'}`);
        console.log(`      触发词: ${triggerWord || '无'}`);
        console.log(`      使用图片: ${hasImage ? '是' : '否'}`);
        
        // 检查提示词中是否包含触发词
        const promptLower = gen.prompt?.toLowerCase() || '';
        if (selectedModelId) {
          modelUsageStats.withModel++;
          
          // 从合约中找这个模特的信息
          const contract = contracts?.find(c => c.model_id === selectedModelId);
          const expectedTrigger = contract?.ai_models?.trigger_word;
          
          console.log(`      期望的触发词: ${expectedTrigger || '❌ 合约中无此模特'}`);
          
          if (expectedTrigger) {
            const hasCorrectTrigger = promptLower.includes(expectedTrigger.toLowerCase());
            console.log(`      提示词包含触发词: ${hasCorrectTrigger ? '✅ 是' : '❌ 否'}`);
            
            if (!hasCorrectTrigger) {
              console.log(`      ⚠️ 问题: 选择了模特但触发词未注入!`);
              console.log(`      📝 实际提示词: ${gen.prompt?.substring(0, 100)}...`);
            }
          } else if (!contract) {
            console.log(`      ⚠️ 问题: 选择的模特在用户合约中不存在!`);
          }
          
          // 统计模特使用
          const key = selectedModelName || selectedModelId;
          if (!modelUsageStats.modelDetails[key]) {
            modelUsageStats.modelDetails[key] = { total: 0, success: 0, failed: 0 };
          }
          modelUsageStats.modelDetails[key].total++;
          if (gen.status === 'completed') {
            modelUsageStats.modelDetails[key].success++;
          } else if (gen.status === 'failed') {
            modelUsageStats.modelDetails[key].failed++;
          }
        } else {
          modelUsageStats.withoutModel++;
        }
        
        if (gen.status === 'failed') {
          console.log(`      ❌ 错误: ${gen.error_message || '未知'}`);
        }
      }
    }

    // 4. 统计汇总
    console.log('\n' + '='.repeat(60));
    console.log('📊 模特使用统计汇总:');
    console.log(`   使用模特的任务: ${modelUsageStats.withModel}`);
    console.log(`   未使用模特的任务: ${modelUsageStats.withoutModel}`);
    
    if (Object.keys(modelUsageStats.modelDetails).length > 0) {
      console.log('\n🎭 各模特使用详情:');
      for (const [modelName, stats] of Object.entries(modelUsageStats.modelDetails)) {
        const successRate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : 0;
        console.log(`   ${modelName}: 总${stats.total}次, 成功${stats.success}, 失败${stats.failed} (成功率: ${successRate}%)`);
      }
    }

    // 5. 检查所有模特的trigger_word设置
    console.log('\n' + '='.repeat(60));
    console.log('🔧 检查系统中所有模特的trigger_word设置...');
    
    const allModels = await supabaseRequest('/rest/v1/ai_models?select=id,name,trigger_word,status&order=name');
    
    if (allModels && allModels.length > 0) {
      console.log('\n📋 系统模特列表:');
      let modelsWithoutTrigger = 0;
      for (const m of allModels) {
        const hasTrigger = !!m.trigger_word;
        if (!hasTrigger) modelsWithoutTrigger++;
        console.log(`   ${hasTrigger ? '✅' : '❌'} ${m.name}: ${m.trigger_word || '未设置触发词'} (状态: ${m.status})`);
      }
      console.log(`\n⚠️ 未设置触发词的模特数量: ${modelsWithoutTrigger}/${allModels.length}`);
    }

  } catch (error) {
    console.error('执行错误:', error);
  }
}

main();
