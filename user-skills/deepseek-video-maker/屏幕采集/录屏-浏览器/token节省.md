# token 节省

- 本轮（2026-11-15）约 **37 万 token**：文本 ~30.8 万 + 51 张截图 ~6.1 万
- 最贵的浪费：① Chrome 反复重启排查 ② 每步都截图 ③ 把 `browse execute` 的完整 console 日志打出来
- 省法：`browse execute ... 2>&1 | grep -v "page:error\\|page:info" | head -10`；只在「动作是否生效」和「成片构图」时看一次图；先读本手册再动手
