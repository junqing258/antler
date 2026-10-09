---
name: html-report-generator
description: |
  将结构化分析结果或 Markdown 看板生成独立的自包含 HTML 报告文件，采用移动端优先布局。适用于股票/基金/指数分析报告、研究简报、可分享仪表板等场景。触发词包括“生成 HTML 报告”“导出 HTML 文件”“把报告做成网页”“输出可打开的 HTML 页面”等。
---

# HTML Report Generator

## Antler 运行约定

- 当前工作目录为 `Stock-Analysis`，下文命令均从该目录执行。
- Skill 目录为 `.agents/skills/html-report-generator`；无需 Claude 专用环境变量。
- 读取本 Skill 的 `references/`、`scripts/` 等资源时，使用 `read_skill_resource`，传入 `skillId: "html-report-generator"` 和相对资源路径；读取工作目录内文件使用 `read`，写入使用 `write`，执行命令使用 `bash`。

这个 skill 只负责把已有分析内容整理成独立 HTML 文件，不负责拉取行情、计算指标或生成投资结论。

## 适用输入

- 已完成的股票/基金/指数分析结果
- Markdown 决策看板
- 结构化 JSON/表格/摘要，需要输出为可打开的 HTML 报告

如果用户还没有分析结果，应先使用对应分析 skill 完成内容生成，再调用本 skill。

## 工作流

```
已有分析内容
      │
      ▼
[STEP 1] 确认报告目标
      │   单页 HTML / 自包含 / 中文金融配色 / 亮暗主题自适应 / 移动端优先
      ▼
[STEP 2] 读取样式规范
      │   read_skill_resource references/html-report-style-guide.md
      ▼
[STEP 3] 组织 HTML 结构
      │   标题区 / 摘要区 / 卡片区 / 表格区 / 免责声明
      ▼
[STEP 4] 写入 .html 文件
      │   使用内联 CSS，保证本地直接打开可用
      ▼
[STEP 5] 自检移动端排版与表格滚动
```

## 生成要求

1. 输出必须是单文件 HTML，优先使用内联 `<style>`，避免依赖外部 CDN
2. 页面文案默认中文
3. 针对中文金融报告，涨跌配色必须遵循 A 股习惯：
   - 上涨/正收益/正涨幅 = 红色
   - 下跌/负收益/负涨幅 = 绿色
4. 主题必须跟随系统亮暗模式：
   - 使用 `color-scheme: light dark`
   - 默认提供浅色变量
   - 通过 `@media (prefers-color-scheme: dark)` 覆盖暗色变量
   - 不得把页面固定为暗色主题
5. 所有可能超宽的表格都要包裹：

```html
<div class="table-scroll">
  <table>...</table>
</div>
```

6. 页面以手机浏览为第一目标，避免整页横向滚动
7. 桌面端只需要让主体内容左右居中，不追求复杂宽屏布局
8. 报告文件统一生成到项目根目录的 `reports/` 子目录；若目录不存在，先创建目录
9. 若用户未指定文件名，默认生成语义化文件名，例如：
   - `reports/stock-analysis-report.html`
   - `reports/fund-dashboard.html`
   - `reports/market-brief.html`

## 内容组织建议

- 报告头部：标题、时间、分析范围、摘要
- 汇总区：关键信号、评分、涨跌分布、风险提示
- 主体区：按标的输出单列卡片或分节
- 表格区：概览表、持仓表、目标价表等
- 页脚：数据来源、分析时间、免责声明

## 何时读取参考文件

- 生成任何 HTML 报告前，读取 `references/html-report-style-guide.md`
- 如果内容包含宽表格、评分卡片、基金持仓、目标价表，严格按规范处理移动端和滚动容器
- 不要为了桌面端额外扩展复杂多列布局

## 输出检查清单

- 是否为完整 HTML 文档
- 是否本地双击即可打开
- 是否生成在 `reports/` 目录
- 是否跟随系统亮暗模式，而不是固定暗色
- 是否使用中文金融涨跌色
- 是否所有宽表都有 `.table-scroll`
- 是否移动端只保留一层横向 gutter
- 是否桌面端仅做主体居中
- 是否没有把分析逻辑、行情抓取逻辑混入本 skill