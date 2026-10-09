# Workbook Core 暂存区代码评审报告

| 项目 | 内容 |
| - | - |
| 评审日期 | 2026-10-09（Asia/Shanghai） |
| 仓库 | `ai-native-spreadsheet` |
| 分支 / HEAD | `main` / `1285a4e`（Init） |
| 评审对象 | `git diff --cached`（暂存区 index） |
| 评审基线 | index 指纹 `8b906d3fa184b48f`；14 个文件，+2870 / −44 |
| 范围 | 仅暂存区改动；未纳入未暂存、未跟踪或分支差异 |
| 结论 | **不建议直接提交**；至少需先修 C1、C2、I1、I3 |

## 1. 评审范围与验证方式

暂存区内容为：新增 `packages/workbook-core` 包（Workbook Bundle v1 持久化契约的首个实现，1331 + 724 + 287 行 TypeScript），以及同步修改的 `docs/proposal.md`（新增 Bundle v1 合约、稳定 ID 规则、Revision 身份与历史档案等章节）、`docs/workflow.md`、`agents/README.md`、`agents/domain-model.md`。

评审时 index 与工作区完全一致（无未暂存、无未跟踪改动），因此行号可直接对应到暂存内容。

验证方式：

1. `tsc` 以严格模式编译通过（`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`）。
2. 将 `src` 重新编译到 `/tmp` 并与 `dist` 逐字节比对一致，确认后续行为测试跑在真实产物上。
3. 在 `/tmp` 下编写脚本对编译产物执行 60+ 个行为用例：往返保真、篡改检测、路径穿越、并发提交、恶意输入、数值边界、文档形状一致性等。
4. 所有结论除明确标注外，均为本机实测复现；未改动 index、未提交、未新增仓库文件。

## 2. 严重问题（Critical）

### C1. `saveWorkbookBundle` 会递归删除整个目标目录，而非仅覆盖 Bundle

涉及：[bundle.ts:163–189](../../packages/workbook-core/src/bundle.ts#L163-L189)、[bundle.ts:895–920](../../packages/workbook-core/src/bundle.ts#L895-L920)

唯一的前置检查是「目标不能是文件系统根」（[bundle.ts:172–175](../../packages/workbook-core/src/bundle.ts#L172-L175)）。目标已存在时执行 `rename(目标 → .backup-*)` → `rename(临时目录 → 目标)` → `rm -rf(backup)`（[bundle.ts:912–919](../../packages/workbook-core/src/bundle.ts#L912-L919)），**不判断目标是否为合法 Bundle**。

实测结果：

- 目标目录内的无关文件 `user-notes.txt` 被静默删除；
- `saveWorkbookBundle(draft, ".")` 直接替换当前工作目录——调用方脚本与目录本身一并消失，旧内容不可恢复；
- 与 [initializeWorkbookRevisionArchive](../../packages/workbook-core/src/bundle.ts#L251-L253) 明确拒绝「已存在目标」的行为自相矛盾（二者复用同一条发布路径）。

**为什么重要**：不可恢复的数据丢失，触发条件只是一个很自然的调用（“存到这里”），而文档注释从未说明目标是破坏性替换。`publishRevisionArchive` 也复用同一路径。

**建议**：替换前要求目标不存在，或包含可解析且 `format === WORKBOOK_BUNDLE_FORMAT` 的 `workbook.json`，否则抛错；或增加显式 `overwrite: true` 并写入 JSDoc。

### C2. 并发 `commitWorkbookRevision` 会丢更新，且失败方收到原始 fs 错误

涉及：[bundle.ts:262–301](../../packages/workbook-core/src/bundle.ts#L262-L301)

`baseRevisionId` 校验（[bundle.ts:273](../../packages/workbook-core/src/bundle.ts#L273)）与发布（[bundle.ts:299](../../packages/workbook-core/src/bundle.ts#L299)）不是原子操作，中间没有目录锁。

实测（同一目录两次并发提交，共 36 轮）：**3 轮出现两个调用方都返回成功，但磁盘索引只剩一个 revision**——另一个已返回的 `revisionId` 永远无法读取；其余失败轮次抛的是原始 `ENOENT ... rename` / `ENOTEMPTY`（来自 [publishDirectory](../../packages/workbook-core/src/bundle.ts#L895-L920) 的竞争），而非 `WorkbookBundleError`。

**为什么重要**：`docs/proposal.md` 明确要求「一个 Workbook 只有一个权威提交 head」「不得产生未标明关系的并行 head」，实现也确实做了 base 校验（说明有意并发安全），但校验非原子，最终以静默丢失已提交 Revision 收场。

**建议**：目录级锁（lockfile / `O_EXCL`）；或发布后复核 head 并在不一致时回滚并报错；至少要把失败统一包成 `WorkbookBundleError`，并在 API 文档中声明必须串行调用。

## 3. 重要问题（Important）

### I1. `number`(DOUBLE) 的取值被隐式限制为 |v| < 2^53，与文档映射表冲突

涉及：[validation.ts:57](../../packages/workbook-core/src/validation.ts#L57)、[validation.ts:387](../../packages/workbook-core/src/validation.ts#L387)、[bundle.ts:1287](../../packages/workbook-core/src/bundle.ts#L1287)、[parquet-adapter.ts:215](../../packages/workbook-core/src/parquet-adapter.ts#L215)

`Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v))` 的写法，会把**所有 |v| ≥ 2^53 的有限 double 全部拒绝**（该量级的 double 必然没有小数部分）。

实测（保存路径）：`1e16`、`1e21`、`1.7e18`、`1e300` 全部被拒，错误信息是 **"must be a JSON value"**（它们当然是合法 JSON 值）；`1e15 + 0.5` 反而通过。读取路径同样拒绝：`Column '...' contains a number that cannot be represented safely`。此外**写读不对称**：`encodeTableParquet` 接受 `1e21`，自己的 `decodeTableParquet` 却拒绝。

**为什么重要**：`docs/proposal.md` 的类型映射表写的是 `number` → `DOUBLE`，没有任何范围限制；DOUBLE 对这些值完全无损（JSON 往返也精确）。结果是纳秒时间戳、科学计数等正常数据永远无法写入或导入，且错误信息误导。

**建议**：`number` 接受任意有限 double；safe-integer 规则只保留给 `integer`（[validation.ts:389](../../packages/workbook-core/src/validation.ts#L389) 已正确）；为整数越界单独给出错误信息；同步 [parquet-adapter.ts:275](../../packages/workbook-core/src/parquet-adapter.ts#L275)。

### I2. ReDoS：用户提供的 `constraints.pattern` 被无界执行

涉及：[validation.ts:501](../../packages/workbook-core/src/validation.ts#L501)（编译检查仅在 [validation.ts:149–162](../../packages/workbook-core/src/validation.ts#L149-L162)）

只校验正则能否编译，没有 pattern 长度上限、没有 subject 长度上限、没有时间上限，且每个值都重新 `new RegExp(...)`。

实测：`pattern = "^(a+)+$"`，subject 为 `"a".repeat(26) + "b"` 时单次校验耗时 **2.2 s**（每加 1 个字符翻倍，n≈40 即为小时级）。而 bundle 导入必经 [assertValidWorkbook](../../packages/workbook-core/src/bundle.ts#L378)，因此恶意或损坏的 bundle 可以让导入永久挂起。

**为什么重要**：这是导入路径上的可用性问题（DoS）。若明确只导入可信 bundle，可降级为 Minor，但需在文档中写明；若会导入外部来源的 bundle，则应视为严重问题。

**建议**：限制 pattern 长度（如 1024）与 subject 长度，按 Field 编译一次；必要时再加时间或 worker 上限。

### I3. 文档与实现的 Foreign Key JSON 形状不一致（同一提交内自相矛盾）

涉及：[model.ts:69–77](../../packages/workbook-core/src/model.ts#L69-L77)、[validation.ts:306–341](../../packages/workbook-core/src/validation.ts#L306-L341) 与 [proposal.md](../proposal.md) §4 新增片段

本次提交在 proposal §4 新增的形状是：

```json
{ "fields": ["fld_customer_id"], "reference": { "tableId": "tbl_customers", "fields": ["fld_id"] } }
```

实现要求的是 `fieldIds` / `reference.fieldIds`。实测：**按文档写出的 schema 被 `DomainValidationError` 拒绝**（`must be a non-empty array of Field IDs`），只有 `fieldIds` 写法能通过。

**为什么重要**：`docs/proposal.md` 是产品的事实来源（见 [AGENTS.md](../../AGENTS.md)），而 Bundle 的卖点是可移植；按文档实现或导出的 bundle 直接不可读。

**建议**：二者统一，并在 §4 与 `model.ts` 之间保持一致。

### I4. ID 前缀被当成身份规则，违反 proposal §36

涉及：[ids.ts:25–69](../../packages/workbook-core/src/ids.ts#L25-L69)、[validation.ts:201](../../packages/workbook-core/src/validation.ts#L201)/[249](../../packages/workbook-core/src/validation.ts#L249)/[416](../../packages/workbook-core/src/validation.ts#L416)、[bundle.ts:1276](../../packages/workbook-core/src/bundle.ts#L1276)

`isSemanticId` 强制要求 `wb_`/`pg_`/`tbl_`/`fld_`/`row_`/`rev_` 前缀。实测：把 table id 换成 `01JTABLE` 即被拒。而 §36 明确写「字符串前缀可帮助阅读……**但不是身份的一部分，也不决定身份规则**」。

**为什么重要**：可移植 Bundle 的互操作被收紧到本实现的命名习惯上；前缀缺失或不同的实现写出的合法 bundle 无法导入。

**建议**：前缀仅作为生成建议（`createSemanticId` 继续添加），校验只保留长度、字符集与唯一性；或修改 §36 的措辞。

### I5. 错误类型逃逸 `WorkbookBundleError`

涉及：[bundle.ts:1194](../../packages/workbook-core/src/bundle.ts#L1194)、[1201–1202](../../packages/workbook-core/src/bundle.ts#L1201-L1202)、[1207–1208](../../packages/workbook-core/src/bundle.ts#L1207-L1208)、[1243](../../packages/workbook-core/src/bundle.ts#L1243)、[1248](../../packages/workbook-core/src/bundle.ts#L1248)、[parquet-adapter.ts:123](../../packages/workbook-core/src/parquet-adapter.ts#L123)、[bundle.ts:305](../../packages/workbook-core/src/bundle.ts#L305)/[1088](../../packages/workbook-core/src/bundle.ts#L1088)

未加保护的 `parseSemanticId` 会抛裸 `TypeError`，`resolveExistingFile` 里的 `realpath`/`stat` 会抛原始 `ENOENT`。实测：非法 `_row_id` → `TypeError: Invalid row ID.`；transform `inputs: ["nope"]` → `TypeError: Invalid table ID.`；缺失条目文件 → `Error: ENOENT ... realpath`；并发下 `ENOTEMPTY`。

**为什么重要**：契约要求导入失败「清楚且整体失败」；只 catch `WorkbookBundleError` 的调用方会把损坏的外部文档误判为内部 bug，且消息不带文档路径或字段上下文。

**建议**：这些站点统一 try/catch 后重抛 `WorkbookBundleError`（附 label），`resolveExistingFile` 同样包装。

### I6. 公开导出的 `encodeTableParquet` 会静默改写 JSON 类值

涉及：[parquet-adapter.ts:183–196](../../packages/workbook-core/src/parquet-adapter.ts#L183-L196)（配合 [parquet-adapter.ts:47](../../packages/workbook-core/src/parquet-adapter.ts#L47)）

`object`/`array`/`geojson`/`geopoint`/`any` 分支只做浅层类型判断，随后 hyparquet-writer 内部走 `JSON.stringify(toJson(...))`。实测直接调用该导出函数：

- `{u: undefined, d: new Date(...)}` → `{"d":"2026-01-01T00:00:00.000Z"}`（`u` 静默丢失）
- `{n: NaN, i: Infinity}` → `{"n":null,"i":null}`
- `bigint` 精度丢失、`Uint8Array` 变普通数组

`saveWorkbookBundle` 路径会先被 `assertValidWorkbook` 拦下（实测确认），所以风险面是**直接使用适配器的调用方**；但读侧的 `any` 却做递归 JSON 校验（[parquet-adapter.ts:241–243](../../packages/workbook-core/src/parquet-adapter.ts#L241-L243)），写读规则不一致。

**建议**：写入前用递归 `isJsonValue` 校验并抛 `ParquetBundleDataError`（指名 Field）。

### I7. 全新持久化契约没有任何测试

涉及：[package.json:23–25](../../packages/workbook-core/package.json#L23-L25) 只有 `build`；`src` 下无 `*test*`/`*spec*`；仓库无 CI 配置。

本次新增 1331 + 724 + 287 行，且 C1、C2、I5 都属于「写几个用例就能拦下」的缺陷。最小用例集建议见第 6 节。

## 4. 次要问题（Minor）

- **M1. `_row_id` 唯一性未在适配器内校验**（[parquet-adapter.ts:108–126](../../packages/workbook-core/src/parquet-adapter.ts#L108-L126)，注释却声称严格校验）：实测重复 `_row_id` 原样返回；bundle 路径靠 [validation.ts:419–424](../../packages/workbook-core/src/validation.ts#L419-L424) 兜住（实测报 `DomainValidationError`）。
- **M2. `object`/`geojson`/`geopoint` 使用浅层 `isJsonObject`**（[parquet-adapter.ts:229–240](../../packages/workbook-core/src/parquet-adapter.ts#L229-L240)、[265–271](../../packages/workbook-core/src/parquet-adapter.ts#L265-L271)），与 `array`/`any` 的递归校验不一致；JSON 文本 `1.0e999` 解析出的 `Infinity` 可穿过适配器（bundle 路径仍会被拦下）。
- **M3. `findFieldIds` 启发式**（[bundle.ts:1147](../../packages/workbook-core/src/bundle.ts#L1147)、[1223–1240](../../packages/workbook-core/src/bundle.ts#L1223-L1240)）：表达式里的普通字符串字面量 `"fld_notreal"` 会被当作字段依赖而拒绝（实测），而其他形式的引用又完全不校验。
- **M4. `validateConstraints` 用 `key in {...}` 判断已知键**（[validation.ts:170–175](../../packages/workbook-core/src/validation.ts#L170-L175)）：`constructor`/`toString`/`__proto__` 经原型链绕过 JSON 检查（JSON 可达），且 `__proto__` 自有属性会污染后续 `Object.assign` 合并。建议改用 `Object.hasOwn` 或 `Set`。
- **M5. 容器校验与原型链读取不一致**（[validation.ts:119](../../packages/workbook-core/src/validation.ts#L119)/[426](../../packages/workbook-core/src/validation.ts#L426) 用 `isRecord`，而 [452](../../packages/workbook-core/src/validation.ts#L452)/[458](../../packages/workbook-core/src/validation.ts#L458) 走原型链）：实测 `Map` 当 `constraints` → `minimum` 静默失效；`Object.create({...})` 当 row values → required/PK 被继承属性满足，且 `JSON.stringify` 后值为 `{}`（写出即丢数据）。
- **M6. 递归无深度上限**（[validation.ts:54–72](../../packages/workbook-core/src/validation.ts#L54-L72)、[530–537](../../packages/workbook-core/src/validation.ts#L530-L537)）：2 万层嵌套使 `validateWorkbook` 抛裸 `RangeError`（实测），而非 `DomainValidationError`。
- **M7. schema 校验失败的表不注册**（[validation.ts:617–624](../../packages/workbook-core/src/validation.ts#L617-L624)）：实测指向该表的 FK 会误报 `does not reference a Table in this Workbook`，且该表所有行级校验被跳过。
- **M8. 死校验掩盖真实缺口**（[bundle.ts:367](../../packages/workbook-core/src/bundle.ts#L367)、[349–354](../../packages/workbook-core/src/bundle.ts#L349-L354)、[521](../../packages/workbook-core/src/bundle.ts#L521)）：`data.tableId !== tableId` 恒为假——Parquet 文件不携带表身份，适配器只是回填传入 schema 的 id；实际「无法验证 Parquet 归属」这一点被这行代码掩盖。
- **M9. `matchesParquetType` 宽严不对称**（[parquet-adapter.ts:249–263](../../packages/workbook-core/src/parquet-adapter.ts#L249-L263)）：INT64/DOUBLE/BOOLEAN 要求完全无注解，第三方（pyarrow 常写 `INTEGER(64,true)` / `INT_64`）的同物理类型文件会被拒；STRING 分支却接受注解。（此项为源码路径确定性推断，未用第三方文件实测。）
- **M10. `validateRelativePath` 不拒 NUL/控制字符与盘符前缀**（[bundle.ts:1055–1064](../../packages/workbook-core/src/bundle.ts#L1055-L1064)），失败被推迟到 `realpath` 抛裸 `TypeError`。
- **M11. 导出的 `validateTableSchema`/`assertValidTableSchema`**（[validation.ts:713–724](../../packages/workbook-core/src/validation.ts#L713-L724)，经 [index.ts:3](../../packages/workbook-core/src/index.ts#L3) 公开）不校验跨文档引用与 `specVersion`，但命名会让调用方误以为已完整校验。
- **M12. 读路径全量物化**（[bundle.ts:365](../../packages/workbook-core/src/bundle.ts#L365)、[435–452](../../packages/workbook-core/src/bundle.ts#L435-L452)、[parquet-adapter.ts:58](../../packages/workbook-core/src/parquet-adapter.ts#L58)/[76](../../packages/workbook-core/src/parquet-adapter.ts#L76)）：`openCurrentWorkbookRevision` 也会加载并校验全部历史快照，条目大小与行数无上限。

## 5. 已验证通过的部分

以下均已实测，未发现问题：

- 15 种逻辑类型的往返（含 `null`、空表、全 null 列、`any` 的原始值与嵌套值）。
- Parquet 物理类型与列集合校验（缺列、多列、重名列、类型不符均拒绝）。
- 路径穿越、重复路径、realpath 别名（含符号链接与大小写不敏感文件系统）均拒绝。
- `formatVersion`、`specVersion`、未知 `requiredFeatures` 全部 fail-closed。
- Revision 归档矩阵（序号、parent 链、head 位置、快照重叠/逃逸/别名/缺失、workbookId 不符、快照内声明 profile、根状态 ≠ head）全部整体失败。
- 陈旧 `baseRevisionId` 与重复 `transactionId` 被拒。
- 列名只用稳定 ID，从不使用 `Field.name`。
- `validateWorkbook` 不修改入参。
- `tsc` 严格模式编译通过，且 `dist` 与 `src` 一致。

## 6. 建议优先补充的测试

1. 覆盖已存在的非 Bundle 目录 → 必须拒绝且无数据丢失；补一个目标为 `.` 的用例。
2. 并发两次 `commitWorkbookRevision` → 断言不会「都成功但只剩一个 revision」，且错误类型为 `WorkbookBundleError`。
3. 数值边界：`number` 接受 `1.5`/`1e21`/`1e300`（按 I1 的决策），`integer` 接受 ±(2^53−1)、拒绝 ±2^53 与 `1.5`。
4. 恶意输入：`pattern = "^(a+)+$"` 在超时约束下必须快速失败；2 万层嵌套断言 `DomainValidationError` 而非 `RangeError`。
5. 文档一致性：按 [proposal.md](../proposal.md) §4 的 FK 形状构造 schema，必须能写入并读回。
6. 错误类型矩阵：上述所有失败场景断言 `instanceof WorkbookBundleError`。

## 7. 残余风险与验证边界

- 未做大规模性能测试；>12 万行场景由子评审覆盖，未在本机复现。
- 未与 pyarrow / duckdb 产物做真实互操作实测（M9 为源码推断）。
- C2 的复现率为 36 轮 3 次，实际概率随机器与负载变化。
- 所有验证均在 `/tmp` 中进行；仓库与 index 未被改动，`git status` 与评审开始时一致。本报告文件本身为新增未跟踪文件，未加入暂存区。
