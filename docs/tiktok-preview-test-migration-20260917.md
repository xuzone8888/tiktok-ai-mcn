# 私有预览测试库迁移记录

- 日期：2026-09-17，验证完成约北京时间 13:17。
- 用户明确授权执行测试库迁移；阿里云操作随后明确转交同事。
- 目标：`wjfgusdwudsynbsyveoe`，控制台名称包含 `tiktok-ai-mcn-test`。
- 非目标：生产项目 `hfabrifuvujpdzarlbky`，未修改。
- 文件：`supabase/migrations/20260916_tiktok_private_previews.sql`。
- SHA-256：`c1c389a0bbb4fa99e4f57aa8ae2d7ab01a765f876b7c8d5c910d5d295599679e`。
- 执行方式：Supabase 测试项目 SQL Editor，原文件 BEGIN/COMMIT 事务执行成功。
- 未额外写入 `supabase_migrations.schema_migrations`；这是手工 SQL 应用记录，后续 CLI 部署前须核对 ledger，不能盲目重放非幂等 CREATE TABLE migration。

## 预检

- 两张目标表与 reservation RPC 均不存在。
- publish_task_items 的 id、task_id、tiktok_transfer_method、source_video_size_bytes、source_video_mime_type 五字段齐全。
- processing/uploading 任务项数量：0。

## 执行与验证结果

- SQL Editor 返回 `Success. No rows returned`。
- `tiktok_task_previews`、`tiktok_preview_cleanup` 均已建立，RLS 开启。
- 两表 anon、authenticated、PUBLIC 均无表访问权限；service_role 具有 SELECT/INSERT/UPDATE/DELETE。
- reserve_tiktok_preview RPC：anon/authenticated 不可执行，service_role 可执行。
- tiktok_preview_deleted 触发器存在且启用。
- 预览表到 publish_task_items 的 ON DELETE CASCADE 外键存在。
- 两张新表记录数均为 0；没有写入任何预览素材记录。
- migration 的 `NOTIFY pgrst, 'reload schema'` 已执行；使用测试库 service-role 经 REST 只读查询两表均返回 HTTP 200，schema cache 验证通过。

## 未执行 / 下一关卡

- 未创建 Bucket、配置 RAM/CORS、上传对象、启动清理定时任务或改动生产。
- 未切换当前 UI-only 本地服务，避免存储缺失时阻断发布。
- 阿里云待办见 `tiktok-preview-aliyun-handoff.zh-CN.md`。
- 存储完成后仍需真实保存、跨会话播放、鉴权隔离、Range、失败恢复和测试数据删除验收。本次结构与权限验证不替代端到端验收。
- 如需回滚，应先确认无已保存文件、无清理队列，再另行授权；本次没有执行回滚或删表。
