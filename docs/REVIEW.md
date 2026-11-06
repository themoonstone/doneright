# DoneRight PRD V0.1 评审记录

| 项目 | 内容 |
| --- | --- |
| 评审对象 | 《DoneRight 产品需求梳理 PRD V0.1》 |
| 评审日期 | 2026-11-06 |
| 评审结论 | **方向成立，可以进入技术设计；但有 6 项必须在编码前修正** |
| 输出 | [PRD V0.2](./PRD.md) |

---

## 总体判断

这份 PRD 的产品判断是对的，而且比大多数「AI 质量检查」方案更清醒：

- 它把产品定义成**验收员**而不是**执行者**，边界清楚。
- 它明确拒绝「让模型评价自己」，把可复现证据作为核心价值。
- 它区分了可验证要求与主观要求，并提出「没有证据就报无法验证」。
- 它把自动触发、自动修复、多格式都推到后续版本，V0.1 范围克制。
- 它列出的 Harness 接口（`ctx.tools.register`、`ctx.commands.register`、`tools/result`、`agent/turn-stopping`）**经核实全部存在**，不是臆想。

问题集中在**工程可实现性与可验收性**，不在产品方向。以下 15 条按严重度排列。

---

## 阻塞项（必须在技术设计前解决）

### R1 · 检测引擎选型与「可安装性」自相矛盾 🔴

**原文**：技术架构建议「PDF Inspector：Python / PyMuPDF 原型」，理由是「利用成熟的 Python 库更务实」。

**问题有三层**：

1. **许可**。PyMuPDF 采用 AGPL-3.0 或商业双许可。一个计划开源分发的 DSH 插件，如果把 PyMuPDF 放进依赖树，要么整体被迫 AGPL，要么需要购买商业许可。让用户自己 `pip install pymupdf` 只是把合规问题转嫁给用户，并没有消除。
2. **安装**。V0.1 的第一条成功标准是「有清晰安装文档，能在指定 Harness 版本正常加载」。额外要求 Python 3.11 + pip 安装编译型包，会让大部分目标用户卡在第一步。
3. **环境**。实测 DSH 自带的 Python 运行时只有 numpy / pandas / Pillow / python-docx 等，**没有任何 PDF 库**；系统 Python 同样没有。插件不应去修改 DSH 的运行时目录。

**建议**：V0.1 用 TypeScript 核心（`pdfjs-dist` Apache-2.0 + `pdf-lib` MIT），把 PDF 能力收敛到 `PdfEngine` 接口；Python（pypdfium2，Apache-2.0/PDFium BSD-3）作为后续可选 Provider。渲染截图依赖 `@napi-rs/canvas`（MIT，预编译），降为 P1 可选依赖。

**已落地**：PRD §7.2（方案对比与 spike 门槛）、§7.4（依赖与打包）。

---

### R2 · 状态模型会把「没检查」静默变成「通过」 🔴

**原文**：总体状态只有 `PASS / FAIL / REVIEW / ERROR` 四种，且 `PASS` 定义为「已启用且实际执行的检查项全部通过」。

**问题**：定义本身没错，但缺少**单项状态**。当内容检查因为「没有原文」而根本没跑时，它既不是 PASS 也不是 FAIL；如果实现者图省事把它从 `checks` 里删掉，总体就会变成 PASS。这正是 DoneRight 最该避免的失败模式。

**建议**：单项增加 `UNVERIFIED`（缺条件）与 `SKIPPED`（用户关闭/超限），并规定聚合顺序：`FAIL > ERROR > REVIEW > PASS`；任何 required check 为 `UNVERIFIED` 时总体不得为 PASS。`PASS` 必须附覆盖率，覆盖率为 0 不得 PASS。

**已落地**：PRD §5.1。

---

### R3 · 「单个检查器失败不影响 Harness」不能只靠 try/catch 🔴

**原文**：非功能需求写「单个检查器失败不应导致整个 Harness 崩溃」。

**问题**：PDF 解析器面对畸形文件时常见的是**原生层崩溃或 OOM**，不是可捕获的 JS 异常。一个 2GB 的恶意 PDF、一个无限循环的字体解析，都会直接带走主进程。try/catch 挡不住。

**建议**：检查在 `worker_threads` 中执行，设置 `resourceLimits.maxOldGenerationSizeMb`、单检查器超时、总超时；worker 异常退出时把该 check 标为 `ERROR`，其余结果保留。不要把解析器放进 Host 主线程。

**已落地**：PRD §7.3；§8 稳定性一行。

---

### R4 · 报告缺少复检所需的三个要素 🔴

**原文**：报告字段有 `artifact / status / checks / issues / evidence / suggested_fix / limitations`。

**问题**：这套字段能「描述一次检查」，但不能「比较两次检查」：

- 没有**统一坐标约定**（PDF 原点在左下、单位 pt、受 CropBox 与 /Rotate 影响），不同实现给出的 bbox 无法互认；
- 没有**稳定的 issue 身份**，复检时无法判断「第 3 页那个重叠」是不是上次那个；
- 没有**契约哈希**，无法确认两次用的是同一套验收条件。

**建议**：坐标统一为「可见区域左上角原点的归一化坐标」；issue 增加 `id` 并在复检时按 `ruleId + page + IoU ≥ 0.5` 匹配；报告记录 `contractHash` 与引擎/规则版本。

**已落地**：PRD §5.2–§5.4、§6。

---

### R5 · 验收指标没有计算口径，无法验收 🔴

**原文**：「已知错误召回率 ≥ 90%」「误报率 ≤ 5%」。

**问题**：没有定义什么算「命中」、什么算「误报」、在哪个集合上算。PDF 缺陷是区域级的，一个「第 3 页文字重叠」的标注可能被检测成两个框，也可能框偏了 2cm；不定义 IoU 与匹配规则，90% 这个数字可以被任意解释。更危险的是用模型自评来算指标——那等于用被检验的东西检验自己。

**建议**：定义检查单元（规则 + 页 + bbox）、IoU ≥ 0.3 匹配、按严重度分别算召回、误报按「正常页面中出现未匹配检测的页面比例」算；30% 语料 held-out，脚本计算并提交 `benchmark.json`。

**已落地**：PRD §10.2–§10.4。

---

### R6 · 内容比对缺少归一化，必然产生大量误报 🔴

**原文**：「文本匹配及辅助语义检查」。

**问题**：PDF 提取出来的文本与原文几乎不会逐字相同：行末连字符断词、多余空格、换行、全半角、连字（ﬁ）、页眉页脚混入、CJK 标点差异。直接字符串比较会把「格式差异」报成「内容缺失」，这是最伤信任的一类误报。

**建议**：固定归一化管线（NFKC → 引号/破折号统一 → 空白折叠 → 连字符还原 → 可选页眉页脚剔除），并对长句设 0.92 相似度阈值、0.80–0.92 归入 REVIEW。V0.1 不做语义判断。

**已落地**：PRD §4.3。

---

## 重要项（影响 V0.1 质量）

### R7 · 扫描版 PDF 的语义没有定义清楚 🟡

原文只说「需要区分正常的扫描版 PDF 和真正异常的文件，不能因为页面没有文本层就直接判定损坏」，方向对，但没给判定结果。

**建议**：扫描件 = 结构有效 + 内容检查 `UNVERIFIED` + 总体 `REVIEW`，附「需 OCR 或人工核对」。绝不 FAIL，也绝不 PASS。

**已落地**：PRD §4.1 末尾、§4.3。

---

### R8 · V0.2 自动触发的「产物识别」仍然是猜 🟡

原文已意识到「哪个文件属于最终成果、什么时候写完」很难，但把 V0.2 描述为「从任务上下文提取验收规则，检测 Agent 产物」，没有给出可靠绑定机制。

**建议**：不要从对话里猜文件。以契约文件中的 `artifact.path` + `sha256` 作为唯一可信绑定；没有契约就不自动触发，只提示手动验收。这样 V0.2 的自动触发是「按已确认的契约执行」，而不是「猜用户想要什么」。

**已落地**：PRD §7.6 末尾。

---

### R9 · 表格溢出、图文遮挡不适合在 V0.1 判 FAIL 🟡

这两类问题在 PDF 里没有可靠的语义结构：表格可能只是画了线，单元格是文本框拼出来的；图片可能与文字有意叠放（水印、封面）。程序只能看到几何关系，误报率会很高。

**建议**：V0.1 对这两类只输出 `REVIEW`，并在规则目录里标注「启发式」。等视觉模型或结构识别成熟后再升级。

**已落地**：PRD §2.5 规则表、§4.2。

---

### R10 · V0.1 的交互面缺失 🟡

原文描述了用户流程，但没有定义 Agent 如何调用、结果如何呈现。DSH 插件的实际触点只有工具、命令、以及可选的客户端 UI。

**建议**：V0.1 提供 `doneright_check` 工具（Agent 调用）+ `/doneright` 命令（用户直连，不经模型轮次）+ JSON/Markdown 报告文件；聊天里用通用工具卡片展示摘要与文件链接。不做自定义页面，避免把工期耗在前端。

**已落地**：PRD §3.3–§3.5、§1.5。

---

### R11 · 资源限制缺少执行层的落点 🟡

「支持文件大小、页数、执行时间的限制」写在非功能需求里，但没有说超限时返回什么。是 `ERROR`、`SKIPPED` 还是静默截断？三者对用户意味着完全不同的结论。

**建议**：超限 → 该 check `SKIPPED` + `limitations` 写明原因 + 总体 `REVIEW`；不得静默截断后仍报 PASS。

**已落地**：PRD §7.3、§5.1。

---

### R12 · 「辅助语义检查」口径不清 🟡

检查器 C 写了「文本匹配及辅助语义检查」，但第八章又写「不自动调用大模型判断所有内容」。这句话可以读成「不是所有内容都用大模型」，留出了部分使用模型的空间；但 PRD 没有说明「辅助语义检查」到底是规则、词向量还是大模型。若用模型，就违反确定性原则；若不用，这句话没有实现路径。

**建议**：V0.1 明确删除语义检查，只做归一化精确/模糊匹配；语义能力归入 V0.3 的可选视觉/语言模型审查，且结果只能是 `REVIEW`。

**已落地**：PRD §0 变更表第 4 行、§4.3、§4.4。

---

## 建议项（可在技术设计中处理）

### R13 · 许可与命名需要尽早定 🟢

项目许可证（MIT / Apache-2.0）、包名（`doneright`）、工具名（`doneright_check`）、命令名（`/doneright`）会影响文档、发布与用户习惯。建议技术设计阶段一次性定稿，避免中途改名。

**已落地**：PRD §13 待确认决策。

---

### R14 · 可复现性还缺「同输入同结论」的验证方式 🟢

原文写了「报告记录检查器版本、规则、文件哈希」，这是必要条件，但不是充分条件。还需要 CI 对同一语料跑两次并 diff 报告（排除时间戳），确保没有隐藏的随机性（字体枚举顺序、Map 遍历顺序、并发）。

**已落地**：PRD §8 可复现性一行、§10.5。

---

### R15 · 隐私提示缺失 🟢

报告会包含用户正文摘录（issue 的 `text` 字段）。如果用户把报告发到群里或提交到仓库，等于泄露内容。原文只写了「默认本地检查」，没有提示这一点。

**建议**：文档与报告页脚提示「报告含正文摘录，分享前请确认」；提供 `--redact` 选项（P2）。

**已落地**：PRD §9。

---

## 核实过的事实

以下不是判断，是查证结果，供技术设计直接引用。

**Harness 插件 API（全部存在，签名如下）**

```ts
// Host Service: tools
ctx.tools.register(definition: ToolDefinition, options?: ToolRegistrationOptions): () => void

interface ToolDefinition extends ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: ToolOutputDefinition;              // { schema, render(args, value): ContentBlock[] }
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>;
  timeoutMs?: number;
  isConcurrencySafe?: boolean;
  presentCall?(args, view: ToolCallView): void;
  presentResult?(args, result: ToolResult): void;
}

// Host Service: commands
ctx.commands.register(definition: CommandDefinition): () => void
// handler(invocation) => { kind: 'success', text? } | { kind: 'error', text }
// 命令执行不产生模型轮次

// Event: tools/result（mode: emit，只读观察）
(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) => undefined

// Event: agent/turn-stopping（mode: serial，可 await）
(payload: { agent; turn; signal }) => Promise<void> | void
// 监听器可通过 agent.steer(...) 把消息放回 inbox，机器会重读
```

**环境事实**

- DSH 自带 Python 运行时：numpy 2.3.5、pandas 3.0.1、Pillow 12.3.0、python-docx 1.2.0、python-pptx 1.0.2、openpyxl 3.1.5、lxml 6.1.3、XlsxWriter 3.2.9；**无任何 PDF 库**。
- 系统 Python 3.11.9：无 fitz / pymupdf / pdfplumber / pypdfium2 / pypdf / Pillow。
- Node v24.18.1；插件通过 `plugin_manager install_bundle` 以 pnpm 安装，支持普通 npm 依赖。
- 插件清单：`package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml`（`insert` 列表）；Host 入口导出 `apply(ctx, config)`。

**结论**：PRD 引用的四个 Harness 接口全部可用，V0.2 的自动触发在机制上成立；真正的难点是产物绑定（R8），不是 API。

---

## 保留未改的部分

以下内容我建议原样保留，评审中未发现需要修改的问题：

- 产品定位与「验收员而非执行者」的边界。
- 四类问题的归纳，尤其是「自我检查不可靠」这一条。
- 验收契约作为核心概念，以及「用户可查看、修改、关闭规则」。
- `PASS / FAIL / REVIEW / ERROR` 四态语义（只是在单项层补充了两态）。
- 六个功能模块的划分与 P0/P1/P2 优先级。
- 「V0.1 手动触发」的判断，以及自动触发的四个难点。
- 第八章「明确不做什么」——这一节建议直接进仓库。
- 版本路线 V0.1 → V0.2 → V0.3 → V1.0。
- 三个产品决策：只做 PDF、不强制自动、不依赖视觉模型。

---

## 下一步

1. 决策状态（2026-11-06）：**引擎已定为 TS + pdfjs-dist**（以 §7.2 Spike 门槛为前置条件），**最低 DSH 版本已定为 `0.2.2-rc.1`**。其余四项按 PRD §13.2 的默认值执行，除非评审时另行提出。
2. 技术设计已出：[TECH_DESIGN.md](./TECH_DESIGN.md)，待实施评审。重点：`PdfEngine` 接口、worker 协议、检查器算法、报告 schema、语料与 Spike 计划。
3. 先做 spike，再写业务代码——如果 pdfjs 的坐标精度不达标，整个布局检查器都要重设计。
