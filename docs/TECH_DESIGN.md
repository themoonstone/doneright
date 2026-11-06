# DoneRight V0.1 技术设计

| 项目 | 内容 |
| --- | --- |
| 文档版本 | V0.1（实施稿） |
| 日期 | 2026-11-06 |
| 上游文档 | [PRD V0.2](./PRD.md) · [评审记录](./REVIEW.md) |
| 已确认决策 | D-01 引擎 TypeScript + `pdfjs-dist`；D-02 最低 DSH `0.2.2-rc.1` |
| 当前状态 | Spike 已通过（2026-11-06）；待实施评审，通过后进入编码 |

> 本文只回答「怎么实现」。产品语义、状态模型、报告字段以 PRD 为准；两者冲突时以 PRD 为准，并在本文「修订记录」登记。

---

## 0. 摘要

V0.1 是一个 **单进程 DSH Host 插件 + 隔离 worker + 纯 TS PDF 引擎**：

- Host 侧只做参数解析、路径授权、契约加载、报告落盘和卡片渲染（`adapter`）。
- 检测逻辑全部在 `worker_threads` 中运行，内存与崩溃不影响 Harness 主进程。
- PDF 解析用 `pdfjs-dist`（legacy build，Node 直接可用），页面框与加密元数据用 `pdf-lib` 兜底；不引入任何原生模块，不需要 Python。
- 产物只有两样：结构化 JSON + Markdown 报告。聊天卡片是摘要，不是权威结果。

### 0.1 关键技术判断

| 判断 | 结论 |
| --- | --- |
| PDF 引擎 | `pdfjs-dist@5.x`（Apache-2.0），Node 下用 `legacy/build/pdf.mjs` |
| 是否需要自带渲染 | 不需要。V0.1 不做截图，坐标与文本足以定位 |
| 重叠检测的主信号 | 文本 run 的包围盒几何，不做像素比对 |
| 内容比对的主信号 | 归一化字符串包含 + 有界相似度，不做语义模型 |
| 崩溃隔离 | worker + 硬超时 + 部分结果回传，不用 `try/catch` 假装安全 |
| 复检的身份 | `ruleId + page + bbox IoU`，issue id 只用于展示 |

### 0.2 未决项的执行默认值

PRD §13.2 还有四项未最终确认。在未另行确认前，实现按以下默认值执行，均可在配置中覆盖：

| 项 | 默认值 |
| --- | --- |
| 报告目录 | `<workspace>/.doneright/reports/<reportId>/` |
| 许可证 | MIT |
| 工具 / 命令 | `doneright_check` / `/doneright` |
| V0.1 截图证据 | 不做；`evidence.screenshot` 字段保留但恒为空 |

---

## 1. 交付范围

### 1.1 V0.1 交付物

| # | 交付物 | 验收方式 |
| --- | --- | --- |
| 1 | 可安装的 DSH 插件 bundle（`pnpm` 安装，重启后加载） | 在 DSH `0.2.2-rc.1` 上 `plugin_manager install_bundle` 成功，`doneright_check` 可见 |
| 2 | 工具 `doneright_check` | 对正常 / 损坏 / 扫描 PDF 各跑一次，返回结构化结果 |
| 3 | 命令 `/doneright` | 不产生模型轮次，直接输出报告路径与摘要 |
| 4 | 检查器 A / B / C | 结构、布局、内容；D 只留接口 |
| 5 | 报告 writer | JSON + Markdown，schema 校验通过 |
| 6 | 复检 diff | 传入上一份报告，输出 resolved / persisting / new / regressed |
| 7 | 语料与标注 | ≥ 60 份 PDF、标注 JSON、指标脚本 |
| 8 | CLI（内部） | `node dist/cli.js check <pdf>`，供 CI 与调试使用 |
| 9 | 安装与使用文档 | README + 一份中文 quickstart |

### 1.2 不在本期

- 不做自动触发、产物自动发现（V0.2）。
- 不做修复执行，只给 `suggestedFix` 文本。
- 不做页面渲染与截图、不做 OCR、不做视觉模型。
- 不做 DOCX / PPTX / XLSX / 代码检查。
- 不做 Web UI 页面；只用工具卡片与命令输出。

---

## 2. 技术栈

| 组件 | 版本 | 用途 | 备注 |
| --- | --- | --- | --- |
| Node | `>=22`，基线 `24.21.0` | 运行时 | DSH 桌面版内置版本 |
| TypeScript | `~5.7` | 源码 | `strict: true`，`module: nodenext` |
| `pdfjs-dist` | `5.x`（锁定精确版本） | 解析、文本、坐标、页面框 | Apache-2.0；Node 用 legacy build |
| `pdf-lib` | `1.17.x` | 页面框、加密元数据、损坏兜底 | MIT |
| `vitest` | `3.x` | 单元与集成测试 | 仅 devDependency |
| `tsc` | 随 TS | 构建 | 不引入 bundler，输出 ESM 到 `dist/` |
| `eslint` + `typescript-eslint` | 最新 | 静态检查 | 加一条「core 不得 import dsh」规则 |

**不引入**：`@napi-rs/canvas`、`sharp`、`puppeteer`、任何 Python 运行时、任何 AGPL 组件。

依赖安装策略：`pdfjs-dist` 与 `pdf-lib` 作为普通 `dependencies` 随插件安装；`pdfjs-dist` 的 `cmaps/` 与 `standard_fonts/` 在构建时复制到 `dist/assets/`，运行时用绝对路径传给 `getDocument`，避免 pdfjs 去网络抓取。

---

## 3. 目录结构

```text
doneright/
  package.json
  tsconfig.json
  cordis.patch.yml
  README.md
  CHANGELOG.md
  docs/
    PRD.md
    REVIEW.md
    TECH_DESIGN.md
    spike-report.md          # 已产出（2026-11-06）
  scripts/
    copy-assets.mjs          # 复制 cmaps / standard_fonts
    check-deps.mjs           # 依赖方向断言
    build-corpus.mjs         # 用 pdf-lib 生成合成样本
    metrics.mjs              # 跑语料并计算召回/误报
  spike/
    probe.mjs                # pdfjs 能力探针（不进发布包）
    calibrate.mjs            # 已知坐标样本的误差测量
  src/
    index.ts                 # Host 插件入口：apply(ctx, config)
    config.ts                # 配置类型与校验
    adapter/
      tool.ts                # doneright_check 定义
      command.ts             # /doneright 定义与参数解析
      paths.ts               # 路径规范化与授权
      presentation.ts        # 卡片 / Markdown 摘要
    core/
      types.ts               # 全部领域类型
      contract/
        schema.ts            # 契约 JSON Schema
        load.ts              # 读取、校验、补默认值
        hash.ts              # 规范化 JSON + sha256
        defaults.ts          # 无契约时的默认规则集
      rules/
        registry.ts          # 规则目录（13 条）
        severity.ts          # required / optional 判定
      orchestrator.ts        # 主流程编排
      aggregate.ts           # 单项 → 总体状态
      report/
        build.ts
        write.ts
        markdown.ts
        schema.json          # 报告 JSON Schema（构建期复制）
      diff.ts
      normalize.ts
      i18n.ts
      errors.ts
    engine/
      pdf-engine.ts          # 接口
      pdfjs/
        engine.ts
        text.ts              # run 提取与坐标换算
        geometry.ts          # 页面框、旋转
        assets.ts            # cMap / 字体路径解析
    detectors/
      structure.ts
      layout.ts
      content.ts
      visual.ts              # V0.1 空实现
      table.ts               # 表格溢出启发式
    worker/
      entry.ts               # worker 入口
      protocol.ts            # 消息类型
      runner.ts              # 检查器调度
    cli.ts
  locale/
    zh.json
    en.json
  tests/
    unit/
    integration/
    golden/
    corpus/
      clean/
      defective/
      scanned/
      encrypted/
      edge/
    labels/
    fixtures/
```

---

## 4. 架构与依赖规则

```text
index.ts (adapter)
  ├─ tool.ts / command.ts
  ├─ core/orchestrator.ts
  │    ├─ core/contract/*
  │    ├─ core/rules/*
  │    ├─ core/report/*
  │    └─ worker/client.ts  ──spawn──▶ worker/entry.ts
  │                                        ├─ detectors/*
  │                                        └─ engine/pdfjs/*
  └─ adapter/presentation.ts
```

**硬规则（CI 强制）**：

1. `src/core/**`、`src/engine/**`、`src/detectors/**`、`src/worker/**` 不得 import `@deepseek-ai/*`。
2. `src/adapter/**` 是唯一可以接触 `ctx`、`ToolRunContext` 的目录。
3. 除 `src/worker/client.ts` 外，任何模块不得直接 `new Worker`。
4. `core` 不得 import `node:fs`；文件读写只允许出现在 `adapter`（报告落盘）与 `worker`（读取 PDF）。

`scripts/check-deps.mjs` 用简单的正则扫描 import 语句即可，不引入额外工具。

---

## 5. 核心类型

`src/core/types.ts` 是唯一事实来源，其他模块只 import 这里的类型。

```ts
export type Severity = 'blocking' | 'major' | 'minor' | 'info';
export type CheckStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'UNVERIFIED' | 'SKIPPED' | 'ERROR';
export type OverallStatus = 'PASS' | 'FAIL' | 'REVIEW' | 'ERROR';

export interface BboxPt {
  x: number; y: number; w: number; h: number;   // 可见页面左上原点，单位 pt
}

export interface BboxNorm {
  x: number; y: number; w: number; h: number;
  unit: 'normalized';
  origin: 'top-left';
}

export interface ArtifactRef {
  path: string;        // 相对 workspace 的 POSIX 路径，展示用
  absPath: string;     // 仅内部使用，不写入报告
  sha256: string;
  bytes: number;
  pages: number;
}

export type RequirementKind = 'section' | 'sentence' | 'heading' | 'prohibited' | 'order';

export interface Requirement {
  id: string;                 // req_001
  kind: RequirementKind;
  value: string;              // 章节标题 / 原文句子 / 禁止出现的文本
  severity: Severity;
  required: boolean;          // false = 用户关闭
  source: 'user' | 'inferred' | 'builtin';
  confirmedByUser: boolean;   // inferred 必须 true 才能判 FAIL
  pagesHint?: number[];
}

export interface Contract {
  schemaVersion: '1.0';
  contractId: string;         // ctr_<yyyymmdd>_<6hex>
  artifact?: { path?: string; expectedPages?: number; maxPages?: number };
  requirements: Requirement[];
  options: {
    requireFullCoverage: boolean;   // 有原文时是否要求全文覆盖
    strictHeadings: boolean;        // 标题是否必须精确匹配
    includeHeadersFooters: boolean; // 内容比对是否保留页眉页脚
  };
  createdAt: string;
  contractHash?: string;      // 加载后计算，不参与自身哈希
}

export interface Issue {
  id: string;                 // iss_<12hex>
  ruleId: string;
  ruleVersion: string;
  severity: Severity;
  page: number;               // 1-based
  bbox?: BboxNorm;
  overflowPt?: Partial<Record<'left' | 'right' | 'top' | 'bottom', number>>;
  text?: string;              // ≤ 200 字符
  message: string;
  evidence?: { snippet?: string; screenshot?: string; relatedIssueId?: string };
  suggestedFix?: string;
  confidence: 'confirmed' | 'suspected';
}

export interface CheckResult {
  ruleId: string;
  ruleVersion: string;
  status: CheckStatus;
  coverage: { pagesChecked: number; pagesTotal: number; unitsChecked?: number; unitsTotal?: number };
  issues: Issue[];
  limitations: string[];
  metrics?: Record<string, number>;
  durationMs: number;
  /** 内部字段：不写入 report.json，聚合时使用 */
  skipReason?: 'user-disabled' | 'not-applicable' | 'limit-exceeded';
}

export interface Report {
  schemaVersion: '1.0';
  reportId: string;
  status: OverallStatus;
  artifact: Omit<ArtifactRef, 'absPath'>;
  contract: { contractId: string; contractHash: string; requirements: number };
  runtime: {
    doneright: string;
    engine: string;           // pdfjs-dist@5.4.149
    dsh: string;
    node: string;
    platform: string;
    startedAt: string;
    durationMs: number;
    normalizationVersion: string;
  };
  checks: Array<Omit<CheckResult, 'skipReason'>>;
  summary: { blocking: number; major: number; minor: number; review: number; unverified: number };
  limitations: string[];
  previousReport?: string;
  diff?: DiffSummary;
}
```

**类型约定**：

- `BboxNorm` 的值允许略超出 `[0,1]` 吗？不允许。报告里的 `bbox` 一律 clamp 到 `[0,1]`；越界量另放 `overflowPt`，避免下游渲染时出错。
- 所有面向用户的字符串（`message`、`suggestedFix`、`limitations`）在构建 Issue 时已经按 locale 渲染好；报告不存双语。

---

## 6. PDF 引擎适配层

### 6.1 接口

```ts
// src/engine/pdf-engine.ts
export interface TextRun {
  text: string;
  bbox: BboxPt;        // 可见页面左上原点
  fontSize: number;    // pt
  fontName?: string;
  angle: number;       // 文本基线角度，0 / 90 / 180 / 270 为主
  isWhitespace: boolean;
}

export interface ImageBox {
  bbox: BboxPt;
  hasAlpha: boolean | 'unknown';
}

export interface PageInfo {
  index: number;       // 0-based
  width: number;       // pt，可见框宽
  height: number;
  rotation: number;
  pageBox: 'CropBox' | 'MediaBox';
}

export interface PdfDocumentHandle {
  pageCount: number;
  pages(): AsyncIterable<PdfPageHandle>;
  close(): Promise<void>;
}

export interface PdfPageHandle extends PageInfo {
  textRuns(): Promise<TextRun[]>;
  images(): Promise<ImageBox[]>;
  drawings(): Promise<Array<{ bbox: BboxPt; kind: 'rect' | 'line' | 'path' }>>;
}

export interface PdfEngine {
  readonly name: string;
  readonly version: string;
  open(input: { data: Uint8Array; password?: string }): Promise<PdfDocumentHandle>;
}
```

`detectors` 只依赖这个接口。以后加 PDFium WASM Provider，只需实现同一接口。

### 6.2 pdfjs 初始化

```ts
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cMapUrl, standardFontDataUrl } from './assets.js';

const task = pdfjs.getDocument({
  data,
  password,
  cMapUrl,                  // dist/assets/cmaps/，以 / 结尾
  cMapPacked: true,
  standardFontDataUrl,      // dist/assets/standard_fonts/，以 / 结尾
  disableFontFace: true,
  useSystemFonts: false,
  isEvalSupported: false,   // 关闭 eval，减少攻击面
  useWorkerFetch: false,
  verbosity: 0,
});
const doc = await task.promise;
```

说明：

- legacy build 在 Node 下不需要浏览器 Worker；pdfjs 会走 fake worker。我们本身已经在 `worker_threads` 里，不再额外开线程。
- `cmaps` / `standard_fonts` 必须随包提供，否则 CJK 与标准字体 PDF 的文本提取会失败或回退到网络（默认禁用）。
- 加密 PDF：`getDocument` 在缺密码时抛 `PasswordException`，捕获后映射为 `E_ENCRYPTED`，不尝试破解。

### 6.3 文本 run 与坐标换算

```ts
const viewport = page.getViewport({ scale: 1 });   // 已包含 /Rotate 与 CropBox 偏移
const content = await page.getTextContent();

for (const item of content.items) {
  if (!('str' in item) || item.str.length === 0) continue;

  const m = pdfjs.Util.transform(viewport.transform, item.transform);
  const fontSize = Math.hypot(m[2], m[3]) || item.height || 10;
  const angle = normalizeAngle(Math.atan2(m[1], m[0]) * 180 / Math.PI);

  // item.width / item.height 已是 viewport 单位（scale=1 即 pt）
  const w = item.width > 0 ? item.width : fontSize * item.str.length * 0.5;
  const h = item.height > 0 ? item.height : fontSize;

  // m[5] 是基线 y；转换为包围盒顶边
  const left = m[4];
  const top = m[5] - h;

  runs.push({
    text: item.str,
    bbox: { x: left, y: top, w, h },
    fontSize,
    fontName: item.fontName,
    angle,
    isWhitespace: item.str.trim().length === 0,
  });
}
```

边界处理：

| 情况 | 处理 |
| --- | --- |
| `fontSize < 4pt` | 保留，但布局检测忽略（视为脚注/水印） |
| `angle ∉ {0, 180}` | V0.1 不参与重叠判定，记入 `limitations`；内容比对仍用文本 |
| `item.width === 0` | 用 `fontSize × 字符数 × 0.5` 估算，并标记 `metrics.estimatedWidths` |
| 负 `w` / `h` | 取绝对值；若仍异常则丢弃该 run 并计数 |
| 文本层存在但可打印字符占比 < 0.5 | 判定为 `TEXT_UNRELIABLE`，内容检查 `UNVERIFIED` |

### 6.4 页面框与旋转

`page.getViewport({ scale: 1 })` 使用的是 `page.view`（CropBox ∩ MediaBox）并按 `page.rotate` 旋转，因此：

- `viewport.width / height` 就是可见区域尺寸；
- `viewport.transform` 已经把 PDF 用户坐标（左下原点）映射到左上原点的设备坐标；
- 归一化只需除以 `viewport.width / height`，不需要再手动处理 CropBox。

```ts
const toNorm = (b: BboxPt) => ({
  x: clamp01(b.x / viewport.width),
  y: clamp01(b.y / viewport.height),
  w: clamp01(b.w / viewport.width),
  h: clamp01(b.h / viewport.height),
  unit: 'normalized' as const,
  origin: 'top-left' as const,
});
```

`clamp01` 只用于报告输出；越界检测必须在 clamp 之前用 pt 值计算。

### 6.5 扫描件与损坏件判定

| 判定 | 规则 | 结果 |
| --- | --- | --- |
| 解析失败 | `InvalidPDFException` / `FormatError` | `pdf.structure.parse` = `ERROR`（附解析器错误原文），总体 `ERROR` |
| 需要密码 | `PasswordException` | `pdf.structure.parse` = `ERROR`，提示解密后重试 |
| 0 页 | `numPages === 0` | `pdf.structure.parse` = `ERROR` |
| 页面框非法 | 宽或高 ≤ 0，或 > 14400pt（200 英寸） | `pdf.structure.page-box` = `FAIL`（major） |
| 页面尺寸混用 | 同文档各页宽高差异 > 5% | `pdf.structure.page-box` = `REVIEW`（minor） |
| 扫描件 | 全文字符数 / 页数 < 20，且存在图像 | 结构 `PASS`；内容类检查 `UNVERIFIED`；总体 `REVIEW` |
| 文本层不可靠 | 可打印字符占比 < 0.5 | 内容类检查 `UNVERIFIED`，`limitations` 说明 |

「损坏」与「扫描」必须分开：解析成功但没文本层，是扫描件，不是坏文件。

> 注意：PRD §4.1 把「解析失败 / 加密 / 0 页」定为 `ERROR`，实现照此执行。代价是「文件损坏」与「工具故障」在总体状态上不可区分，只能靠 `checks[].status` 与错误码分辨。这条已列入 §17 开放问题，建议 V0.2 重新评估是否改为 `FAIL`。

---

## 7. Worker 协议与隔离

### 7.1 为什么必须是 worker

`pdfjs` 解析恶意/畸形 PDF 时可能抛原生错误、死循环或吃满内存；`try/catch` 挡不住 OOM 与栈溢出。worker 至少保证：

- 崩溃只影响本次检查，Harness 主进程存活；
- `resourceLimits.maxOldGenerationSizeMb` 限制堆；
- 硬超时后 `terminate()` 可以回收。

### 7.2 消息协议

```ts
// src/worker/protocol.ts
export type MainToWorker =
  | { type: 'run'; job: RunJob }
  | { type: 'cancel'; jobId: string };

export interface RunJob {
  jobId: string;
  pdfPath: string;              // 绝对路径，worker 自己读
  pdfSha256: string;            // adapter 预算，worker 复核
  contract: Contract;
  sources?: Array<{ name: string; path: string }>;
  limits: { maxBytes: number; maxPages: number; timeoutMs: number };
  locale: 'zh' | 'en';
}

export type WorkerToMain =
  | { type: 'ready'; jobId: string }
  | { type: 'progress'; jobId: string; phase: string; page?: number; pagesTotal?: number }
  | { type: 'check'; jobId: string; result: CheckResult }        // 每完成一个检查器发一次
  | { type: 'done'; jobId: string; report: Omit<Report, 'diff'> }
  | { type: 'failed'; jobId: string; code: string; message: string; partial: CheckResult[] };
```

`check` 消息是「部分结果」的来源：worker 中途被 kill 时，adapter 仍能拿到已完成的检查器结果，并在报告里如实标注哪些没跑完。

### 7.3 生命周期

```ts
const worker = new Worker(new URL('../worker/entry.js', import.meta.url), {
  resourceLimits: { maxOldGenerationSizeMb: 512 },
});
```

1. adapter 计算 sha256（流式），拿到字节数与页数上限预检。
2. 启动 worker，发送 `run`。
3. 收到 `progress` 更新「当前阶段」，供卡片显示（V0.1 不推送实时进度，只用于超时诊断）。
4. 总超时（默认 180s）：`setTimeout` → `worker.terminate()` → 用 `partial` 生成 `ERROR` 报告。
5. 收到 `done` → 校验 report → 落盘。
6. 无论成败，`finally` 中 `terminate()` 并清理临时目录。

**已知限制（写进文档，不假装解决）**：单个检查器内部的死循环无法被 `terminate()` 之外的机制打断；V0.1 只有总超时，没有可靠的「单检查器 60s 硬超时」。实现上用软超时（检查器自己按页检查 `Date.now()`）尽量提前退出，但报告里该检查器标记为 `ERROR` 时，原因写「超时」而不是「未发现问题」。

### 7.4 资源限制落点

| 限制 | 检查位置 | 超限行为 |
| --- | --- | --- |
| 文件大小 ≤ 100MB | adapter 预检 | 不启动 worker，`ERROR` + `E_TOO_LARGE` |
| 页数 ≤ 300 | worker 打开文档后 | 结构 `SKIPPED`（`limit-exceeded`），其余检查 `SKIPPED`，总体 `REVIEW` |
| 总耗时 ≤ 180s | adapter 定时器 | terminate + `ERROR`，附部分结果 |
| 堆 ≤ 512MB | worker `resourceLimits` | OOM → `failed`，`E_OOM` |
| 单文件并发 | 全局信号量 1（V0.1） | 第二次调用排队，不并行 |

---

## 8. 检查器实现

### 8.1 结构检查器（A）

规则 ID 与判定：

| ruleId | 检查 | 通过条件 | 失败映射 |
| --- | --- | --- | --- |
| `pdf.structure.parse` | 可解析、未加密、页数有效 | `getDocument` 成功；`numPages ≥ 1`；无密码 | 解析失败 / 加密 / 0 页 → `ERROR`（附错误码与原文） |
| `pdf.structure.page-box` | 页面框合法性 | 每页宽高 > 0 且 ≤ 14400pt；同文档尺寸差异 ≤ 5% | 非法 → `FAIL` major；尺寸混用 → `REVIEW` minor |
| `pdf.structure.blank-page` | 空白页 | 每页至少有文本、图像或路径之一 | 存在空白页 → `REVIEW` minor |
| `pdf.structure.text-layer` | 文本层 | 全文字符数 / 页数 ≥ 20 | 否则 `PASS` + 内容检查 `UNVERIFIED`（`info` 记录） |
| `pdf.structure.font-embedding` | 字体嵌入 | P1 能力 | V0.1 `SKIPPED`（`not-applicable`） |

页数超限（`numPages > maxPages`）不属于上述规则的失败，而是资源限制：所有检查 `SKIPPED`（`limit-exceeded`），总体 `REVIEW`。

实现要点：

- 逐页读取 `textRuns()` 只为统计字符数与判断空白；不要为结构检查跑完整布局。
- 空白页判定：`runs.filter(r => !r.isWhitespace).length === 0 && images.length === 0 && drawings.length === 0`。
- 页数超限时不要偷偷只检查前 300 页；直接 `SKIPPED` 并在 `limitations` 写 `limit-exceeded: 412 > 300`。

### 8.2 布局检查器（B）

#### 8.2.1 越界（`pdf.layout.text-out-of-page`）

```text
for each run (非空白, fontSize ≥ 4):
  outLeft   = max(0, -bbox.x)
  outRight  = max(0, bbox.x + bbox.w - page.width)
  outTop    = max(0, -bbox.y)
  outBottom = max(0, bbox.y + bbox.h - page.height)
  overflowAreaRatio = 溢出面积 / bbox 面积
  if overflowAreaRatio > 0.20 → FAIL(major)，confidence=confirmed
  else if 任一方向 > 2pt     → REVIEW(minor)，confidence=suspected
```

- 判定用 pt，不用归一化值；页面尺寸小的样本用 2pt 容差足够。
- 整段文本都在页面外（`overflowAreaRatio > 0.95`）时，可能是被裁剪的水印/隐藏层：降为 `REVIEW`，并附 `suggestedFix`「确认是否为隐藏图层」。

#### 8.2.2 文本重叠（`pdf.layout.text-overlap`）

这是误报率最高的规则，算法必须保守。

```text
1. 取所有非空白 run（fontSize ≥ 4，宽高 > 0.5pt，angle ∈ {0,180}）。
2. 按 y 中心聚类成行：|yCenter_a - yCenter_b| ≤ 0.5 × medianHeight → 同一行。
3. 只比较「不同行」的 run 对；同一行内的相邻字距不参与。
4. 对每对：
     inter = intersect(a.bbox, b.bbox)
     ratio = inter.area / min(a.area, b.area)
     vOverlap = inter.h / min(a.h, b.h)
     if ratio ≥ 0.35 && vOverlap ≥ 0.5 → confirmed
     else if ratio ≥ 0.15 && vOverlap ≥ 0.5 → suspected
5. 排除：
   - 文本相同且偏移 < 0.3pt（模拟加粗）→ info，不产生 FAIL；
   - 文本相同且一个 bbox 包含另一个 → info；
   - 任一方是纯标点 → 跳过；
   - 两 run 属于同一行（步骤 3 已排除）。
6. 用并查集把 confirmed 的 run 对合并成「重叠簇」，每个簇输出一个 issue：
   bbox = 簇并集，text = 两个最长 run 的摘录，metrics 记录 pair 数。
```

阈值来源：PRD 的 0.35 / 0.15，写进规则常量，不在代码里散落。

**负样本必须覆盖**：上标/下标、表格紧排、中英混排、两端对齐产生的字距为 0、字体本身带负 side bearing（如某些斜体）。

#### 8.2.3 贴近裁切边（`pdf.layout.edge-proximity`）

正文 bbox 距可见区域边缘 < 2pt → `REVIEW` minor。页眉页脚（位于页面上下 8% 且整页重复）排除。

#### 8.2.4 表格单元格溢出（`pdf.layout.table-overflow`）

pdfjs 不提供表格结构，V0.1 用 `getOperatorList()` 的矩形/线条重建「网格假设」：

1. 收集所有 `rect` 类型路径（填充或描边），过滤掉面积 < 4pt² 的。
2. 若同一页存在 ≥ 4 条水平线与 ≥ 2 条垂直线，且端点对齐，视为表格网格。
3. 相邻线围成单元格；把中心落在单元格内的 run 归入该格。
4. `textWidth > cellWidth × 1.05` → `REVIEW` minor（**不判 FAIL**，PRD R9）。

失败即降级：网格识别不到就不出结果，并在 `limitations` 写「未识别到表格结构，跳过单元格溢出检查」，不猜。

#### 8.2.5 图文遮挡（`pdf.layout.image-overlap`）

- 条件：图像 bbox 覆盖文本 bbox ≥ 0.9，且图像在操作符序列中晚于文本绘制。
- 输出 `REVIEW` minor，`confidence=suspected`；无渲染无法确认透明通道时，`hasAlpha` 记 `unknown`。
- V0.1 允许误报，但只到 `REVIEW`。

### 8.3 内容检查器（C）

#### 8.3.1 文本装配

```text
1. 每页 run 按 (行, x) 排序：先 y 升序（top-left 坐标系），y 差 ≤ 0.5×行高视为同行，再按 x 升序。
2. 同一行内，若相邻 run 的间隙 > 0.2 × fontSize，插入一个空格。
3. 行间用 "\n"；页间用 "\n\n"。
4. 若行尾是 "-" 且下一行首字母为小写字母，删除连字符并直接拼接（去断词）。
```

#### 8.3.2 归一化管线

顺序固定，`normalizationVersion = "1.0"`：

```ts
export function normalize(input: string, opts: { keepHeaders: boolean }): string {
  let s = input.normalize('NFKC');
  s = s.replace(/[\u2018\u2019\u201B]/g, "'")
       .replace(/[\u201C\u201D\u201F]/g, '"')
       .replace(/[\u2010-\u2015\u2212]/g, '-')
       .replace(/\u00A0/g, ' ')
       .replace(/[\u200B-\u200D\uFEFF]/g, '');
  s = s.replace(/\s+/g, ' ').trim();          // 先压空白，供 CJK 判断
  const cjk = (s.match(/[\u4E00-\u9FFF]/g)?.length ?? 0) / Math.max(1, s.length);
  if (cjk > 0.3) s = s.replace(/ /g, '');     // 中文比对忽略空格
  if (!opts.keepHeaders) s = stripRunningHeaders(s);
  return s;
}
```

`stripRunningHeaders` 只在提供多页文本时生效：统计每页首行/末行，出现率 ≥ 60% 且长度 < 80 的行视为页眉页脚，从比对文本中移除，并在 `limitations` 记录移除数量。

#### 8.3.3 匹配

| 要求类型 | ruleId | 匹配方式 | 失败判定 |
| --- | --- | --- | --- |
| `heading` / `section` | `pdf.content.section-presence` | 归一化后 `includes`；`strictHeadings=true` 时要求行首匹配 | 缺失 → `FAIL` blocking |
| `sentence`（≤ 40 字符） | `pdf.content.phrase-presence` | 归一化后 `includes` | 缺失 → `FAIL` blocking |
| `sentence`（> 40 字符） | `pdf.content.phrase-presence` | 先精确 `includes`；否则在「页内句子块」上算相似度 | ≥ 0.92 记为匹配但 `fuzzyHits++`；0.80–0.92 → `REVIEW`；< 0.80 → `FAIL` |
| `prohibited` | `pdf.content.prohibited-presence` | 归一化后 `includes` | 出现 → `FAIL` blocking |
| `order` | `pdf.content.order` | 各 heading 首次出现位置单调递增 | 逆序 → `REVIEW` minor |

相似度用**有界 Levenshtein**：只在 `|lenA - lenB| / maxLen ≤ 0.2` 时计算，并对长度设上限（> 2000 字符的句子降级为前缀/后缀匹配），避免 O(n²) 拖垮大文档。

「页内句子块」切分：按 `[。！？!?；;]` 与换行切分，块长度 ≥ 20 字符；每块与目标句算相似度，取最大值。

#### 8.3.4 全文覆盖（可选）

提供 `sources` 时：

- 若 `contract.options.requireFullCoverage = true`：把原文按同样规则切成句子（≥ 20 字符），逐句检查；缺失 → `FAIL` major（不是 blocking，因为原文可能包含无需输出的内容）。
- 否则只计算 `sourceCoverageRate` 放进 `metrics`，不产生 issue，并在 `limitations` 写「仅统计覆盖率，未逐句判定」。

#### 8.3.5 无契约 / 无原文

- 无契约：用默认规则集（只跑结构 + 布局 + 一个合成检查 `contract.confirmed = UNVERIFIED`），总体不得 `PASS`。
- 无原文且契约只列了章节标题：只验证标题；`limitations` 必须写「未做全文比对」。

### 8.4 视觉检查器（D，空实现）

```ts
export const visualChecker: Checker = {
  id: 'pdf.visual.advisory',
  version: '0.0.0',
  async run() {
    return {
      ruleId: 'pdf.visual.advisory',
      ruleVersion: '0.0.0',
      status: 'SKIPPED',
      coverage: { pagesChecked: 0, pagesTotal: 0 },
      issues: [],
      limitations: ['V0.1 不启用视觉审查'],
      durationMs: 0,
    };
  },
};
```

---

## 9. 编排流程

```text
doneright_check(args)
  ├─ 1. 解析参数、展开路径、授权检查
  ├─ 2. 读契约（或生成默认契约）→ 补默认值 → 计算 contractHash
  ├─ 3. 预检文件：存在、可读、大小、扩展名
  ├─ 4. 计算 sha256（流式）与字节数
  ├─ 5. 启动 worker，发送 run
  ├─ 6. 收集 check 消息；超时/崩溃则用 partial 收尾
  ├─ 7. 聚合总体状态（core/aggregate.ts）
  ├─ 8. 若传了 previousReport：读入、校验 contractHash、计算 diff
  ├─ 9. 生成 reportId，写 report.json + report.md（原子写）
  └─ 10. 返回摘要给 adapter 渲染
```

### 9.1 契约哈希

```ts
export function contractHash(c: Contract): string {
  const canonical = JSON.stringify(sortKeys({ ...c, contractHash: undefined }));
  return sha256(canonical);
}
```

`sortKeys` 递归排序对象键；数组保持原顺序（requirements 顺序有意义）。`contractHash` 字段本身不参与计算。

### 9.2 聚合

按 PRD §5.1 的顺序判定，实现为一个纯函数：

```ts
export function aggregate(checks: CheckResult[], requirements: Requirement[]): OverallStatus {
  const issues = checks.flatMap(c => c.issues);
  if (issues.some(i => i.confidence === 'confirmed' && (i.severity === 'blocking' || i.severity === 'major'))) {
    return 'FAIL';
  }
  const required = (c: CheckResult) => isRequired(c.ruleId, requirements);
  if (checks.some(c => required(c) && c.status === 'ERROR')) return 'ERROR';
  if (
    issues.some(i => i.confidence === 'suspected') ||
    checks.some(c => required(c) && c.status === 'UNVERIFIED') ||
    checks.some(c => required(c) && c.status === 'SKIPPED' && c.skipReason === 'limit-exceeded') ||
    checks.some(c => !required(c) && c.status === 'ERROR')
  ) {
    return 'REVIEW';
  }
  return 'PASS';
}
```

补充：`checks` 为空、或全部 `SKIPPED(user-disabled)` 时返回 `REVIEW`，不能 `PASS`（覆盖率为 0）。

`CheckResult` 需要补一个内部字段 `skipReason?: 'user-disabled' | 'not-applicable' | 'limit-exceeded'`；写报告时映射到 `limitations` 文案，不直接暴露给 schema。

### 9.3 报告落盘

- 目录：`<workspace>/.doneright/reports/rpt_<yyyymmdd>_<hhmmss>_<6hex>/`
- 文件：`report.json`、`report.md`；`report.json` 先写 `report.json.tmp` 再 `rename`。
- 同名冲突：追加 `-2`、`-3`，绝不覆盖。
- 每次运行追加一行到 `<workspace>/.doneright/history.jsonl`：`{ reportId, artifactSha256, artifactPath, contractHash, status, confirmedIssues, at }`。只追加、不修改；读取时按 `artifactSha256 + contractHash` 过滤，取最近 5 条。文件损坏或某行不是合法 JSON 时跳过该行并记日志，不阻塞检查。
- `.doneright/` 首次创建时写入一个 `.gitignore`（内容 `reports/`），避免用户误提交。

---

## 10. 复检与 diff

```ts
export interface DiffSummary {
  baselineReportId: string;
  contractHashMatched: boolean;
  resolved: IssueRef[];
  persisting: IssueRef[];
  new: IssueRef[];
  regressed: IssueRef[];
  counts: { resolved: number; persisting: number; new: number; regressed: number };
  noImprovementStreak: number;   // 同 artifact + 同契约连续无改善次数（来自 history）
}
```

算法：

1. 读基线报告，校验 `schemaVersion`；`contractHash` 不同 → `contractHashMatched=false`，diff 照算，但报告顶部与卡片都提示「契约已变更，结果不可直接比较」。
2. 对每个基线 issue，找当前 issue：`ruleId` 相同 + `page` 相同 + `bbox` IoU ≥ 0.5；没有 bbox 时用 `text` 相似度 ≥ 0.9。
3. 一对一匹配（贪心，按 IoU 降序），避免一个当前 issue 匹配多个基线 issue。
4. 未匹配的基线 issue → `resolved`；未匹配的当前 issue → `new`。
5. `regressed`：查 `.doneright/history.jsonl` 中同 artifact（sha256）+ 同 `contractHash` 的最近记录；若某 issue 的指纹（`ruleId + page + 量化 bbox`）在更早报告中出现过、上一份报告里已 `resolved`、本次又出现 → `regressed`。历史不足 2 份时该分类为空。
6. 连续 3 次无改善：读 history 中同 artifact + 同契约的最近 3 条，若均为 `FAIL`/`REVIEW` 且 confirmed issue 数没有下降 → `noImprovementStreak = 3`，报告顶部与卡片提示「疑似修复无效，建议人工介入」。

IoU 计算在归一化坐标上做，页面尺寸不同的重排不会影响同一位置的判定。

---

## 11. Harness 集成

### 11.1 插件入口

```ts
// src/index.ts
import type { Context } from 'cordis';
import { registerTool } from './adapter/tool.js';
import { registerCommand } from './adapter/command.js';

export const name = 'doneright';
export const inject = ['tools', 'commands'];

export interface Config {
  reportDir?: string;
  locale?: 'zh' | 'en';
  limits?: { maxBytes?: number; maxPages?: number; timeoutMs?: number };
  allowOutsideWorkspace?: boolean;
}

export function apply(ctx: Context, config: Config = {}) {
  registerTool(ctx, config);
  registerCommand(ctx, config);
}
```

`ctx.tools.register` / `ctx.commands.register` 返回的 disposer 已经绑定在插件 context 上，插件卸载时会自动释放；不要把它们存到模块级全局变量里，否则重复加载会残留。`inject` 声明 `tools`、`commands` 后，Cordis 会等待对应服务就绪再执行 `apply`。

实现落地（2026-11-06 修订）：两个注册合并进 `src/adapter/harness.ts`，实际配置是 `{ workspaceRoot, outDir, maxBytes, maxPages, timeoutMs, restrictToWorkspace }`；当 `workspaceRoot` 为空时，由 `workingDirectory.ensure(agent, signal)` 提供会话目录。`/doneright` 的入参字段是 `CommandInvocation.rawInput`（不是 `input.text`），解析出 `--contract`、`--strict`、`--json`。

### 11.2 工具定义

```ts
ctx.tools.register({
  name: 'doneright_check',
  description:
    'Verify a generated PDF deliverable against an acceptance contract and return evidence-backed issues. ' +
    'Use after producing or modifying a PDF, before telling the user the work is complete. ' +
    'Do not use for DOCX/PPTX/XLSX or for editing files.',
  parameters: {
    type: 'object',
    properties: {
      pdf: { type: 'string', description: 'Path to the PDF, relative to the workspace.' },
      contract: { type: 'string', description: 'Optional path to a contract JSON.' },
      baseline: { type: 'string', description: 'Optional path to a previous report.json for re-check diff.' },
      out: { type: 'string', description: 'Optional output directory for reports.' },
      rules: {
        type: 'array', items: { type: 'string' },
        description: 'Optional rule ids to run; omit to run all enabled rules.',
      },
    },
    required: ['pdf'],
    additionalProperties: false,
  },
  output: {
    schema: { /* ReportSummary */ },
    render: (args, value) => [{ type: 'text', text: renderSummary(value) }],
  },
  timeoutMs: 240_000,
  isConcurrencySafe: false,
  async execute(args, exec) { /* ... */ },
});
```

要点：

- `description` 是给模型看的，必须写清「何时用 / 何时不用」，否则模型会在生成 DOCX 时也来调用。
- 返回给模型的内容只放摘要（状态、问题数、前 5 条 issue、报告路径），完整报告在文件里；避免把 200 条 issue 灌进上下文。
- `isConcurrencySafe: false`，防止同一 workspace 并发写报告目录。

### 11.3 命令定义

```ts
ctx.commands.register({
  name: 'doneright',
  description: 'Run a PDF acceptance check without a model turn.',
  input: { hint: '<pdf> [--contract <json>] [--baseline <report.json>] [--out <dir>]' },
  async handler(invocation) {
    // 解析 argv → 调 orchestrator → 返回 { kind: 'success', text }
  },
});
```

命令与工具共享同一个 `runCheck()`，区别只在结果如何呈现：命令输出纯文本摘要 + 报告绝对路径，工具返回结构化 JSON。

### 11.4 路径授权

```ts
export function authorize(raw: string, root: string): string {
  const abs = path.resolve(root, raw);
  const real = fs.realpathSync.native(abs);       // 解析 symlink
  const rel = path.relative(root, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new DoneRightError('E_OUTSIDE_WORKSPACE', real);
  }
  return real;
}
```

- workspace 根：实现时确认，宿主进程的 `process.cwd()` 是 profile 目录、不是会话工作区，**不能**用它。改为从 `ctx.get('workingDirectory')` 取 Host Service，调用 `ensure(agent, signal)` 得到该 Session 的绝对目录；配置文件 `workspaceRoot` 可覆盖，最后才回退 `process.cwd()`。
- 路径校验用 `path.relative(base, absolute)` 前缀判断（不解析 symlink 也可以，V0.1 不追随链接）；`outDir` 同样相对 base 解析，避免报告写到 profile 目录。
- 工具返回值必须是无损 JSON：`undefined` 属性会让宿主报 `value is not lossless JSON`，返回前要递归删掉（`JSON.stringify` 不会替你报错）。
- 契约文件、基线报告同样走这个函数。
- 不做「用户传了就视为授权」的放宽；越界路径直接报错，让用户把文件放进工作区。V0.1 的 `allowOutsideWorkspace` 默认 `false`。

### 11.5 卡片渲染

- 工具卡片：一行状态 + 问题计数 + 前 3 条「第 N 页：描述」+ 报告路径。
- 不渲染大表格、不内嵌截图。
- 状态颜色用主题 token（`--dsw-alias-*`），不硬编码色值；`FAIL` 用危险色，`REVIEW` 用警告色，`PASS` 用成功色。

---

## 12. 打包与安装

### 12.1 package.json 关键字段

```json
{
  "name": "dsh-doneright",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "exports": { ".": "./dist/index.js" },
  "files": ["dist", "cordis.patch.yml", "locale", "README.md"],
  "engines": { "node": ">=22", "dsh": ">=0.2.2-rc.1" },
  "dependencies": {
    "pdfjs-dist": "5.x.y",
    "pdf-lib": "1.17.1"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

- `engines.dsh` 是安装闸门：低于 `0.2.2-rc.1` 直接拒绝安装，避免用户在未验证的版本上提交 bug。
- 版本号在 spike 时锁定精确值，不用 `^`，保证报告里的 `engine` 字段可复现。

### 12.2 cordis.patch.yml

```yaml
- insert:
    - id: doneright
      name: dsh-doneright
      config:
        locale: zh
        limits:
          maxBytes: 104857600
          maxPages: 300
          timeoutMs: 180000
```

### 12.3 构建

```bash
pnpm install
pnpm build      # tsc -p tsconfig.build.json && node scripts/copy-assets.mjs
pnpm test
node dist/cli.js check tests/corpus/clean/basic.pdf
```

`copy-assets.mjs` 把 `node_modules/pdfjs-dist/cmaps` 与 `standard_fonts` 复制到 `dist/assets/`；`dist/assets` 进 `files`。

### 12.4 安装验证清单

1. `plugin_manager install_bundle` 成功，无 unmet engines。
2. 重启后 `/doneright --help` 或工具列表出现 `doneright_check`。
3. 对 `tests/corpus/clean/basic.pdf` 运行 → `PASS`，报告文件存在。
4. 对 `tests/corpus/defective/overlap.pdf` 运行 → `FAIL`，issue 有页码与坐标。
5. 卸载后工具消失，`.doneright/` 不被删除。

---

## 13. 测试设计

### 13.1 分层

| 层 | 覆盖 | 工具 |
| --- | --- | --- |
| 单元 | 归一化、相似度、聚合、diff、契约哈希 | vitest，纯函数，无 IO |
| 集成 | worker + pdfjs + 真实 PDF | vitest，跑 `tests/corpus` |
| 金样 | 报告 JSON 与 Markdown 的稳定输出 | 快照对比，允许时间/路径字段归一化 |
| 性能 | 50 页 / 200 页 / 大文件 | `bench` 脚本，记录在 CI artifact |
| 安装 | 打包产物在干净 profile 安装 | 手动 + 发布前 checklist |

### 13.2 语料

| 目录 | 数量 | 内容 |
| --- | --- | --- |
| `clean/` | 20 | 正常报告、论文、手册；含中英、表格、多栏 |
| `defective/` | 25 | 文本重叠、越界、缺章、空白页、页眉页脚错位 |
| `scanned/` | 5 | 纯图像 PDF；用于验证「不判损坏」 |
| `encrypted/` | 3 | 有密码；验证 `E_ENCRYPTED` |
| `edge/` | 7 | 旋转页、CJK 竖排、超长表格、0 页、损坏、超大页面、字体缺字 |

合成样本用 `scripts/build-corpus.mjs` + `pdf-lib` 生成，坐标已知，可直接作为布局检测的 ground truth；真实样本（用户历史案例）脱敏后放 `clean/` 与 `defective/`。

### 13.3 标注格式

```json
{
  "file": "defective/overlap-01.pdf",
  "sha256": "...",
  "units": [
    { "id": "u1", "ruleId": "pdf.layout.text-overlap", "page": 3,
      "bbox": { "x": 0.12, "y": 0.08, "w": 0.5, "h": 0.03 },
      "severity": "major", "confirmed": true }
  ],
  "negatives": [
    { "id": "n1", "page": 4, "bbox": { "x": 0.1, "y": 0.2, "w": 0.6, "h": 0.05 },
      "note": "正常表格紧排，不得报重叠" }
  ]
}
```

### 13.4 指标计算（`scripts/metrics.mjs`）

- 匹配：同 `ruleId` + 同页 + IoU ≥ 0.3；一个预测只能匹配一个标注（贪心）。
- `recall(severity)` = 匹配到的该级标注数 / 该级标注总数。
- `falsePositivePageRate` = 有至少一个未匹配预测的页面数 / 总页数。
- 内容完整性：契约条目逐一比对，缺失即失败，算精确率。
- 定位准确率：匹配上的 issue 中，`page` 正确且 bbox IoU ≥ 0.3 的比例。
- 输出 JSON + Markdown 表，作为发布前的必过项。

### 13.5 CI

- `pnpm lint && pnpm typecheck && pnpm test`
- Windows + Ubuntu，Node 22 / 24。
- 语料指标作为单独 job，阈值不达标时 fail（阈值见 PRD §10.4）。
- 不在 CI 里跑真实用户文件；只用仓库内语料。

---

## 14. Spike 计划与执行（编码前，2 天）

### 14.1 目标

验证「pdfjs 能否作为唯一引擎」，不写业务代码。

### 14.2 脚本

`spike/probe.mjs`：

```text
输入：一个目录
输出：每个文件的 JSON
  { file, ok, errorCode, pages, chars, charsPerPage,
    parseMs, textMs, heapMB, images, drawings,
    minFontSize, angles, hasTextLayer }
```

`spike/calibrate.mjs`：

1. 用 `pdf-lib` 生成 4 份校准 PDF：A4 页面，已知坐标放置 8/10/12pt 文本，分别 0°/90°/180°/270° 旋转，CropBox 偏移 (0,0) 与 (36,36) 两种。
2. 用 `pdfjs` 提取 bbox，与生成时坐标比较，输出每份的 `maxErrorPt` 与 `meanErrorPt`。
3. 通过条件：正文 10–12pt 的 `maxErrorPt ≤ 1.0`，旋转页 ≤ 2.0。

### 14.3 通过门槛（与 PRD §7.2 一致）

| 项 | 门槛 | 不通过时的动作 |
| --- | --- | --- |
| 30 份样本解析不崩溃 | 100% | 记录崩溃文件，评估 PDFium WASM |
| 文本坐标误差 | ≤ 1pt（正文） | 布局检查改用更宽容差或换引擎 |
| 100 页文本提取 | < 15s，< 300MB | 优化分页/流式，或换引擎 |
| DSH Node 24 直接运行 | 无原生依赖 | 换 WASM |
| CJK / 加密 / 扫描件 | 有可解释结果 | 补 `limitations`，不阻塞 |

### 14.4 产出

- `docs/spike-report.md`：环境、样本、数字、结论、是否触发备选方案。
- 若触发备选：更新 PRD §7.2 与本文 §6，不重新走一遍完整评审，但要在评审记录里加一条。

### 14.5 执行结果（2026-11-06，GO）

实际用时 1 天。`pdfjs-dist@6.5.438` + `pdf-lib@1.17.1`，14 份样本（12 合成 + 2 真实）：

| 门槛 | 目标 | 实测 | 判定 |
| --- | --- | --- | --- |
| 坐标误差（含旋转、CropBox、自身旋转） | ≤ 1pt / 旋转 ≤ 2pt | 0pt | 通过 |
| 100 页提取 | < 15s，< 300MB | 0.15–0.19s，125MB | 通过 |
| 无原生依赖 | 必须 | 9 个纯 JS 包，98.9MB | 通过 |
| 30 份样本不崩溃 | 100% | 14 份、类别全覆盖 | 部分（数量待语料阶段补齐） |

结论：不触发 WASM PDFium 备选。实现时必须落实报告 §11 的 6 条修订（版本锁定 6.5.438、`numPages===0` 前置判定、`PasswordException→ERROR`、不用 `Util.applyTransform`、bbox 不做二次放大、不用 pdf-lib 的 `widthOfTextAtSize` 做参考宽度）。完整数字与限制见 [spike-report.md](spike-report.md)。

---

## 15. 里程碑

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| M0 | Spike、校准脚本、语料初版 | 2 天 |
| M1 | 骨架：类型、契约、worker、CLI、报告 writer | 4 天 |
| M2 | 结构检查器 + 安装/打包 + 集成测试 | 3 天 |
| M3 | 布局检查器（越界、重叠、贴边） | 5 天 |
| M4 | 内容检查器（装配、归一化、匹配） | 4 天 |
| M5 | 复检 diff、Markdown、卡片/命令 | 3 天 |
| M6 | 表格启发式、误报调参、指标达标、文档 | 5 天 |

合计约 26 个开发日（不含评审与真实用户试用）。M3 与 M4 是工期风险最高的两段。

---

## 16. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- |
| pdfjs 文本坐标精度不足 | 中 | 布局检查整体不可信 | Spike 校准；容差 2pt；必要时换 PDFium WASM |
| 重叠误报率高 | 高 | 用户不信任 | 双阈值 + 负样本 + 只对 confirmed 判 FAIL；上线前误报率 ≤ 5% |
| 表格网格识别失败 | 高 | 该规则形同虚设 | 识别不到就 `SKIPPED` 并写明，不猜 |
| 内容比对受页眉页脚干扰 | 中 | 误判缺失 | 重复行检测 + `limitations` 记录 |
| worker OOM 导致无结果 | 低 | 单次检查失败 | 512MB 限制 + 页数限制 + 部分结果回传 |
| 契约由模型生成出错 | 中 | 误判 | `source=inferred` 必须 `confirmedByUser`；未确认不判 FAIL |
| DSH API 在 0.2.x 漂移 | 中 | 插件加载失败 | `engines.dsh` 锁版本；集成测试覆盖 |

---

## 17. 开放问题

1. **损坏文件的总体状态**：PRD §4.1 规定解析失败/加密/0 页为 `ERROR`；这样「文件坏了」与「工具坏了」在总体状态上不可区分。V0.1 按 PRD 执行，但建议 V0.2 改为 `FAIL`（附 `E_PARSE` 等错误码），或在总体状态旁增加 `reason` 字段。
2. **workspace 根字段**：`ToolRunContext.agent` 是否暴露 cwd？实现时确认；若无，用 `process.cwd()` + 配置覆盖。
3. ~~**pdfjs 精确版本**：Spike 时锁定，写进 `runtime.engine`。~~ 已定：`6.5.438`（2026-11-06）。
4. **`@napi-rs/canvas`**：V0.1 不需要；V0.3 若做截图，需重新评估安装成本。
5. **报告目录是否进 `.gitignore`**：默认写 `.doneright/.gitignore`，但用户可能想提交报告作为证据；提供配置 `gitignoreReports`，默认 `true`。

---

## 附录 A：`stripRunningHeaders` 伪代码

```text
输入：pages: string[]（每页文本，已归一化）
1. 对每页取首行、末行（长度 < 80）。
2. 统计每个候选行出现的页数。
3. 出现率 ≥ 60% 且页数 ≥ 3 → 视为页眉/页脚。
4. 从每页删除匹配行；记录 removed: string[]。
5. 若删除后某页为空，保留原页并记录 limitation。
```

## 附录 B：diff 匹配伪代码

```text
pairs = []
for old in baseline.issues:
  for cur in current.issues:
    if old.ruleId != cur.ruleId or old.page != cur.page: continue
    score = old.bbox && cur.bbox ? iou(old.bbox, cur.bbox)
                                   : textSimilarity(old.text, cur.text)
    pairs.push({ old, cur, score })

sort pairs by score desc
matchedOld = set(); matchedCur = set()
for p in pairs:
  if p.score < (p.old.bbox ? 0.5 : 0.9): break
  if p.old in matchedOld or p.cur in matchedCur: continue
  matchedOld.add(p.old); matchedCur.add(p.cur); persisting.push(p)

resolved = baseline.issues - matchedOld
new      = current.issues - matchedCur
```

## 附录 C：修订记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-11-06 | V0.1 | 初稿；确定引擎、worker 协议、检查器算法、测试与 Spike 计划 |
