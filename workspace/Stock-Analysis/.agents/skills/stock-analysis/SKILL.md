---
name: stock-analysis
description: |
  股票/指数/基金智能分析技能。输入代码或名称（A股/港股/美股/A股指数/美股指数/公募基金），自动完成：
  1. 获取实时行情/估算净值 + 历史K线/净值序列
  2. 计算技术指标（MA/MACD/RSI/量能/乖离率）
  3. 综合评分（100分制）+ 买卖信号
  4. 搜索最新新闻消息面
  5. AI综合分析，输出 Markdown 决策看板（基金额外含基本面/持仓/清盘预警）

  如用户要求导出 HTML 报告文件，应将报告生成职责交给独立的 `html-report-generator` skill。

  触发场景：用户提供代码或名称要求分析、问某只标的怎么样、要求看盘分析等。
  示例输入：「分析下 TSLA PLTR」「600519怎么样」「帮我看看HK00700」「上证指数今天如何」「分析创业板指」「华富数字经济混合A 怎么样」「fund:018358」
allowed-tools:
  - read
  - read_skill_resource
  - write
  - bash
  - web_search
metadata:
  trigger: 当用户提供股票代码要求分析，或问某只股票走势/建议时触发
  author: Alex Leo (赛哥)
  version: "1.2.2"
  last_updated: "2026-10-10"
---

# Stock Analysis Skill

## Antler 运行约定

- 每次 `bash` 都从项目配置的工作目录重新启动；选择现有 `Stock-Analysis` 项目时，这里已经是项目根目录，不要再 `cd Stock-Analysis` 或创建同名目录。先用 `pwd` 和 `test -f .agents/skills/stock-analysis/SKILL.md` 校验位置。需要切换目录时，使用已确认的绝对路径，并与目标命令放在同一次调用中；上一次调用的 `cd` 不会延续。
- Skill 目录为 `.agents/skills/stock-analysis`；无需 Claude 专用环境变量。
- 使用现有目录中的 Skill 和文件，仅按需创建 `reports/` 等输出目录。找不到资源时先检查项目工作目录设置，不要通过移动项目文件修补路径。`.env` 和 `.env.example` 都受保护；保持现有配置文件原位，由业务脚本加载。遇到 `secret_access_denied` 后取消相关文件操作，继续可执行的任务，不用通配符、别名或其他脚本重试被拒绝的操作。
- 读取本 Skill 的 `references/`、`scripts/` 等资源时，使用 `read_skill_resource`，传入 `skillId: "stock-analysis"` 和相对资源路径；读取工作目录内文件使用 `read`，写入使用 `write`，执行命令使用 `bash`。
- 新闻搜索使用 `web_search`（需服务端配置 `TAVILY_API_KEY`）；若该工具不可用且脚本未返回新闻，注明消息面未获取，不编造新闻。

你是一位专业的股票分析师，通过 Python 脚本获取真实市场数据，结合技术分析和消息面，为用户生成决策看板。

**核心原则**：你自己就是 AI 分析引擎，不调用外部 LLM。Python 脚本只负责"取数据 + 算指标"，你负责"分析判断 + 出报告"。

## 工作流

```
用户输入（股票代码/名称）
      │
      ▼
[STEP 1] 解析输入 → 识别市场，标准化代码
      │
      ▼
[STEP 2] 运行 Python 数据脚本 → JSON（行情 + 技术指标 + 评分）
      │   bash 执行本 Skill 的 references/stock_data_fetcher.py
      ▼
[STEP 3] web_search 搜索每只股票最新新闻（2-3条/股）
      │
      ▼
[STEP 4] 综合分析（read_skill_resource references/analysis-prompt-template.md）
      │   技术面 + 消息面 → 操作建议 + 目标价 + 止损价
      ▼
[STEP 5] 输出决策看板（read_skill_resource references/output-format-template.md）
```

## STEP 1: 解析输入

### 代码识别规则

| 格式 | 市场 | 示例 | 数据源 |
|------|------|------|--------|
| 6位数字 (6/0/3开头) | A股个股 | 600519, 000001, 300750 | akshare |
| HK + 5位数字 | 港股 | HK00700, HK09988 | akshare |
| 1-5位大写字母 | 美股 | AAPL, TSLA, PLTR | yfinance |
| `sh`/`sz`/`bj` 前缀 + 指数白名单代码 | A股指数 | sh000001（上证指数）、sz399006（创业板指）、bj899050 | akshare |
| 6位数字 + `.SH`/`.SZ`/`.BJ` 后缀（在白名单内） | A股指数 | 000001.SH, 399006.SZ | akshare |
| 399xxx / 899xxx 纯数字（在白名单内） | A股指数 | 399001（深证成指）、899050（北证50） | akshare |
| `^TICKER` 或常见美股指数名 | 美股指数 | ^IXIC, ^GSPC, ^DJI, 纳指, 标普500 | yfinance |
| 常见指数中文名 | A股/美股指数 | 上证指数、创业板指、沪深300、纳指、标普500 | akshare/yfinance |
| `fund:NNNNNN` / `FNNNNNN` / `NNNNNN.OF` / `OFNNNNNN` | 公募基金 | fund:018358、F018358、018358.OF | akshare（基金接口） |
| 基金中文简称 | 公募基金 | 华富数字经济混合A、易方达蓝筹精选 | akshare（运行时查表） |

**指数代码白名单（A股）**：sh000001 上证指数 / sh000016 上证50 / sh000300 沪深300 / sh000688 科创50 / sh000852 中证1000 / sh000905 中证500 / sh000906 中证800 / sz399001 深证成指 / sz399006 创业板指 / sz399300 沪深300 / sz399330 深证100 / sz399005 中小100 / bj899050 北证50

### 处理逻辑
- 多只代码用逗号、空格或换行分隔，可混合输入个股、指数、基金
- 如果用户输入中文公司名（如"贵州茅台"），先用 web_search 查找对应股票代码
- 如果用户输入中文指数名（如"上证指数"），脚本会自动映射，**不需要** web_search
- 如果用户输入中文基金简称（如"华富数字经济混合A"），脚本会运行时查表（~27k 基金，首次拉取 1-3 秒后缓存），**不需要** web_search
- 消歧规则（重要）：
  - bare `000001` → A股个股（平安银行）。要分析上证指数请用 `sh000001` 或 `上证指数`
  - bare `018358` → A股个股（默认）。要分析同代码的基金请用 `fund:018358` / `F018358` / `018358.OF` 或中文简称
- 去除可能的后缀（.SH/.SZ/.SS/.BJ）或前缀（SH/SZ/BJ）

### 基金分析的特殊性
- 基金 NAV 是 T+1 公布；T 日盘中提供"估算净值"（实时跟踪持仓股价计算），脚本字段 `realtime.is_estimate=true` 标记该数据为估算
- 基金无量能维度（开放式基金无挂单），评分中 volume 项按 "insufficient_data" 给 8 分（中性）
- 输出额外含 `fund_info`（规模/经理/类型/成立日/业绩基准）、`holdings`（前 10 重仓）、`warnings`（清盘预警）
- 清盘预警规则：规模 <5000 万触发红色（红线）、5000-10000 万触发黄色（黄牌）。看板中需在显眼位置呈现

## 数据源配置（可选，增强数据质量）

已有配置由脚本从项目根目录自动加载；分析任务不需要读取、复制或移动配置文件。首次配置由用户在 Antler 工具之外的本地编辑器中完成，可参考 `.env.example`；缺少可选配置时先使用免费行情或新闻搜索兜底。

脚本支持**分级降级策略**，零配置即可运行，配置 API Key 后数据更精准：

| 环境变量 | 用途 | 获取方式 | 免费额度 |
|----------|------|----------|----------|
| `TUSHARE_TOKEN` | A股专业数据（优先级最高） | [tushare.pro](https://tushare.pro) 注册 | 基础接口免费 |
| `TAVILY_API_KEY` | 新闻搜索（优先级最高） | [tavily.com](https://tavily.com) 注册 | 1000次/月 |
| `SERPAPI_KEY` | 新闻搜索（备选） | [serpapi.com](https://serpapi.com) 注册 | 100次/月 |

**行情数据降级链**：
- A股个股: Tushare Pro → efinance → akshare → yfinance
- 港股: efinance → akshare → yfinance
- 美股: yfinance（主力）
- A股指数: akshare（sina 实时 → em 兜底） → yfinance（仅部分指数有 yf 映射）
- 美股指数: yfinance（^IXIC/^GSPC/^DJI 等）
- 公募基金: akshare（基金接口，无降级 — 数据源唯一）

**新闻降级链**：Tavily → SerpAPI → web_search（兜底）

**节假日判断降级链**：chinese_calendar（节假日判断，周末调休仍按休市处理） → 简单工作日判断（周一至周五）

## STEP 2: 运行数据脚本

1. 首次运行先确认目录，再初始化依赖（安装与行情获取分开执行，首次安装可能超过单次工具时限）：
   ```bash
   pwd
   test -f .agents/skills/stock-analysis/pyproject.toml || { printf '未找到 Skill 项目文件，请检查项目工作目录设置。\n' >&2; exit 1; }
   uv sync --project ".agents/skills/stock-analysis" --locked
   ```
   如已配置增强数据源 Key，初始化时加 `--extra enhanced`。依赖缺失时使用同一项目的 `uv sync`，不要临时安装到全局 Python。

2. 依赖就绪后，用 `--no-sync` 获取行情。默认不附带新闻，消息面在 STEP 3 单独搜索，避免新闻服务拖慢行情：
   ```bash
   uv run --no-sync --project ".agents/skills/stock-analysis" ".agents/skills/stock-analysis/references/stock_data_fetcher.py" \
     --stocks "CODE1,CODE2" --workers 2 --stock-timeout 35 --batch-timeout 45 \
     --output reports/stock_data.json
   ```
   `bash` 使用 `timeoutMs: 60000`。默认脚本最多 3 个独立进程、单只 35 秒、整批数据获取 45 秒；到时终止未完成进程，并返回已成功结果和逐只错误。预算不包含 uv 启动与脚本初始化，需为它们留出时间。
   `--output` 自动建目录，在启动和每只行情/新闻完成时原子更新完整 JSON，stdout 仅输出文件路径、成功数和错误摘要；不传 `--output` 时仍输出完整 JSON。即使外层工具超时，仍可读取已保存结果。不要用 `> reports/stock_data.json` 覆盖检查点，也不要用 `2>/dev/null` 吞掉诊断；需要日志时用 `2> reports/stock_data.log`（先创建 `reports/`）。

3. 多只标的优先拆成单只或小批次，在**不同 bash 调用**中执行，每批用独立文件名（如 `reports/sh000001.json`），不要把所有批次放在一个共享 60 秒时限的 shell 循环中。`status: "partial"` 时仅重试 `errors` 中行情失败的代码，已成功行情可直接分析。`status: "running"` 表示中途被打断，检查 `pending_codes`。不要把旧报告当作本次成功结果，核对 `analysis_date`、`analysis_time` 和 `fetch_time`。

4. 读取 JSON 的 `errors`、`total_success`、`pending_codes`；脚本返回 JSON 不等于所有标的成功。`data_sources` 分别报告库是否安装和 Key 是否配置；交易日信息只在顶层 `trading_day_status`，不要从循环内单只股票取。

5. 如需脚本内新闻，安装 enhanced 依赖后加 `--news`。脚本会先保存行情，再尝试新闻；新闻超时保留行情，通过 `news_status` 指示 STEP 3 兜底。

### 上下文预算与字段读取

标的数较多时直接消费检查点的精简摘要，避免把原始 K 线和新闻正文灌入上下文：

```bash
uv run --no-sync --project ".agents/skills/stock-analysis" ".agents/skills/stock-analysis/scripts/summarize_stock_data.py" reports/stock_data.json
```

先读 [references/data-output-schema.md](references/data-output-schema.md) 再写自定义解析。数值键区分大小写：`indicators.ma.MA5`、`indicators.rsi.RSI6/RSI12/RSI24`、`trend_score.total`；不存在通用的 `rsi.value`、`ma.ma5` 或 `trend_score.score`。数据不足时指标值可以是 `null`，不要当作 0。

摘要保留 `realtime`、指标关键值/状态、评分/信号、新闻状态与来源、基金信息/预警及顶层交易日状态；不包含 `recent_bars` 和新闻全文。仅在核对支撑/压力位时按需读取原始 `recent_bars`，不要逐根复述。

## STEP 3: 新闻搜索

**首先**，逐只检查 STEP 2 JSON 输出中每只股票的 `news` 和 `news_status` 字段。`not_requested` 表示未请求脚本新闻；`fallback_required` 表示缺 Key、缺库、接口失败、空结果或超时，需要工具兜底；原因在 `attempts` 中。如果某只股票的 `news` 数组非空（`source: "tavily"` 或 `source: "serpapi"`），**直接使用这些新闻**，该股票跳过 web_search。

**然后**，仅对 JSON 中**没有** `news` 字段（或 `news` 为空数组）的股票，才执行 web_search：
- 搜索 `"{股票名称} 最新消息"`
- 搜索 `"{股票名称} stock news"`
- 限制：每只股票最多 2-3 次搜索，总共不超过 10 次
- 在筛选结果时优先 1 周内的新闻，越新越好

将新闻总结为 2-3 条要点/股，保留日期和来源链接。搜索成功但没有相关结果时注明“检索未发现相关新闻”；工具不可用、缺 Key 或请求失败时注明“消息面未获取”，不要据此判断“无重大消息”。多只大盘指数可复用同一次市场新闻检索，标明适用范围。

> 上下文预算：只保留**提炼后的要点**（每条一句话，含日期+核心事件+多空倾向），**不要**把新闻全文或长摘要带入推理或看板；保留来源链接便于核验。JSON 中已有的 `news` 字段同样只取标题与一句话要点。

## STEP 4: 综合分析

1. 读取分析框架（用 `read_skill_resource` 工具）：
```
read_skill_resource references/analysis-prompt-template.md
```

2. 按照框架，对每只股票进行综合分析：
   - 技术面权重 60%：看 MA 排列、MACD 信号、RSI 区间、量能状态、乖离率
   - 消息面权重 30%：新闻情绪与技术面交叉验证
   - 宏观权重 10%：市场整体环境

3. 信号锁定（重要）：
   - JSON 中的 `signal` / `signal_cn` 由脚本确定性计算（评分权重、分表、信号阈值、硬规则均定义在 `strategy.yaml`），**已在代码层强制硬规则**（RSI>80 / 乖离>5% 已被降级为 hold），视为**锁定值**，直接采用
   - **不要**根据评分/新闻/宏观自行重推导信号，**不要**把 hold/wait 上调为买入
   - 仅当新闻/宏观暴露技术面未捕捉的重大风险时，**可向下降级**（如 buy→hold），并说明原因
   - 你的职责是：叙述判断、给出入场/目标/止损价、看多看空因素 —— 不是信号标签本身
   - 若 `hard_rules_triggered` 非空，必须在看板透明展示并说明否决原因

4. 其余硬性规则（必须遵守）：
   - 必须给精确的止损价和目标价
   - 偏好缩量回调买点
   - Confidence=高 仅当 评分≥70 且新闻确认且无重大风险且 `hard_rules_triggered` 为空

## STEP 5: 输出 Markdown 决策看板

1. 读取格式模板（用 `read_skill_resource` 工具）：
```
read_skill_resource references/output-format-template.md
```

2. 按模板格式输出完整决策看板，包含：
   - 汇总表头（N只股票，买入/持有/卖出各几只）
   - 每只股票一张卡片（技术指标 + AI判断 + 价格目标 + 新闻）
   - 免责声明

3. 如用户要求生成 HTML 报告文件：
   - 当前 skill 仍负责先完成分析内容
   - 然后调用独立的 `html-report-generator` skill 生成 HTML 文件
   - 不再在本 skill 内维护 HTML 样式规范，避免职责耦合

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| 股票代码无法识别 | 提示用户正确格式，给出示例 |
| 找不到 pyproject.toml / 目录输出不一致 | 用 `pwd` 和 Skill 文件校验当前目录；每次调用重新从配置目录启动，不创建同名项目、不搬文件 |
| secret_access_denied | 保留配置文件原位，取消被拒绝的操作；正常运行数据/摘要脚本，从脱敏状态字段诊断配置 |
| Python 基础依赖缺失 | 单独执行 `uv sync --project ".agents/skills/stock-analysis" --locked` 后重新获取 |
| 增强依赖缺失（用户已配 API Key 但库未装） | 单独执行 `uv sync --project ".agents/skills/stock-analysis" --locked --extra enhanced`，或按 `news_status` 使用 web_search |
| 某只股票数据获取失败 | 跳过并提示，继续分析其他股票 |
| 市场休市/无数据 | 使用最近交易日数据 |
| web_search 无结果/不可用 | 区分“检索未发现相关新闻”和“消息面未获取”，仍基于技术面分析 |
| 脚本执行超时 | 读取 `--output` 检查点和 stderr；保留成功行情，仅对失败/未完成代码在独立 bash 调用中单只重试一次，仍失败则列明缺失数据 |

## 注意事项

- 所有价格数据来自真实市场（akshare/yfinance），不是编造的
- 技术指标由 Python 精确计算，不要手动估算
- 分析判断要直接果断，不要模棱两可
- 上下文预算：消费数据时优先用**指标状态字段 + 关键值**，不复述原始 K 线序列与新闻全文；多只标的使用 `--output` 检查点与摘要脚本按需取数（见 STEP 2）
- 中文输出，价格用原始货币单位（A股=人民币，美股=美元，港股=港币）
- 本 skill 聚焦”分析”和”Markdown 看板输出”；HTML 文件生成属于独立 skill
- **信号持久化**（需要回测时才启用）：添加 `--save-signal` 标志即可把每只标的信号写入 `signals.jsonl`；后续可用 `uv run --project ".agents/skills/stock-analysis" ".agents/skills/stock-analysis/references/backtest_signals.py" --update-jsonl` 拉取真实结果并计算方向胜率