# 超级画布 P1 上线、回滚与监控手册

> 状态：`READY_FOR_FINAL_VALIDATION`
>
> 本手册只准备上线动作，不授予生产数据库写入、真实付费供应商调用、推送、合并或部署权限。任何生产动作仍须用户逐项明确授权。

## 1. 当前候选已经证明的范围

- Preview Branch：`canvas-p1-staging`，ref `liibsugstuidwlmliyif`。
- Preview PostgreSQL：17.6；Session Pooler 仅用于已完成的 Preview 验证。
- 五个迁移在 Preview 中首次应用成功，随后重放成功；post-apply 与 reapply 目录逐字节一致。
- Preview 数据库场景：`77/77` 通过，失败 0，跳过 0。
- 场景清理：累计定向删除 67 个测试用户；`auth.users`、`profiles`、`canvases`、`generations`、`credit_transactions`、`generation_quota_buckets` 六个测试数据面最终精确为空。
- 冻结目录：18 个段全部匹配。
- 离线门禁：Batch 2 `487/487`、生成意图 `122/122`、视频合约 `599/599`。
- P0 聚焦门禁、canvas runtime、repair、checklist 对账全部通过。
- TypeScript、生产构建（143/143 页面）通过；仓库 Node 测试 `145/145` 通过。
- 当前远端 `main` 与本地 `main` 同为 `6fac3f0f8e2c6a6a35e6ca26cb03fcb6e283a64c`；相对共同祖先，`main` 与当前候选改动路径交集为 0，`git merge-tree` 预演无文本冲突。真实合并仍未执行。

这些证据不替代真人 UI、真实供应商或生产验收。

## 2. 冻结发布物

上线前必须重新计算并逐字匹配以下 SHA-256；任何一个字节变化都使本次 Preview 证据失效，必须先重新审查和验证。

| 顺序 | 文件 | SHA-256 |
|---|---|---|
| 1 | `supabase/migrations/20260715_generations_service_role_policy.sql` | `2949cfe12695923fa0c441cb79d82db73abd84225a5b7c3cc348c9876e788555` |
| 2 | `supabase/migrations/20260716_canvas_p1_lifecycle_foundation.sql` | `c525036a97c01c90bf92a684afae9403c4b02876a4281e298bd22507853594dd` |
| 3 | `supabase/migrations/20260717_canvas_p1_credit_boundary.sql` | `d6d1ad82472806fb3284070cbcdc53267709a4593976b67e1e271c98951814c2` |
| 4 | `supabase/migrations/20260718_canvas_p1_generation_api.sql` | `7275f5bb1c3c8e76c94dbcb180e39a679eedfed889806796f76a7eef9d319638` |
| 5 | `supabase/migrations/20260719_canvas_p1_reconciliation.sql` | `6bf13cba88842ba173883fd6f0dd7d1d7b4d95cabd72d74e1280000522608524` |
| 证据 | `scripts/fixtures/canvas-p1/batch2/post-apply-catalog.json` | `f45d91fcf9a4074ff440549c37cca512dc949158b0b0758897a13cf26f89e30f` |
| 执行锁 | `scripts/fixtures/canvas-p1/batch2/remote-preflight-locks.json` | `d8427bd23f812ca4de2e0ae76d35567d832183260a76c6125cc873a04b5778e9` |

禁止把密码、连接串、`.env*`、`.claude/`、CA 文件、数据库输出或 `.temp/` 产物加入提交。

## 3. 用户最终检验清单

必须在明确绑定 Preview 数据库、且不会接触生产的 Preview 应用中完成。当前工作树的 `.env.local` 指向生产，禁止用它启动本地 UI 验收。

### 3.1 不产生供应商费用的 UI 验收

- [ ] 1366×768 下完成画布主流程，无遮挡或不可达操作。
- [ ] 创建、编辑，等待自动保存后刷新，内容不丢。
- [ ] 断网 30 秒，再联网，补存成功且不重复写。
- [ ] 同一画布打开双标签：第二标签只读并显示横幅；主标签关闭后可安全接管。
- [ ] 注入坏节点或坏文档时显示可恢复降级界面，不白屏。
- [ ] undo/redo、节点复制、连线、成组、解组均符合快捷键契约。
- [ ] 100 节点保存小于 1 秒。
- [ ] 200 节点平移/缩放不低于 50 fps。
- [ ] 100 节点加 30 个视频 poster 的浏览器内存低于 800 MB。

### 3.2 需要用户另行授权的最小付费验收

- [ ] 上传一张无敏感内容的商品测试图。
- [ ] 只生成一张图片。
- [ ] 只执行一次图生视频。
- [ ] 下载结果。
- [ ] 用测试 TikTok 账号直发，并确认 AIGC 标注。
- [ ] 逐项记录预估积分、实际 consume、退款，差异为 0。
- [ ] 提交后关闭标签再打开，任务状态从 `generations` 正确恢复。
- [ ] 用一次可控失败证明只出现一条 refund。
- [ ] 连续点击证明只有一个 generation 和一次 consume。
- [ ] 清理测试画布、测试任务和测试账号产生的定向数据；不得广域删除。

任一项失败都先停止上线，不以数据库 77/77 代替 UI 或真实供应商证据。

## 4. 生产上线前置闸

- [ ] 用户明确授权生产迁移。
- [ ] 用户明确授权合并、推送和部署；三项授权不得互相推定。
- [ ] 最终候选提交 SHA 已记录，工作树无未解释改动。
- [ ] 最新 `main` 已重新获取并完成真实合并；全部冲突逐文件审查。
- [ ] 合并后重新跑 TypeScript、构建、P0/P1 门禁和仓库测试。
- [ ] 生产数据库 ref 必须由用户在 Supabase Dashboard 中再次确认；任何身份歧义立即停止。
- [ ] 确认 PITR/备份可用，记录恢复点和维护窗口。
- [ ] 确认没有正在执行的批量生成、退款或对账任务；不能确认则延后迁移。
- [ ] 记录迁移前 `generations`、`credit_transactions`、`profiles` 的行数与关键状态计数，只记录汇总，不导出用户内容。
- [ ] 对生产做专门审核过的只读目录预检，证明与候选 pre-apply 预期一致。

`scripts/verify-canvas-p1-batch2.mjs` 永久只允许 Preview，生产 ref 会被硬拒绝。禁止为了上线削弱该守卫或把 Preview harness 指向生产；生产只读预检和 post-apply 核对必须使用单独审核的生产操作单。

## 5. 生产迁移步骤

1. 在 Supabase Dashboard 中再次确认生产项目身份，并记录操作者、时间和变更单。
2. 重新核对第 2 节的五个 SHA-256。
3. 严格按 `20260715` → `20260716` → `20260717` → `20260718` → `20260719` 顺序组成一个发布批次。
4. 五个文件必须在同一个 PostgreSQL 事务中执行；任一语句失败即整批回滚，不允许跳过失败文件继续。
5. 不在迁移窗口插入测试用户、测试 generation 或模拟积分流水。
6. 成功提交后立即执行只读 post-apply 核对：
   - `public.generations` 不存在 PUBLIC/anon 可达策略。
   - `generations_select_own` 与 `generations_service_role_all` 形状精确。
   - `on_auth_user_created` 唯一且指向 `public.handle_new_user()`。
   - 25 个生命周期函数不存在 PUBLIC/anon/authenticated EXECUTE。
   - `generation_quota_buckets` RLS 开启、客户端权限为 0、策略数为 0。
   - `credit_transactions` 追加写保护、唯一索引和身份约束完整。
   - 18 个冻结目录段与 post-apply 证据一致。
7. 任一 post-apply 项不匹配：停止应用部署，保留事务与目录证据，进入第 7 节回滚决策。

## 6. 应用发布顺序

1. 数据库 post-apply 全绿后，才允许发布应用候选。
2. 先发布单实例/最小流量，确认首页、登录、`/canvas`、画布 CRUD 与只读历史查询正常。
3. 未获得付费验收授权前，不主动触发图片、视频或 TikTok 调用。
4. 用户完成第 3 节最小黄金旅程后，再逐步放量。
5. 观察 30 分钟无 P0/P1 告警后扩大流量；观察 24 小时后再宣布稳定。
6. Preview Branch 是否删除由用户在稳定期后单独决定；不得自动删除或重置。

## 7. 回滚方案

### 7.1 应用异常

- 立即停止继续放量。
- 回滚到上线前已知良好的应用构建。
- 不回退数据库迁移：五个迁移是 additive/hardening 基础，盲目 down migration 会重新开放 RLS、破坏账本约束或丢失新状态。
- 保留新列、索引、函数和流水，待修复版本继续消费。
- 对所有已创建任务按 `generations` 真相源完成或失败收敛；禁止直接改客户端状态冒充完成。

### 7.2 数据库迁移失败

- 若单事务尚未提交：确认 PostgreSQL 已回滚整批，然后只读证明目录仍是 pre-apply。
- 若事务已提交但 post-apply 不匹配：不执行临时 DROP，不手改账本；停止应用发布，生成最小 forward-fix 迁移，经 Preview 重放和完整门禁后再进生产。
- 若出现安全边界异常（匿名可读、客户端可写账本、函数 ACL 放开）：立即阻断 `/canvas` 新流量并回滚应用，同时保留数据库现场供只读诊断。

### 7.3 供应商或对账异常

- 停止新的付费生成入口，保留状态查询和对账。
- 未知提交结果进入 `submission_unknown`，由已审查的 reconciliation 路径收敛；不得盲目重提。
- 退款只走幂等数据库边界；禁止人工直接加减 `profiles.credits`。

## 8. 上线观察指标

### 8.1 立即告警（任何一条非零）

- 匿名或未授权身份能读到任意 generation。
- `profiles.credits < 0`。
- 同一 action/task 出现重复 consume 或重复 refund。
- ledger 的 `balance_before → balance_after` 连续性断裂。
- 同一 signup 出现多个 grant，或 auth 用户缺失对应 profile。
- 追加写保护被禁用、生命周期函数 ACL 漂移、注册触发器数量不为 1。

### 8.2 五分钟窗口

- `/api/generate*`、`/api/video-batch*`、`/api/canvas*` 5xx 比例超过 1%：停止放量。
- begin/bind/complete/fail RPC 异常超过 1%：停止放量并检查数据库日志。
- `submission_unknown` 或 reconciliation backlog 连续两个窗口增长：停止新付费提交。
- 单任务产生两笔付费 consume：立即进入事故处理。

### 8.3 30 分钟与 24 小时核对

- 预估积分、consume、refund、profile 余额变化逐项对账，差异必须为 0。
- `submitting`、`submission_unknown`、`reconciling` 超过各自租约/终态超时的任务数为 0。
- 失败任务退款数量与金额精确匹配，成功任务无退款。
- 用户关闭标签后重开，任务状态与服务端一致。
- 错误边界、只读锁横幅和自动保存失败率无新增趋势。

## 9. 提交拆分建议

在用户最终检验通过后、真实合并前，按以下边界整理本地提交；每批单独可审查：

1. 换行与离线载入器修复：`.gitattributes`、`scripts/canvas-build.mjs`、相关验证器。
2. 数据库底座：五个迁移、Batch 2 固定清单、目录证据和 77 场景 harness。
3. 共享积分与生成合约：`src/lib/credits/`、视频合约、生成意图、共享类型。
4. 调用点子批次：按图片、视频、管理/账户、状态/对账分组。
5. 验收修复与文档：P0 验证器兼容、执行方案、本手册。

每个提交前先做敏感信息扫描；`.claude/settings.local.json` 永远不进入任何提交。
