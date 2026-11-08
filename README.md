# DoneRight

**AI Deliverable Quality Gate** — 在 AI 的产出被认定为「完成」之前，先验证它是否真的满足要求。

DoneRight 是 DeepSeek Harness 的插件，不负责生成文件，只负责**验收**：把用户的交付要求转成可检查的条件，执行独立的程序化检查，给出带证据的结论，并支持修复后按同一套规则复检。

> 当前状态：**`0.1.0-rc.1`（PDF）已实现、通过 29 项测试，并已从 tarball 安装到真实 DSH profile 验证。** 检查器、契约、报告、复检 diff、worker 隔离、CLI 与 Harness 工具/命令均已就位；`spike/` 仅保留为引擎验证脚本。

---

## 为什么需要它

Agent 说「已完成」的时候，通常没有证据。常见的问题有四类：

| 问题 | 典型表现 |
| --- | --- |
| 内容不完整 | 要求 15 章，实际少了第 8 章 |
| 质量不合格 | 文字重叠、表格越界、页面损坏 |
| 自我检查不可靠 | 声称「已检查」，但说不出检查了什么 |
| 修复不闭环 | 改完一个问题，又引入一个新问题 |

DoneRight 的差异点不是「能检查 PDF」，而是：**用户要求 → 明确验收条件 → 独立检查 → 提供证据 → 复检直到满足**。这套框架未来可以扩展到代码、Word、Excel、PPT。

## 核心原则

1. **独立证据** — 每条结论都能追溯到规则、页码、坐标和原文。
2. **未知不等于通过** — 无法检查时输出 `UNVERIFIED`，汇总为 `REVIEW`。
3. **确定性优先** — V0.1 的判定全部来自可复现的程序规则，模型只做辅助。
4. **只读交付物** — 绝不修改用户文件。
5. **可复现** — 同输入 + 同规则版本 → 同结论，报告带哈希与版本。
6. **范围诚实** — 报告必须写明检查了什么、跳过了什么、哪些没验证。

## V0.1 范围

| 做 | 不做 |
| --- | --- |
| PDF 结构 / 布局 / 内容检查 | 其他文件格式（DOCX、PPTX、XLSX、代码） |
| 验收契约（可查看、修改、关闭） | 自动识别产物、自动触发（V0.2） |
| 问题定位（页码 + 归一化坐标 + 文本） | 自动修复、覆盖原文件 |
| JSON + Markdown 报告 | 自定义前端页面 |
| 按同一契约复检、diff | 云端历史、账号、计费 |
| 手动触发（工具 / 命令 / CLI） | 视觉大模型审查（P1） |

## 环境要求

| 项 | 要求 |
| --- | --- |
| DSH | `>= 0.2.2-rc.1`（当前开发与验收基线） |
| Node | `>= 22.13.0`（DSH 桌面版内置 `24.21.0`） |
| 平台 | Windows 10/11 为一级支持；Linux 走 CI |

运行时只依赖 `pdfjs-dist`（Apache-2.0，纯 JS），不需要 Python 或系统 PDF 工具链。`pdfjs-dist` 把 `@napi-rs/canvas` 声明为**可选**依赖（仅用于页面渲染，V0.1 不做渲染）；它会让安装体积增加约 38 MB，可以用 `npm install --omit=optional` 跳过，已验证不影响文本提取与全部检查器。

## 安装与使用

```bash
npm install            # 安装依赖
npm run build          # 编译到 dist/
npm test               # 29 项测试（node:test，无需浏览器）
```

安装到 DSH profile 时，**从打包产物安装，而不是从源码目录做 link 安装**：

```bash
npm pack                                  # 生成 doneright-<version>.tgz
# 在 DSH 中：plugin_manager install_bundle，target 用 file:<绝对路径>.tgz
```

从 tarball 安装可以确保 profile 里拿到的是 `files` 声明的产物（`dist/`、`locale/`、`docs/`、`examples/` 等），也能避免 pnpm 在替换源码 junction 时做出意料之外的目录操作。

插件包通过 `plugin_manager` 安装到当前 profile 后，会注册：

- 工具 `doneright_check`：Agent 在交付 PDF 前调用，参数 `path`（必填）、`contract`、`sources`、`outDir`、`previousReport`、`strictHeadings`、`disabledChecks`。
- 命令 `/doneright`：`/doneright output/manual.pdf --contract contract.json`，不产生模型轮次。

完整的安装步骤、配置项、契约写法与排错见 [`docs/INSTALL.md`](./docs/INSTALL.md)。

相对路径按当前 **Session 的工作目录**解析（通过宿主的 `workingDirectory` 服务取得，而不是插件进程的 cwd）。需要固定目录时在插件 config 里设 `workspaceRoot`；默认 `restrictToWorkspace: true`，工作区外的文件会被拒绝读取。

也可以直接使用 CLI：

```bash
node dist/cli.js check output/manual.pdf --contract examples/contract.example.json
# 退出码：0 PASS / 1 FAIL / 2 REVIEW / 3 ERROR / 4 用法或运行错误
```

报告默认写入 `<工作目录>/.doneright/reports/<reportId>/`（`report.json` + `report.md`），并在 `.doneright/history.jsonl` 追加一条记录。再次验收同一文件与契约时，会自动与上一份报告对比，输出 `resolved / persisting / new / regressed`。

### 验收契约示例

见 [`examples/contract.example.json`](./examples/contract.example.json)。支持的要求类型：`file-type`、`page-count`、`section`、`heading`、`phrase`、`prohibited`、`order`；`severity` 取 `blocking / major / minor / info`，只有 `blocking / major` 会阻断交付。

没有契约时只跑内置格式规则，并强制输出 `contract.confirmed = UNVERIFIED`、总体 `REVIEW`——**不会**静默给出 PASS。

## V0.1 的已知限制

- 表格溢出检查为 `SKIPPED`：V0.1 不从绘图指令重建表格网格，不猜测。
- 视觉审查为 `SKIPPED`：未配置视觉模型时不渲染页面、不给视觉结论。
- 字体嵌入检查为 `SKIPPED`：引擎暂未暴露字体描述符。
- pdfjs 会在页面边界裁剪文本，完全画在页面外的文字可能无法被布局检查看到；部分越界仍可检出（见检查器实现与测试）。
- 扫描件的内容检查为 `UNVERIFIED`，总体至少 `REVIEW`，不会判 `FAIL`。

## 文档

| 文档 | 内容 |
| --- | --- |
| [操作手册](./docs/INSTALL.md) | 从源码构建、安装到 DSH、契约写法、报告解读与排错 |
| [产品需求文档 V0.2](./docs/PRD.md) | 需求基线：定位、契约、检查器规格、报告规范、架构、验收标准 |
| [技术设计 V0.1](./docs/TECH_DESIGN.md) | 实现方案：类型、pdfjs 适配、worker 协议、检查器算法、测试与 Spike 计划 |
| [评审记录](./docs/REVIEW.md) | 对 V0.1 的 15 条评审意见、核实过的 API 事实、保留与修改的理由 |
| [引擎 Spike 报告](./docs/spike-report.md) | pdfjs 6.5.438 的坐标精度、性能、边界行为与对设计的 6 条修订 |

## 路线

| 版本 | 主题 |
| --- | --- |
| V0.1 | Reliable PDF Inspection |
| V0.2 | Agent Workflow Integration |
| V0.3 | Fix & Revalidate |
| V1.0 | Extensible Quality Gate |

## 开发状态

- [x] 需求梳理与评审
- [x] PRD V0.2
- [x] 引擎选型（TS + pdfjs-dist）与 DSH 基线版本（`0.2.2-rc.1`）确认
- [x] 技术设计
- [x] 引擎 Spike（坐标精度、性能、边界行为全部通过，见 [报告](./docs/spike-report.md)）
- [x] V0.1 实现（检查器、契约、报告、复检、worker、CLI、Harness 适配）
- [x] 测试（29 项：归一化、匹配、聚合、契约、diff、布局几何、端到端、工具 JSON、junction 逃逸）
- [x] 安装到 DSH profile 并在真实会话中验证（tarball 安装、`doneright_check` 相对路径、CJK 63 页、契约、复检 diff、默认报告目录、越界拦截）
- [x] 打包校验（`npm pack`，安装态 CLI 与 63 页日文 PDF 均通过）
- [x] CI（GitHub Actions，Windows + Linux）
- [ ] 60 份语料的召回率 / 误报率实测（发布 `0.1.0` 正式版前完成）

## 发布流程

```bash
npm run build
npm test
node scripts/check-docs.mjs .
npm pack                                  # doneright-<version>.tgz
npm publish --tag rc                      # 需要 npm token；首次发布用 --access public
```

发布前检查清单：

1. 版本号、`CHANGELOG.md`、`docs/PRD.md` 的版本引用一致。
2. 在空目录 `npm install ./doneright-<version>.tgz` 后跑一次 CLI（含一份 CJK PDF）。
3. 在真实 profile 用 `file:` 安装 tarball，调一次 `doneright_check`。
4. 正式版 `0.1.0` 额外要求：语料指标达到 PRD §10 的门槛（召回 ≥ 90%、误报页面率 ≤ 5%），数据写入 `docs/corpus-report.md`。

## 许可

MIT，见 [LICENSE](./LICENSE)。检测引擎仅使用 Apache-2.0 / MIT 依赖，不引入 AGPL 组件。
