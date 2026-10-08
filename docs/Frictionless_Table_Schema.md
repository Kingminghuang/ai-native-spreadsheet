Frictionless **Table Schema** 可以理解成：

> **用一份 JSON，把 CSV / Excel / 数据表的“字段结构 + 类型 + 约束 + 主外键”描述清楚。**

它属于 Frictionless Data / Data Package 体系，目标是让表格数据不仅“能打开”，还可以被机器可靠地理解、校验、交换和导入数据库。官方规范将它定位为一种**语言无关、实现无关的表格 Schema 描述格式**。:chatgpt-content-reference{index="0"}

### 1. 最基本的例子

假设有一个 CSV：

```csv
id,name,age,email,created_at
1,Alice,28,alice@example.com,2026-09-20
2,Bob,35,bob@example.com,2026-09-21
```

对应的 Table Schema 可以写成：

```json
{
  "fields": [
    {
      "name": "id",
      "type": "integer"
    },
    {
      "name": "name",
      "type": "string"
    },
    {
      "name": "age",
      "type": "integer"
    },
    {
      "name": "email",
      "type": "string"
    },
    {
      "name": "created_at",
      "type": "date"
    }
  ],
  "primaryKey": "id"
}
```

核心就是 `fields`。规范要求 Table Schema descriptor 本身是 JSON object，并且必须包含 `fields` 数组；数组中的每一项描述一个字段。字段顺序通常对应 CSV 的列顺序。:chatgpt-content-reference{index="1"}

---

### 2. Field Descriptor：每个字段能描述什么

常用字段大致有：

```json
{
  "name": "age",
  "title": "年龄",
  "description": "用户年龄",
  "type": "integer",
  "constraints": {
    "required": true,
    "minimum": 0,
    "maximum": 150
  }
}
```

其中：

- `name`：机器使用的字段名
- `title`：给人看的名称
- `description`：字段含义
- `type`：数据类型
- `format`：进一步限定格式
- `constraints`：校验规则

Table Schema 不只是描述“这一列是什么类型”，还可以定义值的约束和格式，因此很适合做 CSV ingestion、数据交换以及数据质量检查。:chatgpt-content-reference{index="2"}

---

### 3. 支持的数据类型

常见类型包括：

```text
string
number
integer
boolean
date
datetime
time
year
yearmonth
duration
object
array
geojson
geopoint
any
```

例如：

```json
{
  "name": "price",
  "type": "number"
}
```

或者：

```json
{
  "name": "birthday",
  "type": "date",
  "format": "%Y-%m-%d"
}
```

它的一个重要设计思想是区分：

```text
Physical Representation
        ↓
Logical Representation
```

例如 CSV 里：

```csv
"2026-09-23"
```

物理上当然只是文本，但 Schema 定义：

```json
{
  "name": "date",
  "type": "date"
}
```

解析之后逻辑上就是一个 `date`。

这对于 CSV 特别重要，因为 **CSV 自己基本没有类型系统**。Table Schema 正好补上了这一层。:chatgpt-content-reference{index="3"}

---

### 4. Constraints 是它很实用的一部分

例如：

```json
{
  "name": "username",
  "type": "string",
  "constraints": {
    "required": true,
    "unique": true,
    "minLength": 3,
    "maxLength": 30
  }
}
```

数值字段：

```json
{
  "name": "score",
  "type": "number",
  "constraints": {
    "minimum": 0,
    "maximum": 100
  }
}
```

枚举：

```json
{
  "name": "status",
  "type": "string",
  "constraints": {
    "enum": [
      "pending",
      "active",
      "disabled"
    ]
  }
}
```

所以它可以承担一部分数据库 Schema / JSON Schema 类似的验证职责。官方也明确将 constraints 用于验证表格数据以及数据录入、更新场景。:chatgpt-content-reference{index="4"}

---

### 5. 主键和外键

Table Schema 不只描述独立字段，还能表达关系模型。

例如主键：

```json
{
  "fields": [
    {
      "name": "user_id",
      "type": "integer"
    }
  ],
  "primaryKey": "user_id"
}
```

也支持联合主键：

```json
{
  "primaryKey": [
    "order_id",
    "line_no"
  ]
}
```

外键则可以表达表间关系。

例如订单：

```csv
order_id,user_id,amount
1001,1,99.00
1002,2,199.00
```

Schema：

```json
{
  "fields": [
    {
      "name": "order_id",
      "type": "integer"
    },
    {
      "name": "user_id",
      "type": "integer"
    },
    {
      "name": "amount",
      "type": "number"
    }
  ],
  "primaryKey": "order_id",
  "foreignKeys": [
    {
      "fields": "user_id",
      "reference": {
        "resource": "users",
        "fields": "id"
      }
    }
  ]
}
```

这样：

```text
orders.user_id
       │
       ▼
users.id
```

关系也进入机器可读的 metadata 里。Table Schema 官方规范本身就支持表之间的关系描述。:chatgpt-content-reference{index="5"}

---

## 6. Table Schema 和 Data Package 的关系

这是理解 Frictionless 时最容易混淆的地方。

可以把整个体系看成：

```text
Data Package
│
├── Dataset metadata
│   ├── name
│   ├── title
│   ├── license
│   └── description
│
└── resources
    │
    ├── users.csv
    │   └── Table Schema
    │
    └── orders.csv
        └── Table Schema
```

也就是说：

**Data Package 描述“整个数据集”。**

**Table Schema 描述“其中的一张表”。**

官方的 Tabular Data Package 就是建立在 Data Package + Table Schema 等规范之上的。:chatgpt-content-reference{index="6"}

例如：

```json
{
  "name": "sales-data",
  "resources": [
    {
      "name": "orders",
      "path": "orders.csv",
      "schema": {
        "fields": [
          {
            "name": "order_id",
            "type": "integer"
          },
          {
            "name": "amount",
            "type": "number"
          }
        ],
        "primaryKey": "order_id"
      }
    }
  ]
}
```

Schema 既可以直接嵌进去，也可以放在独立 JSON 文件里然后引用。Data Resource 规范明确支持 `schema` 为内嵌 object 或指向 Schema 文件的 path/URL。:chatgpt-content-reference{index="7"}

---

## 7. 它和 JSON Schema 最大的区别

这个对比很重要：

| | Table Schema | JSON Schema |
|---|---|---|
| 主要对象 | 表格 | 任意 JSON |
| 核心模型 | rows × columns | object / array tree |
| CSV 友好度 | **非常高** | 一般 |
| 数据类型 | 有 | 有 |
| constraints | 有 | 更丰富 |
| primary key | **原生支持** | 非核心概念 |
| foreign key | **原生支持** | 非核心概念 |
| 表之间关系 | 支持 | 不擅长 |
| 嵌套对象 | 能力有限 | **非常强** |

例如：

```text
CSV / Excel / SQL table
        ↓
   Table Schema
```

非常自然。

而：

```text
REST API response
nested JSON
configuration
        ↓
   JSON Schema
```

通常更自然。

所以不要简单把 Table Schema 理解成“小号 JSON Schema”，它实际更接近：

> **一种可移植的 relational/table schema。**

---

## 8. 为什么它特别适合 AI / Agent

这其实是 Table Schema 今天一个很有意思的使用场景。

假设 Agent 收到：

```csv
10001,20260923,3,99.50
```

单凭数据几乎无法理解。

如果同时给它：

```json
{
  "fields": [
    {
      "name": "order_id",
      "type": "integer",
      "description": "订单编号"
    },
    {
      "name": "order_date",
      "type": "date",
      "description": "订单日期"
    },
    {
      "name": "quantity",
      "type": "integer"
    },
    {
      "name": "amount",
      "type": "number",
      "description": "含税订单金额，单位人民币"
    }
  ]
}
```

Agent 就得到了一个相当不错的**语义层**：

```text
Raw Data
   ↓
Table Schema
   ↓
typed + constrained + documented table
   ↓
Agent / SQL / Python / ETL
```

尤其适合你之前讨论过的那类 **“让 Agent 理解表格 / Office 数据结构”** 的场景。Table Schema 足够简单，LLM 阅读和生成都很容易，同时又比“只给 CSV header”包含更多语义。

---

## 9. 我认为它最有价值的定位

如果从工程角度总结：

```text
CSV
只有数据，没有 Schema

        +

Table Schema
字段 + 类型 + 约束 + 关系

        ↓

Self-describing tabular data
```

因此它很适合充当：

**CSV / Excel ↔ Python / SQL / Agent / Data Pipeline**

之间的一个中间描述层。

Frictionless Framework 本身也可以从已有数据推断 Schema，或者从 descriptor 创建 Schema，例如 `describe('table.csv', type='schema')`、`Schema.from_descriptor(...)` 等。:chatgpt-content-reference{index="8"}

如果你是在考虑 **“表格/Excel → 语义树 → Agent”** 这条路线，我会特别建议把 **Frictionless Table Schema、Arrow Schema、JSON Schema、SQL DDL** 放到一起比较；这四者分别解决的问题边界非常清楚，而 Table Schema 很可能正好适合作为其中的**轻量语义交换格式**。


Table Schema v1 的标准 `Field Descriptor` 没有 `formula`、`computed`、`derivedFrom` 之类的属性；标准主要描述字段的 `name / type / format / constraints` 等。好处是规范明确允许 Field Descriptor 包含任意额外属性，因此你可以定义自己的扩展。:chatgpt-content-reference{index="0"}

例如对于：

```text
quantity | unit_price | amount
---------|------------|-------
3        | 10.5       | 31.5
```

我会建议这样扩展：

```json
{
  "fields": [
    {
      "name": "quantity",
      "type": "integer"
    },
    {
      "name": "unit_price",
      "type": "number"
    },
    {
      "name": "amount",
      "type": "number",
      "calculation": {
        "expression": "quantity * unit_price",
        "language": "simple-expression",
        "dependsOn": [
          "quantity",
          "unit_price"
        ]
      }
    }
  ]
}
```

这里 `calculation` 是**你自己定义的扩展**，不是 Frictionless 标准属性。普通 Frictionless 工具仍然可以把 `amount` 当作 `number` 来理解，但是否理解和执行 `calculation`，取决于你的应用。

### Frictionless 确实还有一个 `derived` 提案，但不是公式

Frictionless 的 Patterns 文档里有一个 **“Relationship between Fields”** 的扩展提案，定义了：

```json
{
  "relationships": [
    {
      "fields": ["region", "population"],
      "link": "derived"
    }
  ]
}
```

但是这里的 `derived` 表达的是一种**函数依赖（functional dependency）**：

> 父字段的某个值只能对应子字段的一个值。

例如：

```text
country → country_code
France  → FR
Spain   → ES
```

它并不是：

```text
amount = quantity * unit_price
```

这种计算公式。官方文档本身也把它放在 proposed extension / field relationship 的语境里，而不是计算表达式语言。:chatgpt-content-reference{index="1"}

所以对于你说的 **Excel 公式衍生列**，这个 `relationships.link = "derived"` 并不能真正解决问题。

---

### 如果目标是 Excel / Agent，我建议比 `formula` 再多表达一层

例如原 Excel 是：

```excel
=C2*D2
```

不要只保存：

```json
{
  "formula": "=C2*D2"
}
```

因为 `C2`、`D2` 是**物理位置引用**，插一列以后语义就变了。

更适合 Agent / 中间语义表示的是：

```json
{
  "name": "amount",
  "type": "number",

  "calculation": {
    "kind": "formula",
    "expression": "quantity * unit_price",
    "dependsOn": [
      "quantity",
      "unit_price"
    ]
  }
}
```

如果你还需要做到 **Excel 无损 round-trip**，可以同时保留 Excel 原始公式：

```json
{
  "name": "amount",
  "type": "number",

  "calculation": {
    "kind": "formula",

    "expression": "quantity * unit_price",
    "dependsOn": [
      "quantity",
      "unit_price"
    ],

    "source": {
      "language": "excel",
      "formula": "=C2*D2"
    }
  }
}
```

这样就形成两层：

```text
Excel physical representation
        │
        │ =C2*D2
        ▼
┌──────────────────────┐
│ Semantic calculation │
│                      │
│ amount =             │
│ quantity * unit_price│
│                      │
│ dependsOn:           │
│ quantity             │
│ unit_price           │
└──────────────────────┘
        │
        ▼
Table Schema
```

这对 Agent 很有意义，因为 Agent 不需要知道：

> C 列是什么？D 列是什么？

而可以直接知道：

> `amount` 是由 `quantity` 和 `unit_price` 计算得到的。

### 如果要做成一个比较完整的 Schema，我甚至会这样设计

```json
{
  "fields": [
    {
      "name": "quantity",
      "title": "数量",
      "type": "integer",
      "constraints": {
        "minimum": 0
      }
    },
    {
      "name": "unit_price",
      "title": "单价",
      "type": "number"
    },
    {
      "name": "amount",
      "title": "金额",
      "type": "number",
      "calculation": {
        "kind": "derived",
        "expression": "quantity * unit_price",
        "language": "expr",
        "dependsOn": [
          "quantity",
          "unit_price"
        ],
        "materialized": true
      }
    }
  ]
}
```

其中几个概念最好分开：

- `kind: derived`：说明不是用户输入字段；
- `expression`：怎么算；
- `dependsOn`：字段依赖图；
- `language`：表达式使用什么语法；
- `materialized: true`：计算结果是否真的作为一个 cell/value 存在于表格中。

尤其最后一个非常有用，因为现实里有两种完全不同的情况：

```text
① Excel Formula Column

quantity | price | amount
3        | 10    | =A2*B2

amount 是实际存在的列
→ materialized: true
```

和：

```text
② Virtual / Calculated Field

quantity | price
3        | 10

Schema 定义 amount = quantity * price
但文件里根本没有 amount 列
→ materialized: false
```

而 **原生 Table Schema 更偏向①中的“实际存在的列”**：`fields` 通常对应数据文件中的真实 columns；规范明确说 `fields` 的顺序和数量应与 CSV 字段对应。:chatgpt-content-reference{index="2"}

如果你的目标确实是之前讨论的那种 **Excel/OOXML → 语义树 → Agent**，那么我认为这恰好暴露出 Table Schema 需要扩展的一个关键点：

```text
Table Schema
    +
Calculation / Lineage extension
    +
Excel physical metadata
```

会比单独用 Table Schema 更合适。

其中 **Calculation / Lineage 层**不仅可以表达公式，还能自然表达 `SUM`、跨 Sheet 引用、Lookup、Pivot 衍生值等。对于“让 Agent 修改 Excel 而不破坏公式依赖关系”来说，这一层甚至比 `type` 本身更重要。