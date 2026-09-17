# 私有预览本地自检与修复 — 2026-09-17

## 范围与结论

本轮执行代码/本地行为自检和修复，不操作阿里云、不执行迁移、不发布真实视频、不部署生产。修复后的本地自动化检查通过；尚不能认定真实存储端到端验收通过，须等待同事完成独立测试 Bucket 配置。

## 已修复

- P1：预览上传与清理改用独立 `TIKTOK_PREVIEW_OSS_ACCESS_KEY_ID` / `TIKTOK_PREVIEW_OSS_ACCESS_KEY_SECRET`，不回退到已有业务凭证。环境模板和同事交接清单同步更新。
- P1：清理程序在修改数据库前检查 Bucket ACL、版本控制和 Bucket Policy；不满足私有存储约束则停止，避免在错误存储配置下处理清理队列。
- P2：补存文件大小/MIME 在创建预留记录前与原任务核对，错误文件不占用上传预留窗口。大小/MIME 匹配不代表内容哈希一致，旧任务仍需用户选择正确原文件。
- P2：补存预览在切换任务/身份、卸载和本地预览清除事件时取消；防止旧请求完成后更新新任务 UI 或解锁新上传。解码器和临时对象 URL 在成功、错误、超时和取消时释放。
- P2：上传加入有界超时和取消检查；保留响应丢失后的服务端 finalize 核验，不在取消后继续 finalize。
- P2：预览保存错误使用受控中英文文案，不向用户透传 provider 原始错误或敏感地址。

发布顺序仍为保存私有预览后才允许 FILE_UPLOAD init；补存组件不调用 TikTok init，不创建第二条远端帖子。新发布流程的完整浏览器关闭/跨网络故障验收仍属于真实端到端关卡。

## 验证记录

- 全量 Node：501 项，500 通过、1 跳过、0 失败。
- 最后补充取消解码场景后，私有预览定向测试：17/17 通过。
- TypeScript type-check、目标 ESLint、`git diff --check` 通过。
- 独立临时目录 production build 通过；manifest 包含 `/api/publish/previews/route` 和 `/api/publish/previews/[itemId]/route`。
- 当前运行的本地测试页未替换；临时构建只用于验证，不代表新存储功能已启用。
- 迁移文件未修改，SHA256：`c1c389a0bbb4fa99e4f57aa8ae2d7ab01a765f876b7c8d5c910d5d295599679e`。此前测试库执行记录见 `tiktok-preview-test-migration-20260917.md`，禁止盲目重放。

上传表单契约核对参考：[OSS PostObject 官方文档](https://www.alibabacloud.com/help/en/oss/developer-reference/postobject)。

## 下一关卡

按 `tiktok-preview-aliyun-handoff.zh-CN.md` 完成 Bucket、最小权限凭证、CORS 和清理调度后，再进行真实上传、跨会话封面恢复、越权拒绝、响应丢失与删除清理验收。当前没有真实 OSS 上传/删除验证，不承诺无条件永久保存。
