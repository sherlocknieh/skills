---
name: opencode-init
description: OpenCode 初始化: 添加全局规则, 执行一些技能, 修改用户设置
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

创建 `~/.config/opencode/AGENTS.md`;

添加内容:

## 工具调用旁白/注释

调用工具前后要有旁白/注释：调用前一句话说目的，调用后一句话说结论。

- 调用前：用「正在用……做……」的句式，一句话点明手段与目的
- 调用后：一句话说明结果，例如成功、失败、关键发现、下一步依据。
- 同一批并行调用：一行前旁白，配一行后结论，不必每个子调用各写一句。
- 例：前「正在用 grep 搜这个报错从哪来」→ 后「定位到是配置项缺失」。


## OpenCode 配置备份/恢复

每当 OpenCode 配置文件发生变化时，使用 opencode-backup 技能自动备份配置文件。

---
# 3. 执行 OpenCode 初始技能(可选)

让用户选择还要执行 skills/opencode/ 中哪些技能