#!/bin/sh
# Apple development environment for Claude by Praecise: installer for Claude Code and
# for Claude Agent in Xcode. Run again after changing the values file or the skills.
#
#   ./install.sh [path/to/apple.env]
#
# 1. writes a copy of this environment with your team's values filled in
# 2. registers Xcode's MCP bridge with Claude Code and installs the copy as a plugin
# 3. puts the rules, skills and agent where Xcode's Claude Agent reads them
set -eu
here=$(cd "$(dirname "$0")" && pwd)
values=${1:-$here/apple.env}
[ -f "$values" ] || { echo "no values file at $values; copy apple.env.example to apple.env and fill it in" >&2; exit 1; }

get() { sed -n "s/^$1=//p" "$values" | tail -1; }
team=$(get APPLE_TEAM_ID); name=$(get APPLE_TEAM_NAME); prefix=$(get APPLE_BUNDLE_PREFIX)
dev=$(get APPLE_DEVELOPMENT_IDENTITY); notary=$(get APPLE_NOTARY_PROFILE)
for v in "$team" "$name" "$prefix" "$dev" "$notary"; do
  [ -n "$v" ] || { echo "a value is missing in $values; see apple.env.example" >&2; exit 1; }
done

dest="${PRAECISE_ENVIRONMENTS:-$HOME/.praecise/environments}/apple"
rm -rf "$dest" && mkdir -p "$dest"
for part in .claude-plugin skills agents templates scripts docs; do cp -R "$here/$part" "$dest/"; done

esc() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }
find "$dest" -type f | while IFS= read -r f; do
  sed -e "s|{{TEAM_ID}}|$(esc "$team")|g" -e "s|{{TEAM_NAME}}|$(esc "$name")|g" \
      -e "s|{{BUNDLE_PREFIX}}|$(esc "$prefix")|g" -e "s|{{DEVELOPMENT_IDENTITY}}|$(esc "$dev")|g" \
      -e "s|{{NOTARY_PROFILE}}|$(esc "$notary")|g" -e "s|{{ENV_DIR}}|$(esc "$dest")|g" "$f" > "$f.tmp"
  mv "$f.tmp" "$f"
done
chmod +x "$dest"/scripts/*.sh
echo "ok: rendered to $dest"

if command -v claude >/dev/null 2>&1; then
  claude mcp get xcode >/dev/null 2>&1 || claude mcp add --scope user --transport stdio xcode -- xcrun mcpbridge >/dev/null
  claude plugin uninstall apple-dev@praecise >/dev/null 2>&1 || true
  claude plugin marketplace remove praecise >/dev/null 2>&1 || true
  claude plugin marketplace add "$dest" >/dev/null
  claude plugin install apple-dev@praecise --scope user >/dev/null
  echo "ok: Claude Code (xcode MCP server, apple-dev plugin)"
else
  echo "skipped: Claude Code is not installed"
fi

# Xcode's Claude Agent reads only this folder.
x="$HOME/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig"
mkdir -p "$x/skills" "$x/agents"
cp "$dest/templates/xcode-agent-CLAUDE.md" "$x/CLAUDE.md"
for d in "$dest"/skills/*/; do
  n=$(basename "$d"); rm -rf "$x/skills/apple-dev-$n"; cp -R "$d" "$x/skills/apple-dev-$n"
done
cp "$dest"/agents/*.md "$x/agents/"
echo "ok: Claude Agent in Xcode ($x)"
