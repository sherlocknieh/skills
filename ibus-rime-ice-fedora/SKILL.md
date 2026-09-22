---
name: ibus-rime-ice-fedora
description: 在 Fedora（GNOME/Wayland）上安装、配置 ibus-rime + 雾凇拼音（rime-ice）。
---

## 安装 ibus-rime

`librime-lua` 必须装（雾松用了 Lua 过滤器），Fedora 不会自动带。

```bash
# ibus（GNOME）
sudo dnf install -y ibus-rime librime-lua
```

## 安装雾凇拼音

把仓库直接放进用户目录（可保留 git 方便更新；官方 `.gitignore` 会忽略个人配置与 `build/`）：

```bash
git clone --depth 1 https://github.com/iDvel/rime-ice.git ~/.config/ibus/rime
# 目录已存在时：克隆到 /tmp 再 `cp -a /tmp/rime-ice/. <用户目录>/`
```

## 启用 Rime 输入法

```bash
# ibus：设置 → 键盘 → 输入源 → 添加 → 中文(Rime)
gsettings set org.gnome.desktop.input-sources sources "[('xkb','us'),('ibus','rime')]"
ibus restart
```

## 配置 Rime 输入法


`default.custom.yaml`（rime 配置）：
```yaml
# RIME 基本设置
patch:
  schema_list:
    - schema: rime_ice        # 方案列表只留雾松拼音
  menu/page_size: 10          # 候选词个数
  ascii_composer/switch_key/Shift_R: commit_code  # 启用右 Shift 键切换中英文模式
```

`ibus_rime.custom.yaml`（ibus-rime 外观配置）：
```yaml
# IBUS-RIME 外观设置
patch:
  style/horizontal: true         # 候选窗横排
  style/inline_preedit: true     # 拼音跟着光标显示在输入框内
  style/cursor_type: insert      # 光标跟随实际编辑位置
  style/preedit_style: composition  # 候选窗不显示拼音行
```

`rime_ice.custom.yaml`（雾凇拼音配置）：
```yaml
# 雾松拼音设置
patch:
  schema/name: 中·雾松拼音     # 为了让指示栏显示"中"字
  switches/@1/reset: 1       # 中文模式下也使用英文标点
  speller/algebra/+:         # 添加模糊音规则
    - derive/^([zcs])([^h])/$1h$2/    # z c s → zh ch sh
    - derive/en$/eng/                 # en → eng
    - derive/eng$/en/                 # eng → en
    - derive/in$/ing/                 # in → ing
    - derive/ing$/in/                 # ing → in
```

## 配置生效

ibus-rime 没有独立的部署命令，靠重启引擎触发重新部署：
```bash
rm -rf ~/.config/ibus/rime/build && ibus restart
```
