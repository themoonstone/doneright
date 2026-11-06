# Changelog

本项目遵循语义化版本；`0.1.x` 期间 minor 与 patch 都可能调整报告字段，正式稳定后再按 SemVer 约束。

## 0.1.0-rc.1 — 2026-11-06

首个可安装的 PDF 验收版本。

### Added

- **验收契约**：`file-type`、`page-count`、`section`、`heading`、`phrase`、`prohibited`、`order` 七类要求，支持 `blocking / major / minor / info` 严重程度；`inferred` 要求必须由用户确认。
- **检查器 A（结构）**：`pdf.structure.file-type`、`page-box`、`blank-page`、`text-layer`、`font-embedding`（V0.1 为 SKIPPED）。
- **检查器 B（布局）**：`page-overflow`、`text-overlap`（逐 run 配对 + 绝对二维重叠阈值）、`edge-proximity`；`table-overflow` 与 `image-overlap` 在无法可靠判定时 SKIPPED。
- **检查器 C（内容）**：章节/标题、关键短语、禁止出现内容、顺序、页数；归一化（NFKC、引号/破折号、连字符断词、CJK 空格）+ 0.92/0.80 双阈值。
- **六态结果**：`PASS / FAIL / REVIEW / UNVERIFIED / SKIPPED / ERROR`，按 `FAIL > ERROR > REVIEW` 聚合；无契约时强制 `contract.confirmed = UNVERIFIED`。
- **报告**：JSON + Markdown，归一化坐标 `[0,1]`、稳定 `issue id`、契约哈希、引擎与规则版本、覆盖率；写入 `<workspace>/.doneright/reports/<reportId>/`。
- **复检**：按 `ruleId + page + bbox IoU ≥ 0.5` 做 issue 匹配，输出 `resolved / persisting / new / regressed` 与连续无改善计数；`history.jsonl` 只追加。
- **worker 隔离**：检查在 `worker_threads` 中执行，`maxOldGenerationSizeMb = 512`，超时 terminate 并保留部分结果。
- **Harness 集成**：工具 `doneright_check` 与命令 `/doneright`；相对路径按 Session 的 `workingDirectory` 解析，默认限制在工作区内。
- **CLI**：`doneright check <pdf>`，退出码 `0 PASS / 1 FAIL / 2 REVIEW / 3 ERROR / 4 用法错误`。
- 29 项测试、GitHub Actions（Windows + Linux）、`npm pack` 产物校验。

### Fixed

- 行带级重叠检测在真实 slides 上产生 30 条假阳性 → 改为逐 `TextRun` 配对；再加绝对重叠阈值，避免把标点/kerning 判成碰撞。
- `pdfjs` 会 detach 传入的 `Uint8Array`，导致报告里的文件字节数变成 0 → 打开前先记录长度。
- 从 tarball 安装后 `cmaps` 找不到 → 用 `createRequire(...).resolve('pdfjs-dist/package.json')` 定位真实安装目录。
- 工具返回值含 `undefined` 时被宿主以「非无损 JSON」拒绝 → 递归裁剪 `undefined`。
- 工作区外的 junction 可绕过字符串前缀检查 → 用 `realpath` 规范化后再比较。
- `/doneright` 命令读错字段（`input.text`）→ 改用 `CommandInvocation.rawInput`。

### Known limitations

- 表格溢出、字体嵌入、视觉审查在 V0.1 为 `SKIPPED`。
- `pdfjs` 在页面边界裁剪文本，完全画到页面外的文字可能无法被布局检查看到。
- 扫描件的内容检查为 `UNVERIFIED`，总体至少 `REVIEW`。
- 尚未完成 60 份语料的召回率 / 误报率实测（发布 `0.1.0` 正式版前补齐）。
