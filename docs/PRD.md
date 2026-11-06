# DoneRight 产品需求文档（PRD）

| 项目 | 内容 |
| --- | --- |
| 文档版本 | V0.2（评审稿） |
| 产品版本 | V0.1 — Reliable PDF Inspection |
| 日期 | 2026-11-06 |
| 状态 | 待评审；通过后冻结为需求基线（文档版本升为 V1.0） |
| 上游文档 | 用户提供的《DoneRight 产品需求梳理 PRD V0.1》 |
| 配套文档 | [评审记录](./REVIEW.md) · [技术设计](./TECH_DESIGN.md) · [引擎 Spike 报告](./spike-report.md) · [README](../README.md) |

> 本文档是 V0.1 的需求基线。**文档版本 V0.2 是评审修订号，产品版本仍是 V0.1**，两者不要混用。

---

## 0. 相对 V0.1 的变更

| # | 变更点 | V0.1 原方案 | V0.2 修订 | 原因 |
| --- | --- | --- | --- | --- |
| 1 | 检测引擎 | Python + PyMuPDF | TypeScript 核心 + 可替换 Provider | PyMuPDF 为 AGPL-3.0/商业双许可，与开源插件分发冲突；且要求用户另装 Python，直接削弱 P0「可安装性」 |
| 2 | 验收状态 | 4 个总体状态 | 总体 4 态 + 单项 6 态 | 原模型无法表达「这项没检查」，会把未验证静默算成通过 |
| 3 | 证据规范 | 页码、坐标、截图 | 统一坐标约定 + 稳定 issue ID + 复检 diff | 没有统一坐标和稳定 ID，复检无法判断「同一个问题是否已修复」 |
| 4 | 内容比对 | 文本匹配 + 辅助语义检查 | 仅确定性归一化匹配；语义检查移出 V0.1 | 语义判断不可复现，不能作为 FAIL 依据 |
| 5 | 验收指标 | 90% / 5% | 明确标注单元、IoU 匹配、held-out 口径 | 原指标没有计算定义，无法验收 |
| 6 | 用户交互 | 仅描述流程 | 工具 `doneright_check` + 命令 `/doneright` + 报告文件 | 需要可实现的 V0.1 交互面 |
| 7 | 范围 | 未列出排除项 | 新增第 1.5 节明确非目标 | 防止 V0.1 范围膨胀 |
| 8 | 规则目录 | 13 条，未含图文遮挡与禁止内容 | 补 `pdf.layout.image-overlap`、`pdf.content.prohibited-presence` | §4.2 / §4.3 有检查描述，但 §2.5 目录漏列，会导致实现无规则可挂 |

未变更、予以保留的部分：产品定位、四类问题、六个功能模块、四状态语义、版本路线、以及「没有证据就报无法验证」的原则。

---

## 1. 产品定位

### 1.1 一句话定义

DoneRight is a quality gate for AI-generated deliverables. It verifies whether an AI agent's output meets the user's requirements before the work is considered complete.

DoneRight 是 AI Agent 的**交付验收员**，不是另一个负责完成任务的 Agent。

### 1.2 要解决的问题

| 问题 | 典型表现 | DoneRight 的价值 |
| --- | --- | --- |
| 交付内容不完整 | 要求整理 15 章，实际缺少第 8 章 | 检查交付物是否覆盖明确要求 |
| 交付质量不合格 | 字体重叠、表格越界、页面损坏 | 执行客观、可复现的质量检查 |
| 自我检查不可靠 | Agent 声称「已检查」，但不提供依据 | 输出可追溯的检测结果与证据 |
| 修复缺少闭环 | 用户指出问题，改完又引入新问题 | 支持修复后按同一契约复检 |
| 标准不可复核 | 换一次对话，结论就变了 | 记录规则版本、文件哈希、契约哈希 |

**第三行是本产品的立足点。** DoneRight 不能只是再调用一次大模型让它评价自己；它必须用独立执行的程序规则给出结论，并让任何人可以拿着同一份输入复现同一个结果。

### 1.3 设计原则

以下七条是 P0 级约束，任何功能设计不得违反。

1. **独立证据**：每条结论必须能追溯到规则 ID、位置（页码 + 坐标）和原始内容摘录。模型自评不构成证据。
2. **未知不等于通过**：无法检查时输出 `UNVERIFIED`，汇总为 `REVIEW`，绝不默认 `PASS`。
3. **确定性优先**：V0.1 的全部判定来自可复现的程序规则；模型只做辅助意见，且不得产生阻断性结论。
4. **只读交付物**：绝不修改、覆盖、重命名用户文件；所有写入只发生在报告目录。
5. **可复现**：同输入 + 同规则版本 → 同结论。报告记录文件哈希、规则版本、引擎版本。
6. **范围诚实**：报告必须声明本次实际检查了什么、跳过了什么、哪些无法验证。
7. **本地优先**：默认不联网、不上传文件；任何外部调用必须由用户显式开启。

### 1.4 目标用户

| 用户群体 | 需求 | 优先级 | V0.1 是否覆盖 |
| --- | --- | --- | --- |
| 用 Agent 生成文件的用户 | 检查 PDF 报告的完整性与排版 | P0 | ✅ |
| 使用 Coding Agent 的开发者 | 验证代码、测试是否通过 | P1 | ❌（V0.3+） |
| 用 Agent 处理数据的用户 | 检查数据完整性、公式、格式 | P2 | ❌（V1.0+） |
| Agent 插件开发者 | 接入自定义检查规则 | P1 | ⚠️ 接口预留，不开放第三方加载 |

### 1.5 V0.1 非目标

明确不做，且写进代码仓库的 `NON_GOALS.md` 以防范围蔓延：

- 不支持 PDF 以外的文件格式（DOCX / PPTX / XLSX / 代码均不在 V0.1）。
- 不承诺自动识别所有排版问题；只承诺规则目录内的检查。
- 不自动调用大模型判断内容对错；视觉模型审查为 P1。
- 不自动修改、覆盖、重排用户文件；不做「一键修复」。
- 不做 Agent 任务调度、不做多文件产物归属推断（V0.2 再议）。
- 不做账号、云端历史、计费、团队协作。
- 不保证 `PASS` 代表文件完美，只代表**约定检查范围内未发现阻断问题**。
- 不提供自定义前端页面；V0.1 使用工具卡片 + 报告文件。

---

## 2. 核心概念：验收契约（Acceptance Contract）

### 2.1 定义

验收契约是在开始检查前，把用户的交付要求转成一组**可检查条件**的 JSON 文档。它同时是：

- 检查器的输入（决定跑哪些规则、用什么参数）；
- 复检的锚点（同一契约哈希才可比较）；
- 争议时的依据（用户能看到「按哪条规则判的」）。

### 2.2 两类要求必须分开

| 类型 | 例子 | 处理方式 | 能否产生 FAIL |
| --- | --- | --- | --- |
| 可验证要求 | 文件能打开；S1–S15 齐全；文字不超出页面 | 程序规则，确定性判定 | ✅ 可以 |
| 主观要求 | 专业、美观、逻辑清晰 | 不映射确定性规则；只记入「未自动验证」清单，或映射为结果最高 `REVIEW` 的启发式检查 | ❌ 不可以 |

规则：**主观要求不得作为唯一的阻断条件。** 若契约中只有主观要求，报告必须写明「未设定可验证的阻断条件」，总体状态不得为 `PASS`（默认规则发现确定性布局问题时仍可为 `FAIL`）。

### 2.3 契约结构

契约文件默认放在 `<workspace>/.doneright/contract.json`，也可由工具参数内联传入。下面只列一条要求示意结构，完整示例见[附录 A](#附录-a验收契约示例)。

```json
{
  "schemaVersion": "1.0",
  "contractId": "ctr_20261106_a1b2c3",
  "artifact": { "path": "output/english-manual.pdf", "sha256": "<hex>" },
  "requirements": [
    {
      "id": "REQ-001",
      "source": "user",
      "text": "必须涵盖 S1–S15 全部 15 节",
      "verifiable": true,
      "severity": "blocking",
      "rule": "pdf.content.section-presence",
      "params": { "sections": ["S1", "S2", "S3"], "match": "normalized" }
    }
  ],
  "policy": {
    "onUnverified": "review",
    "limits": { "maxBytes": 104857600, "maxPages": 300, "timeoutMs": 180000 }
  }
}
```

字段约束：

- `severity`: `blocking | major | minor | info`；只有 `blocking | major` 能导致 `FAIL`。
- `source`: `user | inferred`。`inferred` 的要求**必须**带 `"confirmedByUser": true` 才能设为 `blocking`，否则降级为 `minor` 并在报告中标注「AI 推断，未确认」。
- `rule`: `verifiable: true` 时必填，且必须是规则目录中已注册的 ID；未知规则 → 该条 `UNVERIFIED`，不得静默忽略。`verifiable: false` 时不得填 `rule`，该条只进入报告的「未自动验证」清单，不参与状态聚合。
- `artifact.sha256`: 运行时重新计算并比对；不一致 → `ERROR`（文件已被替换）。

### 2.4 契约生命周期

```
草稿（AI 提取 / 用户手写）
   ↓ 用户确认（可改、可删、可关）
冻结（计算 contractHash = sha256(规范化 JSON)）
   ↓
执行 → 报告（记录 contractHash）
   ↓
复检（同一 contractHash 才允许 diff）
```

- 契约一旦冻结，复检时不得自动修改；用户改契约 = 新契约、新报告。
- `contractHash` 计算前必须做键排序与空白规范化，保证跨平台一致。

### 2.5 内置规则目录（V0.1）

| 规则 ID | 检查内容 | 默认严重度 | V0.1 状态 |
| --- | --- | --- | --- |
| `pdf.structure.parse` | 能否解析、是否加密、页数是否有效 | blocking | ✅ |
| `pdf.structure.page-box` | MediaBox / CropBox / Rotate 是否合法、页面尺寸是否异常 | major | ✅ |
| `pdf.structure.blank-page` | 空白页（无文本、无图像、无矢量） | minor | ✅ |
| `pdf.structure.text-layer` | 是否存在可提取文本层 | info | ✅（仅记录，不判错） |
| `pdf.structure.font-embedding` | 字体是否嵌入 | minor | ⏳ P1 |
| `pdf.layout.text-out-of-page` | 字形超出可见页面区域 | major | ✅ |
| `pdf.layout.text-overlap` | 文本块异常重叠 | major | ✅ |
| `pdf.layout.edge-proximity` | 正文距裁切边过近 | minor | ✅ |
| `pdf.layout.table-overflow` | 表格单元格可能溢出 | minor | ⚠️ 只输出 REVIEW |
| `pdf.layout.image-overlap` | 图像覆盖文本（疑似遮挡） | minor | ⚠️ 只输出 REVIEW |
| `pdf.content.section-presence` | 指定章节 / 标题是否存在 | blocking | ✅ |
| `pdf.content.phrase-presence` | 指定原文句子是否存在 | blocking | ✅ |
| `pdf.content.prohibited-presence` | 契约声明的禁止内容是否出现 | blocking | ✅ |
| `pdf.content.order` | 章节顺序是否与要求一致 | minor | ⚠️ 只输出 REVIEW |
| `pdf.visual.*` | 渲染后视觉审查 | info | ❌ P1 |

---

## 3. 功能需求

### 3.1 功能清单

| 编号 | 功能模块 | 具体需求 | 优先级 | V0.1 |
| --- | --- | --- | --- | --- |
| FR-01 | 成果发现 | 识别用户指定的输出文件，校验路径、类型、大小、可读性 | P0 | ✅ 仅显式路径 |
| FR-02 | 验收规则 | 内置规则目录；支持用户新增/覆盖/关闭规则 | P0 | ✅ |
| FR-03 | 质量检测 | 执行结构、布局、内容三类检测 | P0 | ✅ |
| FR-04 | 问题定位 | 输出规则 ID、严重度、页码、归一化坐标、文本摘录 | P0 | ✅ |
| FR-05 | 验收报告 | 机器可读 JSON + 人类可读 Markdown | P0 | ✅ |
| FR-06 | 复检机制 | 按同一契约复检，输出已修复/仍存在/新增 | P0 | ✅ |
| FR-07 | 自动触发 | Agent 完成任务后按策略启动验收 | P1 | ❌ V0.2 |
| FR-08 | 修复协作 | 把失败项结构化反馈给 Agent | P1 | ❌ V0.3 |
| FR-09 | 规则扩展 | 第三方注册自定义检查器 | P1 | ⚠️ 接口内部预留 |
| FR-10 | 多格式支持 | DOCX / PPTX / XLSX / 代码 | P2 | ❌ V1.0 |
| FR-11 | 报告检索 | 按 artifact / 契约 / 时间列出历史报告 | P2 | ❌ |
| FR-12 | 国际化 | 报告与工具描述中英双语 | P1 | ✅ 文案层 |

### 3.2 用户流程（V0.1，手动触发）

**Step 1 — 生成成果**
用户让 Agent 生成 PDF，例如：「根据这 15 节材料做一份完整 PDF 手册，不能漏内容，排版不能重叠。」

**Step 2 — 启动验收**
用户说「验收一下 output/english-manual.pdf」，或执行 `/doneright output/english-manual.pdf`。工具校验路径与文件类型，读取或生成契约草稿。

**Step 3 — 确认契约**
工具返回契约摘要（要求条数、可验证条数、阻断条数、无法验证条数）。用户可确认、删除条目或调整严重度。**未确认的 `inferred` 条目不得阻断。**

**Step 4 — 执行检查**
在隔离 worker 中依次执行结构 → 布局 → 内容检查；收集证据；超时或单检查器失败不影响其他检查器。

**Step 5 — 生成报告**
输出 `.doneright/reports/<reportId>/report.json` 与 `report.md`，聊天中返回状态摘要与报告路径。

**Step 6 — 修复后复检**
用户修复文件后再次执行，传入 `previousReport`，输出 diff：`resolved` / `persisting` / `new` / `regressed`。

### 3.3 工具接口

工具名：`doneright_check`（全局注册；不与 `run_code` 冲突）。

```ts
// 参数（JSON Schema 摘要）
{
  artifactPath: string;          // 必填，工作区内相对或绝对路径
  contractPath?: string;         // 可选，默认 .doneright/contract.json
  contract?: object;             // 可选，内联契约；与 contractPath 二选一
  sourcePaths?: string[];        // 可选，原文材料，用于内容比对
  previousReport?: string;       // 可选，复检基准
  rules?: string[];              // 可选，仅跑指定规则
  locale?: "zh" | "en";
}
```

返回（渲染为工具卡片 + 文件链接）：

```json
{
  "status": "FAIL",
  "reportId": "rpt_20261106_7f3a",
  "reportPath": ".doneright/reports/rpt_20261106_7f3a/report.json",
  "markdownPath": ".doneright/reports/rpt_20261106_7f3a/report.md",
  "summary": { "blocking": 1, "major": 1, "minor": 0, "review": 1, "unverified": 1 },
  "topIssues": [
    { "ruleId": "pdf.layout.text-overlap", "page": 3, "message": "第 3 页两处文本重叠" }
  ],
  "limitations": ["未提供原文材料，内容完整性仅验证了 15 个章节标题"]
}
```

约束：

- 只允许读取工作区内路径，或用户在参数中显式给出的绝对路径；`..` 越界一律拒绝。
- 工具不修改 `artifactPath` 指向的文件（打开时使用只读句柄）。
- 单次执行有硬超时；超时返回 `ERROR` 且保留已完成部分的结果。
- 文件不是 PDF 或无法读取 → 返回参数错误，不生成报告。
- **未提供契约时**：使用内置默认规则集（结构 + 布局，不含内容规则），报告标注「未提供验收契约，仅执行默认规则」，并写入一个合成检查项 `contract.confirmed = UNVERIFIED`；因此总体状态不得为 `PASS`（发现确定性布局问题时仍可为 `FAIL`），因为「检查范围」本身未经用户确认。

### 3.4 命令接口

`/doneright [path]`：不经模型轮次，直接执行检查并打印状态摘要与报告路径。

用途：用户想快速复核、或不想让 Agent 再解释一遍时使用。命令与工具共享同一执行内核，保证结果一致。

### 3.5 报告存放

```
<workspace>/.doneright/
  contract.json                  # 可选，默认契约
  reports/
    rpt_20261106_7f3a/
      report.json
      report.md
      evidence/                  # 可选，P1 截图
```

- 默认写入工作区，便于版本控制与复检；可通过插件配置改到用户数据目录。
- 报告保留策略：默认不自动清理；提供 `doneright.prune` 命令（P2）。

---

## 4. 检查器规格

### 4.0 统一接口

所有检查器实现同一接口，以便未来替换格式解析组件而不动编排层与报告层。

```ts
interface Checker {
  readonly id: string;           // 与规则 ID 对应，如 pdf.layout.text-overlap
  readonly version: string;      // 语义化版本，进入报告
  run(input: CheckInput): Promise<CheckResult>;
}

interface CheckInput {
  artifact: ArtifactRef;         // path, sha256, bytes, pageCount
  params: Record<string, unknown>;
  sources?: SourceDocument[];    // 原文材料（已归一化）
  limits: ResourceLimits;
  signal: AbortSignal;
  workDir: string;               // 仅证据写入
}

interface CheckResult {
  status: "PASS" | "FAIL" | "REVIEW" | "UNVERIFIED" | "SKIPPED" | "ERROR";
  issues: Issue[];
  coverage: { pagesChecked: number; pagesTotal: number; unitsChecked?: number; unitsTotal?: number };
  limitations: string[];
  metrics?: Record<string, number>;
}
```

约定：

- 检查器内部**不得**直接抛异常给编排层；未捕获异常由 worker 边界转为 `ERROR`。
- 单个检查器失败只影响自身状态，其他检查器继续。
- 检查器不得写 `artifact` 目录，只能写 `workDir`。

### 4.1 检查器 A — 结构有效性（PDF Structural Validator）

| 检查项 | 判定 | 状态映射 |
| --- | --- | --- |
| 文件可解析 | 解析失败 | `ERROR`（附解析器错误原文） |
| 加密 | 需要密码且未提供 | `ERROR`（提示需解密后重试，不尝试破解） |
| 页数 | 0 页 / 页数读取失败 | `ERROR` |
| 页面框 | MediaBox 缺失、宽高 ≤ 0、> 200 英寸 | `FAIL`（major） |
| 页面尺寸混用 | 同一文档内页面尺寸差异 > 5% | `REVIEW` |
| 空白页 | 无文本、无图像、无矢量路径 | `REVIEW`（可能是刻意留白） |
| 文本层 | 全文档可提取字符数为 0 | 结构 `PASS`，但整体 `REVIEW`（扫描件）；内容检查全部 `UNVERIFIED` |

**扫描件处理（重点）**：扫描版 PDF 是结构有效的文件，**不得**因为「没有文本层」判 `FAIL` 或 `ERROR`。正确行为是：结构检查通过，内容检查标记 `UNVERIFIED` 并说明「无文本层，需 OCR 或人工核对」，总体状态 `REVIEW`。

### 4.2 检查器 B — 排版与几何（Layout Inspector）

| 检查项 | 判定 | 状态映射 |
| --- | --- | --- |
| 文本超出可见区域 | 文本 run 包围盒超出 CropBox，且超出面积 > 该 run 面积的 20% | `FAIL`（major） |
| 文本-文本重叠 | 两个不同文本 run 的包围盒重叠，且重叠面积 / 较小面积 > 阈值（默认 0.35） | `FAIL`（major）；介于 0.15–0.35 为 `REVIEW` |
| 文本贴近裁切边 | 正文包围盒距 CropBox 边缘 < 2pt | `REVIEW`（minor） |
| 表格单元格溢出 | 单元格内文本宽度 > 单元格宽度 × 1.05 | `REVIEW`（minor） |
| 图文遮挡 | 图像覆盖文本且无透明通道证据 | `REVIEW`（仅提示，不判 FAIL） |

误报控制（必须实现）：

- 同一行内正常字距造成的轻微交叉，不算重叠：要求两个 run 的文本内容不同、字体大小均 > 4pt、且重叠发生在两者都「有墨」的区域。
- 忽略纯空白、纯标点、组合字符（combining marks）。
- 加粗模拟（同一文本绘制两次、偏移 < 0.3pt）单独归为 `info`，不判 FAIL。
- 旋转页面：先在页面坐标系内计算，再换算到归一化坐标；不得直接比较未旋转坐标。
- 每个 `FAIL` 必须附带两个 run 的文本摘录与坐标，便于人工复核。

### 4.3 检查器 C — 内容完整性（Content Completeness Validator）

| 检查项 | 判定 | 状态映射 |
| --- | --- | --- |
| 章节 / 标题存在 | 归一化后精确匹配；标题允许前后空白差异 | 缺失 → `FAIL`（blocking） |
| 关键句子存在 | 归一化后精确匹配；长度 > 40 字符的句子允许 ≥ 0.92 相似度 | 缺失 → `FAIL`（blocking） |
| 章节顺序 | 出现顺序与契约给定顺序不一致 | `REVIEW`（minor） |
| 禁止内容 | 契约声明的禁用文本出现 | `FAIL`（blocking） |

文本归一化管线（顺序固定，进报告 `normalizationVersion`）：

1. Unicode NFKC；
2. 统一引号、破折号、不间断空格；
3. 合并连续空白，去除行首行尾空白；
4. 处理行末连字符断词（`hyphen-\n` → `hyphen`，仅当两侧均为字母）；
5. 可选：去除页眉页脚（按重复率识别，需在报告中说明）。

边界条件：

- **没有提供原文材料时，只能验证契约中明确列出的条目**，报告中必须写明「未做全文比对」，不得声称「内容完整」。
- 扫描件 / 无文本层：所有内容规则 `UNVERIFIED`，不得 `FAIL`。
- 匹配失败但相似度在 0.80–0.92：`REVIEW`（可能是断词或 OCR 差异），不直接判缺失。

### 4.4 检查器 D — 视觉辅助审查（P1，V0.1 不启用）

- 仅渲染「已被其他检查器标记」的页面，控制成本。
- 结果为 `advisory`，只能产生 `REVIEW`，且必须在报告中标注「模型意见，非确定性证据」。
- 默认关闭；启用需用户显式配置模型与密钥。
- V0.1 不实现，但接口预留 `pdf.visual.*` 命名空间。

### 4.5 误报控制总则

1. **双阈值**：`confirmed` 才判 `FAIL`，`suspected` 判 `REVIEW`。
2. **负样本强制**：每类规则必须至少有一个「看起来像问题但实际正常」的回归样本，否则不允许上线。
3. **可解释**：每个 issue 必须能回答「哪条规则、哪一页、哪个坐标、原文是什么」。
4. **不做全局推断**：单页问题不外推为全文结论。

---

## 5. 报告规范

### 5.1 状态模型

单项状态（每个 check）：

| 状态 | 含义 |
| --- | --- |
| `PASS` | 该规则实际执行，未发现问题 |
| `FAIL` | 该规则发现证据充分的问题 |
| `REVIEW` | 发现可疑问题，需人工确认 |
| `UNVERIFIED` | 应检查但缺少必要条件（如无原文、无文本层） |
| `SKIPPED` | 明确未执行：用户关闭、规则不适用或超出限制；必须记录 `reason` |
| `ERROR` | 检查过程本身失败，无法形成结论 |

总体状态与聚合规则：

| 条件（按顺序判定） | 总体状态 |
| --- | --- |
| 存在任一已确认的 `blocking` 或 `major` issue | `FAIL` |
| 无 FAIL，且存在 required check 为 `ERROR` | `ERROR` |
| 无 FAIL/ERROR，且存在：`REVIEW` issue、required check 为 `UNVERIFIED`、required check 为 `SKIPPED` 且 `reason = limit-exceeded`、optional check 为 `ERROR` | `REVIEW` |
| 其余（允许存在 `minor` issue 与用户主动关闭的 check，但须列出） | `PASS` |

补充规则：

- `PASS` 必须同时输出覆盖率；覆盖率为 0 时不得返回 `PASS`。
- 只要发生 `UNVERIFIED`，报告必须列出原因；不得用空 `limitations` 掩盖。
- 用户主动关闭的 check 不拉低状态，但必须出现在 `checks` 与 `limitations` 中，且 `PASS` 的措辞只能是「在已启用的检查范围内未发现阻断问题」。
- `required` 的定义：契约中显式绑定、且 `severity ∈ {blocking, major}` 的检查，加上规则目录中标记为 P0 的内置检查；其余为 `optional`（例如启发式的表格溢出、顺序检查）。
- 总体 `FAIL` 时，`ERROR` 仍然记录在 checks 中，但不改变总体结论（已有确定性失败）。

### 5.2 报告结构（JSON）

完整示例见[附录 B](#附录-b验收报告示例)。顶层字段：

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 报告 schema 版本，V0.1 固定 `1.0` |
| `reportId` | `rpt_<日期>_<短哈希>` |
| `status` | 总体状态 |
| `artifact` | 路径、sha256、字节数、页数 |
| `contract` | contractId、contractHash、requirements 数 |
| `runtime` | DoneRight 版本、检查器版本表、引擎名与版本、DSH 版本、开始时间、耗时 |
| `checks` | 每个 check 的状态、覆盖、问题、限制 |
| `summary` | 按严重度与状态计数 |
| `limitations` | 本次未覆盖或无法验证的内容（汇总） |

`issue` 字段：

| 字段 | 说明 |
| --- | --- |
| `id` | `iss_<12hex>`，由规则 + 页 + 坐标 + 文本哈希生成 |
| `ruleId` / `ruleVersion` | 可追溯到规则 |
| `severity` | `blocking / major / minor / info` |
| `page` | 1-based 页码 |
| `bbox` | `{x, y, w, h, unit: "normalized", origin: "top-left"}` |
| `text` | 原文摘录（≤ 200 字符，超出截断并标注） |
| `message` | 人类可读描述，双语字段或按 locale 渲染 |
| `evidence` | `{ snippet?, screenshot?, relatedIssueId? }` |
| `suggestedFix` | 可选，仅建议，不自动执行 |

### 5.3 坐标约定

- 报告统一使用**归一化坐标**：`x, y ∈ [0,1]`，原点为页面**可见区域左上角**，`w, h` 为相对宽高。
- 可见区域 = `CropBox ∩ MediaBox`，并应用 `/Rotate`。
- 换算公式（PDF 用户空间原点在左下、单位为 pt）：`x_norm = (x_pt - crop.left) / crop.width`，`y_norm = (crop.top - y_pt - h_pt) / crop.height`。
- 同一 issue 的所有坐标必须来自同一页面框与同一旋转状态；报告中记录 `pageBox` 来源。

### 5.4 issue 身份与复检匹配

- `id` 用于展示与引用，不保证跨版本稳定。
- 复检匹配按：`ruleId` 相同 + `page` 相同 + `bbox` IoU ≥ 0.5；匹配不到再按文本相似度 ≥ 0.9 兜底。
- 匹配结果分类：
  - `resolved`：上次有、这次无；
  - `persisting`：两次都有且匹配；
  - `new`：这次有、上次无；
  - `regressed`：上次 `resolved`，本次又出现（需历史报告 ≥ 2 份）。

### 5.5 Markdown 报告

结构固定，便于人读与 diff：

```markdown
# DoneRight 验收报告

- 状态：**FAIL**
- 文件：`output/english-manual.pdf`（sha256: `7f3a…`，42 页）
- 契约：`ctr_20261106_a1b2c3`（3 条要求，2 条阻断）
- 引擎：doneright 0.1.0 · pdfjs 5.x · DSH 0.x

## 结论

2 个阻断问题，1 项无法验证。

## 检查项

| 规则 | 状态 | 覆盖 | 问题数 |
| --- | --- | --- | --- |
| pdf.structure.parse | PASS | 42/42 页 | 0 |
| pdf.layout.text-overlap | FAIL | 42/42 页 | 2 |
| pdf.content.section-presence | UNVERIFIED | 0/15 节 | — |

## 问题

### 1. 文本重叠（第 3 页）· blocking
- 位置：x=0.12, y=0.08, w=0.50, h=0.03（归一化，左上原点）
- 文本：「...the quick brown fox...」与「...jumps over the lazy dog...」
- 依据：重叠面积占较小文本块 41%，超过阈值 35%
- 建议：检查第 3 页表格上方段落的行距与绝对定位

## 限制

- 未提供原文材料，内容完整性仅验证 15 个章节标题。
- 第 12 页为扫描图，未做文本比对。
```

### 5.6 报告与日志

- 报告文件是唯一权威结果；聊天卡片只是摘要。
- 日志（若开启）不得包含用户全文，只记录规则、页码、耗时、错误类型。

---

## 6. 复检机制

1. 复检必须使用与上次**相同的 contractHash**；不同则提示「契约已变更，结果不可直接比较」。
2. 输入 `previousReport`，输出 diff 四分类，并在 Markdown 中单列「本次变化」。
3. 复检本身不缓存上次的解析结果；每次都重新解析文件，避免「文件已变但缓存未失效」。
4. 防循环：同一 artifact + 同一契约连续 3 次复检均无改善，报告顶部提示「疑似修复无效，建议人工介入」。
5. 复检不修改原报告；生成新报告目录，`previousReport` 字段指回上一份。

---

## 7. 技术架构

### 7.1 分层

```
┌────────────────────────────────────────────────────┐
│ DSH Host（Cordis）                                  │
│  ctx.tools.register('doneright_check')              │
│  ctx.commands.register('doneright')                 │
│  V0.2: agent/turn-stopping · tools/result           │
└───────────────────────┬────────────────────────────┘
                        │ ToolRequest / CommandInvocation
┌───────────────────────▼────────────────────────────┐
│ adapter（依赖 Harness，可替换）                      │
│  参数校验 · 路径授权 · 配置 · 报告落盘 · 卡片渲染      │
└───────────────────────┬────────────────────────────┘
┌───────────────────────▼────────────────────────────┐
│ core（不依赖 Harness，可独立测试与发布）              │
│  Contract · RuleRegistry · Orchestrator · Report    │
│  SeverityPolicy · Diff · i18n                       │
└───────────────────────┬────────────────────────────┘
┌───────────────────────▼────────────────────────────┐
│ worker（隔离 + 资源上限 + 超时）                     │
│  detectors: structure / layout / content            │
│  engine: pdfjs-dist（解析、文本、坐标）              │
│          pdf-lib（页面框、加密元数据，按需）          │
└────────────────────────────────────────────────────┘
```

关键约束：`core` 与 `detectors` 不得 import 任何 `@deepseek-ai/dsh-*` 包。这样检测引擎可以单独 CLI 化、单独发版、单独测试。

### 7.2 检测引擎决策

| 方案 | 许可 | 安装成本 | 能力 | 结论 |
| --- | --- | --- | --- | --- |
| **TS：pdfjs-dist + pdf-lib** | Apache-2.0 / MIT | 纯 JS，随插件安装 | 文本、坐标、页面框、加密检测；无页面渲染 | **V0.1 采用（已确认）** |
| TS + `@napi-rs/canvas` | MIT | 预编译原生包，多平台 | 增加渲染与截图 | P1 spike 后启用 |
| Python + PyMuPDF | AGPL-3.0 / 商业 | 需 Python + pip | 能力最全 | **不采用**（许可与安装冲突） |
| Python + pypdfium2 | Apache-2.0 / BSD-3 | 需 Python | 文本 + 渲染 | 备选 Provider |
| WASM PDFium | BSD-3 | 纯 WASM，体积大 | 文本 + 渲染 | 备选（性能待测） |

> **决策状态（2026-11-06 确认）**：V0.1 引擎定为 TypeScript + `pdfjs-dist`。这是一项**带前置条件的确认**：必须先通过下面「Spike 门槛」；任一项不达标即自动切换到 WASM PDFium，不需要重新评审。决策记录见 §13。
>
> **Spike 结果（2026-11-06）**：门槛通过，采用 `pdfjs-dist@6.5.438`。坐标误差 0pt（含 0/90/180/270 旋转、CropBox 偏移、文本自身旋转）、100 页文本提取 194ms / RSS 125MB、无原生依赖；损坏/加密/0 页/无文本层四类边界均有确定行为。详见 `docs/spike-report.md`。
>
> 基线环境：DSH 桌面版 `0.2.2-rc.1`（build `c59d10a`），内置 Node `24.21.0`。

**为什么推翻 V0.1 的 Python 方案：**

1. **许可**：PyMuPDF 是 AGPL-3.0 或商业许可。插件若随包分发或作为依赖安装，会给 MIT/Apache 开源项目带来合规负担；要求用户自行 `pip install` 也只是把问题转移给用户。
2. **安装**：V0.1 的成功标准第一条是「有清晰安装文档，能在指定 Harness 版本正常加载」。要求用户另装 Python 3.11 + 编译型依赖，直接与这条标准冲突。
3. **环境**：DSH 自带的 Python 运行时没有 PDF 库（已实测），插件不应修改 DSH 运行时。
4. **隔离**：Python 子进程需要额外处理路径发现、编码、超时、僵尸进程；TS worker 更简单。

**保留扩展性**：引擎通过 `PdfEngine` 接口隔离（`load(bytes)`、`pages()`、`textRuns(page)`、`images(page)`、`drawings(page)`）。若后续需要渲染或 OCR，可新增 Python/WASM Provider，而不改检查器与报告。

**Spike 门槛（编码前必须通过）**：

- 解析 30 份样本（含加密、损坏、扫描、CJK、旋转页）不崩溃；
- 文本坐标与人工标注偏差 ≤ 1pt（正文 10–12pt 字号）；
- 100 页文本提取 < 15s，内存 < 300MB；
- 在 DSH 的 Node 24 运行时中可直接运行（无原生依赖）。

任一项不达标 → 启用备选方案（WASM PDFium），并在技术设计中记录。

### 7.3 隔离与资源限制

- 检查在 `worker_threads` 中执行，设置 `resourceLimits`（默认 `maxOldGenerationSizeMb: 512`）。
- 单次执行硬超时（默认 180s，可配置）；超时终止 worker，返回 `ERROR` 并保留已完成部分。
- 单检查器超时（默认 60s）；单检查器失败不终止其他检查器。
- 页数上限 300、文件大小上限 100MB（可配置）；超限 → `SKIPPED` 并写明原因，不静默截断。
- 解析大文件时流式读取，避免一次性复制。

### 7.4 依赖与打包

- 运行时依赖：`pdfjs-dist`（必需，解析与文本坐标）+ `pdf-lib`（按需，页面框与加密元数据）；版本锁定。
- 构建：`tsc` 输出 ESM 到 `dist/`；包 `"type": "module"`。
- 插件清单：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，通过 `insert` 注册 host 插件。
- 入口：`index.js` 导出 `apply(ctx, config)`；`inject` 声明 `tools`、`commands`。
- 显示元数据：`locale/zh.json`、`locale/en.json` 的 `meta.title` / `meta.description`，`icon.svg`。
- `engines`：`node >=22`（DSH 桌面版内置 `24.21.0`）、`dsh >=0.2.2-rc.1`。当前基线是 `0.2.2-rc.1`；更低的 0.2.x 未验证，不承诺兼容。
- CI 覆盖 Windows 与 Linux；Windows 为 V0.1 一级支持平台（开发与验收都在 Windows 上进行）。
- 不引入构建期原生编译；`@napi-rs/canvas` 若启用必须为可选依赖（`optionalDependencies`）并有降级路径。

### 7.5 目录结构

```
doneright/
  package.json
  cordis.patch.yml
  index.js                 # 构建产物入口（源码在 src/adapter）
  src/
    adapter/
      tool.ts              # doneright_check
      command.ts           # /doneright
      config.ts
    core/
      contract.ts          # 解析、校验、hash
      orchestrator.ts
      rule-registry.ts
      report.ts
      diff.ts
      severity.ts
      i18n.ts
    engine/
      pdf-engine.ts        # 接口
      pdfjs-engine.ts
    detectors/
      structure.ts
      layout.ts
      content.ts
    worker/
      entry.ts
  locale/{zh,en}.json
  tests/
    corpus/                # 样本 PDF（LFS 或生成脚本）
    labels/                # 标注 JSON
    fixtures/              # 合成缺陷样本
  docs/
```

### 7.6 Harness 集成点

| 能力 | V0.1 | V0.2 |
| --- | --- | --- |
| `ctx.tools.register` | ✅ `doneright_check` | 增加 `doneright_contract` |
| `ctx.commands.register` | ✅ `/doneright` | `/doneright auto on/off` |
| `tools/result` | ❌ | 记录 Agent 产出文件线索 |
| `agent/turn-stopping` | ❌ | 按策略触发验收，`agent.steer` 回注失败项 |

V0.2 的自动触发**不靠猜测**：契约文件中的 `artifact.path` + 运行前哈希是唯一可信绑定；找不到契约就不自动触发，只提示用户手动验收。

---

## 8. 非功能需求

| 类别 | 要求 | 可验证方式 |
| --- | --- | --- |
| 安全性 | 默认本地检查，不自动外发文件 | 断网运行全部用例通过 |
| 文件权限 | 只读用户授权文件；写入仅限报告目录 | 文件句柄审计 + 只读挂载测试 |
| 稳定性 | 单检查器失败/崩溃不影响 Harness 主进程 | 注入崩溃用例，主进程存活 |
| 资源限制 | 文件大小、页数、超时、内存四项可配 | 超限用例返回明确状态 |
| 可复现性 | 同输入同版本同结论；报告含哈希与版本 | CI 双次运行 diff 为空 |
| 可扩展性 | 新增检查器不改编排层与报告层 | 新增一个 demo 检查器 ≤ 1 天 |
| 可控性 | 不修改、不覆盖原始交付物 | 执行前后文件哈希一致 |
| 性能 | 50 页典型文档 < 60s；100 页 < 120s | 基准脚本 |
| 国际化 | 报告与工具文案中英双语 | locale 快照测试 |
| 可访问性 | 报告为纯文本/Markdown，可被读屏读取 | 人工检查 |

---

## 9. 安全与隐私

- 默认零网络请求；`pdfjs-dist` 关闭远程字体/CMap 抓取，使用本地资源。
- 路径校验：解析 `realpath` 后必须位于允许根目录内；拒绝符号链接逃逸。
- 报告可能包含用户正文摘录，属于敏感数据：默认写入工作区，不写入系统临时目录以外的共享位置；文档中提示用户注意分享风险。
- 不执行 PDF 内的 JavaScript、不打开外部链接、不启动附件。
- 解析器视为不可信输入边界：所有异常捕获后转为 `ERROR`，不泄露堆栈到聊天（写入本地日志）。
- 依赖供应链：锁定版本、提交 lockfile、CI 运行 `npm audit`（仅报告，不自动升级）。

---

## 10. 测试与验收标准

### 10.1 语料

最低 60 份 PDF，分五类：

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| 正常样本 | 20 | Word / LaTeX / InDesign / 浏览器打印 / 扫描件，覆盖中英、横竖版 |
| 布局缺陷 | 15 | 文本重叠、越界、表格溢出、图文遮挡，含真实历史案例 |
| 内容缺失 | 10 | 缺章、缺句、错序 |
| 结构异常 | 5 | 损坏、截断、加密、0 页 |
| 边界样本 | 10 | 旋转页、CJK、RTL、超大字、空白页、单页、100+ 页 |

其中 30% 作为 held-out，调参期间不得查看，发布前冻结。

### 10.2 标注格式

每个缺陷标注为一个「检查单元」：

```json
{
  "file": "layout-overlap-01.pdf",
  "page": 3,
  "ruleId": "pdf.layout.text-overlap",
  "severity": "major",
  "bbox": { "x": 0.12, "y": 0.08, "w": 0.50, "h": 0.03 },
  "note": "表格上方两段文字重叠"
}
```

正常样本同样标注「无问题区域」的页码范围，用于统计误报。

### 10.3 指标定义

- **匹配**：同一 `ruleId` 家族 + 同一页 + bbox IoU ≥ 0.3，视为命中；一个标注最多匹配一个检测结果。
- **召回率** = 命中标注数 / 标注总数，按 `severity` 分别统计。
- **误报页面率** = 含至少一个未匹配检测结果的正常页面数 / 正常页面总数。
- **内容完整性** = 命中的必需单元数 / 必需单元总数。命中 = 归一化后精确匹配；长度 > 40 字符的句子允许相似度 ≥ 0.92，此类命中单独计入 `fuzzyHits`，并使总体状态至少为 `REVIEW`。
- **定位准确率** = 命中结果中页码正确且 bbox IoU ≥ 0.3 的比例。

所有指标由脚本计算并提交 `benchmark.json`，禁止人工挑选样本或主观判定。

### 10.4 V0.1 门槛

| 指标 | 目标 |
| --- | --- |
| 可安装性 | 在指定 DSH 版本上按文档安装成功，无需 Python |
| 基础稳定性 | 60 份语料全部有可解释结果，主进程零崩溃 |
| blocking 召回率 | ≥ 0.90 |
| major 召回率 | ≥ 0.85 |
| 误报页面率 | ≤ 0.05 |
| 内容完整性（标注集） | 1.00；模糊命中单列，且不得让总体状态为 PASS |
| 定位准确率 | ≥ 0.90 |
| 复检 diff | 10 个脚本化场景全部正确 |
| 性能 | 50 页 < 60s，100 页 < 120s |
| 测试覆盖 | 每类规则至少 1 正 1 负样本；核心模块单测覆盖率 ≥ 80% |

> 上述数字是开发目标，需在 held-out 上实测后才可写入发布说明。未达标不得宣称「V0.1 完成」。

### 10.5 回归

- 每个修复的 bug 必须新增一个 fixture，命名含 issue 编号。
- CI 跑全量语料，输出指标对比；召回率下降 > 2 个百分点或误报上升 > 1 个百分点即失败。
- 报告 schema 变更必须升级 `schemaVersion` 并提供迁移说明。

---

## 11. 版本规划

| 版本 | 主题 | 范围 |
| --- | --- | --- |
| **V0.1** | Reliable PDF Inspection | 手动指定 PDF；结构/布局/内容三检查器；契约；JSON+MD 报告；复检 diff；语料与指标 |
| V0.2 | Agent Workflow Integration | 契约自动提取（需用户确认）；`tools/result` + `agent/turn-stopping` 触发；失败项回注 Agent |
| V0.3 | Fix & Revalidate | 受控修复建议、修复前后对比、防循环；可选视觉模型 |
| V1.0 | Extensible Quality Gate | 稳定检查器扩展接口、规则模板、多格式（DOCX/PPTX/XLSX） |

V0.2 的前置条件：V0.1 的 blocking 召回率与误报率达标。检测不可靠时做自动触发，只会把错误结论自动化。

---

## 12. 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| pdfjs 文本坐标精度不足 | 重叠/越界误判 | Spike 门槛；必要时改用 PDFium WASM |
| CJK / 旋转页文本顺序错乱 | 内容比对漏检 | 单独语料；按页面框归一化后再比对 |
| 重叠误报高（正常排版） | 用户不信任 | 双阈值 + 负样本 + 只对 confirmed 判 FAIL |
| 大文件 OOM | Harness 崩溃 | worker + 内存上限 + 页数/大小限制 |
| 契约由 AI 自动提取出错 | 误判 | `inferred` 必须用户确认；未确认不得 blocking |
| 用户期待「一键修复」 | 范围蔓延 | 非目标清单 + 报告只给建议 |
| 许可问题 | 无法开源分发 | 仅用 Apache/MIT 依赖；PyMuPDF 不进入依赖树 |

---

## 13. 决策记录

### 13.1 已确认

| 编号 | 决策 | 结论 | 确认日期 | 依据 |
| --- | --- | --- | --- | --- |
| D-01 | 检测引擎 | TypeScript + `pdfjs-dist`（`pdf-lib` 辅助），以 §7.2 的 Spike 门槛为前置条件 | 2026-11-06 | 许可为 Apache-2.0 / MIT，随插件安装，无额外运行时；PyMuPDF 为 AGPL-3.0，不进入依赖树 |
| D-02 | 最低 DSH 版本 | `engines.dsh: ">=0.2.2-rc.1"`，以当前桌面版为基线 | 2026-11-06 | 该版本已核实 `ctx.tools.register`、`ctx.commands.register`、`tools/result`、`agent/turn-stopping` 均可用 |

变更 D-01 需要重新评审许可与安装成本；变更 D-02 需要重跑集成测试并更新本文档 §7.4。

### 13.2 待确认（技术设计阶段定稿）

| 决策 | 建议（未另行确认时按此执行） | 备选 | 影响 |
| --- | --- | --- | --- |
| 报告默认目录 | `<workspace>/.doneright/`，可配置 | 用户数据目录 | 影响隐私与版本控制；默认目录需默认加入 `.gitignore` 提示 |
| 项目许可证 | MIT | Apache-2.0 | 影响贡献与分发 |
| 工具/命令命名 | `doneright_check` / `/doneright` | `dr_check` / `/dr` | 影响文档与用户习惯 |
| V0.1 是否含截图证据 | 否；只输出页码、归一化坐标与文本摘录 | 是（引入 `@napi-rs/canvas` 原生依赖） | 影响安装复杂度与证据可读性 |

---

## 附录 A：验收契约示例

```json
{
  "schemaVersion": "1.0",
  "contractId": "ctr_20261106_a1b2c3",
  "artifact": {
    "path": "output/english-manual.pdf",
    "sha256": "3f9c2a7d1e5b8c4f6a0d2e9b7c1f3a5d8e6b4c2a0f1d3e5b7c9a1f3d5e7b9c2a"
  },
  "requirements": [
    {
      "id": "REQ-001",
      "source": "user",
      "text": "必须涵盖 S1–S15 全部 15 节",
      "verifiable": true,
      "severity": "blocking",
      "rule": "pdf.content.section-presence",
      "params": {
        "sections": ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S13", "S14", "S15"],
        "match": "normalized"
      }
    },
    {
      "id": "REQ-002",
      "source": "user",
      "text": "必须保留全部练习句子",
      "verifiable": true,
      "severity": "blocking",
      "rule": "pdf.content.phrase-presence",
      "params": {
        "sourceFile": "source/pronunciation.md",
        "extract": "lines:practice",
        "minSimilarity": 0.92
      }
    },
    {
      "id": "REQ-003",
      "source": "inferred",
      "confirmedByUser": true,
      "text": "排版不得出现文字重叠",
      "verifiable": true,
      "severity": "major",
      "rule": "pdf.layout.text-overlap",
      "params": { "confirmRatio": 0.35, "reviewRatio": 0.15 }
    },
    {
      "id": "REQ-004",
      "source": "user",
      "text": "版面要专业、美观",
      "verifiable": false,
      "severity": "minor",
      "note": "主观要求，仅记录，不参与自动判定"
    }
  ],
  "policy": {
    "onUnverified": "review",
    "limits": { "maxBytes": 104857600, "maxPages": 300, "timeoutMs": 180000 }
  }
}
```

## 附录 B：验收报告示例

```json
{
  "schemaVersion": "1.0",
  "reportId": "rpt_20261106_7f3a",
  "status": "FAIL",
  "artifact": {
    "path": "output/english-manual.pdf",
    "sha256": "3f9c2a7d1e5b8c4f6a0d2e9b7c1f3a5d8e6b4c2a0f1d3e5b7c9a1f3d5e7b9c2a",
    "bytes": 2847361,
    "pages": 42
  },
  "contract": {
    "contractId": "ctr_20261106_a1b2c3",
    "contractHash": "9d1f0c7a5e3b2d8f6a4c1e9b7d5f3a2c0e8b6d4f2a1c9e7b5d3f1a0c8e6b4d2f",
    "requirements": 4
  },
  "runtime": {
    "doneright": "0.1.0",
    "engine": "pdfjs-dist@5.x",
    "dsh": "0.x.y",
    "startedAt": "2026-11-06T09:12:44Z",
    "durationMs": 8421
  },
  "checks": [
    {
      "ruleId": "pdf.structure.parse",
      "ruleVersion": "1.0.0",
      "status": "PASS",
      "coverage": { "pagesChecked": 42, "pagesTotal": 42 },
      "issues": [],
      "limitations": []
    },
    {
      "ruleId": "pdf.layout.text-overlap",
      "ruleVersion": "1.0.0",
      "status": "FAIL",
      "coverage": { "pagesChecked": 42, "pagesTotal": 42 },
      "issues": [
        {
          "id": "iss_7f3a91c2d0e4",
          "ruleId": "pdf.layout.text-overlap",
          "ruleVersion": "1.0.0",
          "severity": "major",
          "page": 3,
          "bbox": { "x": 0.12, "y": 0.08, "w": 0.5, "h": 0.03, "unit": "normalized", "origin": "top-left" },
          "text": "the quick brown fox jumps over the lazy dog",
          "message": "第 3 页两处文本重叠，重叠面积占较小文本块 41%",
          "evidence": { "snippet": "the quick brown fox / jumps over the lazy dog" },
          "suggestedFix": "检查第 3 页表格上方段落的行距与绝对定位"
        }
      ],
      "limitations": []
    },
    {
      "ruleId": "pdf.content.section-presence",
      "ruleVersion": "1.0.0",
      "status": "UNVERIFIED",
      "coverage": { "pagesChecked": 0, "pagesTotal": 42, "unitsChecked": 0, "unitsTotal": 15 },
      "issues": [],
      "limitations": ["未提供原文材料，且未在契约中列出章节标题，无法比对"]
    }
  ],
  "summary": { "blocking": 0, "major": 1, "minor": 0, "review": 0, "unverified": 1 },
  "limitations": [
    "未提供原文材料，内容完整性未做全文比对",
    "第 12 页为扫描图，未做文本比对"
  ]
}
```

---

## 附录 C：术语表

| 术语 | 含义 |
| --- | --- |
| 验收契约 | 把交付要求转成可检查条件的 JSON 文档 |
| 检查单元 | 测试标注的最小单位：规则 + 页 + 区域 |
| confirmed / suspected | 证据充分 / 可疑，决定 FAIL 还是 REVIEW |
| UNVERIFIED | 应检查但缺少必要条件，不等于通过 |
| 契约哈希 | 规范化契约 JSON 的 sha256，复检可比性的锚点 |
