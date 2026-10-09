# Workbook Core 评审复核与 Linear 跟踪建议

复核日期：2026-10-09（Asia/Shanghai）。原报告：[2026-10-09-workbook-core-staged-review.md](2026-10-09-workbook-core-staged-review.md)。

## 结论

原报告中的主要缺陷成立，但不能将全部 21 条都按同等严重的实现 bug 处理。C1、C2 必须优先修；I1、I3、I4 是值类型或可移植格式契约问题；M5 应从 Minor 升为重要的校验一致性问题；I2 的正则执行需要真正可中断的资源边界。M4 描述的后续 Object.assign 风险不能扩展成“当前已发生原型污染”；M5 的“写出即丢数据”需要修正；M8、M11、M12 的源码观察成立，但不能直接推导出必须添加 Parquet Table 身份、单表校验必须检查 Workbook 引用或全历史校验本身有错。

建议在 Linear 创建 **7 个 P1 修复/验证 issue，另 1 个兼容性后续 issue**，按问题边界合并，不逐条创建 21 个 issue。复核阶段仅完成核对和草案，未修改产品实现、原报告或暂存区；后续已按用户请求创建 8 个 issue，编号映射和核对结果见文末。

## 复核基线与方法

- 当前 HEAD：`1285a4e`；暂存区为 14 个文件，+2870 / −44，与原报告文件列表和增删行数一致。
- 本次使用 `git diff --cached --binary` 的 SHA-256：`38981475614a5ccf3994c8d710bd374af59bde51a2f2d9d5aa163f759b13f835`。原报告的短 index 指纹计算方式未说明，不能声称二者指纹相同。
- 当前受跟踪文件无未暂存差异。读取 workflow、角色索引、Integration and Review、Domain Model、Transaction and Concurrency instruction，以及 P1 子 issue 和 proposal 相关章节。
- Node.js `v22.23.1`；将当前 TypeScript 源码严格编译至临时目录，编译通过；临时产物与现有 `dist` 比对一致。
- 所有破坏性、并发和恶意输入复现都在独立临时目录执行；`.` 覆盖用例在子进程的临时工作目录执行。
- Regex 用例在有 8 秒外部超时的子进程执行；并发提交执行 60 轮。
- M9 使用本地 writer 构造显式合法整数注解的 Parquet 文件验证，未声称使用 pyarrow/DuckDB 产物做了端到端互操作。

## 逐项核对

| 原编号 | 复核结果与证据 | 修复判断 |
| - | - | - |
| C1 | **成立。** 已存在的普通目录中 `notes.txt` 被删除；对子进程临时 cwd 调用 `saveWorkbookBundle(..., '.')` 后，原文件消失，目录被 Bundle 内容替换。 | 最高优先级，阻塞 P1 安全交付。 |
| C2 | **成立。** 60 轮同 base 的并发提交，7 轮两个调用均成功，但历史仅保留其中一个返回的 revision；另外 53 轮失败方为裸 `Error:ENOENT`。 | 最高优先级，属于存储提交链缺陷，不能整体推迟至 P5。 |
| I1 | **成立。** `1.5` 通过；`1e16`、`1e21`、`1e300` 保存时报“must be a JSON value”。适配器能编码这些值，但自行解码失败。 | 高优先级，有限 DOUBLE 与安全整数规则必须分开。 |
| I2 | **成立。** `^(a+)+$` 对 26 个 `a` 加 `b` 的单次校验耗时约 **2209 ms**。源码每值重新编译，并在导入校验中同步执行。 | 外部 Bundle 导入前必须处理；仅缓存编译或限制 pattern 至 1024 字符不足以解决此用例。 |
| I3 | **成立。** 按 proposal §4 写 `fields`/`reference.fields` 得到两个校验错误；改为实现的 `fieldIds` 后通过。 | 高优先级；明确选定统一形状并同步规格、类型、示例与读写测试。 |
| I4 | **行为成立，规格冲突需要澄清。** `tbl_test` 合法，`01JTABLE` 被拒；proposal §36 将前缀描述为辅助阅读。 | 高优先级兼容性决策；按现有规格默认应让生成前缀与身份有效性解耦。类型安全仍可由类型品牌及引用上下文实现。 |
| I5 | **成立，但统一错误类型尚不是明确书面契约。** Transform 输入非法时为 `TypeError`，缺 Schema 文件为裸 `ENOENT`，非法 Parquet Row ID 为 `TypeError`；正常领域校验也会抛 `DomainValidationError`，适配器会抛自身错误。 | 值得修；先明确 Bundle 公共边界的错误分类，再添加上下文与 cause，不能凭类名推断现有全部失败已承诺同一类型。 |
| I6 | **成立，限直接适配器调用。** `undefined` 属性丢失，Date 转字符串，NaN/Infinity 变 null；`9007199254740993n` 变 `9007199254740992`，Uint8Array 变数组。主保存入口预先校验会拒绝这些值。 | 修复导出 API 的无损承诺，或明确收窄公开边界；不应当作主保存入口当前可直接造成相同损坏。 |
| I7 | **成立。** package scripts 仅 build，仓库没有对应测试和 CI。 | 建立测试入口和核心回归套件；CI 接入可按仓库交付方式决定，无需将 CI 缺失本身定为数据 bug。 |
| M1 | **成立，范围限适配器。** 解码返回两个同名 `row_one`；Workbook 校验拒绝重复 ID。 | 与 JSON/适配器边界修复合并，不另开独立小 issue。 |
| M2 | **成立，范围限适配器。** 构造 JSON 数值溢出的 Parquet，object 分支返回嵌套 Infinity；主 Workbook 校验仍会拒绝。 | 与 I6 合并，统一递归 JSON 校验。 |
| M3 | **成立。** `expression: {op:'literal', value:'fld_notreal'}` 被错当字段引用而拒绝；另一个无法识别的引用形式可通过。示例 AST 只用于证明启发式，当前没有冻结正式文法。 | P1 消除按字符串前缀猜依赖的行为，保留明确 `dependsOn` 的验证；正式 AST 文法与语义校验归 LVB-81，需 Operations 角色交接。 |
| M4 | **部分成立。** 自有 `constructor` 的函数值绕过未知扩展 JSON 校验；合法 JSON 的 `__proto__` 扩展会被接受。随后对它执行 `Object.assign({}, constraints)` 会改变该目标对象的原型。**仓库无相应 Object.assign 消费点，也未观察到全局原型污染。** | 修 `in` 的原型链判断和扩展值校验；将实际缺陷描述为校验漏洞，不声称已有全局污染利用链。 |
| M5 | **成立，影响比原定级更大，且丢数据描述需修正。** Map constraints 被接受、minimum 静默失效。继承的 `fld_value:1` 在 required、PK、minimum:10 下校验零错误，保存成功；再打开时报 minimum 失败。**Parquet 编码会读取继承值，并非该用例保存时必然丢值。** | 升为高优先级；拒绝不合约的容器并统一 own-property 取值，保障保存成功的状态可再次打开。 |
| M6 | **成立。** 2 万层嵌套使 `validateWorkbook` 抛裸 RangeError。该函数原契约是返回 issues，不能简单要求它一律抛 DomainValidationError。 | 与导入资源边界合并；保证深度/循环输入产生受控校验结果。 |
| M7 | **成立，主要是诊断质量。** 无效表名导致该表跳过行校验，另一表指向它时误报“不在 Workbook 中”。整体 Workbook 已无效，并未被误判为成功。 | 可在校验器修复时合并，非独立阻塞项。 |
| M8 | **死检查成立，真实格式缺口未成立。** decodeTableParquet 将传入 Schema ID 回填到 TableData，后续等值比较不能证明文件归属。现有 §49 未要求 Parquet 内嵌 Table ID；身份由 manifest 关联及稳定 Field/Row 列承担。 | 删除或更正误导性检查/注释即可；没有新增产品要求时不引入 Table ID 元数据或专门 issue。 |
| M9 | **合法注解拒绝已实测，第三方默认行为未验证。** 显式 `INT_64` 和 `INTEGER(64,true)` 都被拒。Apache 规范将 signed 64 位整数注解视为可选。DOUBLE/BOOLEAN 并不因此需要接受任意注解。 | 中优先级互操作改进；只允许语义等价的 signed INT64 注解，保持 timestamp/decimal/unsigned 的语义隔离。 |
| M10 | **NUL 行为成立，安全影响需收窄。** manifest 路径含 NUL 时抛裸 TypeError。其他控制字符在 POSIX 未必非法；`C:/...` 作为绝对盘符路径具有平台差异，不能据此声称当前可逃逸目录。 | 与路径错误规范化合并；明确可移植路径策略，不将其升级为已复现路径穿越。 |
| M11 | **行为成立，但不是独立 bug。** 单表 Schema 校验不验证远端 Table 是否存在，也不理会 specVersion；TableSchema 是无 specVersion 的领域形状，函数没有 Workbook 上下文。Bundle 读取器负责文档版本，Workbook 校验负责跨表引用。 | 补职责说明/调用方文档即可，不开修复 issue。 |
| M12 | **全量加载行为成立，缺陷定性不成立。** 当前读取会打开所有历史快照；proposal §31 明确要求任一声明保留的历史无效则整体导入失败。条目与行数未设上限是另外的资源边界问题。 | 本轮处理导入资源预算；懒加载/历史读取性能优化需先决定是否调整验证时机和现有契约，不阻塞当前功能正确性。 |

M9 规范依据：[Apache Parquet Logical Types — Signed Integers](https://parquet.apache.org/docs/file-format/types/logicaltypes/)。该规范明确说明 `INT(64,true)` 与 `INT_64` 对 int64 是可选注解。其他结论来自当前仓库及本机复现。

## 原报告建议需要修正的地方

1. C1：仅检查 `workbook.json` 存在、可解析或 format 字段匹配，不足以证明整个目录可销毁；合法 Bundle 目录也可能含用户额外文件。明确目录所有权及覆盖策略，默认拒绝不受管理的目标；测试目标为 cwd、普通目录、伪造 manifest、Bundle 中额外文件的情况。
2. C2：提交后复核再回滚不能替代提交前的序列化/CAS，且可能回滚另一调用方的成功提交。目录替换会移动根路径，锁若选择放在该根内会失去稳定协调位置；锁或协调点必须跨发布保持有效。仅写“串行调用”文档不能兑现公开 API 当前“不静默分支”的行为声明。
3. I1：有限 DOUBLE 的往返是保持已有 JavaScript number，不是承诺恢复输入前已经丢失的任意整数精度。纳秒时间戳若需逐整数精确，应另用精确整数/字符串表示；不要用 DOUBLE 支持作为此场景的精度保证。
4. I2：此次攻击 pattern 很短、subject 仅 27 字符。正则缓存、较宽松的长度上限及主线程 Promise 超时都不能中断同步 ReDoS；需可终止 worker/进程、受控正则子集或有适当语义限制的非回溯引擎等真正的执行边界。
5. I5：可选择在 Bundle API 统一 WorkbookBundleError 并保留 cause；独立 domain/adapter API 则维持各自结构化错误。不要把无关的编程错误无条件吞掉。

## Linear 现状

复核时查询本项目全部 27 个 issue，结果 `hasNextPage: false`：当时没有专门覆盖本次发现的修复 issue。

- [LVB-77](https://linear.app/lvbingwu123/issue/LVB-77)：Done；领域模型与稳定 ID。
- [LVB-78](https://linear.app/lvbingwu123/issue/LVB-78)：Done；Bundle 持久化/导入。
- [LVB-79](https://linear.app/lvbingwu123/issue/LVB-79)：Done；Revision 快照/历史。
- [LVB-72](https://linear.app/lvbingwu123/issue/LVB-72)：Backlog；P1 父阶段。
- [LVB-81](https://linear.app/lvbingwu123/issue/LVB-81)：Backlog；表达式与字段依赖。
- [LVB-92](https://linear.app/lvbingwu123/issue/LVB-92)：Backlog；P5 的语义冲突检测/Rebase，不能替代 C2 的底层防丢提交。

现有子 issue 已 Done，追加缺陷 issue 关联它们，保持原交付记录；不自动重开原 issue 或更改其状态。所有新 issue 按 workflow 初始放 Backlog；输入和依赖确认后再进入 Todo。以下 R1–R8 是草案编号，创建后的 Linear ID 映射见文末。

## 可创建的 issue 草案

### R1：保护 Workbook Bundle 保存目标，避免删除非受管内容

- 优先级：Urgent。父阶段：LVB-72；关联 LVB-78。角色：Domain Model。
- 覆盖：C1。
- 目标：保存前明确目标目录所有权及覆盖策略，避免把“存到这里”变成销毁原目录内容。
- 验收：目标 cwd、普通目录、伪造 format 标记目录不能被无提示替换；已存在 Bundle 内额外文件有明确保留/拒绝策略；失败不删除旧数据；受管 Bundle 正常更新与初始化正常工作；覆盖路径均有回归测试。

### R2：序列化 Revision 提交，确保成功 revision 永久可读

- 优先级：Urgent。父阶段：LVB-72；关联 LVB-79、LVB-92。主角色：Domain Model；交接 Transaction and Concurrency。
- 覆盖：C2。
- 目标：将读 head、校验 base/transaction、构造历史、发布包纳入有效的单写者边界；保证目录替换时协调状态仍有效。
- 验收：同一 base 的两个竞争提交最多一个成功，或按明确重放规则形成完整串行链；任何成功返回的 revision 及其历史快照都能读取；历史快照不被改写；失败可分类且带上下文；覆盖同进程和不同进程竞争，并用可控竞态测试替代只凭随机循环通过；不在此 issue 实现完整 P5 语义 rebase。

### R3：区分有限 DOUBLE 与安全 integer 的值契约

- 优先级：High。父阶段：LVB-72；关联 LVB-77、LVB-78。角色：Domain Model。
- 覆盖：I1。
- 目标：在 domain、Bundle JSON 检查、adapter 统一 number 语义；integer 保持 JS 安全整数范围。
- 验收：number 的 `1.5`、`1e16`、`1e21`、`1e300` 可保存和读取；integer 的 ±(2^53−1) 可读写，±2^53 与小数明确拒绝；NaN/Infinity 明确拒绝；metadata 和嵌套 JSON 中的有限 number 一致；错误消息正确说明类型或范围问题。

### R4：统一 Foreign Key、稳定 ID 与显式依赖的可移植契约

- 优先级：High。父阶段：LVB-72；关联 LVB-77、LVB-78、LVB-81。主角色：Domain Model；表达式交接 Operations。
- 覆盖：I3、I4、M3。
- 目标：让 proposal、模型、JSON 形状和读取行为一致；停止通过任意字符串前缀猜测表达式依赖。
- 验收：规格中的 FK 示例可构造、保存、读回；生成器可继续加前缀，是否允许无前缀 ID 有明确规格且有互操作用例；重命名保持 ID 引用；字符串常量不会被误判为 Field 引用；`dependsOn` 中明确声明的未知 Field 被拒；正式 AST 文法/依赖解析留给 LVB-81，不在 P1 悄悄冻结另一套语法。

### R5：统一 JSON 容器与 Parquet 适配器的无损校验

- 优先级：High。父阶段：LVB-72；关联 LVB-77、LVB-78。角色：Domain Model。
- 覆盖：I6、M1、M2、M4、M5；M7 可顺带改善。
- 目标：对 constraints、row values 和 JSON 逻辑列使用一致的 plain/null-prototype 容器与递归 JSON 值规则，避免继承属性绕过约束和序列化后语义改变。
- 验收：Map/类实例 constraints 与继承 row values 按明确策略拒绝；known-key 检查不走原型链；未知扩展值必须是 JSON；直接 adapter 调用不能静默丢 undefined、改 Date/NaN/Infinity/bigint/typed array；object/geojson/geopoint 内嵌值与 array/any 同样校验；重复 Row ID 有明确 adapter 契约；合法保存状态可再次读回；不声称已存在全局原型污染。

### R6：建立 Bundle 导入的错误与资源边界

- 优先级：High。父阶段：LVB-72；关联 LVB-77、LVB-78、LVB-79。角色：Domain Model。
- 覆盖：I2、I5、M6、M10；M12 中资源预算部分。
- 目标：损坏或恶意 Bundle 在可控资源内整体失败，并返回调用方可分类、包含文件/实体上下文的错误。
- 验收：明确 Bundle 公共错误分类并保留 cause，覆盖缺文件、非法 row/reference、NUL 路径、领域/Parquet 校验；正则执行具有真实可中断/非回溯边界，病态短 pattern 不长时间阻塞主线程；深度/循环及输入大小有明确策略；validateWorkbook 的失败保持其返回 issues 的契约；资源上限下不返回部分 Workbook；全历史一致性规则继续满足，懒加载性能优化不混入此修复。

### R7：建立 workbook-core 测试入口与持久化回归套件

- 优先级：High。父阶段：LVB-72；关联 LVB-77、LVB-78、LVB-79。角色：Domain Model；验收 Integration and Review。
- 覆盖：I7 及本次确认缺陷的长期回归证据。
- 目标：为 P1 交付建立可重复执行的验收，而非只记录本机一次性复现。
- 验收：提供 test 入口和使用说明；覆盖领域模型/15 类逻辑值、无损往返、manifest/version/reference、路径/别名、Revision 历史/陈旧 base/transaction 去重，以及 R1–R6 的错误场景；所有破坏性测试仅运行在独立临时目录；并发用例可控、正则用例有外部硬超时；严格编译与回归套件均通过后才能作为验收证据。测试基础设施可先做，新增缺陷用例随各修复提交，不把已知失败掩盖成通过。

### R8：兼容合法的 signed INT64 Parquet 注解并验证互操作

- 优先级：Medium。父阶段：LVB-72；关联 LVB-78，后续计算接入参考 LVB-99。角色：Domain Model。
- 覆盖：M9。
- 目标：允许 Apache 规范中与裸 INT64 语义等价的 `INT_64` 和 `INTEGER(64,true)`。
- 验收：带上述注解、相同稳定 ID 列的文件成功导入；JS integer 仍拒绝超安全范围；timestamp/decimal/unsigned 等不同语义不会仅凭相同物理类型通过；至少补一个真实第三方 writer fixture；记录来源与生成方式，避免预设所有 pyarrow 版本都会默认写该注解。

## 推进顺序

先建立 R7 的测试入口，再修 R1、R2；R3–R6 作为 P1 收尾修复依次完成，各带回归测试；R8 可留兼容性 Backlog。R4 的正式 AST 部分交接 LVB-81；M12 的历史读取性能问题随真实规模与资源预算再评估。多个 issue 会修改同一批文件，应按 workflow 串行落地，避免同时修改。

完整状态复核不等于证明所有生产风险已消除：本轮未做跨平台、进程崩溃/掉电恢复、大规模性能或真实第三方全 Bundle 导入测试；并发复现比例是本机观测，不是对其他环境的概率预测。

## Linear 创建记录

2026-10-09，按用户“按草案创建 Linear issues”的请求执行。创建前再次检查项目全部 issue，未发现对应重复项。已创建并读取核对以下 8 个 issue，均属于 ai-native-spreadsheet 项目、父阶段 LVB-72，状态为 Backlog。每个 issue 包含复核证据、范围、验收标准、角色 instruction、规格章节和来源报告，并按草案设置 relatedTo 关联。

| 草案 | Linear issue | 标题 | 优先级 | 状态 |
| - | - | - | - | - |
| R1 | [LVB-107](https://linear.app/lvbingwu123/issue/LVB-107/保护-workbook-bundle-保存目标避免删除非受管内容) | 保护 Workbook Bundle 保存目标，避免删除非受管内容 | Urgent | Backlog |
| R2 | [LVB-108](https://linear.app/lvbingwu123/issue/LVB-108/序列化-revision-提交确保成功-revision-永久可读) | 序列化 Revision 提交，确保成功 revision 永久可读 | Urgent | Backlog |
| R3 | [LVB-109](https://linear.app/lvbingwu123/issue/LVB-109/区分有限-double-与安全-integer-的值契约) | 区分有限 DOUBLE 与安全 integer 的值契约 | High | Backlog |
| R4 | [LVB-110](https://linear.app/lvbingwu123/issue/LVB-110/统一-foreign-key稳定-id-与显式依赖的可移植契约) | 统一 Foreign Key、稳定 ID 与显式依赖的可移植契约 | High | Backlog |
| R5 | [LVB-111](https://linear.app/lvbingwu123/issue/LVB-111/统一-json-容器与-parquet-适配器的无损校验) | 统一 JSON 容器与 Parquet 适配器的无损校验 | High | Backlog |
| R6 | [LVB-112](https://linear.app/lvbingwu123/issue/LVB-112/建立-bundle-导入的错误与资源边界) | 建立 Bundle 导入的错误与资源边界 | High | Backlog |
| R7 | [LVB-113](https://linear.app/lvbingwu123/issue/LVB-113/建立-workbook-core-测试入口与持久化回归套件) | 建立 workbook-core 测试入口与持久化回归套件 | High | Backlog |
| R8 | [LVB-114](https://linear.app/lvbingwu123/issue/LVB-114/兼容合法的-signed-int64-parquet-注解并验证互操作) | 兼容合法的 signed INT64 Parquet 注解并验证互操作 | Medium | Backlog |

LVB-107–112 标注 Bug；LVB-113–114 标注 Improvement。全部包含 Domain Model Agent 标签；LVB-108 另含 Transaction and Concurrency Agent，LVB-110 另含 Operations Agent，LVB-113 另含 Integration and Review Agent。LVB-113 还关联 LVB-107–112，明确对应的修复回归范围。

现有 issue 状态保持不变，未设置负责人或截止日期。未将“完整回归套件验收完成”作为所有修复的阻塞前置，避免形成循环依赖；测试入口先行、修复与回归用例随后推进。


## 修复交付记录

2026-10-09，按用户请求完成 LVB-107–114 的本地修复与长期回归。验收映射、独立复核、兼容性和交接见 [修复与验收记录](2026-10-09-workbook-core-bug-fixes.md)。严格编译及 50/50 测试通过；原暂存区指纹不变，Linear 状态未修改。
