---
name: pdf-toc-bookmarks
description: 扫描 PDF（尤其是纯图片/无文字层的扫描书）的目录页，提取章节/页码，生成 PDF 书签大纲(outline/bookmarks)。适用于用户说“给 PDF 加目录/导航/书签”“扫描文档的目录页生成大纲”“PDF 没有书签/书签是错的”“图片版 PDF 加书签”。关键词：PDF、目录、大纲、书签、outline、bookmarks、扫描书、图片 PDF、无文字层、pdftotext 为空、pikepdf、pdftoppm、页码偏移。Use when asked to add a clickable table of contents / outline to a PDF, especially scanned image-only PDFs.
---

# PDF 目录 → 书签大纲

给 PDF 生成/修复书签大纲。核心难点：扫描版 PDF 没有文字层，无法直接抽取目录，必须“看”目录页并人工/OCR 转录，再找到印刷页码与 PDF 物理页的偏移量。

## 总原则：先问，再扫

**不要一上来就渲染/OCR 整本书。** 默认动作是先用 `question` 工具向用户收集已知信息，能省则省；只有当信息不足、且**用户明确同意后**，才进行“智能扫描”（渲染大量页面图片、逐页看图转录、可能装依赖、产生临时文件）。

流程：**阶段 A 询问 → （可选）阶段 B 低成本自检 → 阶段 C 智能扫描（需同意） → 阶段 D 生成 → 阶段 E 验证**。

---

## 阶段 A：先向用户询问（默认第一步）

用 `question` 工具一次性问清下面这些，减少来回：

1. **PDF 路径**（若用户没说；先别自行去猜或遍历磁盘）。
2. **页码偏移**：是否已知印刷页码与 PDF 物理页相差几页（`offset`）？
   - 已知 → 直接采用，**完全不需要扫描**。
3. **层级深度**：只出“章 / 大标题”，还是“章 + 节”，还是“全套三级（章/节/小节）”？层级越深转录成本越高。
4. **目录页位置**：是否已知目录在第几页（例如“第13–19页”）？
5. **原始书签**：PDF 里若已有书签，是保留还是清除替换？**清除旧书签必须先征得用户明确同意**，未同意前一律保留（脚本默认即保留）。可顺带告知旧书签是否已损坏/指向错误。
6. **输出方式**：另存为新文件（默认，建议加 `_带书签` 后缀），还是就地覆盖？
7. **征得“智能扫描”同意**：如果偏移或目录位置未知，明确告知需要渲染页面图片、逐页看图（可能耗时、生成临时文件），以及可能需要 `sudo dnf install python3-pikepdf`，请用户确认是否同意。

若用户已提供条目清单/偏移/目录页等，**直接跳到阶段 D**，不要做任何扫描。

---

## 阶段 B：低成本自检（可选，用户已同意继续）

仅在需要时运行，代价很小：

```bash
pdfinfo book.pdf                 # 页数、是否加密、页面尺寸
pdftotext -f 1 -l 30 book.pdf -  # 若能出文字 → 有文字层，可直接 grep 目录
```

- `pdftotext` 输出为空/空白字符 → **纯图片扫描版**，需要阶段 C 看图。
- 有文字层 → 目录可直接 `pdftotext | grep` 抽取，比看图快得多。

---

## 阶段 C：智能扫描（**必须先获得用户同意**）

未经同意不要批量渲染。获得同意后按需执行：

### C1. 定位目录页

渲染一批页面成图片，用 `read` 工具直接**看图**找「目录」：

```bash
mkdir -p /tmp/opencode/imgs && cd /tmp/opencode
pdftoppm -f 1 -l 40 -r 60 -png book.pdf imgs/p
montage imgs/p-0{01..12}.png -tile 4x3 -geometry +4+4 -background gray m1.png
```

`read /tmp/opencode/m1.png` 查看拼图。目录通常在封面/版权页/序言之后（本类书用罗马数字 I、II… 标记，页眉写着「目 录」）。若阶段 A 用户已告知目录页，直接跳过。

找到后**高分辨率逐页渲染**目录页，逐条转录：

```bash
pdftoppm -f 13 -l 19 -r 200 -png book.pdf toc
# read /tmp/opencode/toc-013.png ... 逐页读，记录每条的标题与印刷页码
```

### C2. 确定页码偏移（关键，必须核对）

书里目录写的页码是**印刷页码**，不等于 PDF 物理页。通常是常量偏移：

```
PDF 物理页 = 印刷页码 + offset
```

用「章节分隔页（第X章 大标题页）」做锚点交叉验证：找到某章节分隔页的 PDF 页号，减掉目录里该章的页码，即为 offset。

```bash
# 假设目录说 第18章=156，候选 PDF 页 = 156+19 = 175 或 176
pdftoppm -f 174 -l 177 -r 90 -png book.pdf c18
montage c18-*.png -tile 4x1 -geometry +3+3 -background gray /tmp/opencode/mc18.png
# read → 找到「第18章」分隔页在第几张
```

再用**页脚/页眉的印刷页码**反推：读某页顶/底角的号码，如该页是 PDF 第 176 页且角标“157”，则 `offset = 176-157 = 19`。

**务必多验几处**（开头、中间、末尾最后一页最好都对得上），确认偏移恒定。样例：457 页，目录「参考文献 438」正好落在 PDF 第 457 页（末页），一次锁定 `offset = 19`。

---

## 阶段 D：整理条目并生成书签

### D1. 结构化条目

每行记录 `(层级 level, 标题 title, 目录页码 toc_page)`：

- `0` = 章 / 大标题（第X章、附录、部分习题答案、中英文名词对照、参考文献）
- `1` = 节（14.1、习题、附录A…）
- `2` = 小节（14.1.1…）

去掉目录里的装饰符号（`△`、`*`、`^`）保持标题干净。

**章节分隔页的坑（+1 修正）**：扫描书每章前常多插一张**无页码的章节分隔页**。因此若目录把「章」和它下面**第一个节**标成**同一个页码**，该节实际在下一页（脚本 `--fix-first-section` 会处理）；若章与第一节页码本就不同，则不要加。附录标题页与「附录A」通常在**同一页**，不要加 1。判据示例：`第14章=4 且 14.1=4` → 14.1 用 5。

### D2. 生成

安装 pikepdf（Fedora 有包，无需 pip；先前需用户同意）：

```bash
sudo --askpass dnf install -y python3-pikepdf
```

用本 skill 附带脚本 `build_outline.py`（同目录），读取 JSON 条目文件：

```bash
python3 build_outline.py book.pdf book_带书签.pdf entries.json \
    --offset 19 --fix-first-section
```

`entries.json` 形如：

```json
[[0,"第14章 半导体器件",4],
 [1,"14.1 半导体的导电特性",4],
 [2,"14.1.1 本征半导体",4]]
```

脚本行为：
- `PDF = 印刷页码 + offset`（1-based 转 0-based 交给 pikepdf）。
- `--fix-first-section`：节的页码若等于所属章的页码，则 `+1`（跳过章节分隔页）。
- **默认保留原有书签**（新条目追加在后面）。只有用户明确同意替换时，才加 `--clear-existing` 清除旧书签——很多扫描软件自带一套指向目录页的错误书签，替换通常更好，但**务必先问**。
- **默认另存为新文件，绝不覆盖原文件**；输出名建议加 `_带书签` 后缀。

---

## 阶段 E：验证（必做）

```bash
python3 - <<'PY'
import pikepdf
p = pikepdf.open("book_带书签.pdf")
idx = {pg.obj.objgen: i for i, pg in enumerate(p.pages)}
with p.open_outline() as ol:
    def walk(items, d=0):
        for it in items:
            print("  "*d, it.title, "-> PDF", idx[it.destination[0].objgen]+1)
            walk(it.children, d+1)
    walk(ol.root)
PY
```

再随机挑几个书签目标页渲染出来**肉眼确认内容对得上**标题：

```bash
pdftoppm -f 114 -l 114 -r 80 -png book_带书签.pdf /tmp/opencode/chk
```

---

## 注意事项

- **先问后做**：能靠用户提供的偏移/目录页位置/条目清单解决的，就不要扫描。
- **扫描需授权**：渲染/OCR 大量页面、安装依赖前，先取得用户同意。
- **清除旧书签需授权**：未经用户明确同意，绝不删除 PDF 原有的书签（脚本默认保留）。
- **不要**用 Bash 的 `cat/head/tail` 处理，读图一律用 `read` 工具；只有无 TTY 的 `sudo`/`ssh` 用 `--askpass`。
- 若装了 tesseract（`dnf install tesseract tesseract-langpack-chi_sim`）可 OCR 目录加速，但中文 OCR 易错，最终仍要人工核对数字。
- 目录页码若与印刷页码本身有 1 页偏差（排版遗留），以**实际物理页**为准，别盲信目录数字。
- 大文件用 `-r 60` 出拼图定位、`-r 90~200` 出单页细节，避免一次渲染几百页。
