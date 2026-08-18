# ADR：国际化(i18n)收敛为一套

- **状态**：已裁决(2026-08-18,用户)
- **适用范围**：全站(非超级画布专属;画布的 ADR 见 [SUPER_CANVAS_MASTER_PLAN.md](./SUPER_CANVAS_MASTER_PLAN.md) §四)
- **触发**：分支 `codex/i18n-language-consistency` 引入 `next-intl` 时的合并评审(2026-08-18)

---

## 一、背景:现在实际有几套

评审时实测,站内**同时存在三种做法**:

| # | 做法 | 代表 | 性质 |
|---|---|---|---|
| A | 语言状态机 | `src/contexts/LangContext.tsx` + `src/components/ui/LangToggle.tsx` | **语言真相源**(唯一,没有第二个) |
| B | 内联三元 | `lang === "zh" ? "中文" : "English"` 散落各页 | 文案渲染 · 旧写法 |
| C | 字典 | `next-intl` + `src/i18n/messages/{zh,en}/*.json` | 文案渲染 · 新写法 |
| D | **运行时改写业务数据** | `src/lib/character-localization.ts`、`src/lib/template-localization.ts` | ⚠️ **不是 i18n,是数据篡改** |

**先澄清一个容易搞混的点**:A 没有被复制成两份。`AppIntlProvider` 的 locale 是 `useLang()` 派生的
(`locale = lang === "zh" ? "zh-CN" : "en"`),所以点「切换语言」新旧页面会一起变,
**不存在「两个语言开关各管一半」的问题**。真正并存的是 **B 与 C 两种文案写法**,外加 D 这个走偏的东西。

## 二、决定

1. **语言真相源唯一 = `LangContext`。** 任何新机制的 locale 必须从 `useLang()` 派生,
   **禁止**新增第二处语言状态(localStorage key、cookie、URL 段、独立 context 都不行)。
   现有键为 `toryx-lang`;`detectBrowserLang()` 的推断结果**刻意不落盘**,只有用户显式切换才写入。

2. **UI 文案唯一机制 = `next-intl` 字典(C)。** 新代码**一律**用 `useTranslations`,
   **不准再新增** B 那种内联三元。B 属历史存量,**遇到顺手迁,不搞大爆炸式重构**。

3. **`AppIntlProvider` 只挂 `src/app/(main)/layout.tsx` 一处。**
   **禁止**在 per-segment layout 上各挂一层。理由见 §三-1(这是个白屏雷,不是洁癖)。

4. **禁止在运行时改写业务数据来冒充 i18n(D)。**
   角色名、角色描述、模板 `prompt_template`、用户自撰内容等**是数据不是文案**,
   多语言应走**数据库列**(如 `name_en` / `description_en`),由写入方提供,不在渲染期拼。
   `character-localization.ts` / `template-localization.ts` 视为**过渡态**,新增调用点需评审,并应逐步退场。

5. **字典必须与页面同步交付。** 新页面/新 tab 上线时,其**默认落地视图**不得存在无键的硬编码中文
   (含 `toLocaleDateString('zh-CN')` 这类隐式 locale)。

## 三、为什么(证据,不是偏好)

**1. per-segment provider 是白屏雷,而且不会在 review 里被看见。**
实测:`AppIntlProvider` 挂在 `character/create`、`models`、`templates` 三个 layout 上,
而使用 `useTranslations` 的 `hire-dialog.tsx`、`TemplateCard.tsx`、`TemplateFilters.tsx`、
`TemplateDetailDialog.tsx` **四个组件全住在共享的 `src/components/`**。
今天不炸,只因调用方恰好都在那三条路由内。一旦有人按「复用现成件」的规矩把 `<HireDialog>`
放进 `/studio` 或超级画布,`useTranslations` 会 **throw**,表现是**整页白屏,不是退化成中文**。

**2. D 这条路已经产出了三个真实缺陷**(2026-08-18 评审,均经对抗验证 + 实跑复现):

- `localizeOfficialCharacter{Name,Tag,Description}` **三个函数都声明了 `source` 参数却零读取**
  → 用户自建角色的自撰描述被整段替换成写死的
  `"An official character asset designed for consistent use across images and videos."`
  ——用户原文丢失,还给社区角色贴了**虚假的「官方」出处标签**;角色名被无差别拼音化
  (实跑:「小明的猫娘」→ `Xiao Ming De Mao Niang`)。
- `template-localization.ts` 英文模式把 `prompt_template` **整句换成机器拼的通用样板**,
  而复制按钮复制的正是这个值 → 精修的分镜/时间轴/BGM 全丢。
- `models/page.tsx` 卡片显示拼音、`filteredModels` 却匹配库里的原始中文,
  服务端 `name.ilike` 也直打中文列 → **英文用户搜自己看到的名字,前后端双双落空**。

三个缺陷的共同根因都是**把数据当文案翻译**。这不是实现没写好,是这条路本身错了。

**3. 两种文案写法并存的日常成本**:每写一个新字符串都要先做一次选择题;
排查文案问题要找两个地方;覆盖率断层不易发现(评审时 `/templates` 的默认落地 tab
有约 24 条中文一个键都没有,而英文用户第一屏看到的正是它)。

## 四、迁移策略(刻意保守)

- **立即**:决定 3(provider 上提)——一处改动,当场拆雷。
- **持续**:新代码只用 C;改到哪个文件、顺手把那个文件的 B 迁掉。
- **不做**:全站一次性迁移 B。巨大 diff、零功能收益、高回归风险,且仓库无 CI 兜底。
- **单独立项**:D 的退场方案(数据库列 + 写入方提供),需要先定表结构,不在本 ADR 范围。

## 五、代价与已知风险

- 短期内 B、C 仍会共存于同一代码库,**这是刻意接受的**,换取的是不冒大爆炸式重构的风险。
- `next-intl` 与 `pinyin-pro` 是新依赖(`^3.26.5` / `^3.29.2`),
  next-intl 3.x 与本仓库 Next.js 14 兼容;`pinyin-pro` 会进 `/models` 的客户端 bundle
  (评估区间 100–157KB gzip,**未经 build 前后实测**,若 D 退场则可一并移除)。
- 首屏中文闪一下再切英文,是 `LangContext` 既有行为(SSR 渲染中文 → 客户端挂载后校正),
  本 ADR 不改变它;但文案面积变大后闪烁会更显眼。

## 六、机器守卫(建议,尚未实现)

- 扫描:`src/components/**` 里出现 `useTranslations` 但其 provider 不在 `(main)/layout.tsx` → 判红。
- 扫描:新增文件里出现 `lang === "zh" ?` → 判红(存量文件豁免,走白名单)。
- 上述两条落进 `scripts/` 后,本 ADR 才算真正可执行;在此之前靠 review 守。
