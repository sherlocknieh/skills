---
name: opencode-backup
description: OpenCode 配置备份/恢复: 备份和恢复 OpenCode的配置文件, 全局规则, 用户设置
---

# 备份配置文件

把 OpenCode 最新配置备份到当前技能目录下, 只保留最近两个版本备份: old/new
每当 OpenCode 配置文件发生变化时, 把 new 备份覆盖 old 备份, 并把最新配置文件备份到 new 备份中

# 恢复配置文件

检查当前技能目录下备份的配置文件和实际配置文件的差异, 并提示用户选择哪些恢复到实际配置文件