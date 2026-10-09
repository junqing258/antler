# 使用示例

## 1. 节假日查询示例

### 查询今日是否为交易日

```bash
python3 references/stock_data_fetcher.py --holiday
```

输出:
```json
{
  "check_date": "2026-06-09",
  "is_trading_day": true,
  "weekday": 1,
  "weekday_name": "Tuesday",
  "last_trading_day": "2026-06-08",
  "next_trading_day": "2026-06-11",
  "calendar_source": "available",
  "check_time": "2026-06-09T14:52:35.811081"
}
```

### 查询特定日期

```bash
# 元旦
python3 references/stock_data_fetcher.py --holiday --date 2025-01-01

# 劳动节
python3 references/stock_data_fetcher.py --holiday --date 2025-05-01

# 国庆节
python3 references/stock_data_fetcher.py --holiday --date 2025-10-01
```

## 2. 股票分析示例（自动包含交易日状态）

### 分析 A 股

```bash
python3 references/stock_data_fetcher.py --stocks "600519" --days 10
```

输出包含:
```json
{
  "analysis_date": "2026-06-09",
  "trading_day_status": {
    "date": "2026-06-09",
    "is_trading_day": true,
    ...
  },
  "stocks": [
    {
      "code": "600519",
      "name": "贵州茅台",
      ...
    }
  ]
}
```

### 分析美股

```bash
python3 references/stock_data_fetcher.py --stocks "TSLA,AAPL,MSFT" --news
```

### 分析指数

```bash
python3 references/stock_data_fetcher.py --stocks "sh000001,创业板指,沪深300"
```

### 分析基金

```bash
python3 references/stock_data_fetcher.py --stocks "fund:018358,华富数字经济混合A"
```

## 3. Python API 调用示例

```python
from datetime import date
from stock_data_fetcher import (
    is_trading_day,
    get_last_trading_day,
    get_next_trading_day,
    get_trading_day_status
)

# 判断今天是否为交易日
if is_trading_day():
    print("今天是交易日，可以执行交易策略")
else:
    print("今天不是交易日")

# 获取最近交易日
last = get_last_trading_day()
print(f"最近交易日: {last}")

# 获取下一交易日
next_trade = get_next_trading_day()
print(f"下一交易日: {next_trade}")

# 查询特定日期状态
status = get_trading_day_status(date(2025, 1, 1))
print(f"2025-01-01 状态: {status}")
```

## 4. 在交易策略中使用

```python
from stock_data_fetcher import is_trading_day, get_last_trading_day

def execute_daily_strategy():
    """每日策略执行入口"""

    # 只在交易日执行
    if not is_trading_day():
        print("非交易日，跳过策略执行")
        return

    # 获取最近交易日数据
    last_trade = get_last_trading_day()
    data = fetch_historical_data(last_trade)

    # 执行策略逻辑
    signals = analyze_signals(data)
    execute_trades(signals)

def get_trading_data(code, days=120):
    """获取交易日数据（自动跳过非交易日）"""

    if not is_trading_day():
        # 非交易日使用最近交易日数据
        last = get_last_trading_day()
        print(f"使用 {last} 的数据")
        return fetch_data(code, last, days)
    else:
        return fetch_data(code, date.today(), days)
```

## 5. 完整测试

```bash
# 运行完整测试套件
python3 test_holiday.py
```

输出示例:
```
============================================================
Holiday Calendar Test Suite
============================================================

1. Library Status:
   chinese_calendar: ✅ available

2. Major Holidays 2025:
   2025-01-01 (元旦): ❌ 非交易日 ✅
   2025-02-10 (春节前周一): ✅ 交易日 ✅
   ...

✅ All tests completed successfully!
```

## 6. Antler 中使用

在 Antler 中直接输入自然语言:

```
分析下 TSLA
600519 怎么样?
看看今天的交易日状态
2025年元旦是交易日吗?
```

Antler 会自动:
1. 调用 Stock Analysis Skill
2. 获取数据并判断交易日状态
3. 输出包含交易日信息的决策看板

---

更多详细信息:
- [完整使用文档](references/holiday-calendar-usage.md)
- [实现总结](IMPLEMENTATION_SUMMARY.md)