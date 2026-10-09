# AI-native Spreadsheet 产品设计说明书

> 基于 DeepSeek Harness Plugin 的 Table-first 智能表格应用

**状态**：Draft  
**目标版本**：MVP / V1  
**核心定位**：Table-first AI-native Spreadsheet  
**Agent Runtime**：DeepSeek Harness  
**核心原则**：

> **Selection is context.  
> Natural language is intent.  
> Tool calls are edits.  
> Preview is the answer.**

---

# 1. 产品概述

本产品是一款以 **结构化 Table 为核心数据对象**、以 **AI Agent 为一等交互主体** 的智能 Spreadsheet。

它不是传统 Excel 式：

```text
Workbook
  └─ Sheet
      └─ Cell
```

而采用：

```text
Workbook
  └─ Page
      ├─ Table
      │   ├─ Field
      │   └─ Row
      ├─ Chart
      ├─ Text / Analysis
      └─ Other View Elements
```

核心对象是：

```text
Table → Field → Row
```

而不是：

```text
Sheet → Cell
```

传统 Cell Grid 仍然作为用户编辑 Table 的一种 UI projection 存在，但不作为整个系统的底层语义模型。

---

# 2. 产品目标

产品需要同时满足四类需求：

## 2.1 普通 Spreadsheet 能力

用户无需 AI，也可以完成：

- 创建和删除 Table
- 新增、修改、删除 Row
- 新增、修改、删除 Field
- 数据类型与约束配置
- 排序
- 筛选
- 数据录入
- 批量编辑
- Table / Chart 管理
- 简单公式
- 导入 CSV / XLSX / PDF / Image
- 导出数据

---

## 2.2 数据分析能力

包括：

- Quick Stats
- Formula
- Aggregate
- Slice
- Join
- Append
- Lookup
- Dedup
- Reconcile
- Pivot
- Cohort Analysis
- Predictive Analysis
- Inferential Analysis
- Multivariate Analysis

---

## 2.3 AI 数据处理能力

包括：

- Classify
- Extract
- Enrich
- AI Computed Field
- Image → Table
- PDF → Table
- Schema inference
- 数据清洗
- 异常检测
- 自动创建图表
- 自动生成分析结果

---

## 2.4 Agent 原生能力

Agent 不只是回答问题，而需要能够：

- 理解当前 Spreadsheet 上下文
- 查询数据
- 修改 Table
- 创建 Derived Table
- 修改 Schema
- 添加计算字段
- 执行 Transform
- 创建 Chart
- 执行多步骤分析
- 调度多个 Subagent
- 对修改进行 Preview
- 处理冲突
- 回滚 / Undo
- 展示 Lineage

---

# 3. 核心设计原则

## 3.1 Table Schema ≠ Spreadsheet Format

Table Schema 负责：

```text
Table semantic schema
```

包括：

- Field
- Type
- Format
- Constraint
- Primary Key
- Foreign Key
- Enum
- Metadata

但不负责：

- Workbook
- Page
- Chart
- Cell style
- Layout
- Transform
- Formula graph
- AI operation
- Revision
- Lineage

因此：

```text
Table = Table Schema
```

而不是：

```text
Spreadsheet = Table Schema
```

Table Schema 描述 Table 与 Field 的结构，不包含 Row 的实际数据值；Row 是按 Table Schema 解释的独立记录。Workbook/Page 及其布局属于 Workbook / View Spec，字段计算、数据变换和来源追踪分别属于 Calculation、Transform、Lineage / Revision Spec。

---

# 4. Smart Spreadsheet Format

整个 Workbook 建议由五类 Specification 构成。

```text
Smart Spreadsheet
│
├── 1. Table Schema
│
├── 2. Calculation Spec
│
├── 3. Transform Spec
│
├── 4. Workbook / View Spec
│
└── 5. Lineage / Revision Spec
```

---

## 4.1 Table Schema

描述：

```text
Table
Fields
Types
Constraints
Keys
Relations
```

示例：

```json
{
  "id": "tbl_orders",
  "name": "orders",
  "fields": [
    {
      "id": "fld_revenue",
      "name": "revenue",
      "type": "number"
    },
    {
      "id": "fld_cost",
      "name": "cost",
      "type": "number"
    }
  ]
}
```

`Table` 是 Workbook 中独立的语义数据对象；`Table Schema` 定义它的字段和关系。Table 的 `id` 是稳定身份，`name`、`description` 和 `metadata` 是可修改属性。`fields` 数组的顺序可用于默认展示顺序，但不能作为字段身份或依赖引用。

每个 `Field` 至少有稳定 `id`、可修改 `name` 和逻辑 `type`，并可带有 `title`、`description`、`format`、`constraints` 和扩展 `metadata`。`constraints.enum` 表示字段允许的枚举值；`constraints` 还可表达 required、minimum、maximum、unique、长度等值约束。类型描述逻辑值，不由 CSV、Parquet 或其他物理存储表示决定。`number` 接受已有 JavaScript 有限 number（包含 `1e16`、`1e21`、`1e300`），`integer` 限于 ±(2^53−1) 的安全整数；NaN/Infinity 一律拒绝，DOUBLE 不承诺恢复进入 JavaScript 前已经丢失的整数精度。JSON 容器使用 plain 或 null prototype、自有可枚举数据属性和稠密数组；不接受会在序列化时转换/丢失的 Date、Map、类实例、undefined、bigint、typed array、getter 等值。

`constraints.pattern` 使用有界无回溯语法子集：字面量、字符类、`.`、`^`、`$`、`*`、`+`、`?` 和单字符转义。分组、alternation、lookaround、backreference、counted/lazy quantifier 在执行前拒绝；匹配受长度与计算步数预算限制，超限产生校验问题。具体预算与迁移说明见 [Workbook Core README](../packages/workbook-core/README.md)。

主键与外键都按 Field ID 引用字段；外键同时按 Table ID 引用目标表。联合键按有序 Field ID 列表表达，外键的规范属性为 `fields` / `reference.fields`（内容是 Field ID，不能使用旧草案实现的 `fieldIds` 形状）：

```json
{
  "primaryKey": ["fld_order_id", "fld_line_no"],
  "foreignKeys": [
    {
      "fields": ["fld_customer_id"],
      "reference": {
        "tableId": "tbl_customers",
        "fields": ["fld_id"]
      }
    }
  ]
}
```

`Row` 是按 Table Schema 解释的独立数据记录，不属于 Schema 本身。它包含稳定 `id` 和按 Field ID 索引的逻辑值；字段值不靠列名、数组下标或行号定位：

```json
{
  "id": "row_01J...",
  "values": {
    "fld_order_id": 1001,
    "fld_customer_id": 42,
    "fld_revenue": 99.5
  }
}
```

这些片段定义逻辑领域形状，不规定 Workbook Bundle 的文件拆分、编码或读写流程。

其中内部引用必须优先使用：

```text
tableId
fieldId
rowId
```

而不是：

```text
Sheet1!A:A
B2
C5
```

`name`、`title` 和 `description` 是可修改的语义/展示元数据，不是身份。需要持久化的内部关系（例如 Calculation 的字段依赖、Transform 输入、主外键、View 对 Table 的引用）保存稳定 ID。表达式编辑界面可以接受字段名，但解析后的 Calculation Spec 必须保存 Field ID。

---

# 5. Calculation Spec

Calculation Spec 描述计算关系。

MVP 的 Computed Field 提供字段引用表达式 DSL，不实现完整 Excel 公式兼容。表达式解析并校验后，Calculation Spec 保存为计算 AST；字段依赖解析为稳定的 Field ID，不依赖可变字段名或 A1 单元格坐标。具体表达式文法、运算符和函数范围由对应实现任务确定。

例如：

```json
{
  "id": "calc_margin",
  "targetField": "fld_margin",
  "expression": {
    "op": "divide",
    "left": {
      "op": "subtract",
      "left": "fld_revenue",
      "right": "fld_cost"
    },
    "right": "fld_revenue"
  },
  "dependsOn": [
    "fld_revenue",
    "fld_cost"
  ]
}
```

P1 Bundle 校验明确的 `targetField` 和 `dependsOn`，`expression` 作为 JSON 透传，不按字符串内容或 ID 前缀推测引用。正式 DSL 文法、AST 语义与依赖提取由 LVB-81 交付，届时解析器维护明确依赖列表。

Calculation 包括：

- Computed Column
- Formula
- AI Computed Field
- Dependency Graph

---

# 6. Transform Spec

Transform 描述从一个或多个 Table 生成新 Table 的过程。

例如：

```text
Orders
   │
   │ aggregate by week
   ▼
Weekly Sales
```

Transform 包括：

- Filter
- Aggregate
- Pivot
- Join
- Append
- Lookup
- Dedup
- Reconcile
- ML Transform
- AI Transform

Transform 应被建模成独立对象：

```json
{
  "id": "tr_weekly_sales",
  "type": "aggregate",
  "inputs": ["tbl_orders"],
  "output": "tbl_weekly_sales"
}
```

而不是塞进 Table Schema。

---

# 7. Workbook / View Spec

Workbook 描述 UI 和可视对象。

```text
Workbook
│
├── Page: Orders
│   ├── TableView
│   └── Chart
│
└── Page: Dashboard
    ├── KPI
    ├── Table
    └── Chart
```

Workbook 是根领域对象，管理独立的 Table 定义与数据，也管理其下具有稳定 ID 的 Page 视图分组。Workbook 与 Page 的 `name` / `title` 都是可修改元数据。Page 中的 Table View 通过 `tableId` 引用独立的 Table，不复制 Table Schema 或数据，也不以 Page 名称、View 顺序或 Grid 坐标定义 Table 身份。Workbook/Page 与 Table/Field/Row 使用同一稳定 ID 约定（见 §36）；布局和显示顺序只属于 View Spec。

负责：

- Page
- Table View
- Chart
- Layout
- Style
- Conditional Format
- Freeze
- Display configuration

Chart 建议使用 Vega-Lite 一类声明式 specification。

---

# 8. Lineage / Revision Spec

系统必须原生记录：

```text
Where does this value come from?
```

例如：

```text
Products.price
      │
      │ lookup
      ▼
Orders.price

Orders.quantity
      │
      ├──────────┐
      │          │
      ▼          ▼
    price × quantity
          │
          ▼
       revenue
```

Lineage 同时需要记录 Agent 操作来源：

```text
Agent
  ↓
Transaction
  ↓
Operation
  ↓
Transform / Calculation
  ↓
Table / Field / Chart
```

---

# 9. DeepSeek Harness 的角色

DeepSeek Harness 不承担 Spreadsheet Domain Model。

它负责：

```text
Agent Runtime
Session
LLM
Subagent
Tool Runtime
Permission
Plugin
Streaming
Conversation
Agent Lifecycle
```

Spreadsheet Plugin 负责：

```text
Workbook
Table
Schema
Calculation
Transform
Chart
Lineage
Revision
Transaction
Conflict Resolution
Spreadsheet UI
```

整体架构：

```text
┌──────────────────────────────────────┐
│          DeepSeek Harness            │
│                                      │
│ Agent / Session / Subagent           │
│ Tool Runtime / Permission / Plugin   │
└───────────────────┬──────────────────┘
                    │
              Spreadsheet Tools
                    │
┌───────────────────▼──────────────────┐
│       Spreadsheet Domain Layer       │
│                                      │
│ WorkbookService                      │
│ Table / Calculation / Transform      │
│ Chart / Lineage / Revision           │
│ Transaction / Conflict               │
└───────────────────┬──────────────────┘
                    │
┌───────────────────▼──────────────────┐
│            Compute Layer             │
│                                      │
│ Arrow / SQL / DataFrame / DuckDB     │
└───────────────────┬──────────────────┘
                    │
┌───────────────────▼──────────────────┐
│             Persistence              │
│                                      │
│ Manifest / Parquet / JSON / DB       │
└──────────────────────────────────────┘
```

---

# 10. DeepSeek Harness Plugin 结构

建议实现为独立 persistent external bundle：

```text
dsh-table-ai/
│
├── packages/
│   ├── table-core/
│   ├── table-runtime/
│   ├── tool-table/
│   ├── ui-table/
│   └── table-storage/
│
├── client/
│
├── host/
│
├── package.json
│
└── cordis.patch.yml
```

---

# 11. Spreadsheet UI 在 Harness 中的位置

Spreadsheet 应注册独立：

```text
main:table-ai
```

而不是强行嵌入 Harness Conversation。

UI：

```text
┌───────────┬────────────────────────────┐
│ Sidebar   │ Spreadsheet Main Panel     │
│           │                            │
│ Chat      │ Workbook                   │
│ Tables    │                            │
│ Files     │ Table / Chart / Page       │
│           │                            │
└───────────┴────────────────────────────┘
```

Spreadsheet 本质上是一个完整业务应用。

Harness Conversation 是另一种工作模式。

---

# 12. AI-native Spreadsheet UI 原则

AI 不应该只是：

```text
Spreadsheet + Chat Sidebar
```

更应该是：

```text
Spreadsheet itself is the Agent interface
```

核心交互：

```text
Selection
    ↓
Prompt
    ↓
Agent
    ↓
Typed Operations
    ↓
Visual Preview
    ↓
Apply / Undo
```

---

# 13. Agent 第一入口：Selection + Ask AI

这是最重要的 AI 入口。

用户：

```text
选中 revenue + cost
```

然后：

```text
⌘K
```

输入：

```text
加一列毛利率
```

UI 已经知道：

```json
{
  "workbookId": "sales",
  "tableId": "orders",
  "selection": {
    "fields": [
      "fld_revenue",
      "fld_cost"
    ]
  }
}
```

所以用户不需要描述：

```text
请在 Orders 表中使用 revenue 和 cost 两列……
```

自然语言只负责表达 Intent。

---

# 14. 第二入口：Object-level AI

每种 Spreadsheet object 均可以有 AI action。

例如：

## Table

```text
✨ Ask AI about this table
```

## Field

```text
✨ Transform with AI
```

## Rows

```text
✨ Analyze selected rows
```

## Chart

```text
✨ Edit chart with AI
```

## Derived Table

```text
✨ Explain lineage
```

---

# 15. 第三入口：Agent Dock

复杂任务需要持续 Agent：

```text
┌─────────────────────────────┬──────────────┐
│ Spreadsheet                 │ Agent        │
│                             │              │
│ Orders                      │ 分析最近     │
│                             │ 三个月销售   │
│ revenue cost margin         │              │
│                             │ Reading...   │
│                             │ Analyzing... │
│                             │ Creating...  │
└─────────────────────────────┴──────────────┘
```

Agent Dock 主要展示：

- Agent 当前在做什么
- 当前操作对象
- Tool activity
- Pending change
- Conflict
- Approval
- Error

而不是以长篇自然语言作为主要输出。

---

# 16. Agent Context

Spreadsheet UI 每次提交 Prompt 时，应冻结一个 Context Snapshot。

```json
{
  "workbookId": "sales",
  "revisionId": "rev_01J...",

  "pageId": "page_orders",
  "tableId": "tbl_orders",

  "selection": {
    "type": "fields",
    "fieldIds": [
      "fld_revenue",
      "fld_cost"
    ]
  },

  "view": {
    "filter": [],
    "sort": []
  }
}
```

注意：

UI Context：

```text
≠ 完整 Table Data
```

UI 只给 Agent：

```text
当前在哪里
正在看什么
选中了什么
revision 是什么
```

实际数据由 Agent 通过：

```text
table_query
```

获取。

---

# 17. Harness Agent Instruction

Agent instruction 应通过 Harness Agent：

```text
agent.followup()
```

当前 Agent 正在运行、用户在纠正它时使用：

```text
agent.steer()
```

例如：

```text
Agent:
正在按地区分析……

User:
不对，只看亚太地区

→ agent.steer()
```

---

# 18. Slash Command 的定位

Harness `/command` 不作为主要 AI 入口。

适合：

```text
/table undo
/table history
/table refresh
/table export
```

这些是：

```text
direct application command
```

而：

```text
分析销售下降原因
```

属于：

```text
model instruction
```

应该进入 Agent。

---

# 19. Spreadsheet Agent Tool Surface

底层 Spreadsheet 可以拥有几十种 typed operation，但不建议给模型暴露几十个 Harness Tool。

建议模型侧约 7 个工具：

```text
workbook_inspect
table_query
table_apply
chart_apply
analysis_run
table_ingest
workbook_history
```

---

# 20. table_apply

`table_apply` 是核心 mutation tool。

例如：

```json
{
  "workbookId": "sales",
  "baseRevisionId": "rev_01J...",

  "operations": [
    {
      "op": "addComputedColumn",
      "tableId": "tbl_orders",

      "field": {
        "id": "fld_margin",
        "name": "margin",
        "type": "number"
      },

      "expression": {
        "op": "divide",
        "left": {
          "op": "subtract",
          "left": "fld_revenue",
          "right": "fld_cost"
        },
        "right": "fld_revenue"
      }
    }
  ]
}
```

---

# 21. Spreadsheet Operations

内部 Operation 可以包括：

```text
createTable
deleteTable

addField
removeField
renameField

setCell
setRange

addComputedField

filter
sort

aggregate
pivot

join
append
lookup

dedup
reconcile

createChart
updateChart

classify
extract
enrich

forecast
cluster
```

LLM 不直接操作：

```text
JSON
SQL
Cell coordinates
```

而是操作 Spreadsheet Domain Operation。

---

# 22. WYSIWYG Agent Editing

Agent 的 Tool Call 不应该立即等于最终 commit。

例如：

```text
用户：
“加一列毛利率”
```

Agent：

```text
addComputedField
```

UI 应立即出现：

```text
┌─────────┬─────────┬──────┬─────────────┐
│ product │ revenue │ cost │ margin      │
├─────────┼─────────┼──────┼─────────────┤
│ A       │ 100     │ 70   │ 30%         │
│ B       │ 200     │ 120  │ 40%         │
│ C       │ 300     │ 240  │ 20%         │
└─────────┴─────────┴──────┴─────────────┘
                              ↑
                            preview

                [Apply] [Discard]
```

这就是：

```text
Preview is the answer
```

用户看到最终 Spreadsheet 的样子，比 Agent 回复：

```text
“我已经添加 margin 列”
```

更重要。

---

# 23. 操作风险分级

不是所有操作都需要确认。

## Level 1：View-only

例如：

```text
sort
filter
select
focus
```

策略：

```text
立即执行
```

---

## Level 2：Small reversible edit

例如：

```text
renameField
addField
changeChart
```

策略：

```text
立即执行
+
Undo
```

---

## Level 3：Structural operation

例如：

```text
join
aggregate
pivot
create derived table
```

策略：

```text
Preview
+
Apply
```

---

## Level 4：Bulk / destructive operation

例如：

```text
delete 10,000 rows
replace column
delete table
bulk overwrite
```

策略：

```text
Impact Preview
+
Explicit Apply
```

---

# 24. Tool Call 的 Native Renderer

Spreadsheet UI 不应展示：

```text
Called table_apply

{
  ...
}
```

而应该显示：

```text
✓ Added field “margin”
```

或者：

```text
Orders
   │
   │ aggregate
   ▼
Weekly Sales
```

或者直接显示：

```text
Revenue by Week

████████████
████████
█████
```

Tool Result 应该有 Spreadsheet-specific renderer。

---

# 25. AI Computed Field

`=AI(...)` 可以保留。

例如：

```text
=AI("extract company from @email")
```

它代表：

```text
AI Computed Field
```

但不能作为整个 Spreadsheet Agent 的主要入口。

它最适合：

```text
field-level / row-level AI computation
```

复杂任务仍应通过：

```text
Selection + Ask AI
```

---

# 26. Multi-step Agent

例如：

```text
把销售额按周汇总，
和去年同期比较，
然后做一个图。
```

Agent：

```text
Step 1
aggregate
```

得到：

```text
Weekly Sales
```

然后：

```text
Step 2
join last year
```

然后：

```text
Step 3
createChart
```

UI 应逐步出现：

```text
Orders
  │
  ▼
Weekly Sales
  │
  ▼
YoY Comparison
  │
  ▼
Chart
```

最后：

```text
3 pending changes

[Apply All]
```

---

# 27. Workbook 与 Harness Session

建议：

```text
Workbook
   │
   └── Harness Session
```

例如：

```text
workbookId = wb_sales
agentSessionId = sess_123
```

这样一个 Workbook 可以拥有长期 Agent history：

- 用户分析目的
- Agent operation
- Tool Call
- Subagent
- Error
- Decision
- Analysis context

Workbook 重新打开时可以恢复 Agent Session。

Spreadsheet Plugin 自己显式维护：

```text
workbookId ↔ sessionId
```

---

# 28. Subagent Collaboration

DeepSeek Harness Agent 可以将任务拆成多个 Subagent：

```text
Parent Agent
     │
     ├── Agent A
     ├── Agent B
     └── Agent C
```

例如：

```text
Agent A:
分析产品

Agent B:
分析地区

Agent C:
分析客户
```

它们可能同时读取甚至修改同一个 Workbook。

因此 Spreadsheet Runtime 必须拥有自己的并发控制。

---

# 29. 不直接使用 CRDT 解决 Agent 并发

V1 不建议：

```text
Workbook = CRDT
```

原因是 Spreadsheet Agent 的典型冲突通常不是简单 value conflict。

例如：

```text
Agent A:
rename revenue → sales
```

同时：

```text
Agent B:
创建依赖 revenue 的 margin
```

这是：

```text
dependency conflict
```

而不是简单：

```text
cell value conflict
```

类似问题还有：

```text
schema conflict
transform conflict
lineage conflict
dependency conflict
```

因此即使 CRDT 成功合并 JSON，也不代表 Spreadsheet 在业务语义上正确。

---

# 30. Agent 应被视为 Actor，而不是 Replica

CRDT 通常面对：

```text
Replica A
Replica B
Replica C
```

而 Subagent 更适合建模为：

```text
Agent A ─┐
Agent B ─┼──→ WorkbookService
Agent C ─┘
```

Agent 是：

```text
client / actor
```

WorkbookService 才拥有 authoritative state。

因此并发问题首先应作为：

```text
concurrent transaction
```

处理，而不是：

```text
distributed replica convergence
```

---

# 31. Workbook Revision

Workbook 每个 commit 产生 Revision：

```text
revision rev_01J... (sequence 0)
revision rev_01K... (sequence 1)
revision rev_01M... (sequence 2)
```

`revisionId` 是 Revision 的稳定、不透明身份；不能由序号、时间、名称或内容位置推导，也不能在同一 Workbook 内重用。`sequence` 是单调递增的展示/排序序号，不是身份或引用。`parentRevisionId` 是 Revision 之间唯一的链路引用。Workbook 的 `currentRevisionId` 指向唯一当前 head。

每个 Agent 开始任务时读取一个绑定到具体 `revisionId` 的 snapshot：

```text
Agent A
baseRevisionId = rev_01J...

Agent B
baseRevisionId = rev_01J...
```

Agent 不直接修改 state，而是提交 Transaction。

## Revision identity、提交链与读取

每个已提交 Revision 都有唯一 `revisionId`、所属 `workbookId`、单调递增的 `sequence`、`parentRevisionId`、提交时间和完整状态快照。根 Revision 的 `parentRevisionId` 为 `null`、序号为 `0`；之后每个成功提交恰有一个 parent，序号比 parent 大一。每个非根 Revision 记录对应的 `transactionId`（在所属 Workbook 内唯一）；提交时间使用 RFC 3339 UTC 时间戳。提交者和简短说明可作为历史元数据；它们不替代 revision 身份。内部 Revision 引用一律使用 `revisionId`，序号只用于界面显示。

一个 Workbook 只有一个权威提交 head。成功提交必须以提交时的 `currentRevisionId` 为 `parentRevisionId`，生成新的 Revision，不得改写既有快照或产生未标明关系的并行 head。提交若基于旧的 `baseRevisionId`，WorkbookService 必须拒绝，或先显式校验/重放变更；重放成功后，Revision 的 parent 是实际当前 head，并在事务/修订元数据中通过 `submittedAgainstRevisionId` 保留原始 `baseRevisionId`。未提交的 proposal 不产生 Revision。

快照表示指定 Revision 的完整、不可变 Workbook 状态：Workbook 元数据、Page/View、Table Schema、全部 Row 数据、Calculation、Transform、Chart 和已提交的 Lineage。所有对象间关系继续使用稳定语义 ID。`readRevision(workbookId, revisionId)` 只返回这一状态；`readCurrent(workbookId)` 先解析一次当前 head，再读取该 Revision 的快照。任何读取都不得混合不同 Revision 的文件；找不到 Revision、缺少快照内容或引用校验失败时，必须整体失败，不能返回部分 Workbook。

## 可移植历史档案

Workbook Bundle v1 仍以根目录的 `workbook.json` 和其 manifest entries 表达一个当前 Workbook 状态。历史是由 LVB-79 定义的可选档案 profile；启用后，不改变 Bundle v1 的核心 `formatVersion` 或 entries 语义，并将 `revision-history-v1` 列入根 manifest 的 `requiredFeatures`，同时在 `extensions.revisionHistory.path` 指向历史索引。不支持该特性的读取方按 Bundle v1 规则明确失败，避免静默丢失历史。

根 manifest 的扩展示例：

```json
{
  "requiredFeatures": ["revision-history-v1"],
  "extensions": {
    "revisionHistory": { "path": "history/index.json" }
  }
}
```

历史索引为 UTF-8 JSON，列出 Workbook 的所有 Revision，按 parent 在前的拓扑顺序排列：

```json
{
  "format": "ai-native-spreadsheet-revision-history",
  "formatVersion": 1,
  "workbookId": "wb_01J...",
  "currentRevisionId": "rev_01K...",
  "revisions": [
    {
      "revisionId": "rev_01J...",
      "sequence": 0,
      "parentRevisionId": null,
      "committedAt": "2026-10-08T09:00:00Z",
      "transactionId": null,
      "actorId": null,
      "submittedAgainstRevisionId": null,
      "summary": "Initial workbook",
      "snapshotPath": "history/snapshots/rev_01J..."
    },
    {
      "revisionId": "rev_01K...",
      "sequence": 1,
      "parentRevisionId": "rev_01J...",
      "committedAt": "2026-10-08T09:05:00Z",
      "transactionId": "tx_01K...",
      "actorId": "agent_01J...",
      "submittedAgainstRevisionId": "rev_01J...",
      "summary": "Add margin field",
      "snapshotPath": "history/snapshots/rev_01K..."
    }
  ]
}
```

每个 `snapshotPath` 都定位到一份完整、可独立读取的 Bundle v1 快照，内含该 Revision 的 manifest、规格文档与 Table 数据；快照的 `workbookId` 必须与索引一致。根目录 `workbook.json` 表示 `currentRevisionId` 对应的同一状态，供当前 Workbook 读取；索引和被引用的快照共同构成历史档案。路径是相对 Bundle 根目录的路径，不是实体身份。

读取方验证 revision ID 唯一、parent 存在且无环、除根外每个 Revision 只有一个 parent、序号递增、当前 head 存在并与根 Bundle 状态一致。历史索引或任一被声明保留的快照缺失/无效时，历史档案整体导入失败。写入方必须以一个完整发布单元保存新快照、历史索引和当前 head，使读取方不会观察到指向缺失快照的 head。

---

# 32. Transaction

示例：

```json
{
  "workbookId": "sales",

  "transactionId": "tx_agent_a",

  "baseRevisionId": "rev_01J...",

  "mode": "proposal",

  "operations": [
    {
      "op": "addComputedField",
      "tableId": "tbl_orders",
      "fieldId": "fld_margin"
    }
  ]
}
```

---

# 33. Read Set / Write Set

每个 Spreadsheet Operation 都应该能计算：

```text
Read Set
Write Set
```

例如：

```text
add margin
```

读取：

```text
orders.revenue
orders.cost
```

写入：

```text
orders.margin
```

抽象接口：

```ts
interface SpreadsheetOperation {
  readSet(): ResourceRef[]
  writeSet(): ResourceRef[]

  validate(snapshot): ValidationResult

  apply(snapshot): Patch
}
```

---

# 34. Resource Identity

资源可以定义成：

```text
workbook:wb_01J...

page:pg_01J...

table:tbl_01J...

field:tbl_01J...:fld_01J...

row:tbl_01J...:row_01J...

chart:cht_01J...

transform:trf_01J...
```

资源身份使用实体 ID；Field 和 Row 引用可携带所属 Table ID 以明确作用域。名称与显示文字可变，因此不能作为冲突检测或内部依赖关系的唯一键。系统据此判断两个 Agent 是否真的发生冲突。

---

# 35. Conflict Detection

例如：

```text
Agent A
write:
orders.margin
```

Agent B：

```text
write:
customers.industry
```

两者不冲突。

可以：

```text
parallel commit
```

---

另一个例子：

Agent A：

```text
rename revenue
```

Agent B：

```text
read revenue
create margin
```

如果内部 formula 使用：

```text
fieldId
```

而不是：

```text
field name
```

那么 Rename 甚至可能不需要产生 conflict。

---

# 36. Stable Semantic ID

这是并发设计的重要基础。

Workbook、Page、Table、Field、Row 都必须有稳定的语义 ID。ID 是不透明且不可变的标识，不由对象名称、展示标签、顺序、数据值或 Grid 坐标生成。Workbook ID 在应用命名空间内唯一；Page、Table、Field ID 在所属 Workbook 内唯一；Row ID 在所属 Table 内唯一。需要跨所属对象引用 Field 或 Row 时，同时携带所属 Table ID。

ID 在对象重命名、同一 Workbook 内移动或重排，以及其他展示属性修改后保持不变。删除后不重用 ID；新建或复制对象时分配新 ID。字符串前缀可帮助阅读（例如 `wb_`、`pg_`、`tbl_`、`fld_`、`row_`），但不决定外部 ID 的有效性或实体种类；相等比较仍使用完整 ID 字符串。生成器可继续产生前缀；外部无前缀 UUID/ULID 或其他不透明 ID 同样有效。Bundle v1 允许的可移植拼写为 `[A-Za-z0-9][A-Za-z0-9._~-]{0,159}`；实体种类由引用上下文与类型品牌约束，不能从前缀推导。

不要把可变名称作为唯一引用：

```text
revenue
cost
```

也不要用 A1 坐标、行号或列号表示内部关系。应使用稳定 ID：

```text
fld_1023
fld_1024
```

例如，Field 的稳定 ID 与可变名称分开保存：

```text
fieldId = fld_1023
name = revenue
```

Rename：

```text
revenue → sales
```

不会改变 Field ID 或以该 ID 保存的内部依赖：

```text
fld_1023
```

依赖关系保持稳定。

---

# 37. Commit Result

`table_apply` / Transaction 提交结果建议统一为：

```text
APPLIED
MERGEABLE
REBASE_REQUIRED
CONFLICT
```

例如：

```json
{
  "status": "REBASE_REQUIRED",

  "baseRevisionId": "rev_01J...",
  "currentRevisionId": "rev_01M...",

  "changesSinceBase": [
    {
      "resource": "field:orders.revenue",
      "operation": "rename"
    }
  ]
}
```

Agent 可以：

```text
inspect
   ↓
rebase
   ↓
retry
```

这非常适合 Agent：

```text
observe
→ reason
→ retry
```

的执行模型。

---

# 38. Subagent 默认 Proposal-first

为了减少多个 Subagent 同时修改 Workbook 的风险，建议默认：

```text
Subagent
   ↓
Proposal
```

而不是：

```text
Subagent
   ↓
Direct Commit
```

例如：

```text
Parent Agent
     │
     ├── Subagent A
     │      ↓
     │    Proposal A
     │
     ├── Subagent B
     │      ↓
     │    Proposal B
     │
     └── Subagent C
            ↓
          Proposal C
```

最后：

```text
Transaction Coordinator
       │
       ▼
validate
merge
rebase
commit
```

---

# 39. Parallel Analysis Example

用户：

```text
分析销售数据：
分别从产品、地区、客户三个维度分析。
```

Parent Agent：

```text
spawn Product Agent
spawn Region Agent
spawn Customer Agent
```

得到：

```text
Proposal A:
Sales by Product

Proposal B:
Sales by Region

Proposal C:
Sales by Customer
```

三者没有冲突。

系统可以一次 Preview：

```text
+ Sales by Product
+ Sales by Region
+ Sales by Customer
+ Dashboard

[Apply All]
```

然后：

```text
revision rev_01J... → rev_01K...
```

只产生一个原子 commit。

---

# 40. Agent 并发策略

不同 Operation 使用不同策略。

| Operation | 示例 | 并发策略 |
|---|---|---|
| Read | query / stats / inspect | Fully parallel |
| Isolated Write | 创建 Derived Table | Parallel proposal |
| View Change | Filter / Sort | Immediate |
| Shared Schema Write | 改 Field / Formula | Conflict detection |
| Bulk Write | 更新大量 Row | Transaction |
| Destructive | Delete / Replace | Preview + approval |

---

# 41. WorkbookService

所有 Human UI 与 Agent 都必须通过同一个 WorkbookService。

禁止：

```text
UI directly edits file
Agent directly edits file
```

统一：

```text
Spreadsheet UI ─┐
                 │
Agent ───────────┼──→ WorkbookService
                 │
Subagent ────────┘
```

核心 API 可以是：

```text
describe(workbookId)

query(workbookId, query)

propose(workbookId, transaction)

apply(workbookId, transaction)

undo(workbookId)

history(workbookId)
```

---

# 42. Preview Transaction

Agent 的 modification 首先可以处于：

```text
proposal / preview
```

例如：

```json
{
  "transactionId": "tx_123",

  "baseRevisionId": "rev_01J...",

  "status": "preview",

  "operations": [
    ...
  ]
}
```

Spreadsheet UI 将该 Proposal 投影到当前 Workbook。

但真实 authoritative Workbook 仍保持 `rev_01J...`。

用户点击：

```text
Apply
```

以后才：

```text
revision rev_01J... → rev_01K...
```

---

# 43. Undo

每次 Commit 都必须形成完整 ChangeSet：

```text
revision rev_01J...
   ↓ tx123
revision rev_01K...
```

因此 Undo 可以是：

```text
inverse transaction
```

而不是重新解析文件差异。

---

# 44. Lineage + Agent Provenance

每一个 commit 都应该记录：

```text
Transaction
│
├── initiatedBy
│   ├── human
│   ├── agent
│   └── subagent
│
├── operations
│
├── readSet
│
├── writeSet
│
├── baseRevisionId
│
├── resultRevisionId
│
└── lineage
```

例如：

```text
User Prompt
   ↓
Parent Agent
   ↓
Subagent: Product Analysis
   ↓
aggregate
   ↓
Sales by Product
   ↓
Chart
```

---

# 45. CRDT 的定位

CRDT 不作为 Spreadsheet Domain Data 的第一版核心模型。

未来主要用于：

```text
Collaboration State
```

例如：

- Cursor
- Selection
- Presence
- Comment
- Annotation
- Page ordering
- Lightweight layout
- Rich Text
- Notes

---

# 46. CRDT 适合的未来场景

如果未来支持：

```text
Google Drive
Dropbox
Browser
Desktop
Offline editing
Multi-user editing
```

CRDT 会越来越有价值。

尤其是：

```text
User A
   ↓
offline edit

User B
   ↓
online edit

User A reconnect
```

这是：

```text
replica convergence
```

问题。

这时可以为 Collaboration Layer 引入：

```text
Yjs
```

或者：

```text
Automerge
```

但仍不意味着整个 Table / Transform / Lineage 必须 CRDT 化。

---

# 47. 推荐状态分层

```text
┌──────────────────────────────────────┐
│          Collaboration State         │
│                                      │
│ Presence / Cursor / Comment          │
│ Lightweight View Metadata            │
│                                      │
│            Optional CRDT             │
└───────────────────┬──────────────────┘
                    │
┌───────────────────▼──────────────────┐
│       Spreadsheet Domain State       │
│                                      │
│ Table Schema                         │
│ Calculation                          │
│ Transform DAG                        │
│ Chart                                │
│ Lineage                              │
│                                      │
│ MVCC + Revision + Typed Operation    │
└───────────────────┬──────────────────┘
                    │
┌───────────────────▼──────────────────┐
│             Table Data               │
│                                      │
│ Arrow / Parquet / DuckDB / DB        │
│ Snapshot / Transaction               │
└──────────────────────────────────────┘
```

---

# 48. Compute Engine

Spreadsheet Domain Layer 不应该自己实现所有计算。

推荐：

```text
Spreadsheet Operation
       │
       ▼
Query / Compute Planner
       │
       ▼
Arrow / DuckDB / DataFrame
```

例如：

```text
aggregate
join
filter
sort
pivot
```

都可以转换成底层 Query Plan。

---

# 49. Storage

第一版可以采用：

```text
Workbook Bundle
│
├── workbook.json
│
├── schemas/
│   └── orders.json
│
├── calculations/
│   └── margin.json
│
├── transforms/
│   └── weekly-sales.json
│
├── views/
│   └── dashboard.json
│
├── lineage/
│   └── lineage.json
│
└── tables/
    ├── orders.parquet
    └── customers.parquet
```

## Workbook Bundle v1 合约

Bundle 是一个目录树；`workbook.json` 是唯一入口，也是 Workbook manifest。实现可以在传输时把目录树包装成归档，但解包后的相对路径和文件内容必须遵循同一合约。JSON 使用 UTF-8。Manifest 明确列出每个文件的位置；读取方不得从 Workbook、Table、Field 或 Page 名称推导路径。

最小 manifest 形状如下。路径是相对 Bundle 根目录的文件路径，只用于定位文件；实体身份始终来自稳定 ID：

```json
{
  "format": "ai-native-spreadsheet-workbook-bundle",
  "formatVersion": 1,
  "workbook": {
    "id": "wb_01J...",
    "name": "Sales",
    "metadata": {}
  },
  "entries": {
    "schemas": [
      { "tableId": "tbl_01J...", "path": "schemas/orders.json" }
    ],
    "calculations": [
      { "id": "calc_01J...", "path": "calculations/margin.json" }
    ],
    "transforms": [
      { "id": "trf_01J...", "path": "transforms/weekly-sales.json" }
    ],
    "views": [
      { "pageId": "pg_01J...", "path": "views/orders.json" }
    ],
    "lineage": { "path": "lineage/lineage.json" },
    "tables": [
      { "tableId": "tbl_01J...", "path": "tables/orders.parquet" }
    ]
  },
  "requiredFeatures": [],
  "extensions": {}
}
```

每个 Schema、Calculation、Transform、Page/View 和 Lineage JSON 文档都在顶层包含 `specVersion: 1`。Schema 文档包含一个 Table 及其 Fields、键和关系；Table 的稳定 ID 必须与 manifest 中的 `tableId` 一致。Page 文档保存 Page 元数据、`viewSettings` 和其 Views；每个 Table View 通过 `tableId` 引用 Schema 中的 Table，不复制 Schema 或数据。Calculation 与 Transform 文档分别保存各自的规格，不并入 Schema。Lineage 文档包含 `records` 数组；每条记录可用 `references` 数组表达 Workbook 内实体引用，每个引用含 `kind`、`id`，Field 和 Row 引用还必须含 `tableId`。`kind` 可为 `workbook`、`page`、`table`、`field`、`row`、`calculation` 或 `transform`。Lineage 的提交者、Transaction 等外部来源信息作为记录内容保留，不与 Workbook 实体引用混淆。Revision 快照和历史索引不属于 v1 Bundle 合约，由 LVB-79 定义。

每个 Table 恰有一个 Schema 文档和一个 Parquet 数据文件；空表也写出带有完整列定义、零数据行的 Parquet 文件。Parquet 数据文件包含 `_row_id` 列，以及每个 Field 对应的 `field:<fieldId>` 列。`_row_id` 的值是稳定 Row ID；Field 列名后缀是稳定 Field ID。物理列顺序只影响存储布局，不表示字段身份或默认展示顺序；默认展示顺序仍由 Schema 的 `fields` 顺序决定。Bundle v1 的逻辑值类型使用以下 Parquet 表示：

| Schema Field `type` | Parquet 表示 |
| - | - |
| `string`, `date`, `datetime`, `time`, `year`, `yearmonth`, `duration` | UTF-8 string，保留逻辑值的字符串内容 |
| `number` | `DOUBLE` |
| `integer` | `INT64`；接受无注解、`INT_64`、`INTEGER(64,true)` 或二者一致组合；逻辑值限于 JavaScript 安全整数范围 |
| `boolean` | `BOOLEAN` |
| `object`, `array`, `geojson`, `geopoint`, `any` | Parquet `JSON` 字段，值按 JSON 编码 |

缺失字段值按逻辑 `null` 写读。其他或未知 Field 类型必须明确报错；不能静默截断、舍入或转换。读取器验证 Parquet 列的物理表示与此映射一致；timestamp、decimal、unsigned 或互相冲突的注解不能仅凭 INT64 物理类型通过。

## 写入与读取边界

- 写入方从一个已提交的 Workbook 状态序列化 Workbook 元数据、Schema、Calculation、Transform、Page/View、Lineage 和各 Table 数据。它保留稳定 ID 与规格边界，不把展示名称、Grid 坐标或文件路径写成内部引用。
- 读取方从 `workbook.json` 开始，只读取 manifest 列出的文件；路径必须是根目录内的相对路径，归一化后不得逃逸 Bundle 根目录，也不得有重复路径。缺失文件、重复实体 ID、重复 Field/Row ID、格式不符或无法解析的必需引用都会使整个 Bundle 导入失败；不得返回部分载入的 Workbook。
- 读取方先收集各文档声明的 ID，再解析引用：Schema 的主外键、Calculation 的目标 Field 与依赖、Transform 的输入/输出 Table、Page/View 的目标对象以及 Lineage 的实体引用都必须存在，并且所属 Table 范围必须匹配。每个 Parquet 文件的 Field 列集合必须与其 Schema 一一对应；每行的 `_row_id` 必须存在且在该 Table 内唯一。Parquet 列名和行号不是语义身份。
- JSON 文档中的规格与 Parquet 数据共同构成一个 Workbook 状态。导入保留计算表达式、Transform、View 与 Lineage 规格；是否执行计算或 Transform 属于 WorkbookService，不属于 Bundle 读取器。

## 目录所有权、提交与导入资源边界

保存只初始化新目录，或替换经过完整校验、只包含声明文件与必要容器目录的 Bundle。当前工作目录及其祖先、文件系统根目录、根 symlink、普通目录、伪造标记、含额外文件/目录/symlink/特殊文件的 Bundle 均拒绝替换；失败保留旧数据。普通保存不能覆盖 Revision 历史档案，历史只能通过 Revision 提交 API 追加。

读取、初始化、保存与 Revision 提交共享 Bundle 根目录同级、跨发布保留有效性的单写者锁。提交的读 head、base/transaction 检查、历史构造和发布都在持锁期间完成；同 base 竞争最多一个成功，失败可分类。读取也持锁，避免混合两个已提交状态。临时目录在发布前使用完整读取器及其资源预算验证，确保成功保存/提交的状态和全部历史可再次读回。此边界不实现 P5 的语义 rebase；崩溃残留锁需确认没有活跃操作后恢复，不能按年龄自动抢占。

Bundle 公共 API 使用 `WorkbookBundleError.code` 区分结构/引用、路径、数据、I/O、资源超限、未支持版本、冲突与不安全目标；保留原始 cause 和文件/实体上下文。领域校验仍返回 issues，独立适配器维持自身错误契约。导入限制文件/总字节、文件数量、Revision 数、累计行数、JSON 深度/节点/容器/字符串以及 Parquet 行列/解码页预算；Parquet worker 可终止并有堆与时间限制。超限整体失败，全历史一致性校验继续执行。当前默认值、读取所需父目录写权限及恢复限制见 [Workbook Core README](../packages/workbook-core/README.md)。

## 版本与扩展

`formatVersion` 是 Bundle 主版本；每类 JSON 规格文档分别以 `specVersion` 声明自身主版本。v1 读者遇到不支持的主版本或未知的 `requiredFeatures` 时必须清楚失败，不得猜测或丢弃语义。向后兼容的可选属性放在 `metadata` 或 `extensions` 中；未知扩展可忽略并在透传 Bundle 时保留。改变现有字段语义或删除必需字段时提升相应主版本。未来数据库后端可以替代物理文件读写，但须维持相同的 Workbook、稳定 ID、规格边界和导入/读取语义。

也可以逐步演进为数据库后端。

---

# 50. 产品体验原则

整个产品不应该变成：

```text
Spreadsheet
+
AI Chat
```

而应该是：

```text
Spreadsheet UI
=
Human + Agent Shared Workspace
```

Agent activity 直接投影到 Spreadsheet。

例如 AI Column：

```text
feedback           sentiment ✨
──────────────────────────────
app crashes        negative
great product      positive
can't login        analyzing…
```

而不是：

```text
Agent:
Processing row 3...
```

---

# 51. 用户操作闭环

理想交互：

```text
框选
 ↓
⌘K
 ↓
自然语言
 ↓
Agent
 ↓
Spreadsheet Preview
 ↓
Apply
```

例如：

```text
选中 revenue + cost

⌘K

“加一列毛利率，
低于 15% 的标红”
```

最终直接看到：

```text
revenue  cost  margin
100      70    30%
200      190    5%   ← red

[Apply 2 changes]
```

---

# 52. MVP

第一版重点不要追求完整 Excel 兼容。

MVP 应坚持：

```text
Table-first
```

推荐范围：

## Data Model

- Workbook
- Page
- Table
- Field
- Row
- Chart

## Semantic Layer

- Table Schema
- Stable IDs

## Calculation

- Computed Field

## Transform

- Filter
- Sort
- Aggregate
- Join
- Lookup

## Visualization

- Vega-Lite Chart

## Agent

- Selection Context
- Ask AI
- Agent Dock
- Typed Operations
- Preview
- Apply / Undo

## Concurrency

- Revision
- Snapshot
- Transaction
- ReadSet
- WriteSet
- Conflict Detection
- Proposal-first Subagent

## Lineage

- Transform lineage
- Calculation dependencies
- Agent provenance

---

# 53. MVP 不做

第一版不建议实现：

- 完整 Excel arbitrary grid semantics
- 完整 Excel formula compatibility
- VBA
- Cell-by-cell CRDT
- 整个 Workbook CRDT 化
- 任意 merged cells
- 高复杂度 print layout
- 完整 Excel style system
- 任意跨 Sheet A1 formula compatibility

---

# 54. 推荐实施顺序

## Phase 1：Spreadsheet Core

实现：

```text
Workbook
Table
Table Schema
FieldId
RowId
Revision
```

---

## Phase 2：Operations

实现：

```text
table_query
table_apply
```

以及核心 typed operations。

---

## Phase 3：Agent WYSIWYG

实现：

```text
Selection Context
⌘K Ask AI
Preview
Apply
Undo
```

形成第一个 AI-native vertical slice。

---

## Phase 4：Transform + Chart

实现：

```text
Aggregate
Join
Derived Table
Vega-Lite
Lineage
```

---

## Phase 5：Multi-Agent

实现：

```text
Proposal
ReadSet
WriteSet
Conflict Detection
Rebase
Transaction Coordinator
```

---

## Phase 6：Collaboration

当产品真正需要：

```text
Multi-user
Multi-device
Offline-first
```

再引入：

```text
CRDT Collaboration Layer
```

---

# 55. 第一条 Vertical Slice

建议第一条端到端场景：

用户打开：

```text
Orders
```

数据：

```text
date
product
revenue
cost
```

用户选择：

```text
revenue + cost
```

输入：

```text
加一列毛利率，
然后按周汇总销售额，
最后生成趋势图。
```

Agent：

```text
addComputedField
      ↓
aggregate
      ↓
createDerivedTable
      ↓
createChart
```

UI：

```text
Orders
  │
  ├─ margin
  │
  ▼
Weekly Sales
  │
  ▼
Revenue Trend
```

最终：

```text
3 pending changes

[Apply All]
```

Commit：

```text
revision rev_01J... → rev_01K...
```

Lineage：

```text
Orders.revenue
Orders.cost
     │
     ▼
margin
     │
     ▼
Weekly Sales
     │
     ▼
Revenue Trend
```

这条流程同时验证：

- Table-first
- Calculation
- Transform
- Chart
- Agent Tool
- WYSIWYG Preview
- Transaction
- Revision
- Lineage

因此非常适合作为 MVP 的第一条完整产品路径。

---

# 56. 最终架构

```text
                          User
                           │
             Selection + Natural Language
                           │
                           ▼
┌────────────────────────────────────────────────┐
│                Spreadsheet UI                  │
│                                                │
│ Table / Chart / Page / Preview / Agent Dock    │
└───────────────────────┬────────────────────────┘
                        │
                  Interaction Context
                        │
                        ▼
┌────────────────────────────────────────────────┐
│              DeepSeek Harness                  │
│                                                │
│ Agent                                          │
│ Session                                        │
│ Subagents                                      │
│ Tool Runtime                                   │
└───────────────────────┬────────────────────────┘
                        │
                 Spreadsheet Tools
                        │
                        ▼
┌────────────────────────────────────────────────┐
│              WorkbookService                   │
│                                                │
│ Typed Operations                               │
│ Snapshot / Revision                            │
│ Transaction                                    │
│ ReadSet / WriteSet                             │
│ Conflict Detection                             │
│ Semantic Merge / Rebase                        │
└───────────────────────┬────────────────────────┘
                        │
           ┌────────────┴─────────────┐
           ▼                          ▼
┌─────────────────────┐    ┌─────────────────────┐
│ Spreadsheet Model   │    │ Compute Engine      │
│                     │    │                     │
│ Table Schema        │    │ Arrow               │
│ Calculation         │    │ DuckDB              │
│ Transform DAG       │    │ DataFrame           │
│ View / Chart        │    │ SQL                 │
│ Lineage             │    │                     │
└──────────┬──────────┘    └──────────┬──────────┘
           │                          │
           └────────────┬─────────────┘
                        ▼
               Persistent Workbook
```

---

# 57. 产品定义总结

本产品不是：

```text
Excel + ChatGPT
```

也不是：

```text
Spreadsheet with AI Sidebar
```

而是：

> **一个 Human 与 Agent 共同操作结构化数据模型的可视化工作空间。**

Spreadsheet UI 同时承担：

```text
数据展示
数据编辑
Agent Context
Agent Preview
Agent Approval
Agent Collaboration Surface
```

DeepSeek Harness 提供：

```text
Agent execution
Subagent orchestration
Tool runtime
Session
Permission
Streaming
```

Spreadsheet Runtime 提供：

```text
domain semantics
transaction
concurrency
lineage
revision
conflict resolution
```

最终形成：

> **Table-first + Agent-native + WYSIWYG + Transactional Spreadsheet**

其最关键的产品原则仍然是：

> **Selection is context.  
> Natural language is intent.  
> Tool calls are edits.  
> Preview is the answer.**
