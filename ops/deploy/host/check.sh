#!/usr/bin/env bash
# QWATT — acceptance checks for one host (plan W2-5; the AT table in ops/deploy/host/README.md)
# ---------------------------------------------------------------------------------------------
#   sudo bash /opt/qwatt/ops/deploy/host/check.sh --role proposer|verifier [--commit <sha>]
#
# Runs every automated AT of the README table that applies to this host and prints one line per
# check: PASS, FAIL, or WAIT (a later setup step has not happened yet: no key, no anchor.json).
# It reads public things only: it never opens a stellar-cli identity file or a private SSH key
# (keys.js check signs a throwaway transaction through stellar-cli, as the services do).
# Exit 0 when nothing FAILs.

set -uo pipefail

ROLE= COMMIT=
while [ $# -gt 0 ]; do
  case "$1" in
    --role) ROLE="${2:-}"; shift 2 ;;
    --commit) COMMIT="${2:-}"; shift 2 ;;
    *) echo "usage: check.sh --role proposer|verifier [--commit <sha>]" >&2; exit 2 ;;
  esac
done
case "$ROLE" in proposer|verifier) ;; *) echo "--role proposer or --role verifier" >&2; exit 2 ;; esac
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 2; }

REPO=/opt/qwatt CONF=/etc/qwatt QHOME=/home/qwatt
if [ "$ROLE" = proposer ]; then
  UNITS="qwatt-live qwatt-proposer qwatt-publish"; ENVS="live publish"; DEPLOY_KEY=qwatt-evidence; IDENTITY=qwatt-proposer
  OTHER_KEY=qwatt-verifier-log; OTHER_IDENTITY=qwatt-verifier
else
  UNITS="qwatt-verifier qwatt-verifier-log qwatt-watch"; ENVS="verifier verifier-log watch"; DEPLOY_KEY=qwatt-verifier-log; IDENTITY=qwatt-verifier
  OTHER_KEY=qwatt-evidence; OTHER_IDENTITY=qwatt-proposer
fi
WSL=no; grep -qi microsoft /proc/version 2>/dev/null && WSL=yes

fails=0
pass() { printf 'PASS  %-6s %s\n' "$1" "$2"; }
fail() { printf 'FAIL  %-6s %s\n' "$1" "$2"; fails=$((fails + 1)); }
wait_() { printf 'WAIT  %-6s %s\n' "$1" "$2"; }
check() { local id=$1 what=$2; shift 2; if "$@" >/dev/null 2>&1; then pass "$id" "$what"; else fail "$id" "$what"; fi; }

echo "QWATT host checks · role $ROLE · $(date -u +%FT%TZ)"

# ── the machine ─────────────────────────────────────────────────────────────────────────────
check AT-1 "Ubuntu, x86_64" sh -c '. /etc/os-release && [ "$ID" = ubuntu ] && [ "$(uname -m)" = x86_64 ]'
check AT-2 "systemd is PID 1" sh -c '[ "$(ps -p 1 -o comm=)" = systemd ]'
check AT-3 "Node v24.14.1 at /usr/bin/node" sh -c '[ "$(/usr/bin/node -v)" = v24.14.1 ]'
check AT-4 "stellar-cli 28.1.0 on qwatt's PATH" sh -c '[ "$(sudo -u qwatt -H sh -c "stellar version --only-version")" = 28.1.0 ]'
check AT-5 "user qwatt exists, no login shell" sh -c 'getent passwd qwatt | grep -q ":/usr/sbin/nologin$"'
if [ -n "$COMMIT" ]; then
  check AT-6 "$REPO at $COMMIT, no local changes" sh -c "[ \"\$(git -C $REPO rev-parse HEAD)\" = $COMMIT ] && [ -z \"\$(git -C $REPO status --porcelain --untracked-files=no)\" ]"
else
  check AT-6 "$REPO is a clean git checkout (pass --commit to check which commit)" sh -c "[ -z \"\$(git -C $REPO status --porcelain --untracked-files=no)\" ]"
fi
check AT-7 "user qwatt can read the commit (safe.directory) and anchor/ dependencies are installed" sh -c "sudo -u qwatt git -C $REPO rev-parse HEAD && [ -d $REPO/anchor/node_modules/@stellar/stellar-sdk ]"

# AT-8: the clock against Horizon's Date header (1 s resolution): within 10 s, well inside the 120 s both services require
hdate=$(curl -fsSI --max-time 15 https://horizon-testnet.stellar.org/ 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="date"{print $2}')
if [ -z "$hdate" ]; then fail AT-8 "Horizon answered (clock check)"
else
  skew=$(( $(date -u +%s) - $(date -u -d "$hdate" +%s) )); [ $skew -lt 0 ] && skew=$(( -skew ))
  if [ $skew -le 10 ]; then pass AT-8 "clock within 10 s of Horizon (${skew} s)"; else fail AT-8 "clock ${skew} s off Horizon (limit 10 s; the services refuse at 120 s)"; fi
fi
check AT-9 "no automatic upgrade during the run (apt-daily-upgrade.timer off, needrestart lists only)" sh -c '! systemctl is-enabled apt-daily-upgrade.timer && grep -q "restart} = .l." /etc/needrestart/conf.d/99qwatt.conf'

# ── WSL only: kept running, started with nobody signed in ──────────────────────────────────
if [ "$WSL" = yes ]; then
  check AT-10 "systemd is on in /etc/wsl.conf" grep -q '^systemd=true' /etc/wsl.conf
  # the keepalive started by the Windows task (ops/deploy/wsl/instalar-wsl.ps1) is a "sleep infinity"
  check AT-11 "the Windows task's keepalive is running in this distribution (sleep infinity)" pgrep -f '^(/usr/bin/)?sleep infinity$'
  up=$(cut -d. -f1 /proc/uptime)
  echo "      ·      WSL up for $((up / 60)) min; AT-12 and AT-13 are checked by hand (README)"
fi

# ── this role's units, env files, keys ─────────────────────────────────────────────────────
for u in $UNITS; do check AT-14 "$u.service installed, as in ops/deploy" cmp -s "$REPO/ops/deploy/$u.service" "/etc/systemd/system/$u.service"; done
for o in qwatt-live qwatt-proposer qwatt-publish qwatt-verifier qwatt-verifier-log qwatt-watch; do
  case " $UNITS " in *" $o "*) continue ;; esac
  check AT-15 "$o.service is NOT on this host (the other role's)" sh -c "[ ! -e /etc/systemd/system/$o.service ]"
done
# the lines of env.example's block for <name>.env, as install.sh copies them (under "# <name>.env", up to the next header)
env_block() { awk -v want="# $1.env" 'index($0, want) == 1 { on = 1; next } /^# [a-z-]+\.env/ { on = 0 } on && !/^#/ && NF' "$REPO/ops/deploy/env.example"; }
for e in $ENVS; do
  f="$CONF/$e.env"
  if [ ! -e "$f" ]; then fail AT-16 "$f exists"; continue; fi
  check AT-16 "$f mode 600, root" sh -c "[ \"\$(stat -c %a:%U $f)\" = 600:root ]"
  # every variable of its block: a file kept from an earlier install can lack a newer one (W3-4: QWATT_RUN_DAYS)
  miss=""
  for v in $(env_block "$e" | cut -d= -f1); do grep -q "^$v=" "$f" || miss="$miss $v"; done
  if [ -n "$miss" ]; then fail AT-17 "$f lacks$miss (ops/deploy/env.example sets it for this file: add it before starting the service)"
  elif grep -Eq 'G\.\.\.|YYYY-MM-DD|<[^>]*>' "$f"; then wait_ AT-17 "$f still has placeholders (G..., rehearsal-YYYY-MM-DD, <…>)"; else pass AT-17 "$f filled in"; fi
  check AT-18 "$f holds no secret (no S… seed)" sh -c "! grep -Eq '(^|[^A-Z2-7])S[A-Z2-7]{55}([^A-Z2-7]|$)' $f"
done

check AT-19 "GitHub's host key pinned for qwatt (published ED25519 fingerprint)" sh -c "ssh-keygen -lf $QHOME/.ssh/known_hosts | grep -q 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU'"
dk=$(stat -c %a:%U "$QHOME/.ssh/$DEPLOY_KEY" 2>/dev/null || echo missing)
if [ "$dk" = 600:qwatt ] && [ -s "$QHOME/.ssh/$DEPLOY_KEY.pub" ]; then pass AT-20 "deploy key $DEPLOY_KEY exists, private file 600 owned by qwatt"
else fail AT-20 "deploy key $DEPLOY_KEY: private file is $dk (must be 600:qwatt), .pub $( [ -s "$QHOME/.ssh/$DEPLOY_KEY.pub" ] && echo present || echo missing)"; fi
check AT-21 "the other host's deploy key ($OTHER_KEY) is NOT here" sh -c "[ ! -e $QHOME/.ssh/$OTHER_KEY ]"
greet=$(sudo -u qwatt ssh -i "$QHOME/.ssh/$DEPLOY_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15 -T git@github.com 2>&1 || true)
if echo "$greet" | grep -q "Hi academiaseul/$DEPLOY_KEY!"; then pass AT-22 "GitHub greets the deploy key as academiaseul/$DEPLOY_KEY"
else wait_ AT-22 "GitHub does not know the deploy key yet (send the .pub line to Jay; he adds it with write access)"; fi

if sudo -u qwatt -H stellar keys address "$IDENTITY" >/dev/null 2>&1; then
  st=$(stat -c %a "$QHOME/.config/stellar" 2>/dev/null || echo missing)
  if [ "$st" = 700 ]; then pass AT-23 "stellar-cli identity $IDENTITY exists, its store closed to others (700)"; else fail AT-23 "~qwatt/.config/stellar is mode $st, not 700: sudo chmod -R go-rwx ~qwatt/.config/stellar"; fi
  if sudo -u qwatt -H sh -c "stellar keys address $OTHER_IDENTITY" >/dev/null 2>&1; then fail AT-24 "the other role's identity $OTHER_IDENTITY is on this host"; else pass AT-24 "the other role's identity ($OTHER_IDENTITY) is not here"; fi
  if [ -e "$CONF/anchor.json" ]; then
    check AT-25 "keys.js check: $IDENTITY signs offline and is a weight-1 signer of the account in anchor.json" sudo -u qwatt -H /usr/bin/node "$REPO/anchor/keys.js" check --sign-with-key "$IDENTITY" --account "$(/usr/bin/node -p "require('$CONF/anchor.json').anchor_account")" --config "$CONF/anchor.json"
  else
    check AT-25 "keys.js check: $IDENTITY signs offline (no anchor.json yet: account not checked)" sudo -u qwatt -H /usr/bin/node "$REPO/anchor/keys.js" check --sign-with-key "$IDENTITY"
  fi
else
  wait_ AT-23 "no stellar-cli identity $IDENTITY yet (the holder generates it in their own terminal: README)"
fi

running=""
for u in $UNITS; do systemctl is-active --quiet "$u" && running="$running $u"; done
echo "      ·      running:${running:- none} (AT-26, reboot and kill, is checked by hand)"

echo
if [ $fails -eq 0 ]; then echo "no FAIL"; exit 0; else echo "$fails FAIL"; exit 1; fi
