# Host package (plan W2-5)

Installs one host of the live run from a git checkout of the commit to deploy, the same way on the
proposer host (a Linux VPS) and on the verifier host (Jay's PC: Ubuntu in WSL2). It follows
`docs/RUNBOOK.md`, setup steps 1, 7 and 9, and changes nothing the runbook does not ask for.

| File | Where it runs | What it does |
|---|---|---|
| `install.sh` | the host, as root | Node 24.14.1 at `/usr/bin/node`, stellar-cli 28.1.0, user `qwatt`, the role's units and env files, its deploy key, GitHub's pinned host key, no automatic upgrades (Q5) |
| `check.sh` | the host, as root | the automated acceptance tests below: PASS, FAIL, or WAIT for a later step |
| `../wsl/instalar-wsl.ps1` | Windows, as administrator (verifier PC only) | `.wslconfig` (no idle shutdown, memory cap), the task that keeps WSL running with nobody signed in, no sleep on AC |
| `../wsl/wslconfig.example` | — | the `.wslconfig` it writes |

Neither script generates, reads or prints a stellar-cli key. Each holder generates theirs in
their own terminal, never over screen sharing, and sends only the `G…` line (RUNBOOK, step 2).

## Install

On either host, with the commit both hosts run (the same commit on both):

```bash
sudo git clone https://github.com/academiaseul/qwatt /opt/qwatt
sudo git -C /opt/qwatt checkout --detach <commit>
sudo bash /opt/qwatt/ops/deploy/host/install.sh --role proposer --commit <commit>   # or --role verifier
```

It prints the deploy key's `.pub` line (send it to Jay; he adds it with write access: the
proposer host's on `qwatt-evidence`, the verifier host's on `qwatt-verifier-log`) and the
stellar-cli commands for the holder. Then:

```bash
sudo bash /opt/qwatt/ops/deploy/host/check.sh --role proposer --commit <commit>      # or --role verifier
```

To move a host to a new commit: `sudo git -C /opt/qwatt fetch && sudo git -C /opt/qwatt checkout --detach <new>`,
run `install.sh` again with `--commit <new>` (it keeps env files, keys and state), then restart
the services. A unit file that changed is copied again by `install.sh`.

### On the Windows side (verifier PC)

1. WSL2 with Ubuntu, then the Linux install above inside it. `install.sh` turns systemd on in
   `/etc/wsl.conf`; the first time it stops and asks for `wsl --shutdown`.
2. In Windows PowerShell as administrator:
   `powershell -ExecutionPolicy Bypass -File \\wsl$\<distro>\opt\qwatt\ops\deploy\wsl\instalar-wsl.ps1`.
   Windows asks for your Windows password once, in its own prompt, so the task runs with nobody
   signed in. The task keeps one `sleep infinity` running in the distribution, which keeps WSL,
   systemd and the services alive with no window open.
3. By hand, and checked again on Fri 6 Nov: Windows Update paused (5 weeks, to about 1 Dec),
   Microsoft Store auto-updates off (a Store update of WSL stops the running distribution),
   BIOS/UEFI "restore on AC power loss" = on, and the PC on Ethernet and a UPS if possible.

### After the run (RECONCILED)

Undo the update guard: `sudo rm /etc/apt/apt.conf.d/99qwatt-no-auto-upgrade /etc/needrestart/conf.d/99qwatt.conf`,
`sudo systemctl enable --now apt-daily-upgrade.timer unattended-upgrades.service`; unpause Windows
Update; optionally remove the task `QWATT WSL`.

## Acceptance tests

`auto` rows are run by `check.sh` (a WAIT means a later setup step has not happened yet). `hand`
rows are done once by the host's operator and written down with the date. **AT-11, AT-12 and AT-13
decide the verifier platform:** if one fails on the verifier PC and cannot be fixed, choose the
fallback (sign in after a power cut, or a small Linux VPS with another provider) before the
verifier key is generated (RUNBOOK; the account cannot change a signer later without all three keys).

| AT | Check | How | When |
|---|---|---|---|
| AT-1 | Ubuntu on x86_64 | auto | install |
| AT-2 | systemd is PID 1 | auto | install |
| AT-3 | `/usr/bin/node -v` prints `v24.14.1`, the tarball checked against its official SHA-256 | auto | install |
| AT-4 | `stellar version --only-version` prints `28.1.0` for user `qwatt`, the tarball checked against SHA-256 `c1680deee94301d33ada7a17f98411e642a4248c727afbd2e43050d345746462` | auto | install |
| AT-5 | user `qwatt` exists with no login shell | auto | install |
| AT-6 | `/opt/qwatt` is the commit given, with no local changes (the run publishes it as `code_commit`) | auto | install |
| AT-7 | user `qwatt` can read that commit (git `safe.directory`) and `anchor/` dependencies are installed | auto | install |
| AT-8 | the clock is within 10 s of Horizon (the services refuse to sign at 120 s) | auto | install, then daily |
| AT-9 | no automatic upgrade and no automatic service restart (Q5) | auto | install |
| AT-10 | WSL: systemd on in `/etc/wsl.conf` | auto | install |
| AT-11 | WSL: with every Ubuntu window closed for 2 minutes, the task's keepalive is still running (`check.sh` in a new window) | auto | install |
| AT-12 | WSL: reboot Windows and do not sign in for 5 minutes, noting the time. Then sign in and, in Ubuntu, `uptime -s` shows the distribution started at least 4 minutes before you signed in (once the services run, `journalctl -b -u qwatt-verifier` also shows ticks from before) | hand | install |
| AT-13 | WSL: sign out of Windows (not shut down) for 5 minutes, sign in; `uptime -s` shows the distribution never stopped | hand | install |
| AT-14 | this role's units are installed, identical to `ops/deploy` | auto | install |
| AT-15 | the other role's units are not on this host | auto | install |
| AT-16 | this role's env files exist, mode 600, owner root | auto | install |
| AT-17 | the env files are filled in (no `G...`, `rehearsal-YYYY-MM-DD` or `<…>` left) | auto | before start |
| AT-18 | no env file holds a secret | auto | before start |
| AT-19 | GitHub's host key pinned for `qwatt` on its published ED25519 fingerprint | auto | install |
| AT-20 | this role's deploy key exists, the private file 600 owned by `qwatt` | auto | install |
| AT-21 | the other host's deploy key is not here | auto | install |
| AT-22 | GitHub greets the deploy key (`Hi academiaseul/<repository>!`): Jay added it with write access | auto | after Jay adds it |
| AT-23 | the holder's stellar-cli identity exists and its store is closed to others (700) | auto | after the holder's step |
| AT-24 | the other role's identity is not on this host | auto | after the holder's step |
| AT-25 | `keys.js check` signs offline; with `/etc/qwatt/anchor.json`, a weight-1 signer of the account | auto | after the account |
| AT-26 | with the services running: reboot without signing in, then `sudo systemctl kill qwatt-verifier` (or `qwatt-proposer`): each comes back by itself, and the verifier log (or the feed) moves on within 10 minutes | hand | during the soak |

## Decisions this package takes, and where they can change

- **Node 24.14.1** (decision 1): the same exact version in CI (`node-version` in
  `.github/workflows/conformance.yml`) and on both hosts. Changing it is `NODE_VERSION` and
  `NODE_SHA256` in `install.sh`, AT-3 and the CI pin together: `ops/host-package.test.js` fails
  while they disagree. No runtime change after the freeze.
- **Memory cap 3 GB** for WSL (Q14): `wslconfig.example`.
- **Update guard** until RECONCILED (Q5): undone as above.
