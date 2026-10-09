# Workbook Core

Node.js 20+ ESM 包，负责 Table-first 领域模型、Workbook Bundle v1 与完整 Revision 档案。产品契约见 [proposal.md](../../docs/proposal.md) §4、§5、§31、§36、§49。

## 构建与回归验证

在仓库根目录执行：

```sh
npm ci --prefix packages/workbook-core
npm test --prefix packages/workbook-core
```

`test` 先严格编译 TypeScript，再运行 Node.js 内置测试。无需 Python、额外测试框架或外部服务。测试覆盖 15 类逻辑值及无损往返、保存目录保护、同/跨进程可控竞争、Revision 不可变历史、陈旧 base 与 transaction 去重、manifest/version/reference/path/alias、JSON 容器、导入资源预算和真实第三方 Parquet。全部文件写入及破坏性用例在独立临时目录中运行并清理。病态正则在子进程中验证，外部硬超时为 3 秒；每个测试还有 20 秒硬超时。

## 值与身份契约

- `number` 保存已有 JavaScript 有限 number，使用 DOUBLE；不会恢复进入 JavaScript 前已经丢失的整数精度。`integer` 限于 ±(2^53−1)，拒绝小数与范围外整数。所有 JSON 数值均须有限。
- JSON 对象只接受 plain 或 null prototype，且必须使用自有、可枚举的数据属性。拒绝类实例、Map、Date、typed array、undefined、bigint、函数、Symbol、getter、非枚举属性、稀疏数组、额外数组属性和循环。null prototype 在读回后可成为普通对象，逻辑值保持一致。
- 行值按 Field ID 使用自有属性取值；缺失字段写读为 `null`。直接 Parquet API 同样检查本地 Schema、行值和重复 Row ID；单表校验不解析远端外键，跨表解析属于 Workbook 校验。
- 外键使用 `fields` 和 `reference.fields`，其内容是稳定 Field ID。旧实现的 `fieldIds` 形状不再有效；请把已有草案中的这两个属性改名后重新验证。当前尚未发布正式 Bundle v1，规格原有 `fields` 形状保持不变。
- 生成器继续产生可读前缀；外部 ID 不要求前缀。可移植拼写为 `[A-Za-z0-9][A-Za-z0-9._~-]{0,159}`，实体种类由引用上下文和 TypeScript 品牌区分。
- Calculation 的 `targetField` 和 `dependsOn` 检查明确声明的 Field ID。P1 将 `expression` 作为 JSON 透传，不从任意字符串猜引用；DSL 文法及 AST 依赖解析交接 LVB-81。
- INT64 允许无注解、`INT_64`、`INTEGER(64,true)` 或二者一致的组合。timestamp、decimal、unsigned 和不一致注解拒绝。第三方 fixture 来源及生成方法见 [fixtures/README.md](test/fixtures/README.md)。

## 保存与并发边界

新目标正常初始化。替换已有目标前必须完整验证 Bundle（包含所有声明保留的历史），并核对目录树只包含 manifest/history 声明的文件及其容器目录。额外文件、额外空目录、symlink 和特殊文件均拒绝保存，旧内容保留。伪造 format 标记不算有效目标。工作目录及其祖先、文件系统根目录、根 symlink 也不能替换。普通保存拒绝覆盖 Revision 档案；只能用 `commitWorkbookRevision` 追加历史。

所有公开 Bundle 读取、初始化、保存与提交共享根目录同级的 `.<目录名>.workbook-lock` 目录锁。父目录先解析为真实路径，避免父目录 symlink 别名拆分锁。读取 head、检查 base/transaction、复制旧快照、生成新快照和发布都在持锁期间完成；根目录替换不会移动锁。同 base 的竞争提交最多一个成功，其他提交返回 `CONFLICT`。成功提交的快照不改写；所有读取也在持锁期间验证，避免拼接两个状态的文件。

等待锁最多 10 秒。锁不会因年龄被自动抢占。若进程崩溃留下锁，调用方收到 `CONFLICT`；操作者应确认没有活跃操作后手工清理残留锁。当前不承诺掉电/fsync 恢复；外部程序直接修改 Bundle 文件不会遵守本锁，调用方应保证受管目录没有外部并发写入。读取需要父目录的写权限来创建同级锁。

写入先完成临时目录、用完整读取器校验可读性及资源预算，再发布。失败不删除旧数据。发布中的备份用于恢复重命名失败；这里未实现 P5 的语义合并/rebase。

## 导入错误与资源预算

公开 Bundle API 返回 `WorkbookBundleError`，含可分类的 `code`、文件/实体诊断和原始 `cause`（若有底层错误）：

| code | 含义 |
| --- | --- |
| `INVALID_BUNDLE` | manifest/history 结构、引用或档案一致性不符 |
| `INVALID_PATH` | 不可移植路径、根 symlink 等 |
| `INVALID_DATA` | JSON、领域、Parquet 行值或显式实体 ID 无效 |
| `IO` | 缺文件、权限或文件读取期间变化 |
| `RESOURCE_LIMIT` | 导入字节、数量、深度、解码或时间预算超限 |
| `UNSUPPORTED_FORMAT` | 未支持版本或 required feature |
| `CONFLICT` | 陈旧 base、重复 transaction、锁等待超时 |
| `UNSAFE_DESTINATION` | 目标不能安全替换 |

领域校验仍返回 `ValidationIssue[]`；assert API 使用 `DomainValidationError`。直接适配器使用 `ParquetBundleDataError`（含 `INVALID_DATA` / `RESOURCE_LIMIT`）或类型错误。无关编程错误不会无条件包装。

| 默认预算 | 上限 |
| --- | --- |
| JSON 深度 / 节点 / 单容器条目 / 单字符串长度 / 累计文本 | 64 / 1,000,000 / 100,000 / 1,048,576 / 16,777,216 UTF-16 code units（含键名） |
| 单 JSON 文件 / 单 Parquet 文件 | 8 MiB / 64 MiB |
| 一次导入累计文件字节 / 文件数 | 256 MiB / 10,000，包含根状态和全部历史 |
| Revision 数 / 一次导入累计行数 | 256 / 1,000,000 |
| 单 Parquet 行数 / 列数 / 解码页预算 | 100,000 / 1,024 / 128 MiB |
| Parquet worker | 128 MiB old heap、16 MiB young heap、2 MiB stack、5 秒硬超时 |
| 单表行数 × 字段数的校验预算 | 1,000,000 |
| pattern 长度 / token 数 / subject 长度 / 累计匹配步数 | 1,024 / 256 / 65,536 / 2,000,000，每次领域校验/完整导入共享 |

Parquet 元数据与各页的尺寸/值数量在解码前检查；JSON 文件和表逐个读取/解码，worker 可终止。枚举约束预编译为规范值集合，避免逐行遍历所有候选值。预算不是整进程 RSS 保证，文件缓存、ArrayBuffer 和返回的 Workbook 会占用额外内存。所有历史仍完整验证，超限整体失败，不返回部分 Workbook。

`constraints.pattern` 使用无回溯 NFA 子集，支持字面量、`.`、字符类、`^`、`$`、`*`、`+`、`?`，以及 `\d`、`\s`、`\w` 等单字符转义。拒绝分组、alternation、lookaround、backreference、counted/lazy quantifier 和未支持转义；大小/步数超限返回校验问题。`^(a+)+$` 会在执行前拒绝。若旧草案用了完整 JavaScript RegExp，请改成支持的子集；扩展语法需保持可中断或非回溯执行边界。
