# 超级画布 P1 加速上线执行方案

> 状态：`PHASE_4_COMPLETE_OFFLINE_GREEN`
>
> 版本：2026-07-27 v1
>
> 权威工作树：`E:\StarGaze\.claude\worktrees\canvas-p1-generation`
>
> 权威分支：`claude/canvas-p1-generation`
>
> 制定时 HEAD：`8bb58dba12d38f3984ba8d07935325bd1c09ea4d`
>
> 用户已于 2026-07-27 发出“开工”通知。当前按本文件从 Phase 1 开始执行。

## 一、目标与当前结论

目标是在不搭建本地 PostgreSQL、不接触生产数据库的前提下，尽快完成超级画布 P1 的数据库实测、旧调用点改造、Preview 全流程验收和上线准备。

当前阶段判断：

- P0 的 D1-D6、S1-S8 工程主体已在画布集成分支内完成；R1/R2 真人与性能验收仍未正式关闭。
- P1 Batch 2 已形成数据库迁移、远程安全闸门和 77 个可执行场景；旧 post-apply 候选曾在 Preview 真实 `77/77` 通过，但 Group B 新增 task-scoped 身份后的当前候选尚未在线重跑，当前候选运行证据仍为 `0/77`。
- 方案创建前工作树有 14 个已跟踪修改、32 个未跟踪文件；加入本方案文件后应为 14 个已跟踪修改、33 个未跟踪文件，尚未形成提交。
- 当前两个离线红灯已证明是 CRLF 换行问题：
  - Batch 2 当前 `330/331`；冻结目录文件恢复 LF 后 SHA-256 与已接受值完全一致。
  - 视频合约当前 `598/599`；源码换行归一后目标断言完全匹配。
- 生成意图当前 `122/122`，TypeScript 当前通过。
- 调用点原始冻结清单为 39 项；Phase 4 前两小批后为 35 个活跃写调用点 + 2 个精确哈希 410 退役墓碑 + 2 个触发器初始化入口。原始 16 个 `legacy_generation_lifecycle_only` 中，C 组复核发现 slideshow、models submit、models status 是共享视频积分 helper 的隐藏消费者，三者已重分类并转换，因此真正保留为 lifecycle-only 的路径是 13 个：
  - 18 项 `batch3_convert_to_shared_boundary`
  - 原标记 16 项 `legacy_generation_lifecycle_only`，最终 13 项保持 lifecycle-only、3 项重分类并转换
  - 2 项 `batch3_make_unreachable` 已转为 `retired_unreachable`
  - 2 项 `batch3_convert_profile_init` 已转为 `converted_profile_init_to_auth_trigger`
  - 1 项 `batch3_convert_to_deactivation`

## 二、不可违反的边界

### 2.1 数据库边界

- **禁止搭建、修复或使用本地 PostgreSQL 做本任务的数据库验证。**
- 唯一允许的数据库测试目标是 Supabase 专用 Preview Branch：
  - 名称：`canvas-p1-staging`
  - ref：`liibsugstuidwlmliyif`
- 执行前必须重新确认该 Preview Branch 仍存在、Healthy、无生产数据且身份完全匹配。
- 生产 ref `hfabrifuvujpdzarlbky` 始终硬拒绝；任何生产引用、重定向或身份歧义都必须在数据库连接前停止。
- 不得复制生产数据到 Preview Branch。
- 不得删除、重置或合并 Preview Branch，除非用户另行明确授权。
- 不得访问其他数据库、其他 Supabase 项目或其他分支。

### 2.2 外部动作边界

用户发出“开工”通知后，视为授权：

- 在权威 P1 工作树内进行本方案规定的本地代码修改和离线验证。
- 对精确匹配的 `canvas-p1-staging` Preview Branch 执行本方案规定的只读检查、五个锁定迁移和测试数据写入。

以下动作即使已经开工，仍须单独取得用户明确授权：

- 生产数据库迁移或任何生产写入。
- 合并、推送或部署到生产。
- 真实付费模型/供应商调用。
- 删除或重置 Preview Branch。
- 扩大到本方案未列出的外部系统。

### 2.3 仓库边界

- 不得把 `.claude/`、凭据、连接串、证书、原始数据库目录数据或临时运行产物提交进 Git。
- 不得覆盖用户已有未提交修改。
- 不得使用破坏性 Git 操作。
- 所有改动必须按阶段拆分，可审查、可回滚。
- 生产价目、供应商行为和现有模型能力不得在本任务中顺手修改。

## 三、开始前固定动作

收到用户“开工”通知后，执行窗口必须先完成以下动作：

- [x] 从头到尾阅读本文件。
- [x] 确认当前目录为权威 P1 工作树。
- [x] 记录当前分支、HEAD、`git status --short --branch` 和完整未跟踪文件清单。
- [x] 将当前未提交改动保存为可恢复的补丁/清单，但不得把敏感信息写入补丁。
- [x] 对比本文件《当前执行检查点》，确认没有其他窗口已经推进状态。
- [x] 若 HEAD 或文件范围与记录不一致，先查明来源，不得直接继续。

## 四、执行阶段

### Phase 1：恢复离线绿色基线

目标：只修机械性换行问题，不改变业务行为。

- [x] 将 `scripts/fixtures/canvas-p1/expected-catalog.json` 恢复为已接受的 LF 原始字节。
- [x] 原始 SHA-256 必须等于：
  `60747532147a5be8f8593661275c39977ff09b9344c397827f9cceffa8b3b93d`
- [x] 为冻结目录证据增加窄范围 LF 约束，防止 Windows 再次改写。
- [x] 让视频合约验证器在读取源码时统一 CRLF/LF，避免对平台换行敏感。
- [x] 不得通过删断言、放宽目录比较或接受新哈希来“修绿”。
- [x] 重跑 Batch 2、生成意图、视频合约、TypeScript、Node 语法和 diff-check。

Phase 1 退出条件：

- [x] Batch 2 恢复到完整预期计数，目标 `350/350`。
- [x] 视频合约 `599/599`。
- [x] 生成意图 `122/122`。
- [x] TypeScript、Node 语法、diff-check 全部通过。
- [x] 数据库执行仍为 `0/77`，且没有发生任何网络或数据库连接。

### Phase 2：基于当前 HEAD 重建可信静态基线

目标：消除旧 `459e5d44` 基线与当前 `8bb58dba` 工作树之间的漂移风险。

- [x] 在当前工作树重新执行调用点扫描。
- [x] 将扫描结果与现有 39 项逐条比较。
- [x] 新增或消失项必须人工判定；不得自动覆盖冻结白名单。
- [x] 确认实际分类仍为 `18 + 16 + 2 + 2 + 1 = 39`，或记录经审查后的新事实。
- [x] 重新核验所有锁定文件哈希和敏感信息扫描。
- [x] 复核五个迁移、远程目标锁、写入闸门、77 个场景和并发会话实现。
- [x] 使用已有证据或 Preview Branch 只读探针补齐 pre-apply `trigger_functions`；不得猜测。
- [x] 裁定 `handle_new_user` owner 等尚属推断的字段。

Phase 2 退出条件：

- [x] 没有未关闭的静态 P0/P1 阻断项。
- [x] pre-apply 清单完整，不含必需字段的 `__UNPROVEN__`。
- [x] 一次集中式 Codex 审查和一次独立只读审查均通过。
- [x] 形成远程测试前的固定文件哈希清单。

### Phase 3：线上 Preview Branch 一次完成数据库证据与 77 场景

目标：不使用本地数据库，在现有线上专用测试库完成真实 PostgreSQL 验证。

#### Phase 3A：远程只读身份与基线检查

- [x] 确认 Preview Branch 仍存在且 Healthy。
- [x] 精确确认 ref、主机、端口、数据库、用户、PostgreSQL 版本和 TLS 证书。
- [x] 拒绝所有 libpq 环境间接寻址和主机重定向。
- [x] 确认生产 ref 未出现。
- [x] 在服务端强制 READ ONLY 事务中运行封闭白名单探针。
- [x] 精确比较冻结 pre-apply 清单。
- [x] 确认目标测试表无不应存在的业务/生产数据。

任一身份、目录或零数据检查不匹配，必须在首次写入前停止。

#### Phase 3B：首次应用与真实清单采集

post-apply/reapply 清单只有真实 PostgreSQL 执行后才能得到，禁止伪造。采用一次性、受限的证据采集路径：

- [x] 该路径只能在 Phase 3A 全绿后启用。
- [x] 只能执行五个固定路径、固定 SHA-256 的迁移文件。
- [x] 不接受调用者传入任意 SQL。
- [x] 第一次应用迁移。
- [x] 立即采集完整 post-apply 清单。
- [x] 再次应用相同迁移。
- [x] 采集完整 reapply 清单。
- [x] 比较 post-apply 与 reapply，证明确定性和幂等。
- [x] 停止普通业务场景写入，先把两份真实清单带回审阅。

#### Phase 3C：冻结证据并从 post-apply 状态恢复验证

- [x] 人工审阅采集到的清单。
- [x] 将真实 post-apply/reapply 清单写入冻结证据。
- [x] 不允许任何 `__UNPROVEN__` 被当作通配符。
- [x] 使用显式的“当前已是 post-apply”恢复门：当前目录必须精确匹配冻结 post-apply，才允许继续。
- [x] 再次重放锁定迁移并证明目录不变。
- [x] 运行全部 77 个数据库场景。
- [x] 清理本任务产生的测试行；不得删除或重置 Preview Branch。
- [x] 保存完整执行计数、失败详情和前后目录指纹。

Phase 3 退出条件：

- [x] 77/77 场景真实执行并通过。
- [x] 首次应用、reapply 和恢复重放均通过。
- [x] post-apply/reapply 目录完全一致。
- [x] 积分扣除、退款、重放、并发、租约、围栏、注册初始化和恢复路径全部通过。
- [x] 生产零接触，Preview Branch 身份始终不变。

### Phase 4：只改造真正阻塞上线的 23 个调用点

39 个发现项最初含 16 个 `legacy_generation_lifecycle_only`；C 组证明其中 3 个是隐藏积分消费者并已纳入共享边界，最终 13 个真正 lifecycle-only 入口不做无意义重构，只保留守卫。真正需要改代码的 23 个发布阻断项已全部关闭。

按以下顺序拆分：

1. **先封安全洞**
   - [x] 2 个 `batch3_make_unreachable` deduct/refund 路由下线或彻底封死。
2. **统一注册初始化**
   - [x] 浏览器注册页不得直接创建带积分 profile。
   - [x] SMS 注册不得直接写入初始积分。
3. **统一积分原子边界**
   - [x] 18 个余额/流水入口迁移到共享原子边界。
   - [x] 每个入口使用稳定、服务端派生的 operation anchor。
   - [x] 不改变原有价格和供应商行为。
4. **账户停用**
   - [x] 1 个硬删除入口改为可审计停用/匿名化路径。
5. **旧生命周期守卫**
   - [x] 复核最终 13 个 legacy-only 入口确实不写积分；原 16 项中的 3 个隐藏消费者已重分类并转换。
   - [x] 保持扫描守卫，防止以后增加积分操作。

每个子批次退出条件：

- [x] 调用点扫描与冻结清单差异已人工裁决。
- [x] 相关原子性、授权、幂等和回归测试通过。
- [x] Batch 2、生成意图、视频合约和 TypeScript 不退化。
- [x] 独立可审查提交边界已经形成，但未经授权不得推送。

### Phase 5：Preview 应用中合并完成 P0/P1 验收

为节省时间，不再另开一轮重复 P0 验收；在 Preview 应用里一次完成：

- [ ] 1366×768 画布完整流程。
- [ ] 创建、编辑、刷新自动保存。
- [ ] 断网 30 秒后恢复补存。
- [ ] 双标签单写者锁和只读横幅。
- [ ] 坏节点/坏文档降级，不白屏。
- [ ] undo/redo。
- [ ] 100 节点保存、200 节点帧率、30 视频 poster 内存预算。
- [ ] 上传商品图。
- [ ] 图片节点真实生成。
- [ ] 图生视频真实生成。
- [ ] 下载结果。
- [ ] TikTok 测试账号直发与 AIGC 标注。
- [ ] 预估积分与真实扣费逐项一致。
- [ ] 提交后关闭标签再打开，任务状态正确恢复。
- [ ] 上游失败只产生一次退款。
- [ ] 连续点击只产生一个任务和一次扣费。

真实付费供应商调用仍须用户另行授权，并限制为最小验收样本。

Phase 5 退出条件：

- [ ] P0 R1/R2 关闭。
- [ ] P1 黄金旅程在 Preview 环境真实走通。
- [ ] 当日测试积分对账差异为 0。
- [ ] 没有未关闭的 P0/P1 缺陷。

### Phase 6：集成与生产上线准备

- [ ] 按换行修复、数据库底座、Batch 3 子批次、验收修复拆分提交。
- [ ] 同步最新 `main`，审查全部冲突。
- [ ] 跑完整 TypeScript、构建、P0/P1 门禁和 Preview 回归。
- [ ] 确认 `.claude/`、凭据、证书、数据库输出和临时产物均未进入提交。
- [ ] 准备生产迁移检查表、回滚方案和上线观察指标。
- [ ] 等待用户对生产迁移、推送、合并和部署的单独授权。
- [ ] 上线稳定后，再等待用户决定是否删除 Preview Branch以停止计费。

## 五、最快关键路径

严格顺序：

1. Phase 1 修复机械红灯。
2. Phase 2 一次集中静态复审。
3. Phase 3 线上 Preview 一次完成数据库证据和 77 场景。
4. Phase 4 只改 23 个真正阻塞项。
5. Phase 5 合并完成 P0/P1 Preview 验收。
6. Phase 6 等待生产授权并上线。

不再投入时间建设本地 PostgreSQL，不重构最终 13 个无需改造的 legacy-only 调用点，不重复进行已经证明过的开放式审查。

## 六、停止条件

出现以下任一情况立即停止当前阶段并记录：

- Preview 身份、TLS、数据库版本、目录或零数据状态不匹配。
- 出现生产 ref、生产主机或无法排除的连接重定向。
- 冻结哈希或迁移哈希不匹配。
- 必需清单仍含 `__UNPROVEN__`，却即将进入普通写入。
- 数据库迁移或任一运行场景失败。
- 发现未记录的调用点、积分写入或账户初始化入口。
- 工作树出现来源不明的改动。
- 需要生产、付费供应商、推送、合并、部署、删除/重置 Preview 等新授权。
- 无法准确确认上一个窗口执行到了哪里。

## 七、上下文压缩与主动换窗协议

本任务不得只依赖聊天上下文。本文件和《当前执行检查点》是跨窗口事实源。

### 7.1 主动换窗触发条件

满足任一条件就主动切换到新任务窗口，不继续硬撑：

- 同一执行链发生两次上下文压缩。
- 一次压缩后已经丢失精确命令结果、文件范围、批准状态或数据库阶段。
- 当前窗口无法可靠复述“最后完成项、最后验证结果、下一步唯一动作”。
- 即将进入新的高风险阶段（首次 Preview 写入、Batch 3 大批改造、生产准备），但当前上下文已明显臃肿。
- 剩余上下文不足以完整执行并验证下一个阶段。

### 7.2 旧窗口换出前必须做

- [ ] 停在安全检查点，不留下正在运行的命令或未确认的数据库操作。
- [ ] 更新本文件《当前执行检查点》。
- [ ] 写明当前时间、分支、HEAD、工作树状态。
- [ ] 写明已完成阶段、最后一条成功命令和精确结果。
- [ ] 写明失败项、阻断项、外部系统当前状态。
- [ ] 写明用户已经给出的授权和仍需的新授权。
- [ ] 写明下一窗口唯一的第一步。
- [ ] 必要时保存可恢复补丁，但不得包含敏感信息。
- [ ] 然后使用 Codex 的任务/窗口交接能力创建或切换到新窗口。

### 7.3 新窗口恢复顺序

新窗口不得凭摘要直接继续，必须：

1. 完整阅读本文件。
2. 阅读《当前执行检查点》。
3. 检查当前分支、HEAD 和工作树状态。
4. 对照检查点确认没有外部或文件状态漂移。
5. 阅读检查点指定的证据文件和最近验证输出。
6. 仅执行“下一窗口唯一的第一步”。
7. 生产、付费、推送、合并、部署、删除/重置 Preview 的授权不得从模糊摘要中推断。

### 7.4 单执行者规则

- 任一时刻只能有一个主执行窗口修改 P1 工作树或 Preview Branch。
- 新窗口确认接管前，旧窗口不得继续写入。
- 若将来明确使用并行窗口，必须分配互不重叠的文件和责任，并在检查点登记。

## 八、当前执行检查点

> 每完成一个 Phase、每次远程写入前后、每次换窗前都必须更新本节。

- 更新时间：2026-07-27 22:26（Asia/Shanghai）
- 更新时间：2026-07-27 22:36（Asia/Shanghai）
- 更新时间：2026-07-27 22:38（Asia/Shanghai）
- 更新时间：2026-07-27 22:48（Asia/Shanghai）
- 更新时间：2026-07-27 22:51（Asia/Shanghai）
- 更新时间：2026-07-27 22:52（Asia/Shanghai）
- 更新时间：2026-07-27 23:02（Asia/Shanghai）
- 更新时间：2026-07-27 23:03（Asia/Shanghai）
- 更新时间：2026-07-27 23:04（Asia/Shanghai）
- 更新时间：2026-07-27 23:15（Asia/Shanghai）
- 更新时间：2026-07-27 23:16（Asia/Shanghai）
- 更新时间：2026-07-27 23:17（Asia/Shanghai）
- 更新时间：2026-07-27 23:19（Asia/Shanghai）
- 更新时间：2026-07-27 23:20（Asia/Shanghai）
- 更新时间：2026-07-27 23:21（Asia/Shanghai）
- 更新时间：2026-07-27 23:33（Asia/Shanghai）
- 更新时间：2026-07-27 23:39（Asia/Shanghai）
- 更新时间：2026-07-27 23:43（Asia/Shanghai）
- 更新时间：2026-07-28 00:23（Asia/Shanghai）
- 更新时间：2026-07-28 00:37（Asia/Shanghai）
- 更新时间：2026-07-28 00:47（Asia/Shanghai）
- 更新时间：2026-07-28 00:53（Asia/Shanghai）
- 更新时间：2026-07-28 11:40（Asia/Shanghai）
- 更新时间：2026-07-28 11:42（Asia/Shanghai）
- 执行状态：`READY_FOR_FINAL_VALIDATION`
- 当前 Phase：Phase 1-4、Preview 五迁移首次应用/重放、真实 post/reapply 冻结、77/77 场景、定向清理和最终目录证明全部完成；Phase 5/6 中无需真实付费供应商、生产权限、推送、合并或部署的本地门禁、构建、回归、主线冲突预演、发布拆分和上线材料均已完成。剩余唯一阶段是用户在明确绑定 Preview 的应用中做真人 UI/最小付费黄金旅程最终检验，随后按单独授权执行真实合并、生产迁移、推送和部署
- 分支：`claude/canvas-p1-generation`
- 代码候选 HEAD：`a6fd9b336c970b34cb9746cc01e3551deefaf021`（本检查点将组成其后的纯文档提交）
- 工作树：代码、验证器、发布文档和字节可移植性修复已拆为 7 个本地提交；当前仅本检查点修改与明确排除提交的 `.claude/settings.local.json` 未提交
- 恢复快照：
  - 路径：`.temp/super-canvas-p1-baseline-20260727-184149.zip`
  - 文件数：46（明确排除 `.claude/*`）
  - SHA-256：`2e0e1f1cd64bebb709f958e2c2eb41c19ca3c1daeb9650d90247840f9b18c3fc`
- 最近复查：
  - Batch 2：`487/487`
  - Runtime：Preview `77/77` 真实通过，失败 0、跳过 0
  - 生成意图：`122/122`
  - 视频合约：`599/599`
  - TypeScript：通过
  - Node 语法：8/8 文件通过
  - diff-check：通过
  - 冻结目录 SHA-256：`60747532147a5be8f8593661275c39977ff09b9344c397827f9cceffa8b3b93d`
  - Phase 1 改动：新增 `.gitattributes` 的单文件 LF 约束；视频验证器读取时归一换行；冻结目录恢复原始 LF 字节
  - 当前 HEAD 调用点：39/39 精确匹配；分类仍为 `18 shared_boundary + 16 legacy_generation_lifecycle_only + 2 make_unreachable + 2 profile_init + 1 deactivation`
  - pre-apply 清单：必需字段 `__UNPROVEN__ = 0`
  - post-apply 清单：18 个必需段均来自 Preview PostgreSQL 真实采集，`__UNPROVEN__ = 0`
  - 敏感信息扫描：49 个候选文件，0 个凭据/JWT/私钥形状发现
  - 五迁移固定哈希：已在 `runtime.mjs` 逐字节锁定并由离线门禁验证
  - Phase 2 已修正：`handle_new_user.config` 实测为 `search_path=public`；补齐实测 `trigger_functions` 脱敏 ACL；五迁移逐字节锁定并改为同一事务执行；新增 post-apply 恢复闸；新增首次采集后立即停止路径；新增测试数据定向清理；ACL 场景改为真实有效行；并发闸改为读取 `pg_stat_activity.wait_event_type='Lock'`，不再依赖时序猜测
  - 2026-07-27 已通过用户登录的 Supabase Dashboard 明确切换并确认 `canvas-p1-staging` / ref `liibsugstuidwlmliyif` / Preview；生产 SQL 编辑器未执行任何语句
  - Dashboard 实测 Preview Session Pooler 为 `aws-1-us-east-2.pooler.supabase.com:5432`，登录用户 `postgres.liibsugstuidwlmliyif`；旧证据中的 `aws-0...` 已按停止条件拒绝并修正，`aws-1...:5432` 本机 TCP 实测可达；后端身份仍必须精确为数据库 `postgres` / 用户 `postgres` / PostgreSQL `17.6`
  - TLS CA 已下载到忽略目录 `.temp/supabase-prod-ca-2021.crt`：1367 bytes，PEM 结构有效，SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`
  - 接力窗口独立复审：工作目录、分支、HEAD、14/34 文件范围、恢复快照和 CA 均无漂移；离线 Batch 2 再跑为 `361/361`，数据库仍为 `0/77`
  - 独立复审发现 4 个进入 Preview 前必须关闭的阻断：远程 `preapply` runtime 可绕过采集/冻结顺序；零数据与清理证明遗漏 `auth.users`；CA 仅检查存在而未锁定 PEM/SHA-256；场景失败后仍继续执行且 R08/R24 负例 UUID 未纳入定向清理
  - 上述 4 个阻断已关闭：远程普通场景仅接受显式 `postapply`；`preapply` 只能进入首次采集并强制停机；`auth.users` 已加入前后零数据证明；CA 在每次探针、单次写入和持久会话前校验单证书 PEM 与固定 SHA-256；负例 UUID 发送前登记；首个场景失败即停止并清理
  - 已新增独立 `--remote-preflight` 入口：只运行服务端 READ ONLY Phase 3A 闸门并在所有迁移、场景和持久写会话之前退出；离线门禁逐字检查该入口不含任何写能力
  - 远程执行文件固定清单：`scripts/fixtures/canvas-p1/batch2/remote-preflight-locks.json`，17 个文件，修正 Pooler 后 SHA-256 `67602bf1447c422bdc85c4373f07355c6bcde803bf28c92aac5ae5a3b80a929e`
  - 最终离线回归：Batch 2 `389/389`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node 语法 `7/7`、JSON `4/4`、diff-check 通过
  - Phase 3A 阻断后的本地复核：旧 `default_acl` 预期 96 行由 `postgres` 与 `supabase_admin` 各 48 行组成；实际迁移只会以 `postgres` 在 `public` 创建对象，因此新增 `--inspect-preapply` 窄范围只读诊断，仅输出 `postgres/public-or-global` ACL 差异、已脱敏的单行触发器函数身份及注册触发器身份，不输出例程正文、策略表达式、凭据或范围外 ACL 内容。远程锁定文件仍为 17 个，当前锁清单 SHA-256 `bf7080038d2d1230b1e4ea47c724f283362cb09a5bebe12d36687d8b986a87cc`；离线门禁 `391/391`，diff-check 通过
  - 20:35 只读诊断结果：`default_acl` 的迁移相关 48 行预期/实测 SHA-256 同为 `13501bd831ab0bf49162d47d68cfd79d7beb06a22a29356c4ee51e26fa898928`，204 个新增行全部在迁移范围外；`trigger_functions` 五条权限完全相同，仅嵌套数组排序不同；`auth_signup_trigger` 实测为 `present=false`。Supabase 当前官方说明确认 Branching 2.0 依赖迁移历史而非数据库 schema dump，分支缺失历史对象属于已知风险，因此不得把缺失触发器当成无害差异
  - 20:38 已将完整非内部 `auth.users` 触发器枚举加入封闭 `PROBES` 常量，只返回名称、函数身份、启用状态、时序和事件位；未知 probe 与任意 SQL 仍硬拒绝。远程锁定文件仍为 17 个，锁清单 SHA-256 更新为 `fc125237065f5fefae014b227d74d0c52751e5a41aeff7ff7df953afda2fb824`；离线门禁 `392/392`，diff-check 通过
  - 注册触发器修复已完成：pre-apply 冻结为 `auth_signup_trigger.present=false` 且 `auth_user_triggers=[]`；信用边界迁移先证明当前角色具有 `auth.users` 的 `TRIGGER` 权限并拒绝任何其他非内部触发器，再事务内确定性重建唯一 `on_auth_user_created AFTER INSERT FOR EACH ROW -> public.handle_new_user()`，随后逐位验证触发器形状和唯一性
  - 两个假阻断已按真实影响面修正：`default_acl` 只锁定 `postgres` 创建 `public/global` 对象会继承的 48 行；`trigger_functions` 权限数组冻结为 2026-07-27 Preview 实测顺序，权限集合没有改变
  - 当前信用边界迁移 SHA-256：`4bf7c0000fc6259d6fb0fa243d95fb14dac56b1ed7a6a2b348bc3e6d5a1a8cde`；17 文件远程锁清单 SHA-256：`8b3f2860af0ecd25695257a8c4807e1a18fc9123effc72b6c0b60921be503479`
  - 修复后完整离线回归：Batch 2 `396/396`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node 语法 `7/7`、JSON `4/4`、diff-check 通过；数据库场景仍为 `0/77`
  - 首次 Phase 3B 失败修复：基础迁移的 VALUES 列别名从 PG17.6 拒绝的 `notnull` 改为 `expected_not_null`，所有引用同步更新；新增静态守卫拒绝该关键字回归。基础迁移 SHA-256 更新为 `db5144ff272c588147034f6c38c377dc5dfdb49a8a643fa33a66b6755dc3e603`，17 文件锁清单 SHA-256 更新为 `1d7a8c85bca7788912c3a61eb0eab254441834fe9922a30099463e7b2b96321d`
  - 失败修复后完整离线回归：Batch 2 `397/397`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node 语法 `7/7`、JSON `4/4`、diff-check 通过；数据库场景仍为 `0/77`
  - 第二次 Phase 3B 失败修复：`credit_transactions_quota_usage_uniq` postcondition 已改为与 DDL 相同的 `quota_window_start`，新增静态守卫同时锁定 DDL 和自检列清单并拒绝旧 `window_start`。基础迁移 SHA-256 更新为 `c525036a97c01c90bf92a684afae9403c4b02876a4281e298bd22507853594dd`，17 文件锁清单 SHA-256 更新为 `6c292ba6696e44e37e84bdfe90bac9cd12c6468455f56d7db3fd297eb6b36bb4`
  - 第二次失败修复后完整离线回归：Batch 2 `398/398`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node 语法 `7/7`、JSON `4/4`、diff-check 通过；数据库场景仍为 `0/77`
  - 第四次 Phase 3B 失败修复：生成 API 的 schema-qualified `pg_catalog.substring` 已从 PG17 拒绝的 `FROM/FOR` 特殊语法改为三参数形式 `substring(expression, 1, 32)`，新增静态守卫。第三迁移 SHA-256 更新为 `7275f5bb1c3c8e76c94dbcb180e39a679eedfed889806796f76a7eef9d319638`，17 文件锁清单 SHA-256 更新为 `5e3eaaec467945df0c7dca95dede0022b7deb4daefa5940097424cf15329d40e`
  - 第四次失败修复后完整离线回归：Batch 2 `399/399`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node 语法 `7/7`、JSON `4/4`、diff-check 通过；数据库场景仍为 `0/77`
  - Phase 3B 证据审阅：`post-apply.redacted.json` / `reapply.redacted.json` 均为 95,062 bytes 且 SHA-256 同为 `2689ca12d250ebc305871e66e07cd55de87c2c965b53495f0ac0534a1631ee05`；18 个必需段完整且无额外段，无生产 ref、连接串、密码/JWT/私钥/API key、函数正文、生产数据或 `__UNPROVEN__`
  - 关键 post-apply 安全面：唯一 `on_auth_user_created AFTER INSERT FOR EACH ROW -> public.handle_new_user()`，竞争触发器 0；25 个生命周期函数无 PUBLIC/anon/authenticated EXECUTE；quota 表无客户端权限、RLS 开启、策略数 0；`handle_new_user` 为 SECURITY DEFINER 且 `search_path=""`
  - 冻结方式：新增 `scripts/fixtures/canvas-p1/batch2/post-apply-catalog.json`，post-apply/reapply 从同一个深度冻结、SHA-256 锁定对象加载；远程锁定执行面从 17 文件增为 18 文件，当前锁清单 SHA-256 `63c97e824774bbb0fbeb776cdda1e1ffecebadaea8b0c2f27047d5eb9af20fdc`
  - 冻结后完整离线回归：Batch 2 `405/405`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node 语法 `7/7`、JSON `5/5`、diff-check 通过；数据库场景仍为 `0/77`
  - R01 空 scalar 根因：场景 SQL 可不带结尾分号，而 psql 的 `\echo` 不会提交尚在缓冲区的 SQL，导致哨兵先返回、查询留在缓冲区。`PsqlSession` 现通过纯函数 `buildSessionRequest()` 在每个请求与哨兵之间强制插入独立 `;` 行；已有分号时只是空语句，不会重放上一条 SQL
  - 新增纯本地协议回归：无分号、已有分号、多语句三种帧都必须在 `\echo __CANVAS_P1_EOS__N` 前完成 SQL 终止；空 SQL 和非正 request id 拒绝。会话文件 SHA-256 `f5f2d6eb5bf7e6ff6f8b59ad94115ca1c6bdcd38a43521bf047d223096e1ff05`
  - 会话修复后完整离线回归：Batch 2 `408/408`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node 语法 `7/7`、JSON `5/5`、diff-check 通过；18 文件远程锁清单 SHA-256 `a7c586e466ce78f575a56643a6e9c8fb3fd6d268bbbbd1b0163fc87b68c1b686`
  - 21:25 第二次 post-apply runtime：离线门禁 `408/408`；恢复闸证明 18 段冻结目录；五迁移重放成功；R01-R25 全部通过。R26 `begin_20_duplicates_one_debit` 创建第 14 个并发会话时，Session Pooler 返回 `EMAXCONNSESSION`（session mode `pool_size=15`），因此首错停止，结果 `executed=26, passed=25, failed=1, skipped=51`。finally 定向删除 19 个测试用户；6 个测试数据面精确为空；最终 18 段目录无漂移
  - R26 本地修复：新增纯函数连接调度器，将 20/21 个逻辑并发请求完整映射到最多 12 个持久数据库工作会话；同一工作会话上的多请求按 PostgreSQL 会话协议排队，不丢请求；不同工作会话仍真实并发。每个场景结束立即关闭所有命名/工作会话并清空缓存，杜绝连接跨场景累积。R26 仍执行 20 次 duplicate begin，R71 仍执行 21 次 quota begin，三个锁屏障仍读取真实 `pg_stat_activity.wait_event_type='Lock'`
  - 连接预算修复后完整离线回归：Batch 2 `412/412`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node 语法 `8/8`、JSON `5/5`、diff-check 通过。会话 SHA-256 `6f6da59bf9cbdafbd2b1035644fffc7cc53f4548ce15073103c160d9f67a2926`；runtime SHA-256 `987e396bf9bfbd297b114ff7457210f78a4d88ff51fc6f699d441d79502bda96`；场景 SHA-256 `5d469658cf01dca409dbb1f7be9bf6845aabdb583b36d2b980d549405668f6b3`；18 文件远程锁清单 SHA-256 `c31de65ef873305e7793fbf3a902378702b7e043874c20501fa2ce1fdc0b2623`
  - 21:32 远程重试前身份复核：浏览器 URL 精确包含 `/project/liibsugstuidwlmliyif/`，页面唯一显示 `canvas-p1-staging` 与 `Preview`，Connect 对话框仍为该项目；已复制一次性 Preview 连接串，尚未启动数据库命令
  - 21:38 第三次 post-apply runtime：离线门禁 `412/412`；恢复闸证明 18 段冻结目录；五迁移重放成功；R01-R29 全部通过，确认 12 工作会话调度已让 R26 越过 Session Pooler 上限。R30 `begin_no_negative_balance` 的准备步骤调用信用边界执行 `consume -95`，但未提供 action/generation/canvas 身份，被 `ct_action_identity_required` 正确拒绝；结果 `executed=30, passed=29, failed=1, skipped=47`。finally 定向删除 23 个测试用户；6 个测试数据面精确为空；最终 18 段目录无漂移
  - R30 本地复核与修复：`ct_action_identity_required` 明确要求所有非 grant 流水携带 generation/action/canvas snapshot/node 身份，因此数据库拒绝裸 `consume -95` 是正确行为，不应放宽迁移。R30 现先通过真实 `begin_canvas_generation_v1` 执行一笔完整身份的 95 积分 paid begin，将余额从 100 降到 5，再用独立 begin 请求验证 999 积分透支被拒绝且余额仍为 5
  - R30 修复后完整离线回归：Batch 2 `413/413`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node 语法 `8/8`、JSON `5/5`、diff-check 通过。场景 SHA-256 `885a512de2336fe570ca8256cddad54980ccd052060d9d667fb9777f9d2d091a`；验证器 SHA-256 `71495a8848da68e10f37ac3eaced575be31718c415ac8d8ae0a952781a3f4f1e`；18 文件远程锁清单 SHA-256 `342e5726d096ba869fb982822008774a338da0b7f57cd9cce7d381d768c0dd7b`
  - 21:40 再次确认浏览器 URL、`canvas-p1-staging`、ref `liibsugstuidwlmliyif` 与 `Preview` 身份全部精确匹配；已重新复制一次性 Preview 连接串，尚未启动本轮数据库命令
  - 21:45 第四次 post-apply runtime：离线门禁 `413/413`，恢复闸证明 18 段冻结目录；R01-R10 通过。R11 `forge_quota_bucket` 创建场景会话时 DNS 无法解析 `aws-1-us-east-2.pooler.supabase.com`，结果 `executed=11, passed=10, failed=1, skipped=66`。finally 的定向清理连接同样因 DNS 失败；随后清理证明成功读到 `public.profiles=4` 而拒绝零残留结论；最终目录探针遇到 SSL EOF，未形成最终目录结论。一次性凭据、进程环境变量和剪贴板已清除；生产 ref 未参与
- 数据库状态：2026-07-27 21:54 Preview 六个测试数据面全部精确为零，完整目录 18 段匹配冻结 post-apply 清单；五迁移没有失败，生产 ref 未参与
- 恢复路径实现：新增封闭 `runtime_recovery_inventory` READ ONLY 探针，只把 email 精确等于 `u-<自身 canonical UUID>@test.invalid` 的 auth 用户列为候选；只输出候选 UUID 和六个测试数据面的总计/候选外计数。恢复闸要求 1..77 个唯一 canonical UUID、全部 auth.users 都是候选、六个数据面的候选外计数全部为 0、后端身份/TLS/PG17.6/完整 18 段目录全部匹配，才允许把这组精确 UUID 交给原事务化清理
- 恢复路径门禁：`--inspect-runtime-recovery` 只读且无法到达清理；`--recover-interrupted-runtime` 必须先通过专用恢复写闸，再按显式 UUID 清理，最后证明六面归零并重新通过普通 post-apply 恢复闸。空范围、重复 UUID、非 canonical UUID、超过 77 个候选、任一候选外数据均硬拒绝
- 恢复路径完整离线回归：Batch 2 `419/419`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node 语法 `8/8`、JSON `5/5`、diff-check 通过。验证器 SHA-256 `c0ccad20890d18275eb83d4296114a21d9a3002dfd7ef25bd57441bbb65f7e00`；runtime SHA-256 `450254848ee137b73adcc275bf41c0759da41c8f41a0dc2493cc28c83e97822a`；target SHA-256 `8ceb7afc88958952330cb84f732f938aee3578f42d7378f8191801229e367f5d`；18 文件锁清单 SHA-256 `0b47e72835e80d5cc3b708c55d83ee24a2e742967dd3330ba590b9f86f225e57`
  - 21:51 只读恢复清单通过：候选 UUID 精确为 `0f33ad37-7a59-457c-bd8c-610bb15eb8f0`、`304237cf-1a0f-45ce-a808-00c8123f8ca9`、`56136548-78df-4ed9-bc80-40ae48a174a6`、`92c0aa16-0aa0-4dab-a85a-8ed6ea0dc957`；`auth.users=4`、`profiles=4`、`canvases=0`、`generations=3`、`credit_transactions=5`、`generation_quota_buckets=0`，六个数据面候选外计数全部为 0；完整目录 18 段匹配，digest `daa49d6ce71dcd70b7151ddeb147c2a42b35f536cf9bac3ad51f2406fa428693`。该命令为服务端 READ ONLY，未删除任何行；凭据与剪贴板已清除
  - 21:54 `--recover-interrupted-runtime` 成功：写闸再次证明相同的 4 个精确候选和候选外计数 0；事务化定向清理删除 4 个测试用户及其闭包；随后六个测试数据面精确为零，普通 post-apply 恢复闸重新证明 18 段目录。一次性凭据、进程环境变量和剪贴板已清除
  - 网络可靠性最小加固：主 `m` 会话改为整套 77 场景复用，避免每个场景重新执行 DNS/TLS 握手；`a`/`b` 屏障会话和所有 fan-out 工作会话仍在每个场景后关闭，事务/锁不跨场景，R26/R71 峰值仍为 1 个主会话 + 最多 12 个工作会话。完整离线回归为 Batch 2 `420/420`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node `8/8`、JSON `5/5`、diff-check 通过；验证器 SHA-256 `83bbc73f438df58c5d4c81b560fc5f425b52e996ee2e5082df7c2c8c3e4f4d4b`，runtime SHA-256 `e26de0d44e476c450ca66382574ca2cb102703c26a3685ef1dbd96155b82354f`，18 文件锁清单 SHA-256 `d73cd95300bb0bda2c979edc9023740635b82cf3692748b35fba6e22eba3c56d`
  - 21:55 再次确认浏览器 URL、`canvas-p1-staging`、ref `liibsugstuidwlmliyif` 与 `Preview` 身份全部精确匹配；已复制一次性 Preview 连接串，尚未启动本轮数据库命令
  - 22:00 第五次 post-apply runtime：离线门禁 `420/420`，恢复闸证明 18 段冻结目录；R01-R31 全部通过，主会话复用未出现 DNS/TLS 问题。R32 `race_mixed_balance_continuity` 的 6 个并发 `consume -1` 均未提供 generation/action/canvas/node 身份，被 `ct_action_identity_required` 正确拒绝；结果 `executed=32, passed=31, failed=1, skipped=45`。finally 定向删除 25 个测试用户；六个测试数据面精确为空；最终 18 段目录无漂移；一次性凭据与剪贴板已清除，生产 ref 未参与
  - R32 本地修复：保留 900 积分 grant top-up；随后 6 个真实会话各自从 PostgreSQL 取得 action UUID，通过 `begin_canvas_generation_v1` 携带 canvas/node/action 身份并发执行 cost=1 的 paid video begin。仍逐参与者检查无错误、验证整条流水 `balance_before/after` 连续、profile 与流水尾均为 994。完整离线回归为 Batch 2 `421/421`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node `8/8`、JSON `5/5`、diff-check 通过；验证器 SHA-256 `312a875714f2234b33a2849abd94d184344a1501c6d1bb5b469ca05bba12aa12`，场景 SHA-256 `3148e4de6d88ccdc6793608b4fd84f4a7df27783410c023f9adc44bd123b1e30`，18 文件锁清单 SHA-256 `f3df91c3f5706f389128b7fd2d6a2354a81c730752e3c3a4e44327d2f6fd5eeb`
  - 22:02 再次确认浏览器 URL、`canvas-p1-staging`、ref `liibsugstuidwlmliyif` 与 `Preview` 身份全部精确匹配；已复制一次性 Preview 连接串，尚未启动本轮数据库命令
  - 22:08 第六次 post-apply runtime：离线门禁 `421/421`，恢复闸证明 18 段冻结目录；R01-R43 全部通过，确认 R32 的 6 个完整身份 paid begin、余额连续性和 994 对账均通过。R44 `refund_vs_complete` 的退款/完成竞争断言“恰有一个终态赢家”实际计数为 0；结果 `executed=44, passed=43, failed=1, skipped=33`。finally 定向删除 37 个测试用户；六个测试数据面精确为空；最终 18 段目录无漂移；一次性凭据与剪贴板已清除，生产 ref 未参与
  - R44 根因与修复：claim 函数把 `reconcile_lease_expires_at` 保存到 PostgreSQL 微秒精度，但夹具用 `to_char(...SS"Z")` 截断微秒后再构造 authority DTO，导致 fail 与 complete 都被正确判为 stale/mismatched lease。所有 7 个从数据库 claim 读取租约的路径已统一为 `SS.US"Z"`，不修改迁移或 authority 比较。R44 还新增独立 status/refund ledger/profile 对账：failed 必须 1 笔退款且余额 1000，completed 必须 0 退款且余额 990；双方原始错误会进入失败证据
  - 租约精度修复后完整离线回归：Batch 2 `423/423`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node `8/8`、JSON `5/5`、diff-check 通过；验证器 SHA-256 `719f90d0b8fdd11a24b19efba710c5d7def4384c350ccd71e24907db276cf1c0`，runtime SHA-256 `a7e545fa212bb10560b204680775bf67f5e5632445c10514d99b137be4646a1a`，场景 SHA-256 `a2dff88610ebf98fe23c2207116178935a2941b1491f8a0371cf1552c8f6cfda`，18 文件锁清单 SHA-256 `abda655321f8e1a9be63e8cda2c81ac51745e46d7e9af2cd1681b97e6da1b46f`
  - 22:10 再次确认浏览器 URL、`canvas-p1-staging`、ref `liibsugstuidwlmliyif` 与 `Preview` 身份全部精确匹配；已复制一次性 Preview 连接串，尚未启动本轮数据库命令
  - 22:16 第七次 post-apply runtime：离线门禁 `423/423`，恢复闸证明 18 段冻结目录；R01-R31 全部通过。R32 的 6 个完整身份 paid begin 均成功，但流水按 `created_at,id` 排序出现 2 个 `previous.balance_after <> current.balance_before` 断点；结果 `executed=32, passed=31, failed=1, skipped=45`。finally 定向删除 25 个测试用户；六个测试数据面精确为空；最终 18 段目录无漂移；一次性凭据与剪贴板已清除，生产 ref 未参与
  - R32 真实缺陷修复：`canvas_p1_apply_credit_delta_v1` 在取得用户 profile `FOR NO KEY UPDATE` 锁并确定 `balance_before/after` 后，插入流水时显式写入 `created_at=pg_catalog.clock_timestamp()`；不再继承事务开始时刻 `now()`，因此审计时间与同用户真实串行写入顺序一致。信用迁移 SHA-256 更新为 `c162640cd848aa376608ab4cb55116ea5d4060204490fa40f1ba53a86ee78af2`
  - 审计时间修复后完整离线回归：Batch 2 `424/424`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node `8/8`、JSON `5/5`、diff-check 通过；验证器 SHA-256 `c9f0c181feba8bbbd75121e7f9757b6026fcae29a104a83a19cabcecc4ece801`，runtime SHA-256 `196ecfc83bd95abac28348310658f192faba4cd04e7784a3a83fc8fed7464aad`，18 文件锁清单 SHA-256 `50028c8748011a7c116d192b7a37d00146a65902d117f9376d1e9f249ae8806c`
  - 22:17 再次确认浏览器 URL、`canvas-p1-staging`、ref `liibsugstuidwlmliyif` 与 `Preview` 身份全部精确匹配；已复制一次性 Preview 连接串，尚未启动本轮数据库命令
  - 22:24 第八次 post-apply runtime：离线门禁 `424/424`，恢复闸证明 18 段冻结目录；R01-R47 全部通过，确认审计时间修复、R32 余额链、R44 租约竞争与 R45-R47 authority 场景均通过。R48 `authority_noncanonical_rejects` 中一个 reconciliation lease 非 canonical DTO 被 `canvas_p1_parse_authority_v1` 接受；结果 `executed=48, passed=47, failed=1, skipped=29`。finally 定向删除 38 个测试用户；六个测试数据面精确为空；最终 18 段目录无漂移；一次性凭据与剪贴板已清除，生产 ref 未参与
  - R48 根因与修复：负例常量是全零 UUID，`.toUpperCase()` 后字节完全不变，因此仍是合法 canonical 小写 UUID；解析器在 `::uuid` 前已有严格 `[0-9a-f]` 正则且行为正确。负例现使用 `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`，再取大写确保逐字非 canonical；迁移未放宽也无需修改
  - R48 修复后完整离线回归：Batch 2 `425/425`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node `8/8`、JSON `5/5`、diff-check 通过；验证器 SHA-256 `3c2f0ded92e6151567931c5a66537477e8eac63de75ef1903f6579b114c3ed19`，场景 SHA-256 `806fc2bdb8698972ca0d6bd2001551277b449c09e91441025b0397b81c290cc6`，18 文件锁清单 SHA-256 `776bdda15d99f90c67fe1db9eeb287911fd70d105e52d36c4259f92ef443fc53`
  - 22:26 再次确认浏览器 URL、`canvas-p1-staging`、ref `liibsugstuidwlmliyif` 与 `Preview` 身份全部精确匹配；已复制一次性 Preview 连接串，尚未启动本轮数据库命令
  - 22:32 第九次 post-apply runtime：离线门禁 `425/425`，恢复闸证明 18 段冻结目录；R01-R49 全部通过，确认 R48 的真实大写非 canonical UUID 被拒绝。R50 `lease_aba_new_token` 在把当前 generation 的 expiry 改为过去时触发 `gen_reconcile_lease_all_or_none`；失败行显示当前行 owner/token 为空，证明 `seedBoundVideo` 的全局 limit=1 claim 被此前 R45 留下且已经 due 的 processing row 抢占，当前 generation 未获得租约。结果 `executed=50, passed=49, failed=1, skipped=27`。finally 定向删除 39 个测试用户；六个测试数据面精确为空；最终 18 段目录无漂移；凭据已清除
  - 场景隔离修复：现有事务化清理 SQL 已抽成只接受 1..77 个唯一 canonical UUID 的纯构造器；每个场景先关闭 fan-out/屏障会话，再用整套复用的主 `m` 会话清理本场景已登记 UUID 并逐事务证明零残留，随后才进入下一个场景；累计用户清理计数仍保留，整套 finally 仍用独立连接清理任何未完成范围并做六面/目录终检。该修复不新增逐场景 DNS/TLS 握手
  - 逐场景隔离后完整离线回归：Batch 2 `428/428`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node `8/8`、JSON `5/5`、diff-check 通过；验证器 SHA-256 `2986b14a4f3ce1ea10c6da0dbcff74dfd6c2413234e4462c1d6d11cf0bf2155b`，runtime SHA-256 `0a36dbc3bd136f20a0094ea15ed8fd4cc556e43abad527c7c86f46d893fcdb0e`，18 文件锁清单 SHA-256 `b1386560c9d97f6c466447d04c06bf6233e54a515a93c09f6c0f2ce604278739`
  - 22:38 远程写入前复核：浏览器 URL 精确包含 `/project/liibsugstuidwlmliyif/`，页面唯一显示 `canvas-p1-staging` 与 `Preview`，Connect 对话框仍属于该 Preview；已复制重置后的 Preview 一次性连接串，数据库命令尚未启动。分支、HEAD、14 个已跟踪修改、15 个未跟踪状态项及 CA 固定 SHA-256 均无漂移；生产 ref 未参与
  - 22:48 第十次 post-apply runtime：离线门禁 `428/428`，恢复闸与锁定迁移重放通过；R01-R58 全部通过，证明逐场景显式 UUID 清理阻止了旧场景全局 claim 污染。R59 `reconcile_excludes_terminal` 把当前 generation 直接更新为 `completed` 却未设置 completed 输出，数据库约束 `gen_action_completed_has_output` 正确拒绝；结果 `executed=59, passed=58, failed=1, skipped=18`。finally 累计定向删除 48 个测试用户；六个测试数据面精确为空；最终 18 段目录无漂移；一次性凭据、进程环境变量和剪贴板已清除，生产 ref 未参与
  - R59 本地修复：completed/failed 两行均先分别通过 `complete_canvas_generation_v1` / `fail_canvas_generation_v1` 形成满足输出、退款和终态约束的合法终态，再单独把 `next_reconcile_at` 设为过去，保留“due-looking 终态仍不可 claim”的实际测试强度；未修改或放宽任何迁移/约束
  - R59 修复后完整离线回归：Batch 2 `429/429`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node `8/8`、JSON `5/5`、diff-check 通过；验证器 SHA-256 `c95f1aa63c3f7fbeed6b1cf09250604fcba0131c29761de05d99a8932f768925`，场景 SHA-256 `00ecb7474ba452ac38e065bfef1690c005ae39f4f451902558210b4ca1e0b233`，18 文件锁清单 SHA-256 `561b4392c95e0e4c984cb91540c5511ef8a81decfdfd5add3c06ff8c71e9937c`
  - 22:52 远程写入前复核：浏览器 URL 精确包含 `/project/liibsugstuidwlmliyif/`，页面唯一显示 `canvas-p1-staging` 与 `Preview`，Connect 对话框仍属于该 Preview；已复制重置后的 Preview 一次性连接串，数据库命令尚未启动，生产 ref 未参与
  - 23:02 第十一次 post-apply runtime：离线门禁 `429/429`，恢复闸与锁定迁移重放通过；R01-R75 全部通过，R59 合法终态夹具在线通过。R76 `drift_matrix_same_name_objects` 的 policy 目录查询直接执行 `p.polcmd||'|'`，PG17 对内部 `"char"` 与 unknown 文本的 `||` 操作符判定为不唯一；结果 `executed=76, passed=75, failed=1, skipped=1`。finally 累计定向删除 65 个测试用户；六个测试数据面精确为空；最终 18 段目录无漂移；一次性凭据、进程环境变量和剪贴板已清除，生产 ref 未参与
  - R76 本地修复：policy 目录断言将 `pg_policy.polcmd` 从内部 `"char"` 显式转换为 `text` 后再拼接；新增窄范围静态守卫禁止无转换回归，未修改任何迁移或数据库行为
  - R76 修复后完整离线回归：Batch 2 `430/430`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node `8/8`、JSON `5/5`、diff-check 通过；验证器 SHA-256 `01a86fe0d4af18c4a68c9b12000d9ec03fb587bcde881dbb3cb84e8984622e70`，场景 SHA-256 `29e75c8b4401a097fec20722e998660242549bb4a43b60b8fa7f5fcac92963af`，18 文件锁清单 SHA-256 `9f53a8e0522a073257e1214cdd9c3b5e84664c4f09992b3d9f9f0357dcc84441`
  - 23:04 远程写入前复核：浏览器 URL 精确包含 `/project/liibsugstuidwlmliyif/`，页面唯一显示 `canvas-p1-staging` 与 `Preview`，Connect 对话框仍属于该 Preview；已复制重置后的 Preview 一次性连接串，数据库命令尚未启动，生产 ref 未参与
  - 23:15 第十二次 post-apply runtime 的本地 PowerShell 等待在 604 秒达到工具时限并返回 124，未收到 harness 最终输出；验证器 Node PID 24772 与子 psql PID 28596 仍在运行，因此不得把本轮判为成功、失败或已清理。剪贴板已由独立进程清空；凭据只残留于仍在运行的获准 Preview 验证进程环境，生产 ref 未参与
  - 23:16 PID 24772 与 28596 已自然退出，不再有本轮验证器或 psql 进程；因原输出管道已丢失，本轮最终计数、清理和目录结果仍不可推断，必须使用封闭只读恢复清单重新证明
  - 23:16 只读恢复清单前身份复核：浏览器 URL 精确包含 `/project/liibsugstuidwlmliyif/`，页面唯一显示 `canvas-p1-staging` 与 `Preview`，Connect 对话框属于该 Preview；已复制连接串，但只读恢复命令尚未启动，生产 ref 未参与
  - 23:17 只读 `--inspect-runtime-recovery` 在完整目录读取与封闭 inventory probe 后返回 `recovery candidates must be 1..77 unique canonical UUIDs`；当前实现把零候选与超限/重复/非 canonical 合并为同一拒绝，且在输出六面计数前停止，因此不能仅凭该错误正式证明零残留。命令未获得写能力，凭据和剪贴板已清除
  - 恢复清单零候选修复：只读 inventory 允许 0..77 个唯一 canonical UUID，并仍要求 `auth.users` 总数等于候选数、六面所有候选外计数为零、18段目录匹配；恢复写闸新增显式零候选拒绝，因而空库只能生成只读证明，不能铸造清理写权限
  - 零候选修复后完整离线回归：Batch 2 `431/431`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node `8/8`、JSON `5/5`、diff-check 通过；验证器 SHA-256 `5b0f0f71c0c44b55707846603f1f94ed27993cbb024c0ec8f6bdf5450f51102f`，target SHA-256 `a6d501efe5c81708e277de095b62f17f2a42bd37abe32b36cb6e4e554832244f`，18 文件锁清单 SHA-256 `7e9a6b914cef2d69496c9458439fbb162c3f73a53ef04a07cc46f43fb9bf9e83`
  - 23:20 只读恢复清单通过：`candidate_ids=[]`；`auth.users`、`profiles`、`canvases`、`generations`、`credit_transactions`、`generation_quota_buckets` 的总数和候选外计数全部为 0；18 段目录匹配，digest `daa49d6ce71dcd70b7151ddeb147c2a42b35f536cf9bac3ad51f2406fa428693`。未删除任何行，凭据和剪贴板已清除
  - 23:21 远程写入前复核：浏览器 URL 精确包含 `/project/liibsugstuidwlmliyif/`，页面唯一显示 `canvas-p1-staging` 与 `Preview`，Connect 对话框仍属于该 Preview；已复制重置后的 Preview 一次性连接串，数据库命令尚未启动，生产 ref 未参与
  - 23:21 完整 runtime 已作为唯一隐藏后台进程启动：Node PID 32204、子 psql PID 19128；stdout/stderr 分别写入 `.temp/runtime-20260727-2321.stdout.log` 与 `.temp/runtime-20260727-2321.stderr.log`，两者均在 Git 忽略临时目录。父进程凭据和剪贴板已立即清除；仅该获准 Preview 子进程持有运行期环境
  - 23:33 第十三次 post-apply runtime 正式完成：离线门禁 `431/431`；`executed=77, passed=77, failed=0, skipped=0`；恢复闸 18 段、最终目录 18 段；累计定向删除 67 个测试用户；六个测试数据面精确为空；stderr 为空，stdout SHA-256 `6823e7cc41365f2486e69c197b55073413b3e995d2a3b5a482f15974017bcfb6`。所有验证器/psql 进程均已退出，凭据和剪贴板均已清除，生产 ref 从未参与
  - Phase 4 第一小批完成：`src/app/api/user/credits/deduct/route.ts` 与 `refund/route.ts` 已移除请求体解析、service-role 管理客户端、定价和全部数据库代码，POST 仅无条件返回 410；route SHA-256 分别为 `81d0f3c2fb8e74dfa4a6af5d0862793b245e5aefbd86bc1104b2d48cb5f0418a` / `9fc4298104d8ebe3fa1f6cb85e1d1df68bfde1c9ca59c78462556f639e9d667a`
  - 调用点基线已人工裁决为原始 39 = 37 个活跃写调用点 + 2 个 `retired_unreachable` 精确哈希墓碑；扫描器不再发现两个路由的任何 mutation。`.gitattributes` 已给两路由增加窄范围 `eol=lf`，防止 Windows 改写精确哈希
  - 第一小批完整本地回归：Batch 2 `433/433`、生成意图 `122/122`、视频合约 `599/599`、Instagram webhook acceptance `7/7`、TypeScript 通过、Node `8/8`、JSON `5/5`、diff-check 通过；验证器 SHA-256 `26c95788e2c0d3164aa0587618ce1416a7ab27fa318b29401492b71715f9d5d8`，调用点清单 SHA-256 `3223e6e3d6df4e94daa376fc49fd9d211c73c10118a3eecad6d3e6aeae4d2273`，18 文件锁清单 SHA-256 `0c644be6a963c7483916dbcc4905ca82f22e46f57fd230a26fc1f0dfcafcb573`
  - Phase 4 第二小批完成：浏览器邮箱注册已删除 `.from("profiles").insert(...)`；SMS 注册已删除直接 profile/`credits:100` 插入，并把 `用户<后四位>` 放入 `auth.admin.createUser` 的 `user_metadata.name`。两条路径只创建 `auth.users`，由已在线通过的唯一 `on_auth_user_created -> handle_new_user -> canvas_p1_initialize_account_v1` 链同步创建零积分 profile 并写入唯一锚定 100 积分赠送
  - 调用点基线第二次人工裁决为原始 39 = 35 个活跃写调用点 + 2 个 `retired_unreachable` 墓碑 + 2 个 `converted_profile_init_to_auth_trigger` 注册入口；扫描器不再发现注册页或 SMS 路由的 profile/credit mutation
  - 第二小批完整本地回归：Batch 2 `436/436`、生成意图 `122/122`、视频合约 `599/599`、TypeScript 通过、Node `8/8`、JSON `5/5`、diff-check 通过；验证器 SHA-256 `7460275ba51d0b5331da621eb4150a0c91bc7ff86cbf1eb040366a3eea2b44e2`，调用点清单 SHA-256 `73effba6a5d4c43e15d54542f981894c4aeee1c88ae4a8046f564dd20c6d3343`，18 文件锁清单 SHA-256 `7222ea1e46c71e6b06584f5c12abb510def09271f31495d380665179b7f6bc9a`
  - 23:53 Phase 4 第三小批只读拆分复核完成；18 个冻结入口均已逐一复核其鉴权、任务身份、扣费、退款、流水与上游调用顺序，未连接数据库、未产生远程写入
  - 第三小批固定拆分（总计仍为 18）：
    1. **A—精确退役 2 项**：临时调试 `admin/set-credits` 无可靠绝对余额幂等语义；旧 `sora/generate` POST 已废弃且当前会先扣费再返回 410。两者改为无条件 410 墓碑；Sora GET 定价读取保留
    2. **B—原子底座**：在现有信用迁移中增加第二种完整、互斥的 task-scoped 身份（四个 action 身份全空且 `task_id` 非空），绝不接受部分 action 身份；新增服务端 helper，由受控 scope/task/operation 组合派生 anchor，不接受调用方原样传入 operation anchor
    3. **C—视频共享 helper 1 项**：改造 `src/lib/video-models/credits.ts`，并同时消除其四个隐藏调用者中的直接余额/流水拼接；保持现有价格、提供商提交顺序和一次退款语义
    4. **D—普通任务 9 项**：角色设定板、角色 Sora 视频、旧内存任务、通用视频、legacy generations、Seedance 提交/状态、HappyHorse 状态、Sora 状态；以服务端 generation/attempt/task 身份锚定 consume/refund，外部路由同时绑定已认证用户，禁止信任请求体 `userId`
    5. **E—图片任务 4 项**：Quick Image、Image Factory 提交/状态、图片 worker；Quick Image 使用服务端 `generationId`，电商图片使用现有 task UUID，部分退款 anchor 额外绑定确定性的失败计数/退款阶段
    6. **F—合约 2 项**：API route 与 server action；买方 consume、失败补偿 refund、社区创作者 grant 各自通过共享边界，task identity 绑定合约/续约阶段；价格和收益比例不变
  - 约束结论：不放宽为“任意 task_id 即可”；非 grant 新流水必须满足“完整 action 身份”或“完整 task-scoped 身份”二选一。原子边界仍仅授予 `service_role`，同用户 profile 锁、余额非负、流水同事务和 `(user, operation_anchor)` 冲突重放全部保留
  - 23:57 第三小批 A 组完成：`admin/set-credits` POST 已成为唯一 410 墓碑；旧 `sora/generate` POST 已成为无条件 410 墓碑，GET 只读定价/余额查询保留。两者都不再被 mutation scanner 发现；冻结基线现为 33 个活跃写调用点 + 4 个精确哈希退役 mutation method + 2 个触发器初始化入口
  - A 组精确证据：admin route SHA-256 `d301ec0923bd5ae692151c14d7a1ea4a6142bf56665fdc96d17714c7c3e4b48b`；Sora route SHA-256 `896b839be4aadb10f2d20a3d75b020e1a17e1d971147734b3406bd45c7647be7`；验证器 SHA-256 `5f574421df0122d2b569e88c8ec6cd4fcac5dcaa20dfb24d60a0ed48b5027805`；调用点清单 SHA-256 `669fee2180f854ae710011b34e0d9e84f67a0c896d36fd98693190a24f1601b2`；18 文件锁清单 SHA-256 `2bf4617e974e7c5be62b8860dff50d4ba91b2980a1eb37d7372c79de59b70130`
  - A 组窄回归：Batch 2 静态/注册表 `436/436` 且明确 `0/77` offline、TypeScript 通过、diff-check 通过；工作树为 20 个已跟踪修改、15 个未跟踪状态项；无数据库连接、无远程写入、无供应商调用
  - 2026-07-28 00:01 第三小批 B 组本地候选完成：信用迁移以单条 `ALTER TABLE` 原子替换 `ct_action_identity_required`，非 grant 仅允许完整 action 身份或四个 action 字段全空且非空 `task_id` 的 task-scoped 身份；函数入口在取 profile 锁前重复同一结构性拒绝
  - B 组新增 `src/lib/credits/atomic-task-credit.ts`：scope 为编译期受控枚举；task 原文只写入 `task_id`，operation anchor 由服务端对 `scope + NUL + taskId` 做 SHA-256 后与受控 operation token 组合，调用方不能传入原样 anchor；RPC 始终显式提交四个 action 字段为 null 与非空 task identity
  - R30 已增强为真实 PostgreSQL 候选场景：首次 task consume、同 anchor 重放、部分 action 身份拒绝、空 task 拒绝、透支拒绝与单流水断言；77 个场景总数不变。冻结 post-apply 目录仍保留上一轮真实在线证据，尚未伪改；待应用候选迁移到 Preview 后必须重新采集并冻结
  - B 组离线门禁：Batch 2 静态/注册表 `438/438` 且明确 `0/77` offline；TypeScript 通过。信用迁移 SHA-256 `d6d1ad82472806fb3284070cbcdc53267709a4593976b67e1e271c98951814c2`；helper SHA-256 `e77e8db247db3e5c181cd8a04091cf3a856402f921f8ecea0bc47c0be20a2d2d`；场景 SHA-256 `2f7ad37359c6519b77acc31067742269fd2b7623f82cfd5832f5e48ada0e93af`；runtime SHA-256 `b78593455a2d6e05ca6f8e6daeb70823fdaca353674276b75586338d5876eb39`；验证器 SHA-256 `cd2e5ec2518067e0bd4a024ebdd891c9c8f749565cc9a13bbb485099181a78dd`；18 文件锁清单 SHA-256 `16c71ce96b0f84948b9b0bdf7d680612f0caa30c78367894f2aa7ec11e2c1b46`
  - 00:12 第三小批 C 组完成：`src/lib/video-models/credits.ts` 的 consume、direct refund、once refund 全部调用 `applyTaskCreditDelta`；不再导出或实现 `adjustProfileCredits` / `insertCreditTransaction`，不再直接更新 profile 或插入流水。旧未锚定退款仍通过原描述探针防重，新的原子退款同时由 operation anchor 防重
  - 四个隐藏调用者已固定：models submit/status 继续通过已改造 wrapper；slideshow 与 studio assembly 改为直接原子 helper。价格、上游先提交/先交付顺序、generation 状态与失败时是否继续响应的既有语义均未改变
  - C 组调用点清单现显式记录 5 个 shared-boundary 路径；scanner 仍只把其中四个可见路径识别为 generation lifecycle，不再发现 profile/ledger mutation。视频 helper SHA-256 `3053ffed53d43b22c45218df9dda4a97798d681428a6679cd68dd7158ba288f3`；slideshow SHA-256 `3c4ead5221728af4f9185f9cd1e37b7f61613aa7afe51cf79fa5d11359a0c904`；studio assembly SHA-256 `67bc94245f2806bb45a78c5bb78f9d9a61bf63938d4245f48712271ee6eee401`
  - C 组离线回归：Batch 2 `444/444` 且 `0/77` offline；视频合约 `599/599`；TypeScript 通过。验证器 SHA-256 `23e01e7f1077ca2443046b4b359242f745bf5cff209164e47653f95136668ef4`；调用点清单 SHA-256 `ed77f973583dc37c56ebc51837dff1bf91d4319d6a5b07b77de57fa18817a953`；18 文件锁清单 SHA-256 `98718fbe067674660387b515be85b02d2ebe19f40e9fcc030be8578d19fc8779`
  - 00:21 第三小批 D 组 9 个普通任务入口已全部完成本地改造：
    - `characters/generate`、`characters/generate-sora-character-video`、旧 `generate` 内存任务、`generate/video`、`generations`、`seedance/submit`、`seedance/status`、HappyHorse status 与 Sora status 均已把 consume/refund 迁移到 `applyTaskCreditDelta` 或已改造的共享 wrapper
    - 外部路由以认证用户为准；通用视频与 Seedance 提交拒绝请求体用户不匹配；通用视频、Seedance status、HappyHorse status 与 Sora status 均在查询供应商前证明 generation 所有权
    - 角色 Sora、通用视频与 Seedance 提交使用服务端 UUID 作为 generation/billing task 身份；provider 或 generation 持久化失败时使用同一 task 身份原子退款；旧内存任务 DELETE 使用实际 `credit_cost` 而非硬编码 50
    - Seedance/HappyHorse 失败退款以 generation id 锚定；Sora status 根据 generation metadata 在 `character-video` 与 `sora-status` scope 间选择，并通过旧状态 CAS 只允许一个终态赢家退款
    - scanner 在这 9 个路径中不再发现 profile/ledger mutation，只保留应有的 generation lifecycle；5 个视频共享路径加 9 个普通任务路径，共 14 个路径已被 shared-boundary 语义守卫显式追踪
  - D 组完整离线回归：Batch 2 `457/457` 且 `0/77` offline；生成意图 `122/122`；视频合约 `599/599`；TypeScript 通过。验证器 SHA-256 `00261b2ff89d32396346e4f1ac6c19f03b5d46e4b4e857abdcb764174cc72431`；调用点清单 SHA-256 `25c33ae341a83ee4efff0487b583d1bc891f7bdc7412b391fc67ecd12dda43b1`；18 文件锁清单 SHA-256 `8da4bbd3cd58cb060d89dcbe4a8bdfb9200d807f6138ab5ca2eaff006f81f51d`
  - 00:23 换窗前安全复核：分支、HEAD 与工作树计数和上述检查点一致；`git diff --check` 通过（仅出现工作区换行提示，无 whitespace error）；没有 `psql` 进程，唯一 Node PID 11032 来自 Codex 自身 `cua_node` runtime、启动于 19:59，并非本任务验证器；当前没有数据库连接、远程写入、供应商调用或持有中的凭据
  - 00:27 新接力窗口已从头到尾完整读取本方案，并精确核对权威目录、分支、HEAD、32 个已跟踪修改/16 个未跟踪状态项和 `psql=0`；无现场漂移后才开始 E 组
  - 00:37 第三小批 E 组 4 个图片任务入口完成：
    - Quick Image 的 consume 与 activation/worker refund 均改为 `applyTaskCreditDelta`，task identity 固定为服务端生成的 `generationId`，不再使用可由请求影响的 provider task id 作为账务身份
    - Image Factory submit 以现有电商任务 UUID 为 task identity，并在任务元数据中 CAS 持久化 `billing_attempt`；每次 consume 使用 `consume-a<attempt>`，同一任务在整笔退款后重试会进入新 attempt，不会复用已退款的 consume anchor
    - Image Factory submit/status/worker 的部分退款 operation 同时绑定 billing attempt、失败数与总数；新 task-scoped 流水按 `task_id + pricing_version` 计入累计退款，历史 `reference_type/reference_id` 流水只在第一 attempt 兼容读取，避免跨 attempt 重复或少退
    - Image Factory status 在任何 Nano provider 查询前仍先证明认证用户对任务的所有权；图片 worker 保留历史只读退款探针，但 Quick/e-commerce 的所有新余额与流水写入均只经过原子边界
    - 四个路径均无直接 profile 更新或 credit ledger 插入；scanner 现为 29 个可见 mutation 路径，shared-boundary 守卫从 14 个扩展为 18 个，其中 Quick route 与 worker 只保留 generation lifecycle，两个纯积分路径从 scanner 基线中经人工裁决移除
  - E 组完整离线回归：Batch 2 `466/466` 且 `0/77` offline；生成意图 `122/122`；视频合约 `599/599`；TypeScript 通过；diff-check 通过（仅换行提示）。Quick route SHA-256 `b3d43e885b212a7504f0d314606fb1925698a517ae099df789d0990238f55a94`；Image Factory submit SHA-256 `32bd982bac1b4e2b1c5705739b787d7fd2cf0506a537471690c68f4148ab4269`；status SHA-256 `bbafd162ad5ddc54a55accdd93408d300eabad3a031ad0a66048de90b9b45678`；worker SHA-256 `8ec5022e1291ab5742a618aa842381e34c6817492e0bcc3590b84b85082c991c`；验证器 SHA-256 `c9fd798cd53b682078b02e09ed7d995d1c313c2f3fb63faf9347687161e04fd0`；调用点清单 SHA-256 `4c9cf34d27c303292aca5047e8adf0a1b0ee2cb456ba488dacc09483932b107a`；18 文件锁清单 SHA-256 `dbdd89ac9f745d222cfd0004e5ba4d194f0aa6f5c783284ac825470dbc639ad4`
  - 00:47 第三小批 F 组 2 个合约入口完成：
    - `src/app/api/contracts/route.ts` 的新签约与 POST/PUT 续约已统一使用 `applyTaskCreditDelta`；买方 `buyer-consume`、失败补偿 `buyer-refund` 与社区创作者 `creator-grant` 分别形成 task-scoped 原子流水，社区发布价、官方四周期价格和 100% 创作者收益比例保持不变
    - 新签约在扣费前由服务端生成 contract UUID，并以 `contract:<uuid>:create` 同时绑定扣款、插入失败退款和创作者 grant；不再直接更新 profile 或手工插入流水
    - 续约先以 contract 旧结束时间、累计已付、周期和目标结束时间形成 stage key，再 CAS 持久化 `canvas_p1_contract_billing` pending 任务；扣款后用 `end_date + credits_paid + updated_at` CAS 同步提交合约与 applied 状态，冲突时只在不能证明同 task 已提交后执行同 task 原子退款并标记 refunded
    - `src/lib/actions/contracts.ts` 现从 Supabase Auth 派生买方身份并拒绝传入 `userId` 不匹配；服务端生成 contract/task UUID，使用管理客户端执行显式用户范围读写，并以相同 task identity 完成买方扣款、插入失败退款和社区创作者 grant；原 daily/weekly/monthly/yearly 乘数保持不变
    - 两个路径均无直接 profile credit 更新或 credit ledger 插入；scanner 从 29 个降为 27 个可见 mutation 路径，shared-boundary 守卫从 18 个扩展为全部 20 个已裁决路径（含底层 wrapper/隐藏消费者）
  - F 组完整离线回归：Batch 2 `472/472` 且 `0/77` offline；生成意图 `122/122`；视频合约 `599/599`；TypeScript 通过；diff-check 通过（仅换行提示）；`psql=0`。Contract API SHA-256 `35627cebb260d0aecf3e2ef40735bddd91bd1d90eb9390f71c2735a356bf5167`；contract action SHA-256 `34378f30f333b539c12b1617fac5465e4f5bc35cfdf739a6ad937f2d1be8f00d`；验证器 SHA-256 `4f5f47502d41906375df9e060bc4e7e97398d2490d3651c094500a9de234f498`；调用点清单 SHA-256 `cf8ae14b6a803029a1302bd69bd89176ea24509ab3ff5b97af4037deb902b2f1`；18 文件锁清单 SHA-256 `045580f964aaeadc16ff24441d07648c21ae6b0b64546bda70d2260a31b6d0ee`
  - 00:53 账户停用阻断完成：`src/app/api/admin/users/route.ts` 保留旧 `action="delete"` 请求与响应兼容字段，但分支内已移除 contracts/generations/credit_transactions/profile 与 auth user 的全部硬删除；改为唯一调用 service-role 专用 `canvas_p1_deactivate_account_v1`，验证返回用户、banned 状态、匿名化标志与保留流水数。重复停用沿用 RPC 幂等语义，不释放流水、快照、外键或 operation anchor
  - legacy-only 收尾复核纠正了原冻结分类：原 16 项中的 slideshow、models submit、models status 是 C 组已转换的隐藏共享积分消费者；最终 13 个 lifecycle-only 路径逐文件守卫确认无 profile/ledger mutation、无 task credit helper 或旧 video credit helper。调用点 scanner 仍为 27 个，其中 13 shared-boundary lifecycle、13 legacy-only、1 converted deactivation
  - Phase 4 最终离线回归：Batch 2 `487/487` 且 `0/77` offline；生成意图 `122/122`；视频合约 `599/599`；TypeScript 通过；diff-check 通过（仅换行提示）；`psql=0`。Admin users route SHA-256 `060966d568bd36bd7301e2323f87ff40750b37ab28169f2a32758b106d676781`；验证器 SHA-256 `014893f3a975c9c9368fe4b0c9e098ea6017cd677fc248f92a9df4a906daf5ca`；调用点清单 SHA-256 `4f04914303504beb61d66f09da30b84ce7f96511843db10627b70d9b8eb3c227`；18 文件锁清单 SHA-256 `7703f6faac1f7c1693c966e48acbd4beda866f5a14e380fe1df193b5a80b2916`
- 外部阻断：Phase 4 本地改造无未关闭代码阻断；当前 task-scoped 候选迁移与 77 场景尚未在线重跑，因此只能报告 Phase 4 离线绿色，不能报告当前候选目录或运行时已通过。下一阶段需要 Preview 数据库连接；本接力的明确边界禁止数据库连接/远程写入，生产仍硬拒绝
- 上下文状态：上一窗口发生第 2 次压缩后已安全换窗；当前接力窗口已完整读取本方案、核对检查点并完成 E-F、账户停用与 legacy-only 收尾，当前窗口压缩计数 1；下一步将进入新的高风险 Preview 阶段，按 7.1 主动换窗，不在本窗口继续
- 已有授权：正式开工；本方案内本地修改与离线验证；精确 Preview Branch 的只读检查、五个锁定迁移和测试写入；仅对 `canvas-p1-staging`（ref `liibsugstuidwlmliyif`）重置数据库密码。用户于 2026-07-27 23:49 再次明确该重置授权；已完成的 Preview 密码重置无需重复执行，生产密码和生产项目继续硬拒绝
- 尚未授权：生产；付费调用；推送/合并/部署；删除 Preview 或重置 Preview 分支/数据库内容
- 下一唯一动作：新执行窗口必须先从头到尾完整读取本方案并核对权威目录、分支、HEAD、39 个已跟踪修改/16 个未跟踪状态项、`psql=0` 和上述四个最终哈希；无漂移后，仅对 Preview `canvas-p1-staging` / ref `liibsugstuidwlmliyif` 执行封闭的 `--remote-preflight` 服务端 READ ONLY 检查，确认身份/TLS/PG17.6/冻结 post-apply 目录/六个测试数据面为零后停止并报告。preflight 通过前禁止迁移或场景写入；生产 ref `hfabrifuvujpdzarlbky` 永久硬拒绝
- 2026-07-28 10:16 新空白执行任务已从第 1 行到第 519 行完整读取本方案；权威目录、分支 `claude/canvas-p1-generation`、HEAD `8bb58dba12d38f3984ba8d07935325bd1c09ea4d`、39 个已跟踪修改/16 个未跟踪状态项与 `psql=0` 均和检查点一致
- 本次接管无漂移证明：信用迁移、task helper、场景、runtime 的 SHA-256 分别仍为 `d6d1ad82472806fb3284070cbcdc53267709a4593976b67e1e271c98951814c2`、`e77e8db247db3e5c181cd8a04091cf3a856402f921f8ecea0bc47c0be20a2d2d`、`2f7ad37359c6519b77acc31067742269fd2b7623f82cfd5832f5e48ada0e93af`、`b78593455a2d6e05ca6f8e6daeb70823fdaca353674276b75586338d5876eb39`；Admin users route、验证器、调用点清单、18 文件远程锁清单的 SHA-256 也逐项等于检查点最终值；CA 为 1367 bytes、SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`
- 本次离线门禁重新通过：Batch 2 `487/487`，明确 `0/77` offline、零数据库接触。Supabase 已登录页面 URL 精确包含 `/project/liibsugstuidwlmliyif/`，页面唯一显示 `canvas-p1-staging` 与 `Preview`；Connect 对话框显示锁定 Session Pooler `aws-1-us-east-2.pooler.supabase.com:5432`、数据库 `postgres`、用户 `postgres.liibsugstuidwlmliyif`，未打开或执行生产 SQL
- 当前执行环境原先缺少 `psql` 客户端；已从 PostgreSQL 官方下载页指向的 EDB 免安装二进制包，在 Git 忽略目录 `.temp/tools/` 准备 `psql 17.10`，其 `pgsql/bin` 69 个归档文件完整，未安装/初始化/启动本地 PostgreSQL 服务或数据目录。包 SHA-256 为 `f9aafca58e7026a1ef2caeee711acf761671e57904d430adc85f468374f5a821`，`psql.exe` SHA-256 为 `e0113742a0520185e6dcaf90dafbfd15b02633218d311715f3400613c206d1dc`
- 10:16 外部阻断：当前进程环境无 `PGPASSWORD`，Dashboard 仅显示 `[YOUR-PASSWORD]` 占位符，且上一执行链已按方案清除一次性凭据；因此封闭 `--remote-preflight` 尚未启动，当前无验证器/psql 进程、无数据库连接、无远程写入。遵照用户“Preview 密码无需再次重置”，未点击或执行密码重置；生产凭据从未读取、替代或重置
- 下一唯一动作：用户把**现有** `canvas-p1-staging` Preview 数据库密码临时放入系统剪贴板并明确回复“已复制”后，本窗口只读取该次明确提供的剪贴板值，在进程内临时设置 `PGPASSWORD`，使用上述免安装客户端执行锁定的 `CANVAS_P1_TARGET=remote`、`CANVAS_P1_REMOTE_REF=liibsugstuidwlmliyif`、固定 CA、`--remote-preflight`；命令结束立即清除进程变量和剪贴板。preflight 通过前继续禁止迁移或场景写入，生产 ref `hfabrifuvujpdzarlbky` 永久硬拒绝
- 10:29 用户明确授权查看精确 URL `https://supabase.com/dashboard/project/liibsugstuidwlmliyif/sql/bcd61103-c891-4e96-b5fa-93615e04e802?showConnect=true&connectTab=direct&method=session`。已在登录态页面再次确认 `canvas-p1-staging` / `Preview` / ref `liibsugstuidwlmliyif`；Connect 对话框只显示 `postgresql://postgres.liibsugstuidwlmliyif:[YOUR-PASSWORD]@aws-1-us-east-2.pooler.supabase.com:5432/postgres`，没有密码输入框、现有密码回显或一次性凭据。唯一密码相关控件为 `Reset database password`，未点击；未运行 SQL、未连接数据库、未产生远程写入，`psql=0`、Canvas P1 harness 进程为 0
- 10:29 阻断与下一唯一动作不变：必须取得**现有 Preview 密码**，或由用户另行明确授权再次重置仅此 Preview 密码；生产凭据和生产项目始终硬拒绝。在此之前不得启动 `--remote-preflight`，更不得迁移或运行场景
- 10:43 用户已在 Dashboard 成功重置仅 Preview 密码；页面随后显示完整、无占位符的 Session Pooler URI。URI 在受控内存中通过 ref `liibsugstuidwlmliyif`、主机 `aws-1-us-east-2.pooler.supabase.com`、端口 5432、数据库 `postgres`、用户 `postgres.liibsugstuidwlmliyif` 与生产 ref 缺席检查；凭据从未回显或落盘，浏览器/系统剪贴板已清空，任务专用子进程变量已清零
- 10:43 第一次 `--remote-preflight` 在密码刚重置时被 Pooler 以认证失败拒绝；15 秒后使用 Dashboard 当前完整 URI 重试，已成功到达服务端 READ ONLY 目录闸，但进程退出 1。失败原因是 CLI 的 `--remote-preflight` 分支固定调用 pre-apply 清单，而当前 Preview 已知处于上一候选的 post-apply 状态；错误精确列出 post-apply 对 pre-apply 的 14 个段差异。两次均未应用迁移、未打开写会话、未运行场景；当前 `psql=0`、harness 进程为 0、生产 ref 未参与
- 10:43 安全停止与本地裁定：方案下一唯一动作明确要求同一个只读 `--remote-preflight` 验证“冻结 post-apply 目录/六个测试数据面为零”，但实现硬编码 pre-apply 清单，二者语义不一致。仓库已有独立 `assertRemotePostApplyWriteAllowed`，会在同一封闭 READ ONLY 通道精确验证六个测试数据面与冻结 post-apply 18 段；下一步仅在本地把 `--remote-preflight` 改为必须显式选择 `CANVAS_P1_REMOTE_STATE=preapply|postapply`，补强静态无写守卫、更新 18 文件锁并跑离线门禁。离线全绿前不再连接 Preview；post-apply preflight 通过前禁止迁移或场景写入
- 10:50 preflight 状态语义修复已完成：`--remote-preflight` 现在必须显式声明 `CANVAS_P1_REMOTE_STATE=preapply|postapply`，分别只调用现有 pre-apply 或 post-apply READ ONLY 精确目录闸；静态守卫同时要求两条只读调用、显式状态与写能力缺席。离线门禁仍为 `487/487`、`0/77` offline，diff-check 通过；验证器 SHA-256 `f646a98dba0de87084983ca81b6e9b1a8d47106a8b11289436092828c5ab1d0e`，18 文件远程锁清单 SHA-256 `ac12e2916a23a0f5c30f968350305af8e0f8b0f77ca3750a1d2e189372b089c6`
- 10:50 显式 post-apply `--remote-preflight` 正式通过：URI/ref/允许主机校验通过且生产 ref 缺席；浏览器剪贴板与任务专用密码变量已清空。服务端证明 `transaction_read_only=on`、PostgreSQL `17.6`、数据库 `postgres`、后端用户 `postgres`、`auth.users` TRIGGER 权限有效；`profiles/generations/credit_transactions/canvases/generation_quota_buckets/auth.users` 六面全部为 0；冻结 post-apply 18 段精确匹配，digest `daa49d6ce71dcd70b7151ddeb147c2a42b35f536cf9bac3ad51f2406fa428693`。未应用迁移、未打开写会话、未运行场景，生产 ref 未参与
- 10:50 **下一次远程写入前检查点**：唯一目标仍为 `canvas-p1-staging` / ref `liibsugstuidwlmliyif` / Session Pooler `aws-1-us-east-2.pooler.supabase.com:5432` / 数据库 `postgres` / 用户 `postgres.liibsugstuidwlmliyif`；分支 `claude/canvas-p1-generation`、HEAD `8bb58dba12d38f3984ba8d07935325bd1c09ea4d`。已授权的下一写入仅限五个锁定迁移的当前候选应用/重放和随后的测试数据；生产、付费调用、推送、合并、部署、删除/重置 Preview 继续未授权。执行前必须先确认捕获路径从冻结旧 post-apply 出发、只应用五个固定 SHA-256 文件并在普通场景前强制停止
- 10:58 **候选迁移远程写入前最终检查点**：捕获路径现必须显式 `remoteState=preapply|postapply`；本轮固定为 `postapply`，先通过冻结旧 post-apply 18 段和六面零数据闸，随后只调用 `applyLockedMigrations` 两次，每次同一事务执行五个固定 SHA-256 迁移，之间只采集脱敏目录，结束前不会进入普通场景。普通 runtime 的静态守卫仍只允许 postapply。离线门禁 `487/487`、`0/77` offline，diff-check 通过，`psql=0`
- 10:58 当前远程执行锁：验证器 SHA-256 `2a15ade1b8ced10bc5cc9b4ee37c8cf33eaa00635dd47edaaec8932e25d7be59`；runtime SHA-256 `7112c5178c1507c9fc12ddf8077eb4c8ac489158f8a4d8cf9dd7517e97599d3b`；18 文件远程锁清单 SHA-256 `5a4fa968842627bd2fe7829a15ddce80b16b9e53348552eaf612582272d99293`。五个迁移 SHA-256 仍为 `2949cfe12695923fa0c441cb79d82db73abd84225a5b7c3cc348c9876e788555`、`c525036a97c01c90bf92a684afae9403c4b02876a4281e298bd22507853594dd`、`d6d1ad82472806fb3284070cbcdc53267709a4593976b67e1e271c98951814c2`、`7275f5bb1c3c8e76c94dbcb180e39a679eedfed889806796f76a7eef9d319638`、`6bf13cba88842ba173883fd6f0dd7d1d7b4d95cabd72d74e1280000522608524`
- 11:00 **候选迁移远程写入后停止检查点**：`--capture-post-apply` 已通过本地 URI/ref/主机/生产缺席校验并启动，但任务专用子进程在 50 秒时限返回 `ETIMEDOUT`，没有交付首次应用、目录采集或重放的任何最终输出，因此本轮严禁判定成功或失败。超时后验证器与所有 psql 子进程均已退出（`psql=0`、harness=0），浏览器剪贴板和任务专用密码变量均已清空；生产 ref 未参与
- 11:00 远程状态当前为**未证明**：超时可能发生在旧 post-apply 读闸、首次事务、第一次目录读取或后续步骤中的任一位置。下一唯一动作只能重新执行显式 post-apply 的封闭 READ ONLY preflight：若冻结旧 post-apply 18 段仍精确匹配，证明首次候选事务未改变最终目录；若不匹配，则停止写入并新增只读中断捕获清单来审阅当前目录。任何结果明确前禁止重试迁移、重放或运行场景
- 11:02 超时后的显式 post-apply READ ONLY 恢复证明通过：六个测试数据面全部为 0，冻结旧 post-apply 18 段重新精确匹配，digest 仍为 `daa49d6ce71dcd70b7151ddeb147c2a42b35f536cf9bac3ad51f2406fa428693`；因此前一超时进程没有改变最终远程目录。浏览器剪贴板和密码变量已清空，生产 ref 未参与
- 11:02 **候选迁移重试写入前检查点**：执行面、五迁移哈希、`487/487` 离线门禁与 10:58 锁清单均未改变；远程起点已重新证明为旧 post-apply + 六面零数据。唯一调整是取消本地 50 秒硬杀，改用单一异步受控子进程并以小于 60 秒的轮次分段等待；该进程仍只执行同一个 `--capture-post-apply` / `remoteState=postapply` 封闭路径，凭据只存在于获准子进程环境，完成后必须确认所有验证器/psql 退出并立即写入后检查点
- 11:06 **候选迁移重试远程写入后检查点**：单一异步 `--capture-post-apply` 正式退出 0；冻结旧 post-apply 闸通过后，五个锁定迁移首次应用、脱敏目录采集、相同五迁移重放与第二次目录采集全部完成，并在普通场景前强制停止。post-apply/reapply 均为 95,222 bytes，SHA-256 同为 `f45d91fcf9a4074ff440549c37cca512dc949158b0b0758897a13cf26f89e30f`；18 段 catalog digest 同为 `f3917b6ae457b2d1ba4cccd6d69fd0cad6bb2ae5668bd1e8f41519b70a6181a8`，目录 equality `PASS`
- 11:06 捕获目录：`.temp/canvas-p1-post-apply-hL1YjN`，仅含两份脱敏 JSON；所有验证器/psql 进程均已退出（`psql=0`、harness=0），浏览器剪贴板和任务专用密码变量已清空，生产 ref 未参与。本次还没有运行 77 场景或写入测试行。下一唯一动作是本地人工审阅新旧目录差异；只有差异精确等于 task-scoped 候选迁移预期且敏感扫描为零，才允许把新 post/reapply 证据冻结进仓库并更新 18 文件锁
- 11:09 新旧目录人工审阅完成：18 段集合完全一致，仅 `constraints` 段移除/新增各 1 行，唯一对象均为 `credit_transactions.ct_action_identity_required`；新定义精确增加“四个 action 身份字段全空且非空 trim(task_id)”的互斥 task-scoped 分支，其他 45 个约束和其余 17 段零漂移。新捕获无生产 ref、连接串/JWT/私钥/API key、例程正文或 `__UNPROVEN__`
- 11:09 新真实 post-apply/reapply 已冻结：`post-apply-catalog.json` 字节与捕获文件完全相同，SHA-256 `f45d91fcf9a4074ff440549c37cca512dc949158b0b0758897a13cf26f89e30f`；manifests SHA-256 `12877ced44b2dd10d6ab283d79e37fbdfc9f6fff54461f0fa474d90df390d52c`；runtime SHA-256 `7112c5178c1507c9fc12ddf8077eb4c8ac489158f8a4d8cf9dd7517e97599d3b`；验证器 SHA-256 `2a15ade1b8ced10bc5cc9b4ee37c8cf33eaa00635dd47edaaec8932e25d7be59`；18 文件锁清单 SHA-256 `d8427bd23f812ca4de2e0ae76d35567d832183260a76c6125cc873a04b5778e9`。离线门禁 `487/487`、`0/77` offline
- 11:09 冻结后的显式 post-apply READ ONLY preflight 再次退出 0：18 段匹配新冻结目录，gate digest `797966a9d3047589cbe3df5ac4996f252499a1318d7e3ec06cc36f3194b540c5`；PostgreSQL `17.6`、数据库/用户/TLS、TRIGGER 权限和六面零数据全部通过，凭据与剪贴板已清空，生产 ref 未参与
- 11:09 **77 场景远程写入前检查点**：唯一下一写入是 `--runtime` + `CANVAS_P1_REMOTE_STATE=postapply`；入口首先从仓库加载新冻结目录并再次铸造精确写闸，普通 runtime 无 preapply 路径。77 场景逐场景隔离、首错停止、每场景关闭 fan-out/屏障会话并按显式 UUID 定向清理；finally 关闭全部会话、清理残留、证明六面为零并比较最终 reapply 目录。生产、付费调用、推送、合并、部署、删除/重置 Preview 仍未授权
- 11:24 **77 场景远程写入后检查点**：单一 runtime 执行器正式退出 0；离线/静态门禁 `487/487`，线上 `executed=77, passed=77, failed=0, skipped=0`。入口 post-apply 闸证明 18 段；累计定向删除 67 个测试用户；`profiles/generations/credit_transactions/canvases/generation_quota_buckets/auth.users` 六个测试数据面精确为空；最终目录再次证明 18 个冻结段，全部门禁 `All gates OK`
- 11:24 所有验证器/psql 进程均已退出（`psql=0`、harness=0），浏览器剪贴板与任务专用密码变量已清空；工作树仍为 39 个已跟踪修改/16 个未跟踪状态项，分支与 HEAD 无漂移，生产 ref 从未参与。当前候选的五迁移首次应用、重放、新 post/reapply 冻结、恢复闸、77/77、定向清理与最终目录证明全部完成
- 11:24 下一阶段：进入 Phase 5/6，只执行无需真实付费供应商、生产写入、推送、合并或部署的 Preview/本地验收、构建、回归、积分对账和发布准备。真实图片/视频生成、TikTok 直发、生产迁移、推送/合并/部署继续等待用户最终检验或单独授权
- 11:40 **Phase 5/6 本地门禁完成**：checklist 对账通过；P0 D1-D6/S1-S8、repair、canvas runtime 全部通过；Batch 2 `487/487`、生成意图 `122/122`、视频合约 `599/599`；TypeScript 通过；生产构建编译成功并生成 `143/143` 页面；仓库 Node 测试 `145/145`。`git diff --check` 仅有既有换行提示，无空白错误
- 11:40 两个旧 P0 验证器最初仍匹配被实测证据淘汰的虚构策略名 `Service can manage all generations`，因此各出现 2 个机械红灯；已改为同时证明删除真实 `allow_all` 与创建精确 `generations_service_role_all TO service_role`，迁移验证器 `82/82`、D6 验证器 `163/163`
- 11:40 **真人 UI 前生产硬拒绝**：只分类、不回显地检查本地应用环境，发现 `.env.local` 的 `NEXT_PUBLIC_SUPABASE_URL` 属于生产 ref `hfabrifuvujpdzarlbky`。因此未启动本地应用、未执行 UI API 或数据库请求，也未读取/复用其中任何凭据。真人 Preview UI 必须等待明确绑定 `liibsugstuidwlmliyif` 的 Preview 应用环境
- 11:40 远端 `main` 与本地 `main` 均为 `6fac3f0f8e2c6a6a35e6ca26cb03fcb6e283a64c`；相对共同祖先，`main` 的 38 个变更路径与当前候选 174 个变更路径交集为 0，`git merge-tree --write-tree HEAD main` 退出 0。未执行真实合并
- 11:40 已新增 `docs/SUPER_CANVAS_P1_RELEASE_RUNBOOK.md`：冻结五迁移/目录/执行锁哈希，明确生产单事务顺序、生产专用只读闸、应用放量顺序、只前进回滚、即时/5 分钟/30 分钟/24 小时监控阈值、Preview 真人与最小付费检验清单
- 11:40 本地候选已拆为未推送提交：`c0f2989` 跨平台验证载入、`16264ff` 数据库生命周期底座、`ae30d76` 生成意图与积分合约、`1417003` 发布阻断调用点、`623e426` RLS 验证器对齐、`883dfa4` 上线验收手册。敏感形状扫描覆盖 78 文件；仅命中方案里的脱敏连接占位符和验证器的 loopback 假 URI，未发现真实 JWT、私钥、Supabase key 或带真实密码连接串；`.claude/`、`.temp/`、环境文件、证书均未跟踪、未暂存
- 11:40 远程锁清单仍为 `d8427bd23f812ca4de2e0ae76d35567d832183260a76c6125cc873a04b5778e9`，冻结 post-apply 目录仍为 `f45d91fcf9a4074ff440549c37cca512dc949158b0b0758897a13cf26f89e30f`，CA 仍为 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`；`psql=0`、Batch 2 harness node=0，无远程写入在途
- 11:42 **字节锁跨平台收口**：提交后检查发现 `core.autocrlf=true` 会让 16 个混合/CRLF 远程锁定文件在 Git 对象中规范化为 LF，Linux 新检出会产生机械哈希失败。已在 `.gitattributes` 将全部 18 个锁定文件及锁清单标记为 `-text whitespace=cr-at-eol`，以二进制精确保存已真实执行的原始字节；提交 `a6fd9b3` 仅固化相同工作树字节，不修改任何迁移/运行逻辑或冻结哈希
- 11:42 使用全新 `.temp` 目录执行 `git checkout-index` 模拟干净检出，18/18 文件对锁清单 `CLEAN_CHECKOUT_LOCK_MISMATCHES=0`；检出后的锁清单 SHA-256 仍精确为 `d8427bd23f812ca4de2e0ae76d35567d832183260a76c6125cc873a04b5778e9`
- 11:42 最终关键回归：迁移验证器 `82/82`、D6 `163/163`、生成意图 `122/122`、视频合约 `599/599`、Batch 2 离线静态 `487/487`、TypeScript、diff-check 全部通过；工作树除 `.claude/settings.local.json` 与本检查点外无其他改动
- 11:40 **下一唯一动作**：用户在明确指向 Preview ref `liibsugstuidwlmliyif` 的 Preview 应用中按发布手册 §3 完成真人 UI 和最小付费黄金旅程最终检验。通过前不执行生产迁移、真实合并、推送或部署；需要真实图片/视频/TikTok 时必须另行确认最小付费样本授权
- 更新时间：2026-07-28 12:32（Asia/Shanghai）
- 12:32 **新空白执行任务接管无漂移**：已从第 1 行到第 561 行完整读取本方案，并从第 1 行到第 168 行完整读取 `docs/SUPER_CANVAS_P1_RELEASE_RUNBOOK.md`。权威目录仍为 `E:\StarGaze\.claude\worktrees\canvas-p1-generation`，分支仍为 `claude/canvas-p1-generation`，HEAD 为最终检查点提交 `6e345a1bc79c3f25fc793600100103fb0db67811`；从 `8bb58dba12d38f3984ba8d07935325bd1c09ea4d` 到当前 HEAD 正好 8 个本地提交。工作树只有明确排除提交的 `.claude/settings.local.json`；P1 harness/psql 进程为 0
- 12:32 **冻结物无漂移证明**：五迁移 SHA-256 依次仍为 `2949cfe12695923fa0c441cb79d82db73abd84225a5b7c3cc348c9876e788555`、`c525036a97c01c90bf92a684afae9403c4b02876a4281e298bd22507853594dd`、`d6d1ad82472806fb3284070cbcdc53267709a4593976b67e1e271c98951814c2`、`7275f5bb1c3c8e76c94dbcb180e39a679eedfed889806796f76a7eef9d319638`、`6bf13cba88842ba173883fd6f0dd7d1d7b4d95cabd72d74e1280000522608524`；冻结 post-apply 目录仍为 `f45d91fcf9a4074ff440549c37cca512dc949158b0b0758897a13cf26f89e30f`，远程执行锁仍为 `d8427bd23f812ca4de2e0ae76d35567d832183260a76c6125cc873a04b5778e9`，CA 仍为 1367 bytes / `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`
- 12:32 **用户新增最终执行授权**：先在本地完成一次完整测试；本地成功后，直接部署到现有阿里云服务器正式环境并持续测试，直到线上全流程真正跑通或出现无法自行解除的外部阻断。授权覆盖本任务所需的本地同步/合并与修复、现有部署链需要时的 GitHub 推送、生产数据库受控迁移、阿里云正式环境应用发布，以及发布手册规定的最小线上验收；Vercel 完全排除在执行路径外
- 12:32 **授权限制保持生效**：不搭建或使用本地 PostgreSQL；本地 UI 只能连接 Preview `canvas-p1-staging` / ref `liibsugstuidwlmliyif`，禁止使用当前指向生产的 `.env.local`，也禁止把阿里云生产 Supabase URL/anon/service-role 三项复制给本地 UI；不执行真实支付交易，不删除/重置生产数据库，不广域清理，不改动现有用户数据。真实供应商样本严格限制为发布手册 §3.2：一张无敏感测试图、一次图片生成、一次图生视频、一次下载、一次可控失败退款、一次连续点击幂等验证；TikTok 仅在能够精确确认测试/私有账号时直发并核对 AIGC 标注，否则停止该步骤并报告
- 12:32 **阿里云正式环境路径**：本地全绿后，先对现有阿里云服务器做只读盘点，精确确认代码目录、当前 Git SHA、进程管理、反向代理、端口、域名、环境变量键名、磁盘、备份/PITR 与回滚方式，盘点阶段不得修改服务。生产 Supabase ref 固定为 `hfabrifuvujpdzarlbky`；生产预检与迁移只使用发布手册规定的独立生产操作单，Preview harness 的生产硬拒绝不得削弱。应用发布必须使用保留当前线上版本的 release 目录/锁定构建产物/原子切换方式，先单实例或最小流量验证，任何身份、备份、迁移、构建、健康或回滚歧义立即停止写入并恢复/报告
- 12:32 **生产写入纪律**：每次生产写入和服务切换前后均须更新本永久检查点。生产五迁移先做固定哈希和只读 preflight，完全匹配后才允许按 `20260715` → `20260716` → `20260717` → `20260718` → `20260719` 在同一个 PostgreSQL 事务中执行；任一失败整批回滚并停止应用发布。post-apply 的目录、ACL、触发器、账本和生命周期函数全部通过后才允许发布应用
- 12:32 **下一唯一动作**：只读检查 Git 与阿里云现有部署拓扑和环境变量键名，不回显任何值；确认本地 Preview 专用 UI 凭据的安全来源后，获取最新 `origin/main` 并将其合入 `claude/canvas-p1-generation`，逐文件审查冲突。禁止在完整本地门禁与线上候选确认前把功能分支合入 `main`

### 2026-07-28 14:25（Asia/Shanghai）第二次上下文压缩安全检查点

- 当前分支仍为 `claude/canvas-p1-generation`，候选 HEAD 为 `c411a7e6b99ddbc28bcd7306a547571f9dbaf38c`；它是把 `origin/main@6fac3f0f8e2c6a6a35e6ca26cb03fcb6e283a64c` 合入候选分支后的无冲突合并提交。尚未把功能分支合入 `main`，尚未向生产执行任何迁移、应用发布、服务切换或其他写入；阿里云盘点仍保持只读。
- 本地 UI 始终只连接 Supabase Preview `canvas-p1-staging` / ref `liibsugstuidwlmliyif`，独立端口为 `3217`，付费供应商与支付键均为空；当前指向生产的 `.env.local` 未被本地 UI 使用。Preview 凭据仅通过进程内临时注入，未写入 Git、方案或持久日志。
- Runbook §3.1 已完成创建/编辑/自动保存/刷新恢复、复制、撤销/重做、连线、分组/解组、节点双击、双标签只读与接管、30 秒断网恢复、1366×768 视口等人工流程。测试身份为 `canvas-p1-ui-1785214062750-33c1d21d@test.invalid` / `98503240-4e6a-4e7a-b2dc-c4ff71479bf0`，测试画布为 `47b2a4fc-8662-4b07-a67d-cf8ac1cafd60`；仅允许在验收结束后定向清理这些可识别测试数据。
- 为解决 Windows 交互自动化对高频页面操控的安全拦截，当前工作树保留了**未提交、仅供本地测试**的性能探针：`src/components/canvas/canvas-benchmark-probe.tsx`、`src/components/canvas/canvas-root.tsx`、`src/components/canvas/nodes/media-node.tsx`，以及被忽略的 `.temp/run-canvas-benchmark.ps1`。探针只在构建变量与 URL 参数同时启用时工作；完成本地 UI 门禁后必须删除探针、重新执行完整构建与回归，禁止把探针带入候选提交或服务器。
- 页面内实测证据：100 个文本节点加 30 个视频节点加载 30 张本地海报后，JS 堆从 62.3 MB 降至 GC 后 20.9 MB，满足 `<800 MB`；200 个布局后的文本节点执行真实 `setViewport()` 平移/缩放时平均 `67.9 FPS`、最小 1 秒桶 `59.3 FPS`、p95 帧 `24.9 ms`，满足 `≥50 FPS`。
- 自动保存性能门禁**尚未通过**：精确 100 节点的实际 PATCH 样本为 `1238.2 / 1585 / 836.7 / 1299.5 / 778.1 ms`，受本地到 us-east-2 Preview 的认证与 REST 往返影响，低于 1 秒并不稳定，中位数仍高于 1 秒。禁止在此已知失败解决并完整回归前进入阿里云生产写入。
- 已在精确 Preview 画布中定向注入一个 `position.x="not-a-number"` 的坏文本节点，事务返回唯一目标画布、`rev=52`、注入节点数 1、写入锁已清除。重新打开本地画布后已证明 `whiteScreen=false`、恢复界面存在、坏节点提示存在且仅渲染该恢复节点；尚未通过 UI 删除坏节点和刷新复验。
- **下一唯一动作**：在 `http://127.0.0.1:3217/canvas?id=47b2a4fc-8662-4b07-a67d-cf8ac1cafd60&benchmark=1` 的恢复界面中，通过产品 UI 删除坏节点并确认修复成功，再刷新页面证明安全文档已持久化且不会重新进入恢复态。完成后再解决自动保存 `<1s` 的不稳定门禁；两项均通过、移除临时探针并全量回归前，不得进入生产写入。

### 2026-07-28 14:36（Asia/Shanghai）Canvas 恢复成功检查点

- 新执行窗口已按要求从第 1 行到第 580 行完整读取本方案，并从第 1 行到第 168 行完整读取 `docs/SUPER_CANVAS_P1_RELEASE_RUNBOOK.md`。权威目录、分支 `claude/canvas-p1-generation` 与预期一致；当前 HEAD `783ccc9ab2551f28434f1421b960752d8888dd5a` 是上一检查点内容的纯文档提交，来源已查明，无未知提交漂移。
- 已在精确本地 Preview UI 画布 `47b2a4fc-8662-4b07-a67d-cf8ac1cafd60` 中通过产品“删除损坏节点”入口和二次确认框删除唯一坏节点。操作完成后恢复横幅与坏节点卡片/删除入口均为 0，正常编辑按钮重新启用。
- 随后执行真实页面刷新；服务端重新加载的画布为 `nodes / edges = 0 / 0`，恢复横幅、坏节点卡片和删除入口均未重新出现，证明安全文档已持久化且不会重新进入恢复态。刷新后的新会话短暂显示另一会话只读租约横幅，但这不是坏文档恢复态，也不影响上述持久化证明。
- 当前仍无生产数据库写入、生产迁移、应用发布或服务切换。工作树仅保留明确的本地性能探针修改、未跟踪探针文件、永久检查点修改和排除提交的 `.claude/settings.local.json`。
- **下一唯一动作**：查明并修复精确 100 节点自动保存 PATCH `<1s` 不稳定门禁；完成后移除全部临时性能探针，重新执行完整本地构建与回归。两项全绿前继续禁止生产写入。

### 2026-07-28 15:57（Asia/Shanghai）Canvas 保存链路与无探针候选检查点

- 已把健康当前版本保存从“Auth 远程验证 + REST 读取 + CAS 写入”的三次跨区往返收敛为一次 RLS 保护的 CAS：GET/修复/成功 PATCH 返回以生产 `SUPABASE_SERVICE_ROLE_KEY` 作 HMAC 密钥、仅绑定 `canvas id + rev` 的 43 字符不透明保存凭证；PATCH 只用本地 cookie session 做存在性闸，JWT 真伪和 own-row 授权仍由 PostgREST 与 RLS 完成。恢复态、旧/未来 schema、无效凭证和零行 CAS 均失败关闭或回落原完整判定路径，不会绕过恢复或版本冲突。
- 有凭证的客户端保留完整 op 在用户隔离的 durable queue 中，但线上只发送严格当前快照、空 `ops` 与精确 `opCount`，收到相同计数和新 rev 后才 ack；100 节点实测请求体为 `24,052 bytes`。确定性路由证明为 `0 read + 1 CAS`，伪造/失配凭证不触库，旧全 op 客户端仍可走原判定路径。曾验证的并发对冲方案因放大 Preview 负载且不能消除公网共因长尾，已从最终源码和测试完全撤回。
- 精确 Preview UI 的 100 节点单次样本 `787 ms` 满足 runbook §3.1 的 `<1s`；最终 8 个序列样本为 `787 / 1295.1 / 1087.9 / 316 / 565.5 / 771.4 / 810.2 / 10943.7 ms`，中位数约 `779 ms`。后续压力样本透明证明上海到 `us-east-2` Preview 仍有不可由应用代码保证的公网长尾，因此生产健康闸仍须结合阿里云部署地域做只读网络盘点和最小流量在线观测，不能把本地单样本误写成公网硬 SLO。
- 最后一次 `200` 保存后刷新，服务端重新恢复精确 `100 / 0` 节点和 100 个 `Autosave benchmark 8-*` 文本节点；恢复横幅与“删除损坏节点”入口均为 0，证明压缩快路径的 ack 对应真实持久化。Preview 临时测试登录过期后，仅对既有测试用户 `98503240-4e6a-4e7a-b2dc-c4ff71479bf0` 设置过一次新的随机临时密码并经产品 UI 登录；密码与 Preview service key 均已从受控内存清除，未写入文件、日志或提交。
- 全部本地性能探针已从源码删除；最终 Preview 专用生产构建为 `143/143` 页面，`.next` 中 Preview ref 命中 175 个文件、生产 ref 命中 0、探针字符串命中 0。完整门禁：迁移 `82/82`、D3 `233/233`、D5 `211/211`、D6 `163/163`、生成意图 `122/122`、视频合约 `599/599`、Batch 2 静态 `487/487` 且离线 `0/77`、schema `119/119`、shadow `162/162`、runtime `544/544`、repair `128/128`、S1–S8 全绿、checklist 对账通过、仓库 Node 测试 `158/158`、TypeScript、`git diff --check` 全部通过。
- 五迁移 SHA-256 仍逐字匹配 runbook：`2949cfe12695923fa0c441cb79d82db73abd84225a5b7c3cc348c9876e788555`、`c525036a97c01c90bf92a684afae9403c4b02876a4281e298bd22507853594dd`、`d6d1ad82472806fb3284070cbcdc53267709a4593976b67e1e271c98951814c2`、`7275f5bb1c3c8e76c94dbcb180e39a679eedfed889806796f76a7eef9d319638`、`6bf13cba88842ba173883fd6f0dd7d1d7b4d95cabd72d74e1280000522608524`。截至本检查点，生产数据库、生产应用和服务切换仍为零写入。
- **下一唯一动作**：在不回显任何值且不改变服务的前提下，继续现有阿里云正式环境只读盘点，确认部署目录、当前 SHA、进程/反代/端口/域名、环境键名、磁盘、生产 Supabase ref `hfabrifuvujpdzarlbky`、备份/PITR、回滚和部署地域到 Supabase 的健康条件。身份、备份、健康或回滚任一歧义保持生产写闸关闭；只读盘点清楚后再冻结候选提交。

### 永久检查点（2026-07-28 16:28 CST，生产只读盘点与迁移兼容闸）

- 生产应用目标已由三条相互独立的只读证据固定：`toryxai.com` 与 `okspeakai.com` 均解析到 `123.56.75.68`；该主机实例元数据为 `cn-beijing / cn-beijing-f / i-2ze6lo7hpqlhqfx52ggw / ecs.c9ae.large`；root SSH 中现有 Next 应用目录为 `/var/www/tiktok-ai-mcn`，分支 `main`、当前/远端 SHA 均为 `6fac3f0f8e2c6a6a35e6ca26cb03fcb6e283a64c`，PM2 `tiktok-ai-mcn` 监听 `3000`，Nginx 仅把 `toryxai.com` 转发到该端口。`okspeakai.com` 是 `/opt/okspeak` 与 `8788` 的独立服务，本次绝不切换。主机为 Ubuntu 24.04.3，40G 磁盘剩余约 23G。
- 当前登录的阿里云控制台账号在北京资源列表中显示 0 台 ECS/SWAS，无法作为资源归属证据；部署目标身份改由域名 DNS、实例自身元数据、现有应用/进程/反代和无交互 root SSH 的一致性固定。该“控制台资源列表可见性”差异不改变目标主机，但若后续任一主机元数据、DNS、应用目录或端口证据漂移，立即关闭写闸。现有正式应用不具备 release symlink；发布必须以精确候选 SHA 建立独立 release，候选先在 `3001` 健康验证，保留旧 `3000`，仅原子切换 `toryxai.com` 且以原配置作为即时回滚。
- 生产 Supabase 已在 Dashboard 内固定为组织 `xuzone888` 的 `Tiktok Ai / main / Production`，ref `hfabrifuvujpdzarlbky`，区域 `us-east-2`，PostgreSQL 17.6，状态 Healthy；服务器现有 `.env.local` 只核对键名并将 URL ref 去敏后验证为相同值，未回显或复制任何密钥。最新可见 scheduled physical backup 为 `2026-07-28 04:43:07 UTC`，至少保留至 7 月 21 日，Restore 可用；PITR add-on 未启用，因此本次以该上线前物理恢复点作为 runbook 的 backup/PITR 恢复闸，不擅自购买或开启付费附加项。
- 初始通用 Preview 目录清单在生产只出现两个预期外对象：`auth.users` 上 `public.handle_new_user()` 的既有 `on_auth_user_created`，以及多租户功能既有 `public.auto_create_tenant_for_user()` 的 `on_auth_user_created_create_tenant`。冻结迁移 `20260717` 会拒绝竞争触发器，故正式操作采用生产专用兼容包：在同一个 `BEGIN/COMMIT`、同一个 advisory xact lock 和固定超时内先精确验证 17 个前置目录段及两个触发器，再临时移除且仅移除租户触发器，逐字按固定哈希执行五个迁移，随后在提交前按原函数、事件、时序、粒度和 enabled 状态重建租户触发器，并以 18 个目录段和 ledger 守恒作后置断言。任一步失败会回滚迁移及触发器临时变化；外部会话不会观察到触发器缺失。既有租户函数、租户数据和用户数据均不修改。
- 生产只读活动闸：`profiles=31`、`canvases=0`、`generations=30839`、`credit_transactions=294`；generation 状态为 `completed=16761 / failed=10897 / processing=3181`。`processing` 全为历史遗留状态，最早 `2025-12-17`、最新 `2026-06-30`；最近 30 分钟新建 generation、最近 30 分钟 started、相关非 idle 数据库会话和其他非 idle 会话均为 0。不得为了上线修改这些历史行；维护闸只按最近活动与真实会话判定。
- 新增无凭证、无连接的确定性操作生成器 `scripts/canvas-p1-production-operation.mjs` 及 43 条安全断言验证器。其固定输出为：preflight `64,817 bytes / 50f1e5430a6329c94ca9c67c9042fca83049564c12ccca6043c2956f05d3abf6`，migrate `411,410 bytes / 6b096c1050ffb45bdac146f2006f654b30cf2074dc9fc691eb104822484f94b2`，postflight `98,061 bytes / 33157df0ab209573d4cd396dbdef2112e22ec29f7d9d5249c956ef3eee57b89f`。五个迁移文件本身和 runbook 哈希完全不变；migrate 恰有一个事务。
- `2026-07-28T08:28:17Z` 已在生产 SQL Editor 重跑生产兼容 preflight：17 个目录段全部精确匹配、mismatch 为空、最近 30 分钟 generation/started 均为 0、相关会话与其他非 idle 会话均为 0。第一次大查询仅遇到 Dashboard 到 `api.supabase.com` 的客户端 fetch 失败，未执行写入；原文重试后完整成功。截至本检查点，生产数据库、生产主机文件、进程、Nginx 和公网流量仍全部零写入/零切换。
- **下一唯一动作**：再次验证操作生成器、TypeScript、仓库测试、差异与敏感信息边界，排除 `.claude/` 后冻结并推送精确应用候选提交。候选应用 SHA 未固定、未写入下一永久 pre-write 检查点前，生产迁移保持关闭。

### 永久 pre-write 检查点（2026-07-28 16:42 CST，候选已冻结）

- 精确应用候选已提交并推送到 `origin/claude/canvas-p1-generation`：commit `8b83ac7a54c9e080ee8d0fd057ed9d182d9721e2`，tree `6a5118f3ace0e7612c5f0a4d093bc62c7d021362`。提交包含 13 个明确文件、`1,256 insertions / 33 deletions`；不包含用户自有 `.claude/settings.local.json`，也不包含 `canvas-root.tsx`、`media-node.tsx` 两个无内容差异的换行工作树标记。阿里云 release 和构建必须固定使用该应用 commit；本段仅作永久文档检查点，不改变应用候选。
- 候选冻结前独立复验：生产操作生成器/验证器 `node --check` 通过，安全断言 `43/43`，TypeScript 通过，仓库 Node 测试 `158/158`；cached diff check 无错误，候选 diff 与三个新增文件对 JWT、Supabase secret、OpenAI/GitHub token 和 private-key 形态命中均为 0。migrate 输出仍为 `411,410 bytes / 6b096c1050ffb45bdac146f2006f654b30cf2074dc9fc691eb104822484f94b2`，五个迁移哈希不变。
- `2026-07-28T08:42:37.931332Z` 在生产 `hfabrifuvujpdzarlbky`、database/user `postgres` 再次执行完全相同的只读 preflight：`catalog_all_match=true`、17 段、mismatch `[]`；`profiles=31 / canvases=0 / generations=30839 / credit_transactions=294`；`failed=10897 / completed=16761 / processing=3181`；最近 30 分钟 generation 与 started、scoped/other non-idle sessions 均为 0，最新 nonterminal 仍为 `2026-06-30T11:30:46.41Z`。生产身份、目录、活动闸与上一检查点一致。
- 上线前恢复闸仍固定为最新已确认 scheduled physical backup `2026-07-28 04:43:07 UTC`，Restore 可用；PITR add-on 未开启且本次不购买。生产迁移具备单事务、单 advisory xact lock、固定迁移哈希、触发器事务内原样恢复、前后目录断言和失败自动回滚。到本段落盘时，生产数据库写入、主机文件/进程变更和 Nginx 切换仍为 0。
- **下一唯一动作**：从 commit `8b83ac7a54c9e080ee8d0fd057ed9d182d9721e2` 中的生成器重新生成并核对 SHA-256 为 `6b096c1050ffb45bdac146f2006f654b30cf2074dc9fc691eb104822484f94b2` 的 migrate SQL，只执行一次。若 SQL Editor 载入、哈希、生产 ref、备份、前置目录、最近活动、事务结果或回滚语义任一漂移，立即停止且不重试写入；成功后立刻执行固定 postflight。

### 永久检查点（2026-07-28 16:48 CST，生产迁移已提交）

- 固定 migrate artifact 再生成结果为 `411,410 bytes / 411,243 chars / 6b096c1050ffb45bdac146f2006f654b30cf2074dc9fc691eb104822484f94b2`，仅一个 `BEGIN` 与一个 `COMMIT`。Supabase SQL Editor 位于精确生产 ref `hfabrifuvujpdzarlbky`、Primary database、role `postgres`；编辑器显示 6602 行，精确等于 artifact 的 LF 数、2 个裸 CR 经 Monaco 归一化及末行之和，开头/结尾为 `BEGIN`/`COMMIT`。destructive-operation 二次确认只确认一次，事务于 `2026-07-28T08:46:37.676Z` 启动；未作第二次迁移尝试。
- 单事务正常返回 advisory lock 结果且无错误/未完成状态。随后立即执行固定 `98,061 bytes / 33157df0ab209573d4cd396dbdef2112e22ec29f7d9d5249c956ef3eee57b89f` postflight；`2026-07-28T08:47:47.67956Z` 结果为 `catalog_all_match=true`、18 段、mismatch `[]`，精确证明 Canvas P1 后置目录与生产租户触发器均已恢复到冻结状态。
- 迁移前后业务聚合完全不变：`profiles=31 / canvases=0 / generations=30839 / credit_transactions=294`，状态仍为 `failed=10897 / completed=16761 / processing=3181`，最新 nonterminal 仍为 `2026-06-30T11:30:46.41Z`；最近 30 分钟 generation/started、scoped/other non-idle sessions 均为 0。后置 ledger/reconciliation 闸：`negative_credit_profiles=0`、`duplicate_operation_anchors=0`、`submission_unknown_generations=0`。没有修改历史 processing 行或其他现有用户数据。
- 数据库恢复闸仍为上线前 physical backup `2026-07-28 04:43:07 UTC`；该恢复点与单事务失败自动回滚共同保留。生产应用主机、PM2、Nginx 和公网流量尚未变化；旧正式应用仍是 `6fac3f0f8e2c6a6a35e6ca26cb03fcb6e283a64c`、端口 `3000`。
- **下一唯一动作**：在 `123.56.75.68` 上以精确应用 commit `8b83ac7a54c9e080ee8d0fd057ed9d182d9721e2` 建立独立 release，服务器内复制既有生产 `.env.local`（不回显值），执行锁文件安装与生产构建；构建和 ref 核对成功后以独立 PM2 candidate 监听 `3001`，仅做本机健康/路由验证。旧 `3000` 与 Nginx 保持不动，候选健康检查点落盘前禁止流量切换。

## 九、完成定义

只有同时满足以下条件，超级画布 P1 加速任务才可报告“完成并可申请上线”：

- 离线门禁全绿。
- 当前 HEAD 的调用点基线已复核。
- Preview Branch 五个迁移真实通过且重放无漂移。
- 77/77 数据库场景真实通过。
- 23 个发布阻断调用点全部关闭。
- 最终 13 个 legacy-only 入口仍无积分写入；原 16 项中的 3 个隐藏积分消费者已重分类并转换。
- P0/P1 Preview 真人验收通过。
- 积分对账差异为 0。
- 没有未关闭的 P0/P1 缺陷。
- 已准备生产迁移、回滚和监控方案。
- 用户明确授权生产迁移、合并与部署。
