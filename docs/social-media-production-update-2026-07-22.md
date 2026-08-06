# 社媒生产更新记录（2026-07-22）

## 本次结果

- Facebook 评论读取及进入页面后的自动同步已通过线上测试。
- YouTube 账号绑定已恢复，OAuth 回调和 token 交换已通过线上测试。
- Instagram 已完成重新绑定、视频发布、评论读取和人工回复的线上闭环测试。
- 评论管理页面刷新后会保留当前功能页签。

## Instagram 问题根因与处理

根因是生产环境仍在使用旧 Instagram 应用和国外 OAuth Broker 颁发的 token；这套 token 可以绑定和发布，但 Meta 的评论接口只返回媒体评论数量，不返回评论内容。

生产环境已统一调整为：

- Instagram Native OAuth。
- Instagram 应用 ID：`1443863951101268`。
- API 主机：`graph.instagram.com`。
- OAuth 回调：`https://toryxai.com/api/instagram/auth/callback`。
- 阿里云主站、国外 Broker、Worker 和定时 Worker 使用同一套 Instagram 应用配置。
- 相关进程已重启并通过健康检查。

切换应用后，旧账号必须重新绑定以换发新应用 token；完成重新绑定后，评论读取和回复测试成功。

## 代码与版本

- 生产代码基线：`main`，提交 `fca1e51`（Merge Instagram sync contract fix）。
- 本轮代码修复包括：评论页面状态保持、Facebook 自动同步、YouTube OAuth 稳定性、Instagram 评论可见性诊断，以及同步结果字段完整返回。
- 运行时密钥只保存在服务器环境变量中，未写入 Git 仓库。

## 分支处理

- 同事开发分支：`feat/social-comments-data-review`。
- 该分支用于 TikTok 评论能力、四平台数据和社媒发布审核相关开发。
- 在本次线上验收通过后，该分支应吸收最新 `main`，以免继续基于旧 OAuth 和评论同步逻辑开发。

## 后续事项

- 当前 Meta 测试角色/自有专业账号已经具备测试条件。
- 面向非应用角色的公开用户开放前，仍需完成 Meta App Review，并取得所需权限的 Advanced Access。
- 后续补齐 Meta 的取消授权回调和数据删除地址。
- 手动评论同步不依赖 Webhook，本次未修改 Webhook Callback。
