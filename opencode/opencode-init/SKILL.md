---
name: opencode-init
description: "OpenCode 初始化：添加全局规则、执行一些技能、修改用户设置"
---



# 1. 初始化 OpenCode 配置文件

## 1.1 OpenCode TUI 开启图片预览
在 `~/.config/opencode/cli.json` 中添加以下内容（`plugins` 指向本地插件目录，路径按实际用户名调整）：
```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "prompt": {
    "imagePreview": true
  },
  "plugins": ["/home/who/.config/opencode/cny-cost"]
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
文件丢了也能从这里还原；改规则时三处同步：本段、`~/.config/opencode/AGENTS.md`、Copilot 镜像。

结构固定为四层，总长控制在 40 行内；细则不写进本文件，落到对应 skill：
提权与 root 报告格式归 `opencode-askpass`，后台服务归 `opencode-service`，
代码与注释规范归 `code-conventions`，镜像细则归本文档第 3 节。

````markdown
# 全局规则

本文件只放每次会话都要遵守的硬规则。长篇操作手册在 skills 里，遇到「按需加载」表中的场景先加载对应 skill，不要凭记忆操作。

## 沟通与旁白

全程用中文沟通。接到任务先一句话说明要做什么，再动手，不要立刻埋头干活。

调用工具前后要有旁白/注释：

- 调用前：用「正在用……做……」的句式，一句话点明手段与目的。
- 调用后：一句话说明结果，例如成功、失败、关键发现、下一步依据。
- 同一批并行调用：一行前旁白，配一行后结论，不必每个子调用各写一句。
- 例：前「正在用 grep 搜这个报错从哪来」→ 后「定位到是配置项缺失」。

## 常驻规则

- **配置备份**：改 OpenCode 配置文件后，立即用 `opencode-backup` 备份。
- **Copilot 镜像**：改本文件后，立刻把正文整段同步到 `~/.copilot/instructions/opencode-agents.instructions.md`（4 行 frontmatter + 正文逐字相同），并更新 `opencode-init` 里的真源副本。细则见 `opencode-init`。
- **提权**：先自检 `grep -m1 NoNewPrivs /proc/self/status`；`0` 用 `sudo -A <命令>`，`1` 用 `sudo-run <命令>`。失败按 `opencode-askpass` 的格式报告，不在提权上反复试。
- **代码改动**：遵循仓库既有规范，取最小完整集。能改现有代码就不新增实体；新功能先找现成承载点，并说明为什么其他承载点不合适。
- **概念取舍**：先判断是同一件事的两种形态还是两件事，再决定统一还是分开；差异尽量落在数据、配置或适配器上。
- **克制**：加代码前先想能不能让代码变少；每行都要有存在理由。
- **UI**：能用图标就别用文字，能用系统功能就别自定义实现。
- **注释**：每块代码上方一句目的性描述（做什么、手段、上下游），写现状不写变更史。
- **提交**：每轮对话后改动到量就自行提交；仓库有发布脚本时走发布脚本，不先单独 `git commit`；发现会话外改动先弹框问用户如何提交。

## 按需加载

| 场景 | skill |
|---|---|
| sudo/ssh 密码弹框、no new privileges、sudo-run、root 问题报告格式 | `opencode-askpass` |
| opencode 后台服务（systemd）状态、端口、重启与「重启掐断会话」 | `opencode-service` |
| 配置备份/恢复 | `opencode-backup` |
| 初始化配置、改全局规则、同步 Copilot 镜像的细则 | `opencode-init` |
| 代码设计取舍（勿增实体、复用优先、统一概念、极简 UI）、注释写法与反例 | `code-conventions` |
````

---

# 3. 为 Copilot 复刻一份（双向对称）

Copilot（CLI / VS Code Agent Host）不读 AGENTS.md，只认 `~/.copilot/instructions/**/*.instructions.md`。写完 AGENTS.md 后由模型自己再写一份镜像，不要引入脚本、定时任务或 systemd 单元。

一对镜像文件：

| 侧 | 路径 | 内容 |
|---|---|---|
| OpenCode | `~/.config/opencode/AGENTS.md` | 真源，纯正文 |
| Copilot | `~/.copilot/instructions/opencode-agents.instructions.md` | 4 行 frontmatter + 一行镜像注释 + AGENTS.md 全文 |

镜像头部固定这样写：

```yaml
---
description: 'OpenCode 全局规则（AGENTS.md）的镜像：中文沟通、工具调用旁白、配置备份、Copilot 镜像同步、提权路径、代码与注释约定、提交要求，以及按需加载的 skill 索引。Use when: 在任意仓库中执行命令、阅读或修改代码、提权或提交。'
applyTo: '**'
---
```

对称要求：

- 正文必须逐字相同。改 AGENTS.md 就重写镜像正文；在 Copilot 侧改了正文，就先搬回 AGENTS.md，再重新生成镜像。
- frontmatter 只存在于 Copilot 侧，别搬进 AGENTS.md。
- 后缀必须是 `.instructions.md`；`global.md`、`copilot-instructions.md` 放在该目录里都不会被加载。
- 缺 `applyTo: '**'` 时是否注入各版本不一致，必须显式写。
- 若 `~/.copilot/instructions/` 里还有 `personal-conventions.instructions.md` 这类单边文件（OpenCode 侧没有对应物），对称就被打破，应把独有内容并入 AGENTS.md 后删除。

---
# 4. 执行 OpenCode 初始技能(可选)

让用户选择还要执行 skills/opencode/ 中哪些技能