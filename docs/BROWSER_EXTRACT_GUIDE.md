# 🔧 浏览器提取商品数据 - 详细教程

## 适用场景

当「链接秒变视频」无法自动解析商品链接时（淘宝、京东、TikTok Shop 等需要登录的平台），您可以使用**浏览器提取模式**，以您自己的账号身份获取商品数据。

---

## 📖 详细步骤

### 步骤 1：打开商品页面

在您的浏览器（Chrome/Edge/Safari）中打开要提取的商品页面。

**重要**：如果需要登录才能看到完整信息，请先用您的账号登录！

![商品页面示例](https://i.imgur.com/placeholder.png)

---

### 步骤 2：打开开发者工具（控制台）

#### 方法 A：快捷键（推荐）
- **Windows/Linux**: 按 `F12` 或 `Ctrl + Shift + J`
- **Mac**: 按 `Cmd + Option + J`

#### 方法 B：右键菜单
1. 在页面空白处点击**右键**
2. 选择「**检查**」或「**Inspect**」
3. 点击顶部的「**Console**」/「**控制台**」标签

---

### 步骤 3：切换到 Console 标签

打开开发者工具后，您会看到类似这样的界面：

```
┌─────────────────────────────────────────────────────────────┐
│  Elements  │  Console  │  Sources  │  Network  │  ...      │
├─────────────────────────────────────────────────────────────┤
│  >                                                          │
│                                                             │
│  这里是控制台输入区域                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**点击「Console」或「控制台」标签** 确保您在正确的位置。

---

### 步骤 4：粘贴并执行脚本

1. 从 Tok Factory 复制提取脚本（点击「复制脚本」按钮）

2. 在控制台的输入区域（`>` 符号后面）**粘贴**脚本：
   - Windows: `Ctrl + V`
   - Mac: `Cmd + V`

3. 按 **Enter** 键执行

---

### 步骤 5：确认提取成功

执行成功后，您会看到：
- 弹出提示框：「**商品数据已复制！请返回 Tok Factory 粘贴**」
- 控制台显示提取的数据对象

---

### 步骤 6：返回 Tok Factory 粘贴数据

1. 回到 Tok Factory 的「链接秒变视频」页面
2. 点击「**粘贴数据**」按钮
3. 系统自动识别并填充商品信息

---

## 📋 提取脚本参考

以下是提取脚本的内容（系统会自动复制，您不需要手动输入）：

```javascript
(function() {
  const data = {
    title: document.title || document.querySelector('h1')?.innerText || '',
    description: document.querySelector('meta[name="description"]')?.content || '',
    price: '',
    images: []
  };
  
  // 提取价格
  const pricePatterns = [/[¥$]\s*([\d,.]+)/, /price[^>]*>([^<]*[\d,.]+[^<]*)</i];
  const bodyText = document.body.innerText;
  for (const p of pricePatterns) {
    const m = bodyText.match(p);
    if (m) { data.price = m[1]; break; }
  }
  
  // 提取图片
  const imgs = document.querySelectorAll('img[src*="http"]');
  imgs.forEach(img => {
    if (img.width > 200 && img.height > 200) {
      data.images.push(img.src);
    }
  });
  data.images = [...new Set(data.images)].slice(0, 5);
  
  // 复制到剪贴板
  const json = JSON.stringify(data, null, 2);
  navigator.clipboard.writeText('TOKFACTORY_DATA:' + json);
  alert('商品数据已复制！请返回 Tok Factory 粘贴');
  return data;
})();
```

---

## ❓ 常见问题

### Q1: 控制台显示「无法粘贴」怎么办？

**Chrome 安全限制**：首次粘贴时，Chrome 可能会阻止。

**解决方法**：
1. 在控制台输入区域先输入 `allow pasting` 然后按 Enter
2. 或者在弹出的提示中点击「允许」

---

### Q2: 脚本执行后没有弹窗？

可能是浏览器阻止了弹窗。检查浏览器地址栏右侧是否有弹窗被阻止的图标。

**解决方法**：点击允许该网站的弹窗。

---

### Q3: 提取的图片为空？

某些网站使用懒加载，图片可能还没加载完成。

**解决方法**：先在页面上下滚动，让图片加载出来，然后再执行脚本。

---

### Q4: 可以用手机操作吗？

手机浏览器通常没有方便的控制台入口。建议在电脑上操作。

---

## 🎬 视频教程

（待补充）

---

## 💡 小贴士

1. **先登录再提取**：登录您的电商账号可以获取更完整的商品信息
2. **等待页面加载**：确保页面完全加载后再执行脚本
3. **滚动查看图片**：先滚动页面让所有图片加载，提取效果更好

---

*最后更新：2025-12-06*


