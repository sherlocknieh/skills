#!/usr/bin/env bash
# agent-init: 把仓库根目录的 AGENTS.md 符号链接到 Agent 的全局指令路径，或用 --uninstall 移除（原 agents-init）
# 作为常驻全局技能提供，由 agent 自动发现并触发；装/卸哪些 Agent 由 SKILL.md 里的弹窗询问用户。
set -euo pipefail

if ((BASH_VERSINFO[0] < 4)); then
  echo "需要 bash 4 及以上版本" >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" && pwd -P)
SOURCE_ROOT=$(dirname -- "$(dirname -- "$SCRIPT_DIR")")
SOURCE="$SOURCE_ROOT/AGENTS.md"
DRY_RUN=0
LIST_ONLY=0
FORCE=0
UNINSTALL=0
AGENTS=()
TARGETS=()

die() {
  printf '错误: %s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'EOF'
用法: install-agents.sh --agent <名字> [选项]
      install-agents.sh --target <路径> [选项]

Agent 与全局指令路径:
  opencode  ~/.config/opencode/AGENTS.md
  claude    ~/.claude/CLAUDE.md
  codex     ~/.codex/AGENTS.md
  copilot   ~/.copilot/copilot-instructions.md
  gemini    ~/.gemini/GEMINI.md
  qwen      ~/.qwen/QWEN.md
  iflow     ~/.iflow/IFLOW.md
  droid     ~/.factory/AGENTS.md
  crush     ~/.config/crush/CRUSH.md
  windsurf  ~/.codeium/windsurf/memories/global_rules.md
  kiro      ~/.kiro/steering/AGENTS.md
  dsh       ~/.dsh/AGENTS.md
  pi        ~/.pi/agent/AGENTS.md
  all       以上全部

选项:
  --agent <名字>   目标 Agent，可多次指定或用逗号分隔
  --target <路径>  直接指定全局指令路径，可多次指定
  --source <目录>  技能仓库根目录（默认：本脚本的上两级）
  --uninstall      移除链接（默认是安装；只删指向本技能源的链接）
  --force          安装：未安装的 Agent 也建链接；卸载：指向别处的链接也删
  --dry-run        只打印动作，不写入
  --list           列出 Agent、安装状态、链接状态
  -h, --help       显示帮助

示例:
  install-agents.sh --agent opencode
  install-agents.sh --agent opencode --agent copilot
  install-agents.sh --agent claude --force
  install-agents.sh --agent all --uninstall
  install-agents.sh --agent all --dry-run
  install-agents.sh --target ~/.config/myagent/RULES.md
EOF
}

# 已知 Agent 的全局指令路径。新增条目时先查该 Agent 官方文档，不要猜路径。
ALL_AGENTS=(opencode claude codex copilot gemini qwen iflow droid crush windsurf kiro dsh pi)

agent_path() {
  case "$1" in
    opencode) printf '%s\n' "$HOME/.config/opencode/AGENTS.md" ;;
    claude) printf '%s\n' "$HOME/.claude/CLAUDE.md" ;;
    codex) printf '%s\n' "$HOME/.codex/AGENTS.md" ;;
    copilot) printf '%s\n' "$HOME/.copilot/copilot-instructions.md" ;;
    gemini) printf '%s\n' "$HOME/.gemini/GEMINI.md" ;;
    qwen) printf '%s\n' "$HOME/.qwen/QWEN.md" ;;
    iflow) printf '%s\n' "$HOME/.iflow/IFLOW.md" ;;
    droid) printf '%s\n' "$HOME/.factory/AGENTS.md" ;;
    crush) printf '%s\n' "$HOME/.config/crush/CRUSH.md" ;;
    windsurf) printf '%s\n' "$HOME/.codeium/windsurf/memories/global_rules.md" ;;
    kiro) printf '%s\n' "$HOME/.kiro/steering/AGENTS.md" ;;
    dsh) printf '%s\n' "${DSH_HOME:-$HOME/.dsh}/AGENTS.md" ;;
    pi) printf '%s\n' "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/AGENTS.md" ;;
    *) return 1 ;;
  esac
}

# Agent 的配置目录：存在才算装了该 Agent，避免给没装的 Agent 建空目录和链接。
agent_home() {
  case "$1" in
    opencode) printf '%s\n' "$HOME/.config/opencode" ;;
    claude) printf '%s\n' "$HOME/.claude" ;;
    codex) printf '%s\n' "$HOME/.codex" ;;
    copilot) printf '%s\n' "$HOME/.copilot" ;;
    gemini) printf '%s\n' "$HOME/.gemini" ;;
    qwen) printf '%s\n' "$HOME/.qwen" ;;
    iflow) printf '%s\n' "$HOME/.iflow" ;;
    droid) printf '%s\n' "$HOME/.factory" ;;
    crush) printf '%s\n' "$HOME/.config/crush" ;;
    windsurf) printf '%s\n' "$HOME/.codeium/windsurf" ;;
    kiro) printf '%s\n' "$HOME/.kiro" ;;
    dsh) printf '%s\n' "${DSH_HOME:-$HOME/.dsh}" ;;
    pi) printf '%s\n' "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}" ;;
    *) return 1 ;;
  esac
}

agent_installed() {
  local home
  home=$(agent_home "$1") || return 1
  [[ -d $home ]]
}

normalize_agent() {
  case "$1" in
    opencode|OpenCode) printf 'opencode' ;;
    claude|claude-code|Claude\ Code|Claude) printf 'claude' ;;
    codex|Codex) printf 'codex' ;;
    copilot|Copilot|github-copilot) printf 'copilot' ;;
    gemini|gemini-cli|Gemini) printf 'gemini' ;;
    qwen|qwen-code|Qwen) printf 'qwen' ;;
    iflow|iFlow|iflow-cli) printf 'iflow' ;;
    droid|factory|Factory) printf 'droid' ;;
    crush|Crush) printf 'crush' ;;
    windsurf|Windsurf|cascade) printf 'windsurf' ;;
    kiro|Kiro) printf 'kiro' ;;
    dsh|deepseek|DeepSeek) printf 'dsh' ;;
    pi|Pi) printf 'pi' ;;
    *) return 1 ;;
  esac
}

expand_agents() {
  local value=$1 part normalized
  IFS=',' read -r -a _parts <<< "$value"
  for part in "${_parts[@]}"; do
    [[ -z $part ]] && continue
    if [[ $part == all || $part == ALL || $part == 全部 ]]; then
      AGENTS+=("${ALL_AGENTS[@]}")
      continue
    fi
    normalized=$(normalize_agent "$part") \
      || die "未知 Agent: $part（可选 opencode/claude/codex/copilot/gemini/qwen/iflow/droid/crush/windsurf/kiro/dsh/pi/all）"
    AGENTS+=("$normalized")
  done
}

while (($#)); do
  case "$1" in
    --agent)
      [[ $# -ge 2 ]] || die "--agent 缺少参数"
      expand_agents "$2"
      shift 2
      ;;
    --target)
      [[ $# -ge 2 ]] || die "--target 缺少参数"
      TARGETS+=("$2")
      shift 2
      ;;
    --source)
      [[ $# -ge 2 ]] || die "--source 缺少参数"
      SOURCE_ROOT=$2
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --uninstall|--remove)
      UNINSTALL=1
      shift
      ;;
    --force)
      FORCE=1
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
      die "未知参数: $1（用 --agent 或 --target 指定目标）"
      ;;
  esac
done

[[ -d $SOURCE_ROOT ]] || die "源目录不存在: $SOURCE_ROOT"
SOURCE_ROOT=$(cd -- "$SOURCE_ROOT" && pwd -P)
SOURCE="$SOURCE_ROOT/AGENTS.md"
[[ -f $SOURCE ]] || die "源目录缺少 AGENTS.md: $SOURCE"

print_agent_row() {
  local _a=$1 _p _link
  _p=$(agent_path "$_a")
  if [[ -L $_p ]]; then
    if [[ $(readlink -f -- "$_p" || true) == "$SOURCE" ]]; then
      _link=已链接
    else
      _link=指向别处
    fi
  elif [[ -e $_p ]]; then
    _link=实体文件
  else
    _link=无链接
  fi
  printf '  %-9s %-5s %s\n' "$_a" "$_link" "${_p/#"$HOME"/\~}"
}

if ((LIST_ONLY)); then
  _installed=()
  _missing=()
  for _agent in "${ALL_AGENTS[@]}"; do
    if agent_installed "$_agent"; then
      _installed+=("$_agent")
    else
      _missing+=("$_agent")
    fi
  done
  printf '已安装（%d）：\n' "${#_installed[@]}"
  if (( ${#_installed[@]} )); then
    for _agent in "${_installed[@]}"; do print_agent_row "$_agent"; done
  fi
  printf '未安装（%d）：\n' "${#_missing[@]}"
  if (( ${#_missing[@]} )); then
    for _agent in "${_missing[@]}"; do print_agent_row "$_agent"; done
  fi
  printf '源：%s\n' "$SOURCE"
  exit 0
fi

(( ${#AGENTS[@]} + ${#TARGETS[@]} > 0 )) || die "至少指定一个 --agent 或 --target"

# 去重并保留顺序
ORDER=()
declare -A SEEN=()
add_target() {
  local target=$1
  [[ -n $target ]] || return 0
  [[ -n ${SEEN[$target]+x} ]] && return 0
  SEEN[$target]=1
  ORDER+=("$target")
}

for _agent in "${AGENTS[@]}"; do
  if (( ! FORCE )) && ! agent_installed "$_agent"; then
    printf '  - %s（未安装，跳过）\n' "$_agent"
    continue
  fi
  add_target "$(agent_path "$_agent")"
done
for _target in "${TARGETS[@]}"; do
  add_target "$_target"
done

if (( ${#ORDER[@]} == 0 )); then
  if ((UNINSTALL)); then
    printf '\n没有需要处理的 Agent：指定的 Agent 都未安装，没有可移除的链接。\n'
  else
    printf '\n没有需要处理的 Agent：指定的 Agent 都未安装，用 --force 可强制安装。\n'
  fi
  exit 0
fi

created=0
replaced=0
removed=0
skipped=0
failed=0

if ((UNINSTALL)); then
  for target in "${ORDER[@]}"; do
    label=${target/#"$HOME"/\~}

    if [[ -L $target ]]; then
      current=$(readlink -f -- "$target" || true)
      if [[ $current == "$SOURCE" ]] || ((FORCE)); then
        if ((DRY_RUN)); then
          printf '  - %s（将移除链接）\n' "$label"
        else
          rm -f -- "$target"
          printf '  - %s（已移除链接）\n' "$label"
        fi
        ((removed += 1))
      else
        printf '  = %s（指向 %s，不是本技能的链接，跳过）\n' "$label" "$current"
        ((skipped += 1))
      fi
    elif [[ -e $target ]]; then
      printf '  = %s（实体文件或目录，不是本技能建的链接，跳过）\n' "$label"
      ((skipped += 1))
    else
      printf '  = %s（无链接）\n' "$label"
      ((skipped += 1))
    fi
  done

  printf '\n结果：移除 %d，跳过 %d\n' "$removed" "$skipped"
  printf '源：%s\n' "$SOURCE"
  exit 0
fi

backup_path() {
  local target=$1 backup="$1.bak.$(date +%F)" i=1
  while [[ -e $backup || -L $backup ]]; do
    backup="$target.bak.$(date +%F).$i"
    ((i += 1))
  done
  printf '%s\n' "$backup"
}

for target in "${ORDER[@]}"; do
  label=${target/#"$HOME"/\~}

  if [[ ! -d $(dirname -- "$target") ]]; then
    if ((DRY_RUN)); then
      printf '  + %s（将创建目录 %s）\n' "$label" "$(dirname -- "$target")"
    else
      mkdir -p -- "$(dirname -- "$target")"
    fi
  fi

  if [[ -L $target ]]; then
    current=$(readlink -f -- "$target" || true)
    if [[ $current == "$SOURCE" ]]; then
      printf '  = %s（已链接）\n' "$label"
      ((skipped += 1))
      continue
    fi
    if ((DRY_RUN)); then
      printf '  ~ %s -> %s（将替换）\n' "$label" "$SOURCE"
    else
      ln -sfn -- "$SOURCE" "$target"
      printf '  ~ %s -> %s（已替换）\n' "$label" "$SOURCE"
    fi
    ((replaced += 1))
  elif [[ -e $target ]]; then
    if cmp -s -- "$SOURCE" "$target"; then
      if ((DRY_RUN)); then
        printf '  ~ %s（内容相同，将改为链接）\n' "$label"
      else
        rm -f -- "$target"
        ln -s -- "$SOURCE" "$target"
        printf '  ~ %s（内容相同，已改为链接）\n' "$label"
      fi
      ((replaced += 1))
    else
      backup=$(backup_path "$target")
      if ((DRY_RUN)); then
        printf '  ~ %s（实体文件内容不同，将备份到 %s 后改为链接）\n' "$label" "${backup/#"$HOME"/\~}"
      else
        cp -p -- "$target" "$backup"
        rm -f -- "$target"
        ln -s -- "$SOURCE" "$target"
        printf '  ~ %s（已备份到 %s，并改为链接）\n' "$label" "${backup/#"$HOME"/\~}"
      fi
      ((replaced += 1))
    fi
  else
    if ((DRY_RUN)); then
      printf '  + %s -> %s\n' "$label" "$SOURCE"
    else
      ln -s -- "$SOURCE" "$target"
      printf '  + %s -> %s\n' "$label" "$SOURCE"
    fi
    ((created += 1))
  fi

  if ((!DRY_RUN)) && [[ $(readlink -f -- "$target" || true) != "$SOURCE" ]]; then
    printf '  失败 %s：链接未指向 %s\n' "$label" "$SOURCE" >&2
    ((failed += 1))
  fi
done

printf '\n结果：新建 %d，替换 %d，跳过 %d，失败 %d\n' "$created" "$replaced" "$skipped" "$failed"
printf '源：%s\n' "$SOURCE"

((failed == 0))
