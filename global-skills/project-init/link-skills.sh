#!/usr/bin/env bash
# project-init: 按场景把本仓库的技能符号链接到项目的 .agents/skills/（global 场景装到 ~/.agents/skills/）
set -euo pipefail

if ((BASH_VERSINFO[0] < 4)); then
  echo "需要 bash 4 及以上版本" >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd -P)
SOURCE_ROOT=$(dirname -- "$(dirname -- "$SCRIPT_DIR")")
DEST_ROOT=""
DRY_RUN=0
LIST_ONLY=0
SCENARIOS=()
EXPLICIT=()

die() {
  printf '错误: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法: link-skills.sh --scenario <场景> [--scenario <场景> ...] [选项] [技能 ...]

场景:
  global    全局（常驻所有会话，默认装入 ~/.agents/skills）
  dev       软件开发
  system    系统管理（含 OpenCode 自身配置）
  learn     学习
  create    内容创作
  other     其他（find-skills）

选项:
  --source <目录>  技能仓库根目录（默认：本脚本的上两级）
  --dest <目录>    链接目标目录（默认：$PWD/.agents/skills；
                   只选 global 场景时为 ~/.agents/skills）
  --dry-run        只打印动作，不创建链接
  --list           列出场景及对应技能
  -h, --help       显示帮助

技能:
  可传技能目录名（如 dev-init）或仓库内相对路径（如 dev-skills/dev-init），
  用于场景之外的单点补充。同名技能只会链接一次。

示例:
  link-skills.sh --scenario global
  link-skills.sh --scenario dev
  link-skills.sh --scenario system --scenario learn
  link-skills.sh --scenario other diagnosing-bugs
EOF
}

scenario_label() {
  case "$1" in
    global) printf '全局' ;;
    dev) printf '软件开发' ;;
    system) printf '系统管理' ;;
    learn) printf '学习' ;;
    create) printf '内容创作' ;;
    other) printf '其他' ;;
    *) return 1 ;;
  esac
}

normalize_scenario() {
  case "$1" in
    global|全局) printf 'global' ;;
    dev|软件开发) printf 'dev' ;;
    system|系统管理) printf 'system' ;;
    learn|学习) printf 'learn' ;;
    create|内容创作) printf 'create' ;;
    other|其他) printf 'other' ;;
    *) return 1 ;;
  esac
}

scenario_skills() {
  case "$1" in
    global) cat <<'EOF'
global-skills/project-init
global-skills/find-skills
EOF
      ;;
    dev) cat <<'EOF'
dev-skills/code-conventions
dev-skills/dev-init
dev-skills/userscript-dev
dev-skills/retro
dev-skills/diagnosing-bugs
dev-skills/wizard
dev-skills/handoff
learning-skills/research
learning-skills/wait-what
learning-skills/writing-for-agents
learning-skills/grilling
EOF
      ;;
    system) cat <<'EOF'
system-skills/bluetooth-dual-boot-problem
system-skills/fedora-ibus-rime-ice
system-skills/fedora-install-easyconnect
system-skills/fedora-remote-desktop
system-skills/gnome-clipboard-indicator-paste-fix
system-skills/gnome-desktop-context-menus
system-skills/inputactions-gnome-mouse-gesture-overlay
system-skills/keyboard-lock-clean
system-skills/linux-bluetooth-force-a2dp
system-skills/linux-wifi-hotspot-concurrent
system-skills/opencode-askpass
system-skills/opencode-backup
system-skills/opencode-init
system-skills/opencode-rules
system-skills/opencode-service
system-skills/system-init
system-skills/xdg-user-dirs-english
dev-skills/diagnosing-bugs
learning-skills/research
dev-skills/wizard
learning-skills/wait-what
EOF
      ;;
    learn) cat <<'EOF'
learning-skills/teach
learning-skills/research
learning-skills/wait-what
learning-skills/grilling
EOF
      ;;
    create) cat <<'EOF'
user-skills/deepseek-video-maker
user-skills/pdf-toc-bookmarks
learning-skills/research
learning-skills/writing-for-agents
dev-skills/wizard
EOF
      ;;
    other) printf 'global-skills/find-skills\n' ;;
    *) return 1 ;;
  esac
}

while (($#)); do
  case "$1" in
    --source)
      [[ $# -ge 2 ]] || die "--source 缺少参数"
      SOURCE_ROOT=$2
      shift 2
      ;;
    --dest)
      [[ $# -ge 2 ]] || die "--dest 缺少参数"
      DEST_ROOT=$2
      shift 2
      ;;
    --scenario)
      [[ $# -ge 2 ]] || die "--scenario 缺少参数"
      IFS=',' read -r -a _parts <<< "$2"
      for _part in "${_parts[@]}"; do
        [[ -z $_part ]] && continue
        _normalized=$(normalize_scenario "$_part") \
          || die "未知场景: $_part（可选 global/dev/system/learn/create/other）"
        SCENARIOS+=("$_normalized")
      done
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      die "未知选项: $1"
      ;;
    *)
      EXPLICIT+=("$1")
      shift
      ;;
  esac
done

[[ -d $SOURCE_ROOT ]] || die "源目录不存在: $SOURCE_ROOT"
SOURCE_ROOT=$(cd -- "$SOURCE_ROOT" && pwd -P)
[[ -f $SOURCE_ROOT/global-skills/project-init/link-skills.sh ]] \
  || die "源目录不像 skills 仓库: $SOURCE_ROOT（缺少 global-skills/project-init/）"

if ((LIST_ONLY)); then
  printf '可用场景：\n'
  for _scenario in global dev system learn create other; do
    printf '\n  %-8s %s\n' "$_scenario" "$(scenario_label "$_scenario")"
    while IFS= read -r _rel; do
      printf '    - %s\n' "$_rel"
    done < <(scenario_skills "$_scenario")
  done
  printf '\n技能详情可用 %s --scenario <场景> --dry-run 查看。\n' "$(basename -- "$0")"
  exit 0
fi

(( ${#SCENARIOS[@]} + ${#EXPLICIT[@]} > 0 )) || die "至少指定一个 --scenario 或技能名"

for _scenario in "${SCENARIOS[@]}"; do
  scenario_label "$_scenario" >/dev/null || die "未知场景: $_scenario（可选 global/dev/system/learn/create/other）"
done

resolve_skill() {
  local arg=${1%/} match
  local matches=()

  if [[ -f $SOURCE_ROOT/$arg/SKILL.md ]]; then
    printf '%s\n' "$arg"
    return 0
  fi

  for match in "$SOURCE_ROOT"/*/"$arg"/SKILL.md "$SOURCE_ROOT"/*/*/"$arg"/SKILL.md; do
    [[ -f $match ]] || continue
    match=${match%/SKILL.md}
    matches+=("${match#"$SOURCE_ROOT"/}")
  done

  case ${#matches[@]} in
    1) printf '%s\n' "${matches[0]}" ;;
    0) die "找不到技能: $arg" ;;
    *) die "技能名不唯一: $arg（${matches[*]}）" ;;
  esac
}

declare -A SELECTED_BY_NAME=()
ORDER=()

add_skill() {
  local rel=${1%/} name
  [[ -n $rel ]] || die "技能路径为空"
  name=$(basename -- "$rel")
  [[ -n $name && $name != "/" ]] || die "无效技能路径: $rel"
  if [[ -n ${SELECTED_BY_NAME[$name]+x} && ${SELECTED_BY_NAME[$name]} != "$rel" ]]; then
    die "同名技能指向不同目录: $name（${SELECTED_BY_NAME[$name]} / $rel）"
  fi
  if [[ -z ${SELECTED_BY_NAME[$name]+x} ]]; then
    ORDER+=("$name")
  fi
  SELECTED_BY_NAME[$name]=$rel
}

for _scenario in "${SCENARIOS[@]}"; do
  while IFS= read -r _rel; do
    add_skill "$_rel"
  done < <(scenario_skills "$_scenario")
done

for _arg in "${EXPLICIT[@]}"; do
  _rel=$(resolve_skill "$_arg") || exit 1
  add_skill "$_rel"
done

if [[ -z $DEST_ROOT ]]; then
  _only_global=0
  if (( ${#SCENARIOS[@]} > 0 )); then
    _only_global=1
    for _scenario in "${SCENARIOS[@]}"; do
      [[ $_scenario == global ]] || _only_global=0
    done
  fi
  if ((_only_global)); then
    DEST_ROOT=$HOME/.agents/skills
  else
    DEST_ROOT=$PWD/.agents/skills
  fi
fi
if ((DRY_RUN)); then
  printf '目标目录: %s（dry-run，不写入）\n\n' "$DEST_ROOT"
else
  mkdir -p -- "$DEST_ROOT"
fi

created=0
replaced=0
skipped=0
failed=0

for name in "${ORDER[@]}"; do
  rel=${SELECTED_BY_NAME[$name]}
  src="$SOURCE_ROOT/$rel"
  link="$DEST_ROOT/$name"

  if [[ ! -f $src/SKILL.md ]]; then
    printf '  跳过 %s：源目录缺少 SKILL.md（%s）\n' "$name" "$rel" >&2
    ((failed += 1))
    continue
  fi

  if [[ -L $link ]]; then
    current=$(readlink -f -- "$link" || true)
    if [[ $current == "$src" ]]; then
      printf '  = %s（已链接）\n' "$name"
      ((skipped += 1))
      continue
    fi
    if ((DRY_RUN)); then
      printf '  ~ %s -> %s（将替换）\n' "$name" "$src"
    else
      rm -f -- "$link"
      ln -s -- "$src" "$link"
      printf '  ~ %s -> %s（已替换）\n' "$name" "$src"
    fi
    ((replaced += 1))
  elif [[ -e $link ]]; then
    printf '  失败 %s：目标已存在且不是符号链接（%s），未覆盖\n' "$name" "$link" >&2
    ((failed += 1))
    continue
  else
    if ((DRY_RUN)); then
      printf '  + %s -> %s\n' "$name" "$src"
    else
      ln -s -- "$src" "$link"
      printf '  + %s -> %s\n' "$name" "$src"
    fi
    ((created += 1))
  fi

  if ((!DRY_RUN)) && [[ ! -f $link/SKILL.md ]]; then
    printf '  失败 %s：链接后读不到 SKILL.md\n' "$name" >&2
    ((failed += 1))
  fi
done

printf '\n结果：新建 %d，替换 %d，跳过 %d，失败 %d\n' "$created" "$replaced" "$skipped" "$failed"
printf '目标：%s\n' "$DEST_ROOT"

((failed == 0))
