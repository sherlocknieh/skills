#!/usr/bin/env bash
# project-init: 把仓库的 AGENTS.md 符号链接到当前 Agent 的全局指令路径（原 agents-init）
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
  all       以上全部

选项:
  --agent <名字>   目标 Agent，可多次指定或用逗号分隔
  --target <路径>  直接指定全局指令路径，可多次指定
  --source <目录>  技能仓库根目录（默认：本脚本的上两级）
  --dry-run        只打印动作，不写入
  --list           列出 Agent 与路径映射
  -h, --help       显示帮助

示例:
  install-agents.sh --agent opencode
  install-agents.sh --agent opencode --agent copilot
  install-agents.sh --agent all --dry-run
  install-agents.sh --target ~/.config/myagent/RULES.md
EOF
}

agent_path() {
  case "$1" in
    opencode) printf '%s\n' "$HOME/.config/opencode/AGENTS.md" ;;
    claude) printf '%s\n' "$HOME/.claude/CLAUDE.md" ;;
    codex) printf '%s\n' "$HOME/.codex/AGENTS.md" ;;
    copilot) printf '%s\n' "$HOME/.copilot/copilot-instructions.md" ;;
    *) return 1 ;;
  esac
}

normalize_agent() {
  case "$1" in
    opencode|OpenCode) printf 'opencode' ;;
    claude|claude-code|Claude\ Code|Claude) printf 'claude' ;;
    codex|Codex) printf 'codex' ;;
    copilot|Copilot) printf 'copilot' ;;
    *) return 1 ;;
  esac
}

expand_agents() {
  local value=$1 part normalized
  IFS=',' read -r -a _parts <<< "$value"
  for part in "${_parts[@]}"; do
    [[ -z $part ]] && continue
    if [[ $part == all || $part == ALL || $part == 全部 ]]; then
      AGENTS+=(opencode claude codex copilot)
      continue
    fi
    normalized=$(normalize_agent "$part") \
      || die "未知 Agent: $part（可选 opencode/claude/codex/copilot/all）"
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

if ((LIST_ONLY)); then
  printf '可用 Agent：\n'
  for _agent in opencode claude codex copilot; do
    printf '  %-8s %s\n' "$_agent" "$(agent_path "$_agent")"
  done
  exit 0
fi

[[ -d $SOURCE_ROOT ]] || die "源目录不存在: $SOURCE_ROOT"
SOURCE_ROOT=$(cd -- "$SOURCE_ROOT" && pwd -P)
SOURCE="$SOURCE_ROOT/AGENTS.md"
[[ -f $SOURCE ]] || die "源目录缺少 AGENTS.md: $SOURCE"

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
  add_target "$(agent_path "$_agent")"
done
for _target in "${TARGETS[@]}"; do
  add_target "$_target"
done

created=0
replaced=0
skipped=0
failed=0

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
