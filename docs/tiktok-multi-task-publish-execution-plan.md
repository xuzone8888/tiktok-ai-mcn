# TikTok 多任务发布执行方案

> 创建日期：2026-05-17  
> 适用页面：`/publish`，即现有「TikTok 视频发布」页面  
> 新增入口：页面顶部 Tab 中加入「多任务发布」，放在「创建发布」与「任务管理」之间  
> 第一阶段目标：支持「选择视频 -> 选择账号组 -> 填写内容信息 -> 设置发布时间 -> 预览发布项 -> 生成一个任务组」

## 1. 目标

在现有 TikTok 内容发布能力之上，新增一个独立的多任务发布工作区。它仍然位于「TikTok 视频发布」页面内，但不直接复用当前「创建发布」表单的交互路径。

最终 Tab 顺序：

```text
创建发布 | 多任务发布 | 任务管理
```

当前「创建发布」继续承担单账号、多条内容、轻量任务创建；新增「多任务发布」承担账号组轮换、多条内容排程、统一生成任务组。

第一阶段不新增侧边栏入口，不新开页面路由，避免用户在「TikTok 视频发布」和新能力之间来回跳转。

## 2. 设计原则

1. 不破坏当前已上线的「创建发布」能力。
2. 新能力独立开发，不直接复用「创建发布」的大表单组件和表单状态。
3. 入口同页，代码分层独立：页面 Tab 接入即可，具体工作区由新组件承载。
4. 创建链路独立：使用新的预览接口和创建接口，不走当前 `/api/publish/tasks` 的创建路径。
5. 复用边界要收窄：只复用 TikTok OAuth、token 刷新、TikTok Content API 封装、任务表底座、任务管理入口、OSS 签名生成思路。
6. 不复用旧上传状态、旧创建接口、旧表单提交函数、旧立即执行调度。
7. 上传、账号组能力汇总、任务创建、排程生成都按多任务发布重新写。
8. 操作顺序贴近当前「创建发布」：先选视频，再选账号组，再做设置。
9. 账号选择以账号组为核心，而不是逐个账号点选。
10. 一条视频只能生成一个发布项，只能分配给一个账号。
11. 同一条视频不能重复发到同一账号，也不能发到多个账号。
12. 每条视频必须有独立标题，允许用户快速填充，但最终落库必须逐条保存。
13. 所有发布时间必须可预览，用户提交前能看到每条内容对应账号和时间。
14. 多任务发布创建后，仍进入现有任务管理入口，但任务组卡片和详情展示要使用更适合多任务的状态口径。
15. 文案统一使用「多任务发布」「多条内容」「账号组」「投放计划」「排程」「任务组」等表达。
16. 第一阶段保持轻量：不新建任务表，不新增复杂状态枚举，不增加通用发布重试入口，不一次性拆出过多组件。
17. 能通过任务项实时计算的统计不落缓存字段，避免任务表越来越臃肿。
18. UI 只突出当前决策需要的信息；异常为 0 时不强行占据主视觉。

## 3. 竞品逻辑取舍

竞品中适合采纳的部分：

1. 操作顺序：先上传视频，再选择账号，再填写内容，再设置发布时间。
2. 快速插入标题：相同内容、按文件名、逐行内容三种方式都适合我们。
3. AI 推荐标题：根据当前视频数量生成多条不同标题，适合我们重点开发。
4. 发布时间：立即发布、定时发布、多时段安排三个概念清晰。
5. 右下角固定操作栏：适合多步骤页面，能让用户随时看到提交按钮。

不建议第一阶段照搬的部分：

1. 「是否合并为任务组」不建议做成必选项。多任务发布的核心就是生成一个可追踪任务组，第一阶段固定按任务组归档。
2. 「独立设置」不建议第一阶段开放。它会让每条内容拥有独立账号、独立时间、独立设置，复杂度接近表格编排工具。
3. 「同一内容覆盖多个账号」不适合我们当前规则，因为会违反一条视频只发一次的约束。
4. 多时段安排第一阶段可在方案里保留，但实际开发建议放第二阶段。

第一阶段最终采用：

```text
选择视频
选择账号组
填写任务组名称
选择分配方式
填写内容信息
设置发布时间
预览发布项
创建任务组
```

## 4. 当前代码基础

现有可参考或底层可用能力：

1. TikTok 内容账号绑定：`src/app/(main)/publish/accounts/page.tsx`
2. TikTok OAuth：`src/app/api/tiktok/auth/url/route.ts`、`src/app/api/tiktok/auth/callback/route.ts`
3. 账号列表：`src/app/api/publish/accounts/route.ts`
4. 账号组：`src/app/api/publish/account-groups/route.ts`
5. 账号组明细：`src/app/api/publish/account-groups/[id]/accounts/route.ts`
6. Creator Info：`src/app/api/publish/creator-info/route.ts`
7. OSS 签名生成思路：`src/app/api/upload/oss-credentials/route.ts`
8. 视频转存现状参考：`src/app/api/upload/transfer-to-oss/route.ts`
9. 任务表底座：`publish_tasks`、`publish_task_items`
10. 执行器中的单条发布能力：`src/lib/publish-processor.ts`
11. TikTok 发布 API 封装：`src/lib/tiktok/content-posting.ts`
12. 任务管理 UI：`src/components/publish/TaskManager.tsx`

需要新增或调整能力：

1. `/publish` 页面新增 Tab 状态：`create | multiTask | tasks`
2. 新增多任务发布主组件，独立维护状态，不读取或改写现有「创建发布」表单状态。
3. 新增服务端预览 API。
4. 新增服务端创建 API。
5. 新增多文件上传队列和签名接口，控制并发、重试、取消和 URL 校验。
6. 新增账号组发布能力 API，用来校验账号组内账号是否都能发布。
7. 新增多任务发布创建接口，不能使用当前 `/api/publish/tasks`。
8. 新增排程函数，生成「一条视频 -> 一个账号 -> 一个时间」。
9. 任务表增加少量元数据字段，用于区分工作流来源和保存排程配置。
10. 执行器需要拆分调度层和单条发布层，所有远期任务只交给到期处理逻辑执行。

## 5. 第一阶段范围

第一阶段只实现推荐路径：

```text
添加多条视频 -> 选择一个账号组 -> 填写任务组名称 -> 顺序轮换或随机均衡 -> 设置标题和发布时间 -> 预览 -> 创建任务组
```

第一阶段包含：

1. 支持先添加视频，再选择一个账号组。
2. 支持账号组内最多 20 个账号，沿用现有账号组上限。
3. 支持最多 40 条视频，且视频数量不能少于账号组内可用账号数量。
4. 支持本地上传与从视频制作区选择。
5. 任务组名称必填。
6. 支持「顺序轮换」和「随机均衡」两种分配方式。
7. 支持相同内容、按文件名、逐行内容三种快速插入标题方式。
8. 支持每条视频单独标题，最终每个发布项都有独立标题。
9. 支持 AI 标题辅助，按视频数量生成不同标题。
10. 固定使用视频首帧作为封面，不提供逐条选择封面。
11. 支持立即发布和定时发布。
12. 支持同账号后续内容间隔和随机追加时间。
13. 支持提交前预览完整排程表。
14. 创建后进入任务管理。

第一阶段不做：

1. 不做多个账号组同时选择。
2. 不做同一条视频覆盖多个账号。
3. 不做表格手动拖拽调整账号。
4. 不做基于历史数据的真实智能推荐时间。
5. 不做 TikTok 封面图片上传，也不做逐条封面帧选择。
6. 不做多时段安排的真实提交，只保留后续设计。
7. 不做「拆为独立任务」归档方式。

## 6. 核心发布逻辑

### 6.1 铁规则：一条视频只发一次

无论使用顺序轮换还是随机均衡，都必须满足：

```text
一个 video.id 只能生成一条 publish_task_items 记录
一条 publish_task_items 只能绑定一个 account_id
同一个任务组内不能出现重复 video.id
同一个任务组内不能出现同一 video.url 对应多个 account_id
```

服务端创建任务时必须做唯一性检查：

```text
uniqueVideoKeys = video.id 或 video.url
if uniqueVideoKeys.size !== videos.length:
  reject
```

生成发布项后再次检查：

```text
if itemVideoKeys.size !== items.length:
  reject
```

这个约束不能只放前端，必须在创建 API 中强制执行。

### 6.2 视频数量与账号数量

第一阶段要求：

```text
视频数量 >= 可用账号数量
```

原因：

1. 用户选择一个账号组时，默认预期是组内账号都会参与。
2. 如果视频少于账号数，会出现部分账号不发布，容易造成误解。
3. 这个限制也更符合账号组投放的运营心智。

示例：

```text
10 条视频，20 个账号
不允许创建，需要增加视频或减少账号组规模。
```

后续如果需要，可以增加「允许部分账号参与」开关，但第一阶段不做。

### 6.3 默认模式：顺序轮换

定义：

```text
视频数 = V
账号数 = A
视频下标 = videoIndex，从 0 开始
账号下标 = accountIndex
轮次 = roundIndex
```

账号分配公式：

```text
accountIndex = videoIndex % A
roundIndex = floor(videoIndex / A)
```

也就是说，视频按顺序分配给账号组里的账号。顺序轮换是第一阶段推荐模式。

示例一：

```text
20 条视频，20 个账号
每个账号获得 1 条视频
```

示例二：

```text
40 条视频，20 个账号
每个账号获得 2 条视频
```

示例三：

```text
45 条视频，20 个账号
前 5 个账号获得 3 条视频
后 15 个账号获得 2 条视频
```

通用计算：

```text
每个账号基础数量 = floor(V / A)
多出的数量 = V % A

账号顺序中前「多出的数量」个账号多获得 1 条视频
```

如果账号数大于视频数，第一阶段直接阻止创建。

### 6.4 随机均衡

随机均衡用于打散视频与账号的对应关系，但仍然保证一条视频只分配给一个账号。

规则：

1. 视频数量必须不少于账号数量。
2. 先打乱视频顺序。
3. 再打乱账号顺序。
4. 第一轮保证每个账号至少获得一条视频。
5. 多出的视频按打乱后的账号顺序继续分配。
6. 如果视频数量远多于账号数量，按一轮一轮重新洗牌账号，避免多出内容集中到少数账号。

伪代码：

```text
shuffledVideos = shuffle(videos, seed)
remainingVideos = shuffledVideos
assignments = []

round = 0
while remainingVideos.length > 0:
  roundAccounts = shuffle(accounts, seed + round)
  for account in roundAccounts:
    if remainingVideos.length === 0:
      break
    video = remainingVideos.shift()
    assignments.push({ video, account, round })
  round += 1
```

随机必须可复现：

```text
seed = task idempotency key 或创建请求中的 random_seed
```

这样用户预览看到的分配结果与最终创建结果一致。

随机均衡适合：

1. 用户不希望内容和账号总是按固定顺序绑定。
2. 账号组内账号质量接近，不需要人为控制哪个账号先发。
3. 希望整体节奏更自然。

### 6.5 40 条视频发到 20 个账号的完整例子

用户设置：

```text
视频：40 条
账号组：20 个账号
开始时间：2026-05-18 20:00，亚洲/上海
同一轮账号错开：2 分钟，系统默认
同账号后续内容间隔：6 小时
随机追加：关闭
```

排程结果：

```text
第一轮
2026-05-18 20:00 账号 1 视频 1
2026-05-18 20:02 账号 2 视频 2
2026-05-18 20:04 账号 3 视频 3
...
2026-05-18 20:38 账号 20 视频 20

第二轮
2026-05-19 02:00 账号 1 视频 21
2026-05-19 02:02 账号 2 视频 22
2026-05-19 02:04 账号 3 视频 23
...
2026-05-19 02:38 账号 20 视频 40
```

这个例子说明：

1. 不是 20 个账号同时在 20:00 发布。
2. 不是同一个账号连续发布 2 条。
3. 账号之间由系统默认安全间隔错开。
4. 同一个账号的下一条内容由「同账号后续内容间隔」错开。

### 6.6 排程公式

基础时间：

```text
baseTime = startAt
  + roundIndex * sameAccountIntervalMinutes
  + accountIndex * accountIntervalMinutes
```

如果开启随机追加：

```text
scheduledAt = baseTime + random(0, jitterMinutes)
```

为了避免同一账号的两条内容因为随机值出现过近，需要做保护：

```text
if scheduledAt <= previousSameAccountScheduledAt + minSameAccountGap:
  scheduledAt = previousSameAccountScheduledAt + minSameAccountGap
```

其中：

```text
minSameAccountGap = sameAccountIntervalMinutes
```

第一阶段随机追加只使用正向追加，不使用前后浮动。原因：

1. 不会早于用户选择的开始时间。
2. 更容易保证同账号后续内容间隔。
3. 预览结果更稳定。

同一轮内也需要做单调保护，避免前一个账号追加 5 分钟、后一个账号追加 0 分钟后，页面展示顺序和用户理解的账号顺序完全错开：

```text
if scheduledAt <= previousInRoundScheduledAt:
  scheduledAt = previousInRoundScheduledAt + 1 minute
```

最终预览表按 `scheduled_at asc` 展示，`plan_sequence` 保留原始分配顺序。

### 6.7 账号顺序

账号组内账号默认顺序：

1. 优先使用账号组返回的账号顺序。
2. 如果账号组没有明确排序，则按 `created_at asc`。
3. 前端允许按粉丝数、最近绑定排序，但提交时必须把最终账号顺序传给后端。

提交时后端不能信任前端排序，必须重新校验账号归属、账号组归属、账号状态，再按请求中的账号 ID 顺序生成计划。

## 7. 发布时间模式

### 7.1 立即发布

用户点击创建后，从当前时间开始生成排程。

规则：

1. 每个账号的第一条内容从当前时间开始按系统安全间隔排开。
2. 如果一个账号获得多条内容，后续内容按同账号后续内容间隔排开。
3. 所有发布项状态写为 `scheduled`。
4. 创建完成后主动触发一次定时处理接口，让到期项尽快执行。
5. 远期项继续由 cron 执行。

不能使用当前 `processPublishQueue({ mode: 'immediate' })` 直接处理所有发布项，因为现有处理器会先锁定所有项。如果后续时间相隔数小时，长时间等待会阻塞服务进程，也会造成状态不准确。

### 7.2 定时发布

用户选择一个开始时间。

规则：

1. 开始时间必须晚于当前时间至少 5 分钟。
2. 时区固定按用户当前界面时区展示，第一阶段使用亚洲/上海。
3. 服务端存储使用 UTC ISO 字符串。
4. 预览时展示亚洲/上海时间。

### 7.3 多时段安排

这是第二阶段能力，第一阶段只保留设计说明，不进入真实提交链路。

用户选择：

```text
起始日期
每周哪几天
每天哪些时间点
同一轮账号错开
随机追加
```

示例：

```text
从 2026-05-18 开始
周一到周五
每天 10:00、16:00、20:00
同一轮账号错开 3 分钟
```

排程逻辑：

1. 先生成可用时间点列表。
2. 每个时间点作为一个轮次起点。
3. 同一轮内，账号按系统安全间隔或高级设置错开。
4. 视频按顺序填入账号。
5. 如果当天时间点用完，自动顺延到下一个可用日期。

这个模式适合 100 条以上内容，但第一阶段视频上限是 40 条，所以可以后置。

### 7.4 最佳发布时间

第一阶段只做入口占位，不做真实算法。

建议表现：

```text
最佳发布时间
即将上线
```

后续如果要做，需要依赖每个账号历史表现、账号地区、粉丝活跃时间、已发内容数据。当前数据基础还不够完整。

## 8. 前端页面方案

### 8.1 页面 Tab 改造

文件：

```text
src/app/(main)/publish/page.tsx
```

当前：

```ts
type TabType = 'create' | 'tasks'
```

调整为：

```ts
type TabType = 'create' | 'multiTask' | 'tasks'
```

Tab 配置：

```text
创建发布
多任务发布
任务管理
```

点击「多任务发布」后渲染新组件。

### 8.2 组件边界

多任务发布组件必须新建，不从当前「创建发布」表单拆分分支。可以参考它的视觉样式、上传入口和字段命名，但不能共享同一套 React state、校验分支和提交函数。

第一阶段采用最小拆分，优先保证清爽可运行：

```text
src/components/publish/multi-task/MultiTaskPublisher.tsx
src/lib/publish/multi-task-scheduler.ts
```

只有当 `MultiTaskPublisher.tsx` 明显难以维护时，再按真实边界拆出小组件，例如：

```text
视频选择子组件
标题编辑子组件
时间设置子组件
预览表子组件
```

排程函数放在 `src/lib/publish/multi-task-scheduler.ts`，前端和后端共同引用，避免两套算法。

禁止做法：

```text
在当前创建发布组件里增加 isMultiTask 分支
在同一个提交函数里同时处理普通任务和多任务发布
让两个工作流共享同一个 videos/accounts/formState 对象
```

推荐做法：

```text
当前创建发布组件保持稳定
MultiTaskPublisher 独立维护页面状态
上传、账号组、TikTok 能力查询通过新接口调用底层能力
```

### 8.3 页面结构

页面从上到下：

```text
1. 添加视频
2. 选择账号组
3. 任务组名称与分配方式
4. 内容信息
5. 发布时间
6. 发布项预览
7. 底部操作栏
```

底部操作栏固定在页面底部，展示：

```text
视频数量
账号数量
发布项数量
预计完成时间
取消
创建任务组
```

### 8.4 添加视频

支持：

1. 本地上传。
2. 从视频制作区选择。

本模块必须新写，不直接复用当前「创建发布」里的 `selectedVideos`、`uploadingFiles`、`batchTransfer` 状态。

上传限制建议：

```text
单文件最大：500 MB
总容量上限：2 GB
单次最多：40 条视频
格式：mp4、mov、webm
```

本地上传策略：

1. 使用浏览器直传 OSS，避免视频文件经过应用服务器。
2. 新增多文件签名接口，一次请求返回多条上传签名，减少 40 个文件时的接口往返。
3. 前端上传队列限制并发，建议 3-5 个文件同时上传。
4. 每个文件独立状态：等待、上传中、成功、失败、已取消。
5. 每个文件最多重试 2 次，重试时只重试失败文件。
6. 上传成功后保留 `oss_key`、`url`、`size`、`content_type`、`source`。
7. 上传完成后做 URL 格式校验，必须是 HTTPS 且属于当前允许的 OSS 域名。

不使用当前「创建发布」里的全量并发上传方式。原因是 40 条视频同时上传时，浏览器连接数、网络稳定性、OSS 签名有效期都会成为风险。

从视频制作区选择策略：

1. 优先选择已经是稳定 OSS 地址的视频。
2. 如果来源不是稳定 OSS 地址，必须先转存为稳定 OSS 地址。
3. 转存不能直接照搬旧页面状态；需要新写转存队列，建议并发 1-2 个。
4. 当前转存接口会把远程视频读成内存数据，视频较多时存在内存风险；第一阶段要限制并发，并在后续改为流式转存或后台任务。
5. 转存完成后才能进入发布项预览。

选择视频后立即生成视频列表：

```text
视频 1
视频 2
视频 3
```

每条视频保留：

```text
id
name
url
source
duration_ms
thumbnail
cover_timestamp_ms
title
```

第一阶段 `cover_timestamp_ms` 固定为 `0`，表示默认首帧。

如果视频数量少于账号组可用账号数量，选择账号组后阻止继续创建，并提示：

```text
当前视频数量少于账号组内可用账号数量，请增加视频或调整账号组。
```

### 8.5 选择账号组

账号组选择不能走旧的单账号选择逻辑。

账号组列表可以读取现有接口：

```text
GET /api/publish/account-groups
```

显示：

```text
分组名称
账号数量
已授权数量
即将过期数量
已过期数量
头像矩阵
```

选择账号组后调用新接口获取发布能力汇总。

新接口必须面向发布场景重新封装，返回：

```text
账号组信息
组内账号顺序
可用账号列表
不可用账号列表
过期账号列表
Creator Info 汇总
发布默认设置建议
最大视频时长
```

这样前端不需要自己拼接多个旧接口，也能避免账号组被修改后出现误发。

### 8.6 任务组名称与分配方式

任务组名称必填。

建议位置：

```text
选择账号组之后
内容信息之前
```

默认可生成占位建议：

```text
TikTok 内容计划 2026-05-18 20:00
```

但用户必须确认或手动修改，不能静默提交空名称。

分配方式第一阶段提供两个选项：

```text
顺序轮换（推荐）
随机均衡
```

顺序轮换：

```text
按账号组顺序依次分配视频，多出的视频进入下一轮。
```

随机均衡：

```text
打乱视频与账号顺序，每个账号先获得一条内容，多出的内容继续均衡分配。
```

不展示「全组覆盖」。它会让同一条视频进入多个账号，违反本方案铁规则。

### 8.7 归档方式

第一阶段固定为：

```text
按任务组归档
```

不提供「拆为独立任务」。

原因：

1. 多任务发布需要统一预览、统一进度、统一异常提示入口。
2. 如果拆成多个任务，用户很难看出这些内容来自同一次操作。
3. 当前任务管理已有任务组卡片，适合承载这个场景。

后续如果确实需要，可增加：

```text
按内容拆分
```

但第二阶段再评估。

### 8.8 发布能力汇总

新增接口：

```text
POST /api/publish/multi-task/creator-capabilities
```

请求：

```json
{
  "account_group_id": "uuid",
  "account_ids": ["uuid"]
}
```

响应：

```json
{
  "success": true,
  "accounts": [
    {
      "id": "uuid",
      "display_name": "name",
      "avatar_url": "url",
      "status": "ready",
      "privacy_level_options": ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
      "comment_disabled": false,
      "duet_disabled": false,
      "stitch_disabled": false,
      "max_video_post_duration_sec": 600
    }
  ],
  "summary": {
    "ready_count": 20,
    "blocked_count": 0,
    "privacy_level_options": ["PUBLIC_TO_EVERYONE", "SELF_ONLY"],
    "comment_disabled": false,
    "duet_disabled": false,
    "stitch_disabled": false,
    "max_video_post_duration_sec": 600
  }
}
```

汇总规则：

1. 可见范围取所有账号可用选项的交集。
2. 评论默认允许；如果任一账号禁用评论，则最终自动降级为关闭并提示。
3. 合拍默认关闭；即使账号允许，第一阶段也默认关闭。
4. 引用默认开启；如果任一账号禁用引用，则最终自动降级为关闭并提示。
5. 最大视频时长取所有账号中的最小值。
6. 任一账号 creator info 获取失败时，该账号标记为不可用。
7. 第一阶段默认不允许带不可用账号继续创建。
8. 商业内容与品牌合作默认关闭。
9. AI 标识默认开启。

可见范围不建议静默设置默认值。原因是当前 TikTok 发布链路明确要求用户选择可见范围。前端可以推荐一个可用选项，但需要用户确认。

### 8.9 内容信息

标题是该模块的核心能力。不能只做一个普通输入框。

每条视频最终都必须拥有独立标题。

标题区包含：

```text
逐条标题列表
快速插入
AI 推荐
```

逐条标题列表：

```text
视频 1：输入框
视频 2：输入框
视频 3：输入框
```

快速插入包含三种方式：

```text
相同内容
按文件名
逐行内容
```

相同内容：

```text
用户输入一段内容，系统填入所有视频标题。
允许使用变量，例如 {video}、{date}、{account}。
```

按文件名：

```text
从视频文件名提取标题。
去掉文件扩展名。
将下划线、短横线替换为空格。
允许用户确认前预览。
```

逐行内容：

```text
打开对话框。
用户输入多行内容。
每一行对应一个视频标题。
点击确认后按视频顺序填入标题输入框。
```

逐行内容校验：

```text
行数少于视频数：提示还差多少条，不允许直接覆盖。
行数多于视频数：提示多出的内容不会使用，允许用户确认。
空行：默认忽略；如果忽略后数量不足，继续提示。
```

AI 推荐：

```text
用户输入主题、语言、风格、关键词。
系统根据当前视频数量生成 N 条不同标题。
N = 视频数量。
生成后插入每条视频对应输入框。
```

AI 推荐要求：

1. 不能生成一条标题然后复制到所有视频。
2. 每条标题都要有差异。
3. 支持用户逐条编辑。
4. 如果已有标题，生成前提示是否覆盖。

标题变量：

```text
{n}      当前发布项序号
{video}  当前视频序号
{date}   发布日期
{account} 账号名称
{file}   文件名标题
```

标题校验：

1. 每条标题不能为空。
2. 每条标题不超过 TikTok 当前限制。
3. Hashtag 数量沿用现有服务端限制。
4. 如果用户使用变量，预览中必须显示渲染后的标题。

### 8.10 发布选项

多任务发布不让用户逐项配置复杂选项。第一阶段使用一套通用默认值，减少操作成本。

默认值：

```text
评论权限：允许
合拍功能：关闭
引用功能：开启
商业内容：关闭
品牌合作：关闭
AI 标识：开启
```

可见范围：

```text
保留必选，不静默默认。
```

原因：

1. 当前 TikTok 发布链路已经把可见范围作为必选项处理。
2. 可见范围属于高敏感设置，不建议系统代替用户选择。
3. 前端可以推荐账号组共同支持的第一个选项，但需要用户确认。

账号组能力兜底：

1. 如果账号组内任一账号禁用评论，最终评论权限自动降级为关闭，并在预览提示。
2. 如果账号组内任一账号禁用引用，最终引用功能自动降级为关闭，并在预览提示。
3. 合拍第一阶段默认关闭，不主动打开。
4. 商业内容和品牌合作第一阶段默认关闭，不展示为主路径设置。
5. AI 标识默认开启，写入父任务。

最终写入 `publish_tasks`：

```text
allow_comment
allow_duet
allow_stitch
brand_content_toggle = false
brand_organic_toggle = false
is_aigc = true
privacy_level
```

### 8.11 封面逻辑

第一阶段只支持：

```text
默认首帧封面
```

不提供逐条选择封面，也不承诺上传自定义封面图片到 TikTok。

原因：当前 TikTok Content Posting API 调用使用的是：

```text
video_cover_timestamp_ms
```

已有任务项字段：

```text
publish_task_items.cover_timestamp_ms
```

第一阶段统一写入：

```text
cover_timestamp_ms = 0
```

页面提示：

```text
默认使用视频首帧作为封面。
```

### 8.12 发布时间设置

第一阶段实际开发两个模式：

```text
立即发布
定时发布
```

多时段安排保留设计，但不进入第一阶段提交链路。

字段：

```text
开始方式：立即发布 / 定时发布
开始时间
同账号后续内容间隔
随机追加
```

这里不再单独暴露「账号间隔」给第一阶段用户，默认使用系统安全值：

```text
同一轮账号错开：2 分钟
```

原因：

1. 用户最关心的是同一个账号多久发下一条。
2. 同一轮 20 个账号全部发完只需要约 38 分钟。
3. 减少参数，有利于第一阶段上线。

后续可在高级设置里开放「同一轮账号错开」。

立即发布：

```text
点击创建后，每个账号的第一条内容按系统安全间隔依次进入执行队列。
如果某个账号有多条内容，后续内容按用户选择的间隔排开。
```

定时发布：

```text
用户选择第一轮第一条内容的开始时间。
其余内容按系统安全间隔和同账号后续内容间隔排开。
```

同账号后续内容间隔可选：

```text
10 分钟
1 小时
3 小时
6 小时
12 小时
24 小时
自定义分钟数
```

随机追加可选：

```text
关闭
0-5 分钟
0-10 分钟
0-15 分钟
0-30 分钟
```

随机追加第一阶段建议默认关闭，但可以允许用户开启。

### 8.13 多时段安排

多时段安排适合后续阶段，不建议第一阶段和核心功能一起上线。

原因：

1. 需要处理周几、时间段、跨天顺延。
2. 需要解释「一轮」和「时段」之间的关系。
3. 会显著增加预览表复杂度。
4. 当前第一阶段视频上限 40 条，用立即发布和定时发布已经能覆盖主要场景。

第二阶段设计：

```text
开始日期
选择周几
选择每天可用时间段
每个时间段内按账号顺序错开
如果当前时间段放不下，顺延到下一个可用时间段
```

### 8.14 发布项预览

预览表字段：

```text
序号
轮次
视频
账号
标题
发布时间
状态提示
```

预览表必须支持：

1. 按账号筛选。
2. 按轮次筛选。
3. 检查同账号后续内容间隔。
4. 展示预计完成时间。
5. 展示账号分配摘要。

摘要示例：

```text
40 条视频将生成 40 个发布项。
20 个账号参与。
每个账号获得 2 条内容。
预计从 2026-05-18 20:00 开始，到 2026-05-19 02:38 完成。
```

## 9. 服务端 API 方案

### 9.1 上传签名接口

路径：

```text
POST /api/publish/multi-task/upload-credentials
```

职责：

1. 验证用户登录。
2. 接收多个文件的元数据。
3. 校验文件数量、大小、类型。
4. 为每个文件生成独立 OSS key 和签名 URL。
5. 返回最终公开访问 URL。

请求：

```json
{
  "files": [
    {
      "client_id": "local-1",
      "filename": "video-1.mp4",
      "content_type": "video/mp4",
      "size": 10485760
    }
  ]
}
```

响应：

```json
{
  "success": true,
  "items": [
    {
      "client_id": "local-1",
      "upload_url": "https://...",
      "public_url": "https://media.toryxai.com/videos/...",
      "oss_key": "videos/user-id/..."
    }
  ]
}
```

说明：

1. 前端仍然浏览器直传 OSS。
2. 该接口只负责签名，不接收视频文件。
3. 不能直接复用当前创建发布页的上传状态。
4. 上传队列由多任务组件独立管理；是否拆出视频选择子组件由实际复杂度决定。

### 9.2 发布能力汇总接口

路径：

```text
POST /api/publish/multi-task/creator-capabilities
```

职责：

1. 验证用户登录。
2. 验证账号组归属。
3. 验证账号属于该组。
4. 验证账号类型为 `normal`。
5. 验证账号状态和授权有效期。
6. 刷新 access token。
7. 调用 TikTok creator info。
8. 返回各账号能力、汇总能力和默认设置建议。

并发控制：

```text
每次最多并发 3 个账号
失败账号记录错误，不中断所有请求
```

如果 20 个账号全部获取能力，按每次 3 个并发，用户可接受。后续可做缓存表。

### 9.3 预览接口

路径：

```text
POST /api/publish/multi-task/preview
```

请求：

```json
{
  "account_group_id": "uuid",
  "account_ids": ["uuid"],
  "videos": [
    {
      "id": "local-id",
      "type": "upload",
      "name": "video.mp4",
      "url": "https://...",
      "duration_ms": 30000,
      "cover_timestamp_ms": 0,
      "title": "optional"
    }
  ],
  "title_mode": "template",
  "title_template": "Text {video}",
  "privacy_level": "PUBLIC_TO_EVERYONE",
  "allow_comment": true,
  "allow_duet": false,
  "allow_stitch": true,
  "brand_content_toggle": false,
  "brand_organic_toggle": false,
  "is_ai_generated": true,
  "time_settings": {
    "mode": "fixed_start",
    "start_at": "2026-05-18T12:00:00.000Z",
    "account_interval_minutes": 2,
    "same_account_interval_minutes": 360,
    "jitter_minutes": 0,
    "timezone": "Asia/Shanghai"
  }
}
```

响应：

```json
{
  "success": true,
  "summary": {
    "video_count": 40,
    "account_count": 20,
    "item_count": 40,
    "round_count": 2,
    "starts_at": "2026-05-18T12:00:00.000Z",
    "ends_at": "2026-05-18T18:38:00.000Z"
  },
  "items": [
    {
      "sequence": 1,
      "round": 1,
      "video_id": "v1",
      "video_name": "video-1.mp4",
      "account_id": "a1",
      "account_name": "Account 1",
      "title": "Text 1",
      "scheduled_at": "2026-05-18T12:00:00.000Z",
      "scheduled_at_display": "2026-05-18 20:00"
    }
  ],
  "warnings": []
}
```

预览接口必须和创建接口共用同一个排程函数，避免用户看到的时间和真实创建时间不一致。

预览接口会返回最终生效的发布选项。如果账号组能力导致评论或引用被降级为关闭，必须出现在 `warnings` 里。

### 9.4 创建接口

路径：

```text
POST /api/publish/multi-task/tasks
```

职责：

1. 验证用户登录。
2. 验证请求幂等键。
3. 重新校验账号组、账号、视频 URL、标题、可见范围、互动开关。
4. 重新生成排程，不信任前端预览结果。
5. 写入 `publish_tasks`。
6. 写入 `publish_task_items`。
7. 如果有已到期项，触发一次定时处理。
8. 返回任务组 ID。

请求需要带：

```json
{
  "idempotency_key": "client-generated-key"
}
```

幂等规则：

1. 同一用户、同一个 `idempotency_key` 只能创建一次。
2. 如果重复提交，返回已创建的任务组。
3. 避免用户网络抖动导致重复任务。

## 10. 数据库调整

建议新增迁移：

```text
supabase/migrations/202605xx_tiktok_multi_task_publish.sql
```

### 10.1 publish_tasks 增加字段

```sql
ALTER TABLE publish_tasks
ADD COLUMN IF NOT EXISTS workflow TEXT DEFAULT 'standard',
ADD COLUMN IF NOT EXISTS source_account_group_id UUID REFERENCES tiktok_account_groups(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS plan_config JSONB DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_tasks_user_idempotency
ON publish_tasks(user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_publish_tasks_workflow_created
ON publish_tasks(user_id, workflow, created_at DESC);
```

字段说明：

```text
workflow
  standard: 当前创建发布
  multi_task: 新增多任务发布

source_account_group_id
  来源账号组

plan_config
  保存账号顺序、时间设置、标题模式、随机追加设置、摘要数据

idempotency_key
  防止重复提交
```

### 10.2 publish_task_items 增加字段

```sql
ALTER TABLE publish_task_items
ADD COLUMN IF NOT EXISTS plan_sequence INT,
ADD COLUMN IF NOT EXISTS plan_round INT,
ADD COLUMN IF NOT EXISTS plan_account_position INT,
ADD COLUMN IF NOT EXISTS source_video_name TEXT;

CREATE INDEX IF NOT EXISTS idx_publish_task_items_plan_order
ON publish_task_items(task_id, plan_sequence);
```

字段说明：

```text
plan_sequence
  发布项整体顺序

plan_round
  轮次，从 1 开始

plan_account_position
  账号在当前账号组中的位置，从 1 开始

source_video_name
  原视频文件名，用于任务详情展示
```

### 10.3 状态约束检查

需要确认生产库中 `publish_task_items.status` 已允许：

```text
pending
scheduled
processing
uploading
published
failed
cancelled
```

如果生产库约束缺少 `cancelled` 或 `scheduled`，需要在迁移中更新约束。

## 11. 任务创建逻辑

多任务发布创建时，不使用当前 `/api/publish/tasks` 的创建接口，新增独立接口。

这个边界必须坚持。现有接口服务「创建发布」，新接口服务「多任务发布」。两个接口可以共用底层校验函数、TikTok 发布封装和任务写入辅助函数，但不能让新工作流把复杂参数塞进旧接口，避免影响已上线能力。

任务表不重新造一套。原因：

1. 现有任务管理、任务详情、统计同步都围绕 `publish_tasks` 和 `publish_task_items`。
2. 完全新表会带来两套任务管理和两套统计口径。
3. 更稳的方式是在现有表上增加工作流字段和排程元数据。

但任务创建逻辑必须新写。当前 `/api/publish/tasks` 会生成 `videos × accounts`，它不符合一条视频只对应一个账号的规则。

写入 `publish_tasks`：

```ts
{
  user_id,
  name,
  workflow: 'multi_task',
  source_account_group_id,
  plan_config,
  idempotency_key,
  status: 'scheduled',
  scheduled_at: firstScheduledAt,
  privacy_level,
  allow_comment,
  allow_duet,
  allow_stitch,
  brand_content_toggle,
  brand_organic_toggle,
  is_aigc,
  total_items: items.length,
  pending_count: items.length,
  published_count: 0,
  failed_count: 0
}
```

写入 `publish_task_items`：

```ts
{
  task_id,
  account_id,
  video_url,
  video_source,
  source_asset_id,
  source_video_name,
  title,
  status: 'scheduled',
  scheduled_at,
  cover_timestamp_ms: 0,
  plan_sequence,
  plan_round,
  plan_account_position
}
```

即使用户选择「立即开始」，也写为 `scheduled`。第一条内容的 `scheduled_at` 接近当前时间，定时处理器会立刻捞取。

## 12. 执行器调整

当前执行器中，立即发布模式会查询指定任务所有 `pending` 项，然后按 `scheduled_at` 等待。这个逻辑不适合多任务发布，因为同账号后续内容间隔可能是数小时。

执行器不建议整套推倒重写，但需要拆清楚两层：

```text
调度层：查询到期任务项、锁定、并发控制、更新父任务状态
发布层：刷新账号 token、调用 TikTok Content API、轮询结果、写回 item 状态
```

调度层要按多任务发布重新调整；发布层可以复用现有 TikTok API 调用能力。

多任务发布第一阶段规则：

1. 所有发布项都写 `scheduled`。
2. 定时处理器每分钟拉取已到期项。
3. 每次最多处理一定数量，例如 50 个。
4. 不在请求线程中等待数小时。
5. 任务状态根据剩余项动态展示。
6. 立即发布也只是把第一轮开始时间设为当前时间，不走旧的 immediate 模式。

定时入口必须由服务器外部机制持续触发，例如系统 cron、PM2 定时任务、云服务定时任务或同等能力。不能只依赖创建接口里的后台异步调用；服务器重启后，内存里的异步任务会丢失，只有数据库中的 `scheduled` 项和外部定时入口能保证继续推进。

需要调整：

1. 抽出单条发布函数，供旧任务和多任务发布共用。
2. 定时处理只查询 `status = scheduled` 且 `scheduled_at <= now` 的任务项。
3. 锁定任务项时要带状态条件，避免并发 cron 重复处理。
4. 创建后主动调用一次到期处理，让已经到点的内容尽快执行。
5. `updateTaskFinalStatus` 遇到仍有未来项时，不应长期显示为「执行中」。
6. 任务列表接口增加 `next_scheduled_at` 计算字段。
7. 前端如果任务有已发布项且仍有未来项，展示「排程中」更准确。

建议新增辅助函数：

```ts
getTaskProgressStatus(items)
```

返回：

```text
scheduled      还没有任何项发布，且存在未来项
running        当前有 processing/uploading
scheduled      已有发布成功项，同时存在未来项，但当前没有执行中项
completed      全部成功
partial_failed 有成功也有失败或取消
failed         全部失败
cancelled      全部取消
```

数据库状态可以继续沿用现有值，前端展示层可使用计算后的展示状态。

### 12.1 服务器重启与中断恢复

多任务发布必须把“到点执行”和“执行中恢复”分开处理。

当前已有保障：

1. 还没有到发布时间的任务项保存在数据库中。
2. 服务器重启后，下一次 cron 调用仍能查到已经到点的 `scheduled` 项。
3. 抢占任务项时带状态条件，可以降低多个进程同时处理同一项的风险。

当前必须补齐：

1. 已进入 `processing` 的任务项，如果服务器重启，不能长期卡住。
2. 已进入 `uploading` 且已有 `tiktok_publish_id` 的任务项，恢复后应继续查询 TikTok 状态。
3. 如果请求可能已经发给 TikTok，但本地没有记录 `tiktok_publish_id`，不能自动再次发布，避免同一视频同一账号重复发送。

建议新增字段：

```sql
ALTER TABLE public.publish_task_items
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publish_init_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_status_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publish_attempt_count INTEGER NOT NULL DEFAULT 0;
```

不新增 `review_count`、`active_count`、`confirming_count` 等缓存字段。这些数量由任务列表接口基于任务项状态实时计算，避免任务表继续膨胀。

建议新增索引：

```sql
CREATE INDEX IF NOT EXISTS idx_publish_task_items_active_recovery
  ON public.publish_task_items(status, processing_started_at, last_status_check_at)
  WHERE status IN ('processing', 'uploading');
```

恢复扫描在每次定时处理开始前执行，只限定多任务发布：

```text
processScheduled()
  recoverInterruptedMultiTaskItems()
  queryDueScheduledItems()
  lockDueItems()
  publishLockedItems()
  recomputeParentTaskStatus()
```

恢复规则：

```text
processing + 没有 publish_init_started_at
  说明还没有开始调用 TikTok
  安全恢复为 scheduled

processing + 有 publish_init_started_at + 没有 tiktok_publish_id
  说明结果不确定
  标记为 failed
  error_code = WORKER_INTERRUPTED_NEEDS_REVIEW
  error_message = 服务器中断，无法确认 TikTok 是否已接收，请检查账号后处理

uploading + 有 tiktok_publish_id
  调用 TikTok status/fetch
  成功则改为 published
  TikTok 返回失败则改为 failed 并写入原因
  仍处理中则保留 uploading，等待下一次扫描

published + 父任务状态未汇总
  重新计算父任务状态和计数
```

这里不做用户侧通用重试按钮。系统只做安全自动恢复；一旦存在重复发布风险，就明确标记“需确认”，由用户查看账号后再决定是否重新创建新的任务。

### 12.2 发布结果分类

多任务发布任务项最终分成六类展示：

```text
scheduled   待发，尚未到时间
processing  执行中，正在准备提交到 TikTok
uploading   结果确认中，TikTok 已接收 publish_id，等待最终结果
published   已发布
failed      失败，已有明确原因
cancelled   已停止
```

其中 `failed` 需要通过 `error_code` 再细分：

```text
TOKEN_REFRESH_FAILED              账号授权刷新失败
VIDEO_URL_UNAVAILABLE             视频地址无法访问
TIKTOK_INIT_REJECTED              TikTok 拒绝提交
TIKTOK_STATUS_FAILED              TikTok 返回发布失败
TIKTOK_PROCESSING_TIMEOUT         TikTok 长时间未返回最终结果
WORKER_INTERRUPTED_NEEDS_REVIEW   服务器中断，结果不确定
UNKNOWN_ERROR                     未知错误
```

前端展示时：

1. 普通失败显示为「失败」。
2. `WORKER_INTERRUPTED_NEEDS_REVIEW` 显示为「需确认」。
3. `uploading` 显示为「结果确认中」，不要显示为失败。
4. `TIKTOK_PROCESSING_TIMEOUT` 第一阶段可以先保留为「结果确认中」，由后续扫描继续确认；超过最大确认窗口后再改为失败。
5. 确认窗口建议先设为 24 小时，超过后标记失败并展示 TikTok 长时间未返回最终结果。
6. 查询 TikTok 状态前也要刷新账号 token，避免确认阶段因为 token 过期误判为失败。

## 13. 校验规则

### 13.1 账号校验

服务端必须校验：

1. 用户已登录。
2. 账号组属于当前用户。
3. 账号属于该账号组。
4. 账号 `account_type = normal`。
5. 账号 `status = active`。
6. `token_expires_at > now()`。
7. TikTok creator info 可获取。
8. 请求中的账号顺序不含重复账号。

### 13.2 视频校验

服务端必须校验：

1. 至少 1 条视频。
2. 最多 40 条视频。
3. 每条视频有 HTTPS URL。
4. URL 可访问。
5. 视频格式为 TikTok 支持格式。
6. 视频时长不超过账号组能力汇总中的最小时长。
7. 如果视频来自制作区，必须先转存到稳定 OSS 地址。

### 13.3 标题校验

服务端必须校验：

1. 渲染后的标题不能为空。
2. 标题长度不超过 TikTok 限制。
3. Hashtag 数量不超过现有规则。
4. 统一模板变量必须能正常渲染。
5. 逐条标题数量必须覆盖所有视频。

### 13.4 时间校验

服务端必须校验：

1. 开始时间合法。
2. 指定开始时间不能早于当前时间。
3. 系统安全间隔不能小于 1 分钟。
4. 同账号后续内容间隔不能小于 30 分钟。
5. 随机追加不能超过 30 分钟。
6. 预计完成时间不能超过 30 天后。
7. 生成的时间不能为 `Invalid Date`。
8. 排程项必须按时间升序写入。

### 13.5 内容声明校验

多任务发布第一阶段规则：

1. 可见范围必选。
2. AI 生成默认开启。
3. 商业内容默认关闭。
4. 品牌合作默认关闭。
5. 如果后续开放商业内容设置，品牌合作内容仍不能设置为仅自己可见。

## 14. 主要漏洞与处理方案

### 14.1 Creator Info 因账号差异导致设置不可用

问题：不同账号返回的隐私选项和互动限制可能不同。

处理：

1. 取可见范围交集。
2. 交集为空时禁止创建。
3. 任一账号禁用某互动项，则整体默认关闭。
4. 展示不可用账号清单。

### 14.2 远期任务被立即执行

问题：当前立即发布处理器只等待 30 分钟以内的项目，超过 30 分钟的项目存在错误执行风险。

处理：

1. 多任务发布不使用立即发布处理器。
2. 所有项写 `scheduled`。
3. 只让 cron 拉取到期项。

### 14.3 用户重复点击创建

问题：网络延迟时可能生成重复任务。

处理：

1. 前端生成 `idempotency_key`。
2. 后端唯一索引保护。
3. 重复请求返回已创建任务。

### 14.4 预览后账号组发生变化

问题：用户预览后，另一个页面调整了账号组。

处理：

1. 创建接口重新读取账号组。
2. 如果账号列表和预览不一致，返回 409。
3. 前端提示重新生成预览。

### 14.5 视频 URL 过期

问题：制作区原始结果可能过期。

处理：

1. 选择制作区视频时先转存 OSS。
2. 创建前服务端再次检查 URL。
3. 失败时阻止创建，提示具体视频。

### 14.6 排程进入深夜

问题：连续排程可能排到凌晨。

处理：

1. 预览中明确显示预计完成时间。
2. 如果任一项落在 00:00-06:00，展示提示。
3. 第一阶段允许继续，由用户确认。
4. 后续用多时段安排解决。

### 14.7 账号数量多于视频数量

问题：部分账号不会生成发布项。

处理：

1. 第一阶段直接阻止创建。
2. 提示用户增加视频或调整账号组。
3. 后续如果确实需要，再增加「允许部分账号参与」开关。

### 14.8 视频数量不是账号数量整数倍

问题：前面的账号会多获得 1 条内容。

处理：

1. 按账号组顺序分配。
2. 预览摘要展示每个账号获得数量。
3. 允许用户调整账号排序，进而控制谁获得更多内容。

### 14.9 TikTok API 限流或发布失败

问题：部分发布项失败。

处理：

1. 每个 item 独立状态。
2. 失败项必须保留 `error_code` 和 `error_message`。
3. 任务组展示成功、待发、执行中、结果确认中、失败、需确认数量。
4. 不提供通用发布重试按钮，避免同一视频同一账号重复发送。
5. 对已有 `tiktok_publish_id` 的超时项，系统后台继续确认 TikTok 状态。
6. 对结果不确定的中断项，展示「需确认」，提示用户检查 TikTok 账号后再处理。

### 14.10 多文件上传过载

问题：一次选择大量视频时，如果全部同时直传 OSS，浏览器连接数、用户网络、OSS 签名有效期都可能出问题。

处理：

1. 多任务发布上传组件新写。
2. 前端队列限制并发，建议 3-5 个。
3. 每个文件独立重试和取消。
4. 签名接口一次返回多条签名，减少接口往返。
5. 上传成功后做 URL 和文件状态校验。

### 14.11 视频制作区转存内存压力

问题：当前转存接口会把远程视频读成内存数据，视频较多时可能造成服务端内存压力。

处理：

1. 多任务发布不直接复用旧页面的转存状态。
2. 第一阶段如继续调用现有转存接口，前端并发限制为 1-2 个。
3. 服务端后续应改为流式转存或后台任务。
4. 转存失败的视频不能进入创建接口。

## 15. UI 文案建议

Tab：

```text
创建发布
多任务发布
任务管理
```

页面标题：

```text
多任务发布
```

分配方式：

```text
顺序轮换
随机均衡
```

说明：

```text
多条内容按顺序分配给账号组内账号。同一账号的下一条内容会按间隔自动排开。
```

账号组提示：

```text
选择一个账号组，系统会根据视频数量和账号数量自动生成发布项。
```

时间提示：

```text
同一轮账号会使用系统安全间隔自动错开。
同账号后续内容间隔用于错开同一账号的下一条内容。
```

预览摘要：

```text
本次将生成 40 个发布项，覆盖 20 个账号。每个账号获得 2 条内容。
```

深夜提示：

```text
部分内容将安排在 00:00-06:00，建议确认是否符合你的运营节奏。
```

创建按钮：

```text
创建任务组
```

### 15.1 单任务组卡与多任务组卡的差异

任务管理入口可以继续放在同一个页面，但卡片展示必须区分 `workflow`。

单任务组卡继续服务当前「创建发布」：

```text
任务名称
状态
发布成功数
播放量
点赞数
计划时间或创建时间
查看详情
停止待发
删除记录
```

单任务组卡的重点是“这一组任务最终带来的数据表现”，所以播放量、点赞数可以放在主视觉区域。

多任务组卡服务「多任务发布」：

```text
任务名称
多任务标识
账号组名称
整体状态
总数
已发布
待发
执行中
结果确认中
失败
需确认
下一条时间
预计完成时间
查看明细
停止待发
删除记录
```

多任务组卡的重点是“排程是否还在推进、有没有异常项”，所以主视觉区域优先放进度和状态计数，不优先放播放量、点赞数。

建议多任务组卡布局：

```text
顶部：
  任务名称 + 多任务标识 + 状态
  账号组名称

中部：
  已完成 X / 总数 Y
  分段进度条：已发布、结果确认中、失败、需确认、待发

统计：
  已发布
  待发
  执行中
  失败
  需确认

底部：
  下一条：05-23 20:00
  预计完成：05-24 02:38
  查看明细
```

展示约束：

1. 主视觉最多常驻三类数字：总数、已发布、待发。
2. 执行中、结果确认中、失败、需确认只有数量大于 0 时展示。
3. 播放量和点赞数不放在多任务卡主区域，可在全部完成后进入详情查看。
4. 卡片不增加复杂操作，只保留查看明细、停止待发、删除记录。

状态展示规则：

以下数量都由任务列表接口从任务项实时计算，不落新字段：

```text
如果 review_count > 0
  卡片状态显示「需确认」

否则如果 active_count > 0
  卡片状态显示「执行中」

否则如果 confirming_count > 0
  卡片状态显示「结果确认中」

否则如果 scheduled_count > 0 且 published_count > 0
  卡片状态显示「排程中」

否则如果 scheduled_count > 0
  卡片状态显示「待发」

否则如果 failed_count > 0 且 published_count > 0
  卡片状态显示「部分失败」

否则按 completed / failed / cancelled 展示
```

多任务组卡不展示通用重试按钮。失败项通过详情页展示原因；结果不确定项展示为「需确认」，提示用户检查 TikTok 账号后再处理。

### 15.2 多任务详情页

多任务详情页需要比单任务详情页多展示排程信息。

顶部统计：

```text
总数
已发布
待发
执行中
结果确认中
失败
需确认
```

筛选项：

```text
全部
待发
执行中
结果确认中
已发布
失败
需确认
已停止
```

任务项展示：

```text
视频缩略图
视频名称
标题
账号
轮次
计划时间
状态
失败原因或确认提示
```

失败提示示例：

```text
账号授权已失效，请重新绑定后重新创建相关任务。
视频地址无法被 TikTok 访问，请检查 OSS 域名与文件权限。
TikTok 拒绝提交：{TikTok 返回原因}
TikTok 仍在处理，系统会继续确认结果。
服务器中断，无法确认 TikTok 是否已接收，请检查账号后处理。
```

详情页可以保留“停止待发”，但只作用于 `scheduled` 项，不影响 `processing`、`uploading` 和 `published`。

## 16. 代码实施步骤

### 开工前确认事项

正式开发前需要先确认以下信息，避免做到最后才发现环境或数据不完整。

需要产品或运维侧配合确认：

1. 测试数据库环境：确认本地 `.env` 是否已经指向测试 Supabase，或提供测试 Supabase 的项目地址、匿名 key、服务端 key 的配置方式。
2. 迁移执行方式：确认数据库迁移是在本地 CLI 执行，还是由你们在测试库后台执行 SQL。
3. TikTok 沙盒应用配置：提供沙盒 client key、client secret、redirect URI、必要 scope，以及本地回调域名配置方式。
4. 测试账号：当前只有 1 个可用 TikTok 账号也可以启动开发；真实发布验收先按 1 个账号做，多账号分配先用测试库数据和脚本验证。
5. 测试账号组：如果只有 1 个真实账号，先创建 1 个账号的真实测试组；另用测试库脚本准备多账号数据做预览、排程、任务写入验证。
6. 测试视频：准备 3 条短视频用于真实小流量验证；20-40 条轻量视频可由脚本生成，用于上传队列和排程预览验证。
7. OSS 测试配置：确认测试环境的 OSS 域名仍在 TikTok URL 白名单内，且本地环境变量可生成签名上传 URL。
8. 定时处理入口：确认测试环境可手动调用 `/api/publish/process-scheduled`，或提供测试用 `CRON_SECRET`。
9. 验收口径：确认第一阶段只验收立即发布、定时发布、顺序轮换、随机均衡、默认首帧、默认发布选项。

本地环境需要：

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
TIKTOK_CLIENT_KEY
TIKTOK_CLIENT_SECRET
TIKTOK_REDIRECT_URI
ALIYUN_OSS_REGION
ALIYUN_OSS_ACCESS_KEY_ID
ALIYUN_OSS_ACCESS_KEY_SECRET
ALIYUN_OSS_BUCKET
ALIYUN_OSS_ENDPOINT
ALIYUN_OSS_CUSTOM_DOMAIN
CRON_SECRET
```

测试环境如需使用脚本账号跑通多账号能力检查和模拟发布，可临时开启服务端 TikTok mock：

```text
TIKTOK_TEST_MOCK_MODE=true
TIKTOK_TEST_MOCK_ALLOWED_SUPABASE_PROJECTS=wjfgusdwudsynbsyveoe
```

注意：这个开关只用于测试库验证脚本账号。正式发布验收、正式库、正式部署都必须删除或关闭 `TIKTOK_TEST_MOCK_MODE`，并使用真实 TikTok 授权账号。

如果 AI 标题推荐在本地联调，需要补充对应模型服务的环境变量；如果暂时不联调 AI，可先用占位响应验证页面流程。

数据库验证必须提前做：

1. 先在测试数据库执行迁移。
2. 确认 `publish_tasks` 新字段存在。
3. 确认 `publish_task_items` 新字段存在。
4. 确认 `scheduled`、`cancelled` 等状态约束可用。
5. 确认幂等索引生效。
6. 确认 RLS 不影响当前用户读取自己创建的任务组和任务项。
7. 测试库通过后，才进入本地页面联调。

本地验收顺序：

```text
数据库迁移验证
API 单项验证
本地页面预览
小账号组创建任务组
手动触发到期处理
任务管理查看结果
旧创建发布回归
```

真实账号不足时的验证分层：

1. 纯逻辑验证：用单元测试和脚本验证 20 个账号、40 条视频的分配、排程、标题和幂等。
2. 测试库验证：在测试库写入多账号测试数据，只验证预览、任务写入、任务管理展示，不触发真实 TikTok 发布。
3. 真实发布验证：只使用真实授权账号，先验证 1 个账号、3 条视频的立即发布和定时发布。
4. 多真实账号验证：等有 2 个及以上真实账号后，再验收真实多账号发布。

本轮确认后的执行口径：

1. 测试库已有历史发布任务，不清理、不覆盖；新功能通过 `workflow = multi_task` 和任务名称前缀区分。
2. 测试库先执行迁移和验证，正式库暂不迁移。
3. 真实 TikTok 账号当前按 1 个账号验证真实发布。
4. 多账号场景先用测试库脚本生成账号组和账号数据，只做逻辑、预览、写入、展示验证。
5. 真实测试视频由桌面文件夹提供：`/Users/shaonian/Desktop/测试的视频`，当前已存在 6 条 mp4。
6. 测试库允许先执行迁移 SQL，正式库先不动。
7. 本地 OAuth 回调优先使用临时公网地址；需要联调时生成地址并添加到 TikTok 沙盒 Redirect URI。
8. 如果需要走阿里云服务器转发，需要额外确认服务器访问权限和反代配置。

### 第一步：新增共享排程函数

文件：

```text
src/lib/publish/multi-task-scheduler.ts
```

导出：

```ts
export function assignVideosToAccounts(input): Assignment[]
export function buildSchedulePreview(input): SchedulePreview
export function validateTimeSettings(input): ValidationResult
export function renderTitle(input): string
```

该文件必须有单元测试。

### 第二步：新增数据库迁移

文件：

```text
supabase/migrations/202605xx_tiktok_multi_task_publish.sql
```

加入任务元数据字段、发布项排序字段和索引。

### 第三步：新增 API

新增：

```text
src/app/api/publish/multi-task/upload-credentials/route.ts
src/app/api/publish/multi-task/creator-capabilities/route.ts
src/app/api/publish/multi-task/preview/route.ts
src/app/api/publish/multi-task/tasks/route.ts
```

如果视频制作区存在非稳定 OSS 地址，另增：

```text
src/app/api/publish/multi-task/asset-transfer/route.ts
```

该接口需要避免一次性把大量视频读入内存，第一阶段至少要限制并发。

### 第四步：新增前端组件

新增：

```text
src/components/publish/multi-task/MultiTaskPublisher.tsx
```

先用一个独立组件承载多任务表单，避免继续扩大 `publish/page.tsx`。只有当单文件明显难以维护时，再按视频、标题、时间、预览拆出小组件。

上传模块重点：

1. 多任务组件独立维护文件队列。
2. 不使用旧创建页的 `uploadingFiles` 状态。
3. 不使用全量同时上传。
4. 支持上传失败后重新上传、取消和继续添加视频。

### 第五步：接入 `/publish` Tab

修改：

```text
src/app/(main)/publish/page.tsx
```

只做：

1. `TabType` 增加 `multiTask`。
2. Tab 配置增加「多任务发布」。
3. 渲染 `MultiTaskPublisher`。

当前「创建发布」代码不做大改。

### 第六步：任务管理兼容

修改：

```text
src/app/api/publish/tasks/route.ts
src/components/publish/TaskGroupCard.tsx
src/components/publish/TaskGroupDetail.tsx
src/components/publish/TaskItemCard.tsx
```

目标：

1. 列表展示 `workflow`。
2. 多任务发布任务展示账号组名称。
3. 详情按 `plan_sequence` 排序。
4. 展示轮次和账号位置。
5. 单任务组卡继续展示发布效果数据。
6. 多任务组卡展示总数、已发布、待发、执行中、结果确认中、失败、需确认。
7. 多任务详情支持按「结果确认中」「需确认」筛选。
8. 失败项展示直接原因，不提供通用发布重试按钮。
9. 修正「停止待发」接口路径。

### 第七步：执行器调整

修改：

```text
src/lib/publish-processor.ts
src/lib/publish/publish-item-runner.ts
src/lib/publish/due-item-processor.ts
```

目标：

1. 抽出单条发布能力。
2. 定时模式只处理到期项。
3. 不锁定未来项。
4. 立即发布不再等待未来时间。
5. 定时处理前先恢复中断任务项。
6. `processing` 写入开始时间和尝试次数。
7. 调 TikTok 前写入提交开始时间。
8. `uploading` 有 `tiktok_publish_id` 时可继续查询 TikTok 状态。
9. 结果不确定的中断项标记为「需确认」，不自动再次发送。
10. 完成后重新计算父任务展示状态。
6. 保持旧「创建发布」行为不被破坏。

### 第八步：文案检查

新增页面与组件完成后，运行文案扫描，确保页面可见文案符合命名规则。

建议脚本：

```bash
rg -n "待检查词" src/app/(main)/publish src/components/publish docs
```

实际检查词由产品侧维护，不写死在代码里。

## 17. 测试方案

### 17.1 排程函数测试

测试用例：

1. 40 条视频、20 个账号，每个账号 2 条。
2. 45 条视频、20 个账号，前 5 个账号 3 条，其余 2 条。
3. 10 条视频、20 个账号，返回校验错误。
4. 系统安全间隔 2 分钟，同账号后续内容间隔 6 小时。
5. 随机追加开启后不早于开始时间。
6. 随机追加开启后同账号后续内容间隔不小于设定值。
7. 开始时间非法时返回错误。

### 17.2 API 测试

测试用例：

1. 未登录返回 401。
2. 账号组不属于用户返回 404。
3. 账号过期返回 400。
4. creator info 失败返回账号级错误。
5. 标题为空返回 400。
6. 视频 URL 非 HTTPS 返回 400。
7. 重复 `idempotency_key` 不重复创建。
8. 预览结果和创建结果一致。
9. 上传签名接口一次返回多条签名。
10. 创建接口不接受重复视频 URL。
11. 评论或引用被账号能力限制时，预览返回降级提示。

### 17.3 前端测试

测试用例：

1. Tab 顺序正确。
2. 选择账号组后显示账号能力汇总。
3. 上传 40 条视频后展示 40 条。
4. 上传 40 条视频时不会全量同时上传。
5. 单个视频上传失败后可以重试，不影响已成功视频。
6. 40 条视频、20 账号预览为 40 个发布项。
7. 修改同账号后续内容间隔后第二轮时间变化。
8. 开启随机追加后预览时间变化。
9. 深夜发布项出现提示。
10. 创建成功后跳转到任务管理。

### 17.4 线上前验证

使用测试账号组：

```text
2 个账号
3 条短视频
系统安全间隔 2 分钟
同账号后续内容间隔 10 分钟
```

预期：

```text
账号 1 视频 1
账号 2 视频 2
账号 1 视频 3
```

观察：

1. 任务创建成功。
2. 第一条到期后可执行。
3. 第二条按时间执行。
4. 第三条不会提前执行。
5. 任务管理状态准确。

### 17.5 数据库测试环境验证

所有数据库相关改动先在测试库验证，不直接上生产库。

验证项：

1. 迁移可重复执行，不因字段已存在报错。
2. `workflow` 字段能区分 `standard` 和 `multi_task`。
3. `source_account_group_id` 能正确关联账号组。
4. `plan_config` 能保存账号顺序、时间设置、默认发布选项和摘要。
5. `idempotency_key` 唯一索引能阻止重复创建。
6. `plan_sequence`、`plan_round`、`plan_account_position` 能正确写入。
7. 测试用户只能读取自己的任务和任务项。
8. 旧「创建发布」任务仍能正常读取和展示。

建议验证 SQL：

```sql
select column_name
from information_schema.columns
where table_name = 'publish_tasks'
  and column_name in ('workflow', 'source_account_group_id', 'plan_config', 'idempotency_key');

select column_name
from information_schema.columns
where table_name = 'publish_task_items'
  and column_name in ('plan_sequence', 'plan_round', 'plan_account_position', 'source_video_name');
```

如果真实 TikTok 账号不足，可以在测试库用脚本生成仅用于逻辑验证的账号组数据。

要求：

1. 脚本生成的数据只能存在测试库。
2. 这些账号不能触发真实发布。
3. 仅用于验证账号组读取、能力汇总模拟、排程预览、任务写入和任务管理展示。
4. 所有真实发布测试必须使用真实授权账号。

建议脚本：

```text
scripts/dev/seed-multi-task-test-data.ts
```

脚本职责：

1. 创建或复用测试用户下的账号组。
2. 生成 2、5、20 个账号规模的测试数据。
3. 生成 3、20、40 条视频元数据。
4. 不写入真实 access token。
5. 标记为测试数据，方便清理。

### 17.6 本地页面预览验收

开发完成后必须本地拉起页面做预览，再进入正式验收。

本地预览步骤：

1. 启动本地服务。
2. 打开 `/publish`。
3. 确认 Tab 顺序为「创建发布 | 多任务发布 | 任务管理」。
4. 上传 3 条短视频，确认队列、进度、上传失败后的重新上传、取消都正常。
5. 选择测试账号组，确认能力汇总和默认发布选项正常。
6. 填写每条标题，确认逐行内容和 AI 推荐入口不破坏输入。
7. 选择立即发布和定时发布，确认预览时间正确。
8. 创建任务组后进入任务管理，确认任务项、账号、标题、时间一致。
9. 回到「创建发布」做一次旧功能回归。

验收前需要保留：

```text
数据库验证截图或 SQL 输出
API 测试结果
本地页面截图
任务管理截图
旧创建发布回归结果
```

## 18. 上线检查

上线前必须确认：

1. 数据库迁移已在测试库验证通过。
2. 阿里云 cron 已存在，并调用 `/api/publish/process-scheduled`。
3. `CRON_SECRET` 与服务器 crontab 一致。
4. PM2 应用已重启。
5. TikTok OAuth 回调域名正确。
6. OSS 加速域名仍在 TikTok URL 白名单内。
7. 新增 Tab 在移动端不挤压。
8. 新增页面文案符合产品命名规则。
9. 旧「创建发布」功能仍能创建并发布。
10. 任务管理能展示旧任务和新任务。
11. 本地页面预览已完成。
12. 测试账号组验证通过。

## 19. 推荐第一阶段默认参数

```text
视频上限：40
账号组上限：20
默认分配方式：顺序轮换
同一轮账号错开：2 分钟，系统默认
默认同账号后续内容间隔：6 小时
默认随机追加：关闭
默认归档：按任务组归档
评论权限：默认允许
合拍功能：默认关闭
引用功能：默认开启
商业内容：默认关闭
品牌合作：默认关闭
AI 标识：默认开启
封面：默认首帧
可见范围：用户确认后才能创建
```

## 20. 后续增强

第二阶段：

1. 支持多时段安排。
2. 支持多个账号组。
3. 支持手动调整账号顺序。
4. 支持导出排程表。
5. 支持对「需确认」项提供更完整的人工处理流程。

第三阶段：

1. 支持基于账号历史表现推荐时间。
2. 支持不同账号使用不同标题模板。
3. 支持账号健康度评分。
4. 支持内容去重提示。
5. 支持按地区或语言拆分账号组。

## 21. 最终建议

第一阶段建议做「顺序轮换」和「随机均衡」，默认使用「顺序轮换」。这两种方式都符合 40 条视频到 20 个账号的真实运营逻辑，也能最大程度复用现有账号组、任务表和发布处理器。

关键不是让功能看起来复杂，而是让用户在提交前清楚知道：

```text
哪条视频
发到哪个账号
什么时间发布
为什么这样安排
预计何时完成
```

只要这个预览做清楚，多任务发布就会比竞品更可控，也更适合当前系统的 TikTok Content API 能力。

## 22. 本轮执行状态

已完成：

1. 新增测试库迁移文件：`supabase/migrations/20260518_tiktok_multi_task_publish.sql`。
2. 新增迁移执行脚本：`scripts/apply-supabase-migration.js`，支持 `TEST_DATABASE_URL` 直连测试库执行。
3. 新增测试数据脚本：`scripts/dev/seed-multi-task-test-data.js`。
4. 已确认 `TEST_DATABASE_URL` 可连接目标测试库，并通过 `node scripts/apply-supabase-migration.js` 执行迁移。
5. 测试库验证通过：`publish_tasks` 已具备工作流、账号组、计划配置、幂等键、任务计数字段；`publish_task_items` 已具备计划顺序、轮次、账号位置、源视频、去重键、封面时间和统计字段。
6. 已发现 `.env.local` 中 Supabase URL/service key 与 `TEST_DATABASE_URL` 不是同一个项目；后续测试数据统一使用 `TEST_DATABASE_URL` 直连目标测试库，避免写入非目标库。
7. 已清理一次由 service key 写入的脚本测试账号和测试分组。
8. 已在目标测试库生成 `mt-test-3`，包含 3 个脚本账号，仅用于 UI 与排程检查。
9. 新增独立前端组件、独立上传凭证接口、独立预览接口、独立创建接口、独立排程函数。
10. 已上传 3 条桌面测试视频到 OSS 测试前缀，并写入一个未来时间的测试任务组，验证一条视频只对应一个账号。
11. 已完成类型检查，重点 lint 无错误。
12. 已拉起本地服务：`npm run dev:demo`，本地地址为 `http://localhost:3000/publish`。
13. 本地页面预览通过：Tab 顺序为「创建发布 | 多任务发布 | 任务管理」，多任务表单可见，包含上传视频、选择账号分组、标题、发布设置、计划预览和创建任务入口；任务管理 Tab 可正常渲染筛选和空状态。
14. 已修正 TikTok 发布页中历史文案里的禁用字命中，以及一处旧 JSX 引号 lint 错误。
15. 已重新扫描多任务相关文件、执行方案文件和 TikTok 发布页，未发现禁用字命中。
16. 40 条视频到 20 个账号的调度抽检通过：每个账号 2 条，同一轮不同账号默认错开 2 分钟，同账号下一轮默认间隔 6 小时，随机追加默认关闭。
17. 目标测试库验证通过：6 个索引存在；最新验证任务 `mt validation 3 videos` 为 `workflow=multi_task`，3 个任务项分别对应 3 条源视频、3 个账号、3 个去重键，封面时间为 0。
18. 已完成复查前 6 项修正：执行器先锁定再处理；测试数据脚本只认 `TEST_DATABASE_URL`；OSS 上传签名按单个视频临近上传时获取；文件后缀和 MIME 双校验；默认排程参数统一；创建接口要求预览令牌。
19. 已完成第 7、8 项修正：AI 写标题、逐行快速插入、按文件名插入都只作用于已上传完成且会进入创建的视频，并按视频 ID 写回，避免上传失败、删除或上传中状态造成标题错位。

当前验证结果：

1. `npm run type-check`：通过。
2. 重点文件 ESLint：0 个错误，仅保留存量 warning。
3. `npm run lint -- --quiet`：仍有存量错误，位置在 landing、link-video、pro-studio、theme-lab、viral-clone、design-system、ScheduledQueue、TemplateManager、ecom-image 等非本轮核心文件；TikTok 发布页错误已处理。
4. 本地桌面预览：通过，干净端口 `http://localhost:3001/publish` 已确认多任务页可见，默认同账号间隔为 6 小时，随机追加开关为关闭，创建任务按钮在未生成预览前不可用。
5. 窄屏预览：发现后台全局左侧导航在小宽度下仍保持固定宽度，会挤压主内容；这属于现有全局布局问题，第一阶段验收建议以桌面后台为准。

仍需最终确认：

1. `.env.local` 的 Supabase URL/service key 与 `TEST_DATABASE_URL` 不是同一个项目。若要用浏览器点击创建并写入目标测试库，需要把本地 Supabase URL、anon key、service role key 临时切到目标测试库，或增加明确的测试运行配置。
2. 真实 TikTok 沙盒账号目前只有 1 个；本轮已用脚本账号验证分配和入库，真实多账号发布仍需等账号准备好后再跑。
3. 正式库未执行迁移，后续上线前需要单独确认迁移步骤。
