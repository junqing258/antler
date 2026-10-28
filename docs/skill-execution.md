# Skill 执行机制

本文描述当前实现。规划中的 gVisor 沙箱、用户目录隔离与迁移方案见 [Skill 脚本沙箱与用户目录隔离方案](./13-skill-sandbox-design.md)，尚未实施。

给 Agent 添加平台 Skill 后，新会话会将绑定的 Skill 作为可用技能封闭集。`load_skill` 返回完整指令和统一执行约定；`read_skill_resource` 仍用于读取原始配套资源。脚本执行与依赖安装统一使用 `run_skill`，不需要将 Skill 安装到 Agent 的 `.agents/skills/`，也无需向模型公开平台源目录。

## 工具约定

`run_skill` 参数为 `skillId`、`command` 和可选的 `timeoutMs`（默认 30000，范围 1000–60000 毫秒）。`skillId` 是模型可用目录中的名称，不是数据库 UUID。只能使用当前快照包含的 Skill；关闭技能时不会注册该工具。

工具准备资源后，以 Agent 工作目录作为 shell 起始目录，注入以下环境变量：

| 变量 | 用途 |
| --- | --- |
| `ANTLER_SKILL_DIR` | 当前 Skill 的完整运行副本，包含脚本、依赖清单、模板和二进制资源 |
| `ANTLER_WORKSPACE_DIR` | Agent 当前工作目录，默认用于保存报告和其他输出 |

命令必须对变量引用加双引号。每次调用创建新 shell，`cd` 和自定义变量不会跨调用保留。Skill 原说明中的固定安装路径应替换为 `$ANTLER_SKILL_DIR`。需要使用相对资源路径的程序可以在同一次命令中先 `cd "$ANTLER_SKILL_DIR"`，同时将输出路径显式指向 `$ANTLER_WORKSPACE_DIR`。

```json
{
  "skillId": "stock-analysis",
  "command": "uv run --project \"$ANTLER_SKILL_DIR\" --extra enhanced \"$ANTLER_SKILL_DIR/references/stock_data_fetcher.py\" --stocks 600519",
  "timeoutMs": 60000
}
```

依赖安装由 Agent 根据 Skill 说明显式调用，工具不会自动安装任意依赖。所需解释器、包管理器和网络访问仍须由部署环境提供。模型可接收命令输出与错误；输出的密钥脱敏、环境变量筛选、超时、取消与 `bash` 相同。

## 运行副本和一致性

资源复制到 `<workspace>/.antler/skill-runtimes/<内容摘要>/`。摘要包含 Skill 名称与完整复制内容，因此工作空间和不同内容版本相互独立。同一版本可复用 Python 虚拟环境、Node 依赖和安装器生成或更新的锁文件；运行副本可写。`read_skill_resource` 读取的是原始资源，不反映运行副本中的修改。

平台 Skill 每次执行前检查原始指令与完整资源指纹，修改原始资源会返回 `skill_snapshot_changed`。复制过程限制为最多 200 个条目、单文件 1 MiB、总计 20 MiB；不复制环境/凭据文件以及 `.git`、`.venv`、`venv`、`node_modules`、`__pycache__`、`.pytest_cache`、`.mypy_cache`。平台归档中包含这些内容时不允许通过原始资源指纹校验，应清理归档后重新上传。原始资源的符号链接、非普通文件以及运行目录的链接重定向会被拒绝。并发首次调用通过临时目录和原子重命名准备完整副本。

副本不会回写平台缓存或数据库，安装依赖也不会让技能状态变为 `tampered`。`.antler/skill-runtimes/` 已加入 Git 忽略。停止相关运行后可以删除该目录清理依赖和运行副本，下一次执行会重建；用户报告保存在工作目录，不随缓存删除。

运行副本不是操作系统沙箱。`run_skill` 复用现有 shell 执行能力，不提供比 `bash` 更强的进程隔离，也不改变 Agent 的技能绑定或授权策略。

## 兼容和迁移

工作区、用户级和 backend 内置 Skill 在进入快照后也使用同一套执行工具。现有 `load_skill`、`read_skill_resource` 和工作区文件工具保持兼容；`skill://` 只用于资源标识，不能作为 shell 路径。

股票种子项目保留兼容入口，但已绑定的 `stock-analysis` 优先走上述执行链路。若希望删除种子 Skill 目录，先将完整股票 Skill（包括 `pyproject.toml`、锁文件和 references/scripts）以及所需报告 Skill 上传到技能库并绑定 Agent，再新建会话验证。统一执行机制本身不自动迁移或删除已有项目内容。
