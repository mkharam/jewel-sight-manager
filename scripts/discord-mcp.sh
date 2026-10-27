#!/usr/bin/env bash
# Launches the Discord MCP server (https://github.com/v-3/discordmcp) over stdio.
# Needs DISCORD_TOKEN (a Discord bot token) in the environment. Never commit the token.
# stdout is the MCP channel, so all setup output goes to stderr.
set -euo pipefail

REPO_URL="https://github.com/v-3/discordmcp.git"
COMMIT="39622af0333bcd324e811a2390146927517fb03d"
DIR="${XDG_CACHE_HOME:-$HOME/.cache}/discordmcp-$COMMIT"

if [ -z "${DISCORD_TOKEN:-}" ]; then
  echo "discord-mcp: DISCORD_TOKEN is not set; add it to your environment" >&2
  exit 1
fi

if [ ! -f "$DIR/build/index.js" ]; then
  rm -rf "$DIR"
  git clone --quiet "$REPO_URL" "$DIR" >&2
  git -C "$DIR" checkout --quiet "$COMMIT" >&2
  (cd "$DIR" && npm ci --no-audit --no-fund >&2 && npm run build >&2)
fi

exec node "$DIR/build/index.js"
