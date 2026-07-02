# viral-clone 旧 schema 设计笔记(摘器官存档,2026-07)

> 来源:supabase/migrations/20260415_viral_clone.sql(表已 DROP,迁移文件保留在历史中)。
> 用途:S3 阶段设计「门B 爆款拆解」的 deconstruct_video job 与 blueprints 扩展时的参考蓝本。
> 本目录其余文件为可复用代码器官:qwen-client(Qwen omni 多模态视频分析)、segmenter(utterance 边界切段)、prompt-compiler(逐段中英 prompt 编译)、providers/(veo/grok 生成适配,grok 含 chain_extend 链式延伸思路)、types.ts(完整类型定义)。

## 值得继承的设计

1. **五表分层**:assets(资产统一表:源视频/切片/成片全放一张表,kind 区分)→ jobs(任务主表)→ segments(分段,含 blueprint 快照)→ attempts(每段多次生成尝试,保留失败记录)→ events(事件流水,append-only)。attempts 与 events 分离让"重试"与"审计"互不污染。
2. **状态机 + 租约**:jobs 用显式状态机(ingest→analyze→plan→split→segment→stitch→enhance→done),orchestrator 靠 lease(租约字段+过期时间)防止并发编排器重复接管;fire-and-forget 触发 + 租约恢复 = 无队列下的断点续跑。
3. **预算熔断**:jobs 上有 cost_budget/cost_spent,每次生成尝试前检查,超预算立即终止——蓝图管线的 compose_video 应继承(单蓝图批量生成的成本上限)。
4. **成本审计**:attempts 记录每次调用的 provider/模型/积分消耗,事后可按 job 聚合对账。
5. **RLS 全覆盖**:五表全部 user_id 归属 + auth.uid() 四策略(select/insert/update/delete)。

## 已知的坑(不要重蹈)

- Worker 端点(/api/split-source、/api/stitch)在迁移里被假设存在但从未实现——**先建基建再写调用**(S0.4 已补)。
- Qwen omni 兼职 ASR 词级时间戳精度无保证——门B 二期换真 ASR(Paraformer/Whisper),Qwen 只做结构/视觉分析。
- 超分是 lanczos 拉伸(假超分),对外不要宣传超分能力。
- 积分扣退当时是手扣手退,没走统一网关——新管线一律走 models/submit / generate/image 的服务端扣退。
