"""
豆包 TTS 限流测试脚本
连续调用 3 次 TTS，测试不同间隔下的成功率
"""
import os
import json
import time
import sys

# 从 .env.local 读取配置
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.local')
env_vars = {}
with open(env_path, 'r', encoding='utf-8') as f:
    for line in f:
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            key, val = line.split('=', 1)
            env_vars[key.strip()] = val.strip()

APP_ID = env_vars.get('DOUBAO_TTS_APP_ID', '')
ACCESS_KEY = env_vars.get('DOUBAO_TTS_ACCESS_KEY', '')
API_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'

if not APP_ID or not ACCESS_KEY:
    print("ERROR: DOUBAO_TTS_APP_ID or DOUBAO_TTS_ACCESS_KEY not found in .env.local")
    sys.exit(1)

print(f"APP_ID: {APP_ID[:8]}...")
print(f"ACCESS_KEY: {ACCESS_KEY[:8]}...")

# 测试用的短文本
TEST_TEXTS = [
    "美女和狗狗在森林长凳上玩耍，画面太治愈了。",
    "快乐时光总是短暂，但这份温暖却能融化人心。",
    "珍惜每一个简单的瞬间，让生活充满爱和陪伴。",
]

VOICE_ID = "zh_female_xiaohe_uranus_bigtts"
RESOURCE_ID = "seed-tts-2.0"

def call_tts(text, call_num):
    """调用一次 TTS，返回 (成功?, 耗时, 错误信息)"""
    import urllib.request
    import urllib.error
    
    payload = json.dumps({
        "user": {"uid": "toryx-tts-user"},
        "req_params": {
            "text": text,
            "speaker": VOICE_ID,
            "audio_params": {
                "format": "mp3",
                "sample_rate": 24000,
            },
        },
    })
    
    headers = {
        'Content-Type': 'application/json',
        'X-Api-App-Id': APP_ID,
        'X-Api-Access-Key': ACCESS_KEY,
        'X-Api-Resource-Id': RESOURCE_ID,
    }
    
    req = urllib.request.Request(API_URL, data=payload.encode('utf-8'), headers=headers)
    
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode('utf-8')
            elapsed = time.time() - start
            
            # 解析 chunked JSON
            audio_bytes = 0
            error_msg = None
            for line in body.split('\n'):
                line = line.strip()
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                    is_success = chunk.get('code') in [0, 20000000]
                    if not is_success:
                        error_msg = f"code={chunk.get('code')}, msg={chunk.get('message', '')}"
                        return False, elapsed, error_msg
                    if chunk.get('data'):
                        import base64
                        audio_bytes += len(base64.b64decode(chunk['data']))
                except json.JSONDecodeError:
                    pass
            
            if audio_bytes > 0:
                return True, elapsed, f"{audio_bytes} bytes"
            else:
                return False, elapsed, "No audio data"
                
    except Exception as e:
        elapsed = time.time() - start
        return False, elapsed, str(e)


def test_interval(interval_sec):
    """测试指定间隔下连续 3 次调用的成功率"""
    print(f"\n{'='*60}")
    print(f"测试间隔: {interval_sec} 秒")
    print(f"{'='*60}")
    
    results = []
    for i in range(3):
        if i > 0:
            print(f"  ⏳ 等待 {interval_sec} 秒...")
            time.sleep(interval_sec)
        
        text = TEST_TEXTS[i % len(TEST_TEXTS)]
        print(f"  Call {i+1}: \"{text[:20]}...\" ", end="", flush=True)
        
        success, elapsed, info = call_tts(text, i+1)
        status = "✅ OK" if success else "❌ FAIL"
        print(f"{status} ({elapsed:.1f}s) - {info}")
        results.append(success)
    
    success_count = sum(results)
    print(f"\n  结果: {success_count}/3 成功")
    return success_count


# 按从小到大的间隔测试
intervals = [0, 3, 5, 10]
print(f"\n🧪 豆包 TTS 限流测试")
print(f"Voice: {VOICE_ID}")
print(f"Resource: {RESOURCE_ID}")
print(f"测试间隔: {intervals}")

all_results = {}
for interval in intervals:
    count = test_interval(interval)
    all_results[interval] = count
    if count < 3:
        print(f"\n  ⚠️ {interval}s 间隔有失败，继续测试下一个间隔...")
    else:
        print(f"\n  ✅ {interval}s 间隔全部成功！")
    
    # 测试间等 30 秒冷却
    if interval != intervals[-1]:
        print(f"\n  ⏳ 冷却 30 秒后测试下一个间隔...")
        time.sleep(30)

print(f"\n{'='*60}")
print(f"📊 汇总结果:")
print(f"{'='*60}")
for interval, count in all_results.items():
    status = "✅" if count == 3 else "⚠️" if count >= 2 else "❌"
    print(f"  {status} {interval}s 间隔: {count}/3 成功")

# 推荐
min_safe = None
for interval in sorted(all_results.keys()):
    if all_results[interval] == 3:
        min_safe = interval
        break

if min_safe is not None:
    print(f"\n✅ 推荐最小安全间隔: {min_safe} 秒")
else:
    print(f"\n❌ 所有测试的间隔都有失败，可能需要更长的间隔")
