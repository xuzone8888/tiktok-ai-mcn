# Line 1 (默认线路) API 对接文档

> 供 API 接口方排查当前连接问题

---

## 1. 环境配置

| 配置项 | 值 |
|--------|-----|
| **API 端点** | `https://api.scd666.com` |
| **API Key** | 从本地环境变量 `SORA2_API_KEY` 读取，不写入文档或代码 |

代码来源：`src/lib/suchuang-api.ts`
```js
const SORA2_API_BASE = process.env.SORA2_API_ENDPOINT || "https://api.scd666.com";
const SORA2_API_KEY = process.env.SORA2_API_KEY || "";
```

---

## 2. 提交视频生成任务

### 接口地址
```
POST https://api.scd666.com/v1/videos
```

### 请求头
| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer {API_KEY}` |
| `Accept` | `application/json` |

### 请求体 (JSON)

**纯文生视频：**
```json
{
  "prompt": "视频描述文字...",
  "model": "sora2-portrait-15s"
}
```

**图生视频（带参考图）：**
```json
{
  "prompt": "视频描述文字...",
  "model": "sora2-portrait-15s",
  "image_url": "https://example.com/image.jpg"
}
```

### 可用模型名

| 模型 | 说明 |
|------|------|
| `sora2-portrait` | 竖屏 10秒 标清 |
| `sora2-landscape` | 横屏 10秒 标清 |
| `sora2-portrait-15s` | 竖屏 15秒 标清 |
| `sora2-landscape-15s` | 横屏 15秒 标清 |
| `sora2-pro-portrait-hd-15s` | 竖屏 15秒 高清 Pro |
| `sora2-pro-landscape-hd-15s` | 横屏 15秒 高清 Pro |
| `sora2-pro-portrait-25s` | 竖屏 25秒 标清 Pro |
| `sora2-pro-landscape-25s` | 横屏 25秒 标清 Pro |

### 期望响应 (成功)
```json
{
  "id": "task-xxxxx",
  "object": "video",
  "model": "sora2-portrait-15s",
  "status": "queued",
  "progress": 0,
  "created_at": 1700000000,
  "size": "..."
}
```

---

## 3. 查询任务状态

### 接口地址
```
GET https://api.scd666.com/v1/videos/{task_id}
```

### 请求头
| Header | Value |
|--------|-------|
| `Authorization` | `Bearer {API_KEY}` |
| `Accept` | `application/json` |

### 期望响应 (完成)
```json
{
  "id": "task-xxxxx",
  "status": "completed",
  "progress": 100,
  "video_url": "https://...",
  "completed_at": 1700000100
}
```

---

## 4. 当前问题现象

从本地测试结果：

```
Request:
  URL: https://api.scd666.com/v1/videos
  Method: POST
  Headers: Authorization: Bearer sk-SZPEd...9JLE
  Body: {"prompt":"A simple test video...","model":"sora2-portrait-15s"}

Result:
  ❌ Request Timeout / Socket Hang Up
  或 504 Gateway Timeout
```

**结论**：请求发出后无法收到有效响应，疑似服务端无响应或网关超时。

---

## 5. 参考文档

代码注释中引用的 API 文档地址：
- https://k0qzjtg1od.apifox.cn/384599477e0
