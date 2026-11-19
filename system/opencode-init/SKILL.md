---
name: opencode-init
description: "OpenCode 初始化：修改用户设置、执行一些技能"
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

# 2. 执行 OpenCode 初始技能(可选)

让用户选择还要执行哪些 OpenCode 相关技能（如 `opencode-askpass`、`opencode-backup`、`opencode-service`）
