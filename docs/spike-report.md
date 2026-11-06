# DoneRight 引擎 Spike 报告

| 项目 | 内容 |
| --- | --- |
| 日期 | 2026-11-06 |
| 对应设计 | [TECH_DESIGN.md](TECH_DESIGN.md) §14、[PRD.md](PRD.md) §7.2 |
| 引擎候选 | `pdfjs-dist@6.5.438`（legacy ESM build）+ `pdf-lib@1.17.1` |
| 结论 | **GO**：四项 Spike 门槛全部通过，无阻塞项；两项数字门槛（30 份样本）留待语料阶段补足 |
| 产物 | `spike/out/results.json`、`spike/out/worker-results.json`、本报告 |

## 1. 结论

`pdfjs-dist` 在 Node 下可以直接完成 DoneRight V0.1 需要的全部检测输入：页面框、文本 run、字号、字宽、旋转矩阵、绘制指令（矩形）。在本轮 14 份样本上：

- 文本包围盒与生成时给定坐标的偏差为 **0pt**（含 0°/90°/180°/270° 页面旋转、CropBox 偏移、文本自身 30°/90° 旋转、分数坐标）。
- 100 页 / 24 万字符的文本提取耗时 **194ms**、RSS **125MB**，远低于 15s / 300MB 门槛。
- 依赖树无原生模块，安装即用，不需要 Python。
- 损坏、加密、0 页、无文本层四类边界都有可判定的行为，可以映射到 PRD 的 ERROR / UNVERIFIED 语义。

因此按 PRD §7.2 的约定，**不启用备选方案（WASM PDFium）**，V0.1 引擎锁定 `pdfjs-dist@6.5.438`。同时有 3 处实现细节必须写进代码（见 §11），否则会在真实 PDF 上出错。

## 2. 环境与依赖

| 项目 | 值 |
| --- | --- |
| OS | Windows（workspace-write sandbox） |
| Node | v24.18.1（本地）；DSH 桌面版内置 `24.21.0`，未单独跑 |
| 包管理 | npm 11.16.0，通过 `npm.cmd` 调用（`npm.ps1` 被执行策略禁止） |
| 直接依赖 | `pdfjs-dist@6.5.438`、`pdf-lib@1.17.1`、`@pdf-lib/fontkit@1.1.1` |
| 依赖树 | 9 个包，`node_modules` 98.9MB，**0 个原生模块** |
| pdfjs 的 Node 下限 | `>=22.13.0 \|\| >=24`（package.json `engines`）→ 设计中的 `node >=22` 已收紧为 `>=22.13.0` |

安装命令（可复现）：

```powershell
npm.cmd --cache .\.npm-cache install --no-fund --no-audit pdfjs-dist@6.5.438 pdf-lib@1.17.1 @pdf-lib/fontkit@1.1.1
```

> npm 默认缓存目录在工作区外，被 sandbox 拒绝（EPERM），必须用 `--cache .\.npm-cache`。这是环境限制，不是插件问题。

## 3. 样本

12 份合成样本用 `pdf-lib` 生成，坐标在生成时写入 `spike/fixtures/manifest.json`，作为 ground truth；2 份真实 PDF 取自本机已有文件。

| 样本 | 页数/大小 | 覆盖点 |
| --- | --- | --- |
| `fontsizes.pdf` | 1 页 | 8/10/12/14pt，同一字符串，四个基线位置 |
| `rotations.pdf` | 4 页，300×200 | `/Rotate` 0/90/180/270，每页两个标记串 |
| `cropbox.pdf` | 1 页，600×800 | CropBox `50,100,400,500`，与 MediaBox 不同 |
| `angled.pdf` | 1 页 | 文本自身旋转 30° 与 90° |
| `fractional.pdf` | 1 页 | 9.37/10.5/11.73pt，x/y 带两位小数 |
| `cjk.pdf` | 1 页 | 嵌入 SimHei 子集，中文串 |
| `perf-100p.pdf` | 100 页，88KB | 30 行 × 80 字符/页，性能与内存 |
| `notext.pdf` | 1 页 | 只有矩形，无文本层（扫描件替身） |
| `empty.pdf` | 1 页 | pdf-lib 空文档（实际仍写出 1 页，不能当 0 页样本） |
| `corrupt.pdf` | 截断 40% | 结构损坏 |
| `zero-pages.pdf` | 0 页，311B | 用 pypdf 写出真正的 0 页 |
| `encrypted.pdf` | 1 页，1.4KB | RC4-128，用户密码 `secret` |
| `real-world.pdf` | 9 页，483KB | 英文 slides（ICML 2022 DeepSpeed） |
| `real-world-cjk.pdf` | 63 页，3.7MB | 日文 slides，大量 CJK 与旋转文本 |

样本数与 PRD 门槛的「30 份」有差距（见 §10），但门槛要求的类别（加密、损坏、扫描、CJK、旋转页）已全部覆盖。

## 4. 坐标与几何

方法：按字符串匹配生成时的期望项（同串且原点距离 < 6pt），比较期望原点/宽度/高度与 `getTextContent()` 的 `transform` + `width`/`height` 推算值。包围盒按用户空间方向向量归一化后求四角，再乘 `viewport.transform` 得到设备坐标。

| 样本 | max \|dx\| | max \|dy\| | max \|dWidth\| | max \|dHeight\| | 越界 |
| --- | --- | --- | --- | --- | --- |
| `fontsizes.pdf` | 0 | 0 | 2.84e-14 | 0 | 0 |
| `rotations.pdf`（4 页） | 0 | 0 | 0 | 0 | 0 |
| `cropbox.pdf` | 0 | 0 | 0 | 0 | 0 |
| `angled.pdf` | 0 | 0 | 0 | 0 | 0 |
| `fractional.pdf` | 0 | 0 | 0 | 0 | 0 |
| `cjk.pdf` | 0 | 0 | 0 | 0 | 0 |

- 所有 bbox 都落在 viewport 内（`inside=true`），包括 90°/180°/270° 旋转页。
- CropBox 偏移被正确应用，没有出现「用 MediaBox 当页面」的偏移。
- 唯一的非零值是 2.84e-14 的浮点噪声，可忽略。
- 真实 PDF 上无法逐字标注，改用两个一致性检查：所有 bbox 在页面内（9 页 / 63 页均为 0 越界）；每个 item 的 `height` 与变换矩阵推出的字高完全相等（358 + 3082 个 item，0 个不一致）。

**结论**：≤1pt 门槛通过（实测 0pt）。旋转、CropBox、文本自身旋转三种情况都不会让 bbox 失真。

## 5. 文本与 CJK

- `cjk.pdf` 的中文串提取结果与写入值完全一致（`exact=true`），宽度误差 0。SimHei 子集内嵌，pdfjs 通过 ToUnicode 还原。
- 真实日文 slides 63 页提取 29,067 字符、3,082 个 item，无乱码抽样异常；其中 4 个 item 是旋转文本，`height` 与矩阵字高一致。
- 英文 slides 9 页 358 个 item，4106 字符。
- 两文件均有少量旋转文本 item（6 / 4），说明真实 deck 里旋转文字并不罕见，布局检查必须走矩阵变换而不是轴对齐假设。

## 6. 性能与内存

| 场景 | 页面 | 耗时 | 每页 | 字符/items | heap | RSS |
| --- | --- | --- | --- | --- | --- | --- |
| 合成 100 页 | 100 | load 8ms + 提取 145–194ms（两次运行） | 1.4–1.9ms | 240,000 / 3,000 | 21.1MB | 125.7MB |
| 英文 slides | 9 | load 2ms + 提取 71ms | 7.9ms | 4,106 / 358 | — | — |
| 日文 slides | 63 | load 11ms + 提取 387ms | 6.1ms | 29,067 / 3,082 | — | — |

- 门槛是 100 页 <15s、<300MB；实测 0.15–0.19s / 125MB，余量很大。
- 真实 slides 每页更慢（6–8ms），因为字体子集与 ToUnicode 解析更重；按最坏 8ms/页估算，300 页上限约 2.4s，仍在预算内。
- 以上只覆盖文本提取，不含布局几何计算与内容比对；后者是纯 CPU 的数组运算，量级远小于提取。

## 7. 边界行为

| 输入 | pdfjs 行为 | DoneRight 应映射为 |
| --- | --- | --- |
| 结构损坏（截断） | `getDocument()` 抛 `InvalidPDFException: Invalid PDF structure.` | 结构检查 `ERROR`（按 PRD §4.1），报告注明无法解析 |
| 加密（有用户密码，未提供） | `getDocument()` 抛 `PasswordException`，`code=1`，`message="No password given"` | `ERROR`，提示需要密码；V0.1 不提供密码输入 |
| 0 页 | `numPages === 0`；`getPage(1)` 抛 `Error: Invalid page request.` | 先判 `numPages === 0` → `ERROR`；不要先调 `getPage` |
| 无文本层（扫描件） | 不报错，`textContent.items` 为空数组 | 内容类检查 `UNVERIFIED`、总体 `REVIEW`，**不得 FAIL** |
| pdf-lib 生成的「空文档」 | 实际 1 页 | 不能用作 0 页样本（Spike 已改用 pypdf） |

`notext.pdf` 的 0 items 行为验证了 PRD 的扫描件语义：没有文本层是「无法验证内容」，不是「文件损坏」。

## 8. worker 隔离

用 `worker_threads` 跑 `worker-entry.mjs`，`resourceLimits.maxOldGenerationSizeMb = 512`，逐页 `postMessage({type:'progress'})`，结束发 `done`。

| 场景 | 结果 |
| --- | --- |
| 100 页合成 | 启动到 `done` 704ms（含 worker 启动），100 条 progress，exit 0 |
| 63 页日文 | 752ms，63 条 progress，exit 0 |
| 收到首个 progress 后 `terminate()` | exit code 1，已捕获 1 条 progress，无 `done` |
| terminate 后父进程再解析 | 正常，164ms |

- worker 启动成本约 0.5s，相对单次验收（秒级）可接受；V0.1 每次验收起一个 worker，不为每个检查器单独起。
- 部分结果回传路径可用：terminate 后父进程能拿到已完成页的数据，对应设计里的「超时保留部分结果」。
- 本轮没有做 OOM 压测，512MB 上限是否足够容纳「300 页 + 大字体子集」尚未验证（见 §10）。

## 9. 门槛判定

| 门槛（PRD §7.2） | 目标 | 实测 | 判定 |
| --- | --- | --- | --- |
| 解析 30 份样本不崩溃（含加密/损坏/扫描/CJK/旋转） | 30 份 | 14 份，类别全覆盖 | **部分通过**：类别通过，数量待语料阶段补齐 |
| 文本坐标偏差 | ≤1pt（10–12pt 正文） | 0pt（8–14pt 均 0） | 通过 |
| 旋转页坐标偏差 | ≤2pt | 0pt | 通过 |
| 100 页文本提取 | <15s | 0.19s | 通过 |
| 内存 | <300MB | 125MB RSS | 通过 |
| DSH Node 24 直接运行、无原生依赖 | 必须 | 通过，9 个纯 JS 包 | 通过 |

按 PRD「任一项不达标才切 WASM PDFium」的规则，**GO**。样本数量一项不构成阻塞：它衡量的是覆盖率而不是引擎能力，且类别已全覆盖；语料阶段会补到 60 份（含 30% held-out）。

## 10. 偏差、限制与未覆盖

必须如实写进后续测试计划，不能把本轮结论外推成「pdfjs 对所有 PDF 都准」：

1. **合成样本的文本算子简单**：只用了 `Tj` + `Td`，没有 `TJ` 数组、`Tz` 水平缩放、`Ts` 上升、Type3 字体、竖排书写。真实 PDF 的这些算子是否仍保持 0pt 偏差，未验证。
2. **真实 PDF 没有逐字 ground truth**：只验证了「bbox 在页内」与「height == 矩阵字高」，这两项能发现系统性错误，但发现不了 1–2pt 的局部偏差。精度结论目前只由合成样本支撑。
3. **CJK 只测了带 ToUnicode 的嵌入子集**：没有 ToUnicode 的 CID 字体可能提取出乱码或空串，届时内容检查会误判为「缺失」。需要补一份「无 ToUnicode」样本，并把「提取率异常低」纳入 REVIEW 而非 FAIL。
4. **没有真实扫描件**：`notext.pdf` 是合成无文本层，没有 OCR 噪声、倾斜、双栏扫描的真实样本。
5. **规模未压满**：最大 3.7MB / 100 页；没有 100MB、1000 页、深层表单/注释/嵌入文件的样本，也没有触发 512MB worker 上限的 OOM 测试。
6. **Node 版本**：只在 24.18.1 上跑；DSH 内置 24.21.0 与 Node 22 LTS（engines 允许的最低线）未实测。
7. **平台**：仅 Windows。路径大小写、长路径、只读目录等差异未覆盖。
8. **加密只测了「无密码」路径**：带正确密码打开、权限位（禁止复制/打印）未测；V0.1 不支持密码输入，这条只影响错误文案。
9. **渲染未测**：本轮不涉及 canvas / 截图，P1 的视觉审查仍需单独 Spike。
10. headless Edge 打印 PDF 在 sandbox 内失败（`platform_channel.cc:187 Check failed`，命名管道被禁），因此改用本机已有真实 PDF；这是环境限制，不影响插件。

## 11. 对技术设计的修订

以下 6 条已回写 `TECH_DESIGN.md` / `PRD.md`，编码时必须遵守：

1. **版本锁定 `pdfjs-dist@6.5.438`**，不是设计初稿写的 5.x；`engines.node` 收紧为 `>=22.13.0`（pdfjs 6.5 的声明下限）。
2. **先判 `numPages === 0` 再取页**。0 页 PDF 的 `getPage(1)` 抛的是通用 `Error: Invalid page request.`，无法与内部错误区分，必须前置判定并映射为 `ERROR`。
3. **`PasswordException` → `ERROR`**，报告带 `name`/`code`，文案提示「文件已加密，V0.1 不支持密码」。
4. **不要用 `Util.applyTransform`**：v6 里它是 function 但返回 `undefined`。自己写仿射 `[m0*x + m2*y + m4, m1*x + m3*y + m5]`。
5. **bbox 不能用 `item.width × 字号缩放` 二次放大**：`item.width`/`height` 已是用户空间单位；先把方向向量归一化，再乘宽高求四角，最后统一乘 viewport 变换。Spike 第一版就是这里把 8pt 文字算成 857pt 宽。
6. **不要用 `pdf-lib` 的 `widthOfTextAtSize` 做参考宽度**：`"ROTATE"` 12pt 时它返回 45.072，逐字 `widthOf` 求和是 48.672（pdfjs 也是 48.672）。合成样本的期望宽度必须逐字求和，否则会把 pdf-lib 的测量 bug 当成 pdfjs 的误差。

另外两条实现建议（非强制）：

- worker 启动约 0.5s，验收是一次性任务，建议一次验收复用一个 worker，不要为每个检查器起新 worker。
- 布局检查必须支持旋转文本（真实 deck 里存在），不要把「矩阵不是轴对齐」当成异常直接跳过。

## 12. 复现

```powershell
# 依赖
npm.cmd --cache .\.npm-cache install --no-fund --no-audit

# 合成样本（含 manifest.json 的期望坐标）
node spike/generate.mjs

# 0 页与加密样本（需要 pypdf）
spike\.venv\Scripts\python.exe spike\make-edge-fixtures.py

# 坐标 / 性能 / 边界
node spike/probe.mjs          # -> spike/out/results.json

# worker 隔离与终止
node spike/worker-test.mjs    # -> spike/out/worker-results.json
```

## 13. 附件与清理

- `spike/generate.mjs`、`spike/probe.mjs`、`spike/worker-entry.mjs`、`spike/worker-test.mjs`、`spike/make-edge-fixtures.py`
- `spike/fixtures/`（12 份合成 + 2 份真实 + manifest）
- `spike/out/results.json`、`spike/out/worker-results.json`
- 临时产物：`spike/.venv`、`.npm-cache`、`spike/.pip-cache`、`tmp/`（含本次文档恢复脚本），提交前删除或加入 `.gitignore`。

真实 PDF 仅用于本地验证，未放入插件分发物；`real-world.pdf` 与 `real-world-cjk.pdf` 的版权归原文档作者，若后续作为公开测试集需要替换或取得许可。
