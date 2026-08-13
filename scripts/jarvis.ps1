[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Command = "help",
  [Parameter(Position = 1)][string]$Target = "",
  [switch]$Headed,
  [switch]$Offline,
  [switch]$Json,
  [switch]$Background,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Remaining = @()
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-common.ps1")

function Show-JarvisHelp {
  Write-Host @"
Academic Jarvis commands (run from any folder)

  .\scripts\jarvis.ps1 setup
  .\scripts\jarvis.ps1 doctor [-Offline] [-Json]
  .\scripts\jarvis.ps1 credentials
  .\scripts\jarvis.ps1 token
  .\scripts\jarvis.ps1 sites-token
  .\scripts\jarvis.ps1 login [webuntis|academy|edumoodle|teams]
  .\scripts\jarvis.ps1 auth [source|all] [-Headed]
  .\scripts\jarvis.ps1 health [source|all]
  .\scripts\jarvis.ps1 sync [source|all]
  .\scripts\jarvis.ps1 providers
  .\scripts\jarvis.ps1 agent [triage|planning|research|review] "task"
  .\scripts\jarvis.ps1 jobs
  .\scripts\jarvis.ps1 start
  .\scripts\jarvis.ps1 install
  .\scripts\jarvis.ps1 status
  .\scripts\jarvis.ps1 uninstall

IAM passwords are accepted only by the native DPAPI credential prompt. Worker
tokens are accepted only by the hidden local token prompt. Neither is printed.
"@
}

$repositoryRoot = Get-JarvisRepositoryRoot
$workerRoot = Join-Path $repositoryRoot "apps\worker"
$entry = Join-Path $workerRoot "src\entry.mjs"
$commandName = $Command.ToLowerInvariant()

switch ($commandName) {
  "help" { Show-JarvisHelp; return }
  "setup" { & (Join-Path $PSScriptRoot "setup-windows.ps1"); if (-not $?) { exit 1 }; exit 0 }
  "credentials" {
    $dataRoot = Get-JarvisDataDirectory
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $workerRoot "scripts\setup-iam-credentials.ps1") -TargetFile (Join-Path $dataRoot "iam-credential.dpapi.json")
    exit $LASTEXITCODE
  }
  "token" { & (Join-Path $PSScriptRoot "setup-worker-token.ps1"); if (-not $?) { exit 1 }; exit 0 }
  "sites-token" { & (Join-Path $PSScriptRoot "setup-sites-bypass-token.ps1"); if (-not $?) { exit 1 }; exit 0 }
  "install" { & (Join-Path $PSScriptRoot "install-worker-task.ps1"); if (-not $?) { exit 1 }; exit 0 }
  "status" { & (Join-Path $PSScriptRoot "install-worker-task.ps1") -Status; if (-not $?) { exit 1 }; exit 0 }
  "uninstall" { & (Join-Path $PSScriptRoot "install-worker-task.ps1") -Remove; if (-not $?) { exit 1 }; exit 0 }
}

$node = Assert-JarvisNodeVersion
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) {
  throw "Worker entry point is missing at $entry. Use a complete Academic Jarvis repository clone."
}

$nodeArguments = @($entry)
switch ($commandName) {
  "doctor" {
    $nodeArguments += "doctor"
    if ($Offline) { $nodeArguments += "--offline" }
    if ($Json) { $nodeArguments += "--json" }
  }
  "login" { $nodeArguments += @("login", $(if ($Target) { $Target } else { "webuntis" })) }
  "auth" {
    $nodeArguments += @("auth", $(if ($Target) { $Target } else { "all" }))
    if ($Headed) { $nodeArguments += "--headed" }
  }
  "health" { $nodeArguments += @("health", $(if ($Target) { $Target } else { "all" })) }
  "sync" { $nodeArguments += @("sync", $(if ($Target) { $Target } else { "all" })) }
  "providers" { $nodeArguments += "providers" }
  "agent" { $nodeArguments += @("agent", $(if ($Target) { $Target } else { "planning" })) + $Remaining }
  "jobs" { $nodeArguments += "jobs" }
  "start" { $nodeArguments += "daemon" }
  default { Show-JarvisHelp; throw "Unknown Academic Jarvis command: $Command" }
}

Push-Location $workerRoot
try {
  if ($Background) {
    $dataRoot = Get-JarvisDataDirectory
    $logDirectory = Join-Path $dataRoot "logs"
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    $logFile = Join-Path $logDirectory "worker.log"
    & $node @nodeArguments *>> $logFile
  } else {
    & $node @nodeArguments
  }
  $exitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $exitCode
