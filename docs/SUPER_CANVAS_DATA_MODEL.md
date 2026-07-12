# 双轨中台数据模型设计(电商带货 + 剧情创作统一底座)

> **定稿说明**:定稿于 2026-07-12,三路审查 + 代码实证复核(9 条实锤已全部修入)后仲裁;搭配 `SUPER_CANVAS_MASTER_PLAN.md` 与 `SUPER_CANVAS_CHECKLIST.md` 使用。所有「现状」断言均经代码复核,标注 文件:行号(相对 worktree 根)。
> **轨道命名(2026-07-12 用户裁决)**:双轨=「电商带货」/「剧情创作」;本文中「漫剧」一词均指剧情创作轨的典型场景(漫剧/短剧/小说推文),非轨道名。字段名(story/story_script/storyboard)不受影响。

> 前提:本设计全程遵守 ADR 红线——零 fork 现有 API/执行器/store 原语、generations 唯一真相源、三库同源直读现有表、canvases 只存拓扑+引用。

---

## 〇、现状代码事实底账(设计依据,已逐一核实)

| 事实 | 出处 |
|---|---|
| blueprints DDL:`source_type CHECK IN ('product_link','product_images','reference_video','manual')`;`product JSONB` 商品卡;`scenes JSONB=[{idx,line,visual,slot:{kind,asset_ref},duration_ms,beat}]`;`globals/render_mode/origin/status/version/recipe_id` | supabase/migrations/20260702_studio_foundation.sql:63,68,70-78 |
| generations = 执行真相源:006 建表(task_id/status/metadata),008 加 model_id/final_prompt,20260702 加 library_status/batch_id/spec | 006_generations_table.sql:7-47;008:7-19;20260702:15-32 |
| generations.spec 首个写入端 = stitch 路由,结构 `{render_mode, blueprint_id, scene_task_ids, segment_count, model_type, variant}` | src/app/api/studio/ai-gen/stitch/route.ts:266-273 |
| ai_models 基表:name/description/avatar_url/sample_images/category/style_tags/gender CHECK/age_range/price_daily…/rating/is_active/capabilities/trigger_word | 001_initial_schema.sql:69-110;002_complete_setup.sql:71 |
| ai_models 角色化:020 加 source(default 'official')/owner_id/reference_images **JSONB** '[]'/character_type/dna_config/reference_sheet_url/reference_status/reference_task_id/preview_video_url/is_public/publish_price + 用户自建三策略;20260313 加 source(default 'marketplace')/owner_id/character_type/reference_images **TEXT[]**/dna_config/**voice_id** + 重建五策略(marketplace_visible 对全体可见);20260314 加 preview_video_url | 020_character_system.sql:15-63,109-151;20260313_character_system.sql:13-28,50-75;20260314_character_v3.sql:9 |
| ⚠ 漂移事实:020 与 20260313 都 `ADD COLUMN IF NOT EXISTS reference_images` 但类型不同(JSONB vs TEXT[])、source 默认值不同('official' vs 'marketplace')——生产实际类型取决于执行顺序;代码侧靠 `normalizeCharacterAssetImages` 双兼容(数组或 JSON 字符串都吃) | src/lib/character-assets.ts:60-89 |
| blueprint-drawer 消费 scenes:接口仅认 6 键(:38-45);GET `/api/studio/blueprints/[id]` 整包加载(:197-221);台词编辑用对象展开保留未知键(:254-257);`visual` 以 http 开头则渲染为图(:774);重跑把 scenes 映射为 AiGenSceneSpec `{idx,line,visual,beat,imageUrl←slot.asset_ref(http时)}`(:477-483) | src/components/studio-shell/blueprint-drawer.tsx |
| ⚠ 但 PATCH 服务端 `sanitizeScenes` **重建**每镜对象、只放行 6 个已知键,未知键在保存时被剥掉;slot.kind 白名单=`product_image/broll/avatar/ai_gen`;MAX_SCENES=30,line≤500,visual≤2000 | src/app/api/studio/blueprints/[id]/route.ts:29-31,74-109 |
| job-spec:`JobSpecBase.character?: CharacterAssetSnapshot` 原样携带(:53);`blueprintId`(:62)/`batchId`(:58)/`variant`(:63);AiGenSceneSpec=AiGenSceneInput+imageUrl(:118-121);toAiGenTask 逐镜 `compileScenePrompt`(:388) | src/lib/studio/job-spec.ts |
| 视频网关 DTO 含 `characterAsset?: unknown`(:25);`sanitizeCharacterAsset` 白名单=id/name/description/avatar_url/reference_sheet_url/reference_images/preview_video_url/category/tags/source/ownership/publish_price/reference_status——**只要求 id/name 为 string,不校验来源表**(:66-86);角色参考图取序=sheet→references→avatar(:88-100);垫图合并序=**merge 前置主角色 ref → veo 首帧(unshift)→ 角色 refs[1:] → imageUrls → referenceImageUrls → veo 尾帧 → mainGrid**(:107-121 组装/unshift/merge + character-reference.ts:48-72 前置与截断);normalizeImageUrls 内部 merge 已截断到模型 maxImages,故 :257-261 的 400 分支对 characterAsset 注入链**不可达**(实际行为=静默截断);快照落 metadata.character_asset(:328-331) | src/app/api/video-batch/models/submit/route.ts |
| 视频垫图硬上限=模型 maxImages:sora2/sora2-pro/seedance=1、veo=3、grok=4、omni=7、happyhorse=9;merge 到上限即截断 | src/lib/video-models/catalog.ts:20,36,52,68,84,100,116,158-160;src/lib/video-models/character-reference.ts:11-19,48-72 |
| 生图路由:`sanitizeCharacterAsset`(多留 trigger_word/forge_type,:37-61);角色参考图**排在** sourceImageUrls 之前合并进 allSourceImageUrls(:386-394);路由层无总数上限,仅 4K 九宫格收敛为 1 张(:406-419);URL 白名单=HTTPS + media.toryxai.com(image-reference-url.ts:4,82-93);**上游硬上限 MAX_REFERENCE_IMAGES=16**(openai-image-api.ts:30,204) | src/app/api/generate/image/route.ts |
| 一致性注入现行做法:`buildCharacterConsistencyPrompt` 把「同一角色身份+安全描述(≤420字符)」前置拼在用户 prompt 前 | src/lib/character-assets.ts:183-207 |
| character-picker 输出 CharacterAssetSnapshot(withCharacterAsset 归一) | src/components/character-picker.tsx:45-105 |
| recipes 表(独立新表,槽位化 scenes/hooks,不复用 content_templates 的裁决已记录);种子配方为代码常量 | supabase/migrations/20260703_recipes.sql:6-31;src/lib/studio/recipes.ts:113-259 |
| `PRICING_VERSION` 尚不存在于代码(grep 0 命中)——总纲 §八 的 P1 计划项,本文引用其**模式**而非现物 | — |

---

## 一、双起点归一(Q1)

### 1.1 结论:两起点都归一到 blueprints,一行蓝图 = 一次成片计划,下游全共用

- **source_type 扩枚举:加 `story_script`**。现约束在 20260702_studio_foundation.sql:63,重建为:
  `CHECK (source_type IN ('product_link','product_images','reference_video','manual','story_script'))`。
  不复用 `manual`:manual 语义是「无参考物手搓商品蓝图」,而 story_script 决定了下游 UI 形态(读 story 卡而非 product 卡)、资产装配默认行为(角色/场景优先)与合规口径,必须可查询区分(现有 `idx_blueprints_source_type` 索引直接受益,:86-87)。
- **product ↔ story 对称**:`product JSONB` 电商专用(卖点/价格/人群,20260702:68),漫剧对应**新增 `story JSONB` 列**,不塞 product 也不塞 source_ref(source_ref 语义是「参考物原始输入」,故事简报是可编辑的蓝图主体,与 product 同层):

```jsonc
// blueprints.story(剧本节点结构化输出,对齐 LibTV 节点A:标题/类型/时长建议/基调/分场)
{
  "title": "我在盛唐写天下",
  "genre": "古风穿越爽文",          // 类型
  "tone": "热血×盛唐史诗感×爽点节奏", // 基调
  "duration_hint_sec": 75,          // 时长建议
  "synopsis": "一句话/一段梗概",
  "acts": [                          // 分场(供分镜生成器展开为 scenes)
    { "idx": 0, "label": "序幕", "summary": "…" },
    { "idx": 1, "label": "现代·深夜办公室", "summary": "…" }
  ],
  "visual_style": "盛唐古风·国风二次元"  // 全局风格标签(资产装配继承,见 §四;电商轨落点见 §四.2 收敛条款)
}
```

- **互斥约束(如实描述改动量)**:`CHECK (NOT (product IS NOT NULL AND story IS NOT NULL))` 不建议加库级(拆解蓝图 product 本就为 null,历史行状态多);互斥仍由服务端保证。但必须如实说明:POST 路由现状**不只是 sourceType 白名单**——src/app/api/studio/blueprints/route.ts:92 的 sourceType 实际只二选一收敛为 `product_link/product_images`(reference_video 蓝图走别的路由建),且 :108-123 **硬性要求商品卡**(images≥1 且 http、normalizeCard 通过、至少勾选一个卖点,任一不满足即 400)。story_script 蓝图无商品卡,无法经现 POST 创建;需要**新增整套入参校验分支**:story 卡 sanitize(字段类型/长度校验),product 必填校验改为**按 sourceType 分派**(product 轨要求商品卡、story 轨要求 story 卡),globals/renderMode 口径同批核对。该分支列入 P2-b 代码落点(§七)。
- **下游近零改**:scenes/globals/render_mode/generations.spec 链路对两轨完全同构——drawer 的 `isDeconstruct` 分支(blueprint-drawer.tsx:380)已证明「同一 scenes 结构 + 按 source_type 切换头部卡视图」是既有模式,漫剧只是再加一个 `isStory` 视图分支(展示 story 卡代替商品卡),**继续组件级复用 blueprint-drawer,不重写**。仅有两处服务端清单/白名单追加(缺了 drawer 永远读不到新列):① GET `/api/studio/blueprints/[id]` 用**显式列清单** select([id]/route.ts:130-134),须追加 `story, assets`;② PATCH 白名单(:169-207 现仅认 product/scenes/hooks/status)须增加 `story` 键(带 sanitize,与 `assets` 同纪律)。两条均已列入 §七 P2-c 修改清单。

### 1.2 剧本节点 = 文本节点的结构化变体(裁决建议:不新增第 7 类)

**建议裁决:不进白名单第 7 类;实现为文本节点 `variant:'story_brief'`。** 论证:

1. LibTV 实测里剧本节点本身就归类「文本类」(LIBTV_FEATURE_INVENTORY.md 节点A:「剧本节点(文本类,漫剧起点)」),对标基准不支持独立类。
2. 6 类白名单里真正的「blueprints 宿主」是脚本节点;剧本节点只是脚本节点的**上游输入卡**(标题/类型/基调/分场的结构化文本),其全部产出物落 `blueprints.story`,没有独立的执行状态机、没有 generations 交互——不满足「节点=统一具备生成器面板+状态机+产物动作」的节点规格(总纲 §五),硬立一类会造出半残节点。
3. 变体实现零成本兼容:文本节点 data 加 `variant:'plain'|'story_brief'`,story_brief 时渲染结构化表单(4 字段+分场列表)、输出连线到脚本节点即写 `blueprints.story`。canvases 文档里仍是 `type:'text'`,schema 不膨胀。
4. 若未来剧本节点长出独立执行(如「一句话→剧本」LLM 生成计费动作),再按变更控制流程提请升级为第 7 类——升级路径无损(存量节点 variant 字段原地翻译)。

风险自认:变体方案下「双击画布建剧本节点」的入口要靠空态快捷位③(一句话→分镜脚本)与文本节点右键「转为剧本简报」承载,发现性弱于独立节点;若用户裁决要最强发现性,选第 7 类也不破坏本数据模型(存储层仍是 blueprints.story,仅 canvases.doc.nodes[].type 多一个枚举)。

---

## 二、scenes 9 维度扩展(Q2)

### 2.1 字段映射表(现有 6 键 → LibTV 9 维度)

| LibTV 分镜维度 | 现有字段 | 处置 | 新键名(建议) | 类型/约束 |
|---|---|---|---|---|
| 镜号 | `idx` ✅ | 沿用(下游唯一键:clientTaskId=`${jobId}-s${idx}`,[id]/route.ts:83-85) | — | int,0-29 |
| 时长 | `duration_ms` ✅ | 沿用(500-60000 clamp 已有,:101-104) | — | int ms |
| 画面描述(@资产) | `visual` ✅ | 沿用,但**保留 URL/文本双态**(drawer :774 与 ai-gen-prompts.ts:75-77 都按 `startsWith('http')` 分流,不能破坏);@引用不进 visual 文本做真相,见 §五 | `asset_refs` 另立 | text ≤2000 |
| 对白·旁白 | `line` ✅ | 沿用(≤500,TTS/口播本体) | — | text |
| 景别 | 无 | 新增 | `shot_size` | 枚举 10 值:`extreme_wide/wide/full/full_body/medium/half_body/medium_close/close/closeup/extreme_closeup`(对齐 LibTV 大远景→大特写) |
| 光影氛围 | 无 | 新增 | `lighting` | 自由文本 ≤200 |
| 音效 | 无 | 新增 | `sfx` | 自由文本 ≤200;**v1 采集不消费**(P4 时间线预留),UI 标注「暂不参与生成」(§二.4) |
| 运镜 | 无 | 新增 | `camera_move` | 自由文本 ≤200 + 预设 chips(推/拉/摇/跟/俯/仰),chips 只是输入辅助不进枚举;消费端=compiled_prompt→视频腿(§二.4) |
| 最终提示词 | 无 | 新增(编译缓存) | `compiled_prompt` + `compiled_at` | text ≤4000;`compiled_at` ISO,任一上游键或引用资产描述变更即视为过期重编译 |
| —(StarGaze 独有) | `beat` ✅ | 保留(电商四拍 hook/point/demo/cta 是矩阵注入/配方的锚,job-spec.ts:618-627 靠它;漫剧镜可全 `point` 或后续扩 `beat:'story'`——扩枚举改动面见下方脚注 ※) | — | 枚举 |
| —(StarGaze 独有) | `slot` ✅ | 保留并降格为「主素材槽」(该镜图生视频的首帧图);资产引用不再挤 slot | — | 见下 |
| @资产结构化 | 无 | 新增 | `asset_refs` | `[{asset_id, alias, asset_type}]`,详见 §五 |

> ※ **脚注(beat 扩枚举改动面)**:若扩 `beat:'story'`,须**同 PR** 改两处,缺一不可:① [id]/route.ts 的 `SCENE_BEATS` 白名单(:29,87-88)——否则含 `'story'` 的整包 scenes 保存时被 400 打回;② drawer 的 `BEAT_LABELS`/`BEAT_COLORS`(blueprint-drawer.tsx:82-89,605,617,789)——Record 直查,未知 beat 会渲染 undefined,须加 fallback 防御。job-spec 侧已有 `?? 'body'` 兜底(ai-gen-prompts.ts:73),无需动。

`slot.kind` 现枚举 = `product_image/broll/avatar/ai_gen`([id]/route.ts:30;recipes.ts:22)。扩展:加 **`scene_frame`**(漫剧逐镜分镜图,由逐镜生图产出后回填 asset_ref=图 OSS URL)。不加 character/prop 之类——角色/道具是 asset_refs 的事,slot 永远只回答「这一镜的首帧/素材图是哪张」。

### 2.2 jsonb 内演进 vs 拆 scene 行表:**留 jsonb**

论证:
1. **读写形态是整包**:drawer 整包 GET/整包 PATCH(blueprint-drawer.tsx:197-221,388-392,423-431),重跑整包映射(:477-483);没有任何按镜跨蓝图查询需求。拆行表 = 重写 GET/PATCH 合约 = fork blueprint-drawer,直接违反「脚本节点复用 blueprint-drawer 不重写」裁决。
2. **规模**:MAX_SCENES=30([id]/route.ts:31),9 键 × 30 镜 ≈ 20KB 以内,远低于 jsonb 舒适区;无索引需求(逐镜执行状态在 generations,不在 scenes)。
3. **一致性**:分镜表是「一次编辑一次保存」的文档语义,行表反而引入镜间部分更新的中间态。
4. 唯一代价是无镜级并发写——而单写者锁(ADR 3)本来就禁了并发写。

### 2.3 向后兼容(旧蓝图无新键)

- **读侧**:所有新键 optional。编译器规则=`shot_size/lighting/camera_move/sfx` 缺失→不输出对应 prompt 片段(compileScenePrompt 现状即「只用 line/visual/beat」,ai-gen-prompts.ts:67-89,旧蓝图行为逐字节不变);`compiled_prompt` 缺失→惰性编译。渲染侧 drawer 新列对缺失值显示空输入框(预设 chips 可点)。
- **写侧(必须改的一处)**:`sanitizeScenes` 是重建式白名单,会剥掉新键([id]/route.ts:96-106)——扩展该函数放行新键(逐键类型校验+长度 clamp,枚举白名单),**属白名单追加不属 fork**。老客户端提交无新键的 scenes 时,服务端**合并保留 DB 中已有新键**(按 idx 对齐 merge)避免旧端保存冲掉新维度——这是 9 维度上线后的关键防回退条款。
- **版本标记**:不给每镜加 version;blueprints 已有 `version INTEGER`(20260702:77)。9 维度上线时蓝图 POST 写 `globals.scenes_schema=2`,缺失视为 1;zod 校验按此分派(与 canvases schemaVersion 同一套纪律)。

### 2.4 camera_move 与 sfx 的消费端(定死)

新维度不能只有输入框没有消费端。逐维度定死:

1. **camera_move/lighting/shot_size → 视频腿,经 compiled_prompt 传递**。现状:批量生视频的 prompt 路径 = toAiGenTask → compileScenePrompt,AiGenSceneSpec=AiGenSceneInput+imageUrl(job-spec.ts:118-121)、AiGenSceneInput 仅 idx/line/visual/beat 四键(ai-gen-prompts.ts:19-26),compileScenePrompt 只消费 line/visual/beat(:67-89)——camera_move 若只写进 scenes,视频 prompt 全链路丢失(运镜是视频时序维度,静态分镜图承载不了)。**定死方案**:视频腿 prompt **优先取 `scenes[i].compiled_prompt`**(§五.2 编译产物,已含 camera_move/lighting/shot_size):`AiGenSceneSpec`/`AiGenSceneInput` 增 `compiledPrompt` **可选键**(属白名单追加,非 fork),`toAiGenTask`/`compileScenePrompt` 加「有 compiledPrompt 用之,无则走现状 line/visual/beat 拼接」分支——旧蓝图无 compiled_prompt,**行为逐字节不变**。该扩展点已补入 §七 P2-d 代码落点表。
2. **sfx 定死:v1 采集不消费**(为 P4 时间线预留)。TTS 只吃 line,音频独立节点已裁,当前无任何消费端;分镜表 sfx 列 UI 明确标注「暂不参与生成」,避免用户误以为它会影响产出。P4 时间线立项时 sfx 直接有存量数据可用,采集不白做。

---

## 三、资产三类表(Q3)

### 3.1 裁决:角色复用 ai_models;场景/道具 + 蓝图内实例 = 新表 canvas_assets;**不**把场景/道具塞 ai_models

- **角色留 ai_models(三库同源)**:character-picker → CharacterAssetSnapshot → 两网关 characterAsset 通道全链已通(character-picker.tsx:67-105;job-spec.ts:53;submit route :66-86;image route :37-61),角色市场(is_public/publish_price,020:59-63)、签约(ownership,character-assets.ts:119-129)、音色绑定(voice_id,20260313:28)都长在上面。重建=fork。
- **场景/道具不进 ai_models**,三条实锤理由:
  1. **语义污染**:ai_models 有 `gender CHECK(male/female/neutral)`(001:85)、`price_daily/weekly/monthly/yearly`(001:89-92)、rating/total_rentals——「盛唐金銮殿」填 gender 是笑话,置 NULL 则每个消费端都要判空。
  2. **RLS 冲突**:20260313:58-59 的 `marketplace_visible` 策略让 `source='marketplace' OR source IS NULL` 的行对全体可见,且 020/20260313 两套策略叠放、source 默认值互斥('official'/'marketplace')——往这口漂移中的锅里再加第三种语义的行,是给对账埋雷。
  3. **市场逻辑误伤**:角色广场、签约合同、角色 CLI 消费端全部按「ai_models 行=可雇角色」假设写的;场景行会漏进这些列表,逐处加 `asset_type!='scene'` 过滤=全代码库撒补丁。
- **蓝图内实例 vs 全局库两层**(LibTV 两层都有:向导内资产 + 底部角色库):
  - **全局资产库层** = ai_models(角色)+ canvas_assets(场景/道具/角色造型变体),跨画布跨蓝图复用,历史资产面板直读。
  - **蓝图内实例层** = `blueprints.assets JSONB`(新列)。向导「准备资产」步识别出的待设定资产,生命周期与蓝图绑定(草稿态、可整批重识别、随蓝图删除),不该在生成设定图之前就变成全局库的永久行。实例经「入库」动作提升为全局行并回填 `asset_id`。设定图生成中的状态**不在 jsonb 里自维护**——实例只存 `task_id`,状态永远查 generations(真相源红线)。

```jsonc
// blueprints.assets(蓝图内资产实例;向导②「准备资产」的数据本体)
[
  {
    "local_id": "a1",                      // 蓝图内稳定 id(scenes.asset_refs 用它或全局 asset_id)
    "asset_type": "character",             // character|scene|prop
    "alias": "唐朝沈昭昭",                  // @引用显示名
    "description": "……详细设定描述(LLM 初稿,用户可改)",
    "description_edited": false,
    "source": "ai_identified",             // ai_identified|canvas_pick|upload
    "asset_id": null,                       // 提升入库后回填:canvas_assets.id 或 ai_models.id
    "asset_table": null,                    // 'canvas_assets'|'ai_models'(asset_id 的归属表)
    "reference_sheet_url": null,            // 设定图(OSS object key,生成完成后由前端按 generations 回填,见 §八)
    "reference_task_id": null,              // 生成中:generations.task_id(状态查真相源)
    "prompt_template_id": "character_4view",
    "prompt_template_version": 1
  }
]
```

写入通道:扩 `[id]/route.ts` PATCH 白名单加 `assets`(sanitize 同 scenes 纪律:数组上限 24、逐键类型校验;与 `story` 键同批放行,§七 P2-c)。

### 3.2 同角色多版本(现代沈昭昭/唐朝沈昭昭)

**方案:canvas_assets 兄弟行 + `character_model_id` 共同回指 + `variant_label`。** 排除项:
- `dna_config` 内嵌多造型:dna_config 是捏脸快照(20260313:25),塞版本数组会让捏脸舱二次编辑逻辑碎裂,且版本无法被 @引用单独寻址。
- ai_models 加 parent_id:又是污染。

同一角色两套造型 = canvas_assets 两行(`asset_type='character'`,同一 `character_model_id` 指向 ai_models 基角色行,`variant_label='现代造型'/'唐朝造型'`,各自持独立 description/reference_sheet_url/reference_images)。基角色不存在时(纯漫剧向导现造的角色)`character_model_id` 为 NULL,行本身即角色。@引用与垫图一律寻址 canvas_assets 行(每行都能打包成 CharacterAssetSnapshot 同形快照——网关 sanitize 只要求 id/name,submit route:66-69,**零 fork 即通**;快照须附来源表标记,见 §五.3)。场景/道具变体用同表 `parent_id` 自引用。

### 3.3 推荐方案完整 DDL 草案

```sql
-- ============================================================================
-- 20260720_canvas_assets.sql — 双轨资产系统(P2)
-- 三类资产全局库:场景/道具 + 角色造型变体(基角色仍在 ai_models,经
-- character_model_id 回指,不动角色市场/签约/RLS)。幂等,可重复执行。
-- 迁移执行:用户经 Supabase dashboard SQL editor(生产无 exec_sql RPC)。
-- 注意:本表无 updated_at 触发器,updated_at 由写路由手动更新
--      (沿用 blueprints 惯例,[id]/route.ts:16,212)。
-- 注意:reference_sheet_url/reference_images 从建表起即存 OSS object key
--      (非完整 URL;列名沿用 *_url 后缀惯例,渲染/注入时换签名 URL,见 §八。
--       对照:ai_models.reference_images 历史行存 URL 文本,新旧并存不回填)。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.canvas_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,  -- 可空:官方种子资产为 NULL

    asset_type TEXT NOT NULL CHECK (asset_type IN ('character', 'scene', 'prop')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',        -- 设定描述(黄金 prompt 的资产变量本体,用户可改)
    description_edited BOOLEAN NOT NULL DEFAULT false,
    visual_style TEXT,                           -- 资产级风格覆写(缺省继承 blueprint.story.visual_style)

    avatar_url TEXT,                             -- 封面/头像
    reference_sheet_url TEXT,                    -- 多视图设定图(角色4视图/道具6视图/场景卡;存 object key)
    reference_images JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 追加参考图(统一 JSONB,吸取 020/20260313 类型漂移教训;存 object key)
    reference_status TEXT NOT NULL DEFAULT 'none'
        CHECK (reference_status IN ('none', 'pending', 'completed', 'failed')),
    reference_task_id TEXT,                      -- 设定图生成任务(generations.task_id 引用,状态查真相源)

    prompt_template_id TEXT,                     -- 生成设定图所用模板 id(代码常量注册表,见 §四)
    prompt_template_version INTEGER,             -- 生成时模板版本(升级共存判据)

    character_model_id UUID REFERENCES public.ai_models(id) ON DELETE SET NULL,  -- 角色类:回指角色库基角色
    parent_id UUID REFERENCES public.canvas_assets(id) ON DELETE SET NULL,       -- 多版本:父资产
    variant_label TEXT,                          -- 造型/版本名(如「唐朝造型」;NULL=基础版)

    source TEXT NOT NULL DEFAULT 'user_created' CHECK (source IN ('user_created', 'official')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT canvas_assets_owner_check CHECK (source = 'official' OR user_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_canvas_assets_user_type
    ON public.canvas_assets(user_id, asset_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_canvas_assets_character_model
    ON public.canvas_assets(character_model_id) WHERE character_model_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canvas_assets_parent
    ON public.canvas_assets(parent_id) WHERE parent_id IS NOT NULL;

ALTER TABLE public.canvas_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canvas_assets_select_own" ON public.canvas_assets;
CREATE POLICY "canvas_assets_select_own" ON public.canvas_assets
    FOR SELECT USING (auth.uid() = user_id OR source = 'official');
DROP POLICY IF EXISTS "canvas_assets_insert_own" ON public.canvas_assets;
CREATE POLICY "canvas_assets_insert_own" ON public.canvas_assets
    FOR INSERT WITH CHECK (auth.uid() = user_id AND source = 'user_created');
DROP POLICY IF EXISTS "canvas_assets_update_own" ON public.canvas_assets;
CREATE POLICY "canvas_assets_update_own" ON public.canvas_assets
    FOR UPDATE USING (auth.uid() = user_id AND source = 'user_created');
DROP POLICY IF EXISTS "canvas_assets_delete_own" ON public.canvas_assets;
CREATE POLICY "canvas_assets_delete_own" ON public.canvas_assets
    FOR DELETE USING (auth.uid() = user_id AND source = 'user_created');

COMMENT ON TABLE public.canvas_assets IS '双轨资产库:场景/道具/角色造型变体。基角色仍在 ai_models(character_model_id 回指);设定图生成状态以 generations(reference_task_id)为唯一真相源;无 updated_at 触发器,写路由手动维护';
COMMENT ON COLUMN public.canvas_assets.user_id IS '资产属主;官方种子资产为 NULL(对齐 ai_models.owner_id 可空先例,020_character_system.sql:19-20),避免挂管理员账号被删号 CASCADE 连坐';
COMMENT ON COLUMN public.canvas_assets.description IS '资产设定描述:黄金 prompt 模板的 {asset_description} 变量本体,LLM 初稿+用户可改';
COMMENT ON COLUMN public.canvas_assets.reference_sheet_url IS '存 OSS object key(非完整 URL),渲染/注入时换签名 URL(§八)';
COMMENT ON COLUMN public.canvas_assets.variant_label IS '同一角色多造型:兄弟行共享 character_model_id,各持独立设定图';
COMMENT ON COLUMN public.canvas_assets.prompt_template_version IS '生成设定图时的模板版本,配合 description_edited 决定模板升级是否重写描述';

NOTIFY pgrst, 'reload schema';
```

```sql
-- ============================================================================
-- 20260721_blueprints_dual_track.sql — blueprints 双轨扩展(P2,依赖 20260720)
-- ============================================================================
ALTER TABLE public.blueprints
    ADD COLUMN IF NOT EXISTS story JSONB,
    ADD COLUMN IF NOT EXISTS assets JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.blueprints DROP CONSTRAINT IF EXISTS blueprints_source_type_check;
ALTER TABLE public.blueprints ADD CONSTRAINT blueprints_source_type_check
    CHECK (source_type IN ('product_link', 'product_images', 'reference_video', 'manual', 'story_script'));

COMMENT ON COLUMN public.blueprints.story IS '漫剧故事简报 {title,genre,tone,duration_hint_sec,synopsis,acts[],visual_style};与 product 互斥(路由层保证)';
COMMENT ON COLUMN public.blueprints.assets IS '蓝图内资产实例 [{local_id,asset_type,alias,description,asset_id?,asset_table?,reference_sheet_url?,reference_task_id?,…}];生成状态查 generations';

NOTIFY pgrst, 'reload schema';
```

> 注:20260702 建 blueprints 时 source_type 的 CHECK 是内联未命名约束,PG 自动命名为 `blueprints_source_type_check`,上述 DROP/ADD 幂等成立;若生产命名不同,执行前 `\d blueprints` 核对(迁移文件头注明)。

---

## 四、一致性黄金 prompt 模板化(Q4)

### 4.1 模板存哪:**代码常量 + 版本号**(仿总纲 §八 PRICING_VERSION 模式;注意该常量本身是 P1 计划项,当前 grep 0 命中,本处是同模式并行落地,不依赖它先行)

新文件 `src/lib/studio/asset-prompts.ts`(纯函数零 IO,与 ai-gen-prompts.ts 同纪律,客户端/服务端共用):

```ts
export const ASSET_PROMPT_TEMPLATE_VERSION = 1;

export const ASSET_PROMPT_TEMPLATES = {
  character_4view: { /* LibTV 黄金 prompt 骨架:横向构图/纯白背景/摄影棚平光/
    正面半身特写+全身正面居中+左侧面+背面/所有视图面部发型体型服装一致/
    禁道具武器他人文字水印背景 + [视觉风格: {visual_style}] + {asset_description} */ },
  prop_6view:      { /* 六视图:前/后/左/右/顶/45°细节,纯白背景,材质细节一致,无手无场景 */ },
  scene_card:      { /* 场景卡:单幅全景设定图,室内外/尺度/光源方位/空镜无人物,{visual_style} */ },
} as const;

export function compileAssetSheetPrompt(
  templateId: keyof typeof ASSET_PROMPT_TEMPLATES,
  vars: { visual_style: string; asset_description: string; extra?: string }
): string;
```

排除 DB 模板表的理由:①模板是产品逻辑不是用户数据,无运营后台、无按用户定制需求(风格市场已裁);②随代码走可 diff 审查、可单测,升级=改常量+版本号 bump,与 recipes 种子配方常量、compileScenePrompt 常量的既有惯例一致(recipes.ts:113;ai-gen-prompts.ts:37-47);③避免再造一张要 RLS/要缓存/要迁移的表。若 P4 社区模板市场触发,届时再上表——常量版本号使迁移无损。

### 4.2 变量槽定义(类别差异)

| 槽 | character_4view | prop_6view | scene_card |
|---|---|---|---|
| `{visual_style}` | blueprint.story.visual_style(全局)‖ asset.visual_style 覆写 | 同 | 同 |
| `{asset_description}` | canvas_assets.description / blueprints.assets[].description(年龄/发型/瞳色/标志特征/服装/神态) | 材质/尺寸/结构/标志细节 | 室内外/尺度/时代/光源/关键陈设 |
| 布局骨架(模板固化,非变量) | 4 视图(半身特写+全身+左侧+背)| 6 视图 | 单幅全景 |
| `{extra}` | 可选追加约束(留空) | 同 | 同 |

**全局风格字段落点收敛(与遗漏审查对齐)**:漫剧轨全局风格=`blueprints.story.visual_style`,资产级覆写=`canvas_assets.visual_style`(上表,维持不变);**电商轨(无 story)全局风格落 `blueprints.globals.style`**——globals 是 jsonb 无需 DDL,仅 PATCH sanitize 白名单放行,随 20260721 迁移批次(P2)一并处理。编译器取值序统一为:`story.visual_style ?? globals.style ?? 商品风格默认`(§五.2 ①)。

### 4.3 生成设定图拼接规则

`最终prompt = 模板骨架(布局+白底+平光+一致性硬约束+负面清单) ⊕ [视觉风格: {visual_style}] ⊕ {asset_description}`——**运行时拼接,拼接结果不回写 description**。产物走 `/api/generate/image`(action=generate,若有用户上传底图则作 sourceImageUrls 垫图),task 落 generations,`reference_task_id` 存回资产行,完成后回填 `reference_sheet_url`(存 OSS object key,注入/渲染时换成 media.toryxai.com 白名单域完整 URL,image-reference-url.ts:4;见 §八)。

### 4.4 用户手改与模板升级共存

- 用户改的是 **description(数据)**,模板骨架是**代码**,二者拼接边界清晰 → 模板升级(版本 1→2)不触碰任何用户描述。
- 资产行记录 `prompt_template_version`(生成时版本)+ `description_edited`。重生成设定图一律用**当前**模板版本 + 现 description;UI 在 `prompt_template_version < 当前版本` 时提示「模板已升级,重新生成可获得更稳的一致性」,不自动重生成(设定图重生成要花积分,自动跑=偷扣费)。
- LLM 重写描述(「重新识别」动作)仅当 `description_edited=false` 时允许一键覆盖,已手改则必须 diff 确认(沿用配方脱敏 diff 的红队裁决模式,blueprint-drawer.tsx:939-1044)。

---

## 五、@资产引用链(Q5)

### 5.1 存储表示:**结构化 asset_refs 为真相 + visual 内联 @alias 仅作展示**(方案 A 变体)

| | 方案A:visual 纯文本 + asset_refs 分离 | 方案B:内联 `@[alias](asset_id)` 标记 |
|---|---|---|
| 编辑体验 | @弹出选择器后同时写两处(文本插 @alias、数组插引用) | 光标处天然 |
| 解析稳定 | **无解析**——编译只读数组,文本坏不了数据 | 正则解析;用户删掉半个标记/复制粘贴串行即碎;PATCH sanitize 要容忍嵌套括号转义 |
| 改名连锁 | alias 是快照,改名后旧镜显示旧名但 asset_id 恒有效;提供「同步别名」批量替换(纯展示层操作) | 每次改名必须全 scenes 文本替换,漏一处=显示与引用分裂 |
| 与现状兼容 | visual 仍是纯文本/URL 双态,drawer :774 与 ai-gen-prompts :75-77 的 `startsWith('http')` 分流零改 | URL 态 visual 与标记语法互斥,分流逻辑要加第三态 |

**采纳**:`scenes[i].asset_refs = [{asset_id, alias, asset_type}]`(asset_id = blueprints.assets[].local_id 或全局 canvas_assets.id/ai_models.id,带 `asset_table` 消歧;上限 6/镜)。visual 文本中的 `@alias` 由编辑器渲染为蓝色高亮 chip(按 alias 与 asset_refs 匹配,匹配不到降级为普通文本,永不报错)。`sanitizeScenes` 白名单同步放行 asset_refs(逐元素校验 UUID/local_id 格式)。

### 5.2 compiled_prompt 编译规则(拼接顺序)

```
compiled_prompt =
  ① 全局风格头:[Style: {story.visual_style ?? globals.style ?? 商品风格默认}](取值序见 §四.2 收敛条款)
  ② 画面描述:visual(去除 @ 符号,alias 保留为普通名词)
  ③ 镜头语言:shot_size + camera_move + lighting(缺失键跳过)
  ④ 逐资产设定块(按 asset_refs 顺序):
     "Character 唐朝沈昭昭: <description 消毒截断>" / "Scene …" / "Prop …"
     —— 消毒复用 getSafeCharacterDescription 口径(≤420 字符、剥 <>,character-assets.ts:183-195);
        一致性指令句复用 buildCharacterConsistencyPrompt 的句式(:197-207)
  ⑤ 节奏尾注:Target segment duration: {duration_ms/1000}s(对齐 compileScenePrompt 现尾注,ai-gen-prompts.ts:88)
```
纯函数落 `src/lib/studio/asset-prompts.ts`(与 4.1 同文件),编译结果写回 `scenes[i].compiled_prompt + compiled_at`;提交生图时**以 compiled_prompt 为 prompt**,视频腿经 `compiledPrompt` 可选键传递(§二.4);用户可在「合成提示词」步手改(手改后 compiled_at 置为 `manual`,上游变更不再自动覆写,重编按钮显式恢复)。

### 5.3 逐镜生图垫图注入(对齐现网关,零 fork)

- **通道**:走 `/api/generate/image`。
  - **第一个角色类引用** → `characterAsset` 通道:把 canvas_assets/实例行打包成 CharacterAssetSnapshot 同形对象(id/name/description/reference_sheet_url/reference_images/avatar_url)——路由 sanitize 只要求 id/name 为 string(route.ts:40),不校验来源表,**canvas_assets 行直接可用**;其参考图被自动排在垫图最前(route.ts:386-394 的合并顺序:characterReferenceUrls 在最前)。
  - **其余资产(第 2+ 角色/场景/道具)** → `sourceImageUrls` 参数(route.ts:349,378),每资产取 `reference_sheet_url` 1 张(缺则 reference_images[0])。
  - **商品轨**:商品图继续走 sourceImageUrls(现状不变)。
- **快照来源表标记与 model_id 禁令**:canvas_assets 行打包 CharacterAssetSnapshot 时,在快照对象里附 `asset_table:'canvas_assets'` 标记——快照 JSONB 原样落 generations.metadata.character_asset(submit route:328-331),加键零成本;消费端(角色维度统计/对账/签约校验)按此区分 ai_models.id 与 canvas_assets.id(两者 UUID 同形,不加标记不可区分)。**明令:canvas_assets.id 绝不可写入 generations.model_id**——008 外键 REFERENCES ai_models(008:7-8),插库直接失败。
- **数量上限(实读代码确认)**:路由层**无总数上限**,仅 4K 九宫格模式收敛为 1 张(route.ts:406-419);上游 openai-image-api **硬截断 16 张**(openai-image-api.ts:30,204);全部 URL 必须 HTTPS + `media.toryxai.com` 白名单域(image-reference-url.ts:4,82-93)→ **所有设定图必须先落自有 OSS 才能当垫图**(key→URL 换取见 §八)。产品规则:每镜垫图预算 = 每引用资产 1 张 + 该镜 slot 素材图,总数软上限 8(留质量余量,远低于 16 硬顶),超出按 asset_refs 顺序截断并在合成提示词步黄字提示。
- **图生视频注入**(`models/submit`):`characterAsset` DTO 只有一个槽(route.ts:25),多资产同镜时:主角走 characterAsset,其余资产设定图进 `referenceImageUrls`。**实际合并序(实读代码)**:merge 前置主角色 ref → veo 首帧(unshift)→ 角色 refs[1:] → imageUrls → referenceImageUrls → veo 尾帧 → mainGrid(route.ts:107-121 组装/unshift/merge;character-reference.ts:48-72 前置与截断)。**硬上限=所选模型 maxImages:sora2/sora2-pro/seedance=1、veo=3、grok=4、omni=7、happyhorse=9**(catalog.ts:20-116);**超限行为=merge 内静默截断,不是 400 拒单**——normalizeImageUrls 内部经 mergeCharacterReferenceImages 已截断到 model.maxImages(character-reference.ts:54-69 到 limit break),route.ts:257-261 的 400 分支对 characterAsset+referenceImageUrls 注入链**不可达**(仅对绕过 merge 的入参成立);「超出黄字提示」由前端按 catalog maxImages **预检**实现,不依赖服务端 400。**veo(maxImages=3)场景的实际保留集=主角色 ref + 首帧 + 1 张**(第三席按合并序落给 角色 refs[1:] → imageUrls → referenceImageUrls 的第一张)——即 referenceImageUrls 里第 2+ 资产的设定图在 veo 上几乎必然被截掉。**产品截断规则据此改写**:视频腿不承诺多资产垫图,多资产一致性必须预烧进首帧分镜图;referenceImageUrls 仅在高上限模型(grok/omni/happyhorse)上作增强,前端在所选模型 maxImages 容不下全部引用时,按上述合并序黄字预告「将被截断的资产清单」。**设计定调**:漫剧一致性的主通道是「逐镜分镜图(已注入全部资产)→图生视频首帧」,视频端垫图只是增强——seedance(mode:'none',character-reference.ts:18)与 sora2(1 张)上一致性完全依赖首帧图,这条链路对所有模型成立,故批量生视频默认 image_to_video(首帧=scene_frame slot),不依赖模型垫图能力。

---

## 六、canvases 文档表 DDL 草案(Q6)

```sql
-- ============================================================================
-- 20260714_canvases.sql — 超级画布文档表(P0)
-- ADR:jsonb 只存拓扑+引用;禁 dataURL/签名 URL,只存 OSS object key;
-- 执行状态唯一真相源=generations,本表只存 nodeId→引用。幂等。
-- 注意:本表无 updated_at 触发器,updated_at 由写路由手动更新
--      (沿用 blueprints 惯例,[id]/route.ts:16,212)。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.canvases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '未命名画布',

    schema_version INTEGER NOT NULL DEFAULT 1,          -- 文档 schema 版本(zod 迁移注册表 v1→v2→…)
    doc JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[],"groups":[]}'::jsonb,
    deps JSONB NOT NULL DEFAULT '{"models":[],"voices":[],"characters":[],"assets":[],"recipes":[]}'::jsonb,

    rev BIGINT NOT NULL DEFAULT 0,                      -- 保存序号:UPDATE…SET rev=rev+1 WHERE rev=:expected(补丁 rebase 的服务端锚)
    writer_tag TEXT,                                    -- 单写者:当前写者标签 id(navigator.locks 持有者上报)
    writer_heartbeat_at TIMESTAMPTZ,                    -- 写者心跳;超时(如 30s)其他标签可接管
    doc_bytes INTEGER,                                  -- 保存时服务端计算;>524288(512KB)API 拒存

    share_slug TEXT UNIQUE,                             -- P3 只读分享链接(NULL=未分享)
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvases_user_updated
    ON public.canvases(user_id, updated_at DESC);

ALTER TABLE public.canvases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canvases_select_own" ON public.canvases;
CREATE POLICY "canvases_select_own" ON public.canvases
    FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "canvases_insert_own" ON public.canvases;
CREATE POLICY "canvases_insert_own" ON public.canvases
    FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "canvases_update_own" ON public.canvases;
CREATE POLICY "canvases_update_own" ON public.canvases
    FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "canvases_delete_own" ON public.canvases;
CREATE POLICY "canvases_delete_own" ON public.canvases
    FOR DELETE USING (auth.uid() = user_id);
-- 注:P3 分享改造时另加 share_slug 匿名只读策略,当前不建。

COMMENT ON TABLE public.canvases IS '超级画布文档:仅存拓扑+引用(nodeId→taskId/generationId/blueprintId/assetId);执行状态唯一真相源=generations;媒体只存 OSS object key;无 updated_at 触发器,写路由手动维护';
COMMENT ON COLUMN public.canvases.rev IS '乐观并发序号,补丁保存 CAS 锚;配合 writer_tag 实现单写者';
COMMENT ON COLUMN public.canvases.deps IS '依赖清单 {models[],voices[],characters[],assets[],recipes[]}:分享复制时逐项校验可用性';

NOTIFY pgrst, 'reload schema';
```

**doc 结构约定(zod schema v1,坏节点降级占位卡)**:

```jsonc
{
  "nodes": [{
    "id": "n_x7f2",
    "type": "text",                      // text|image|video|product|script|compose(6类白名单)
    "variant": "story_brief",            // 可选(§一 剧本变体)
    "position": { "x": 0, "y": 0 },
    "group_id": null,
    "data": {
      "title": "…",
      "params": { "modelType": "seedance", "aspectRatio": "9:16" },  // 生成器面板参数快照
      "refs": {                          // ★ 对账引用约定:nodeId→服务端对象,全部可空
        "blueprintId": null,             // script 节点→blueprints.id
        "assetId": null,                 // →canvas_assets.id / ai_models.id(配 assetTable)
        "generationId": null,            // →generations.id(终态锚)
        "taskId": null,                  // →generations.task_id(轮询锚;对账合约 jobKey)
        "batchId": null                  // →generations.batch_id(批量节点)
      },
      "media": { "ossKey": "studio/u123/abc.mp4", "posterKey": "studio/u123/abc.jpg" }  // 禁 URL/dataURL
    }
  }],
  "edges": [{ "id": "e1", "source": "n_a", "target": "n_b", "sourceHandle": null, "targetHandle": null }],
  "groups": [{ "id": "g1", "label": "第一场", "node_ids": ["n_a","n_b"] }]
}
```

**deps 结构**:`{"models":["seedance"],"voices":["voice_x"],"characters":[{"id":"…","table":"ai_models"}],"assets":[{"id":"…","table":"canvas_assets"}],"recipes":["uuid"]}` ——保存时由前端从 nodes 聚合去重写入(v1 即有字段可空,ADR 5);P3 复制画布时逐项查可用性(模型下线/音色无权限/角色未签约逐项红字)。

**updated_at 维护条款**:canvases 与 canvas_assets 均**不建 updated_at 触发器**,updated_at 由写路由手动更新——沿用 blueprints 既有惯例([id]/route.ts:16 注释「表无触发器」,:212 手动写 patch.updated_at)。**canvases 的 PATCH 保存合约必须每次补丁保存都写 updated_at**,否则 `idx_canvases_user_updated` 的「最近编辑」排序失真。

**单写者与对账**:写者持 navigator.locks 后 `UPDATE canvases SET writer_tag=:tag, writer_heartbeat_at=now() WHERE id=:id AND (writer_tag IS NULL OR writer_tag=:tag OR writer_heartbeat_at < now()-interval '30 seconds')`,行更新 0 行=只读横幅;每次补丁保存带 `WHERE rev=:expected` CAS。对账=遍历 nodes 收集 `refs.taskId/generationId` → 按对账合约批量查 generations 收敛状态(超时判死触发幂等退款,ADR 4)。op log 不入 DB(本地 IndexedDB 影子副本承担),避免 P0 造平行事件表。

---

## 七、分期落点表(迁移顺序依赖)

| 期 | 迁移/代码落点 | 内容 | 依赖 |
|---|---|---|---|
| **P0** | `20260714_canvases.sql` | canvases 表(§六全量,share_slug 字段先建不启用);zod schema v1 + 迁移注册表;refs 引用约定进代码 | 无(不动 blueprints/ai_models/generations——batch_id/spec 已在 20260702 就位) |
| **P1** | 积分框架迁移(总纲 §八 ①③④,另档 planreview-credits,不在本文展开) | estimate API + PRICING_VERSION 常量(4.1 的 ASSET_PROMPT_TEMPLATE_VERSION 仿此同模式);credit_transactions 退款幂等唯一索引/流水标准化;下线两个无鉴权路由 | P0 后;与本文数据模型无表级耦合 |
| **P2‑a** | `20260720_canvas_assets.sql` | canvas_assets 表(§三 DDL) | 先于 P2‑b(blueprints.assets 的 asset_id 引用它) |
| **P2‑b** | `20260721_blueprints_dual_track.sql` + 代码 | blueprints 加 story/assets 列 + source_type 加 `story_script`(§一/§三);**代码:POST 路由新增 story_script 入参校验分支**(story 卡 sanitize、product 必填校验按 sourceType 分派:product 轨要求商品卡、story 轨要求 story 卡,§一.1);globals.style 电商轨全局风格键随本批放行(§四.2,jsonb 零 DDL) | P2‑a |
| **P2‑c** | 代码(无 DDL) | scenes 9 维度:`sanitizeScenes` 白名单扩键(shot_size/lighting/sfx/camera_move/compiled_prompt/compiled_at/asset_refs + slot.kind 加 `scene_frame` + 服务端按 idx 合并保留新键防旧端冲写,§二);**[id]/route.ts GET 显式列清单追加 `story, assets`(:130-134)+ PATCH 白名单增加 `story`/`assets` 键(:169-207,sanitize 与 scenes 同纪律)**;`asset-prompts.ts`(模板常量+compileAssetSheetPrompt+compiled_prompt 编译器,§四/§五);drawer 分镜表新列(sfx 列标注「暂不参与生成」,§二.4)+ story 视图分支 + 资产装配步(组件级复用);文本节点 story_brief 变体(待用户裁决,§一.2) | P2‑b(story/assets 列);PATCH/GET 扩展与 DDL 同 PR 落 |
| **P2‑d** | 代码(无 DDL) | 注入链:canvas_assets→CharacterAssetSnapshot 打包器(附 asset_table 标记,§五.3);逐镜生图 characterAsset+sourceImageUrls 注入(§五.3);批量生视频默认首帧链 + 批量生分镜图 DB 排队(§九);**`AiGenSceneSpec`/`AiGenSceneInput` 增 `compiledPrompt` 可选键 + `toAiGenTask`/`compileScenePrompt` 加「有则用之,无则现状」兼容分支(§二.4,camera_move/lighting 经此进视频 prompt)** | P2‑a/c;网关零改动(全部走现有 DTO) |
| **P3** | 代码为主 | share_slug 启用 + 匿名只读 RLS 策略追加迁移;deps 校验复制;reference_cache 承接商品链接解析(表已在 20260702:110-133,零新建);hold_settle 表冻结落库按总纲 §八 | P0(字段已留);canvases 分享策略单独小迁移 |
| **P4** | 视触发 | 模板市场若立项才考虑 prompt 模板 DB 化(4.1 版本号保证无损迁移);时间线以合成节点数据结构为底座演进(sfx 存量数据届时接入,§二.4) | — |

**变更总量盘点**:新表 2 张(canvases、canvas_assets),旧表加列 1 张(blueprints +story/+assets/+枚举),ai_models/generations/recipes **零 DDL 改动**;网关与执行器**零 fork**(全部注入走既有 characterAsset/sourceImageUrls/referenceImageUrls 参数)。既有代码修改点全部为**追加式**:① `sanitizeScenes`/PATCH 白名单扩键(scenes 新键 + story/assets);② `[id]/route.ts` GET 显式列清单追加 story, assets;③ POST 路由 story_script 校验分支(§一.1);④ `AiGenSceneSpec`/`compileScenePrompt` 的 compiledPrompt 兼容分支(§二.4);⑤ blueprint-drawer 增量视图分支——均在「白名单/清单/兼容分支追加」而非「链路改造」范畴。

**遗留风险两条(建议随 P2‑a 一并处置)**:① ai_models.reference_images 的 020/20260313 类型漂移(JSONB vs TEXT[])——迁移前先在生产 `SELECT data_type FROM information_schema.columns WHERE table_name='ai_models' AND column_name='reference_images'` 确认实际类型,canvas_assets 统一用 JSONB 即为吸取此教训;② ai_models 上 020 与 20260313 两套 RLS 策略叠放且 source 默认值互斥,角色变体接入前应做一次策略收敛审计(只审计不重构,避免动角色市场)。

---

## 八、资产图存储与 OSS 生命周期(交叉复核补强)

1. **统一存 object key,渲染层换签名 URL**(与画布 doc 媒体约定 ADR 5 同机制):资产图(角色四视图设定图/道具六视图/场景卡/九宫格/多角度追加图)在 canvas_assets.reference_sheet_url/reference_images 中一律存 OSS object key——列名沿用 `*_url` 后缀历史惯例,内容语义=key,**建表起即如此**(迁移文件头注释已注明)。对照历史:ai_models.reference_images 存的是 URL 文本(020/20260313 时代直存),消费端 `normalizeCharacterAssetImages` 已双兼容(character-assets.ts:60-89),**不回填不迁移,新旧并存**。垫图注入链要求 HTTPS + media.toryxai.com 白名单域完整 URL(image-reference-url.ts:4,82-93),提交时由注入层将 key 换成白名单域 URL,画布/资产面板渲染时换签名 URL。
2. **generations 为文件唯一真相源**:每张资产图的生成事实(task_id/status/费用/原始产物)只在 generations;资产表(canvas_assets/blueprints.assets)只存引用(reference_task_id + object key)。资产行与 generations 冲突时,一律以 generations 为准。
3. **删除策略=只标不删**:资产删除仅置 `status='archived'`,不物理删 OSS 文件,**不做引用计数**(scenes.asset_refs、画布 deps、generations.metadata 三处引用无法可靠倒排,计数必漂);孤儿文件回收交给后台**月度盘点脚本**(扫描 OSS key 与 generations/资产表引用的差集,冷备后清理),与画布媒体的孤儿盘点同一班次。
4. **量级预估(「一键生成所有资产」)**:典型漫剧画布 ≈ 7 资产(2-3 角色含变体 + 2-3 场景 + 1-2 道具),每资产设定图 1 张 + 追加参考 2-4 张 → 单画布资产图 ≈ 15-35 张、约 30-100MB;百级活跃画布 ≈ 数千张/数 GB——OSS 存储成本可忽略,但生成侧是**数十次计费调用**,必须走 §九 的排队机制与 P1 估价确认,不允许无预估直发。

---

## 九、批量生分镜图的排队与恢复(交叉复核补强)

- **现状**:`/api/generate/image` 是**单发路由,无批量模式**(route.ts:34 action 仅 generate/upscale/nine_grid);一次「批量生分镜图」= N 次独立 HTTP 调用,路由本身不感知批次。
- **ADR 7「批量一律 DB 排队」在图片腿的承载**:批次清单**先落库再消化**——复用 `generations.batch_id + spec`(20260702:15-32 已就位,**零 DDL**):点「批量生成分镜图」时先为每镜预创建 generations 行(status='queued',spec 记 `{blueprint_id, scene_idx, batch_id, compiled_prompt_hash}`),再由 BTM(批量任务管理器)逐镜取 queued 行发起 `/api/generate/image` 单发调用,回填 task_id。
- **并发闸**:同批并发 2-3;上游 429/限频按**指数退避**(1s/2s/4s…封顶 60s)重试当前镜,不整批熔断;单镜重试超限置 failed,批次其余镜继续。
- **恢复**:关标签页/休眠后,queued 与进行中的行都在**服务端 generations**——重新打开画布时经统一对账合约(遍历 nodes 的 refs.taskId/batchId 批量查 generations,§六)收敛已发任务状态,BTM 对残余 queued 行续跑,**天然可恢复,无本地状态依赖**(IndexedDB 影子副本只是加速,不是恢复依据)。
- **最大用例**:17 镜漫剧(LibTV 实测样本)= 17 行预创建 + 并发 2-3 ≈ 6-9 轮消化;超时判死与幂等退款沿用 ADR 4,批次级进度条按 generations 聚合渲染。
