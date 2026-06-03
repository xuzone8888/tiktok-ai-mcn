# 素材生成视频模型接口统一改造执行方案

本文档用于在新窗口中持续执行“素材生成视频”模型接口统一改造。执行时以当前分支 `codex/video-batch-model-interfaces` 为工作分支，先本地完成、反复验证，不部署服务器。

## 0. 执行目标

完成素材生成视频板块的模型接口统一改造：

- 只保留最终确认的模型：Sora2、Sora2 Pro、Grok、VEO、Omni、Seedance、HappyHorse。
- 所有视频生成模型统一为“提示词必填 + 图片可选”的生成形式。
- 建立统一模型注册、统一后端提交、统一状态查询、统一图片处理、统一积分执行、统一 OSS 落盘。
- Seedance 和 HappyHorse 的现有能力先不改，只包装进统一流程。
- 本地真实接口测试允许消耗额度，并且必须消耗到拿到正确结果。
- 本轮只做到本地测试通过，不上阿里云服务器。部署必须等待用户明确确认。

可直接用于新窗口的目标描述：

> 在 `/Volumes/Fuweibuzheng/Tiktokplfb` 的 `codex/video-batch-model-interfaces` 分支上，完成素材生成视频模型接口统一改造。建立统一模型注册、统一后端 submit/status、接入 Sora2/Sora2 Pro/Grok/VEO/Omni，保留并包装 Seedance/HappyHorse，统一为提示词必填+图片可选，建立服务端扣费/退款/流水执行系统，统一状态和 OSS 落盘。真实接口测试允许消耗额度，必须反复验证直到本地全链路通过。不要部署服务器。

## 1. 安全和边界

- 不要把任何真实 API Key 写进代码、文档、提交、日志或测试输出。
- 用户已提供一个共享上游平台密钥，该密钥可调用多个视频模型。执行时只放入本地环境变量，例如 `VIDEO_PLATFORM_API_KEY`，实现中也可保留旧 env 作为 fallback。
- 不要打印完整请求头、完整 Authorization、完整 env。
- 不要提交 `.env*` 文件。
- 不要动阿里云服务器，不要 PM2 restart，不要部署，不要改服务器 env。
- 真实接口测试允许消耗额度，目标是拿到正确结果，不是只跑 mock。
- 遇到上游文档和实测冲突时，以实测为准，并把差异记录下来。

## 2. 最终模型规格

| 产品模型 | 规格 | 图片输入 | 比例 | 备注 |
| --- | --- | --- | --- | --- |
| Sora2 | 12s 标准 | 可选参考图 | 9:16 / 16:9 | 文档模型示例：`sora-2-12s-9x16`、`sora-2-12s-16x9` |
| Sora2 Pro | 12s Pro | 可选参考图 | 9:16 / 16:9 | 文档模型示例：`sora2-pro-12s-9x16`、`sora2-pro-12s-16x9` |
| Grok | 10s 720P | 可选多图 | 9:16 / 16:9 | 只保留 720P，不再区分 480P/720P；去掉 15s |
| VEO | 8s 1080P | 可选图片 | 9:16 / 16:9 | 用户确认理论上支持竖屏传图；文档示例含 `firefly-veo31-*-8s-*-1080p` |
| Omni | 10s 720P | 可选图片，最多 7 张 | 9:16 / 16:9 | 用户与上游确认是 720P；文档里旧 `omni_flash` 写法需实测确认 |
| Seedance | 不动 | 不动 | 不动 | 先沿用现有 5s/10s 能力 |
| HappyHorse | 不动 | 不动 | 不动 | 先沿用现有 5s/12s 能力 |

统一产品规则：

- 前端不再拆“文生视频 / 图生视频”两个入口。
- 提示词必填。
- 图片可选：无图就提交空图片数组；有图就先上传 OSS，再传给对应 adapter。
- 每个模型按注册表限制最大图片数量。
- VEO 竖屏图片按支持来设计；如果实测某个上游参数不支持，再在 VEO adapter 内局部兼容，不在产品层提前禁用。

## 3. 推荐实现结构

建议新增一个模型接口层，不继续在页面和后台任务执行器里堆 `if/else`。

推荐文件结构：

- `src/lib/video-models/registry.ts`
- `src/lib/video-models/types.ts`
- `src/lib/video-models/adapters/sora.ts`
- `src/lib/video-models/adapters/grok.ts`
- `src/lib/video-models/adapters/veo.ts`
- `src/lib/video-models/adapters/omni.ts`
- `src/lib/video-models/adapters/seedance.ts`
- `src/lib/video-models/adapters/happyhorse.ts`
- `src/app/api/video-batch/models/submit/route.ts`
- `src/app/api/video-batch/models/status/route.ts`

如果现有代码风格更适合其他命名，可按项目模式调整，但必须保留“注册表 + adapter + 统一 route”的结构。

## 4. 第一阶段：统一模型注册

建立 `VideoModelRegistry`，每个模型只在一个地方定义：

- `id`
- `label`
- `provider`
- `durationSeconds`
- `qualityLabel`
- `resolution`
- `supportedAspectRatios`
- `maxImages`
- `supportsNoImage`
- `requiresOssTransfer`
- `pollIntervalMs`
- `maxPollMs`
- `creditCostPlaceholder`
- `submitAdapter`
- `statusAdapter`
- `healthProvider`

占位积分可以随便先填，但必须由服务端统一读取注册表计算，不再信任前端传入的 `creditCost`。

第一阶段验证：

- TypeScript 能识别全部最终模型 ID。
- 前端、后台任务、API 不再需要各自维护不同模型规格。
- 旧模型规格不再作为可选项出现：Sora2 10/15、Sora2 Pro 15/25、Grok 15、VEO fast/std/4K 前台拆分。

## 5. 第二阶段：统一后端 submit/status

新增统一提交接口：

`POST /api/video-batch/models/submit`

请求建议：

```json
{
  "modelType": "veo",
  "prompt": "雨后城市街道，镜头缓慢推进",
  "aspectRatio": "9:16",
  "imageUrls": [],
  "clientTaskId": "vbt-...",
  "groupName": "默认"
}
```

返回统一格式：

```json
{
  "success": true,
  "data": {
    "taskId": "upstream-task-id",
    "modelType": "veo",
    "status": "processing"
  }
}
```

新增统一状态接口：

`GET /api/video-batch/models/status?modelType=veo&taskId=...`

返回统一格式：

```json
{
  "success": true,
  "data": {
    "taskId": "upstream-task-id",
    "modelType": "veo",
    "status": "processing",
    "progress": 50,
    "videoUrl": null,
    "errorMessage": null
  }
}
```

状态只允许统一成：

- `processing`
- `completed`
- `failed`

第二阶段验证：

- 所有新模型均能通过同一个 submit/status route 调用。
- 页面内执行和后台任务执行器不再走不同路由。
- 修复现有后台任务中 VEO/Grok 误走 Sora route 的问题。

## 6. 第三阶段：各模型 adapter 接入

### Sora2 / Sora2 Pro

目标：

- Sora2：12s 标准，9:16/16:9，可选图片。
- Sora2 Pro：12s Pro，9:16/16:9，可选图片。

要点：

- 新平台共享 key 可作为优先 key。
- 不再使用当前 line3 的 10/15 秒旧限制作为最终 Sora2 路径。
- 根据比例映射完整模型名。
- 图片字段按文档确认，通常是参考图 URL。

验证：

- Sora2 无图 1 次成功。
- Sora2 有图 1 次成功。
- Sora2 Pro 无图或有图至少 1 次成功。

### Grok

目标：

- 10s，720P。
- 可选多图。
- 不保留 15s，不区分 480P/720P。

要点：

- 以新平台文档和实测为准。
- 统一 adapter 返回 `processing/completed/failed`。

验证：

- Grok 无图 1 次成功。
- Grok 有图 1 次成功。

### VEO

目标：

- 8s，1080P。
- 可选图片。
- 支持 9:16 / 16:9。

文档线索：

- 无图示例：`firefly-veo31-fast-8s-16x9-1080p`
- 参考图示例：`firefly-veo31-ref-8s-16x9-1080p`
- 新接口示例使用 `/api/v1/generate`
- 图片字段示例为 `reference_images`
- 参考模式示例为 `reference_mode: "image"`

要点：

- 先通过模型列表或实测确认竖屏模型名。
- 用户认为 VEO 理论上支持竖屏图片传送，产品层按支持设计。
- 如果竖屏有图在某个上游参数下失败，adapter 内尝试替代模型名或参数，不要直接删掉竖屏能力。

验证：

- VEO 无图横屏成功。
- VEO 无图竖屏成功。
- VEO 有图横屏成功。
- VEO 有图竖屏至少实测一次；如果失败，记录失败原因并尝试文档允许的替代写法。

### Omni

目标：

- 10s，720P。
- 可选图片，最多 7 张。
- 支持 9:16 / 16:9。

文档线索：

- 标题写“Omni 7 张图”。
- 旧示例出现 `omni_flash`、`1920x1080` / `1080x1920`、`seconds: 10`。
- 文档同时写旧方式暂时停止，因此必须用真实接口确认最终模型名、endpoint 和字段。
- 用户已和上游确认 Omni 是 720P。

要点：

- 以用户确认的 720P 作为产品规格。
- 实现前先用共享 key 查询模型列表或跑最小提交。
- 不确定字段时查文档并实测：无图、1 图、多图。

验证：

- Omni 无图 1 次成功。
- Omni 1 图 1 次成功。
- Omni 多图至少 2 张成功；如果 7 张风险高，可先测 2 张，再视成本和接口返回决定是否测 7 张上限。

### Seedance / HappyHorse

目标：

- 能力不动。
- 通过 adapter 包装进统一 submit/status。
- 不破坏现有成功路径。

验证：

- 至少跑轻量本地流程或 mock/状态兼容检查。
- 不主动改现有上游参数。

## 7. 第四阶段：统一积分执行

当前系统存在扣费/退款不一致问题。新方案必须统一：

1. 服务端从注册表读取占位价格。
2. 提交前检查用户余额。
3. 第三方任务提交成功后扣费并写 `credit_transactions`。
4. 第三方提交失败不扣费；如果已经扣费必须退款。
5. 第三方生成失败自动退款并写退款流水。
6. 使用 generation 状态或事务/乐观锁防止重复退款。
7. 前端传入的 `creditCost` 不再作为可信价格。

价格本轮只用占位数字，后续再统一定价。

验证：

- 余额不足返回失败且不提交上游。
- 提交失败不扣费或自动退款。
- 生成失败只退款一次。
- 成功任务不退款。
- `profiles.credits` 和 `credit_transactions` 一致。

## 8. 第五阶段：统一 OSS 落盘和生产轨迹簿

所有模型完成后统一：

- 如果上游 URL 不是永久 OSS URL，转存 OSS。
- 写 `generations.result_url`。
- 写 `generations.video_url`。
- 写 `completed_at`。
- 失败写 `error_message`。

验证：

- 成功任务能在生产轨迹簿看到。
- 视频 URL 可打开、可下载。
- 刷新页面后任务状态不丢。
- 重复查询 completed 状态不会重复转存或重复扣费/退款。

## 9. 第六阶段：前端收口

修改素材生成视频页面：

- 模型列表只显示最终 7 类。
- 统一上传区：提示词必填，图片可选。
- 图片数量按模型注册表动态限制。
- Seedance/HappyHorse 保持现有可用能力。
- 去掉旧规格入口：
  - Sora2 10s/15s
  - Sora2 Pro 15s/25s
  - Grok 15s
  - VEO fast/std/4K 前台拆分
- 后台任务执行器必须走统一 submit/status。

验证：

- 页面创建任务、批量任务、后台任务都走同一条执行链路。
- 有图/无图都能提交。
- 切换模型时图片上限和规格展示正确。

## 10. 反复验证循环

每完成一小块，都按这个循环执行：

1. 代码检查：`npm run lint` 或项目现有 lint 命令。
2. 类型检查：`npx tsc --noEmit` 或项目现有类型检查。
3. 构建检查：`npm run build`。
4. 接口最小测试：直接打本地 API。
5. 前端流程测试：打开本地页面验证 UI 和任务状态。
6. 真实上游测试：允许消耗额度，直到拿到正确视频结果。
7. 数据库检查：确认 generation、credits、transactions。
8. 回归检查：Seedance/HappyHorse 不被破坏。

如果某一步失败，不进入下一阶段，先修复并重跑。

## 11. 建议最终验收清单

上线前，本地至少完成：

- Sora2 12s 无图成功。
- Sora2 12s 有图成功。
- Sora2 Pro 12s 至少成功一次。
- Grok 10s 720P 无图成功。
- Grok 10s 720P 有图成功。
- VEO 8s 1080P 无图横屏成功。
- VEO 8s 1080P 无图竖屏成功。
- VEO 8s 1080P 有图横屏成功。
- VEO 8s 1080P 有图竖屏实测并记录结果。
- Omni 10s 720P 无图成功。
- Omni 10s 720P 有图成功。
- Seedance 现有流程未破坏。
- HappyHorse 现有流程未破坏。
- 成功视频全部能 OSS 落盘。
- 失败任务能退款且只退款一次。
- 构建通过。
- 本地页面全链路通过。

## 12. 需要向用户确认的情况

只有遇到以下情况才暂停询问用户：

- 需要部署服务器。
- 需要修改数据库结构且会影响线上数据。
- 上游真实接口连续失败，且文档与实测无法判断下一步。
- 某个模型实际不支持用户确认过的关键能力，例如 Omni 无法传图、VEO 竖屏有图完全不可用。
- 真实测试消耗异常大，明显超出正常单次视频测试成本。

其他情况优先自主推进、修复、重测。

