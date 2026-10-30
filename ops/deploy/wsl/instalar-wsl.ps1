# QWATT — keep WSL running on the verifier PC, with no window open and after a reboot with nobody
# signed in (plan W2-5; ops/deploy/host/README.md, AT-10 to AT-13 and AT-26)
# ---------------------------------------------------------------------------------------------
# Run once, in Windows PowerShell opened as administrator, on the verifier PC itself:
#   powershell -ExecutionPolicy Bypass -File \\wsl$\<distro>\opt\qwatt\ops\deploy\wsl\instalar-wsl.ps1 [-Distro Ubuntu-26.04]
#
# It does three things and changes nothing else:
#   1. %UserProfile%\.wslconfig from wslconfig.example, only if that file does not exist yet
#      (no idle shutdown of WSL, memory cap; Q14);
#   2. a scheduled task "QWATT WSL" that starts the distribution at boot and every 5 minutes if it
#      is not running, whether or not anyone is signed in (LogonType Password: Windows asks for
#      YOUR Windows password once, in its own prompt, and keeps it; it is never written to a file).
#      Its action is `wsl.exe -d <distro> --exec /usr/bin/sleep infinity`: one process that keeps
#      the distribution, and with it systemd and the QWATT services, alive;
#   3. power on AC: never sleep, never hibernate.
# Windows Update pause, Store auto-updates and the BIOS "restore on AC power loss" stay manual
# (README, "On the Windows side").

param(
  [string]$Distro = '',
  [string]$TaskName = 'QWATT WSL'
)
$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Open Windows PowerShell as administrator and run this again.' }

# the distribution: the one given, else the only Ubuntu installed
$names = (& wsl.exe -l -q) -replace "`0", '' | Where-Object { $_.Trim() } | ForEach-Object { $_.Trim() }
if (-not $Distro) {
  $ubuntu = @($names | Where-Object { $_ -like 'Ubuntu*' })
  if ($ubuntu.Count -ne 1) { throw "Name the distribution with -Distro (installed: $($names -join ', '))" }
  $Distro = $ubuntu[0]
}
if ($names -notcontains $Distro) { throw "No WSL distribution named $Distro (installed: $($names -join ', '))" }
Write-Host "distribution: $Distro"

# 1. .wslconfig
$cfg = Join-Path $env:USERPROFILE '.wslconfig'
$example = Join-Path $PSScriptRoot 'wslconfig.example'
if (Test-Path $cfg) {
  Write-Host "kept $cfg (it exists). It must say vmIdleTimeout=-1 and a memory= cap under [wsl2]; compare with $example"
} else {
  Copy-Item $example $cfg
  Write-Host "wrote $cfg"
}

# 2. the task: at startup, and every 5 minutes; a second copy is never started while one runs
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wsl.exe" -Argument "-d $Distro --exec /usr/bin/sleep infinity"
$atBoot = New-ScheduledTaskTrigger -AtStartup
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$user = "$env:USERDOMAIN\$env:USERNAME"
# The password first: Windows refuses a "run whether or not anyone is signed in" task registered
# without it (0x8007052E). Register-ScheduledTask gets -User and -Password and stores them itself.
Write-Host "Windows now asks for the password of $user, so the task can run with nobody signed in."
$cred = Get-Credential -UserName $user -Message "Your Windows password (stored by Task Scheduler for '$TaskName' only)"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($atBoot, $every5) -Settings $settings -RunLevel Limited `
  -User $cred.UserName -Password $cred.GetNetworkCredential().Password `
  -Description 'QWATT verifier host: keeps the WSL distribution (systemd and the QWATT services) running with nobody signed in.' | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "task '$TaskName' registered and started"

# 3. power on AC
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /hibernate off
Write-Host 'power on AC: never sleeps, never hibernates'

Write-Host ''
Write-Host 'Next: close every Ubuntu window, wait 2 minutes, then in a new window run'
Write-Host '  sudo bash /opt/qwatt/ops/deploy/host/check.sh --role verifier'
Write-Host 'AT-11 must PASS. Then reboot and do not sign in for 5 minutes (AT-12, README).'
