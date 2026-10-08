### Classic Data Analysis

| Feature | Tooltip |
|---|---|
| Get quick stats | Calculate high-level metrics from your data. Example: “What's the average number of signups on weekends?” |
| Add columns with formulas | Add columns with formulas. Example: “Bucket age into increments of 10: 20-30, 31-40, and so on”. |
| Summarize and slice tables | Create tables that aggregate or summarize data. Example: “Aggregate revenue by week, pivot by product”. |
| Join and append tables | Merge two different tables. Example: “Join @Table1 with @Table2”. |
| Lookup operations | Look up values from one table in another. Example: “Lookup product_id in @Table2 and add price to @Table1”. |
| Extract and classify text (tags/sentiment) | Extract specific information or concepts from text. Example: “Extract ZIP code from each address”. Classify text into user-defined categories. Example: “Classify message into: bug, support, feature request”. Analyze the sentiment of a text. Example: “Run sentiment analysis for each tweet”. |
| Enrich with real-world data | Add real-world facts to your dataset. Example: “Add column with Capital for each country”. |
| Clean up duplicates | Identify and remove duplicate rows. Example: “Return the table without duplicates”. |
| Reconcile two tables | Compare two tables to find inconsistencies. Example: “Compare @Table1 and @Table2 and show mismatched invoices”. |
| Convert images into tables | Convert chart or table images into structured tables. Example: “Fetch only the last 15 datapoints”. |
| Analyze PDFs | Convert PDFs into structured tables. Example: “Combine all invoices into one table”. |

### Advanced Analysis

| Feature | Tooltip |
|---|---|
| Predictive modeling | Uses historical data to forecast future outcomes. Example: “Forecast revenue for the next 3 days based on historical trends” |
| Inferential analysis | Draws conclusions about a population based on sample data. Example: “Test statistical significance between control and variant” |
| Segmentation & Cohort Analysis | Groups users by shared traits or behaviors to analyze patterns over time. Example: “Create weekly acquisition cohorts and analyze retention” |
| Multivariate Analytics | Examines the relationship between multiple variables simultaneously. Example: “Use K-means clustering to segment customers based on behavior and spend” |

### Manage Spreadsheets Elements

| Feature | Tooltip |
|---|---|
| Manage Tables & Charts | Add, edit, rename, delete, duplicate Tables and Charts. Change Title, sub-title, footnote. On Tables, Change Filters & Sorting. On Charts, change series, type, axis properties and color. |
| Manage Cells, Rows & Columns | Add, edit, remove, or clear cell values, formulas, rows, and columns—including empty ones. Set formats, styles, and freeze rows or columns. |
| AI Cell | Type `=anything` in a cell to ask AI to write a formula or create a Chart. |
| Quick actions | Find & replace text, drag & fill cells with formula, copy/paste range or cells. |
| Multi-step requests | Do multiple, sequential actions in one request. Example: “Aggregate sales by week and plot on a column chart”. |
| Manage spreadsheet file | Add, rename, delete, move Pages or element (Chart, Table). Rename, delete spreadsheet. |

### Create models

| Feature | Tooltip |
|---|---|
| Calculators | Example: “Build a 10y mortgage calculator” |
| Tables with real-world data | Example: “Biggest cities in the world with country and population” |
| Tables with sample data | Example: “List of 15 dummy emails” |

综合看，**Table Schema 很适合做这个产品的“语义数据层”，但不适合直接充当整个 Spreadsheet 文件格式**。你的 `features.md` 基本都能实现，真正需要设计的是 Table Schema 之上的几个扩展层。

Table Schema v1 本身主要描述字段、类型、格式、约束、主键和外键，并明确允许 schema 和 field descriptor 携带规范之外的自定义属性，因此非常适合作为扩展基础。但它的核心模型仍然是规则的 `rows × fields` 表，而不是 Excel 那种任意 cell、公式、样式、图表、多个 sheet 的完整文档模型。

## 一、整体判断

如果你的产品更接近：

> **Rows / Airtable / AI Data Table / 轻量 Spreadsheet**

而不是：

> **100% Excel 兼容的自由网格编辑器**

那么我认为 Table Schema 是一个**很好的基础选择**。

我建议把系统理解成：

```text
┌───────────────────────────────┐
│            AI Layer           │
│ NL → typed operations / plan  │
└───────────────┬───────────────┘
                ↓
┌───────────────────────────────┐
│       Spreadsheet Model       │
│ Pages / Tables / Charts       │
│ Cells / Styles / Layout       │
└───────────────┬───────────────┘
                ↓
┌───────────────────────────────┐
│     Transform / Compute       │
│ formula / join / pivot / ML   │
│ lookup / enrich / classify    │
└───────────────┬───────────────┘
                ↓
┌───────────────────────────────┐
│       Semantic Data Model     │
│          Table Schema         │
│ fields/types/constraints/FK   │
└───────────────┬───────────────┘
                ↓
┌───────────────────────────────┐
│          Data Engine          │
│   Arrow / SQL / DataFrame     │
└───────────────────────────────┘
```

**不要让 Table Schema 承担上面全部职责。**

---

# 二、Classic Data Analysis

你列出的经典分析能力包括统计、公式列、聚合、Join、Lookup、AI 文本处理、数据补全、去重、对账以及图片/PDF 抽取。

| Feature | 可行性 | Table Schema 作用 | 需要额外能力 |
|---|---|---|---|
| Get quick stats | **高** | ⭐⭐⭐⭐⭐ | SQL/DataFrame |
| Add columns with formulas | **高** | ⭐⭐⭐⭐ | Formula extension |
| Summarize / slice / pivot | **高** | ⭐⭐⭐⭐ | Query/Transform engine |
| Join / append | **高** | ⭐⭐⭐⭐⭐ | SQL/DataFrame |
| Lookup | **高** | ⭐⭐⭐⭐⭐ | FK + Join |
| Extract/classify text | **高** | ⭐⭐⭐⭐ | LLM |
| Enrich real-world data | **高** | ⭐⭐⭐ | Web/API/Agent |
| Remove duplicates | **高** | ⭐⭐⭐⭐⭐ | Query engine |
| Reconcile tables | **高** | ⭐⭐⭐⭐⭐ | Query engine |
| Image → table | **高** | ⭐⭐ | Vision model |
| PDF → table | **高** | ⭐⭐ | PDF/Vision model |

这里绝大多数非常适合 Table Schema。

### 1. Quick stats

例如：

> What's the average number of signups on weekends?

Schema：

```json
{
  "fields": [
    {
      "name": "date",
      "type": "date"
    },
    {
      "name": "signups",
      "type": "integer"
    }
  ]
}
```

AI 根本不需要猜：

- 哪个字段是日期；
- 哪个字段可以 `AVG()`；
- 是否需要字符串转换。

然后生成类似：

```sql
SELECT AVG(signups)
FROM table1
WHERE dayofweek(date) IN (0, 6)
```

这是 Table Schema 最强的使用场景之一：**LLM 负责理解 intent，Schema 提供 grounding，数据库负责确定性计算。**

---

## 2. Formula column

这个正是上一轮讨论的情况。

建议扩展：

```json
{
  "name": "revenue",
  "type": "number",

  "x-computed": {
    "expression": "quantity * unit_price",
    "language": "formula",
    "dependsOn": [
      "quantity",
      "unit_price"
    ]
  }
}
```

例如：

> Bucket age into increments of 10

生成：

```json
{
  "name": "age_bucket",
  "type": "string",

  "x-computed": {
    "expression": "...",
    "dependsOn": ["age"]
  }
}
```

Table Schema 规范允许 Field Descriptor 存在任意额外属性，因此这种 extension 与规范兼容。

但建议不要把公式语法本身设计成 Table Schema 的一部分。

应该是：

```text
Table Schema
     │
     ├── field exists
     ├── type
     └── metadata
            │
            ↓
      Formula Extension
```

---

## 3. Aggregate / Pivot

例如：

> Aggregate revenue by week, pivot by product

这其实不是 schema operation，而是：

```text
Table
 ↓
Transform
 ↓
New Table
```

我的建议是每次产生一个新的 **derived resource**：

```text
sales
  ↓
aggregate
  ↓
weekly_revenue
```

`weekly_revenue` 又拥有自己的 Table Schema：

```json
{
  "fields": [
    {
      "name": "week",
      "type": "date"
    },
    {
      "name": "product_a",
      "type": "number"
    },
    {
      "name": "product_b",
      "type": "number"
    }
  ]
}
```

同时另外保存：

```json
{
  "transform": {
    "type": "pivot",
    "source": "sales",
    "groupBy": ["week"],
    "columns": "product",
    "values": "revenue",
    "aggregate": "sum"
  }
}
```

**Transform 不应该放进 Table Schema。**

---

# 三、Join / Lookup 是 Table Schema 的优势项

Table Schema 原生有 `foreignKeys`：

```text
orders.product_id
       ↓
products.id
```

规范里的 FK 可以引用同一个 Data Package 内另一个 resource 的字段。

所以：

> Lookup product_id in Table2 and add price to Table1

AI 可以看到：

```json
{
  "foreignKeys": [
    {
      "fields": "product_id",
      "reference": {
        "resource": "products",
        "fields": "id"
      }
    }
  ]
}
```

然后自动：

```sql
SELECT
  orders.*,
  products.price
FROM orders
LEFT JOIN products
ON orders.product_id = products.id
```

这比普通 Spreadsheet 的：

```excel
=XLOOKUP(...)
```

其实更适合 AI。

因为 AI 看到的是：

```text
orders.product_id → products.id
```

而不是：

```text
B2 → Sheet2!A:A
```

---

# 四、AI classify / extract / enrichment

也很好做。

例如：

> Classify message into bug / support / feature request

AI 创建：

```json
{
  "name": "category",
  "type": "string",
  "constraints": {
    "enum": [
      "bug",
      "support",
      "feature_request"
    ]
  },
  "x-computed": {
    "kind": "ai",
    "dependsOn": ["message"],
    "prompt": "Classify message..."
  }
}
```

这里特别适合利用 Table Schema 的 `constraints.enum`。

AI 返回一个非法值：

```text
question
```

Schema validator 可以直接拒绝。

也就是：

```text
LLM
 ↓
candidate value
 ↓
Table Schema validation
 ↓
valid data
```

这就是一个很漂亮的 **LLM + deterministic schema validation** 架构。

---

# 五、图片/PDF → Table

也完全可行，但 Table Schema 位于流程的**后半段**：

```text
PDF / Image
    ↓
Vision / Document parser
    ↓
structured extraction
    ↓
schema inference
    ↓
Table Schema
    ↓
validation
    ↓
Table
```

所以 Table Schema 对 extraction 本身帮助不大，但非常适合处理 extraction 之后的数据。

---

# 六、Advanced Analysis

你的第二组包含预测、推断统计、Cohort 和多变量分析。

| Feature | 可行性 | Table Schema 适配度 |
|---|---|---:|
| Predictive modeling | **高** | ⭐⭐⭐ |
| Inferential analysis | **高** | ⭐⭐⭐⭐ |
| Cohort analysis | **高** | ⭐⭐⭐⭐⭐ |
| Multivariate analytics | **高** | ⭐⭐⭐ |

这里要特别注意：

> Table Schema 是 **data schema**，不是 **analysis schema**。

例如：

```text
revenue forecast
```

应该是：

```text
Table Schema
      ↓
analysis specification
      ↓
model
      ↓
predictions table
      ↓
Table Schema
```

类似：

```json
{
  "analysis": {
    "type": "forecast",
    "target": "revenue",
    "time": "date",
    "horizon": 3
  }
}
```

这应该放在独立的 Analysis DSL 中。

### Cohort Analysis 反而非常自然

例如：

```text
user_id
signup_date
event_date
event_type
```

Table Schema 可以帮助 AI 明确字段含义和类型，然后 query engine 完成：

```text
signup week
    ↓
cohort
    ↓
week 0 / week 1 / week 2 retention
```

产出另外一张 table。

---

# 七、真正需要谨慎的是 Manage Spreadsheet Elements

这一组最能暴露 Table Schema 的边界。你的需求包括 Table/Chart、cell/row/column、AI Cell、drag fill、multi-step 和 Page 管理。

| Feature | 产品可行性 | Table Schema 适配度 |
|---|---|---:|
| Manage Tables | **高** | ⭐⭐⭐⭐⭐ |
| Manage Charts | **高** | ⭐⭐ |
| Columns | **高** | ⭐⭐⭐⭐⭐ |
| Rows | **高** | ⭐⭐⭐ |
| Cells | **高** | ⭐ |
| Cell formula | **高** | ⭐ |
| Formatting/style | **高** | ⭐ |
| Freeze panes | **高** | ☆ |
| AI Cell | **高** | ⭐⭐ |
| Find/replace | **高** | ⭐⭐ |
| Drag-fill | **高** | ⭐ |
| Multi-step request | **高** | ⭐⭐⭐ |
| Pages / element layout | **高** | ☆ |

这就是为什么我不建议：

> Spreadsheet = Table Schema

而应该：

> **Table = Table Schema**

---

# 八、你需要在 Table Schema 外再做一个 Workbook Model

我建议类似：

```json
{
  "pages": [
    {
      "id": "page_sales",
      "title": "Sales",

      "elements": [
        {
          "id": "sales_table",
          "type": "table",
          "resource": "sales"
        },

        {
          "id": "revenue_chart",
          "type": "chart",
          "view": "revenue_by_month"
        }
      ]
    }
  ]
}
```

然后：

```text
Spreadsheet
│
├── Page
│   ├── Table
│   │    └── Table Schema
│   │
│   └── Chart
│
└── Page
    └── Table
         └── Table Schema
```

Data Package 本身其实已经提供了一些很好的思想：一个 package 可以包含多个 `resources`，而且 Data Package 允许增加自定义 metadata。

所以可以自然地设计成：

```text
Data Package
    ≈ Spreadsheet

Resource
    ≈ Table

Table Schema
    ≈ Table definition
```

这是我认为整个设计里最值得采用的映射。

---

# 九、Chart 不需要自己发明 Schema

Frictionless 其实曾设计过 **Data Package Views**，其中明确提出用 Vega、Vega-Lite、Plotly 等现有 visualization specification 描述图表。

甚至类似：

```json
{
  "specType": "vega-lite",
  "spec": {
    "mark": "bar",
    "encoding": {
      "x": {
        "field": "product"
      },
      "y": {
        "field": "revenue"
      }
    }
  }
}
```

这跟你的需求非常契合。

不过需要注意：官方 Views 页面目前标记的是 **1.0-beta**，而且规范很旧。

所以我的建议是：

**借它的架构思想，不要把产品强绑定到 Frictionless Views。**

直接：

```text
Table Schema
     +
Vega-Lite spec
```

更合理。

---

# 十、Cells 是最大的架构分界线

Table Schema 的逻辑单位是：

```text
Field
```

Spreadsheet 的逻辑单位是：

```text
Cell
```

两者不是一回事。

例如：

```text
     A          B           C
1   Price      Qty         Total
2   10         2           =A2*B2
3   20         3           =A3*B3
4   30         =SUM(B2:B3) ...
```

Table Schema 很容易表达：

```text
Price:number
Qty:number
Total:number
```

也容易表达：

```text
Total = Price × Qty
```

但：

```text
B4 = SUM(B2:B3)
```

就不再是 field-level semantics。

因此建议明确分成：

### Column Formula

```json
{
  "name": "total",
  "x-computed": {
    "expression": "price * qty"
  }
}
```

属于：

> Table semantic model

### Cell Formula

```json
{
  "cell": "B4",
  "formula": "SUM(B2:B3)"
}
```

属于：

> Spreadsheet grid model

**两套机制最好不要混在一起。**

---

# 十一、AI Cell 可实现，但我会稍微调整设计

你的定义是：

> `=anything` → AI 写公式或者创建 Chart。

技术上完全可以。

不过从语义上：

```text
=SUM(A1:A5)
```

到底是普通公式还是 AI request？

会变得比较模糊。

更干净的形式可能是：

```text
=AI("calculate margin")
```

或者：

```text
=AI(...)
```

对于 Table 场景甚至可以：

```text
=AI("classify @message")
```

AI 输出的不是直接文本，而是结构化 action：

```json
{
  "action": "addComputedColumn",
  "column": {
    "name": "margin",
    "type": "number",
    "expression": "(revenue-cost)/revenue"
  }
}
```

这样：

```text
User
 ↓
LLM planner
 ↓
Typed Action
 ↓
validator
 ↓
executor
```

比：

```text
User
 ↓
LLM
 ↓
直接改 spreadsheet
```

可靠得多。

---

# 十二、Multi-step request 非常适合 Agent 化

例如文件里的：

> Aggregate sales by week and plot on a column chart.

AI 可以规划成：

```json
[
  {
    "op": "aggregate",
    "source": "sales",
    "groupBy": ["week"],
    "metrics": [
      {
        "field": "revenue",
        "aggregate": "sum"
      }
    ],
    "output": "weekly_sales"
  },

  {
    "op": "createChart",
    "source": "weekly_sales",
    "chartType": "bar",
    "x": "week",
    "y": "revenue"
  }
]
```

这其实是整个产品 AI 能力最关键的抽象：

> **LLM 不操作 JSON/SQL/Cells，而是调用 Spreadsheet Operations。**

比如定义 20~30 个 operations：

```text
createTable
deleteTable

addColumn
removeColumn
renameColumn

setCell
setRange

addComputedColumn

filter
sort

aggregate
pivot

join
append
lookup

deduplicate
reconcile

createChart
updateChart

classify
extract
enrich

forecast
cluster
```

AI 就变成 tool-calling agent。

---

# 十三、Create Models

最后三个功能也没问题。

### Tables with real-world data

非常容易：

```text
AI / Web Search
    ↓
Rows
    ↓
Infer Schema
    ↓
Table Schema
    ↓
Table
```

### Tables with sample data

更容易：

```text
Table Schema
     ↓
LLM / faker
     ↓
rows
```

而且因为已经知道：

```json
{
  "type": "string",
  "format": "email"
}
```

生成 dummy data 会比纯 prompt 更可靠。

---

# 十四、Calculator 是稍微特殊的一类

例如：

> Build a 10y mortgage calculator.

它不是普通 data table，更像：

```text
inputs
  ↓
formula graph
  ↓
outputs
```

例如：

```text
Loan Amount    [500,000]
Interest Rate  [4%]
Term           [10]

Monthly Payment [computed]
Total Interest  [computed]
```

这就需要：

```text
Table Schema
      +
Formula Graph
      +
UI input/output metadata
```

例如：

```json
{
  "name": "interest_rate",
  "type": "number",

  "x-ui": {
    "role": "input",
    "display": "percentage"
  }
}
```

以及：

```json
{
  "name": "monthly_payment",
  "type": "number",

  "x-ui": {
    "role": "output"
  },

  "x-computed": {
    "expression": "..."
  }
}
```

所以也完全能做。

---

# 十五、我认为你真正需要的不是“扩展 Table Schema 一次”，而是四个独立规格

建议最终形成：

```text
Smart Spreadsheet Format
│
├── 1. Table Schema
│      原生 Frictionless
│
├── 2. Calculation Spec
│      computed column
│      cell formula
│      dependencies
│
├── 3. Transform Spec
│      filter
│      aggregate
│      pivot
│      join
│      lookup
│      ML/AI
│
└── 4. Workbook/View Spec
       pages
       tables
       charts
       styles
       layout
```

不要形成：

```text
Table Schema
 ├ formula
 ├ pivot
 ├ chart
 ├ styling
 ├ pages
 ├ ML
 ├ AI prompt
 └ ...
```

后者很快会失控。

官方规范自己的设计理念其实也支持这种“small pieces, loosely joined”：例如 Views 规范刻意把数据、transform 和 graph spec 分开。

---

# 十六、还有一个非常重要的东西：Lineage

如果产品有 AI，这部分我认为应该从第一版就设计。

例如用户：

> Add price from Products and calculate revenue.

最后形成：

```text
Products.price
      │
      │ lookup
      ▼
Orders.price
      │
      ├────────────┐
      │            │
Orders.quantity    │
      │            │
      └──────┬─────┘
             ↓
      Orders.revenue
```

保存：

```json
{
  "name": "revenue",

  "x-computed": {
    "expression": "quantity * price",

    "dependsOn": [
      "quantity",
      "price"
    ]
  }
}
```

以后 AI 就可以回答：

> revenue 是怎么来的？

甚至：

> 如果 products.price 更新，哪些数据会变化？

这是普通 Spreadsheet 很弱、但 AI-native Spreadsheet 可以明显做得更好的地方。

Frictionless 的 Patterns 文档也在探索 field relationship，但它目前的 `derived` 指的是字段间函数依赖，并不是“计算公式”；文档自己也说明当前 Table Schema 尚不能表达这种字段依赖，因此你的公式/lineage 扩展仍然需要自己定义。

---

# 十七、综合可行性

如果把你的 24 项能力放在一起，我会这样判断：

| 类型 | 结论 |
|---|---|
| 数据类型/字段语义 | **Table Schema 非常合适** |
| Constraints | **非常合适** |
| 多 Table relations | **非常合适** |
| AI grounding | **非常合适** |
| Query/analysis | **非常合适作为输入 Schema** |
| Computed columns | **需要小型扩展** |
| Transform / lineage | **需要独立 Spec** |
| Charts | **Vega-Lite 等独立 Spec** |
| Cell formulas | **需要 Spreadsheet model** |
| Styles/layout | **需要 Spreadsheet model** |
| Page/Workbook | **需要 Data Package + 自定义扩展** |
| ML/statistical analysis | **独立 Analysis layer** |
| PDF/Image extraction | **独立 AI ingestion layer** |

**功能层面，我看不到 features.md 中存在真正不可实现的项。**

最大的风险并不在 AI，也不在数据分析，而在：

> **如果你希望同时支持“结构化智能表格”和“Excel 式自由网格”，数据模型会迅速复杂化。**

因此我建议第一版明确采用 **Table-first，而不是 Cell-first**：

```text
Spreadsheet
   ↓
Pages
   ↓
Tables
   ↓
Fields
   ↓
Rows
```

而不是：

```text
Spreadsheet
   ↓
Sheets
   ↓
Cells
```

前一种架构会让 **Table Schema + AI** 的优势发挥得非常明显，也基本覆盖你现在 `features.md` 的核心价值。

如果按 MVP 排优先级，我会首先做 **Table Schema + Data Package + computed-column extension + transform DAG + Vega-Lite + AI typed operations**。这套最小内核实际上已经可以覆盖 quick stats、formula column、aggregate/pivot、join/lookup、dedup、reconcile、AI classify/enrich、chart 和 multi-step request，也就是你清单中最主要的一批能力。