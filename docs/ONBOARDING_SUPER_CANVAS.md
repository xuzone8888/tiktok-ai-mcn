# 超级画布 · 接手指南(chen46749)

> 写给第一次进这个仓库、要接手**超级画布**的人。方向由你定;这份文档只负责让你**不踩已经有人踩过的坑**。
> 全文读完约 10 分钟,**别跳过第 1 节**——那节讲的是会花掉真钱、改到真数据的事。

---

## 0. 30 秒现状

StarGaze 是 AI 视频创作平台(Next.js 14 + Supabase + 阿里云 OSS,生产站 toryxai.com)。
**超级画布** 是对标 liblib.tv LibTV 的无限画布节点编排:一套「分镜 → 资产装配 → 逐镜图 → 图生视频 → 配音 → 合成」中台,
两种起点(**电商带货** = 商品节点起 / **剧情创作** = 剧本节点起)。

| 期次 | 功能点 | 状态 |
|---|---|---|
| P0 画布骨架 | 48 | ✅ 全部上线 |
| P1 生成接入 | 48 | ✅ 批 0-5 完成并上线;**剩批 6(#211 交互式教程)**,老板裁决「教程放最后」 |
| P2 | 55 | ⛔ **未开工、无看板**。五批方案已获老板认可(底座→脚本节点→资产一致性→批量闭环→收尾) |
| P3 / P4 | 11 / 1 | 未开工 |

**画布自 2026-08-09 起对所有登录用户开放**(老板裁决:用户少,跳过灰度)。也就是说 —— **你改的是线上功能**。

---

## 1. 🔴 开工前必须知道的五件事(会咬人)

### ① 本地 dev 连的是**生产** Supabase

不是本地库,不是测试库。你在本地画布上建的节点、跑的生成、扣的积分,**都是生产库里的真行**。
`SUPABASE_SERVICE_ROLE_KEY` 绕过所有 RLS,等同数据库管理员。

⇒ 别写「清库/批量删」的脚本试手;要造数据就新建一张自己的画布,别动别人的。

### ② 生成是**真扣费**

图片 5 积分/次,视频 5 秒 450 分、12 秒 1080 分。厂商终局失败会全额退款(已实测 4/4),
但**成功的不退**。调试生成链路时优先用图片(5 分),别拿视频练手。

有两道保护你要知道、别顺手拆了:
- **#185 拦截式确认**:余额 < 预估×1.2 或单次 > 1000 分时弹确认。阈值只在服务端。
- **出处闸** `generation-consent.ts`:管「这一下是不是用户真要花的」,与金额轴正交。

### ③ Node 必须是 **20.12 ~ 20.x**

`package.json` 的 `engines` 卡了 `>=20.12 <21`。用 Node 22/24 大部分能跑,但 `verify-canvas-blue-green.mjs` 会直接红。

### ④ 画布有**单写者锁**

10 秒心跳 / 30 秒租约。同一张画布同时开两个标签页,第二个进只读态——这是**正确行为**,不是 bug。
反复刷新会不断新建会话把租约等待重新计时,别据此怀疑它坏了。

### ⑤ 浏览器复验前先查可见性

后台标签页 rAF 停发 → 动画永不结束 → **正常弹层看起来像「点死画布」**。已经有人据此差点回滚好功能。

```js
// 复验前先在 console 跑这个,必须 visible + rafFired:true
const t0=performance.now();
const fired = await new Promise(r=>{requestAnimationFrame(()=>r(true)); setTimeout(()=>r(false),2000)});
({ visibility: document.visibilityState, rafFired: fired, waitedMs: Math.round(performance.now()-t0) })
```

---

## 2. 环境搭建(约 15 分钟)

```bash
git clone https://github.com/xuzone8888/tiktok-ai-mcn.git
cd tiktok-ai-mcn
git checkout feat/super-canvas-teammate
npm install
cp .env.example .env.local   # 值找老板要,别自己编
npm run dev                  # 起在 3000
```

**`.env.local` 的值必须找老板单独给你**,仓库里只有键名模板。

> 🔴 画布生成报 401 时,几乎所有人第一反应是「厂商凭证过期」——**基本都是错的**。
> 真因通常是 `VIDEO_PLATFORM_*` 那 **12 个键整块缺失**,三级回退全落空才 401。
> 这个误判在本项目重复发生过多次,`.env.example` 里已就地标红。

登录后访问 <http://localhost:3000/canvas>。`/canvas` 有硬鉴权门(在 `src/middleware.ts`),匿名访问返回 307。

---

## 3. 怎么读懂这套画布

### 文档地图(按需读,别全读)

| 文档 | 什么时候看 |
|---|---|
| `CLAUDE.md`(仓库根) | **先读这个**。铁律 + 关键路径速查 |
| `docs/SUPER_CANVAS_CHECKLIST.md` | **220 项功能点唯一事实源**。「这功能做不做/几期做」的答案都在这 |
| `docs/SUPER_CANVAS_P0_BOARD.md` | 每一批的落地明细、踩过的坑、复验结果。**查历史决策看这个** |
| `docs/SUPER_CANVAS_DATA_MODEL.md` | 表结构 / 字段映射 / 注入链 |
| `docs/LIBTV_FEATURE_INVENTORY.md` | 对标字典。还不懂就去 LibTV 实地看(探索免费,点生成才扣积分) |
| `docs/SUPER_CANVAS_MASTER_PLAN.md` | 总纲:范围/ADR/分期/验收 |

### 代码地图

| 位置 | 是什么 |
|---|---|
| `src/lib/canvas/schema.ts` | **类型唯一契约**。所有画布数据形状在这里定 |
| `src/stores/canvas-store.ts` | 画布状态机(zustand)。节点/边/历史/写者锁/只读判定 |
| `src/lib/canvas/rf-adapter.ts` | 持久化域节点 ↔ ReactFlow 视图节点的**严格分层** |
| `src/components/canvas/nodes/` | 各类节点组件(文本/图片/视频/商品/脚本/合成) |
| `src/components/canvas/canvas-generation-context.tsx` | 生成编排、轮询、#43「输入已更新」派生 |
| `src/components/background-task-manager.tsx` | 执行引擎 BTM(浏览器内编排器) |
| `src/app/api/canvas/` | 画布服务端(文档读写、上传凭证、生成、对账) |

### 🔑 一个会反复咬人的陷阱(已经咬过两次)

往画布 `data` 里写**值为 `undefined` 的 own 键**,会让整次写入**静默失败**:
zod 对「present 但值为 undefined」的可选键**原样保留成 own 键** → 持久化层 `isPersistableJsonValue` 判否
→ `cloneCanvasEntity` 返回 `null` → **`updateNodeData` 静默返回 `false`**,不抛异常、不提示。

2026-08-14 就因为这个,「移除商品图」在所有画布上全线不可用,而错误文案还把人往写者锁上引。

**规矩**:
- 写进 data 的对象,先过 `JSON.parse(JSON.stringify(x))` 或显式解构摘键;
- 要**移除**一个可选键(比如清空 `media`),用 `updateNodeData(id, patch, { unset: ["media"] })` ——
  浅合并 `{...node.data, ...patch}` 传 `key: undefined` **永远删不掉键**;
- 调 `updateNodeData` **一定要检查返回值**,它失败是静默的。

---

## 4. 铁律

方向你定,但下面这些不是风格偏好,是**踩过事故立的规矩**。要改先说一声。

1. **零 fork** —— 执行留现有链路(BTM / 统一网关 / `generations` 表),画布只是编排视图。不 fork 任何 API / 执行器 / store 原语。**需要新能力就扩现有的**(比如 `updateNodeData` 的 `unset` 就是扩,不是另起一个)。
2. **`generations` 表 = 执行状态唯一真相源**;画布文档只存 `nodeId → taskId/generationId` 引用。
3. **画布文档禁存 dataURL / 签名 URL,只存 OSS object key**,渲染层再换签名 URL。
4. **`canvas-store.ts` 严禁 persist 画布文档**(持久化走服务端,不走 localStorage)。
5. **`src/lib/canvas/schema.ts` 是类型唯一契约**,别自定义平行类型。
6. **节点白名单 6 类**(文本/图片/视频/商品/脚本/合成)。加新节点类型要先说。
7. **三库同源** —— 历史/角色/积分直读现有表,不建平行表。
8. **迁移纪律** —— SQL 落盘 + 本地校验;**生产执行由老板经 Supabase dashboard 手动跑**(生产没有 `exec_sql` RPC)。迁移文件**永不删除**。本地可用 `scripts/verify-canvas-readiness-migration.mjs` 起 PGlite 真 Postgres 预演。
9. **改价目要先问** —— 计价链路已在生产运行。
10. **功能取舍**(做/裁/延、放哪一期)以 CHECKLIST 为准。你可以提调整建议,但**别直接改判定** —— 改完必须跑 `node scripts/canvas-checklist-reconcile.mjs` 至绿(它是机器守卫,会校验统计自洽 + P0 功能点与看板一一对应)。
11. **禁 `git push --force`** —— 仓库无 CI、无必需审查,分支保护是唯一结构性防线。

---

## 5. 提交前跑什么

```bash
node scripts/canvas-checklist-reconcile.mjs   # 改过 CHECKLIST/看板才需要
npx tsc --noEmit                              # 每个子任务都要过
npm run build                                 # 涉及页面就要过
node scripts/verify-canvas-p1-batch5.mjs      # 商品节点相关(49 条)
node scripts/verify-canvas-generation-frontend.mjs   # 生成前端(219 条)
```

**⚠️ `npm run dev` 和 `npm run build` 抢 `.next`**:dev 开着跑 build 会报
`PageNotFoundError: Cannot find module for page: /xxx`,而且**每次报的页面还不一样**,看着像随机故障,其实是竞态。
先停 dev 再 build。

**测试基线(重要,别把已知红当成自己搞坏了)**:全量 60 个脚本里 **3 个是环境红**,未改动的树上同样红——
① `verify-canvas-p1-fixture.mjs`(要本机 PostgreSQL,端口 54329)
② `verify-video-model-contract.mjs`(要 `.temp/` 下一个生成的夹具)
③ `verify-canvas-blue-green.mjs`(强制 Node 20 + 发版前置)
**红第四个才是真回归。** 怀疑自己搞坏了,就 `git stash` 后重跑对比。

---

## 6. Git 流程

- 你的分支:**`feat/super-canvas-teammate`**(从 `main` 切,已含 P0 + P1 批 0-5 全部工作)
- 干活前先同步:`git fetch origin && git merge origin/main`
- 提交信息用中文、里程碑级(别一行一个 commit)
- 开 PR 回 `main`;**合并由老板点**
- **禁 force push**;删远端分支前逐个人工确认

---

## 7. 当前未闭合的东西(你可能想从这里下手)

- **判据 10:换商品主图后下游「输入已更新」角标点亮** —— 四环已证三环,只差「有产物」这个前置。
  卡在厂商:中转商回 `No available channel for model gpt-image-2`,而图片模型在代码里**硬编码**为 gpt-image-2,无备用可切。
  通道恢复后 5 分钟可收口:商品节点传 2 张图 → 连图片节点 → 生成成功一次 → 删掉商品第 1 张 → 应出现角标。
- **批 6 #211 交互式教程** —— P1 最后一项,老板裁决放最后。范围小、独立、不碰计费链路。
- **P2(55 点)** —— 未开工。开工前置:建 P2 看板 + 扩机器守卫;另有「场景/道具落表方案」与「音频开关价目」两项要老板裁决。
- **已知非阻断摩擦**:1352×642 视口下生成面板溢出停靠位 66px(评估过,不再调)。

---

## 8. 有问题问谁

- **功能该不该做 / 放哪一期** → 先查 `docs/SUPER_CANVAS_CHECKLIST.md`,查不到再问老板
- **为什么当初这么做** → 查 `docs/SUPER_CANVAS_P0_BOARD.md`,踩过的坑和裁决都逐条记着
- **对标长什么样** → `docs/LIBTV_FEATURE_INVENTORY.md`,或直接去 LibTV 看(参照画布 spaceId=2614745)
- **环境值 / 生产操作 / 发版** → 找老板,别自己动生产

> 最后一句:这套代码里**大量注释写的是「为什么」而不是「是什么」**,而且不少是事故后补的。
> 看到 🔴 或「踩过的坑」字样的注释,**先读完再改**——它们基本都对应一次真实故障。
