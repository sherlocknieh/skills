#!/usr/bin/env bash
# skills-init: 按场景把本仓库的技能链接或复制到 .agents/skills/
# （global 场景把整个 global-skills 目录链到 ~/.agents/skills/global-skills）
set -euo pipefail

if ((BASH_VERSINFO[0] < 4)); then
  echo "需要 bash 4 及以上版本" >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd -P)
SOURCE_ROOT=$(dirname -- "$(dirname -- "$SCRIPT_DIR")")
DEST_ROOT=""
MODE=link
DRY_RUN=0
LIST_ONLY=0
SCENARIOS=()
EXPLICIT=()
GLOBAL_SELECTED=0

die() {
  printf '错误: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法: link-skills.sh --scenario <场景> [--scenario <场景> ...] [选项] [技能 ...]

场景:
  global    全局（常驻所有会话；整目录链接到 ~/.agents/skills/global-skills）
  dev       软件开发
  system    系统管理（含 OpenCode 自身配置）
  learn     学习
  create    内容创作
  other     其他（不装默认技能，需附具体技能名）

选项:
  --source <目录>  技能仓库根目录（默认：本脚本的上两级）
  --dest <目录>    目标目录（默认：$PWD/.agents/skills；
                   只选 global 场景时为 ~/.agents/skills）
  --copy           复制技能内容而不是建符号链接；目标已存在时跳过，不覆盖
  --dry-run        只打印动作，不写文件
  --list           列出场景及对应技能
  -h, --help       显示帮助

技能:
  可传技能目录名（如 dev-init）或仓库内相对路径（如 dev-skills/dev-init），
  用于场景之外的单点补充。同名技能只会链接一次。

说明:
  global 场景只产出一条 global-skills 目录链接，仓库换路径后重跑本命令
  （或 ln -sfn <新仓库>/global-skills ~/.agents/skills/global-skills）即可恢复。
  其他场景仍按技能逐个链接。

示例:
  link-skills.sh --scenario global
  link-skills.sh --scenario dev
  link-skills.sh --scenario system --scenario learn
  link-skills.sh --scenario system --copy
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
global-skills/agents-init
global-skills/project-init
global-skills/skills-init
EOF
      ;;
    dev) cat <<'EOF'
dev-skills/code-conventions
dev-skills/dev-init
dev-skills/frontend-init
dev-skills/userscript-dev
dev-skills/retro
dev-skills/diagnosing-bugs
dev-skills/wizard
dev-skills/handoff
learning-skills/research
learning-skills/wait-what
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
system-skills/opencode-init
system-skills/opencode-rules
system-skills/opencode-service
system-skills/rime-privacy-memory
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
dev-skills/wizard
EOF
      ;;
    other) : ;;
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
    --copy)
      MODE=copy
      shift
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
[[ -f $SOURCE_ROOT/global-skills/skills-init/link-skills.sh ]] \
  || die "源目录不像 skills 仓库: $SOURCE_ROOT（缺少 global-skills/project-init/）"

if ((LIST_ONLY)); then
  printf '可用场景：\n'
  for _scenario in global dev system learn create other; do
    printf '\n  %-8s %s\n' "$_scenario" "$(scenario_label "$_scenario")"
    if [[ $_scenario == global ]]; then
      printf '    整目录链接 -> ~/.agents/skills/global-skills\n'
    fi
    _skills=$(scenario_skills "$_scenario")
    if [[ -z $_skills ]]; then
      printf '    （不装默认技能，需附具体技能名）\n'
    else
      while IFS= read -r _rel; do
        printf '    - %s\n' "$_rel"
      done <<< "$_skills"
    fi
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
  if [[ $_scenario == global ]]; then
    GLOBAL_SELECTED=1
    continue
  fi
  while IFS= read -r _rel; do
    add_skill "$_rel"
  done < <(scenario_skills "$_scenario")
done

for _arg in "${EXPLICIT[@]}"; do
  _rel=$(resolve_skill "$_arg") || exit 1
  add_skill "$_rel"
done

(( ${#ORDER[@]} + GLOBAL_SELECTED > 0 )) \
  || die "未选中任何技能：other 场景不装默认技能，请附具体技能名（如 --scenario other diagnosing-bugs）"

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
migrated=0
failed=0

GLOBAL_SRC="$SOURCE_ROOT/global-skills"
GLOBAL_LINK="$DEST_ROOT/global-skills"

if ((GLOBAL_SELECTED)); then
  if [[ ! -f $GLOBAL_SRC/skills-init/SKILL.md ]]; then
    printf '  失败 global-skills：源目录缺少 skills-init/SKILL.md（%s）\n' "$GLOBAL_SRC" >&2
    ((failed += 1))
  elif [[ $MODE == copy ]]; then
    if [[ -e $GLOBAL_LINK || -L $GLOBAL_LINK ]]; then
      printf '  跳过 global-skills：目标已存在（%s），未覆盖\n' "$GLOBAL_LINK" >&2
      ((skipped += 1))
    elif ((DRY_RUN)); then
      printf '  + global-skills（将复制 <- global-skills）\n'
      ((created += 1))
    else
      cp -a -- "$GLOBAL_SRC" "$GLOBAL_LINK"
      printf '  + global-skills（已复制 <- global-skills）\n'
      ((created += 1))
    fi
  elif [[ -L $GLOBAL_LINK ]]; then
    current=$(readlink -f -- "$GLOBAL_LINK" || true)
    if [[ $current == "$GLOBAL_SRC" ]]; then
      printf '  = global-skills（已链接）\n'
      ((skipped += 1))
    elif ((DRY_RUN)); then
      printf '  ~ global-skills -> %s（将替换）\n' "$GLOBAL_SRC"
      ((replaced += 1))
    else
      ln -sfn -- "$GLOBAL_SRC" "$GLOBAL_LINK"
      printf '  ~ global-skills -> %s（已替换）\n' "$GLOBAL_SRC"
      ((replaced += 1))
    fi
  elif [[ -e $GLOBAL_LINK ]]; then
    printf '  失败 global-skills：目标已存在且不是符号链接（%s），未覆盖\n' "$GLOBAL_LINK" >&2
    ((failed += 1))
  else
    if ((DRY_RUN)); then
      printf '  + global-skills -> %s\n' "$GLOBAL_SRC"
    else
      ln -s -- "$GLOBAL_SRC" "$GLOBAL_LINK"
      printf '  + global-skills -> %s\n' "$GLOBAL_SRC"
    fi
    ((created += 1))
  fi

  # 旧版逐技能安装会在目标目录留下指向同一仓库的散链接，清掉以免重复暴露
  if [[ -d $DEST_ROOT ]]; then
    while IFS= read -r _rel; do
      _name=$(basename -- "$_rel")
      _legacy="$DEST_ROOT/$_name"
      [[ -L $_legacy ]] || continue
      current=$(readlink -f -- "$_legacy" || true)
      [[ $current == "$GLOBAL_SRC/$_name" ]] || continue
      if ((DRY_RUN)); then
        printf '  - %s（旧版逐技能链接，将移除）\n' "$_name"
      else
        rm -f -- "$_legacy"
        printf '  - %s（已移除旧版逐技能链接）\n' "$_name"
      fi
      ((migrated += 1))
    done < <(scenario_skills global)
  fi

  if ((!DRY_RUN)) && [[ ! -f $GLOBAL_LINK/skills-init/SKILL.md ]]; then
    printf '  失败 global-skills：链接后读不到 skills-init/SKILL.md\n' >&2
    ((failed += 1))
  fi
fi

for name in ${ORDER[@]+"${ORDER[@]}"}; do
  rel=${SELECTED_BY_NAME[$name]}
  src="$SOURCE_ROOT/$rel"
  link="$DEST_ROOT/$name"

  if [[ ! -f $src/SKILL.md ]]; then
    printf '  跳过 %s：源目录缺少 SKILL.md（%s）\n' "$name" "$rel" >&2
    ((failed += 1))
    continue
  fi

  if [[ $MODE == copy ]]; then
    case $link in
      "$src"|"$src"/*) die "复制目标不能位于源技能目录内: $link" ;;
    esac
    if [[ -e $link || -L $link ]]; then
      printf '  跳过 %s：目标已存在（%s），未覆盖\n' "$name" "$link" >&2
      ((skipped += 1))
      continue
    fi
    if ((DRY_RUN)); then
      printf '  + %s（将复制 <- %s）\n' "$name" "$rel"
    else
      mkdir -p -- "$link"
      cp -a -- "$src/." "$link/"
      printf '  + %s（已复制 <- %s）\n' "$name" "$rel"
    fi
    ((created += 1))
    if ((!DRY_RUN)) && [[ ! -f $link/SKILL.md ]]; then
      printf '  失败 %s：复制后读不到 SKILL.md\n' "$name" >&2
      ((failed += 1))
    fi
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

printf '\n结果：新建 %d，替换 %d，跳过 %d，清理旧链接 %d，失败 %d\n' \
  "$created" "$replaced" "$skipped" "$migrated" "$failed"
printf '方式：%s\n' "$([[ $MODE == copy ]] && echo 复制 || echo 符号链接)"
printf '目标：%s\n' "$DEST_ROOT"

((failed == 0))
