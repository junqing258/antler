# Pi Agent Core & Pi AI 1.1.0 升级方案

## 版本信息

- **升级前版本**: ^0.84.3（锁文件解析为 0.84.3）
- **目标版本**: ^1.1.0
- **升级日期**: 2026-10-10
- **影响范围**: backend 包
- **状态**: 代码升级已实施；本机检查与 Anthropic/Tavily 真实验证通过，OpenAI 真实联调待配置密钥
- **实施后实际版本**: pi-agent-core / pi-ai 1.1.0，TypeBox 1.3.27
- **执行目录**: 所有命令均从仓库根目录执行

## 依赖包变更

### 升级的包

| 包 | 当前声明 | 目标声明 |
|----|----------|----------|
| `@earendil-works/pi-agent-core` | `^0.84.3` | `^1.1.0` |
| `@earendil-works/pi-ai` | `^0.84.3` | `^1.1.0` |
| `typebox` | `^1.0.61`（实际 1.3.7） | `^1.3.27`（实际 1.3.27） |
| `yaml` | Pi harness 的间接依赖 | 直接依赖 `2.9.0` |
| `ignore` | Pi harness 的间接依赖 | 直接依赖 `7.0.5` |

升级前锁文件实际解析为 0.84.3，本次升级后的锁文件解析为 1.1.0。升级提交必须包含 `backend/package.json` 和根目录 `pnpm-lock.yaml`；首次迁移以锁文件解析到 1.1.0 为验收基线。如果将来 `^1.1.0` 解析到更新版本，需要重新核对其变更后再验证。

## 受影响文件清单

### 核心文件

| 文件路径 | 使用的 API | 风险等级 |
|---------|-----------|---------|
| `backend/src/agent/pi-agent-adapter.ts` | Agent, AgentEvent, AgentMessage, anthropicProvider, openaiProvider, Model | 高 |
| `backend/src/agent/workspace-tools.ts` | AgentTool | 中 |
| `backend/src/agent/tavily-search-tool.ts` | AgentTool | 中 |
| `backend/src/skills/skill-tools.ts` | AgentTool、已删除的 formatSkillInvocation | 高 |
| `backend/src/skills/types.ts` | 已删除的 Skill | 高 |
| `backend/src/agent/host-runtime.ts` | AgentEvent | 低 |
| `backend/src/agent/host-runtime.test.ts` | AgentEvent | 低 |
| `backend/src/skills/skill-registry.ts` | 已删除的 loadSourcedSkills、ExecutionEnv、FileInfo、FileError、ok、err | 高 |
| `backend/src/skills/skill-registry.test.ts` | 技能加载、诊断、优先级和工具安全回归 | 高 |
| `backend/src/skills/skill-loader.ts` | 本地 YAML 元数据解析与调用格式化 | 高 |
| `backend/src/agent/pi-agent-adapter.test.ts` | 真实 Agent 与模拟 provider 流的兼容性回归 | 高 |

### API 使用情况分析

#### 从 `@earendil-works/pi-agent-core` 导入

- **Agent 类**: 构造函数接收 initialState 和 streamFn
  - `initialState.model`: Model 类型
  - `initialState.systemPrompt`: string
  - `initialState.thinkingLevel`: "low"
  - `initialState.messages`: AgentMessage[]
  - `initialState.tools`: AgentTool[]
  - `streamFn`: (model, context, options) => Stream
- **Agent 实例方法**:
  - `agent.subscribe(callback)`: 订阅事件
  - `agent.prompt(input)`: 发送用户输入
  - `agent.abort()`: 中止运行
  - `agent.state.errorMessage`: 错误信息
  - `agent.state.messages`: 消息历史
- **AgentEvent**: 事件类型定义
- **AgentMessage**: 消息类型定义
- **AgentTool**: 工具接口定义
- **当前 skills 模块依赖的导出**: `Skill`、`loadSourcedSkills`、`formatSkillInvocation`、`ExecutionEnv`、`FileInfo`、`FileError`、`ok`、`err`。这些导出在 1.0.0 已删除，必须按 Step 5.1 替换；不能直接沿用到 1.1.0。

#### 从 `@earendil-works/pi-ai` 导入

- **anthropicProvider()**: 返回 Anthropic provider 实例
  - `provider.getModels()`: 获取模型列表
  - `provider.streamSimple(model, context, options)`: 流式调用
    - options.headers: 请求头
    - options.signal: AbortSignal
    - options.timeoutMs: 超时时间
- **openaiProvider()**: 返回 OpenAI provider 实例
  - `provider.getModels()`: 获取模型列表
  - `provider.streamSimple(model, context, options)`: 流式调用
    - options.apiKey: API 密钥
    - options.signal: AbortSignal
    - options.timeoutMs: 超时时间
- **Model<T>**: 模型类型,带泛型参数
  - Model<"anthropic-messages">
  - Model<"openai-responses">
  - 字段: id, name, baseUrl (可选)

## 升级步骤

### Step 1: 准备工作

先保存并提交当前工作，确认 `git status --short` 为空，再创建升级分支并检查当前版本。如果同名标签或分支已存在，先核对其指向，不覆盖它们。

```bash
cd /Users/zhangjunqing/git-hy/antler
git status --short
git switch -c upgrade/pi-packages-1.1.0
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

基线检查失败时先记录、修复并单独提交已有问题，然后重新执行上述安装、类型检查和测试。检查完成后若仍有需要提交的变更，先提交，再对该提交重新执行检查；只有三项检查均通过且工作区干净，才创建基线标签并开展升级：

```bash
git status --short
git tag antler-pre-pi-1.1.0
git rev-parse antler-pre-pi-1.1.0
```

记录该 SHA 作为通过检查的升级前提交。标签包含必要的基线修复，不依赖 `main` 后续是否发生变化；后续回滚以它为准。

### Step 2: 查看变更日志

核对 0.84.3 之后至 1.1.0 的全部变更，而非只看 1.1.0 单次发布：

- [pi-agent-core 变更日志（v1.1.0）](https://github.com/earendil-works/pi/blob/v1.1.0/packages/agent/CHANGELOG.md)
- [pi-ai 变更日志（v1.1.0）](https://github.com/earendil-works/pi/blob/v1.1.0/packages/ai/CHANGELOG.md)

已确认的破坏性变更与本项目处理方式见下文“已确认的兼容性变更”。实施时仍需核对实际安装版本的导出和声明文件。

### Step 3: 更新依赖

```bash
cd /Users/zhangjunqing/git-hy/antler
pnpm --filter @antler/server update '@earendil-works/pi-agent-core@^1.1.0' '@earendil-works/pi-ai@^1.1.0'
pnpm --filter @antler/server list @earendil-works/pi-agent-core @earendil-works/pi-ai typebox
```

或手动编辑 `backend/package.json` 后执行:

```bash
pnpm install
```

检查锁文件中的 Pi 实际版本和 TypeBox 依赖树。如果目标包与后端直接依赖的 TypeBox 声明不兼容，需要对齐后端 TypeBox 版本并重新生成锁文件，不能用 `any` 掩盖工具 schema 类型错误。

### Step 4: 类型检查

```bash
cd /Users/zhangjunqing/git-hy/antler
pnpm check
```

如果出现类型错误,记录所有错误信息:

```bash
set -o pipefail
pnpm check 2>&1 | tee /tmp/antler-pi-type-errors.log
```

此阶段预计会暴露已删除的 skills 导出；完成 Step 5 后必须重新通过根目录的 `pnpm check`。

### Step 5: 代码适配

先完成已确定的 skills 迁移，再根据类型检查结果调整 Agent 和 provider 适配层。

#### 5.1 替换已删除的 skills API（必做）

采用本地实现技能加载和格式化，解除 skills 模块对 Pi harness 导出的依赖：

- `backend/src/skills/types.ts`：定义本地 `Skill` 类型，保留当前使用的 `name`、`description`、`content`、`filePath` 和 `disableModelInvocation` 字段及其语义。
- `backend/src/skills/skill-registry.ts`：替换 `loadSourcedSkills` 和 `RestrictedSkillExecutionEnv` 所依赖的 Pi 类型、错误和 Result 帮助函数，直接使用现有异步文件系统操作加载 `SKILL.md`。在读取前保留真实路径 containment、符号链接检查、只读访问和大小上限。
- 本地 frontmatter 解析需保持现有支持范围及元数据校验；名称、描述、`disable-model-invocation`、引号和多行字段都需核对旧实现。不能仅按冒号拆分 YAML 并将现有可加载的技能静默丢弃。解析失败应产生诊断并跳过该技能。
- 保留 workspace → user → bundled 的覆盖优先级、fingerprint、禁用模型调用行为，以及 `skill_invalid`、`skill_too_large`、`skill_shadowed` 等对外诊断。
- `backend/src/skills/skill-tools.ts`：本地替换 `formatSkillInvocation`，保持 `load_skill` 输出和 `skill://` 路径语义，并继续经过 SecretGuard 保护。
- `backend/src/skills/skill-prompt.ts`：继续消费 `SkillSnapshot`；验证可用技能摘要与实际加载内容一致。

补充 `skill-registry.test.ts` 中的无效元数据、忽略规则、覆盖优先级、大小限制、目录和 `SKILL.md` 符号链接逃逸、fingerprint 变化及资源读取回归。

#### 5.2 Agent 构造函数

**位置**: `backend/src/agent/pi-agent-adapter.ts:204, 123`

**当前代码**:
```typescript
const agent = new Agent({
  initialState: {
    model: model as Model<any>,
    systemPrompt: this.secretGuard.redact(...),
    thinkingLevel: "low",
    messages: [],
    tools: this.tools(skillSnapshot),
  },
  streamFn: (activeModel, context, options) => ...
});
```

**可能需要调整**:
- `initialState` 字段名或必需字段变更
- `thinkingLevel` 类型或可选值变更
- `streamFn` 签名变更

#### 5.3 Provider streamSimple 方法

**位置**: `backend/src/agent/pi-agent-adapter.ts:215, 135`

**当前代码**:
```typescript
provider.streamSimple(
  activeModel as Model<"anthropic-messages">,
  context,
  {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${this.config.anthropicAuthToken}`,
    },
    signal: options?.signal,
    timeoutMs: this.config.requestTimeoutMs,
  }
)
```

**可能需要调整**:
- options 对象结构变更
- 返回值类型变更
- 新增必需参数

#### 5.4 Model 类型断言

**位置**: `backend/src/agent/pi-agent-adapter.ts:125, 205`

**当前代码**:
```typescript
model: model as Model<any>
```

**可能需要调整**:
- 如果 Model<T> 泛型约束收紧,需要提供正确的类型参数
- 可能需要从 `Model<any>` 改为 `Model<"anthropic-messages">` 或 `Model<"openai-responses">`

#### 5.5 AgentTool 接口实现

**位置**: 
- `backend/src/agent/workspace-tools.ts`
- `backend/src/agent/tavily-search-tool.ts`
- `backend/src/skills/skill-tools.ts`

**可能需要调整**:
- 工具接口字段变更
- execute 方法签名变更
- 新增必需字段(如 schema, description 格式)

### Step 6: 运行测试

```bash
cd /Users/zhangjunqing/git-hy/antler
pnpm check
pnpm test
```

重点关注:
- `backend/src/skills/skill-registry.test.ts` 及 Step 5.1 的新增回归
- `backend/src/agent/host-runtime.test.ts`
- Agent/provider 测试中的 transcript、system prompt、工具声明、取消和错误事件；使用真实 Agent 加可控模拟流补足覆盖，host-runtime 的 adapter mock 无法证明 provider 兼容性

如果测试失败,记录失败信息:

```bash
set -o pipefail
pnpm test 2>&1 | tee /tmp/antler-pi-test-failures.log
```

### Step 7: 集成测试

启动开发服务器:

```bash
cd /Users/zhangjunqing/git-hy/antler
pnpm dev:server
```

若通过 Web UI 验证，在仓库根目录使用 `pnpm dev` 同时启动前后端。更改 provider、模型或环境变量后重启服务，使用新会话测试。

明确区分两种配置路径：未在请求中提供 `provider` 时使用服务端环境配置，`ANTHROPIC_AUTH_TOKEN` 非空会优先选择 Anthropic，否则选择 OpenAI；同时配置两个密钥不会切换到 OpenAI。Web UI 保存了非空供应商 API key 时会在 `POST /api/runs` 中发送 `provider`，覆盖服务端默认配置。每次验证都需确认请求是否带有该字段，记录实际协议、模型和配置路径，记录中的密钥需脱敏。

手动验证以下场景:

#### 7.1 Anthropic Provider

- [ ] 验证服务端默认路径时，配置非空 `ANTHROPIC_AUTH_TOKEN`、对应模型和可选 `ANTHROPIC_BASE_URL`；清空 Web UI 的供应商 API key，使请求不带 `provider`，重启服务
- [ ] 如使用 UI／请求覆盖路径，明确提供 `provider.protocol: "anthropic-messages"`、非空 API key、对应模型及可选 baseUrl，确认请求使用该配置
- [ ] 创建新对话
- [ ] 发送消息,验证响应正常
- [ ] 触发工具调用,验证工具执行正常
- [ ] 中止运行中的请求,验证能正常取消

#### 7.2 OpenAI Provider

选择下列路径执行，并记录使用哪一种；验证服务端默认配置和 UI 覆盖配置时应分别使用新会话：

- **服务端默认路径**：清空根目录 `.env` 中的 `ANTHROPIC_AUTH_TOKEN`，同时在启动终端执行 `unset ANTHROPIC_AUTH_TOKEN`，配置非空 `OPENAI_API_KEY`、`ANTLER_MODEL`（使用 Pi OpenAI catalog 支持的模型 ID）及可选 `OPENAI_BASE_URL`。清空 Web UI 的供应商 API key，重启服务，确认 `POST /api/runs` 请求不带 `provider`。这样才能验证服务端默认 OpenAI 路径。
- **UI／请求覆盖路径**：在 Web UI 的供应商配置中选择 `openai-responses`，填写非空 OpenAI API key，添加并选择 catalog 支持的模型，按需填写 baseUrl。确认 `POST /api/runs` 中的 `provider` 包含 `protocol: "openai-responses"`、非空 `apiKey`、正确的 `model` 和预期的 `baseUrl`。仅设置供应商名称为 OpenAI 或只配置服务端 `OPENAI_API_KEY` 不会构成 UI 覆盖。

- [ ] 确认请求采用上述 OpenAI 配置路径；不能以“返回了响应”作为 provider 切换成功的唯一依据
- [ ] 发送消息,验证响应正常
- [ ] 触发工具调用,验证工具执行正常

#### 7.3 错误处理
- [ ] 移除 API key,验证错误提示
- [ ] 配置不存在的模型,验证错误提示
- [ ] 模拟网络超时,验证超时处理

#### 7.4 Skill 集成
- [ ] 加载 skill,验证 skill tools 正常注册
- [ ] 触发 skill 工具调用
- [ ] 验证 skill prompt 正确注入 systemPrompt

#### 7.5 SecretGuard
- [ ] 验证敏感信息(API key, token)不会泄漏到输出
- [ ] 验证错误消息中的敏感信息被正确脱敏

### Step 8: 保存升级版本

完成适配、全量检查和集成验证后，将本次依赖、锁文件和代码迁移作为一个独立提交保存。确认 `git status --short` 为空，再标记验证版本：

```bash
cd /Users/zhangjunqing/git-hy/antler
git status --short
git tag antler-pi-1.1.0
```

两个标签分别固定升级前和升级后的提交，供版本追溯和回滚使用。若之后又修改实现，需要重新通过检查和集成验证，并为最终提交建立新的验证标记。

## 已确认的兼容性变更

本次跨越 0.84.3 → 1.1.0，应按大版本迁移处理。以下依据 Step 2 的上游版本日志，区分已确认变化与仍需验证的行为：

- **1.0.0 删除 skills/harness 导出**：这是当前后端的直接阻塞点，涉及 `Skill`、技能加载、格式化和文件系统抽象，按 Step 5.1 实施本地替代并保留安全约束。
- **0.86.0 transcript 模式**：provider-facing context 改为 `TranscriptContext`，system prompt 和工具声明由 system message 承载。适配层应透传 Agent 生成的 context；验证初始化提示、工具声明、后续消息和 SecretGuard 脱敏，不能假设消息历史始终只有 user/assistant/toolResult。
- **0.86.0 JSON 类型约束**：`ToolCall.arguments` 和 `ToolResultMessage.details` 收紧为 JSON 兼容值。检查各工具返回值，避免 `Error`、`BigInt`、函数或循环引用进入 details；是否需要调整以实际目标声明和类型检查为准。
- **1.1.0 流返回值**：流函数必须返回 `AssistantMessageEventStream`。适配层继续使用 provider 的流；测试中的手写流也需要核对该约束。
- **1.1.0 耗时信息**：assistant/tool result 和相关事件新增耗时信息。现有映射可忽略可选字段，但应验证事件处理、持久化和错误/取消路径兼容。

上述变化不意味着所有 Agent、Model 或工具构造都需要重写。以实际 1.1.0 导出和类型为依据，保留可兼容调用，不用类型断言绕过已删除的 API。

## 回滚计划

回滚必须恢复代码、`backend/package.json` 和 `pnpm-lock.yaml` 的一致版本，并重新安装、重启和验证。两个本地标签和升级分支均保留，便于排查；不通过删除分支完成回滚。

### 未合并时：恢复升级前提交

停止服务，检查工作区。若有未提交修改，先提交保存或使用下面的 stash 命令保存已跟踪和未跟踪文件；被 Git 忽略的文件不在 `-u` 保存范围内，有需要保留的内容时另行备份。保留 stash，待回滚验证完成后再单独处理。

```bash
cd /Users/zhangjunqing/git-hy/antler
git status --short
# 仅在有未提交修改时执行
git stash push -u -m 'pi-1.1.0 rollback: preserve work'
```

确认工作区干净后，从固定基线创建回滚分支。同名分支已存在时使用新的分支名，不覆盖已有分支。

```bash
git switch -c rollback/pi-packages-0.84.3 antler-pre-pi-1.1.0
pnpm install --frozen-lockfile
pnpm --filter @antler/server list @earendil-works/pi-agent-core @earendil-works/pi-ai
pnpm check
pnpm test
pnpm dev:server
```

验证旧版对话、工具和技能加载恢复正常。这里恢复的是标签对应的已提交代码；stash 中的升级修改不会自动应用到回滚分支。

### 已合并时：撤销升级提交

在包含升级的目标分支上保存当前工作，创建回滚分支，再用 `git revert` 撤销实际合入的升级提交，保留其后的其他变更。先通过 `git show` 核对该提交包含依赖、锁文件和代码迁移。

```bash
git switch -c rollback/pi-packages-1.1.0-merged
# 将 UPGRADE_COMMIT_SHA 替换为实际合入的独立升级提交 SHA
git show --stat UPGRADE_COMMIT_SHA
git revert UPGRADE_COMMIT_SHA
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm dev:server
```

如果通过 squash 合并，使用 squash 后的提交 SHA；如果升级分散在多个提交，按从新到旧撤销全部相关提交；如果撤销的是 merge commit，先确认父提交再选择 `git revert -m` 的主线。解决冲突时同时检查迁移代码、包声明和锁文件，不能只降级包版本。

### 临时切换 provider

若仅某个 provider 异常，可在已验证另一个 provider 可用的前提下调整配置并重启服务。此操作是临时服务切换，不等于依赖回滚，也不能解决 skills 导出删除等共用问题。

## 验收标准

升级成功的标准:

- [x] `backend/package.json` 与根目录锁文件版本一致，Pi 实际解析为 1.1.0
- [x] `pnpm install --frozen-lockfile` 无错误
- [x] `pnpm check` 类型检查通过
- [x] `pnpm test` 所有测试通过（前端 38、后端 82，共 120 项）
- [x] `pnpm --filter @antler/server build` 通过
- [x] Anthropic 真实 Agent 可正常对话，并执行 `load_skill` / `read`
- [ ] OpenAI 真实 provider 联调：本机未配置 OpenAI key；真实 Agent + 模拟流兼容性测试已通过
- [x] workspace tools、Tavily search、skill tools 回归通过；Tavily 真实调用返回结果
- [x] skills 不再引用已删除的 Pi 导出，元数据、格式化和路径安全回归通过
- [x] SecretGuard 脱敏回归通过
- [x] 模拟流错误/超时、取消、缺少凭据和 OpenAI 未知模型回归通过
- [ ] 保存独立升级提交并建立最终验证标签；升级前基线标签已创建
- [ ] 开发服务器/UI 完整人工验收及打包桌面应用验收

## 本次实施记录（2026-10-10）

- 升级分支：`upgrade/pi-packages-1.1.0`。现有文档暂存变更保留；升级实现尚未提交。
- 已通过检查的升级前代码提交：`6adbca22b7e85bfb3da359a7048e6dc5580c511b`，标签 `antler-pre-pi-1.1.0`。已有文档修改不影响该代码基线，另行保留。
- 本地 `Skill`、解析器、格式化器及有大小上限的异步文件读取替代了删除的 harness API；YAML 多行/引号、忽略规则、覆盖优先级和禁用技能行为保持兼容。
- 按用户要求移除旧版行为对照文件及其 10 项测试，保留功能和安全回归测试。
- 缺少描述等无效元数据现在明确返回 `skill_invalid`；过大文件明确返回 `skill_too_large`。技能发现阶段拒绝跨技能目录的文件链接及敏感文件别名，fingerprint 使用本次解析的原始内容计算。
- Agent 适配层现有构造、context 透传和流接口直接兼容，无需修改生产 adapter。新增兼容性测试使用真实 Agent、真实 provider catalog 和可控流，覆盖 transcript、技能/文件/搜索工具、多轮上下文、认证参数、错误和取消；Anthropic 私有网关模型回退亦已覆盖。
- 真实 Anthropic 冒烟：成功执行 `load_skill` 和 `read`；Tavily 真实搜索成功返回 1 条结果。OpenAI 真实验证因缺少密钥未执行。

## 后续优化建议

### 1. 利用新特性

如果 1.1.0 引入了新特性,评估是否集成:

- 新的 thinking level 选项
- 新的 provider(如 Gemini, Claude Haiku 等)
- 改进的错误处理机制

### 2. 代码清理

升级后可能可以移除的兼容代码:

```typescript
// 如果 1.1.0 改进了类型定义,可能不再需要 as 断言
model: model as Model<any>  // 改为更精确的类型

// 如果 1.1.0 统一了 provider 接口,可能可以抽象公共逻辑
```

### 3. 文档更新

- 更新 README.md 中的依赖版本说明
- 更新开发者文档中的 Agent 使用示例
- 添加新特性的使用指南

### 4. 监控和反馈

- 监控 GitHub Issues,关注其他用户报告的问题
- 向上游反馈遇到的 bug 或文档不清晰的地方
- 订阅 release notifications,及时获取 patch 版本更新

## 联系人和资源

- **项目负责人**: junqing.zhang
- **升级分支**: upgrade/pi-packages-1.1.0
- **上游仓库**: @earendil-works/pi-agent-core, @earendil-works/pi-ai
- **相关 Issue**: (待创建)

## 变更记录

| 日期 | 操作 | 结果 | 备注 |
|------|------|------|------|
| 2026-10-10 | 创建升级方案 | - | 初始版本 |
| 2026-10-10 | 修正审核问题 | 待实施 | 补齐 skills 迁移；统一执行目录；修正回滚流程 |
| 2026-10-10 | 修正复审问题 | 待实施 | 基线检查通过后再创建标签；明确 OpenAI 默认与请求覆盖路径 |
| 2026-10-10 | 实施升级 | 本机检查及 Anthropic/Tavily 验证通过 | Pi 1.1.0；本地 skills；120 项测试（已移除旧版对照）；OpenAI 真实联调待配置密钥 |
