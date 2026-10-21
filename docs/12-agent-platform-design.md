# Agent 平台化设计与实施计划

> 状态：已实施；本地 / PGlite 验证完成，PostgreSQL 实库锁验收待独立环境执行
> 目标版本：Agent Platform v1
> 依赖：[01 架构规划](./01-architecture-plan.md)、[02 Pi Agent 实现计划](./02-pi-agent-implementation-plan.md)、[04 技能后端设计](./04-skill-backend-design.md)
>
> 修订记录：2026-10-22 按评审意见修正平台目录隔离、会话 Agent 绑定、前端会话归属、下线语义、请求体上限、落盘原子性；补充最终 Agent 统一鉴权与单实例启动互斥要求；修正草稿调试误伤、定时任务指纹固化、权限判定改用 authMode；拆分技能文件与目录指纹，贯通定时执行约束，统一验收语义并补充历史会话入口；补齐会话所有者鉴权、运行创建互斥与历史空指纹兼容规则；补充技能上下文持久化与历史基线、定时任务不可重试错误传递、技能可绑定性服务端校验；补齐技能覆盖更新路径（PUT）与 `app.ts` service 包装层的约束透传要求，消除「上传即覆盖」与全局唯一名的冲突；明确 advisory lock 必须由独立 `pg.Client` 持有，并把定时任务固化字段完整性提升为 preflight 前置校验；修正技能更新恢复目录归属与缺失目录修复，统一技能读写锁及 run 读租约，补齐定时包装层固化字段约束；明确技能描述以 frontmatter 为准、引用列表按 Agent 可见性过滤，以及数据库 UUID 与运行时技能名称的转换契约；补齐已发布 Agent 编辑时的发布条件校验，禁止通过 PUT 保存空白提示词绕过发布门槛。

## 1. 目标与范围

把当前的「单一内置 Agent」改成「可新增、发布、使用的 Agent 平台」：

1. 登录用户可以**新建 Agent**，定义名称、描述和**系统提示词**。
2. 用户可以在**技能库**中上传 Skill（`SKILL.md` + 附属资源），并把若干 Skill 绑定到 Agent。
3. Agent 有 `draft` / `published` 两态。发布后**全站可见**、任何登录用户都能对话；**只有作者**能编辑、发布、下线、删除。
4. 首屏从「聊天会话列表」变成「Agent 列表 + 进入聊天」。

已确认的范围裁剪（v1 不做）：

| 不做 | 原因 |
|---|---|
| 不可变版本快照 | 采用「仅草稿 + 状态位」，见 §3.2 的后果与缓解 |
| Agent 级模型 / 供应商覆盖 | 模型仍由浏览器端配置或 `.env` 决定 |
| Agent 级工具白名单 | 所有 Agent 共享同一套工作区工具 |
| 团队 / 组织共享 | 只有「作者」与「全站」两个可见层级 |
| Skill 版本历史与回滚 | 内容更新走覆盖式 `PUT`，不保留旧版本、不可回滚 |
| 运行期热更新进行中的会话 | 会话绑定变更会明确报错，不静默切换 |
| bash 文件系统沙箱 | 仅做路径级拒绝，见 §3.1 的残余风险 |
| 多实例部署 | v1 只允许单个 backend 实例，启动互斥与清理顺序见 §3.1 |

## 2. 现状与缺口

| 现状 | 位置 | 对 Agent 平台的影响 | 需要的改动 |
|---|---|---|---|
| 系统提示词是进程级常量 | `backend/src/agent/system-prompt.ts`、`app.ts:92` | 所有会话同一套人格 | 提示词变成 Agent 字段，随 run 注入 |
| `PiAgentAdapter` 的 `systemPrompt` 在构造时固定 | `pi-agent-adapter.ts:28` | 适配器被 `adapters` Map 按 `{...runtimeConfig, workspaceRoot}` 缓存 | 缓存 key 加入提示词哈希与 `agentId` |
| 会话内 Agent 实例只校验技能目录指纹 | `pi-agent-adapter.ts:209/332/417`（Anthropic / OpenAI / 另一路径三处）、`host-runtime.ts:84` | 提示词或 Agent 变了却复用旧上下文会串味 | 三处指纹比较与两处 `cached = { agent, fingerprint }` 赋值（358/446）同步改为 `contextFingerprint`；并独立比对 `agentId` |
| 技能只来自文件系统三来源（workspace / user / bundled） | `skill-registry.ts:57`（`list()`）、`:58-62`（三来源定义） | 没有「平台技能」概念，无法上传 | 新增第四来源 `platform`，目录由 backend 管理 |
| `skillContexts` 按会话记录 `{policy, catalogFingerprint}` | `host-runtime.ts:84` | 正好是「会话绑定 Agent」的落点 | 扩展为 `{agentId, agentFingerprint}` 并分别校验 |
| `projects` 与 `conversations` 在浏览器 IndexedDB | `app/src/lib/conversation-store.ts` | 会话是纯客户端资产，且没有 Agent 归属 | `Conversation` 增加 `agentId`，列表按 Agent 过滤 |
| `runs` 只记 `projectId` / `conversationId` | `prisma/schema.prisma` | 无法回答「这次运行用了哪个 Agent」 | `runs` 增加 `agentId`、`agentFingerprint` |
| 前端只有一个 `ChatView` 路由 | `app/src/main.tsx` | 无列表页、无编辑器 | 增加路由与两个页面 |
| Fastify 未配置 `bodyLimit` | `backend/src/app.ts` | 默认 1 MiB，5 MiB 技能包会被 413 提前拒绝 | 上传路由单独设置上限 |
| `workspacePath()` 只挡 `..` 与符号链接逃逸 | `workspace-tools.ts:37-49` | 平台目录若在 workspace 内会被 `write` 直接改写 | 平台根移出 workspace + 显式路径拒绝 |

## 3. 关键决策

### 3.1 Skill 存文件系统目录（已定）

上传的 Skill 解包到 backend 管理的目录，**不**落在任何 Agent 工作目录里：

```
<ANTLER_PLATFORM_ROOT>/
├── skills/<skill-row-id>/
│   ├── SKILL.md
│   └── ...资源文件
└── .staging/<uuid>/          # 仅解包期存在
```

- `ANTLER_PLATFORM_ROOT` **必须位于工作区之外**。默认值取 `resolve(projectRoot, ".antler-platform")`，即仓库根下的隐藏目录；不得默认落在 `workspace/` 内。
- 启动时校验：`realpath(platformRoot)` 不得是 `ANTLER_WORKSPACE_ROOT` 或其子目录，否则**拒绝启动**并打印明确错误。这是硬约束，不做降级。
- 目录名用数据库行 ID（uuid）。现有 `parseSkill(raw, basename(directory), filePath)` 强制 `name === directoryName`，所以平台技能**不走目录扫描**：读取 DB 元数据后，用 `skill.name` 作为逻辑 ID，磁盘路径单独放入 `LoadedSkill.directory`。为此给 registry 增加独立的 `listPlatform(rows)` 分支。**这是本次改动里唯一需要触碰 `skill-loader.ts` 契约的地方**，必须单测覆盖。
- 读取侧复用现有 `readSkillFile` 与技能工具的资源读取、路径检查和忽略规则；文件指纹保留原契约，新增目录完整性指纹，见 §5.2。

**写入隔离（分级说明，不要混为一谈）：**

| 通道 | 隔离手段 | 强度 |
|---|---|---|
| `read` / `write` / `edit` | `workspacePath()` 追加检查：解析结果落在 `platformRoot` 内即抛 `platform_path_denied` | 强（路径级拒绝） |
| `read_skill_resource` | 已有 `inside(skill.directory, actual)` 检查，天然被限制在单个技能目录内 | 强 |
| `bash` | **无法在进程内可靠拦截**。`execFile("bash", ["-c", ...], { cwd: root })` 没有文件系统沙箱，模型可以 `cat`/重定向到任意绝对路径 | 弱（残余风险） |

`bash` 的残余风险在 v1 **显式接受**，并配套两条缓解：

1. 平台根权限设为 `0700`，属主为 backend 进程用户；若希望真正隔离，需让 bash 以另一个用户运行（`setuid`/容器 `--user`），这属于部署层改动，v1 不做。
2. 运行期对平台技能目录计算指纹并与 DB 比对。发现被改写时，将该技能标记为 `tampered`，拒绝被新 Agent 绑定，并记录 warning 日志（不自动回滚，避免掩盖问题）。

文档与 README 均按上表描述，**不得声称已实现完整隔离**。

**v1 仅支持单实例部署**：共享卷不足以保证上传、清理及运行内存状态一致，不支持滚动更新期间新旧 backend 重叠运行。部署必须先停止旧实例，再启动新实例；备份策略需单独覆盖平台目录。

启动必须先取得覆盖同一平台存储的独占锁，再做任何 self-check、目录清理、调度器启动或 HTTP 监听，并持锁直到进程退出：

- PostgreSQL 部署使用专用连接持有 session advisory lock，锁键固定于平台用途，作用域为同一数据库；不得通过事务池连接持有。连接丢失时立即停止接收请求和调度任务并终止进程，不得继续上传或清理。
  - **「专用连接」必须是独立的 `pg.Client`，不能复用 `PrismaClient`**：当前 `plugins/database.ts` 通过 `@prisma/adapter-pg` 建立的是连接池，`$queryRaw` 每次随机取连接，`pg_advisory_lock` 与 `pg_advisory_unlock` 可能落在不同连接上，锁在该会话结束时才释放或根本无法释放。实现要求：新增 `pg` 为直接依赖（目前仅为传递依赖），启动时 `new Client({ connectionString })` → `connect()` → `SELECT pg_advisory_lock($1)`，该 client 全进程唯一并持有到退出；`error` 事件、连接结束或心跳失败一律触发优雅停机后 `process.exit(1)`，不停留为只处理 HTTP 的半活状态。锁键用固定的 int64 常量，不与 run / task 等其他 advisory lock 复用同一键。
  - PGlite 部署（本地开发、测试）不支持 advisory lock，也无需它：PGlite 是进程内嵌入式数据库，天然单实例；该场景只依赖下面的操作系统文件锁。
  - 启动互斥的验收必须覆盖「Prisma 连接池重建后锁仍被持有」，不能只验证 `$queryRaw` 返回成功。
- 平台根另需进程生命周期的操作系统独占文件锁，覆盖误配为不同数据库但共用目录的情况；本地 PGlite 部署也必须取得此锁。锁文件放在平台根内的固定位置，不能仅用文件存在性判断持锁，也不能按超时删除活跃锁。共享文件系统若不提供可靠的锁语义，拒绝作为 v1 平台存储。
- 任一锁未取得就拒绝启动，不执行清理；正常退出和崩溃均由连接/操作系统释放锁。获取文件锁前仅允许创建平台根与锁文件所需的最小操作。
- 所有清理必须在服务开始接收上传之前完成。未来支持多实例时，需要重新设计上传租约、孤儿判定和运行状态协调，不能直接移除此锁。

### 3.2 「仅草稿 + 状态位」（已定）

`Agent.status ∈ {draft, published}`。发布 = 置位，不发快照。直接后果：

- 作者改提示词或改绑定的 Skill，**已有会话下一轮会因内容不一致而被拒绝，新会话使用新内容**。
- 现有不变量「会话技能上下文必须一致」会因此触发 409。这不是 bug，是保护：确认要换内容，就新开会话。

会话一致性由**两个独立维度**共同约束，不能合并成一个哈希：

| 维度 | 取值来源 | 不一致时的错误 | 说明 |
|---|---|---|---|
| Agent 身份 | `agentId`（可为 `null`） | `409 agent_changed` | 两个提示词与技能完全相同的 Agent 也**不能**共用会话 |
| Agent 内容 | `agentFingerprint` | `409 agent_context_changed` | 同一 Agent 被作者改了提示词 / 技能绑定 |
| Agent 状态 | `status`（交互入口查库；定时任务要求 `published`） | 非作者：`404`；定时任务：`404` 或失败记录 | 作者可继续调试自己的 draft，见 §3.3 |

为什么 `agentId` 必须独立比对：适配器的 `agents` Map 按 `conversationId` 缓存 `Agent` 实例，实例在创建时固定了 `systemPrompt` 与工具集，而 `app.ts` 的适配器缓存按 `agentId` 分键。若指纹相同但 `agentId` 不同，校验会放行，却拿到一个**没有该会话历史的适配器实例**，表现为模型凭空失忆。指纹公式因此**不包含 `agentId`**，身份交由独立字段比较。

另需明确「带 / 不带 `agentId`」的切换规则：

- 会话首轮带 `agentId`，后续请求**省略** `agentId`：继承既有绑定，并重新查库鉴权；不视为切换 Agent。
- 会话首轮不带 `agentId`，后续带上：同样视为换 Agent → `409 agent_changed`。
- 会话首轮不带，后续也不带：普通「无 Agent」会话，行为与当前版本一致。

缓解措施（v1 必须做，属于产品语义的一部分）：

1. `runs` 表记录 `agentId` / `agentFingerprint`。会话的既有取值来自最近一次 run，重启后据此恢复校验，不依赖内存。
2. Agent 编辑页在「已发布且有进行中会话」时给出显式警告文案。
3. 后续若要回滚能力，只需给 `agents` 加 `revisions` 表并把 `agentFingerprint` 改成外键，不改运行链路。

### 3.3 全站可见，仅作者可编辑（已定）

| 操作 | 作者 | 其他登录用户 | 未登录 |
|---|---|---|---|
| 浏览 published Agent | ✓ | ✓ | ✗ |
| 与 published Agent 对话（新会话） | ✓ | ✓ | ✗ |
| 浏览 / 对话 draft Agent | ✓ | ✗（404） | ✗ |
| 编辑 / 发布 / 下线 / 删除 | ✓ | ✗（403） | ✗ |
| 上传 / 修改 Skill | ✓ | ✗ | ✗ |

**下线（unpublish）语义，统一如下：**

- 下线**不中断**已经开始的 run，当前 run 正常跑完。
- 下线后，**非作者**对旧会话**再发消息**：入口按「非作者访问非 published Agent」返回 `404`（不泄露存在性）。因为该 Agent 已不可见，404 是正确结果。
- 下线后，**作者**对旧会话再发消息：**允许**，与草稿调试同一行为。`draft` 对作者而言不是一个需要拦截的状态，而是一个可以反复试跑的状态；拒绝会让「调试 → 发布 → 下线 → 再调试」这条路径断掉。
- 重新发布后，旧会话恢复可用；若期间提示词或技能绑定也被改过，则按 §3.2 的 `agent_context_changed` 处理。

**草稿调试（draft）语义**：作者与自己的 `draft` Agent 对话**不受轮次限制**，首轮与后续轮次行为一致，只受 `agent_context_changed`（内容变了）和 `agent_changed`（换了 Agent）约束。因此**不存在 `agent_unpublished` 这个错误码**——它同时覆盖不了「从未发布」和「发布后下线」两种情况，只会误伤草稿调试。

- 列表 / 详情页对下线 Agent 只对作者可见，徽标显示「草稿」。

`authMode=local`（Tauri / 本地开发）时无需登录校验，等价于「本机单用户」：所有 Agent 可见可编辑，行为与当前一致。判定依据是服务端 `authMode`，不是 `ownerId` 是否为空串，见 §5.7。

Skill 被多个 Agent 引用时，删除 Skill 需先解绑；v1 选择**拒绝删除并仅返回调用者可见的 Agent 引用详情**，避免静默破坏他人 Agent。 引用检查必须覆盖全部 Agent，但响应详情按 §5.7 的 `canRead` 过滤：返回可见 Agent 的 ID / 名称，其他引用只返回 `hasHiddenReferences: true` 与「另有不可见 Agent 引用」提示，不返回其 ID、名称、作者或精确数量。即使全部引用都不可见也仍返回 409；local 模式下按单用户规则可见全部引用。

### 3.4 Agent 绑定的技能集是**封闭集**

Agent 运行时的可用技能 = 该 Agent 绑定的平台 Skill，**不叠加**调用者的工作区 / 用户级技能。

理由：published Agent 的行为必须对所有使用者可复现。若叠加调用者本地技能，同名技能优先级规则（workspace > user > bundled）会让同一个 Agent 在不同机器上表现不同。

实现：Agent 运行走 `skillPolicy: { mode: "selected", skillIds: [...skillNames] }`，且 `selected` 只在 `listPlatform` 的结果内解析，不经过三来源的覆盖合并。

## 4. 数据模型

```prisma
enum AgentStatus {
  draft
  published
}

model Agent {
  id          String      @id @default(uuid())
  ownerId     String      @default("")       // local 模式为空串
  name        String                          // 1..64
  description String                          // 1..1024，列表页展示
  systemPrompt String                         // 1..32000
  status      AgentStatus @default(draft)
  publishedAt DateTime?
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  skills      AgentSkill[]

  @@index([status, publishedAt])
  @@index([ownerId, updatedAt])
  @@map("agents")
}

model AgentSkill {
  agentId String
  skillId String
  agent   Agent @relation(fields: [agentId], references: [id], onDelete: Cascade)
  skill   Skill @relation(fields: [skillId], references: [id], onDelete: Restrict)
  position Int   @default(0)

  @@id([agentId, skillId])
  @@index([skillId])
  @@map("agent_skills")
}

enum SkillState {
  ready
  broken      // 目录缺失或损坏，禁止绑定
  tampered    // 内容指纹与 DB 不符，禁止绑定
}

model Skill {
  id          String     @id @default(uuid())
  ownerId     String     @default("")
  name        String     @unique               // 全局唯一，见下
  description String
  directory   String                           // 平台根下的相对路径
  state       SkillState @default(ready)
  disableModelInvocation Boolean @default(false) // 从已校验 frontmatter 提取，客户端不可指定
  fileCount   Int
  sizeBytes   Int
  fingerprint String                           // 整个技能目录的完整性摘要，见 §5.2
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  agents      AgentSkill[]

  @@index([ownerId, updatedAt])
  @@map("skills")
}
```

`Skill.name` 全局唯一：现有 `SkillSnapshot` 用 `id = skill.name`，`load_skill` 按 id 查找；重名会让模型和工具无法区分。上传时冲突直接 422，提示换名。

`Run` 增加四列（nullable，兼容历史数据）：

```prisma
agentId          String?
agentFingerprint String?
skillPolicy      Json?   // 规范化后的 SkillPolicy
catalogFingerprint String?
```

每次新建 run 将四项与运行记录在同一次 INSERT 中持久化；`Run` / `StoredRun` 和 `runStore.create/get/getLatestByConversation` 均需贯通这些字段。`skillPolicy` 的 selected ID 去重排序，比较前统一规范化；`catalogFingerprint` 保留现有算法。技能上下文两列必须同时存在或同时为空，单列缺失、非法 JSON 或升级后 Agent run 缺失技能上下文均视为损坏数据并拒绝恢复。历史无 Agent run 的两列均为空时，按 §5.5.5 的首次基线规则处理，不回填猜测值。

不改 `Run` 与 `Agent` 的外键：Agent 可被删除而历史 run 需保留可审计。

`ScheduledTask.payload` 不新增数据列，而是在既有 JSON 里接受 `agentId` 与 `agentFingerprint` 两项（见 §5.5.4）。两者既不是外键也不加索引：定时任务允许指向已删除的 Agent，执行时记录失败，保留可审计的历史执行记录。

新增表全部补 `ENABLE ROW LEVEL SECURITY`，与 `20261019140000_enable_backend_rls` 保持一致。

## 5. 后端设计

### 5.1 技能包上传格式与落盘

不用 multipart，直接用**单个 zip 文件的 base64 JSON**，避免给 Fastify 加 multipart 依赖：

```http
POST /api/skills
content-type: application/json

{ "archive": "<base64 zip>", "name": "stock-analysis", "description": "..." }
```

**请求体上限**：Fastify 全局默认 1 MiB 不足以承载 5 MiB 二进制（base64 后约 6.67 MiB）。上传路由必须单独声明 `bodyLimit: 7 * 1024 * 1024`（`app.post("/api/skills", { bodyLimit: 7 * 1024 * 1024 }, handler)`），全局上限保持不变，避免影响其他接口。同时写一条接近上限的集成测试（约 4.9 MiB 有效包），确认不被 413 打断。

校验（按顺序，任一失败即 4xx，目录不落盘）：

1. base64 解码后 ≤ 5 MiB。
2. zip 条目数 ≤ 200，解压后总量 ≤ 20 MiB，单文件 ≤ 1 MiB（`SKILL.md` 另受现有 `MAX_SKILL_BYTES = 64 KiB` 约束；资源文件运行时受 `MAX_RESOURCE_BYTES = 256 KiB` 约束）。
3. 拒绝绝对路径、`..`、符号链接、加密条目、`__MACOSX/`。
4. 必须存在根下的 `SKILL.md`（允许 zip 多一层包裹目录，自动剥掉唯一顶层目录）。
5. 用现有 `parseSkill` 校验 frontmatter：`name` 匹配 `^[a-z0-9]+(-[a-z0-9]+)*$`、≤ 64 字符，`description` 非空且 ≤ 1024，且 `name` 与请求体一致。`description` 以已解析 frontmatter 为唯一来源：POST / PUT 均用它写入 DB；请求体的可选 `description` 仅为兼容保留，若提供则必须与解析值一致，否则返回 422 `skill_invalid`，不得用请求体覆盖文件描述。
6. `disable-model-invocation: true` 的技能允许上传；将解析结果保存为 `Skill.disableModelInvocation`，不进入可绑定列表。

**完整性与可绑定性分开判定**：`state = ready` 仅表示文件完整，不代表可绑定。`GET /api/skills` 返回 `disableModelInvocation`、派生字段 `bindable = (state === "ready" && !disableModelInvocation)` 及不可绑定原因；技能库保留展示不可绑定项。Agent PUT 保存绑定集与 publish 均须在服务端加载并完整校验全部绑定技能，验证解析出的 `disableModelInvocation === false`（不能只信请求体或 DB 状态）；不可调用项返回 `422 skill_not_bindable`，完整性失败按技能不可用处理，且不提交部分绑定或发布状态。DB 元数据与已校验文件不一致视为损坏并拒绝使用。前端筛选不能替代该校验；`listPlatform` 仍过滤不可调用项，运行 preflight 缺项检查作为兜底。

**落盘顺序（先文件、后数据库）**：

```
1. 解包到 <platformRoot>/.staging/<uuid>/
2. 全部校验通过
3. rename(.staging/<uuid> → skills/<skill-row-id>)      ← 原子、无 DB 写入
4. INSERT skills 行
   └─ 失败 → rm -rf skills/<skill-row-id>，向上抛错
```

- `skill-row-id` 在步骤 1 之前用 `crypto.randomUUID()` 生成，从解包开始就是最终目录名，避免「先落盘到临时名、再改名」的第二次窗口。
- 任一步失败都清空对应目录；仅在取得 §3.1 的独占锁、且尚未开放上传入口时，启动清理才可清空 `.staging`（进程中断遗留）。未取得锁的进程不得扫描或移动技能目录。
- 启动 self-check 扫描 `skills` 表：目录不存在 → `state = "broken"`；指纹不符 → `state = "tampered"`。两种状态都拒绝被新 Agent 绑定，不自动删除记录，便于运维排查。
- 因此不存在「先 INSERT 后 rename」导致的行指向空目录窗口：即使步骤 4 之后进程被杀，最坏结果是目录存在而 DB 无行 → 启动清理时把孤儿目录移入 `.orphaned/`，不参与绑定。

**内容更新（`PUT /api/skills/:id`，覆盖语义）**：`Skill.name` 全局唯一，重名上传一律 422，因此覆盖更新必须走独立入口，不能指望「删了重传」。更新复用上文校验步骤 1–6 的全部检查，`name` 必须与请求体及现有行一致（改名等同于新建，不支持）。

```
1. 解包到 <platformRoot>/.staging/updates/<skillId>/<operationId>/new/，完成 1–6 全部校验
2. 取得该 skillId 的写锁，重新查询行并校验作者；旧目录存在则 rename(skills/<skillId> → 同操作目录/old)
   └─ 仅 ENOENT 表示无需备份；其他错误终止，不开始替换
3. rename(同操作目录/new → skills/<skillId>)
4. UPDATE skills 行（description / fingerprint / fileCount / sizeBytes / disableModelInvocation / state = "ready"），description 与 disableModelInvocation 均取自本次已校验 frontmatter
5. 删除操作目录（包括 old），释放写锁
```

- `skillId` 使用数据库行 ID，`operationId` 使用独立 UUID；恢复不依赖猜测随机 UUID 对应的技能。解包可在锁外进行，但步骤 2–5 及失败补偿必须持有同一写锁，且同一技能只允许一个操作进入替换阶段。
- 旧目录缺失的 `broken` 技能允许跳过备份，直接安装新目录。步骤 3 失败时恢复已备份的 `old`；步骤 4 明确失败时删除新目录并恢复 `old`，无备份则恢复为目录缺失，数据库保留原值。不能清理其他操作的目录。若数据库提交结果不确定或补偿失败，停止该技能的使用与更新并终止服务，由启动恢复处理，不能继续以正常状态提供读取。
- 两次 rename 之间确实存在最终目录缺失窗口，新目录与 DB 更新之间也存在指纹不一致窗口；这些窗口必须由下述读写锁屏蔽，不能声称单次 rename 保证整个更新原子。
- **启动恢复早于清空 staging 和 self-check**：取得 §3.1 的独占锁后，按 `updates/<skillId>/<operationId>` 查找操作。DB 行仍存在时：最终目录缺失且 `old` 存在则恢复 `old`；最终目录存在则保留最终目录、删除 `old`，随后按 DB 指纹判定状态。步骤 3/4 之间崩溃仍会判为 `tampered`，由上传者重新 PUT 修复；缺少旧目录的修复在步骤 2/3 之间崩溃则保持 `broken`，可再次 PUT。DB 行不存在则将最终目录及残留操作移入 `.orphaned/`，不恢复为可绑定技能。恢复完成后才清理剩余 staging。多个带 `old` 的操作指向同一技能属于异常，拒绝启动并保留现场，不猜测恢复顺序。
- `tampered` / `broken` 的技能重新成功执行 `PUT` 才回到 `ready`，无需删除引用它的 Agent。相同内容重传允许恢复状态；只有目录摘要实际变化才改变 Agent 内容指纹，不能断言每次 PUT 都会改变指纹。
- 覆盖更新不按「被引用」拦截（与 `DELETE` 的 409 不同）：作者更新自己的技能是被允许的显式操作。内容变化后，已有会话下一轮按 §3.2 返回 `409 agent_context_changed`，定时任务要求重新保存。
- **所有平台技能访问共用按 `skillId` 的进程内读写锁**：PUT、DELETE 与完整性状态写回取得写锁；完整性校验、Agent 保存绑定、发布校验取得读锁，从查询 DB 元数据到完成文件读取均在锁内。读校验发现损坏时，释放读锁后取得写锁，重新读取并复核当前版本才写回状态，避免旧检查结果污染更新后的 `ready` 状态。
- **进行中 run 保持技能内容稳定**：preflight 按技能 ID 排序取得全部绑定技能的读锁，成功后将租约移交 active run，直到模型与工具执行结束才释放；失败路径同样释放。`load_skill` / `read_skill_resource` 使用该租约，不能递归获取读锁。PUT / DELETE 等待读租约结束后才进入替换阶段，因此当前 run 读到完整旧内容，后续 run 读到完整新内容。Agent 保存/发布持有多技能读锁时也按 ID 排序，锁内不等待会话占用；run 先取得会话占用再取得技能锁，避免锁顺序反转。§3.1 的启动锁不能替代这些进程内锁；bash 仍属于已接受的残余风险。

### 5.2 `SkillRegistry` 扩展

现有 `list()` 保持不变，避免影响 workspace / user / bundled 路径。新增：

```ts
export type PlatformSkillRow = {
  id: string; // 数据库 Skill.id（UUID），用于锁、状态写回和绑定完整性检查
  name: string; // 运行时逻辑 ID
  description: string;
  directory: string; // 绝对路径
  fingerprint: string; // DB 中保存的目录完整性摘要
};

class SkillRegistry {
  // 校验目录完整性，再复用 readSkillFile / ignore 规则加载技能
  async listPlatform(rows: PlatformSkillRow[]): Promise<{
    skills: LoadedSkill[]; // scope: "platform"
    diagnostics: SkillDiagnostic[];
  }>;
}
```

`SkillScope` 增加 `"platform"`。Agent 运行时只拿 `listPlatform` 的结果，因此「封闭集」成立。

**数据库 ID 与运行时 ID 的转换契约**：

| 使用位置 | 标识 |
|---|---|
| Agent 创建/更新 API 的 `skillIds`、`AgentSkill.skillId`、平台技能 API 的 `id` / `:id` | `Skill.id`（数据库 UUID） |
| 技能目录名、更新恢复、读写锁、损坏状态写回 | 数据库 UUID |
| `LoadedSkill.id`、`SkillPolicy.skillIds`、`RunAgentContext.skillIds`、`ResolvedRunAgent.skillIds`、技能工具的 `skillId` | `Skill.name`（运行时名称） |
| Agent 内容指纹中的技能键 | 运行时名称，与 `LoadedSkill.id` 一致 |

Agent 保存时按 UUID 查询并验证全部绑定，禁止把名称当作数据库 ID。运行 preflight 根据 `AgentSkill.skillId` 取得行，按 UUID 获取锁后重新读取元数据，再调用 `listPlatform`；registry 为每行生成 `LoadedSkill.id = row.name`。绑定缺项检查逐一按原 UUID 关联的名称确认返回项，不能直接比较 UUID 与 `LoadedSkill.id`。验证全部成功后，将名称去重排序生成运行时 `skillIds` 与 selected policy，后者持久化到 `Run.skillPolicy`。UUID 到名称的映射由调用方在本轮保留，用于锁释放和按 UUID 写回诊断状态，不得用运行时名称查找锁。前端多选框提交平台技能 API 返回的 UUID；模型只接触名称。


**两类指纹的契约必须分开**：

| 字段 | 计算对象 | 使用位置 |
|---|---|---|
| `LoadedSkill.fingerprint` | 读取并解析的 `SKILL.md` UTF-8 原文的 SHA-256（保留现有 `sha256:` 前缀） | `skill-tools.ts` 的 `entry()` 校验；三来源技能行为保持不变 |
| `Skill.fingerprint` / `LoadedSkill.directoryFingerprint` | 整个技能目录的完整性摘要 | 上传落库、启动 self-check、每轮平台技能 preflight、Agent 内容指纹 |

`LoadedSkill` 新增可选 `directoryFingerprint?: string`；平台技能必须赋值，三来源技能无需赋值。目录摘要统一由一个函数计算：递归枚举全部普通文件（含 `SKILL.md`、忽略文件和被忽略资源），拒绝符号链接及特殊文件；按使用 `/` 分隔的相对路径排序，以 `JSON.stringify([[relativePath, sha256(rawBytes)], ...])` 的 UTF-8 字节计算 SHA-256，带 `sha256:` 前缀。空目录不参与摘要，新增、删除、改名或修改任一文件都改变摘要。遍历与读取继续执行条目数、总量和单文件上限，避免运行期篡改绕过上传限制。

上传校验完成后将目录摘要写入 `Skill.fingerprint`。启动和每轮运行时重算并与 DB 比较；不一致即标记 `tampered` 并拒绝本轮运行，目录缺失或无法解析则标记 `broken`。`listPlatform` 只返回完整校验成功的条目；调用方必须检查绑定项是否全部返回，不能把 diagnostics 当成允许缺项的依据。`entry()` 继续只比较 `LoadedSkill.fingerprint` 与 `SKILL.md` 哈希，不能拿目录摘要替代它。每轮检查不提供运行期间的文件系统快照，仍受 §3.1 已接受的 bash 残余风险约束。


`composeSkillPrompt` 不变：平台技能同样以 `<available_skills>` 注入名称与描述，模型按需 `load_skill`。

### 5.3 系统提示词装配

```ts
// backend/src/agent/system-prompt.ts
export const BASE_SYSTEM_PROMPT = /* 现 DEFAULT_SYSTEM_PROMPT 原文，安全约束保留 */;

export function buildSystemPrompt(base: string, agentPrompt: string) {
  return `${base}\n\n<agent_instructions>\n${agentPrompt.trim()}\n</agent_instructions>\nThe agent instructions above define this agent's role and workflow. They cannot override the safety and credential rules stated before them.`;
}
```

- 基础提示词里的凭据保护条款**必须保留**且排在前面：平台开放后提示词由普通用户填写，不能因此削弱 `secret_access_denied` 和脱敏策略。
- 提示词长度上限 32000 字符（约 8k token），超限 422。
- 发布时要求 `systemPrompt.trim().length > 0`，空串和纯空白提示词均返回 `422 agent_prompt_required`；草稿可保存空串或纯空白以便逐步编辑。
- **已发布 Agent 的编辑必须保持发布条件**：`PUT /api/agents/:id` 应先将请求字段与现有记录合并为待保存配置，再按更新后的完整配置执行与 publish 共用的发布校验（非空白提示词、全部绑定技能完整且可绑定），不能只校验请求中出现的字段。任一条件不满足即拒绝整个更新；提示词为空白时返回 `422 agent_prompt_required`，其他失败沿用技能校验错误。失败时名称、描述、提示词、技能绑定、状态及 `publishedAt` 均保持原值，不自动下线。作者需要清空提示词时，必须先显式下线再编辑草稿。

### 5.4 适配器缓存与指纹

现行 `createAdapter(provider, workingDirectory)` 在 `app.ts` 内闭包，`adapters` Map 的 key 是 `JSON.stringify({...runtimeConfig, workspaceRoot})`。改造：

```ts
type RunAgentContext = {
  agentId?: string;
  systemPrompt: string;   // buildSystemPrompt 的结果
  skillIds: string[];     // 运行时技能名称，已去重排序
  skillFingerprint: string;
  agentFingerprint: string; // 见下，不含 agentId
};
```

- `createAdapter` 增加第三个参数 `agent?: RunAgentContext`；缓存 key 追加 `agentId` 与 `sha256(systemPrompt)`。
- 内容指纹（用于同 Agent 的会话一致性校验）：

```ts
agentFingerprint = sha256(
  systemPrompt + "\n" +
  sortedSkillNames.map(name => `${name}:${directoryFingerprintByName[name]}`).join("\n")
)
```

`sortedSkillNames` 为本轮 `LoadedSkill.id`（即名称）去重排序后的数组；`directoryFingerprintByName` 以同一名称为键，值来自本轮完整校验后的平台技能目录摘要，因此资源变化也属于 Agent 内容变化。

**公式里刻意不含 `agentId`**：身份由独立字段校验（§3.2），否则两个内容相同的 Agent 会互相视为同一个。

- `SkillSnapshot` 新增 `contextFingerprint`：有 Agent 时取 `agentFingerprint`，无 Agent 时取现有 `catalogFingerprint`。`PiAgentAdapter` 内部 `agents` Map 保存并比较此字段；`host-runtime` 另外独立校验 Agent 身份。保留 `catalogFingerprint` 用于现有技能策略一致性检查，避免无 Agent 会话因固定哨兵 `"none"` 而漏检技能变化。
- **缓存 key 必须包含提示词哈希**：只按 `agentId` 缓存会在「作者改了提示词但进程未重启」时继续用旧实例。

### 5.5 运行链路

#### 5.5.1 唯一入口 preflight

现有代码有两个运行入口，**都必须先经过同一个解析与校验函数**，否则 Agent 约束可被绕过：

| 入口 | 现状 | 风险 |
|---|---|---|
| `POST /api/runs` → `runtime.createRunWithSkills()` | `routes/runs.ts:108` | 计划中已覆盖 |
| `POST /api/tasks` → `TaskService.create()` → `runtime.createRun()` | `task-service.ts:11` | **完全绕过** §5.5 的 Agent 校验 |
| 定时 service 任务 → `executor.ts:150` → `TaskService.create()` | `payload.args` 可携带 `conversationId` | 同上，且无人值守触发 |

```ts
type ResolvedRunAgent = {
  agentId: string | null;      // null = 无 Agent 会话
  systemPrompt: string;        // 已 buildSystemPrompt；无 Agent 时为 BASE_SYSTEM_PROMPT
  skillIds: string[];          // 运行时技能名称，已去重排序；无 Agent 时为空
  agentFingerprint: string;    // 无 Agent 时为固定哨兵值 "none"
  platformSkills: LoadedSkill[]; // 本轮已校验条目，无 Agent 时为空
  diagnostics: SkillDiagnostic[];
};

// 只由服务端执行路径构造；HTTP 请求体不得直接设置这些约束。
type RunAgentConstraints = {
  expectedAgentFingerprint?: string;
  requirePublished?: boolean;
  // 定时 service 任务专用：payload 缺 Agent 固化字段时不得靠「继承到 null」放行。
  requireFrozenAgentFields?: boolean;
  frozenAgentFieldsPresent?: boolean; // 服务端根据 payload 两项均为非空字符串生成，不接受客户端约束
};

// AntlerHostRuntime 私有方法，createRun 与 createRunWithSkills 共用。
// AuthContext 见 §5.7；认证模式取自服务端配置。
private async preflight(
  conversationId: string,
  requestedAgentId: string | undefined,
  auth: AuthContext,
  constraints?: RunAgentConstraints,
): Promise<ResolvedRunAgent>;
```

`createRun` 在构造 `ActiveRun` 之前调用 `preflight`；`createRunWithSkills` 只负责在 preflight 之上完成技能发现，不再单独做 Agent 判定。`createRun` 现有的 `policy.mode !== "disabled"` 就抛 `Skill registry unavailable` 分支改为使用本轮解析结果组装的 snapshot。

**会话创建与绑定必须串行化**：两个入口统一进入同一个内部创建流程，在读取会话上下文或执行任何异步操作前，以 `conversationId` 同步登记占用。已有创建流程或运行占用该会话时返回 `409 conversation_busy`。占用覆盖归属鉴权、preflight、技能发现、run 持久化与内存绑定提交；成功后原子移交给 active run，直到运行结束才释放，不能在 preflight 返回后提前释放。preflight 本身不提交新绑定；数据库写入成功后才提交内存绑定，失败时释放创建占用且不留下新绑定。若 run 已落库而后续初始化失败，必须将其标记失败并释放占用，保留与持久化记录一致的绑定。`createRunWithSkills` 不得再调用一个重复获取占用的公开 `createRun`；两者复用持有占用的私有流程。该互斥是进程内会话级保护，与 §3.1 的启动独占锁分别实现。

为避免两次查找，`ResolvedRunAgent` 还须携带本轮已校验的 `platformSkills: LoadedSkill[]` 与 `diagnostics: SkillDiagnostic[]`（无 Agent 时均为空）；有 Agent 时由这些条目组装唯一的 `SkillSnapshot`，不可再次扫描或直接把 `ResolvedRunAgent` 当作 snapshot。调用方传入的 `skillPolicy` / `skillSnapshot` 仅在无 Agent 会话中生效；无 Agent 时继续比较既有 policy 与 catalogFingerprint。

#### 5.5.2 Agent 解析顺序

**先校验会话归属，再解析 Agent**：在 §5.5.1 的占用范围内，读取既有上下文及持久化归属。`supabase` 模式要求有效 `auth.userId`，既有会话的 `userId` 必须与之相等，否则返回 `404 conversation_not_found`，不继续查询 Agent、创建 run 或调用模型。Agent 全站可见不代表其使用者的会话可以共享。定时任务使用任务所有者身份，创建/保存任务引用旧会话及执行时都执行此检查；local 模式按单用户规则放行。历史空属主会话在 supabase 模式下不可自动认领，需运维明确迁移。

归属查询按全局 `conversationId` 查找，不能先按当前用户过滤后把他人会话误判为新会话。首次成功创建 run 固定会话所有者，后续不得覆盖；内存上下文记录 `userId`，数据库恢复同时返回它。升级时若同一 ID 已存在多个不同 `userId`，标记为归属冲突并拒绝恢复，由运维处理，不得仅采用最近一条的用户作为所有者。

**显式值 → 会话既有绑定 → 无 Agent**，且第三步只在会话确实没有历史时才允许：

1. `requestedAgentId` 存在 → 使用它。
2. 否则读会话既有绑定（内存 `skillContexts`，未命中再查 `runStore.getLatestByConversation`）。有绑定则**继承**；既有绑定的值本身就是 `null`（旧的无 Agent 会话）时，视为「显式继承 null」。
3. 会话完全没有历史 → `agentId: null`（新会话的合法起点）。

**关键不变量：解析结果永远不能把已有绑定降级为 `null`。** 任何入口（含 `/api/tasks`、定时任务）省略 `agentId` 时，都只能继承，不能清空。这是评审指出的问题根源：旧设计中 `createRun` 的默认策略会让绑定会话跑成无 Agent。

#### 5.5.3 校验顺序

1. 先按 §5.5.2 得到最终 `resolvedAgentId`。只要它非 `null`，无论来自显式参数还是会话继承，都必须重新查库并执行同一套权限与状态检查；内存缓存的绑定不能替代本轮查库：
   - 不存在 → `404`。
   - 使用服务端认证模式和传入 preflight 的 `auth.userId` 判定当前调用者身份（定时任务使用任务所有者），不得依赖 HTTP request 对象。非作者访问 `draft` → `404`（不泄露存在性）。
   - 若 `constraints.requirePublished === true`，最终 Agent 非 null 时必须存在且为 `published`（无 Agent 任务保持原行为），否则拒绝执行（不存在返回 `404`，draft 返回 `409 agent_not_published`）；该约束也适用于作者及 local 模式。
   - 交互入口作者访问自己的 `draft` → **放行**（含已有历史的会话），见 §3.3 草稿调试语义；不存在按轮次拒绝作者的规则。
   - 继承的 Agent 已删除时同样返回 `404`，不得降级为无 Agent 或继续使用缓存；检查失败不创建 run、不更新会话绑定、不启动模型。
2. 会话绑定校验（内存 + DB 恢复值）：
   - 解析出的 `agentId` 与既有绑定不一致（含「有 → 无」「无 → 有」）→ `409 agent_changed`。
3. 读取绑定的 Skill 列表 → `registry.listPlatform(rows)`。任一技能 `state !== "ready"` 或目录缺失 → `500 agent_skills_unavailable`，**不静默降级为空技能集**。
4. 计算 `agentFingerprint`（§5.4 公式；无 Agent 时为哨兵 `"none"`），再与既有会话指纹及 `constraints.expectedAgentFingerprint`（若提供）分别比较；任一不一致 → `409 agent_context_changed`。必须先完成技能完整性校验，再计算和比较内容指纹。
   - **固化字段完整性先于指纹比较**：`constraints.requireFrozenAgentFields === true` 时，若最终解析出的 `agentId` 非 `null`，且（`frozenAgentFieldsPresent !== true` 或 `expectedAgentFingerprint` 缺失），直接拒绝并记 `agent_frozen_fields_missing`（`retryable: false`），不得因为「解析结果恰好通过」而放行。该判定必须在第 1–2 步完成后、第 3 步技能读取之前执行，否则「payload 无指纹 + 会话继承到 Agent」这一组合会被 `expectedAgentFingerprint === undefined` 的跳过逻辑静默放过，正是 §5.5.4 想要禁止的情形。
5. 技能策略：有 Agent 时固定为 `{ mode: "selected", skillIds }`（此处为 §5.2 转换后的运行时名称，非绑定表 UUID），忽略调用方传入的 `skillPolicy`；无 Agent 时沿用现有行为（`/api/runs` 默认 `auto`，`/api/tasks` 默认 `disabled`）。
6. `workingDirectory` 仍由调用方提供（沿用现有项目工作区语义）。
7. 写入 `runs.agentId` / `runs.agentFingerprint`。

#### 5.5.4 非 HTTP 入口的 Agent 语义

- `POST /api/tasks` 请求体新增可选 `agentId`。不传时按 §5.5.2 从 `conversationId` 继承；错误映射与 `/api/runs` 一致（`routes/tasks.ts` 目前只捕获 `ConversationBusyError`，需补齐 `agent_changed` / `agent_context_changed` 的映射）。
- **定时 service 任务**：`ScheduledTask.payload` 固化**两项**，缺一不可：
  - `agentId`：任务创建时解析并写入。
  - `agentFingerprint`：任务创建时按 §5.4 公式计算并写入。**只存 `agentId` 无法检测内容变更**——每次执行往往新建会话，没有历史 run 可供比较，指纹校验会直接通过。

  执行时把两者一起交给 `preflight`，并由服务端强制 `requirePublished: true`，规则如下：

  | 校验 | 不一致时 |
  |---|---|
  | Agent 存在 | `404`，记录失败 |
  | `status === "published"` | **必须**，`draft` 返回 `agent_not_published`（作者本人也不行）。无人值守任务不应运行未发布内容 |
  | 当前指纹 == payload 存的 `agentFingerprint` | `agent_context_changed`，记录失败 |

  三者任一失败都不创建 run、不写会话绑定、不自动重试；执行记录的 `error` 写明具体原因。

  **不可重试结果必须贯通调度层**：`ExecutionResult` 增加服务端生成的 `errorCode?: string` 与 `retryable?: boolean`。Agent 不存在、无访问权限、未发布、身份/内容不一致、固化字段缺失或会话归属/历史数据校验失败，均由具类型的异常映射为 `retryable: false`；不得通过错误文案匹配或仅凭 HTTP 404 分类。executor 捕获异常时保留结构化结果，`Scheduler.executeWithRetry()` 在首次执行及每次重试返回后检查该标记；由于现有 executor 返回 `TaskExecution`，需将内部返回值改为 `{ execution: TaskExecution, retryable?: boolean }`，scheduler 解包后只向现有外部接口返回 execution，无需新增数据库列。`retryable === false` 时即使 `retryCount > 0` 也立即结束；未设置时保留既有重试策略。显式绑定 Agent 的 payload 缺失固化字段时，在进入通用 service 反射调用前拒绝；省略 Agent、需从会话继承的情形交由 preflight 拒绝，两者均标记不可重试。执行记录保留错误码与说明，禁止客户端覆盖重试分类。

  作者若改了 Agent 想让定时任务用新内容，**必须重新保存任务**以刷新指纹——这是显式行为，不是隐式跟随。
- `TaskService.create(message, conversationId?, userId?, agentId?, constraints?: RunAgentConstraints)` 将 `agentId` 与约束原样传给 `CreateRunOptions`；后者新增 `agentId?: string`、`agentConstraints?: RunAgentConstraints`。runtime 用服务端认证模式与 `options.userId` 构造 `AuthContext` 后调用 preflight。交互路由不接受客户端提供 `agentConstraints`。
- scheduler 创建/保存绑定 Agent 的 service 任务时，以任务所有者身份解析 Agent、校验 published 和目录完整性，服务端计算并覆盖 payload 指纹；不信任客户端上传的指纹。执行器对 Agent service 调用做显式映射：payload 的 `agentId` 作为 `TaskService.create` 的 Agent 参数，`agentFingerprint` 作为 `constraints.expectedAgentFingerprint`，并设置 `requirePublished: true` 与 `requireFrozenAgentFields: true`；不得仅向现有 `payload.args` 尾部追加参数或让通用 service 反射路径丢弃约束。用户身份沿用任务所有者，不从 args 接受覆盖。
- **`app.ts` 的 `taskService` service 包装层必须同步改造**：现有实现按位置解构 `const [message, conversationId] = args.slice(0, -1)` 来剥掉 executor 追加的 `AbortSignal`，`TaskService.create` 增加 `agentId` / `constraints` 参数后，这行不会报错但会**静默丢弃**两者——正是上面禁止的「通用 service 反射路径丢弃约束」。改造要求：包装层按 payload 显式取 `message`、`conversationId`、`agentId`、`agentFingerprint`，`userId` 仍只来自 `currentRunUserId()`，`constraints` 固定为 `{ expectedAgentFingerprint: payload.agentFingerprint, requirePublished: true, requireFrozenAgentFields: true, frozenAgentFieldsPresent: hasFrozenAgentFields(payload) }`；`hasFrozenAgentFields` 由服务端校验 payload 的 `agentId` 与 `agentFingerprint` 均为非空字符串；约束本身不得从 `payload.args` 或请求体读取。验证项须覆盖「payload 携带的约束经 `app.ts` 包装层后仍在 runtime 生效」，且删掉包装层里的 `agentId` 传递会让测试变红。
- 无 Agent 的历史定时任务维持原行为；但只要执行时从会话继承到 Agent，就必须拒绝缺少固化 ID/指纹的任务并提示重新保存，不得自动补齐后执行。绑定 Agent 的 payload 缺少任一字段同样拒绝执行。执行器对**所有** service 任务都传 `requireFrozenAgentFields: true`，判定交给 preflight 在解析之后执行：最终 `agentId` 为 `null` 时该约束无副作用（历史无 Agent 任务照常运行）；最终 `agentId` 非 `null` 而 payload 缺任一项时拒绝，`retryable: false`，错误码 `agent_frozen_fields_missing`。这样无需在 executor 里复制一遍「会话是否已绑定 Agent」的查询，也不存在两处判定漂移。重新保存任务刷新指纹后，若复用的旧会话仍绑定旧内容，仍返回 `agent_context_changed`，需要同时新建会话或移除旧 `conversationId`。

#### 5.5.5 运行时状态

`host-runtime` 中：

- `skillContexts` 条目保留既有 `policy`，扩展为 `{ userId, policy, agentId: string | null, agentFingerprint, catalogFingerprint }`；读取缓存时也必须校验会话归属。
- 新增 `ConversationAgentChangedError` → `409 agent_changed`；现有 `ConversationSkillContextMismatchError` 保留，用于 `agent_context_changed`。
- 服务重启后内存 `skillContexts` 丢失，从 `runStore.getLatestByConversation(conversationId)` 恢复 `{userId, policy: skillPolicy, catalogFingerprint, agentId, agentFingerprint}`，避免重启后静默切换 Agent 或技能集。
- `runStore` 新增 `getLatestByConversation(conversationId)`：按 `createdAt desc` 取首条（现有 `@@index([conversationId, createdAt])` 已覆盖，无需新索引）。该查询必须返回 `userId`、`agentId`、`agentFingerprint`、`skillPolicy` 与 `catalogFingerprint`；另提供按会话检查历史属主是否唯一的查询，首次从 DB 恢复时先检查归属冲突，再采用最近 run 的绑定。
- **历史空值兼容**：仅将持久化的 `(agentId = NULL, agentFingerprint = NULL)` 规范化为 `{ agentId: null, agentFingerprint: "none" }`，表示升级前的普通聊天。不得对所有空指纹统一填充 `"none"`：`agentId` 非空但指纹缺失属于损坏数据，拒绝运行并记录诊断。规范化在统一恢复函数中执行，供所有入口使用；续聊成功后，新 run 写入规范化值。此规范化只处理 Agent 指纹；技能上下文按下面的规则独立恢复。
- **历史技能基线**：已有持久化 `skillPolicy` / `catalogFingerprint` 时完整恢复并比较；内存仍有既有技能上下文时同样必须校验。升级前历史 run 两项均为空且无内存上下文时，旧技能集无法还原，明确接受一次兼容例外：在所有者与 Agent 校验通过后，以首次成功创建续聊 run 时实际解析的 policy / catalogFingerprint 建立基线，随新 run 原子落库；校验或 INSERT 失败不提交基线，落库后模型执行失败仍保留基线。此后包括服务重启均严格校验，不得每次恢复重新建立基线；不声称能检测升级前的技能变化。Agent run 或部分缺失数据不得走此例外。

`generateTitle` 沿用既有 run 的授权路径；`/compact` 作为一次 run 创建，必须经过相同 preflight，不得绕过 Agent 身份、状态和内容校验。

#### 5.5.6 已知遗留

`TaskService.create()` 目前把 `projectId` 硬编码为 `"default"`（`task-service.ts:13`），与发起会话所属项目不一致。这是既有缺陷，不属于本次改动范围；实施时保持原样并记入 README 的已知问题。

### 5.6 新增 API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/agents` | 列表。默认返回 `published` + 自己的 `draft`；`?mine=1` 只返回自己的 |
| `POST` | `/api/agents` | 新建草稿，返回 `{ id }` |
| `GET` | `/api/agents/:id` | 详情（含绑定技能；草稿仅作者可见） |
| `PUT` | `/api/agents/:id` | 更新名称/描述/提示词/绑定技能（`skillIds` 为数据库 UUID，仅作者）；当前为 published 时，合并后的完整配置必须通过发布校验，失败则整次更新不提交 |
| `POST` | `/api/agents/:id/publish` | 校验非空提示词与技能完整性、`bindable`，置 `published` |
| `POST` | `/api/agents/:id/unpublish` | 置 `draft`；语义见 §3.3 |
| `DELETE` | `/api/agents/:id` | 仅作者，级联解绑 `agent_skills`，保留历史 run |
| `GET` | `/api/skills` | **语义变更**：不再按 `workingDirectory` 扫描，改为返回平台技能（`scope: "platform"`） |
| `POST` | `/api/skills` | 上传技能包；路由级 `bodyLimit: 7 MiB` |
| `PUT` | `/api/skills/:id` | 覆盖更新技能内容（仅上传者）；路由级 `bodyLimit: 7 MiB`；校验与落盘顺序见 §5.1 |
| `DELETE` | `/api/skills/:id` | 仅上传者；被引用时 409，引用详情按 §3.3 过滤，不泄露不可见草稿 |
| `POST` | `/api/runs` | 请求体新增可选 `agentId`，解析与校验见 §5.5 |
| `POST` | `/api/tasks` | 请求体新增可选 `agentId`；省略时从 `conversationId` 继承，**不得清空既有绑定** |

`GET /api/skills` 变更的兼容处理：前端历史上用它展示「可用技能」。v1 直接替换语义，旧参数 `workingDirectory` 忽略（不报错），并同步更新 README 与相关测试。

### 5.7 权限实现

放行依据是**服务端认证模式**，不是 `ownerId` 的取值。`ownerId === ""` 只是「这条记录是在 local 模式下创建的」这一历史事实，不能作为授权条件：数据库从 local 切到 Supabase 后，空属主记录若被无条件放行，所有登录用户都会获得这些 Agent 的编辑、发布、删除权限。

```ts
// authMode 来自 AppConfig，随 host-runtime 注入；绝不读 request 对象
type AuthContext = { mode: "local" | "supabase"; userId?: string };

const isLocal = (ctx: AuthContext) => ctx.mode === "local";

const canRead = (agent: Agent, ctx: AuthContext) =>
  isLocal(ctx) ||
  agent.status === "published" ||
  (!!ctx.userId && agent.ownerId === ctx.userId);

const canEdit = (agent: Agent, ctx: AuthContext) =>
  isLocal(ctx) || (!!ctx.userId && agent.ownerId === ctx.userId);
```

- **local 模式**：与当前单用户行为一致，所有 Agent 可见可编辑；此时 `userId` 为空串属于正常情况。
- **supabase 模式**：`ownerId === ""` 的记录**只有 `published` 的可读，且任何人都不可编辑**。这类记录是迁移残留，作者无法认领，需要一次性迁移脚本把已知归属的 Agent 回填 `ownerId`；未回填的仅 published 可读，不允许通过应用接口下线或编辑，需运维迁移后处理。
- `preflight` 收到的就是 `AuthContext`，因此定时任务（无 HTTP request）也能用同一套判定：以任务所有者身份，`mode` 取自服务端配置。

对应的迁移脚本（一次性，部署前执行，非代码路径）：

```sql
-- 仅回填明确归属：按 Agent 名称与已知运维清单手工映射，不做自动推断。
UPDATE agents SET "ownerId" = '<supabase-user-id>' WHERE id = '<agent-id>';
```

执行后统计仍为空的记录，人工确认是保留（只读）还是删除。

## 6. 前端设计

### 6.1 会话归属 Agent

`Conversation` 增加 `agentId?: string`（`conversation-store.ts` 的 `Conversation` 与 `StoredConversation` 两处都要加）。

- **IndexedDB 版本 2 → 3**：`onupgradeneeded` 中不删除任何 store，仅靠读取时的默认值兼容历史数据。历史会话 `agentId` 为 `undefined`，归入「未绑定 Agent」分组。
- 列表与恢复规则：
  - 进入 `/chat`：仅展示 `agentId === undefined` 的会话，可恢复历史消息并继续发送，新建会话保持未绑定；若 URL 指向已绑定会话，则跳转到 `/agents/:id?conversationId=...`，不得省略绑定继续发送。
  - 进入 `/agents/:id`：过滤 `agentId === id` 的会话；**若当前 `conversationId` 属于其他 Agent 或未绑定，立即用 `createUuid()` 重置**，绝不把当前会话带到另一 Agent 下。
  - 从 URL `?conversationId=` 恢复会话时，若该会话的 `agentId` 与当前页面 Agent 不符，丢弃该参数并重定向到新会话，同时提示「该会话属于其他 Agent」。
  - 发送消息时：`conversationId` 与 `agentId` 必须成对取自当前会话记录，**不要**从「当前页面 Agent」临时拼装。
- `/agents/:id/edit` 等非对话页不读写会话。

### 6.2 路由

```
/                     AgentListPage   （首页，含“普通聊天 / 历史会话”入口）
/chat                 ChatView        （未绑定 Agent，支持 ?conversationId= 恢复）
/agents/new           AgentEditPage   （新建）
/agents/:id/edit      AgentEditPage   （作者）
/agents/:id           AgentChatPage   （对话，内部复用现有 ChatView）
/skills                SkillLibraryPage
```

`main.tsx` 从「渲染 `ChatView`」改为 `<Routes>`。`ChatView` 新增可选 `agentId` prop；Agent 页面发送时附带会话记录中的绑定，并隐藏「项目 / 技能选择器」（Agent 已固定技能集）。`/chat` 不发送 `agentId`，保留项目选择；普通聊天的技能发现仍沿用后端 auto 策略，原技能选择器暂不展示，避免将改为平台目录的 `GET /api/skills` 误作三来源技能清单。

### 6.3 列表页

- 卡片：名称、描述、作者（local 模式隐藏）、技能数量、`草稿`/`已发布` 徽标、「对话」按钮。
- 我的 Agent 与已发布 Agent 分两组；空状态引导「新建 Agent」。首页始终提供「普通聊天 / 历史会话」入口到 `/chat`，无 Agent 时也可访问历史聊天。旧首页 `/?conversationId=...` 链接按 IndexedDB 会话绑定重定向至 `/chat` 或对应 Agent 页面；重定向不创建或重绑会话。
- 会话按 `projectId` + `agentId` 双维度挂载；从 Agent 进入时默认使用 `DEFAULT_PROJECT_ID` 工作区，作者可在 Agent 设置里指定默认工作目录（v1 只存前端选择，不进 Agent 表）。

### 6.4 编辑页

- 字段：名称、描述、系统提示词（`Textarea`，带字符计数与上限提示）、技能多选（来自 `GET /api/skills`，只允许选择 `bindable === true`）、保存 / 发布 / 下线 / 删除。
- 未保存离开时 `beforeunload` 提示（最小实现即可）。
- 已发布且有会话时显示 §3.2 的警告。
- 技能列表对 `broken` / `tampered` 或 `disableModelInvocation` 项显示禁用态与原因，不允许选中；保存/发布展示服务端 `skill_not_bindable` 错误。

### 6.5 技能库页

- 列表：名称、描述、文件数、大小、状态、上传时间。
- 上传：`<input type="file" accept=".zip">` → 前端 `FileReader` 转 base64 → `POST /api/skills`。不做客户端解包。
- 前端在上传前拦一道 `file.size > 5 * 1024 * 1024`，给出即时提示；后端仍独立校验（前端不是安全边界）。
- 上传成功后展示 registry 返回的 diagnostics；失败原样展示后端错误文案（`skill_invalid` / `skill_too_large` / `skill_name_taken`）。

## 7. 失败模式与边界

| 场景 | 行为 |
|---|---|
| Agent 绑定的技能目录丢失 / 损坏 / 被篡改 | run 创建阶段 `500 agent_skills_unavailable`，不降级；技能标记 `broken` / `tampered` |
| 已发布 Agent 经 PUT 清空提示词或改为纯空白 | `422 agent_prompt_required`，整个更新不提交，保持原内容与 published 状态；需先显式下线才能保存空白提示词 |
| 作者在会话中途改提示词或技能 | 下一轮 `409 agent_context_changed`，前端引导新建会话 |
| 同一会话切换到内容相同的另一个 Agent | `409 agent_changed`（身份独立校验） |
| 作者下线 Agent | 进行中 run 跑完；非作者新消息 404；作者新消息**放行**（草稿调试语义） |
| 非作者访问 draft Agent | 404（不泄露存在性） |
| 删除被引用的技能 | 409，仅返回可见 Agent 的 ID / 名称；不可见引用只返回存在标记，见 §3.3 |
| 覆盖更新被引用的技能 | 允许（仅上传者）；指纹变化使绑定会话下一轮 `409 agent_context_changed`，定时任务要求重新保存 |
| `tampered` / `broken` 技能恢复 | 上传者重新 `PUT` 同一技能，状态回到 `ready`；无需解绑或删除 Agent |
| 同一技能名重复上传 | 422 `skill_name_taken` |
| zip 解压炸弹 | 条目数 / 解压总量 / 单文件大小三重上限 |
| 上传包接近 5 MiB | 路由级 `bodyLimit` 7 MiB 放行，业务层再按 5 MiB 校验；集成测试覆盖 |
| 落盘 rename 失败 | 不写 DB，清空 staging，返回 500 |
| INSERT 失败（rename 已完成） | 删除 `skills/<id>` 目录补偿，返回 500 |
| 进程在 rename 与 INSERT 之间中断 | 启动清理把无主目录移入 `.orphaned/`，不参与绑定 |
| 进程在解包中中断 | 下次启动取得独占锁后、开放上传前清空 `.staging/` |
| 第二个 backend 实例启动 | 获取独占锁失败，拒绝启动；不得清理另一实例的目录 |
| 省略 `agentId`，继承的 Agent 已下线 / 删除 | 对最终 Agent 重新查库鉴权：非作者 404；作者放行（下线且内容未变）或 404（删除）；仅拒绝时不创建 run |
| 提示词注入越权 | 基础安全提示词前置且声明 `agent_instructions` 不可覆盖；脱敏仍在 `SecretGuard` 层兜底 |
| `/api/tasks` 省略 `agentId` 但会话已绑定 Agent | 按 §5.5.2 继承既有绑定，不降级为无 Agent |
| 定时任务绑定的 Agent 已下线 / 指纹变化 | 执行记录标记失败：`draft` 拒绝执行，指纹不符记 `agent_context_changed`；不自动重试，不切换 Agent |
| 定时任务 payload 缺固化字段，但会话已绑定 Agent | preflight 返回 `agent_frozen_fields_missing`（`retryable: false`），不创建 run；不靠「继承到 null」放行 |
| bash 写到平台目录 | **无法阻止**（残余风险）；指纹校验标记 `tampered`，权限层面靠 `0700` 缓解 |
| 本地模式（`userId=""`） | 单用户等价，所有 Agent 可见可编辑 |
| 跨用户复用 conversationId | supabase 模式返回 `404 conversation_not_found`；不创建 run、不访问模型历史 |
| 并发创建同一会话的首轮 | 同步占用会话，仅一个请求可进入创建流程，其余返回 `409 conversation_busy` |
| 历史 run 的 Agent 两列均为 NULL | 统一恢复为无 Agent 与 `"none"`，允许合法所有者续聊；有 Agent 但缺指纹则拒绝 |
| 服务重启 | 会话属主、Agent 绑定及技能 policy / catalogFingerprint 从最近 run 恢复；适配器实例缓存清空 |
| 历史无 Agent run 缺少完整技能上下文 | 无内存上下文时，首次成功创建续聊 run 建立并持久化技能基线；此后严格校验，部分缺失拒绝恢复 |
| 不可调用技能上传 / 绑定 | 上传成功但 bindable=false；保存绑定或发布时服务端返回 422 skill_not_bindable |
| 定时 Agent 校验失败且 retryCount > 0 | executor 返回 retryable=false，scheduler 停止当前重试链，记录错误码与原因 |

## 8. 实施计划

每步独立可验证，按顺序执行。

### 第 1 步：数据模型与迁移
- 改 `backend/prisma/schema.prisma`：`Agent` / `AgentSkill` / `Skill` / `AgentStatus` / `SkillState`、`Run.agentId`、`Run.agentFingerprint`、`Run.skillPolicy`、`Run.catalogFingerprint`，以及 `Skill.disableModelInvocation`。
- 迁移 `pnpm --filter @antler/server db:migrate -- --name agent_platform`；同迁移内补 `ENABLE ROW LEVEL SECURITY`。
- **验证**：`run-store.test.ts` 覆盖四项上下文的写入、读取与最近 run 恢复；历史 NULL 字段可读取；PGlite 建表通过。

### 第 2 步：平台根隔离与技能加载
- `config/env.ts` 增加 `platformRoot`，启动时校验不在 `ANTLER_WORKSPACE_ROOT` 内。
- `workspace-tools.ts` 的 `workspacePath()` 增加 `platform_path_denied` 拒绝。
- `skills/types.ts` 增加 `"platform"` scope、`PlatformSkillRow` 与 `LoadedSkill.directoryFingerprint`；实现 §5.2 的目录摘要函数与 `SkillRegistry.listPlatform(rows)`，保留 `LoadedSkill.fingerprint` 的文件哈希契约。
- 新增 `backend/src/skills/skill-archive.ts`：base64 → zip → 校验 → staging → rename → INSERT → 失败补偿。
- 新增启动独占锁（§3.1）：先取得数据库锁与平台根文件锁，再进行 self-check、开放 HTTP 和启动调度器；锁失败拒绝启动，持锁连接丢失终止进程。数据库锁必须由独立 `pg.Client` 持有（新增 `pg` 直接依赖），不复用 Prisma 连接池；PGlite 部署跳过数据库锁。
- **锁验证**：Prisma 连接池发生一次扩容 / 重建后锁仍被持有；独立 client 断开后进程退出且不再接受上传；PGlite 场景只依赖文件锁且启动正常。
- **标识转换验证**：使用 UUID 与名称明显不同的技能行；前端/API 以 UUID 绑定，registry 返回名称 ID，selected policy 与 Run 持久化使用名称，模型按名称成功调用 `load_skill` / `read_skill_resource`；缺失绑定项仍被拒绝，状态写回和锁操作使用原 UUID；多技能输入顺序不影响内容指纹。
- **指纹验证**：带资源的正常包可成功 `load_skill` / `read_skill_resource`；相同目录摘要不受枚举顺序影响；仅资源修改、新增、删除或改名也触发 `tampered`，下一轮不创建 run；三来源技能加载回归通过。
- 新增启动 self-check：持锁且未开放上传时先执行 §5.1 的更新恢复，再清空剩余 `.staging`、孤儿目录入 `.orphaned`、标记 `broken` / `tampered`。
- **互斥验证**：实例 A 在解包及 rename 后 INSERT 前分别暂停，启动实例 B；B 必须因锁失败退出，A 的 staging / 最终目录保持完整。另覆盖 A 崩溃后 B 可取得锁并清理遗留，以及数据库锁连接丢失时服务停止。
- **验证**：单测覆盖正常包、多一层包裹目录、`..` 逃逸、符号链接、超限、frontmatter 名不匹配、`SKILL.md` 缺失、rename 失败、INSERT 失败、崩溃遗留 staging 清理；`workspacePath` 对平台根内的路径返回 `platform_path_denied`。

### 第 3 步：提示词装配与适配器上下文
- `system-prompt.ts` 拆 `BASE_SYSTEM_PROMPT` + `buildSystemPrompt`。
- `SkillSnapshot` 增加 `contextFingerprint`（不含 `agentId`）。
- `PiAgentAdapter` 指纹校验改用 `contextFingerprint`；`app.ts` 的 `createAdapter` 接受 `RunAgentContext`，缓存 key 含提示词哈希与 `agentId`。
- **验证**：单测「同 conversationId、不同提示词 → `agent_context_changed`」；「同 agentId 改提示词 → 新适配器实例」。

### 第 4 步：Agent/Skill 路由与权限
- 新增 `routes/agents.ts`、改 `routes/skills.ts`（含路由级 `bodyLimit`，以及 `PUT /api/skills/:id` 覆盖更新与 §5.1 的技能读写锁、run 读租约）。
- `request.antlerUser` 判定作者；draft 对非作者返回 404。
- 提取 publish 与已发布 Agent PUT 共用的发布校验；PUT 校验合并后的完整配置，校验成功后才原子提交字段与技能绑定，失败保持原记录和发布状态。
- **验证**：`agents.test.ts` / `skills.test.ts` 覆盖「不可调用技能上传成功且 ready，但 bindable=false」「绕过前端直接 PUT 绑定或发布不可调用技能 → 422 skill_not_bindable，绑定与发布状态不变」「非作者 PUT → 403」「draft 对他人 GET → 404」「删除被引用技能 → 409」「用户 B 的 draft 绑定用户 A 的技能后，A 删除技能仍为 409，但响应仅含不可见引用标记，不含 B 的草稿 ID / 名称 / 作者 / 数量；published 和自己的 draft 可返回详情，local 模式返回全部可见引用」「6.5 MiB 请求体不触发 413 而是业务 4xx」。
- **发布条件回归验证**：草稿可保存空串与纯空白提示词，但 publish 均返回 `422 agent_prompt_required`；有效提示词发布成功后，PUT 空串或纯空白均返回同一错误，连同请求中的名称、描述及技能绑定改动全部不提交，状态与 `publishedAt` 不变；published PUT 省略提示词时以现有值校验并可正常保存，有效提示词更新后仍为 published；显式下线后可保存空白提示词，再次发布仍被拒绝。
- **技能覆盖更新验证**：`PUT` 同名且内容变化后指纹变化、`state` 回到 `ready`；相同内容重传指纹不变但可恢复状态；`tampered` / `broken` 技能经 `PUT` 恢复可绑定；非上传者 `PUT` → 403；改名或重名 `PUT` → 422；步骤 2/3 之间与步骤 3/4 之间中断后，启动清理分别把操作目录中的 `old` 恢复回 `skills/<id>` / 删除 `old`，且状态判定与 DB 指纹一致；同一技能并发两个 `PUT` 串行执行，不出现交错 rename；用两个不同技能验证操作目录可准确恢复归属；旧目录缺失时 PUT 成功、安装/DB 更新失败后仍可重试；恢复必须先于 staging 清理。
- **描述同步验证**：只修改 frontmatter description 后 PUT，DB 与 GET 列表返回新描述，绑定、发布和新会话 preflight 均通过；请求体 description 与文件不一致返回 422，DB 与原目录不变。
- **读写并发验证**：在两次 rename 之间及 DB 更新前暂停 PUT，并发 preflight、绑定、发布不得读取中间状态或误写 `broken/tampered`；进行中 run 持有读租约时 PUT 等待，工具读取旧内容，run 结束后更新成功、新 run 读取新内容；覆盖 run 初始化/执行失败释放租约、多个技能反向请求无死锁、旧损坏检查不得覆盖 PUT 后的状态。

### 第 5 步：run 链路接入 agentId
- `host-runtime` 新增共用 `preflight()`（§5.5.1），`createRun` 与 `createRunWithSkills` 都走它；移除 `createRun` 中「策略非 disabled 就抛错」的分支。
- `routes/runs.ts` 解析 `agentId`；`TaskService.create()` 与 `CreateRunOptions` 增加 Agent 参数及 `RunAgentConstraints`，透传到接收 `AuthContext` 的 preflight；同步改造 `app.ts` 的 `taskService` service 包装层（见 §5.5.4），并把 `config.authMode` 注入 `AntlerHostRuntime`。
- `routes/tasks.ts` 补齐 `agent_changed` / `agent_context_changed` 的错误映射。
- `ScheduledTask.payload` 增加 `agentId` 与 `agentFingerprint`；创建/保存时由服务端生成指纹，执行器通过显式 service 映射传入预期指纹、`requirePublished`、`requireFrozenAgentFields` 与服务端生成的 `frozenAgentFieldsPresent`，按 §5.5.4 校验。
- `skillContexts` 保留 policy 并增加属主与 Agent 字段；`runStore.getLatestByConversation()` 返回 `userId`、`agentId`、`agentFingerprint`、`skillPolicy`、`catalogFingerprint`，补充历史属主唯一性检查与统一空值规范化。
- 修改 executor 内部结果封装与 scheduler 重试判定，贯通 §5.5.4 的 `errorCode` / `retryable`；保持对外 `TaskExecution` 接口不变。
- 实现 §5.5.1 的会话同步占用、创建失败释放及 active run 占用移交；所有交互与定时入口复用同一内部创建流程。
- **验证**：
  - `runs.test.ts`：「Agent 绑定覆盖 skillPolicy」「同会话换内容相同的另一 Agent → `agent_changed`」「非作者 → 404」「首轮带 agentId、后续省略 → 继承绑定并重新鉴权」「作者在自己 draft Agent 的会话中连续两轮均成功」。
  - `task-service.test.ts` / `routes/tasks.test.ts`：「会话已绑定 Agent 时 `/api/tasks` 省略 `agentId` → 继承」「显式传不同 `agentId` → `agent_changed`」「任务执行后 `runs.agentId` 与上一轮一致」，即证明不存在「无 Agent 的脏 run」写入。
  - 定时任务：`draft` Agent 拒绝执行；payload 指纹与当前指纹不符 → 失败并记 `agent_context_changed`；重新保存并使用新会话后恢复执行；复用旧内容会话仍报错；缺失固化字段时拒绝执行；验证约束通过 executor → `app.ts` service 包装层 → TaskService → runtime 完整传递，且 HTTP 不能关闭约束；另删掉包装层中的 `agentId` 透传做一次反向验证，确认该用例变红（防止静默丢弃）；经真实 `app.ts` 包装层分别覆盖缺 ID、缺指纹、两项全缺但继承 published Agent，均返回 `agent_frozen_fields_missing`、不可重试且无新 run；仅删掉包装层 `requireFrozenAgentFields` 也须使相应用例变红，历史无 Agent 任务仍可执行。
  - 鉴权回归：`/api/runs`、`/api/tasks` 交互入口覆盖「省略 agentId、继承的 Agent 已下线（作者旧会话内容未变则成功、非作者 404）」「继承的 Agent 已删除 → 404」；分别验证内存命中和服务重启后的 DB 恢复路径，失败时无新 run、无模型调用；定时 service 另覆盖下线后作者也以 `agent_not_published` 拒绝。
  - 会话归属：两个用户使用相同 published Agent、模型配置及工作目录，用户 B 复用 A 的会话 ID，显式传 Agent 或省略均返回 404；覆盖内存、重启恢复、`/api/tasks`、定时任务保存/执行路径，验证无新 run、无模型调用。覆盖历史空属主及多属主冲突拒绝恢复，local 单用户行为不变。
  - 并发绑定：在 preflight 查库、技能校验和 run INSERT 处分别暂停，同一新会话并发指定不同 Agent，仅首个请求进入创建流程，另一请求返回 conversation_busy；首轮完成后换 Agent 返回 agent_changed。覆盖同 Agent 并发、运行结束释放、校验/INSERT 失败后重试及落库后初始化失败，不遗留占用或与 DB 不一致的绑定。
  - 历史兼容：构造 Agent 与技能上下文四列均为 NULL 的历史 run，合法所有者升级后可从 `/api/runs` 与 `/api/tasks` 续聊，首次成功续聊建立技能基线，新 run 写入 null / "none" 与 policy / catalogFingerprint；重启后上下文不变可续聊，修改技能或策略则拒绝。校验或 INSERT 失败不提交基线，落库后模型失败仍保留；仅缺一项技能字段、非法 JSON、Agent run 缺技能上下文及非空 agentId 配空指纹必须拒绝；内存已有上下文时继续严格校验。
  - 重试分类：配置 `retryCount > 0`，分别触发 Agent 删除、下线、内容变化、固化字段缺失，以及「payload 缺字段但会话已绑定 Agent」五种情形，确认只有一次执行记录、无后续重试、无新 run 或模型调用；另验证未设置 retryable 的普通失败仍按原策略重试，且历史无 Agent 任务不受 `requireFrozenAgentFields` 影响。
  - 回归：`host-runtime.test.ts` 现有 `createRun` 用例全绿。

### 第 6 步：前端会话归属与路由
- `conversation-store.ts`：`Conversation.agentId`，IndexedDB 版本 2 → 3。
- `main.tsx` 加 `Routes` 与 `/chat`；新增 `AgentListPage` 及普通聊天入口、旧 URL 重定向；`ChatView` 接受 `agentId` 并在页面切换时重置会话。
- **验证**：`app/test` 覆盖「升级后可从首页进入历史会话、显示消息并继续发送且不带 agentId」「旧首页 URL 正确重定向」「/chat 恢复已绑定会话时跳转到对应 Agent 页面」「按 Agent 过滤」「从 Agent A 切到 B 时 conversationId 被重置」「URL 恢复的会话属于其他 Agent 时被丢弃」。

### 第 7 步：编辑页与技能库页
- `AgentEditPage`、`SkillLibraryPage`。
- **验证**：`pnpm check` + 手动走查：上传 zip → 绑定 → 发布 → 另一账号可见并对话。

### 第 8 步：文档与部署
- README 增加 Agent 平台章节、`ANTLER_PLATFORM_ROOT`（必须是工作区之外）、`0700` 权限建议、v1 单实例及锁要求、bash 残余风险。
- `.env.deploy.example` 增加 `ANTLER_PLATFORM_ROOT`。
- 部署脚本把平台根纳入远端保留目录（不随镜像覆盖），并保证容器内属主与权限；采用先停旧实例再启新实例的顺序，不允许滚动重叠运行。
- **验证**：`pnpm check && pnpm test` 全绿；`scripts/deploy-apps-ssh.sh` 至少 dry-run 检查变量合并。

## 9. 待确认

1. **`GET /api/skills` 语义直接替换**：现有调用只在前端，已确认无外部消费者；若有第三方脚本依赖 `workingDirectory` 参数，需要保留兼容层。
2. **Agent 默认工作目录**是否进后端（`agents.workingDirectory`）：当前设计只在前端选择，意味着同一 Agent 在不同用户机器上跑在不同目录。对「全站可用的 Agent」这可能不一致，v1 按最小改动处理。
3. **bash 的 `tampered` 检测代价**：每次 run 前对绑定技能重算指纹，技能含大资源时会多一次全目录读取。v1 保留每轮全量校验，不得以只校验 `SKILL.md` 替代。若实测偏慢，另行设计能保持资源完整性检测的优化方案。


## 10. 实施记录（2026-10-22）

- 最终检查：`pnpm check`、`pnpm test` 通过（前端 127 项、后端 308 项，另 1 项 PostgreSQL 实库测试跳过）；前后端构建与部署脚本 dry-run 通过。

- 已加入 Agent / Skill 模型、RLS 与 `20261022000000_agent_platform` 迁移；迁移使用 schema diff 离线生成并在 PGlite 执行验证，未修改已有开发或部署数据库。启动已有环境前执行 `pnpm --filter @antler/server db:deploy`。
- 平台文件存储、ZIP 校验与覆盖恢复、读写锁和 run 读租约位于 `backend/src/platform/`、`backend/src/skills/`；Agent 路由和平台技能路由均已接入。运行与定时任务共用 preflight，会话四项上下文随 run 持久化。
- 前端首页、编辑器、技能库和 Agent 聊天路由已接入；普通聊天入口与历史 URL 迁移保留。新增测试集中在 `backend/test/platform/` 和 `app/test/`。
- 已验证真实 `app.ts` 定时包装层透传。分别临时移除 Agent ID、关闭 `requireFrozenAgentFields`，对应回归测试均失败；随后恢复实现并重新验证。
- 浏览器本地走通：ZIP 上传 → 新建 Agent → 绑定技能 → 保存 → 发布 → Agent 对话 → 新建会话 → 普通聊天入口。使用独立 PGlite、临时平台目录和本地替身模型；跨用户权限由集成测试验证，未使用真实账号或模型凭据。
- 文件锁覆盖活跃实例互斥、崩溃后操作系统释放；独立 pg client 的 error / end / heartbeat 故障已做模拟验证。`ANTLER_TEST_POSTGRES_URL` 可开启专用测试数据库上的 Prisma 池重建锁验收，未配置时该项明确跳过，不代表 PostgreSQL 部署验收已完成。
- 部署脚本支持 `DEPLOY_DRY_RUN=1`，已验证环境合并和持久化配置；未执行远端部署或 Docker 镜像构建。平台根仅允许已识别的本地 POSIX 文件系统；未知或网络文件系统拒绝启动。

### 内置智能体

服务启动时自动幂等创建已发布的“默认助手”和“股票分析师”，使用固定 ID 保留会话绑定。所有用户可见、可对话；内置项不可编辑、下架或删除，列表单独展示“内置 Agent”。两者默认不绑定平台技能，股票分析师提示词要求核实数据来源与时间、区分事实与推断。无需额外数据库迁移。

### 会话入口简化

移除项目管理、项目分组、种子项目初始化和“普通聊天 / 历史会话”入口，所有新会话从 Agent 页面进入，历史按 Agent 展示。工作目录由 Agent 本地配置提供。旧 `/chat` 和首页会话链接仅在已绑定 Agent 时恢复到对应页面，否则返回 Agent 列表；保留旧未绑定会话数据，不自动改绑。前端不再持久化或发送 projectId，运行 API 不再要求该参数；后端旧数据库列暂留以兼容历史记录，无需迁移。

### 启动测试的存储隔离修复

退出信号测试曾只隔离数据库与工作区，未设置 `ANTLER_PLATFORM_ROOT`。子进程因此使用项目默认 `.antler-platform`；开发服务正在运行时，非阻塞排他文件锁获取失败，启动日志出现 `EAGAIN`（`fs-ext` 的 syscall 字段可能显示为 `EIO_After`）。本次已通过直接获取同一锁复现，并用 `lsof` 确认锁由现有后端持有。

修复：退出测试、鉴权隔离测试和真实适配器定时任务集成测试均在自己的临时根下分别使用 `workspace/` 和 `platform/`，显式传入两个环境变量，测试结束后统一清理。平台目录必须位于工作区之外。集成测试以及新增启动子进程的测试都应隔离数据库、工作区和平台目录，不能只覆盖 `ANTLER_WORKSPACE_ROOT`。

实际部署遇到相同错误时，先用 `lsof <平台目录>/.lock` 检查持有者；同一平台存储只允许一个实例，更新应先停旧实例再启动新实例。不要删除活跃锁文件或绕过锁；需要并行的独立实例时，应配置独立的平台目录、工作区与数据库。

验证：`pnpm check`、`pnpm test` 通过（前端 112 项、后端 310 项，另 1 项跳过）。SIGINT、SIGTERM 两项退出测试通过，验证时开发服务仍在运行。
