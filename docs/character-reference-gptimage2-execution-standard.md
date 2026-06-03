# 创建角色 GPTImage2 与角色引用矩阵执行标准

本文档用于在新窗口中持续执行“创建角色图片链路改接 GPTImage2，并让 VEO / Grok / Omni / HappyHorse 支持引用角色参考图”的任务。执行时必须以本文档为标准流程，边实现、边真实验证、边修复，直到本地链路稳定通过。

## 0. 新窗口目标描述

可直接用于新窗口的目标：

> 在 `/Volumes/Fuweibuzheng/Tiktokplfb` 项目中，使用 `codex/video-batch-model-interfaces` 分支，严格按 `docs/character-reference-gptimage2-execution-standard.md` 执行。先把创建角色链路从现有 Gemini 图片生成改为共享上游平台的 `gpt-image-2`：提示词生成角色主图，主图生成多角度参考图，并能保存角色。然后建立 VEO / Grok / Omni / HappyHorse 的角色引用矩阵，让素材生成视频可引用角色的多角度参考图。每改一处都要本地验证，真实接口测试允许消耗额度；失败就查文档、修复、重测。不要部署服务器，不要操作阿里云，不要提交或打印任何真实密钥。

## 1. 安全边界

- 不要把任何真实 API Key 写入代码、文档、提交、日志、测试输出或聊天回复。
- 共享上游平台密钥只允许放入本地环境变量 `VIDEO_PLATFORM_API_KEY` 或本地未提交的 `.env.local`。
- `.env.local`、`.env*` 不得提交。
- 不要打印完整请求头、`Authorization`、环境变量或含密钥的错误对象。
- 不要部署服务器，不要操作阿里云服务器，不要执行 PM2 / 线上重启 / 线上环境变更。
- 本地真实接口测试允许消耗额度，但必须使用最小必要测试样例。
- 市场签约、角色市场签约链路、“我的角色去创作”等后续优化不在本轮范围内。

## 2. 本轮目标

本轮只完成两个能力：

1. 创建角色链路改接 `gpt-image-2`。
   - 提示词生成角色主图。
   - 角色主图生成多角度角色参考图。
   - 生成结果可落到现有 OSS 持久 URL。
   - 角色保存时写入 `reference_sheet_url`，保持现有保存结构可用。

2. 素材生成视频支持引用角色参考图。
   - VEO 支持引用角色多角度参考图。
   - Grok 支持引用角色多角度参考图。
   - Omni 支持引用角色多角度参考图。
   - HappyHorse 支持引用角色多角度参考图。
   - 角色参考图与用户手动上传参考图进入同一套图片输入逻辑。

## 3. 非目标

- 不重做角色市场、签约、购买、授权、收益分配。
- 不改变 Sora / Sora2 的内部角色引用机制。
- 不给 Seedance 新增角色参考图能力。
- 不替换 HappyHorse 当前供应商；先沿用现有 DashScope / HappyHorse 能力，只把角色参考图传入现有流程。
- 不进行服务器部署。

## 4. 已核实的代码入口

创建角色入口：

- `src/app/(main)/character/create/components/creation-workspace.tsx`
- `src/app/(main)/character/create/components/casting-preview.tsx`
- `src/app/api/characters/generate/route.ts`
- `src/app/api/characters/route.ts`

现有图片生成封装：

- `src/lib/gemini-image-api.ts`

素材生成视频入口：

- `src/app/(main)/pro-studio/video-batch/page.tsx`
- `src/components/background-task-manager.tsx`
- `src/stores/video-batch-store.ts`

统一视频模型接口：

- `src/lib/video-models/catalog.ts`
- `src/lib/video-models/adapters/veo.ts`
- `src/lib/video-models/adapters/grok.ts`
- `src/lib/video-models/adapters/omni.ts`
- `src/lib/video-models/adapters/happyhorse.ts`
- `src/app/api/video-batch/models/submit/route.ts`
- `src/app/api/video-batch/models/status/route.ts`

## 5. 上游图片接口标准

共享上游平台基础地址：

- 默认：`https://api.hellobabygo.com`
- 本地可用 `VIDEO_PLATFORM_BASE_URL` 覆盖。

图片生成提交：

```http
POST /v1/images/generations?async=true
Authorization: Bearer <VIDEO_PLATFORM_API_KEY>
Content-Type: application/json
```

无参考图请求体：

```json
{
  "model": "gpt-image-2",
  "prompt": "角色提示词",
  "response_format": "url",
  "size": "1024x1024"
}
```

有参考图请求体：

```json
{
  "model": "gpt-image-2",
  "prompt": "多角度参考图提示词",
  "response_format": "url",
  "size": "1024x1024",
  "urls": ["https://public.example.com/reference.png"]
}
```

图片任务查询：

```http
GET /v1/images/{task_id}
Authorization: Bearer <VIDEO_PLATFORM_API_KEY>
```

完成结果优先读取：

- `data[0].url`
- `data.url`
- `url`
- `image_url`
- `result_url`

实现时必须做响应兼容归一化，不能只依赖单一字段。

## 6. GPTImage2 改造标准

新增独立共享上游图片客户端，不要把 `gpt-image-2` 逻辑塞进 `src/lib/gemini-image-api.ts`。

建议新增：

- `src/lib/video-models/platform-image-client.ts`

必须实现：

- 读取 `VIDEO_PLATFORM_API_KEY`。
- 读取 `VIDEO_PLATFORM_BASE_URL`，默认 `https://api.hellobabygo.com`。
- `submitPlatformImageGeneration`：提交异步图片任务。
- `getPlatformImageTaskStatus`：查询图片任务。
- `waitForPlatformImageResult`：轮询到成功或失败。
- `generateGptImage2`：面向业务的 GPTImage2 生成函数。
- 响应归一化：任务 ID、状态、图片 URL、错误信息。
- 日志脱敏：不得输出密钥和完整 Authorization。

建议尺寸策略：

- 主图优先尝试竖图尺寸，例如 `1024x1536`。
- 多角度参考图优先尝试横图尺寸，例如 `1536x1024`。
- 如果上游拒绝尺寸，自动回退到文档示例 `1024x1024`，并在 prompt 中强化构图要求。
- 尺寸兼容逻辑必须局限在图片客户端或角色生成 route 内，不要散落到前端。

## 7. 创建角色链路改造标准

后端 `src/app/api/characters/generate/route.ts` 必须保持现有业务语义：

- `type: "hero"`：生成角色主图。
- `type: "reference"`：使用角色主图生成多角度参考图。
- 主图失败：按现有积分逻辑退款。
- 参考图失败：不重复扣费，不制造重复退款。
- 成功结果保持返回字段兼容：
  - `heroImageUrl`
  - `referenceImageUrl`
  - `refPrompt`

主图生成：

- 使用 `gpt-image-2`。
- 提示词必填。
- 可选 `sourceImageUrl` 作为参考图，传入 `urls`。
- 生成成功后必须得到公网可访问图片 URL。
- 如果返回的 URL 不是 OSS 持久地址，走现有 OSS 上传逻辑转存。

参考图生成：

- 使用 `gpt-image-2`。
- 输入 `heroImageUrl`，通过 `urls: [heroImageUrl]` 传入。
- 保持现有多角度参考图提示词目标：同一人物、多角度、白底、适合作为视频参考图。
- 生成成功后必须得到公网可访问图片 URL。
- 如果返回的 URL 不是 OSS 持久地址，走现有 OSS 上传逻辑转存。

前端创建角色页面只做必要适配：

- 不在前端写死供应商。
- 不暴露密钥。
- 保持原有“生成主图 -> 自动生成参考图 -> 保存角色”的交互。

## 8. 角色引用矩阵

本轮角色引用能力矩阵如下：

| 模型 | 角色引用方式 | 角色参考图来源 | 最大图片数 | 本轮处理 |
| --- | --- | --- | ---: | --- |
| VEO | 图片参考 | `reference_sheet_url` | 3 | 必须支持 |
| Grok | 图片参考 | `reference_sheet_url` | 4 | 必须支持 |
| Omni | 图片参考 | `reference_sheet_url` | 7 | 必须支持 |
| HappyHorse | 图片参考 | `reference_sheet_url` | 9 | 必须支持 |
| Sora2 | 内部角色 / 触发词 | 不使用参考图矩阵 | 1 | 本轮不改 |
| Sora2 Pro | 内部角色 / 触发词 | 不使用参考图矩阵 | 1 | 本轮不改 |
| Seedance | 保持现状 | 不新增角色图能力 | 1 | 本轮不改 |

建议新增统一 helper：

- `src/lib/video-models/character-reference.ts`

该 helper 至少提供：

- `supportsCharacterReferenceImage(modelType)`
- `getCharacterReferenceMaxImages(modelType)`
- `getCharacterReferenceMode(modelType)`
- `mergeCharacterReferenceImages(modelType, characterRefUrl, uploadedImageUrls)`

图片合并规则：

- 角色参考图优先放第一张。
- 用户手动上传图接在后面。
- 总数不得超过模型最大图片数。
- 去重同一 URL。
- 空字符串、无效 URL 不得传给后端 adapter。

## 9. 各模型 adapter 角色图标准

VEO：

- 最多 3 张图。
- 角色参考图进入 `reference_images`。
- 保持 `reference_mode: "image"`。
- 横竖屏都按已支持规格设计。

Grok：

- 最多 4 张图。
- 角色参考图进入现有 Grok 图片参考字段。
- 字段格式以实测为准；若文档与现有实现冲突，先小样本验证再改。

Omni：

- 最多 7 张图。
- 角色参考图进入现有 Omni 图片参考字段。
- 必须补齐统一 submit 中 `characterRefUrl` 到 Omni 的传递。

HappyHorse：

- 最多 9 张图。
- 角色参考图进入现有 HappyHorse 参考图数组。
- 有图时保持走现有 r2v 能力。
- 不改变当前供应商和模型规格。

## 10. 前端收口标准

素材生成视频页必须做到：

- VEO / Grok / Omni / HappyHorse 都能选择用户创建的角色。
- 选择角色后，使用该角色的 `reference_sheet_url` 作为角色参考图。
- 角色参考图与手动上传参考图共享同一套最大图片数限制。
- 页面显示的图片数量限制来自统一矩阵或模型注册表，不要重复写散落的 `if/else`。
- 不把 Sora 内部角色逻辑误接到参考图矩阵。
- 不把角色市场签约链路纳入本次改造。

## 11. 后端 submit 收口标准

`src/app/api/video-batch/models/submit/route.ts` 必须做到：

- 只从服务端模型注册表读取图片数量限制。
- `characterRefUrl` 对 VEO / Grok / Omni / HappyHorse 生效。
- `characterRefUrl` 与 `imageUrls` 合并、去重、裁剪。
- 不信任前端传入的最大图片数量。
- 统一 adapter 输入结构，不让页面直接决定某个模型的字段名。

## 12. 验证门禁

每完成一个小步骤，必须做对应验证。验证失败不得进入下一步。

### 12.1 静态验证

- 修改后运行相关 TypeScript 检查，至少保证目标文件无类型错误。
- 检查 `rg` 搜索结果，确认旧的 `gemini-4k` 不再是创建角色主路径。
- 检查 `rg` 搜索结果，确认 HappyHorse 已纳入角色参考图矩阵。
- 检查 `rg` 搜索结果，确认没有真实密钥落盘。

### 12.2 GPTImage2 真实接口验证

必须完成：

- GPTImage2 无图生成角色主图成功。
- GPTImage2 使用主图生成多角度参考图成功。
- 返回图片 URL 可访问。
- 非 OSS 临时 URL 能转存为 OSS URL。
- 创建角色保存后能读取到 `reference_sheet_url`。

### 12.3 视频角色引用验证

必须至少完成：

- VEO 使用角色参考图提交成功，并能查到最终成功或明确失败原因。
- Grok 使用角色参考图提交成功，并能查到最终成功或明确失败原因。
- Omni 使用角色参考图提交成功，并能查到最终成功或明确失败原因。
- HappyHorse 使用角色参考图能进入现有 r2v 提交流程；如果本地缺少 HappyHorse 所需供应商 key，必须说明真实生成验证阻塞原因，但代码路径仍要通过本地验证。

### 12.4 回归验证

最后必须运行：

- `npm run lint`
- `npm run type-check`
- `npm run build`
- 本地页面创建角色链路验证。
- 本地素材生成视频页面选择角色并提交验证。

如果项目实际脚本名称不同，先读取 `package.json`，按项目现有脚本执行等价检查。

## 13. 失败处理标准

遇到失败时按以下顺序处理：

1. 记录失败的模型、请求阶段、脱敏错误信息。
2. 检查本地实现是否字段名、尺寸、模型名、状态字段解析错误。
3. 查阅 Apifox 文档或现有代码调用方式。
4. 写最小修复。
5. 重新跑同一项验证。
6. 连续失败时保留失败原因，不跳过矩阵项。

不得因为一次真实接口失败就只做 mock 通过。

## 14. 完成标准

本任务完成必须同时满足：

- 创建角色主图已走 `gpt-image-2`。
- 多角度参考图已走 `gpt-image-2`。
- 保存角色后有可用 `reference_sheet_url`。
- VEO / Grok / Omni / HappyHorse 的角色引用矩阵已建立。
- 素材生成视频页可为这四个模型选择用户创建角色。
- 后端统一 submit 可正确合并角色参考图和上传参考图。
- VEO / Grok / Omni 至少完成真实角色参考图核心测试。
- HappyHorse 在具备供应商 key 时完成真实测试；否则完成代码路径验证并明确阻塞。
- lint / typecheck / build 通过。
- 未提交、未打印、未落盘任何真实密钥。
- 未部署服务器。

