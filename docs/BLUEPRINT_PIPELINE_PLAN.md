# 「参考物→蓝图→量产」管线重构方案(2026-07,裁决版)

> 背景:用户决定 link-video 与 viral-clone 旧代码推倒重做(概念保留),image-slideshow(图片合成视频·电商)去留待定。本文档 = 竞品管线拆解 + 旧代码拆迁审计 + 管线设计 + 工程排期 + 红队审查后的最终裁决版。
> 上位文档:[STUDIO_REDESIGN_PLAN.md](./STUDIO_REDESIGN_PLAN.md)(Studio 形态)、[PRODUCT_STRATEGY_2026H2.md](./PRODUCT_STRATEGY_2026H2.md)(总战略)。

---

## 〇、三句话结论

1. **三个旧模块坍缩为一条管线两扇门**:参考物(商品链接 / 商品图 / 爆款视频)→ 结构化蓝图 Blueprint(可编辑)→ 批量渲染 N 变体。竞品(Pippit/Topview/Creatify/即创)全部是这个骨架,中间产物"卖点+可编辑脚本+scene 分镜"是行业标配,没有一家黑盒直出。
2. **图片合成视频:独立功能砍掉,资产三向转生**。审计发现它是三者中唯一生产可用的真资产(壳页 502 行下面是约 1 万行渲染栈),转生为:①商品图输入腿(门A 无链接时的主输入);②幻灯片渲染腿(全管线共用的最低成本成片模式,≈$0.02/条);③TikTok 图文轮播帖第四产出形态(官方 API 支持 10 图直发,轮播有算法红利)。
3. **收钱前范围锁死**:S1 幻灯片腿+商品图腿 → S2 海外站链接腿+AI 生成腿 → 收钱 → S3 拼装腿+爆款拆解。门B(爆款克隆)是口碑型功能,拆解质量不达标就翻车,必须过 20 条真实爆款的基准测试才开放 UI。

---

## 一、旧代码审计结论(用户"不成熟"的直觉被代码证实)

**link-video(约 4400 行)**:5 个"平台解析器"(淘宝/天猫/京东/抖音/TikTok)全是空壳,实际全部落回通用 OG meta 抓取,淘宝/抖音有登录墙根本抓不到;"分镜"实为生成一张九宫格图;"成片"是把脚本截断 750 字符+拼写死的变体修饰词数组,单次喂 Sora2——脚本的逐镜结构在生成端完全丢失。积分手扣手退,不走统一网关;"浏览器扩展"只是教用户手工建 manifest 的说明页(写死 IP)。**值得回收**:`link-video-script.ts` 的 prompt 骨架(hook/卖点/CTA+镜头码+平台风格,转为配方库首批种子配方)、migration 007 缓存表设计(url_hash/raw+parsed 双层/parse_status)。

**viral-clone(约 8600 行)**:"设计文档级完成度"——Worker 的 `/api/split-source` 和 `/api/stitch` 端点根本不存在(调用永远降级);"超分"是 ffmpeg lanczos 拉伸(假超分);git 历史零功能迭代,端到端未经生产验证。**值得回收**:5 表 schema+状态机/预算熔断设计(作 blueprints 蓝本)、`qwen-client.ts`(多模态拆解)、`segmenter.ts`(utterance 切段)、veo/grok provider+prompt-compiler。

**image-slideshow**:壳页 502 行下面是约 1 万行**生产可用**真栈:`ffmpeg-slideshow.py` 1593 行(xfade 转场、ASS 词级卡拉OK字幕、防碰撞布局)、TTS 双通道(ElevenLabs/豆包,词级时间戳)+AI 选声、SubtitleEditor 2159 行、Mac worker `/api/render`。git 持续修 bug=有真实使用。"电商"只是 tab 文案,零电商特化逻辑。**全部保留复用,只收壳页。**

**可复用地基缺口**:真 ASR(现无)、ken-burns(现为静帧+xfade)、真超分、Worker stitch/probe 端点、TikTok photo post 发布通道。脚本 LLM 封装四套并存(deepseek/link-video-script/ecom-doubao/qwen),重建收敛为统一"蓝图服务"。

---

## 二、竞品管线的关键事实(2025-2026)

- **输入腿普遍 3-4 条**:链接/商品 ID、商品图上传、脚本 prompt、素材库(Topview 加浏览器扩展)。
- **中间产物全部可编辑**:卖点列表(即创可增删改)+ 脚本 + scene 级分镜,行业标配。
- **成片方式以"素材拼装+数字人口播"为绝对主流(约 80%+)**,纯 AI 生成(Sora2/Seedance)是 2025Q4 才加的高端腿。成本每分钟:幻灯片 $0.01-0.05 / 拼装 $0.1-1 / 数字人 $1-5 / 纯 AI 生成 $6-30。矩阵团队实际:拼装+数字人为主、幻灯片走量、Sora 级点缀。
- **变体在脚本层做**:Pippit 一次 3-5 方案,Creatify 5-10 个脚本角度 ×数字人×比例组合矩阵(Batch Mode 支持 20 个 URL)。
- **爆款复刻的行业共识**:只复用结构/节奏/创意,绝不复用原片像素与原声("recreate the idea, not the clip");拆解粒度=镜头级+台词级+节奏。
- **TikTok 图文帖**:Content Posting API 官方支持 photo post(`/v2/post/publish/content/init/`,最多 10 图,DIRECT_POST,JPEG/WEBP);轮播互动与分发红利高于视频,电商清单类最强;faceless 矩阵号大量用 slideshow 带货,但低质同质化有封号收紧——需变体差异注入+质量分层。

---

## 三、Blueprint 对象(统一骨架)

对象链:`Workspace→Project→[Blueprint]→Batch(N Job)→Content→Post`。**Blueprint 是可选中间层**(红队裁决):纯 prompt 快速批次不过蓝图,回车即批次;只有参考物驱动的批次才生成蓝图卡。

```
Blueprint {
  source: { type: link|images|video, ref, rights_ack }     // 权利确认必填
  product?: { title, price, images[], selling_points[{text, evidence, selected}], audience[] }
  hooks: [{ type: 痛点|悬念|对比|场景, text, selected }]     // 多选=变体维度
  scenes: [{ idx, line(台词/TTS), visual(画面指令), slot(product_image|broll|avatar|ai_gen), duration_ms, beat(hook|point|demo|cta) }]
  global: { pacing, bgm_style, voice_id, cta_text, aspect, total_sec }
  render_mode: slideshow | assembly | ai_gen
  origin?: { viral_ref, why_viral, license: 'structure_only' }   // 门B溯源
}
```

- **蓝图↔配方**:配方 = Blueprint 去实例化(strip 商品具体值,台词脱敏为 `{商品名}` `{卖点1}` 槽位,保留 hook 模式/scene 结构/beat 序列/渲染预设)。**脱敏必经 diff 预览+用户确认**(LLM 脱敏会漏删品牌词)。反向:配方+商品卡 = 实例化新蓝图。爆款拆解=配方生产器,配方库从此有内容供给闭环。
- **蓝图编辑器首版只做**:卖点勾选 + hook 选择 + 台词行内编辑;槽位拖拽/时长调整后置。按渲染腿出精简视图,不做一个伺候三腿的巨型编辑器。
- 建表:`blueprints`(含 hooks/render_mode/origin/rights_ack 字段——红队核对项)+ `reference_cache`(照搬 007 设计)。成片仍写 generations(spec 记 blueprint_id+scene 映射)。

---

## 四、门 A:商品成片(重做 link-video)

**输入腿优先级(红队裁决,与旧方案相反):商品图为主、链接为增强。**
- **商品图腿(首发主路)**:拖 3-9 张商品图 → 豆包视觉出商品卡(标题/卖点/受众)→ 蓝图。无反爬风险、零外部依赖,1688/淘宝用户"贴标题+传图"即可用。
- **链接腿(S2,只承诺海外站)**:Amazon/Shopify/TikTok Shop(OG meta 可抓,出海客群投放端就在这)→ 第三方抓取 API(Apify/ScrapingBee,$0.002-0.01/次)+豆包补全+reference_cache 缓存。**淘宝/1688 不写进演示脚本**,后续按付费客户需求走官方开放平台 API 或降级路径。
- 交互:omnibox 贴链接/拖图 → 商品卡 chip(解析中→完成态,点开勾卖点)→ 回车 → 蓝图卡(卡内编辑)→ 选成片模式+数量 → 批量出片。

**渲染三腿(蓝图不变、腿可换,推荐顺序=成本升序)**:

| 腿 | 管线 | 基建 | 成本/条(30-60s) | 上线 |
|---|---|---|---|---|
| ①幻灯片 | 商品图 ken-burns+词级字幕+TTS+BGM;同蓝图可另出 TikTok 图文帖 | slideshow 全栈现成,补 zoompan | ≈$0.01-0.05 | S1 |
| ②AI 生成 | 逐 scene 编译 prompt→统一视频网关(7 模型)→拼接 | 网关+扣退现成;回收 prompt-compiler;**修复旧断裂:scene 结构贯穿到生成端** | $3-30 | S2 |
| ③拼装口播 | scene 素材槽+TTS+字幕→stitch;数字人(HeyGen/即创级)后置 | worker 补 stitch;素材匹配新写 | $0.1-1(数字人 $1-5) | S3 |

**变体在蓝图层做**:N = 选中 hooks × 脚本角度(LLM 重写 2-3 版)× 音色 × 比例;幻灯片模式额外注入图序/转场/字幕样式差异(**素材级去同质化**,不是参数随机)。

---

## 五、门 B:爆款拆解(重做 viral-clone)

**交互**:上传 mp4(**只收用户上传文件,贴链接腿砍掉**——服务端下载他人视频违平台 ToS,水印/防盗链也挡路)→ 强制勾权利确认 → 拆解 job → **蓝图卡+结构报告**(hook 类型、逐镜台词、beat 节奏条、CTA 位置——"这条为什么火")→ 替换主体(@角色 chip / 商品卡 chip,LLM 逐镜重写:换商品+口播,保结构)→ 选渲染腿出 N 变体 → 「存为配方」(脱敏 diff 确认后入配方库)。

**质量门槛(红队裁决)**:上线前用 20 条真实爆款跑拆解基准,达标才开 UI;MVP 只交付"结构报告"(纯分析价值,不承诺复刻保真),完整"替换重生成"在首批付费之后。

**拆解技术分期**:MVP = Qwen omni 一次调用(回收 qwen-client+segmenter,台词+分镜+hook 识别,不做物理切片);二期 = 真 ASR(阿里 Paraformer/Whisper,~$0.006/min 词级时间戳)+ PySceneDetect 镜头切分(worker 本地免费)+ 节奏/转场分析,Qwen 只做结构/视觉分析。

**版权产品化**:原片像素与原声永不进入生成物;拆解产物只有文本结构;蓝图/配方携带 `origin.license='structure_only'` 与来源标记;配方详情页明示"复刻结构,非复刻素材"。

---

## 六、图文帖(第四产出形态)

- 同一蓝图 scene→图+文案,一鱼两吃(视频+图文帖);TikTok photo post API 直发(≤10 图)。
- **审批前置(零工程量,今天就做)**:与 TikTok 确认现有 audited 权限是否覆盖 photo post scope,不够就立即提交申请——不等 S4。
- 首版降级方案:「导出图包+文案」人工发,不阻塞。
- 去同质化:强制图序差异+LLM 逐条改写文案(素材级),防模板化检测批量封号。

---

## 七、修订版合并排期(与 Studio 一张表)

| 阶段 | 人·周 | 交付物 | 验收 |
|---|---|---|---|
| S0 打底 | 1.5-2 | generations+status/batch_id/spec;blueprints+reference_cache 建表;**删 viral-clone(先摘器官:qwen-client/segmenter/providers/schema)**;worker 补 stitch/probe/zoompan;TikTok photo post 权限确认/申请(零工程) | 迁移落库;worker 端点通;旧功能零回归 |
| S1 Studio MVP | 2.5-3.5 | omnibox+批次流+Batch/Job 卡(图/视频走网关+BTM);**幻灯片腿首发**+商品图腿(拖图→商品卡→蓝图→轮播成片);@角色 | 传图 5 分钟出轮播成片;提交→Batch→入库全链路;积分对账一致 |
| S2 链接腿+AI 生成腿 | 2.5-3 | parse_reference job(海外站:Amazon/Shopify/TikTok Shop);蓝图编辑器首版(卖点勾选+台词行内编辑);AI 生成腿逐镜合成;**删 link-video(prompt 骨架转为种子配方)** | 贴海外链接→蓝图→改卖点→3 变体;旧入口下线 |
| —— 收钱线:此时应已有付费种子团队在 S1/S2 能力上日常出片 —— | | | |
| S3 拼装腿+爆款拆解+批量矩阵 | 2.5-3 | 拼装口播腿;deconstruct_video(基准达标才开 UI);批量矩阵(蓝图×hook×脚本角度×比例);存为配方(diff 确认) | 上传爆款→结构报告→换商品重生成;配方复跑一致;20 条基准达标 |
| S4 收编+图文帖直发 | 2-3 | 配方库收编模板中心;photo post 直发通道(权限已在 S0 申请);video-batch 大页消解;(可选)数字人腿 | 图文帖直发成功;三旧模块界面全下线 |

**总账**:11-14.5 人·周(对比 Studio 原计划净增约 3 人·周,增量=两管线重建,部分被"删旧码省下的收编"抵消);2 人并行约 7-9 周日历,1 人约 3-3.5 个月。红队警告实际可能 ×1.5——所以**收钱前范围锁死为 S0-S2**,S3/S4 凭付费数据决定节奏。若需压缩:先砍数字人腿、真超分、浏览器扩展重建;photo post 是差异化能力,最后动。

**拆除纪律**:删除前打 git tag `pre-demolition`;S0 删 viral-clone(零入口零依赖,最安全);S2 末删 link-video(有入口,必须等新管线可用,避免功能真空);image-slideshow 只收壳页,引擎不动;成片已双写 generations,删旧表不丢历史(assets/tasks 的 link_video source 枚举只删写入端、保留读取端)。

---

## 八、红队裁决记录

1. 旗舰旅程从"1688 链接"改为"商品图"开场;链接腿只承诺海外站 —— 已采纳(§四)。
2. 收钱前范围锁死 S0-S2,门B 挪到付费之后;编辑器首版极简 —— 已采纳(§七)。
3. 腿顺序改为幻灯片→AI 生成→拼装(成本与基建就绪度权衡);photo post 审批前置;blueprints 表补 hooks/render_mode/origin/rights_ack —— 已采纳(§三/四/六)。
4. 门B 20 条基准门槛+只收上传文件+MVP 只出结构报告 —— 已采纳(§五)。
5. Blueprint 改为可选中间层;脱敏必经 diff 确认;编辑器按腿出视图 —— 已采纳(§三)。
6. 去同质化升级为素材级 —— 已采纳(§四/六)。
