# 节假日功能快速参考卡片

## 命令速查

| 命令 | 说明 | 示例 |
|------|------|------|
| `--holiday` | 查询交易日状态 | `python3 stock_data_fetcher.py --holiday` |
| `--holiday --date YYYY-MM-DD` | 查询指定日期 | `python3 stock_data_fetcher.py --holiday --date 2025-01-01` |
| `--stocks "CODE"` | 股票分析(含交易日状态) | `python3 stock_data_fetcher.py --stocks "600519"` |

## Python API 速查

```python
from stock_data_fetcher import *

# 核心函数
is_trading_day(date)          # bool - 是否交易日
get_last_trading_day(date)    # date - 最近交易日
get_next_trading_day(date)    # date - 下一交易日
get_trading_day_status(date)  # dict - 完整状态
```

## 输出字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `is_trading_day` | bool | 是否为交易日 |
| `weekday` | int | 星期(0=Mon, 6=Sun) |
| `weekday_name` | str | 星期名称 |
| `last_trading_day` | str | 最近交易日(ISO格式) |
| `next_trading_day` | str | 下一交易日(ISO格式) |
| `calendar_source` | str | 数据源状态 |

## 2025年主要节假日

| 日期 | 名称 | 交易日状态 |
|------|------|-----------|
| 2025-01-01 | 元旦 | ❌ 非交易日 |
| 2025-01-26 | 春节调休(周日) | ✅ 交易日 |
| 2025-02-10~17 | 春节假期 | ❌ 非交易日 |
| 2025-05-01 | 劳动节 | ❌ 非交易日 |
| 2025-10-01~7 | 国庆假期 | ❌ 非交易日 |

## 安装依赖

```bash
# 推荐: 官方节假日库
pip install chinese_calendar

# 定期更新
pip install --upgrade chinese_calendar
```

## 降级机制

```
chinese_calendar (精确)
    ↓ 未安装时降级
简单工作日判断 (周一至周五)
```

## 常见用法

### 判断是否执行策略

```python
if is_trading_day():
    execute_strategy()
```

### 获取最近交易日数据

```python
last = get_last_trading_day()
data = fetch_data(code, last)
```

### 查询节假日状态

```python
# 元旦
status = get_trading_day_status(date(2025, 1, 1))
print(status["is_trading_day"])  # False
```

---

完整文档: [references/holiday-calendar-usage.md](references/holiday-calendar-usage.md)