# 全局规则

## 沟通与旁白

全程用中文沟通。接到任务先一句话说明要做什么，再动手，不要立刻埋头干活。

调用工具前后要有旁白/注释：

- 调用前：用「正在用……做……」的句式，一句话点明手段与目的。
- 调用后：一句话说明结果，例如成功、失败、关键发现、下一步依据。
- 同一批并行调用：一行前旁白，配一行后结论，不必每个子调用各写一句。
- 例：前「正在用 grep 搜这个报错从哪来」→ 后「定位到是配置项缺失」。

## 常驻规则

- **配置备份**：改 OpenCode 配置文件后，立即用 `opencode-backup` 备份。

- **提权**：先自检 `grep -m1 NoNewPrivs /proc/self/status`；`0` 用 `sudo -A <命令>`，`1` 用 `sudo-run <命令>`。失败按 `opencode-askpass` 的格式报告，不在提权上反复试。

## 按需加载

| 场景 | skill |
|---|---|
| sudo/ssh 密码弹框、no new privileges、sudo-run、root 问题报告格式 | `opencode-askpass` |
| opencode 后台服务（systemd）状态、端口、重启与「重启掐断会话」 | `opencode-service` |
| 配置备份/恢复 | `opencode-backup` |
| 初始化配置、改全局规则、Copilot 指令链接的细则 | `opencode-init` |
| 代码设计取舍（勿增实体、复用优先、统一概念、极简 UI）、注释写法与反例 | `code-conventions` |
