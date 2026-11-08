# DoneRight 操作手册（源码分发版）

这份文档面向**从源码拿到 DoneRight、要在自己的 DeepSeek Harness 里安装和使用的人**。按顺序做完第 1–4 节即可跑通；第 5 节起是日常用法和排错。

> 版本：`0.1.0-rc.1` · 适用 DSH `>= 0.2.2-rc.1` · Node `>= 22.13.0`

---

## 1. 它是什么

DoneRight 是 DSH 的质量验收插件：Agent 生成 PDF 之后，用它检查交付物是否满足用户的明确要求，输出带证据的 `PASS / FAIL / REVIEW / ERROR` 结论。

- **不生成**内容，**不修改**原文件，**不调用**视觉模型（V0.1）。
- 检查由程序执行：PDF 结构、版面几何、文本内容比对。
- 没有契约时只跑内置格式规则，并强制给出 `REVIEW`——**不会**静默 `PASS`。

## 2. 环境要求

| 项 | 要求 | 检查命令 |
| --- | --- | --- |
| DSH | `>= 0.2.2-rc.1` | 启动 DSH，确认插件管理可用 |
| Node | `>= 22.13.0`（建议 24.x） | `node -v` |
| 网络 | 安装依赖时可访问 npm registry | `npm ping` |
| 平台 | Windows 10/11 一级支持；Linux 已在 CI 覆盖 | — |

不需要 Python、不需要系统装 PDF 工具、不需要浏览器。

## 3. 获取源码与构建

```bash
git clone <仓库地址> DoneRight
cd DoneRight
npm ci            # 或 npm install
npm run build     # 输出到 dist/
npm test          # 29 项测试，应全绿
```

如果网络对 npm 默认缓存目录不友好（例如沙箱环境报 `EPERM`），把缓存指到工作区：

```bash
npm ci --cache ./.npm-cache
```

构建产物是 `dist/`，插件运行只需要 `dist/`、`locale/`、`cordis.patch.yml`、`icon.svg`。

## 4. 安装到 DSH

### 4.1 打包

```bash
npm pack
# 生成 doneright-0.1.0-rc.1.tgz
```

**不要**直接把源码目录作为 `install_bundle` 的目标做 link 安装。pnpm 在替换 link 依赖时可能对源码目录做出意料之外的操作（我们实际遇到过），用 tarball 最稳。

### 4.2 安装

在 DSH 会话里让 Agent 调用 `plugin_manager`：

```
install_bundle, target = file:<tgz 的绝对路径>
```

例如：

```
file:D:\src\deepseek-harness\DoneRight\doneright-0.1.0-rc.1.tgz
```

安装成功后，profile 的 `node_modules/doneright` 是实体目录，`cordis.patch.yml` 里会多出：

```yaml
- insert:
    - id: doneright
      name: doneright
      config: {}
```

### 4.3 启用 / 重载

插件默认随安装启用。改过代码重新打包安装后，需要重载：

```
set_plugin, target = include:doneright, enabled = false
set_plugin, target = include:doneright, enabled = true
```

`target` 必须是 `include:doneright`（entryId），只写 `doneright` 会报 `unknown-plugin`。宿主会缓存 ESM 模块，仅重装不重载可能仍跑旧代码。

### 4.4 可选配置

在 `cordis.patch.yml` 的 `config` 里可覆盖：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `workspaceRoot` | 空 | 强制工作区根目录；空则用 Session 的 `workingDirectory` |
| `outDir` | 空 | 报告目录；空则 `<工作区>/.doneright` |
| `maxBytes` | `104857600` | 单文件上限（100 MB） |
| `maxPages` | `300` | 页数上限 |
| `timeoutMs` | `180000` | 单次验收总超时 |
| `restrictToWorkspace` | `true` | 拒绝读取工作区外的文件（含 junction/symlink 逃逸） |

## 5. 最小验证

```bash
node dist/cli.js check spike/fixtures/fontsizes.pdf
```

预期：`REVIEW`，0 个 issue（因为没有契约，只有内置检查），退出码 `2`。

在 DSH 会话里则直接对 Agent 说：

> 用 doneright_check 检查 spike/fixtures/fontsizes.pdf

或输入命令：

```
/doneright spike/fixtures/fontsizes.pdf
```

看到 `DoneRight: REVIEW — ... (1 pages, 0 issue(s))` 和报告路径，就说明安装成功。

## 6. 三种使用入口

### 6.1 工具 `doneright_check`

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `path` | 是 | 要检查的 PDF，相对工作区 |
| `contract` | 否 | 契约 JSON 路径；不传则只跑内置规则并 `REVIEW` |
| `sources` | 否 | 原始素材路径，仅记录为溯源信息，不参与匹配 |
| `outDir` | 否 | 报告目录，默认 `<工作区>/.doneright` |
| `previousReport` | 否 | 上一份 `report.json`，用于显式对比 |
| `strictHeadings` | 否 | 标题必须位于行首才算命中 |
| `disabledChecks` | 否 | 本次跳过的 check id 列表，报告中记为 `SKIPPED` |

### 6.2 命令 `/doneright`

```
/doneright <path> [--contract <file>] [--strict] [--json]
```

命令不产生模型轮次，适合用户手动触发。示例：

```
/doneright output/manual.pdf --contract examples/contract.example.json
```

### 6.3 CLI

```bash
node dist/cli.js check output/manual.pdf \
  --contract examples/contract.example.json \
  --out .doneright \
  --previous .doneright/reports/<id>/report.json \
  --strict
```

| 选项 | 说明 |
| --- | --- |
| `--contract <file>` | 契约文件 |
| `--out <dir>` | 报告目录（CLI 默认是当前目录下的 `.doneright`） |
| `--previous <file>` | 与指定报告对比 |
| `--strict` | 标题必须行首 |
| `--json` | 输出完整 JSON 而不是 Markdown |
| `--no-write` | 只检查，不写报告 |

退出码：`0 PASS` / `1 FAIL` / `2 REVIEW` / `3 ERROR` / `4 用法或运行错误`。

## 7. 写验收契约

契约是一个 JSON 文件，把「用户的要求」翻译成可检查的条件。最小示例见 `examples/contract.example.json`：

```json
{
  "schemaVersion": "1.0",
  "contractId": "manual-v1",
  "requirements": [
    { "id": "pages", "kind": "page-count", "min": 1, "max": 5, "severity": "major" },
    { "id": "sec1", "kind": "section", "value": "Section One", "severity": "blocking" },
    { "id": "greet", "kind": "phrase", "value": "hello world", "severity": "major" }
  ]
}
```

支持的要求类型：

| kind | 字段 | 检查方式 |
| --- | --- | --- |
| `file-type` | `value`（如 `application/pdf`） | 文件 magic 与扩展名 |
| `page-count` | `min` / `max` | 页数区间 |
| `section` | `value` | 归一化后整段包含（标题层级不敏感） |
| `heading` | `value` | 同 `section`，`strictHeadings` 时要求行首 |
| `phrase` | `value` | ≤40 字符精确子串；>40 字符 0.92 通过 / 0.80 复核 |
| `prohibited` | `value` | 出现即 `FAIL` |
| `order` | `values`（≥2） | 按顺序出现 |

严重程度：`blocking` / `major` 会阻断交付（`FAIL`）；`minor` / `info` 只记为问题，不阻断。

**关于 `inferred`**：如果契约来自 Agent 推断而不是用户明说，要求必须带 `"source": "inferred"` 且 `"confirmedByUser": false`；未确认时总体至少 `REVIEW`。不要用推断出来的要求去判 `FAIL`。

## 8. 读报告

报告默认写到：

```
<工作区>/.doneright/reports/<reportId>/report.json
<工作区>/.doneright/reports/<reportId>/report.md
<工作区>/.doneright/history.jsonl        # 只追加
```

关键字段：

| 字段 | 含义 |
| --- | --- |
| `status` | 总体结论 |
| `checks[]` | 实际执行、跳过、无法执行的检查项 |
| `issues[]` | 每条问题的 `ruleId`、`severity`、`page`、`bbox`、`evidence`、`suggestedFix` |
| `coverage` | `executed / skipped / unverified / failed` 计数 |
| `limitations[]` | 本次没覆盖或无法验证的内容 |
| `contract.hash` / `contract.confirmed` | 契约哈希与是否经用户确认 |
| `diff` | 与上一份报告的对比 |

状态含义：

- `PASS`：所有必检项通过，且契约已确认；
- `FAIL`：存在有证据的阻断问题；
- `REVIEW`：有可疑问题，或关键要求无法验证（扫描件、无契约、推断未确认）；
- `ERROR`：检查流程本身失败（文件损坏、加密、超页数上限等）。

`bbox` 是归一化坐标 `[0,1]`，左上角原点，已处理 `CropBox` 与 `/Rotate`，可直接乘以页面像素宽高定位。

### 复检

对同一文件、同一契约再跑一次，`diff` 会给出：

- `resolved`：上一份有、这一份没了；
- `persisting`：两轮都在；
- `new`：这一轮新出现；
- `regressed`：历史上修好过、这一轮又出现；
- `noImprovementStreak`：连续多轮没有改善（≥3 时建议人工介入）。

## 9. 常见问题

**Q：相对路径报 `ENOENT ...\profiles\desktop\...`？**
旧版本用进程 cwd 解析路径。`0.1.0-rc.1` 已改为通过宿主 `workingDirectory` 服务取 Session 工作区；确认装的是 rc.1 并已重载。也可以用 `workspaceRoot` 显式指定。

**Q：提示 `Refusing to read ... outside the workspace`？**
默认只允许读工作区内文件。把 PDF 放进工作区，或在 config 里设 `workspaceRoot`，或显式关闭 `restrictToWorkspace`（不建议）。

**Q：安装后工具不存在 / 还是旧行为？**
宿主缓存 ESM。禁用再启用 `include:doneright`，或重启 DSH。

**Q：`npm ci` 报 `EPERM` / 缓存目录不可写？**
加 `--cache ./.npm-cache`；沙箱环境还要 `--ignore-scripts`。

**Q：为什么没传契约总是 `REVIEW`？**
这是设计：没有契约就没有验收标准，DoneRight 不会假装通过。传入契约后再看 `PASS/FAIL`。

**Q：扫描版 PDF 为什么是 `REVIEW` 而不是 `FAIL`？**
没有文本层时内容检查为 `UNVERIFIED`；文件本身可能完全正常，不能判失败。

**Q：报告里的 `SKIPPED` 是什么意思？**
V0.1 中表格溢出、字体嵌入、视觉审查不执行，分别因为无法可靠重建表格网格、引擎未暴露字体描述符、未配置视觉模型。`SKIPPED` 不拉低总体，但会列在报告里。

**Q：页面外的文字查不出来？**
pdfjs 会在页面边界裁剪文本，完全画在页面外的内容可能不可见。部分越界（仍在页内可见）可检出；报告 `limitations` 会写明。

**Q：会不会改我的文件？**
不会。只读，报告写到 `.doneright/`。

## 10. 升级与卸载

升级：改完代码 → `npm run build && npm test && npm pack` → 用新 tgz 再 `install_bundle` → 重载。

卸载：`plugin_manager remove_bundle, target = doneright`。报告与 `history.jsonl` 留在工作区，按需删除 `.doneright/`。

## 11. 开发

```bash
npm run typecheck
npm run build
npm test                 # node:test，29 项
node scripts/check-docs.mjs .   # 文档链接、JSON 块、表格列数
```

目录：

```
src/adapter/     DSH 工具与命令适配（唯一接触宿主 ctx 的地方）
src/core/        类型、契约、归一化、匹配、聚合、diff、报告渲染
src/engine/      pdfjs 适配与错误映射
src/detectors/   structural / layout / content / visual
src/verification/编排
src/worker/      worker_threads 隔离
src/io/          报告落盘与 history
tests/           单元 + 端到端（用 pdf-lib 现造 PDF）
```

新增检查器的约定：实现 `(doc) => CheckResult`，在 `src/verification/run.ts` 注册，补 `ruleId`、`required` 判定和测试；不要在 core/detectors 里 import `@deepseek-ai/*`，也不要让 core 依赖 `node:fs`。

## 12. 许可

MIT。运行时依赖 `pdfjs-dist`（Apache-2.0）。`@napi-rs/canvas` 是 pdfjs 的**可选**依赖（仅渲染用，V0.1 不使用），安装体积约 38 MB，可用 `npm install --omit=optional` 跳过，不影响检查功能。
