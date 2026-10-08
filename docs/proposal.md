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

Field Name 是 presentation metadata，不应作为内部依赖关系的唯一标识。

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
  "revision": 42,

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
  "baseRevision": 42,

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
revision 42
revision 43
revision 44
```

每个 Agent 开始任务时读取一个 snapshot：

```text
Agent A
baseRevision = 42

Agent B
baseRevision = 42
```

Agent 不直接修改 state，而是提交 Transaction。

---

# 32. Transaction

示例：

```json
{
  "workbookId": "sales",

  "transactionId": "tx_agent_a",

  "baseRevision": 42,

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
workbook:sales

table:orders

table:orders/schema

field:orders.revenue

field:orders.cost

field:orders.margin

row:orders:123

rows:orders:*

chart:revenue_by_week

transform:weekly_sales
```

因此系统可以判断两个 Agent 是否真的发生冲突。

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

不要：

```text
revenue
cost
```

作为唯一 reference。

而是：

```text
fld_1023
fld_1024
```

例如：

```text
fieldId = fld_1023
name = revenue
```

Rename：

```text
revenue → sales
```

不会改变：

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

  "baseRevision": 42,
  "currentRevision": 45,

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
revision 42 → 43
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

  "baseRevision": 42,

  "status": "preview",

  "operations": [
    ...
  ]
}
```

Spreadsheet UI 将该 Proposal 投影到当前 Workbook。

但真实 authoritative Workbook 仍保持 revision 42。

用户点击：

```text
Apply
```

以后才：

```text
revision 42 → 43
```

---

# 43. Undo

每次 Commit 都必须形成完整 ChangeSet：

```text
revision 42
   ↓ tx123
revision 43
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
├── baseRevision
│
├── resultRevision
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
revision 12 → 13
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
