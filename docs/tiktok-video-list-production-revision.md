# TikTok `video.list` Production Revision 准备材料

> 状态：仅供提交前准备。未经单独批准，不得在 TikTok for Developers 中点击
> `Create Revision`、`Apply changes` 或 `Submit`。

## 1. Revision 范围

- Production 当前状态：Live。
- 保留现有产品：Login Kit、Content Posting API。
- 保留现有 scopes：
  - `user.info.basic`
  - `user.info.stats`
  - `video.upload`
  - `video.publish`
- 唯一新增 scope：`video.list`。
- 不新增 Business/评论权限，不改变发布权限，不改变两个 Production callback。
- Production 在 Revision 获批并变为 Live 前保持
  `TIKTOK_VIDEO_LIST_SCOPE_ENABLED=false` 和
  `NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED=false`，以免现有用户请求尚未批准的
  scope。录屏使用独立 Sandbox/staging 凭据和稳定 HTTPS origin，并将两个
  flag 同时设为 `true`。

## 2. 审核功能说明

Star Gaze allows an authenticated user to connect their own normal TikTok account
and view a read-only list of videos belonging to that authorized account.
The `video.list` scope is used to display video cover, publish time, duration,
pagination, and view/like/comment/share statistics. This new authorized-account
video-list region does not access Shop accounts and does not publish, edit, or
delete the public videos it lists.

The existing TaskManager below that region belongs to the already approved Content
Posting workflow. It continues to manage publishing tasks and retains its existing
task, task-item, and related published-content deletion behavior. Those controls
do not use `video.list` and are not part of this Revision's new read-only feature.

TikTok credentials are stored server-side. Access is tenant-isolated and checked
against the signed-in Star Gaze user before token access. Normal and Shop account
flows are isolated. Users can disconnect the account or reauthorize it when the
scope is missing or revoked. Existing Login Kit and Content Posting API behavior
is unchanged.

## 3. 审核演示脚本

当前准备阶段只冻结脚本、镜头清单和测试数据，不进行正式录屏。正式录屏应在稳定
HTTPS staging、最终审核构建、Sandbox 权限、回调、UI 文案及审核账号全部验收并
冻结后进行，完成后立即进入 Revision 材料最终复核。提前制作的流程演示必须显著
标注 `Prototype`，不得表现为 Production API 已获批。

录屏必须使用专用审核账号和无敏感数据的演示内容。
将下文 `<REVIEW_HTTPS_ORIGIN>` 替换为本次录屏期间保持不变、已登记到
Sandbox callback 的 HTTPS origin；不得使用 Production client 凭据。

1. 打开 `<REVIEW_HTTPS_ORIGIN>/tiktok-publish/accounts` 并登录审核测试账号。
2. 展示账号管理页及当前账号授权状态。
3. 对专用 TikTok 测试账号执行绑定或重新授权。
4. 在 TikTok consent 页面明确展示 `video.list` 对应的只读授权说明。
5. 回到规范账号管理路径，展示账号为已授权状态。
6. 打开 `<REVIEW_HTTPS_ORIGIN>/tiktok-publish` 的视频列表。
7. 展示首屏视频：封面、发布时间、时长和四项统计。
8. 点击加载更多，展示 cursor 分页和去重后的下一页。
9. 展示无视频时的空状态。
10. 使用缺少 `video.list` 的测试状态展示门控提示和重新授权入口。
11. 明确指出上方“授权账号视频列表”是本次新增的只读区域，不为其中列出的
    公共视频提供编辑或删除操作。
12. 展示同页下方既有 TaskManager，并说明它属于已批准的 Content Posting
    工作流，保留原有任务、任务项及相关已发布内容的管理/删除能力，不使用
    `video.list`。
13. 返回发布区域，展示原有上传/发布能力未受影响；不需要实际发布新内容。
14. 展示断开账号入口，说明用户可撤销 Star Gaze 内的账号连接。

## 4. 审核测试账号说明

凭据必须通过 TikTok 允许的安全审核渠道单独提供，不得写入仓库、聊天、
录屏文件名或截图。

审核操作步骤：

1. 使用提供的 Star Gaze 审核账号登录。
2. 进入 TikTok 账号管理页。
3. 使用提供的专用 TikTok 账号完成 Login Kit 授权。
4. 进入 TikTok 视频管理页检查首屏和分页。
5. 如需验证缺 scope 状态，使用专门准备的未授权账号；不要修改主审核账号。

预期结果：

- 只显示当前网站用户本人绑定的 normal TikTok 账号和视频。
- 新增的“授权账号视频列表”区域只读，不对其中列出的公开视频提供编辑或删除操作。
- 同页下方既有 TaskManager 属于已批准的 Content Posting 工作流，仍可能管理/
  删除发布任务、任务项及其相关已发布内容；它不属于 `video.list` 新增能力。
- 分页不会重复追加相同视频。
- 缺少或撤销 `video.list` 时，不读取 token、不请求视频列表，并提示重新授权。
- Provider/网络失败显示稳定错误，不暴露 token、auth code 或 provider 原始响应。

## 5. 站点与政策核对

提交前逐项只读确认：

- Website：`https://toryxai.com`
- Terms of Service：`https://toryxai.com/terms`
- Privacy Policy：`https://toryxai.com/privacy`
- Production Login Kit callbacks：
  - `https://toryxai.com/api/tiktok/auth/callback`
  - `https://www.toryxai.com/api/tiktok/auth/callback`
- 隐私政策覆盖 TikTok profile/video metadata、统计数据、token 存储与删除。
- 账号管理页提供断开连接/撤销路径。
- 数据删除说明覆盖账号解绑后的 token 删除和缓存/同步数据保留策略。
- Production 两个视频列表 rollout flag 保持 `false`，直至 Revision 获批并 Live。
- Sandbox/staging 使用独立凭据和稳定 HTTPS origin，两个视频列表 rollout
  flag 同时为 `true`，且 readiness 全部通过。

## 6. 录屏与截图清单

- `01-login-and-account-binding.mp4`
- `02-video-list-first-page-and-pagination.mp4`
- `03-missing-scope-and-reauthorization.mp4`
- `04-existing-content-posting-unaffected.mp4`
- 账号管理页授权状态截图。
- 视频列表首屏截图。
- 缺 scope 门控截图。

隐私遮挡要求：

- 不录制或展示 client secret、access token、refresh token、auth code、完整 state。
- 遮挡测试账号邮箱、手机号及与审核无关的用户内容。
- 浏览器地址栏出现 OAuth callback 时不得停留或放大 query string。
- 日志画面只展示稳定 operation/code，不展示请求头、请求体或 provider 原文。

## 7. 提交前 Checklist

- [ ] 获得用户对创建 Production Revision 的单独批准。
- [ ] 当前 Production 配置已导出或截图留档（不含密钥）。
- [ ] Revision 中只有 `video.list` 一个新增 scope。
- [ ] 两个 Production callback 未改变。
- [ ] Login Kit 与 Content Posting API 配置未改变。
- [ ] Production 已部署兼容版本，两个视频列表 rollout flag 均为 `false`，
      现有四 scope Web/QR OAuth 回归通过。
- [ ] Sandbox/staging 两个视频列表 rollout flag 均为 `true`，readiness 通过，
      授权、列表、分页、统计与缺 scope 门控均已验收。
- [ ] 专用审核账号可用且不含真实用户敏感数据。
- [ ] 审核说明与当前 UI、URL、实际功能逐项一致。
- [ ] 演示视频覆盖授权、首屏、分页、统计、缺 scope 和发布能力未受影响。
- [ ] 所有截图和录屏已完成敏感信息复核。
- [ ] 评论读取/回复功能及 Business OAuth 未混入本 Revision。
- [ ] 提交前由审核窗口做最终只读复核。
