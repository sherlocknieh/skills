---
name: opencode-init
description: "OpenCode 初始化：添加全局规则、执行一些技能、修改用户设置"
---



# 1. 初始化 OpenCode 配置文件

## 1.1 OpenCode TUI 开启图片预览
在 `~/.config/opencode/cli.json` 中添加以下内容：
```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "prompt": {
    "imagePreview": true
  }
}
```

## 1.2 MCP 服务器
在 `~/.config/opencode/opencode.json` 中登记 MCP：`dida365` 走远程 URL，`browse` 调用本机 `browse` 可执行文件的 MCP 模式。`browse` 需要先装好对应扩展，路径按实际位置调整：

```json
{
  "mcp": {
    "servers": {
      "dida365": {
        "type": "remote",
        "url": "https://mcp.dida365.com"
      },
      "browse": {
        "type": "local",
        "command": ["/home/who/.local/bin/browse", "mcp"],
        "environment": {
          "OPENCODE_BROWSER_RUNTIME": "auto-update"
        }
      }
    }
  }
}
```

`~/.config/opencode/service.json` 由后台服务首次启动时自动生成，含本机认证 token，**不进仓库、不要备份**；丢失后重启服务会重建。



---
# 2. 添加 OpenCode 全局规则

创建 `~/.config/opencode/AGENTS.md`，内容就是下面这段。这是仓库里的真源副本，
文件丢了也能从这里还原；改规则时两处同步：本段与 `~/.agents/skills/AGENTS.md`。

结构固定为四层，总长控制在 40 行内；细则不写进本文件，落到对应 skill：
提权与 root 报告格式归 `opencode-askpass`，后台服务归 `opencode-service`，
代码与注释规范归 `code-conventions`，Copilot 指令链接归本文档第 3 节。

````markdown
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
````

---

# 3. 让 Copilot 读到同一份规则（符号链接）

Copilot（CLI / VS Code Agent Host）不读 AGENTS.md，但读 `~/.copilot/copilot-instructions.md`——纯正文的通用个人指令，不需要 frontmatter。直接软链，不抄副本，两边永远一致。

```bash
mkdir -p ~/.copilot
ln -sfn ~/.agents/skills/AGENTS.md ~/.copilot/copilot-instructions.md
readlink -f ~/.copilot/copilot-instructions.md   # 必须指向 AGENTS.md
```

要点：

- 用 `copilot-instructions.md`，不要用 `~/.copilot/instructions/*.instructions.md`：前者是通用个人指令，后者是模块化指令；同一份正文放两处会重复注入。
- `*.instructions.md` 的 `name`、`description`、`applyTo` 都是可选字段（VS Code 文档明确「Required: No」），不写也能加载，所以「必须加 frontmatter」不成立，也就没有写副本的理由。
- `~/.copilot/instructions/` 里若有过去的同名副本，删除；有本侧没有的独有内容，先并入 AGENTS.md 再删。
- 校验：`diff -q ~/.agents/skills/AGENTS.md ~/.copilot/copilot-instructions.md` 无输出即通过。

---

# 4. 执行 OpenCode 初始技能(可选)

让用户选择还要执行 opencode/ 分组中哪些技能