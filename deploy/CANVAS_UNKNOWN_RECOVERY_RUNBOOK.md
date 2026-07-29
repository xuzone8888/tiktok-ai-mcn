# 超级画布 unknown 视频人工恢复手册

本文只适用于超级画布视频生成已经进入
`status=pending / provider_submission_state=unknown / task_id IS NULL`
的极少数不确定状态：上游可能已经接收请求，但本地没有可靠拿到 task ID。
这不是普通失败重试流程。

## 绝对规则

- 不得因为前端超时、本地日志缺失、单次查询无结果或暂时性 404 就退款。
- 不得对 unknown 记录重新提交生成。重新提交可能造成重复扣费、重复内容和无法关联的上游任务。
- `bind_task` 必须建立“这个上游 task 唯一属于这次生成”的证据链。
- `verified_no_task_refund` 必须建立“上游确认没有创建任务”的完整证据链。
- 一次处理必须由两名不同人员完成。操作人与审批人不得共用人员身份、标签或密钥。
- 恢复只允许从服务器本机的数字回环地址调用；不得经公网、域名、Nginx 外网入口或跳板代理调用。
- 同一事件的 `resolutionId` 一经生成不得更换。网络响应丢失时，必须用同一份 JSON 原样重放，以获得数据库幂等结果。

数据库函数只接受 task-less 的 Canvas 视频 unknown 状态；每个 generation
最多一条审计记录。审计表启用了强制 RLS，并用触发器禁止更新和删除。

## 双人职责

### 操作人

1. 核对 `generationId`、用户、Canvas、模型、计费模式、扣费金额和
   `submission_started_at`。
2. 在正确的上游账号/项目下取证，整理审批工单。
3. 生成一次性的 `resolutionId`，填写受保护的 JSON 请求文件。
4. 保管 `CANVAS_RECOVERY_ADMIN_SECRET`，执行 dry-run；审批通过后才执行 POST。
5. 执行后核对 generation、积分流水、审计记录和 reconciler 状态。

### 审批人

1. 独立复核 generation 身份、上游账号、模型、时间窗和请求关联信息。
2. 独立查看原始上游查询结果或服务商工单，不只看操作人的文字结论。
3. 判断证据是否达到下文 `bind_task` 或退款标准。
4. 在审批系统留下不可变工单号，并保管
   `CANVAS_RECOVERY_APPROVER_SECRET`。
5. 仅在审批窗口内向 root-only 临时环境文件提供审批密钥；不得把密钥发到
   IM、工单正文、shell 参数或命令历史。

生产环境中的 `CANVAS_RECOVERY_OPERATOR_LABEL` 与
`CANVAS_RECOVERY_APPROVER_LABEL` 必须是两个不同的实名/值班身份标识。

## Provider evidence 标准

证据文本本身长度为 8–1700 字符，不能包含换行或控制字符。详细截图、响应体和
服务商沟通记录应放在权限受控、保留期明确的工单/证据库中；JSON 内填写其工单号、
查询标识、UTC 时间和结论摘要，不粘贴访问令牌或个人敏感信息。

所有证据至少包含：

- 上游供应商、账号或项目标识、模型；
- 查询执行的 UTC 时间；
- 覆盖 `submission_started_at` 前后安全余量的明确 UTC 时间窗；
- generation/action 的关联线索（例如受支持的 client request ID、请求时间、
  模型、参数或输入摘要）；
- 查询接口/后台页面/服务商工单编号和原始证据保存位置；
- 操作人结论与审批人独立复核结论。

### `bind_task`

只有同时满足以下条件才可绑定：

- 上游返回唯一 task ID，且账号、模型、创建时间和请求特征都与本 generation
  一致；
- 已排除同一时间窗内其他生成请求；
- 已确认该 task ID 没有绑定到其他本地 generation；
- 证据记录当前 task 状态和原始查询/工单编号。

绑定不会退款，也不会重新提交。成功后记录进入 `processing/bound`，由
reconciler 继续轮询上游任务。

### `verified_no_task_refund`

只有上游证据能证明“任务没有被创建”时才可退款：

- 使用正确账号/项目、模型及完整 UTC 时间窗进行了穷尽查询；
- 使用所有供应商实际支持的 request ID/task 检索方式进行交叉核对；
- 若供应商没有按 client request ID 查询的能力，必须取得供应商支持工单的明确
  书面确认，说明检索范围与零任务结论；
- 已排除查询延迟、索引延迟、跨区域账号和分页遗漏；
- 审批人独立确认退款不会与一个仍在运行的上游任务并存。

“本地没有 task ID”“接口曾超时”“日志里没看到成功”“查询一次返回空”均不构成
退款证据。证据不足时保持 unknown 并升级供应商，不做盲目退款。

## 准备受保护文件

以下操作在应用服务器上以 root 执行。两个密钥应由各自保管人只在已批准的短暂
操作窗口内注入临时文件。文件必须是普通文件、root:root、仅 root 可读写且不能是
软链接或硬链接。不要把密钥或 provider evidence 放进命令参数。

```bash
install -d -o root -g root -m 0700 /root/canvas-recovery
umask 077
install -o root -g root -m 0600 /dev/null /root/canvas-recovery/recovery.env
install -o root -g root -m 0600 /dev/null /root/canvas-recovery/request.json
```

`/root/canvas-recovery/recovery.env` 的形状：

```dotenv
CANVAS_RECOVERY_ADMIN_SECRET=<操作人密钥，至少 32 字符>
CANVAS_RECOVERY_APPROVER_SECRET=<审批人密钥，至少 32 字符且与操作人不同>
CANVAS_RECOVERY_OPERATOR_LABEL=operator.oncall
CANVAS_RECOVERY_APPROVER_LABEL=approver.oncall
```

`bind_task` 请求示例：

```json
{
  "resolutionId": "11111111-1111-4111-8111-111111111111",
  "generationId": "22222222-2222-4222-8222-222222222222",
  "resolution": "bind_task",
  "taskId": "provider-task-123",
  "approvalTicket": "INC-2026-001",
  "providerEvidence": "ticket=INC-2026-001;provider=x;project=p;model=m;queryUtc=2026-07-29T10:00:00Z;windowUtc=09:40Z..10:20Z;uniqueTask=provider-task-123;artifact=secure-record-42"
}
```

退款请求的 `taskId` 必须显式为 `null`：

```json
{
  "resolutionId": "33333333-3333-4333-8333-333333333333",
  "generationId": "44444444-4444-4444-8444-444444444444",
  "resolution": "verified_no_task_refund",
  "taskId": null,
  "approvalTicket": "INC-2026-002",
  "providerEvidence": "ticket=INC-2026-002;provider=x;project=p;model=m;queryUtc=2026-07-29T11:00:00Z;windowUtc=10:30Z..11:20Z;providerConfirmedNoTask=true;artifact=secure-record-43"
}
```

真实 `resolutionId` 应使用可信 UUID 工具生成，例如 `uuidgen`。请求文件中必须
恰好包含上述六个字段；多余字段、字段缺失和不匹配的 taskId 形状都会被拒绝。

## Dry-run 与执行

先确认候选进程的本机端口。URL 只允许 `127.0.0.1` 或 `[::1]`，路径必须精确为
`/api/internal/canvas/resolve-unknown`，不能带 query、fragment、userinfo 或重定向。

默认命令只读取、校验和显示身份摘要，不发网络请求：

```bash
cd /var/www/<exact-canvas-release>
npm run canvas:resolve-unknown -- \
  --url http://127.0.0.1:3004/api/internal/canvas/resolve-unknown \
  --env-file /root/canvas-recovery/recovery.env \
  --request-file /root/canvas-recovery/request.json
```

双方再次核对 dry-run 输出的操作人、审批人、resolutionId、generationId、
resolution 和 taskId。CLI 不会输出密钥或 provider evidence。

审批人给出最终确认后，原命令仅增加显式 `--execute`：

```bash
npm run canvas:resolve-unknown -- \
  --url http://127.0.0.1:3004/api/internal/canvas/resolve-unknown \
  --env-file /root/canvas-recovery/recovery.env \
  --request-file /root/canvas-recovery/request.json \
  --execute
```

客户端固定 30 秒超时、禁止重定向，并限制响应大小。若客户端在服务器提交后丢失
响应，不要创建新 resolutionId；保持文件字节不变，用同一命令重放。

## 执行后审计核对

必须在受控数据库会话中检查以下内容。查询结果不得复制到公开工单。

```sql
SELECT
  resolution_id,
  generation_id,
  resolution,
  operator_label,
  pg_catalog.length(provider_evidence) AS evidence_length,
  status_after,
  provider_submission_state_after,
  task_id,
  refunded_amount,
  balance_after,
  created_at
FROM public.canvas_generation_resolution_audit
WHERE resolution_id = '<resolution-id>';
```

审计结果必须恰好一行，`operator_label` 必须同时包含操作人与审批人标签。
`provider_evidence` 的长度应与带工单、审批人和证据前缀后的预期一致；常规核对不要
打印原文。

`bind_task` 还要确认：

```sql
SELECT id, status, provider_submission_state, task_id, next_reconcile_at
FROM public.generations
WHERE id = '<generation-id>';
```

预期为 `processing / bound / <已审批 taskId>`，且 reconciler 随后继续推进。
不得手工再次提交供应商任务。

退款还要确认：

```sql
SELECT id, status, provider_submission_state, task_id, credits_refunded
FROM public.generations
WHERE id = '<generation-id>';

SELECT operation_anchor, entry_kind, amount, generation_id
FROM public.credit_transactions
WHERE operation_anchor = 'canvas-refund:<generation-id>';
```

预期 generation 为 `failed / unknown / NULL`。付费动作的退款流水最多一条，锚点
固定；免费额度动作可以是 `refunded_amount=0`，不会返还已消耗的免费配额。

最后在审批工单记录 CLI 结果、数据库核对结果、执行 UTC 时间和双方签名。按组织的
秘密销毁流程移除临时密钥文件；证据文件按合规保留策略存档，不要把它们提交到 Git。

## 异常处置

- `401`：停止，核对双密钥的保管人与注入流程；不要交换或共用密钥。
- `503 NOT_CONFIGURED`：候选 release 的密钥/标签配置不完整或不互异，修复部署
  配置后重新 dry-run。
- `409 RESOLUTION_REJECTED`：状态栅栏、审计幂等输入、task 唯一性或数据库约束
  未通过。先查审计和 generation，不要换 resolutionId 绕过。
- 网络失败：确认本机候选进程和精确端口；若可能已提交，只能原样幂等重放。
- 证据出现矛盾：保持 unknown，冻结操作并升级供应商/事故负责人。
