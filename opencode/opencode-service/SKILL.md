---
name: opencode-service
description: 排查、启停、换端口 OpenCode 后台服务（systemd 用户单元）。适用于服务连不上、端口被占、`active (exited)` 是否正常、需要重启或停服务、改端口、查服务进程与 NoNewPrivs 时。关键词：opencode service、systemd、opencode.service、49374、service.json、NoNewPrivs、重启服务、会话断开、端口占用。
---

# OpenCode 后台服务（systemd）

## 先看这条：重启会掐断当前会话

**绝不能在这个 app 打开时执行 `systemctl --user restart opencode.service`**：ExecStop 会跑 `opencode service stop`，当场掐断正在用的服务，会话直接断开（已实测踩过）。

要换服务，顺序固定为：退出 app → 操作服务 → 再开 app。

## 现状

- `~/.config/systemd/user/opencode.service` 已 enable：登录时执行 `opencode service start`，由 systemd（NoNewPrivs=0）拉起托管服务。
- 服务端口 49374；运行状态在 `~/.local/state/opencode/service.json`，配置在 `~/.config/opencode/service.json`（改端口用 `opencode service set port <port>`）。
- `opencode service start` 遇到健康服务会直接复用并退出 0，所以单元显示 `active (exited)` 是正常的。

## 排查三连

```bash
opencode service status
ss -ltnp | grep 49374
grep NoNewPrivs /proc/<server-pid>/status
```

第三项为 `0` 说明该服务派生的 shell 能直接 `sudo -A`；为 `1` 时提权要走 `sudo-run`，见 `opencode-askpass`。
