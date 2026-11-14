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



---
# 2. 添加 OpenCode 全局规则

创建 `~/.config/opencode/AGENTS.md`，结构固定为四层，总长控制在 40 行内：

1. 开头一句：本文件只放硬规则，长手册在 skills 里，遇到对应场景先加载，不要凭记忆操作。
2. `## 沟通与旁白`：中文沟通 + 调用工具前后各一句旁白。
3. `## 常驻规则`：每条一句话的硬约束（配置备份、Copilot 镜像、提权、代码改动、概念取舍、克制、UI、注释、提交）。
4. `## 按需加载`：场景 → skill 的表格。

细则不要写进本文件，落到对应 skill：提权与 root 报告格式归 `opencode-askpass`，后台服务归 `opencode-service`，代码与注释规范归 `code-conventions`，镜像细则归本文档第 3 节。当前内容以 `~/.config/opencode/AGENTS.md` 为准，直接读它复制，不要凭记忆重写。

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