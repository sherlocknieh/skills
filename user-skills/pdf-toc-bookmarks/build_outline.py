#!/usr/bin/env python3
"""Build a PDF outline (bookmarks) from a TOC entry list.

Usage:
    python3 build_outline.py SRC.pdf OUT.pdf entries.json --offset N [opts]

entries.json: JSON array of [level, title, printed_page]
    level: 0 = chapter/heading, 1 = section, 2 = subsection
    printed_page: the page number as printed in the book's TOC (1-based)

Mapping: pdf_page(1-based) = printed_page + offset

Options:
    --offset N           required; pdf_page = printed_page + offset
    --fix-first-section  if a section's page equals its chapter's page, add 1
                         (skips the unnumbered chapter divider page)
    --clear-existing     remove the PDF's existing outline before writing.
                         DEFAULT IS TO KEEP IT: never clear bookmarks unless the
                         user has explicitly agreed. Without this flag, any old
                         outline stays and the new items are appended.
    --toc-page N         add a top-level "目录" bookmark to this PDF page
                         (0 disables; default 0)
"""
import argparse
import json
import sys

import pikepdf
from pikepdf import Pdf, OutlineItem


def matches_chapter(title: str) -> bool:
    import re
    return bool(re.match(r"^第\d+章", title))


def clamp(p: int, n: int) -> int:
    return max(0, min(p, n - 1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("entries", help="JSON file with [[level,title,page], ...]")
    ap.add_argument("--offset", type=int, required=True,
                    help="pdf_page = printed_page + offset (1-based)")
    ap.add_argument("--fix-first-section", action="store_true",
                    help="add 1 to a section whose page == its chapter's page")
    ap.add_argument("--clear-existing", action="store_true",
                    help="remove existing outline first (only with user consent)")
    ap.add_argument("--toc-page", type=int, default=0,
                    help="PDF page (1-based) to add a '目录' bookmark; 0 = none")
    args = ap.parse_args()

    with open(args.entries, encoding="utf-8") as fh:
        entries = json.load(fh)

    pdf = Pdf.open(args.src)
    npages = len(pdf.pages)

    root = []
    stack = {}
    cur_chapter_page = None
    for row in entries:
        level, title, toc = row[0], row[1], row[2]
        page = toc + args.offset
        if level == 0:
            cur_chapter_page = toc if matches_chapter(title) else None
        elif args.fix_first_section and cur_chapter_page is not None and toc == cur_chapter_page:
            page += 1
        item = OutlineItem(title, clamp(page - 1, npages))
        if level == 0 or (level - 1) not in stack:
            root.append(item)
        else:
            stack[level - 1].children.append(item)
        stack[level] = item
        for k in [k for k in stack if k > level]:
            del stack[k]

    with pdf.open_outline() as outline:
        if args.clear_existing:
            del outline.root[:]
        if args.toc_page:
            outline.root.append(OutlineItem("目录", clamp(args.toc_page - 1, npages)))
        for it in root:
            outline.root.append(it)

    pdf.save(args.out)
    print(f"saved: {args.out}  (top-level items: {len(root)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
