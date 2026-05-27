#!/usr/bin/env bash
#
# OpenWOP CLI one-line installer.
#
#   curl -fsSL https://openwop.dev/install.sh | bash
#
# Detects the OS, ensures Node 22+ is present (installs via the platform
# package manager when missing), installs the @openwop/cli npm package
# globally, then launches the onboarding wizard. Non-interactive/CI callers
# can skip onboarding with OPENWOP_INSTALL_NO_ONBOARD=1.
#
# Honest about its limits: it never silently "succeeds" — if Node can't be
# provisioned it prints the manual step and exits non-zero.
set -euo pipefail

REQUIRED_NODE_MAJOR=22
PKG="${OPENWOP_INSTALL_PKG:-@openwop/cli}"

log()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

detect_os() {
  case "$(uname -s)" in
    Darwin) echo macos ;;
    Linux)  echo linux ;;
    *)      echo "$(uname -s)" ;;
  esac
}

node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0
}

ensure_node() {
  local have; have="$(node_major)"
  if [ "$have" -ge "$REQUIRED_NODE_MAJOR" ]; then
    log "Node $(node --version) detected."
    return
  fi
  warn "Node ${REQUIRED_NODE_MAJOR}+ is required (found: ${have:-none}). Attempting install…"
  local os; os="$(detect_os)"
  if [ "$os" = "macos" ] && command -v brew >/dev/null 2>&1; then
    brew install node
  elif [ "$os" = "linux" ] && command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    die "Could not auto-install Node on this system. Install Node ${REQUIRED_NODE_MAJOR}+ from https://nodejs.org and re-run."
  fi
  [ "$(node_major)" -ge "$REQUIRED_NODE_MAJOR" ] || die "Node install did not yield ${REQUIRED_NODE_MAJOR}+. Install manually from https://nodejs.org."
}

main() {
  log "OpenWOP CLI installer ($(detect_os))"
  ensure_node
  command -v npm >/dev/null 2>&1 || die "npm not found on PATH (it ships with Node). Install Node ${REQUIRED_NODE_MAJOR}+ and re-run."

  log "Installing ${PKG} globally…"
  npm install -g "$PKG"

  command -v openwop >/dev/null 2>&1 || die "openwop not on PATH after install. Add your npm global bin dir to PATH (npm bin -g)."
  log "Installed: $(openwop --version 2>/dev/null || echo '@openwop/cli')"

  if [ "${OPENWOP_INSTALL_NO_ONBOARD:-0}" = "1" ]; then
    log "Skipping onboarding (OPENWOP_INSTALL_NO_ONBOARD=1). Run \`openwop onboard\` when ready."
    return
  fi
  log "Launching onboarding…"
  openwop onboard || warn "Onboarding exited early — re-run anytime with \`openwop onboard\`."
}

main "$@"
