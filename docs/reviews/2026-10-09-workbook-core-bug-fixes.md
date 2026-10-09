# Workbook Core — LVB-107–114 修复与验收记录

日期：2026-10-09（Asia/Shanghai）。范围：Linear ai-native-spreadsheet 项目 LVB-107–114。读取全部 issue 的实际验收标准及关系，均无 blockedBy；按 Domain Model instruction 实施，读取 Transaction and Concurrency、Operations、Integration and Review instruction 作为交接/验收边界。规格依据：proposal §3–8、§31、§34–36、§49、§52。

## 交付结论

8 个 issue 的本地修复及回归已完成。`npm test --prefix packages/workbook-core` 执行严格 TypeScript 编译和 **50 / 50** 回归测试，全部通过，最终本机运行约 **5.37 秒**。`git diff --check` 通过。未提交 Git commit、未更改原暂存区、未更新 Linear 状态或向外部发送评论。

原暂存变更的 SHA-256 仍为 `38981475614a5ccf3994c8d710bd374af59bde51a2f2d9d5aa163f759b13f835`（对 `git diff --cached --binary` 计算），与复核报告记录一致。原暂存的 P1 实现和文档调整完整保留；本次修改位于工作区，新增文件尚未暂存。

## 逐 issue 验收

| Issue | 实现及验收证据 |
| --- | --- |
| [LVB-107](https://linear.app/lvbingwu123/issue/LVB-107) | 完整验证旧 Bundle/全部历史并核对精确目录树；拒绝 cwd/祖先、普通目录、伪造标记、额外文件/空目录/symlink/特殊文件。保存失败保留旧文件字节。正常新建和受管更新通过。`storage.test.mjs` 覆盖这些路径，cwd 用例在临时子进程中运行。 |
| [LVB-108](https://linear.app/lvbingwu123/issue/LVB-108) | 公开读写 API 使用真实父目录下的同级目录锁；读 head、base/transaction 验证、构造/复制历史和发布持同一锁。普通保存不能覆盖档案。临时产物发布前完整读回，防止成功提交不可读。可控锁屏障的同进程/跨进程测试验证同 base 恰一个成功、失败为 CONFLICT、成功返回的 Revision 可读取；旧 snapshot 字节不变，超预算提交失败后旧成功 revision 继续可读。 |
| [LVB-109](https://linear.app/lvbingwu123/issue/LVB-109) | 共用有限 JSON number 检查，DOUBLE 不再套用安全 integer 条件；number 的 1.5、1e16、1e21、1e300、负大数和最小正数、嵌套 metadata/extensions 可往返。integer 的 ±(2^53−1) 成功，±2^53/小数/NaN/Infinity 拒绝，诊断明确安全范围。`values.test.mjs`、`domain.test.mjs`。 |
| [LVB-110](https://linear.app/lvbingwu123/issue/LVB-110) | 类型/校验与 proposal 的 fields/reference.fields 统一；无前缀 ID 有效，生成器保留前缀，改名不改引用。P1 不再从 expression 字符串猜依赖，仅校验 targetField/dependsOn；字符串常量 fld_notreal 可保存，显式未知依赖拒绝。正式 DSL/AST 交接 LVB-81。FK/ID/rename 往返及旧 fieldIds 草案拒绝测试。 |
| [LVB-111](https://linear.app/lvbingwu123/issue/LVB-111) | 共用 plain/null-prototype、自有可枚举数据属性、密集数组的 JSON 检查；约束扩展使用 Object.hasOwn；Row own-value 读取一致。直接 adapter 校验本地 Schema/行及所有嵌套 JSON 类型，拒绝 undefined/Date/NaN/Infinity/bigint/typed array/Map/类实例/继承 row values/getter/symbol 等丢损输入。重复 Row ID、JSON 数值溢出拒绝。合法 null-prototype/constructor/__proto__ 扩展往返，不声称存在全局原型污染。 |
| [LVB-112](https://linear.app/lvbingwu123/issue/LVB-112) | WorkbookBundleError 的结构、路径、数据、IO、资源、版本、冲突、不安全目标分类及 cause/context；迭代 JSON 检查避免深度/循环 RangeError；文件/条目/历史/行数/文本/匹配工作预算。NFA 有界语法，拒绝病态分组；全 Workbook 和全历史共享匹配预算。Parquet 在可终止 worker 中检查页/列实际尺寸和值数、堆和 5 秒硬超时。保留全部历史一致性验证，超限整体失败。`import.test.mjs` 覆盖损坏、NUL、别名、版本、历史、预算、真实病态表达式及批量合法语法的累计预算。 |
| [LVB-113](https://linear.app/lvbingwu123/issue/LVB-113) | test 入口先编译后测试、README 使用说明、50 个回归测试覆盖 15 类逻辑值、无损往返、领域键/身份/约束、manifest/version/reference/path/alias、历史/base/transaction 和 R1–R6。破坏性写入都在独立临时目录；并发用例用锁屏障；病态正则子进程有 3 秒外部超时，测试入口有 20 秒用例超时。 |
| [LVB-114](https://linear.app/lvbingwu123/issue/LVB-114) | 接受裸 INT64、INT_64、INTEGER(64,true) 及一致组合；拒绝 unsigned/timestamp/decimal/冲突/错误位宽及超安全整数。测试先检查实际注解，避免 writer 选项未生效造成假阳性；pyarrow 19.0.1 真正生成的稳定列名 fixture 通过完整 Bundle 导入。四个真实反例 fixture 检查语义隔离。生成脚本与来源说明在 test/fixtures/。不声称该版本 pyarrow 默认写 signed INTEGER 注解。 |

## 代码与文档

- `packages/workbook-core/src/bundle.ts`：保存所有权、公共边界/错误分类、锁、完整 staged 验证、导入预算/有界读文件、引用校验。
- `src/validation.ts`、`src/json.ts`、`src/safe-pattern.ts`：一致 JSON 容器、有限值契约、显式外键、无回溯匹配与累计预算、枚举集合索引与行/字段工作预算。
- `src/parquet-adapter.ts`、`src/parquet-worker.ts`：本地表无损校验、行身份、signed INT64、页资源交叉验证和 worker 执行边界。
- `src/ids.ts`、`src/model.ts`、`src/index.ts`：可移植 ID 和 FK 类型，公开 API。
- `package.json`、`README.md`、`test/`：可重复测试入口、合约/迁移/资源说明、真实第三方 fixture。
- `docs/proposal.md`：同步值/JSON/pattern、FK、ID、明确依赖、持久化与导入边界。

## 独立复核

使用 requesting-code-review 技能委派只读 reviewer，对相对 index 的修复检查正确性和验收范围。复核确认并推动修复三处预算漏洞：发布写读预算不对称、批量模式匹配缺少累计预算、Parquet footer 可低报实际页解码大小。三处均有长期回归用例；复测 wide commit 拒绝后旧 revision 可读，批量匹配约 122 ms 受控失败，低报 footer 明确拒绝。随后修正数组 length 计数偏差，并补充枚举/行字段工作预算和有界文件读取并发。

## 兼容性及交接

- 当前旧实现的 fieldIds/reference.fieldIds 草案须改为规格中原有的 fields/reference.fields。尚未发布正式 Bundle v1，因此保持规格形状，不添加歧义别名。
- 旧草案使用的完整 JS RegExp 可能超出新有界子集，须迁移；语法扩展需要维持无回溯/可终止执行边界。
- Domain → Operations：LVB-81 冻结表达式 DSL/AST 和正式依赖提取，P1 只透传 expression 并验证显式依赖。
- Domain → Transaction and Concurrency：此锁保障持久化单 head 与成功历史，不替代 P5 的语义冲突/rebase。
- Integration：复核及 50 个用例提供 P1 修复验收证据；Linear 状态保持原样，用户可据记录推进评审。

同级锁需要父目录写权限。崩溃残留锁不能按年龄自动偷取；恢复前确认没有活跃操作。未声称完成跨平台、掉电/fsync 恢复或整进程 RSS 上限验证。资源默认值详见包 README；合法但超出预算的输入整体拒绝。当前会完整读取全部保留历史，没有引入懒加载。
