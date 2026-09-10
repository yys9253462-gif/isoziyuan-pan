# DESIGN.md — 爱搜品牌「极客磨砂 Aurora Glass」设计系统

> 适用项目：isoziyuan.com（博客） · ailxw.com（服务导航站） · pan.ailxw.com（爱搜云盘）
> 参考基因：Linear.app 的锐利克制 × Vercel 的暗色氛围 × Stripe 的渐变活力
> 版本：v1.0 · 2026-09-11

---

## 1. Visual Theme & Atmosphere（视觉主题与氛围）

深色极客工作台美学：深夜蓝黑基底上悬浮磨砂玻璃面板，极光靛蓝-紫-天蓝三色渐变作为唯一能量色贯穿所有关键交互。

- **关键词**：磨砂玻璃（Glassmorphism）· 极光渐变（Aurora Gradient）· 锐利克制 · 发光聚焦 · 深空沉浸
- **光影倾向**：大面积柔和径向光晕（fixed 不随滚动）+ 面板内嵌顶部高光 `inset 0 1px 0 rgba(255,255,255,.06)`
- **标志性记忆点**：面板/卡片顶部的 2.5px「能量条」渐变 + 聚焦时的外发光光晕

## 2. Color Palette & Roles（调色板与角色）

| 角色 | 值 | CSS 变量 | 场景 |
|---|---|---|---|
| 基底 | `#070a12` / `#080b12` | `--bg-primary` | body 基色 |
| 玻璃表面 | `rgba(17,24,39,.62~.78)` | `--bg-surface` / `--panel` | 卡片、面板 |
| 侧栏/导航 | `rgba(11,16,28,.82)` | `--bg-sidebar` | 固定侧栏 |
| 主文本 | `#f1f5f9` | `--text-main` | 标题/正文 |
| 次文本 | `#94a3b8` | `--text-muted` | 描述 |
| 弱文本 | `#64748b` | `--text-sub` | 提示/占位 |
| 强调主色 | `#6366f1` | `--accent` | 链接、激活态 |
| 强调辅色 | `#8b5cf6` | `--accent-2` | 渐变末端 |
| 点缀色 | `#38bdf8` | `--accent-3` | 箭头/悬浮箭标 |
| 成功 | `#34d399` | `--green` | 成功吐司 |
| 危险 | `#e11d48 → #be123c` | `--danger` | 删除按钮 |
| 边框 | `rgba(255,255,255,.08)` | `--border-color` | 全部 1px 边框 |
| 能量渐变 | `linear-gradient(90deg,#6366f1,#8b5cf6 55%,#38bdf8)` | `--energy-gradient` | 顶部能量条/进度 |
| 按钮渐变 | `linear-gradient(135deg,#6366f1,#8b5cf6)` | `--accent-gradient` | 主按钮/Logo |

**光晕**：`--accent-glow: rgba(99,102,241,.28)`，用于 focus ring（`0 0 0 4px`）与 hover 外发光。

## 3. Typography Rules（排版规则）

字体栈：`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif`

| 层级 | Size | Weight | Line Height | Letter Spacing |
|---|---|---|---|---|
| Page Title | 28–30px | 800 | 1.15 | -0.03em |
| Section Title | 20px | 750 | 1.3 | -0.015em |
| Card Title | 15–17px | 700 | 1.4 | -0.01em |
| Body | 14px | 400–550 | 1.6–1.7 | 0 |
| Caption/Tag | 11–12px | 650 | 1.4 | 0–0.04em |
| Eyebrow | 11–12px | 750–800 | 1.2 | 0.12–0.16em（大写） |

## 4. Component Stylings（组件样式）

```css
/* 主按钮 */
.button-primary {
  background: linear-gradient(135deg,#6366f1,#8b5cf6);
  border: 1px solid rgba(129,140,248,.35);
  border-radius: 12px; padding: 11px 16px; color: #fff; font-weight: 750;
  box-shadow: 0 6px 18px rgba(99,102,241,.35), inset 0 1px 0 rgba(255,255,255,.18);
  transition: all .18s ease;
}
.button-primary:hover { transform: translateY(-1.5px); box-shadow: 0 10px 26px rgba(99,102,241,.5); filter: brightness(1.06); }

/* 次级按钮 */
.button-secondary {
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
  color: #dbe3f0; border-radius: 12px; backdrop-filter: blur(10px);
}

/* 玻璃卡片 */
.card-glass {
  position: relative; overflow: hidden;
  background: linear-gradient(155deg, rgba(23,32,54,.78), rgba(12,17,31,.92));
  border: 1px solid rgba(255,255,255,.09); border-radius: 16px;
  box-shadow: 0 8px 24px -6px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.05);
  backdrop-filter: blur(16px);
}
.card-glass::before { /* 能量条 */
  content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2.5px;
  background: linear-gradient(90deg,#6366f1,#8b5cf6 55%,#38bdf8); opacity: 0;
  transition: opacity .22s ease;
}
.card-glass:hover::before { opacity: 1; }
.card-glass:hover { transform: translateY(-4px); border-color: rgba(129,140,248,.4); box-shadow: 0 16px 36px -8px rgba(0,0,0,.45), 0 0 28px rgba(99,102,241,.28); }

/* 输入框聚焦 */
.input:focus { border-color: rgba(99,102,241,.55); box-shadow: 0 0 0 4px rgba(99,102,241,.28), 0 0 24px rgba(99,102,241,.28); }

/* 药丸标签 */
.tag { font-size: 11px; padding: 2.5px 8px; border-radius: 999px;
  background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.055); color: #64748b; }
```

## 5. Layout Principles（布局原则）

- **间距基数**：4px，常用步进 8/12/16/20/24/32/48
- **容器**：导航站 `max-width: 1440px`，主区 `padding: 32px 48px`（桌面）/ `20px 16px`（移动）
- **卡片网格**：`repeat(auto-fill, minmax(280px, 1fr))`，gap 18px；移动端单列 gap 14–16px
- **留白哲学**：卡片内 18px 统一内边距；区块间距 48px；搜索栏与内容间 40px

## 6. Depth & Elevation（深度与层级）

```css
--shadow-xs: 0 1px 2px rgba(0,0,0,.3);
--shadow-md: 0 8px 24px -6px rgba(0,0,0,.4);
--shadow-xl: 0 24px 60px -12px rgba(0,0,0,.55);
```

- 表面层级：`bg-primary → glass surface → elevated(.92) → modal(.97 + blur 28px)`
- Z-index：sidebar 50 / sticky header 40 / bottom-nav 80 / modal 100
- 毛玻璃参数：卡片 `blur(16px)`，面板 `blur(20~24px)`，弹窗遮罩 `blur(8px)` + `rgba(4,8,18,.66)`

## 7. Do's and Don'ts（规范与禁忌）

**Do's**
1. 关键交互只用一个渐变体系（靛蓝→紫→天蓝），全局不超过一个强调色族
2. 所有面板加 `inset 0 1px 0 rgba(255,255,255,.05)` 顶部内高光
3. 聚焦态必须有光晕（4px spread ring + 外发光）
4. hover 位移克制在 `-2px ~ -4px`
5. 移动端触控目标 ≥ 44×44px，底部悬浮元素避让 `env(safe-area-inset-bottom)`
6. 背景光晕用 `background-attachment: fixed`

**Don'ts**
1. ❌ 禁止在浅色 UI 上直接套用暗色玻璃（light 主题必须独立 token）
2. ❌ 禁止多种渐变色族混用（如粉色/橙色渐变）
3. ❌ 禁止大范围高饱和底色，强调色占比 ≤ 10%
4. ❌ 禁止无过渡的 hover 状态生硬切换
5. ❌ 禁止在磨砂卡片上再叠加磨砂卡片超过两层（模糊叠糊）

## 8. Responsive Behavior（响应式行为）

| 断点 | 布局 |
|---|---|
| ≥ 900px | 侧栏 260px 固定 + 网格自适应 |
| < 900px | 侧栏抽屉化（`translateX(-100%)`），单列卡片，底部 Tab 导航（首页/分类/搜索/联系） |
| < 500px | 面板内边距收紧至 20px，取件码格 54px 高 |

- 触控目标 ≥ 44px；移动端 sticky 头部 `top: 10px`
- 动效尊重 `prefers-reduced-motion: reduce`

## 9. Agent Prompt Guide（AI 代理提示指南）

**Quick Reference**：暗色基底 `#070a12` + 玻璃表面 `rgba(17,24,39,.7)` + 靛蓝强调 `#6366f1`，能量渐变 `90deg #6366f1→#8b5cf6 55%→#38bdf8`，卡片 16px 圆角 + 顶部 2.5px 渐变能量条 + hover 上浮 4px 发光。

**Component Prompts**：
1. "生成一张极客磨砂风格工具卡片：深色玻璃背景、顶部三色渐变能量条、左侧渐变 Logo 方块、药丸标签、hover 上浮发光"
2. "生成一个居中式取件码输入面板：5 格大号输入框，聚焦时靛蓝光晕，底部渐变主按钮"
3. "生成一个磨砂玻璃侧边导航栏：渐变 Logo、当前项靛蓝渐变高亮、悬停右移 2px"
4. "生成一个居中弹窗：深色毛玻璃卡片 22px 圆角、上升入场动画、行式联系信息列表"
5. "生成一个数据统计卡：玻璃面板 + 顶部能量条 + hover 上浮，数值 800 字重白色"

**Iteration Guide**：
1. 强调色永远从 token 取，不要引入新色相
2. 阴影统一三级体系，不自定义任意阴影
3. 圆角体系：输入 10–12px / 卡片 16–18px / 弹窗 20–22px / 药丸 999px
4. 所有动画 150–250ms，缓动 `cubic-bezier(0.16,1,0.3,1)` 入场
5. 深浅双主题必须同时验收
6. 移动端优先验证 390px 视口
7. 渐变只用于能量条、主按钮、Logo 三处，克制使用
8. 聚焦可见性（focus ring）不可省略
