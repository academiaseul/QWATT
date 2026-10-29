#!/usr/bin/env bash
# QWATT — install one host of the live run (plan W2-5; docs/RUNBOOK.md, setup steps 1, 7 and 9)
# ---------------------------------------------------------------------------------------------
#   sudo bash /opt/qwatt/ops/deploy/host/install.sh --role proposer|verifier --commit <40-hex sha>
#
# Run it on the host itself, from a git checkout of the commit to deploy at /opt/qwatt:
#   sudo git clone https://github.com/academiaseul/qwatt /opt/qwatt
#   sudo git -C /opt/qwatt checkout --detach <commit>
#
# What it does, in order, and it stops at the first thing that is not as it should be:
#   1. checks: root, x86_64, Ubuntu, systemd as PID 1 (on WSL it turns systemd on in /etc/wsl.conf
#      and asks for `wsl --shutdown` first), /opt/qwatt at --commit;
#   2. Node NODE_VERSION from nodejs.org, checked against NODE_SHA256, at /usr/bin/node (every unit
#      in ops/deploy calls /usr/bin/node); stellar-cli STELLAR_VERSION, checked against
#      STELLAR_SHA256 (the same sum the CI checks), at /usr/local/bin/stellar;
#   3. user qwatt (no login shell), /var/lib/qwatt, /etc/qwatt, git safe.directory /opt/qwatt,
#      npm ci in /opt/qwatt/anchor;
#   4. the clock synchronised; no automatic upgrade or service restart during the run (Q5);
#   5. this role's units copied to /etc/systemd/system and its env files created from
#      ops/deploy/env.example when missing (an existing file is never overwritten). Nothing is
#      enabled or started: the services need the stellar-cli identity and /etc/qwatt/anchor.json;
#   6. this role's deploy key (generated once, as user qwatt) and GitHub's host key, pinned only
#      if it matches GITHUB_ED25519_FP. It prints the .pub line to send to Jay, nothing else.
#
# It never generates, reads or prints a stellar-cli key: each holder does that in their own
# terminal (RUNBOOK, setup step 2), and the script prints those commands at the end. Running it
# again is safe: every step checks before it changes anything.

set -euo pipefail

# node-v24.14.1-linux-x64.tar.xz, from nodejs.org/dist/v24.14.1/SHASUMS256.txt
NODE_VERSION=24.14.1
NODE_SHA256=84d38715d449447117d05c3e71acd78daa49d5b1bfa8aacf610303920c3322be
# stellar-cli-28.1.0-x86_64-unknown-linux-gnu.tar.gz, the digest GitHub publishes for release v28.1.0
STELLAR_VERSION=28.1.0
STELLAR_SHA256=c1680deee94301d33ada7a17f98411e642a4248c727afbd2e43050d345746462
# GitHub's published ED25519 host key fingerprint (docs.github.com; the RUNBOOK, setup step 7)
GITHUB_ED25519_FP=SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU

PROPOSER_UNITS=(qwatt-live.service qwatt-proposer.service qwatt-publish.service)
VERIFIER_UNITS=(qwatt-verifier.service qwatt-verifier-log.service qwatt-watch.service)
PROPOSER_ENVS=(live publish)
VERIFIER_ENVS=(verifier verifier-log watch)
PROPOSER_DEPLOY_KEY=qwatt-evidence
VERIFIER_DEPLOY_KEY=qwatt-verifier-log

REPO=/opt/qwatt
STATE=/var/lib/qwatt
CONF=/etc/qwatt
QHOME=/home/qwatt

die() { echo "install.sh: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

ROLE= COMMIT=
while [ $# -gt 0 ]; do
  case "$1" in
    --role) ROLE="${2:-}"; shift 2 ;;
    --commit) COMMIT="${2:-}"; shift 2 ;;
    *) die "unknown argument $1 (usage: --role proposer|verifier --commit <sha>)" ;;
  esac
done
case "$ROLE" in proposer|verifier) ;; *) die "--role proposer or --role verifier" ;; esac
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "--commit must be the full 40-character commit to deploy"

if [ "$ROLE" = proposer ]; then UNITS=("${PROPOSER_UNITS[@]}"); ENVS=("${PROPOSER_ENVS[@]}"); DEPLOY_KEY=$PROPOSER_DEPLOY_KEY; IDENTITY=qwatt-proposer
else UNITS=("${VERIFIER_UNITS[@]}"); ENVS=("${VERIFIER_ENVS[@]}"); DEPLOY_KEY=$VERIFIER_DEPLOY_KEY; IDENTITY=qwatt-verifier; fi

# ── 1. checks ──────────────────────────────────────────────────────────────────────────────
step "1. this machine"
[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ "$(uname -m)" = x86_64 ] || die "x86_64 only (the pinned downloads are x86_64)"
. /etc/os-release
[ "${ID:-}" = ubuntu ] || die "Ubuntu only (found ${ID:-unknown})"
WSL=no
if grep -qi microsoft /proc/version 2>/dev/null; then WSL=yes; fi
if [ "$(ps -p 1 -o comm=)" != systemd ]; then
  if [ "$WSL" = yes ]; then
    if ! grep -q '^systemd=true' /etc/wsl.conf 2>/dev/null; then
      printf '[boot]\nsystemd=true\n' >> /etc/wsl.conf
    fi
    die "systemd is now on in /etc/wsl.conf: in Windows PowerShell run 'wsl --shutdown', open Ubuntu again and re-run this script"
  fi
  die "systemd must be PID 1"
fi
if [ "$WSL" = yes ] && ! grep -q '^systemd=true' /etc/wsl.conf 2>/dev/null; then printf '[boot]\nsystemd=true\n' >> /etc/wsl.conf; fi
echo "Ubuntu ${VERSION_ID:-?} · $( [ "$WSL" = yes ] && echo WSL2 || echo Linux ) · role $ROLE"

[ -d "$REPO/.git" ] || die "$REPO is not a git checkout: sudo git clone https://github.com/academiaseul/qwatt $REPO"
HEAD_NOW=$(git -C "$REPO" rev-parse HEAD)
[ "$HEAD_NOW" = "$COMMIT" ] || die "$REPO is at $HEAD_NOW, not $COMMIT: sudo git -C $REPO fetch && sudo git -C $REPO checkout --detach $COMMIT"
[ -z "$(git -C "$REPO" status --porcelain --untracked-files=no)" ] || die "$REPO has local changes: the run publishes $COMMIT as code_commit, so the tree must be exactly that commit"
echo "$REPO at $COMMIT"

step "packages"
export DEBIAN_FRONTEND=noninteractive
need=()
for p in git curl xz-utils ca-certificates openssh-client; do dpkg -s "$p" >/dev/null 2>&1 || need+=("$p"); done
if [ ${#need[@]} -gt 0 ]; then apt-get update -q && apt-get install -y -q "${need[@]}"; fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ── 2. Node and stellar-cli, pinned ────────────────────────────────────────────────────────
step "2. Node $NODE_VERSION at /usr/bin/node"
NODE_DIR=/usr/local/lib/nodejs/node-v$NODE_VERSION-linux-x64
if [ -e /usr/bin/node ] && [ "$(readlink -f /usr/bin/node)" != "$NODE_DIR/bin/node" ]; then
  if dpkg -S /usr/bin/node >/dev/null 2>&1; then die "/usr/bin/node belongs to an Ubuntu package ($(dpkg -S /usr/bin/node | cut -d: -f1)): sudo apt-get remove nodejs, then re-run"; fi
fi
if [ ! -x "$NODE_DIR/bin/node" ]; then
  curl -fsSLo "$TMP/node.tar.xz" "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz"
  echo "$NODE_SHA256  $TMP/node.tar.xz" | sha256sum -c -
  mkdir -p /usr/local/lib/nodejs
  tar -xJf "$TMP/node.tar.xz" -C /usr/local/lib/nodejs
fi
ln -sfn "$NODE_DIR/bin/node" /usr/bin/node          # where every unit in ops/deploy calls it
ln -sfn "$NODE_DIR/bin/npm" /usr/bin/npm
ln -sfn "$NODE_DIR/bin/npx" /usr/bin/npx
[ "$(/usr/bin/node -v)" = "v$NODE_VERSION" ] || die "/usr/bin/node prints $(/usr/bin/node -v), not v$NODE_VERSION"
echo "/usr/bin/node $(/usr/bin/node -v)"

step "stellar-cli $STELLAR_VERSION at /usr/local/bin/stellar"
if [ "$(/usr/local/bin/stellar version --only-version 2>/dev/null || true)" != "$STELLAR_VERSION" ]; then
  curl -fsSLo "$TMP/stellar.tar.gz" "https://github.com/stellar/stellar-cli/releases/download/v$STELLAR_VERSION/stellar-cli-$STELLAR_VERSION-x86_64-unknown-linux-gnu.tar.gz"
  echo "$STELLAR_SHA256  $TMP/stellar.tar.gz" | sha256sum -c -
  tar -xzf "$TMP/stellar.tar.gz" -C "$TMP" stellar
  install -m 755 "$TMP/stellar" /usr/local/bin/stellar
fi
[ "$(/usr/local/bin/stellar version --only-version)" = "$STELLAR_VERSION" ] || die "stellar version --only-version is not $STELLAR_VERSION"
echo "/usr/local/bin/stellar $STELLAR_VERSION"

# ── 3. user, directories, repository ───────────────────────────────────────────────────────
step "3. user qwatt and directories"
id qwatt >/dev/null 2>&1 || useradd --create-home --shell /usr/sbin/nologin qwatt
install -d -o qwatt -g qwatt -m 750 "$STATE"
install -d -o root -g root -m 755 "$CONF"
install -d -o qwatt -g qwatt -m 700 "$QHOME/.ssh"
git config --system --get-all safe.directory | grep -qx "$REPO" || git config --system --add safe.directory "$REPO"
(cd "$REPO/anchor" && npm ci --no-audit --no-fund)
echo "user qwatt · $STATE · $CONF · $REPO/anchor dependencies installed"

# ── 4. clock and updates ───────────────────────────────────────────────────────────────────
step "4. clock and updates (Q5)"
if [ "$WSL" = yes ]; then
  echo "WSL takes its clock from Windows: check.sh compares it with Horizon (AT-8)"
else
  timedatectl set-ntp true
fi
# no automatic upgrade, and no automatic service restart, until the run is RECONCILED (undo: README)
systemctl disable --now apt-daily-upgrade.timer >/dev/null 2>&1 || true
systemctl disable --now unattended-upgrades.service >/dev/null 2>&1 || true
if [ -d /etc/apt/apt.conf.d ]; then
  printf 'APT::Periodic::Unattended-Upgrade "0";\nAPT::Periodic::Update-Package-Lists "0";\n' > /etc/apt/apt.conf.d/99qwatt-no-auto-upgrade
fi
install -d /etc/needrestart/conf.d
printf "# QWATT live run: list services that need a restart, never restart them (README, after the run)\n\$nrconf{restart} = 'l';\n" > /etc/needrestart/conf.d/99qwatt.conf
echo "unattended upgrades off · needrestart lists only"

# ── 5. units and env files ─────────────────────────────────────────────────────────────────
step "5. units for the $ROLE host (installed, not started)"
for u in "${UNITS[@]}"; do install -m 644 "$REPO/ops/deploy/$u" "/etc/systemd/system/$u"; done
for e in "${ENVS[@]}"; do
  f="$CONF/$e.env"
  if [ -e "$f" ]; then echo "kept $f"; continue; fi
  # the block of env.example under "# <name>.env", up to the next "# <other>.env" header
  awk -v want="# $e.env" 'index($0, want) == 1 { on = 1; next } /^# [a-z-]+\.env/ { on = 0 } on && !/^#/ && NF' "$REPO/ops/deploy/env.example" > "$f"
  chmod 600 "$f"; chown root:root "$f"
  echo "created $f from env.example (placeholders: fill in before starting)"
done
systemctl daemon-reload
echo "installed: ${UNITS[*]}"

# ── 6. deploy key and GitHub's host key ────────────────────────────────────────────────────
step "6. deploy key $DEPLOY_KEY and GitHub's host key"
KEY="$QHOME/.ssh/$DEPLOY_KEY"
if [ ! -e "$KEY" ]; then
  sudo -u qwatt ssh-keygen -t ed25519 -N "" -q -C "$DEPLOY_KEY deploy key, $ROLE host" -f "$KEY"
fi
ssh-keyscan -t ed25519 github.com 2>/dev/null > "$TMP/github.keys"
[ -s "$TMP/github.keys" ] || die "ssh-keyscan github.com answered nothing (network?)"
FP=$(ssh-keygen -lf "$TMP/github.keys" | awk '{print $2}')
[ "$FP" = "$GITHUB_ED25519_FP" ] || die "github.com offered host key $FP, not GitHub's published $GITHUB_ED25519_FP: nothing pinned"
KH="$QHOME/.ssh/known_hosts"
touch "$KH"
grep -qF "$(awk '{print $3}' "$TMP/github.keys")" "$KH" || cat "$TMP/github.keys" >> "$KH"
chown qwatt:qwatt "$KH"; chmod 600 "$KH"
echo "github.com pinned ($FP)"

cat <<EOF

== done. Next, in this order (docs/RUNBOOK.md):

1. Send Jay this one line (the PUBLIC deploy key; the private file never leaves this host):
$(cat "$KEY.pub")

2. In your own terminal on this host, never over screen sharing (RUNBOOK, setup step 2):
     sudo -u qwatt -H stellar keys generate $IDENTITY
     sudo chmod -R go-rwx ~qwatt/.config/stellar
     sudo -u qwatt -H stellar keys address $IDENTITY        # send only this G… line
   and the paper backup of the 24 words, offline.

3. Then: sudo bash $REPO/ops/deploy/host/check.sh --role $ROLE
EOF
