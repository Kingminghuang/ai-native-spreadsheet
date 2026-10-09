# AI-native Spreadsheet 实施工作流

从 `docs/proposal.md` 的产品规格出发，按依赖顺序交付可工作的 Table-first、Agent-native Spreadsheet，并在 Linear 看板中跟踪每个实现任务。流程采用 Moxt 多 Agent Workflow 的阶段、角色、交付物、完成条件、接力和人工决策节点组织方式。

- 产品规格：[proposal.md](proposal.md)
- Linear Project：[ai-native-spreadsheet](https://linear.app/lvbingwu123/project/ai-native-spreadsheet-3d1ad5a4222a)（Project ID：`P-LVB-6`）
- Agent instruction 索引：[agents/README.md](../agents/README.md)

## 目标与范围

推荐交付顺序为 P1 → P2 → P3 → P4 → P5。P1–P5 覆盖 proposal 中的 MVP 能力；P3 先完成基本的 Agent 修改预览闭环，P4 再打通包含计算、衍生表和图表的完整 vertical slice。P6 是 MVP 之后、仅在产品需要多人/多设备/离线协作时启动的后续阶段。

当前不预设未决组件的技术栈、负责人或交付日期；已确定或暂定的技术选型如下：

| 组件 | 选型 | 边界与依据 |
| - | - | - |
| Spreadsheet UI | **React + TypeScript + Glide Data Grid（Grid 暂定）** | React + TypeScript 作为 UI 基础，Glide 负责 Table 的交互和渲染，不持有权威数据。与 Univer 的比较验证见 Linear 前置 issue [LVB-98](https://linear.app/lvbingwu123/issue/LVB-98/p3-前置验证对比-glide-data-grid-与-univer)，完成后依据结果确认或调整 Grid 选型。Workbook、Table、Field、Row、Calculation、Transform、Revision、Transaction 与 Lineage 等语义和状态仍由本项目的领域模型及 WorkbookService 管理。选型依据见 [Spreadsheet_UI.md](Spreadsheet_UI.md)。 |
| 应用宿主 | **嵌入 DeepSeek Harness Plugin** | Spreadsheet UI 作为 Harness 插件客户端嵌入；Harness 管理 Agent、Session、工具运行和权限，WorkbookService 保持独立并拥有 Spreadsheet 领域状态。插件包结构依据见 [proposal.md](proposal.md) §9–11。 |
| Workbook 持久化 | **Workbook Bundle：JSON 元数据 + Parquet 表数据** | 作为 MVP 的可移植持久化边界；数据库后端可在需要时演进，但不改变 Workbook Bundle 的领域边界。选型依据见 [proposal.md](proposal.md) §49。 |
| Workbook Domain / Bundle 初始实现 | **TypeScript（Node.js ESM）** | 在仓库引入一个独立的 Workbook 核心包，沿用 UI 的 TypeScript 语义类型；Node.js 是当前文件 Bundle 适配器的本地运行时选择，不预设最终 Harness 服务宿主。 |
| Parquet I/O 初始适配器 | **hyparquet-writer + hyparquet** | 将读写封装在独立适配器后使用；Bundle manifest 与稳定 ID 合约不依赖该库。只写入能无损往返的字段类型，未支持的类型明确报错。 |
| 计算引擎 | **DuckDB（运行宿主待验证）** | 用于 MVP 所需的结构化查询和分析运算；WorkbookService 仍负责领域校验、事务、Revision 与权威状态。Harness host/service 与插件 client/WASM 的运行位置由 Linear 前置 issue [LVB-99](https://linear.app/lvbingwu123/issue/LVB-99/p2-前置验证确认-duckdb-在-harness-插件中的运行宿主) 验证后确认。选型方向见 [proposal.md](proposal.md) §9、§56。 |
| Computed Field 表达式 | **字段引用 DSL** | MVP 提供有限的字段引用表达式，并解析为使用稳定 Field ID 的计算 AST；不追求完整 Excel 公式兼容。具体文法、运算符和函数范围由 [LVB-81](https://linear.app/lvbingwu123/issue/LVB-81/实现-filter-sort-computed-field-与计算依赖) 明确。 |
| 图表规格与渲染 | **Vega-Lite 规格；渲染器待定** | 图表以 Vega-Lite 声明式规格保存；具体渲染器留到 [LVB-88](https://linear.app/lvbingwu123/issue/LVB-88/实现-vega-lite-chart-spec-与图表操作) 实现时决定。 |

执行 issue 时，先检查仓库实际状态和本节已确定的选型，再按 issue 的范围实施；不要在实现中悄悄替换已确定的技术选型。若发现选型无法满足验收标准，先补充验证和决策，再更新本节及相关产品规格。

### 技术试验与前置 issue

若实现依赖尚未验证的技术能力，或需要在多个候选方案间做试验比较，必须先在 Linear 为该试验创建独立的前置 issue，并将依赖此结论的实现 issue 设为该试验 issue 的后继任务。前置 issue 应说明待验证的问题与假设、候选方案（如有）、验证方法、通过标准，以及可供后续决策复核的结果和证据。

试验 issue 完成后，记录选型结论及其依据，并更新本工作流的技术选型表；必要时同步更新 `docs/proposal.md` 或相关设计说明。只有前置验证完成、依赖解除且实现范围明确后，才将依赖它的实现 issue 移入 **Todo**。不得把尚未验证的技术假设当作已确定选型直接推进实现。

## Linear 状态流转

所有新建 issue 初始放在 **Backlog**。按以下状态推进：

1. **Backlog**：已拆分，等待依赖或排期。
2. **Todo**：前置任务已完成，输入、验收标准和实现范围已清楚，可以开始。
3. **In Progress**：对应 Agent 正在实现一个有明确范围的 issue。
4. **In Review**：实现者已给出验收证据，由 Integration and Review Agent 或人工 reviewer 对照完成标准检查。
5. **Done**：验收标准满足，代码、规格或决策产物已交付。
6. **Canceled**：确认不再做；关闭前说明原因、当前进展和未来重启条件。

Linear 团队没有单独的 Blocked 状态。受阻 issue 留在 Backlog/Todo，并用 issue dependency 记录阻塞项；解除后再移入 Todo。不要开始仍被前置 issue 阻塞的实现任务。P6 issues 保持 Backlog，直到有人确认协作需求进入产品范围。

## 阶段执行职责

### P1｜Spreadsheet Core：领域模型与存储

**目标：** 先定好 Table-first 领域模型、稳定语义 ID、Workbook 持久化格式和 revision 快照。

**Agent：** Domain Model Agent — [instruction](../agents/domain-model.md)

**Linear 阶段：** [LVB-72](https://linear.app/lvbingwu123/issue/LVB-72/p1spreadsheet-core领域模型与存储)

**执行 issue：**

- [LVB-77](https://linear.app/lvbingwu123/issue/LVB-77/定义-workbook-page-table-field-row-与稳定语义-id) — 定义 Workbook / Page / Table / Field / Row 与稳定语义 ID
- [LVB-78](https://linear.app/lvbingwu123/issue/LVB-78/实现-workbook-bundle-持久化与导入读取边界) — 实现 Workbook Bundle 持久化与读取边界
- [LVB-79](https://linear.app/lvbingwu123/issue/LVB-79/建立-workbook-revision-快照与历史读取模型) — 建立 Revision 快照与历史读取模型

**完成条件：** Schema、Calculation、Transform、View、Lineage/Revision 边界清晰；内部关系通过稳定 ID 表达；Workbook 能持久化并读取一致的历史 revision。

**交接：** Domain Model Agent 把数据模型、持久化和 revision 合约交给 Operations Agent。人工在 P1 收尾时确认语义对象和存储边界。

### P2｜Operations：查询与 Typed Operations

**目标：** 提供 UI 和 Agent 共用的受校验查询、修改服务和 MVP 基础计算操作。

**Agent：** Operations Agent — [instruction](../agents/operations.md)

**Linear 阶段：** [LVB-73](https://linear.app/lvbingwu123/issue/LVB-73/p2operations查询与-typed-operations)

**执行 issue：**

- [LVB-80](https://linear.app/lvbingwu123/issue/LVB-80/实现-workbook-inspect-与-table-query-查询工具) — 实现 `workbook_inspect` 与 `table_query`
- [LVB-95](https://linear.app/lvbingwu123/issue/LVB-95/实现-table-apply-与基础-typed-operations) — 实现 `table_apply` 与基础 Typed Operations
- 前置验证：[LVB-99](https://linear.app/lvbingwu123/issue/LVB-99/p2-前置验证确认-duckdb-在-harness-插件中的运行宿主) — 确认 DuckDB 在 Harness 插件中的运行宿主；完成并确认结论后解除对 LVB-81 与 LVB-87 的阻塞
- [LVB-81](https://linear.app/lvbingwu123/issue/LVB-81/实现-filter-sort-computed-field-与计算依赖) — 实现 Filter / Sort / Computed Field

**完成条件：** Agent 通过 typed operations 和稳定 ID 查询/修改 Workbook；输入和约束经 WorkbookService 校验；UI Context 不代替实际数据查询。

**交接：** Operations Agent 提供稳定的查询、操作、错误和结果合约给 Spreadsheet UI 与 Harness Runtime Agents。

### P3｜Agent WYSIWYG：上下文、工具与预览闭环

**目标：** 形成 Spreadsheet 内的 Selection + Ask AI 使用路径，让用户能看见并控制 Agent 变更。

**Agents：** Spreadsheet UI Agent — [instruction](../agents/spreadsheet-ui.md)；Harness Runtime Agent — [instruction](../agents/harness-runtime.md)

**Linear 阶段：** [LVB-71](https://linear.app/lvbingwu123/issue/LVB-71/p3agent-wysiwyg上下文工具与预览闭环)

**执行 issue：**

- 前置验证：[LVB-98](https://linear.app/lvbingwu123/issue/LVB-98/p3-前置验证对比-glide-data-grid-与-univer) — 对比 Glide Data Grid 与 Univer；完成并确认结论后解除对 LVB-84 的阻塞
- [LVB-84](https://linear.app/lvbingwu123/issue/LVB-84/构建-table-first-spreadsheet-主工作区与-grid-projection) — 构建 Table-first 主工作区与 Grid Projection
- [LVB-82](https://linear.app/lvbingwu123/issue/LVB-82/冻结-selection-context-并绑定-workbook-harness-session) — 冻结 Selection Context 并绑定 Workbook Harness Session
- [LVB-83](https://linear.app/lvbingwu123/issue/LVB-83/接入-harness-工具并实现-ask-ai-object-actions-agent-dock) — 接入 Harness 工具、Ask AI、Object Actions、Agent Dock
- [LVB-85](https://linear.app/lvbingwu123/issue/LVB-85/实现操作-preview-apply-discard-undo-与风险提示) — 实现 Preview / Apply / Discard / Undo 与风险提示
- [LVB-86](https://linear.app/lvbingwu123/issue/LVB-86/呈现-spreadsheet-原生-tool-result-与-lineage-预览) — 呈现原生 Tool Result 与 Lineage 预览

**完成条件：** UI 以结构化 Table 为对象；每次 Agent 任务带冻结的 selection/revision context；修改先进入可视 Preview；用户可 Apply、Discard 或 Undo；高风险修改显示影响范围。

**交接：** 人工确认交互、风险提示和 Apply 行为后，Transform and Visualization Agent 扩展到派生分析与图表。P3 的简单修改场景不要求先实现完整多 Agent 编排。

### P4｜Transform + Chart：衍生分析与可视化

**目标：** 完成 MVP 核心分析变换、图表、Lineage，并跑通规格中的首条完整产品路径。

**Agents：** Transform and Visualization Agent — [instruction](../agents/transforms-visualization.md)；Integration and Review Agent — [instruction](../agents/integration-review.md)

**Linear 阶段：** [LVB-74](https://linear.app/lvbingwu123/issue/LVB-74/p4transform-chart衍生分析与可视化)

**执行 issue：**

- [LVB-87](https://linear.app/lvbingwu123/issue/LVB-87/实现-aggregate-join-lookup-transform-与-derived-table) — 实现 Aggregate / Join / Lookup 与 Derived Table（依赖 LVB-81；LVB-99 宿主能力验证完成前保持阻塞）
- [LVB-88](https://linear.app/lvbingwu123/issue/LVB-88/实现-vega-lite-chart-spec-与图表操作) — 实现 Vega-Lite Chart Spec 与图表操作
- [LVB-89](https://linear.app/lvbingwu123/issue/LVB-89/记录计算依赖transform-lineage-与-agent-provenance) — 记录计算依赖、Transform Lineage 与 Agent Provenance
- [LVB-91](https://linear.app/lvbingwu123/issue/LVB-91/打通-mvp-首条-vertical-slice毛利率-周汇总-趋势图) — 打通毛利率 → 周汇总 → 趋势图 vertical slice

**完成条件：** 从 Orders 的 `revenue` 和 `cost` 生成毛利率、按周汇总销售额、创建趋势图；整条变更链可预览后一次提交；revision 和 lineage 可追溯。

**交接：** Integration and Review Agent 对照 proposal §55 给出验收证据。人工确认首条端到端路径后，进入 Multi-Agent 并发能力。

### P5｜Multi-Agent：事务隔离与 Proposal-first 合并

**目标：** 允许多个 Agent 并行分析，但由 WorkbookService 统一验证、合并和提交。

**Agents：** Transaction and Concurrency Agent — [instruction](../agents/transaction-concurrency.md)；Harness Runtime Agent — [instruction](../agents/harness-runtime.md)

**Linear 阶段：** [LVB-75](https://linear.app/lvbingwu123/issue/LVB-75/p5multi-agent事务隔离与-proposal-first-合并)

**执行 issue：**

- [LVB-90](https://linear.app/lvbingwu123/issue/LVB-90/实现-proposal-transactionsnapshot-与-readset-writeset) — 实现 Proposal Transaction、Snapshot 与 ReadSet / WriteSet
- [LVB-92](https://linear.app/lvbingwu123/issue/LVB-92/实现语义冲突检测rebase-与-commit-result) — 实现语义冲突检测、Rebase 与 Commit Result
- [LVB-93](https://linear.app/lvbingwu123/issue/LVB-93/实现-proposal-first-subagents-与-transaction-coordinator) — 实现 Proposal-first Subagents 与 Transaction Coordinator

**完成条件：** Subagents 默认产出 proposals；每个 proposal 绑定 base revision 并提供资源读写集；协调器能检测冲突、rebase 兼容变更，并将 Apply All 作为原子提交。

**交接：** 该阶段完成 MVP 的 proposal 并发路径。只有产品决定支持多人、多设备或离线协作后，才转向 P6。

### P6｜Collaboration（MVP 之后，按需启动）

**目标：** 评估轻量协作状态；不是当前 MVP 的前置或阻塞项。

**Agent：** Collaboration Agent — [instruction](../agents/collaboration.md)

**Linear 阶段：** [LVB-76](https://linear.app/lvbingwu123/issue/LVB-76/p6collaborationmvp-之后按需启动)

**执行 issue：** [LVB-97](https://linear.app/lvbingwu123/issue/LVB-97/按需评估轻量-collaboration-state-与-crdt-边界mvp-后) — 按需评估轻量 Collaboration State 与 CRDT 边界

**启动条件：** 产品明确提出多用户、多设备或离线编辑需求后，先完成一致性需求和架构评估，再决定是否进入实现。CRDT 只考虑 Cursor、Presence、Comment、Annotation、轻量 View Metadata 等协作状态；Workbook Domain State 保持事务/Revision 模型。

## Agent 角色与交接

| Agent | 主要职责 | 对应 instruction |
| - | - | - |
| Domain Model Agent | 领域对象、Schema、持久化、Revision | [agents/domain-model.md](../agents/domain-model.md) |
| Operations Agent | WorkbookService 查询、Typed Operations、Computed Field | [agents/operations.md](../agents/operations.md) |
| Spreadsheet UI Agent | Table-first UI、Selection、Preview、Apply、Undo、结果渲染 | [agents/spreadsheet-ui.md](../agents/spreadsheet-ui.md) |
| Harness Runtime Agent | Agent Session、Harness 工具、上下文与任务生命周期 | [agents/harness-runtime.md](../agents/harness-runtime.md) |
| Transform and Visualization Agent | Transform、Derived Table、Chart、Lineage | [agents/transforms-visualization.md](../agents/transforms-visualization.md) |
| Transaction and Concurrency Agent | Proposal、Read/Write Set、冲突检测、Rebase、原子提交 | [agents/transaction-concurrency.md](../agents/transaction-concurrency.md) |
| Integration and Review Agent | Vertical Slice 集成与验收证据 | [agents/integration-review.md](../agents/integration-review.md) |
| Collaboration Agent | 后续轻量协作状态评估 | [agents/collaboration.md](../agents/collaboration.md) |

这些 Markdown 是可复用的角色 instruction，不代表已经启动或注册了常驻 Agent。后续执行 Linear issue 时，Codex 应读取 issue 描述、对应 instruction、关联的 `docs/proposal.md` 章节和本仓库现状，再按该角色推进。涉及同一文件的任务不应并行修改。

## 后续 Codex 执行方式

每次从看板挑一个可执行 issue，使用对应角色 instruction。示例：

> 实现 Linear issue LVB-80。先读取 `docs/workflow.md`、该 issue 和 `agents/operations.md`，再阅读 issue 指定的 `docs/proposal.md` 章节。检查仓库当前实现和技术栈后，按验收标准完成这个 issue；只修改本 issue 范围，完成后总结改动、验收证据和剩余风险。

如果工作独立且文件不重叠，可以让 Codex 按 instruction 拆分子任务；多个 Agent 不得直接并发提交同一 Workbook，P5 的 Transaction Coordinator 完成前统一采用 proposal-first 思路。

## 设计参考

工作流的阶段、角色分工、阶段完成条件、Agent 接力及人工决策点参照 [Moxt Multi-Agent Orchestration](https://moxt.ai/zh-CN/multi-agent-orchestration)。
