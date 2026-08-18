# Star Gaze Privacy Policy — YouTube API Services Section

> Internal handoff note — do not publish this note.
>
> This is a bilingual, ready-to-merge section for the existing Star Gaze Privacy Policy at `/privacy`. It is designed to supplement, not replace, the existing general privacy policy and TikTok-specific provisions. Use **July 23, 2026** as the updated/effective date when this section is published. The English and Chinese versions must remain substantively identical.
>
> Before publication, engineering must deploy `20260723120000_youtube_data_retention_cleanup.sql`, deploy the updated YouTube disconnect route, and enable the hourly `/api/youtube/data-retention` schedule. Cached YouTube comments use a polymorphic account ID rather than a foreign key, so the new transaction helper and scheduled cleanup are required for the published retention and deletion commitments.

## English website copy

### YouTube API Services and Google User Data

#### 1. Use of YouTube API Services

Star Gaze, operated by Wuhan Guanxing Cultural Media Co., Ltd. (“Star Gaze,” “we,” “us,” or “our”), uses YouTube API Services to provide user-facing YouTube account connection, channel identification, video publishing and management, comment synchronization, comment translation, and user-initiated comment reply features.

By connecting a YouTube account or using these features, you authorize Star Gaze to access and process the YouTube and Google user data described below for the purposes stated in this Privacy Policy. Star Gaze does not request, collect, or store your Google or YouTube password.

#### 2. YouTube and Google data we access or process

Depending on the features you choose to use and the permissions you grant, Star Gaze may access or process:

- OAuth authorization information, including access tokens, refresh tokens, granted scopes, token status, and token expiration information;
- YouTube channel information, including channel ID, channel title, handle, thumbnail, and channel-level statistics made available by the YouTube API;
- video and publishing information, including video files or source URLs selected by you, titles, descriptions, tags, category, audience and synthetic-media settings, privacy status, scheduling information, YouTube video IDs, watch URLs, publishing status, and API error information;
- comments and replies associated with content managed through Star Gaze, including comment IDs, thread and parent identifiers, comment text, author display information made available by YouTube, timestamps, like and reply counts, permalinks, synchronization status, and replies submitted by you through Star Gaze; and
- operational records reasonably necessary to provide and secure the integration, including account linkage records, synchronization history, user-initiated action logs, idempotency records, diagnostics, and security logs.

Star Gaze requests the `https://www.googleapis.com/auth/youtube.force-ssl` authorization scope because the current YouTube API does not provide a narrower scope that supports user-initiated comment replies. Star Gaze uses this permission only for the visible features described above, including channel access, video publishing and management, comment reading, and comment replies initiated or confirmed by the user.

#### 3. How we use YouTube and Google data

We use this data only to:

- connect and identify the YouTube channel selected by you;
- display your connected account and content within Star Gaze;
- upload, schedule, and manage videos according to the title, metadata, audience setting, synthetic-media setting, visibility, and timing selected by you;
- retrieve and display comments and replies for content managed through Star Gaze;
- send a comment reply only after you enter or confirm the reply in Star Gaze;
- translate comment text when you expressly request the translation feature;
- maintain synchronization, prevent duplicate actions, troubleshoot failed requests, secure the service, and comply with applicable law and platform requirements; and
- provide support and respond to privacy, deletion, security, or compliance requests.

Star Gaze does not use YouTube or Google user data for unrelated advertising, user profiling, surveillance, or the training of general-purpose artificial intelligence models. We do not sell YouTube or Google user data.

When you expressly request comment translation, the relevant comment text may be transmitted over an encrypted connection to our configured translation service provider solely to generate and return the requested translation. We limit the information sent to what is necessary for that operation and require service providers to process it only to provide services to Star Gaze.

#### 4. Actions performed on your behalf

Star Gaze clearly identifies actions that may create or modify data on YouTube. A video upload, publication, scheduling change, visibility selection, or comment reply is performed only after you initiate or confirm that action. You retain final control over the content, channel, visibility setting, and reply text submitted through Star Gaze.

Deleting information stored by Star Gaze does not delete the corresponding video, comment, reply, or other data stored by YouTube. To delete data stored on YouTube, you must use YouTube or another authorized application that supports the relevant deletion action.

#### 5. Storage, security, and access controls

OAuth tokens and YouTube-related records are stored on access-controlled infrastructure and are available only to authorized systems and personnel with a legitimate need. Tokens are not exposed in the normal user interface. We use encrypted network transport, access controls, logging, and other reasonable administrative, organizational, and technical safeguards designed to prevent unauthorized access, use, alteration, or disclosure.

YouTube and Google user data is displayed only to the authorizing user and persons or agents that the user has expressly authorized through Star Gaze. We may use infrastructure, database, security, monitoring, customer-support, and translation service providers to process data on our behalf. Such providers receive only the information reasonably necessary to perform their services and are subject to contractual or other appropriate confidentiality and security obligations.

We may disclose information where required by applicable law, legal process, or a valid governmental request, or where reasonably necessary to protect users, the public, Star Gaze, Google, or YouTube from fraud, abuse, security threats, or violations of law.

#### 6. Retention and refreshing of YouTube API data

We retain OAuth tokens only while reasonably necessary to provide the features authorized by an active user and permitted by applicable law. Access tokens may be refreshed using a refresh token while the authorization remains active.

Except where YouTube policies expressly allow a different period, cached YouTube API data is refreshed or deleted within 30 calendar days. We use reasonable efforts to keep displayed YouTube information consistent with the current information available through YouTube API Services.

Publishing tasks, action history, and security records may be retained for the period reasonably necessary to provide the service, prevent duplicate publishing or replies, investigate errors or abuse, resolve disputes, and meet legal obligations. Where such records contain YouTube API data, the YouTube API data within them is deleted, refreshed, or de-identified in accordance with applicable YouTube policies.

When Star Gaze can no longer verify that your authorization remains valid, we stop accessing your YouTube account and delete or refresh the affected YouTube API data within the period required by YouTube policies, and no later than 30 calendar days unless retention is required by applicable law.

#### 7. Disconnecting, revoking access, and deleting data

You may disconnect one YouTube account or use the **Delete all YouTube data** control through the YouTube account management interface in Star Gaze. Local account data is deleted transactionally. If Google is temporarily unavailable, the refresh token is retained in a service-role-only revocation queue solely to retry revocation and is deleted immediately after success or no later than seven (7) calendar days. You may also revoke Star Gaze’s access directly from [Google Account third-party connections](https://security.google.com/settings/security/permissions).

You may request deletion of YouTube-related data stored by Star Gaze by using an available account or data-deletion control or by contacting us at **toryxai@outlook.com**. After reasonably verifying the request, we will delete the YouTube-related user data under our control as soon as possible and no later than seven (7) calendar days, unless a longer period is required by applicable law. We will inform you if a legally required exception applies.

If you delete your Star Gaze account, we will also delete or de-identify YouTube-related user data associated with that account as soon as possible and no later than seven (7) calendar days, except for information that we are legally required to retain.

Revoking access or deleting data from Star Gaze does not delete content or data stored by YouTube. You can manage or delete YouTube-hosted content directly through YouTube.

#### 8. Your choices and rights

Subject to applicable law, you may request access to, correction of, or deletion of personal information under our control, withdraw consent, object to or restrict certain processing, or request a copy of relevant information. You may stop future YouTube API access at any time by disconnecting the account in Star Gaze or revoking access through Google Account settings.

Withdrawing authorization may prevent Star Gaze from providing YouTube account, publishing, comment, and reply features, but it will not affect processing that was lawful before withdrawal.

#### 9. Google policies and Limited Use

Star Gaze’s use and transfer of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

For more information about Google’s privacy practices, please review the [Google Privacy Policy](https://policies.google.com/privacy). You may review and revoke third-party access through [Google Account third-party connections](https://security.google.com/settings/security/permissions).

#### 10. Contact

For questions, complaints, authorization issues, or requests concerning YouTube or Google user data, contact:

**Wuhan Guanxing Cultural Media Co., Ltd. (Star Gaze)**
Email: **toryxai@outlook.com**
Website: **https://toryxai.com**
Address: Wuhan, Hubei Province, China

We may need to verify your identity and account ownership before fulfilling a request.

---

## 中文网站文案

### YouTube API 服务与 Google 用户数据

#### 1. YouTube API 服务的使用

Star Gaze 由武汉观星文化传媒有限公司运营（以下称“Star Gaze”“我们”或“本公司”）。我们使用 YouTube API 服务，为用户提供 YouTube 账号绑定、频道识别、视频发布与管理、评论同步、评论翻译以及由用户主动发起的评论回复功能。

当您绑定 YouTube 账号或使用上述功能时，即表示您授权 Star Gaze 按照本隐私政策所述目的访问和处理下述 YouTube 与 Google 用户数据。Star Gaze 不会请求、收集或存储您的 Google 或 YouTube 密码。

#### 2. 我们访问或处理的 YouTube 与 Google 数据

根据您选择使用的功能以及您授予的权限，Star Gaze 可能访问或处理：

- OAuth 授权信息，包括访问令牌、刷新令牌、已授予的权限范围、令牌状态及令牌到期信息；
- YouTube 频道信息，包括频道 ID、频道名称、账号标识、缩略图，以及 YouTube API 提供的频道级统计信息；
- 视频与发布信息，包括您选择的视频文件或来源地址、标题、描述、标签、分类、受众与合成媒体设置、可见性、定时发布时间、YouTube 视频 ID、观看链接、发布状态及 API 错误信息；
- 与通过 Star Gaze 管理的内容相关的评论和回复，包括评论 ID、评论串及父级标识、评论正文、YouTube 提供的作者展示信息、时间、点赞与回复数量、永久链接、同步状态，以及您通过 Star Gaze 提交的回复；以及
- 为提供和保护集成功能而合理需要的运营记录，包括账号绑定记录、同步历史、用户主动操作日志、幂等记录、诊断信息和安全日志。

Star Gaze 请求 `https://www.googleapis.com/auth/youtube.force-ssl` 授权范围，是因为当前 YouTube API 没有能够支持用户主动回复评论的更窄权限范围。我们仅将该权限用于上述用户可见功能，包括频道访问、视频发布与管理、评论读取以及由用户主动发起或确认的评论回复。

#### 3. 我们如何使用 YouTube 与 Google 数据

我们仅将相关数据用于：

- 绑定并识别您所选择的 YouTube 频道；
- 在 Star Gaze 中展示您的已绑定账号和相关内容；
- 按照您选择的标题、元数据、受众设置、合成媒体设置、可见性及发布时间上传、定时发布和管理视频；
- 获取并展示通过 Star Gaze 管理内容的评论与回复；
- 仅在您输入或确认回复内容后发送评论回复；
- 在您明确请求评论翻译时提供翻译；
- 维护同步、避免重复操作、排查失败请求、保护服务安全，以及遵守适用法律和平台规则；以及
- 提供客户支持并处理隐私、删除、安全或合规请求。

Star Gaze 不会将 YouTube 或 Google 用户数据用于无关广告、用户画像、监控或通用人工智能模型训练。我们不会出售 YouTube 或 Google 用户数据。

当您明确请求评论翻译时，相关评论文本可能通过加密连接发送至我们配置的翻译服务提供商，其唯一目的为生成并返回您所请求的译文。我们仅发送完成该操作所必需的信息，并要求服务提供商仅为向 Star Gaze 提供服务而处理相关数据。

#### 4. 代表您执行的操作

Star Gaze 会明确标识可能在 YouTube 创建或修改数据的操作。视频上传、发布、定时设置、可见性选择或评论回复，仅会在您主动发起或确认后执行。您对通过 Star Gaze 提交的内容、频道、可见性设置及回复文本保留最终控制权。

删除 Star Gaze 保存的信息不会删除 YouTube 平台保存的相应视频、评论、回复或其他数据。如需删除 YouTube 平台保存的数据，您必须使用 YouTube 或其他支持相应删除操作的授权应用。

#### 5. 存储、安全和访问控制

OAuth 令牌及 YouTube 相关记录存储于受到访问控制保护的基础设施中，仅允许具有正当业务需要的授权系统及人员访问。令牌不会在普通用户界面中显示。我们使用加密网络传输、访问控制、日志记录及其他合理的管理、组织和技术保障措施，以防止未经授权的访问、使用、更改或披露。

YouTube 与 Google 用户数据仅向授权用户本人，以及该用户通过 Star Gaze 明确授权的人员或代理展示。我们可能使用基础设施、数据库、安全、监控、客户支持及翻译服务提供商代表我们处理数据。此类服务提供商仅接收履行服务所合理需要的信息，并受到合同或其他适当的保密和安全义务约束。

如适用法律、法律程序或有效政府要求规定，或者为保护用户、公众、Star Gaze、Google 或 YouTube 免受欺诈、滥用、安全威胁或违法行为所合理必要，我们可能披露相关信息。

#### 6. YouTube API 数据的保留与刷新

我们仅在为持续获得授权的用户提供相关功能所合理需要且适用法律允许的期间内保留 OAuth 令牌。在授权有效期间，访问令牌可能通过刷新令牌进行更新。

除 YouTube 政策明确允许其他期限外，缓存的 YouTube API 数据将在 30 个自然日内刷新或删除。我们会采取合理措施，使展示的 YouTube 信息与 YouTube API 服务当前提供的信息保持一致。

发布任务、操作历史和安全记录可能在提供服务、防止重复发布或回复、调查错误或滥用、解决争议及履行法律义务所合理需要的期间内保留。如果此类记录包含 YouTube API 数据，其中的 YouTube API 数据将按照适用的 YouTube 政策删除、刷新或去标识化。

当 Star Gaze 无法继续确认您的授权有效时，我们将停止访问您的 YouTube 账号，并在 YouTube 政策要求的期限内删除或刷新受影响的 YouTube API 数据；除非适用法律要求保留，否则最迟不超过 30 个自然日。

#### 7. 解绑、撤销授权和删除数据

您可以通过 Star Gaze 的 YouTube 账号管理界面解绑单个 YouTube 账号或使用**删除全部 YouTube 数据**功能。本地账号数据通过事务删除。如 Google 暂时不可用，刷新令牌将仅为重试撤权而暂存于仅服务角色可访问的队列中，并在撤权成功后立即删除或最迟不超过七（7）个自然日删除。您也可以通过 [Google 账号第三方连接页面](https://security.google.com/settings/security/permissions)直接撤销 Star Gaze 的访问权限。

您可以使用可用的账号或数据删除功能，或者发送邮件至 **toryxai@outlook.com**，要求删除 Star Gaze 保存的 YouTube 相关数据。在合理核验请求后，我们将尽快删除由我们控制的 YouTube 相关用户数据，且最迟不超过七（7）个自然日；适用法律要求更长保存期限的除外。如存在法定例外，我们会向您说明。

如果您注销 Star Gaze 账号，我们也会尽快删除或去标识化与该账号相关的 YouTube 用户数据，且最迟不超过七（7）个自然日；法律要求保留的信息除外。

撤销授权或删除 Star Gaze 中的数据，不会删除 YouTube 平台保存的内容或数据。您可以直接通过 YouTube 管理或删除存储于 YouTube 的内容。

#### 8. 您的选择和权利

在适用法律规定的范围内，您可以请求访问、更正或删除由我们控制的个人信息，撤回同意，反对或限制特定处理，或者请求获取相关信息副本。您可以随时通过在 Star Gaze 中解绑账号，或者通过 Google 账号设置撤销访问权限，以停止未来的 YouTube API 访问。

撤回授权可能导致 Star Gaze 无法继续提供 YouTube 账号、视频发布、评论及回复功能，但不会影响撤回前基于有效授权进行的合法处理。

#### 9. Google 政策与“有限使用”要求

Star Gaze 对从 Google API 获取的信息的使用及传输，将遵守 [Google API 服务用户数据政策](https://developers.google.com/terms/api-services-user-data-policy)，包括其中的“有限使用”（Limited Use）要求。

如需进一步了解 Google 的隐私处理方式，请阅读 [Google 隐私政策](https://policies.google.com/privacy)。您可以通过 [Google 账号第三方连接页面](https://security.google.com/settings/security/permissions)查看并撤销第三方访问权限。

#### 10. 联系我们

如对 YouTube 或 Google 用户数据存在疑问、投诉、授权问题或权利请求，请联系：

**武汉观星文化传媒有限公司（Star Gaze）**
邮箱：**toryxai@outlook.com**
网站：**https://toryxai.com**
地址：中国湖北省武汉市

在处理请求前，我们可能需要核验您的身份和账号所有权。

---

## Engineering and publishing checklist — do not publish

- [ ] Add this section to the existing `/privacy` page in both English and Chinese.
- [ ] Change the page’s updated/effective date to July 23, 2026.
- [ ] Keep the Privacy Policy URL identical on the homepage and Google OAuth consent-screen configuration.
- [ ] Ensure the homepage footer and logged-in product UI provide an easy-to-find Privacy Policy link.
- [ ] Confirm the in-product YouTube connection flow links to, or requires acceptance of, the current Privacy Policy.
- [ ] Deploy `20260723120000_youtube_data_retention_cleanup.sql` before deploying the updated disconnect route.
- [ ] Confirm disconnect removes the local YouTube account binding, OAuth tokens, cached comments, translations, sync runs and action logs, and attempts Google token revocation.
- [ ] Enable and monitor the hourly `/api/youtube/data-retention` schedule with `CRON_SECRET` configured.
- [ ] Ensure explicit YouTube data-deletion requests can be completed within seven calendar days.
- [ ] Ensure cached YouTube API data is refreshed or deleted within 30 calendar days unless a policy exception applies.
- [ ] Confirm translation-provider contracts and settings support the published “service-only” processing statement.
- [ ] Confirm the public contact mailbox is monitored and can complete verified deletion requests.

Official policy references:

- Google OAuth verification requirements: https://support.google.com/cloud/answer/13464321
- Google API Services User Data Policy: https://developers.google.com/terms/api-services-user-data-policy
- YouTube API Services Developer Policies: https://developers.google.com/youtube/terms/developer-policies
- YouTube developer-policy guidance: https://developers.google.com/youtube/terms/developer-policies-guide
