[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$SkipDependencies,
  [switch]$SkipIam,
  [switch]$SkipToken,
  [string]$DataDirectory = "",
  [string]$DashboardUrl = "https://academic-jarvis.darius-ferent.chatgpt.site"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-common.ps1")

if ($env:OS -ne "Windows_NT") {
  throw "This bootstrap is for Windows. Use the worker README or Compose setup on other systems."
}

$repositoryRoot = Get-JarvisRepositoryRoot
$workerRoot = Join-Path $repositoryRoot "apps\worker"
$workerPackage = Join-Path $workerRoot "package.json"
if (-not (Test-Path -LiteralPath $workerPackage -PathType Leaf)) {
  throw "Academic Jarvis worker files are missing under $workerRoot. Run this script from a complete repository clone."
}

$node = Assert-JarvisNodeVersion
$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
$npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npm -or -not $npx) {
  throw "npm.cmd and npx.cmd are required. Repair the Node.js installation and retry."
}

$dataRoot = Get-JarvisDataDirectory -Override $DataDirectory
$configFile = Join-Path $dataRoot "worker.env"
$tokenFile = Join-Path $dataRoot "worker_token"
$credentialFile = Join-Path $dataRoot "iam-credential.dpapi.json"
$profileDirectory = Join-Path $dataRoot "browser-profile"
$stateDirectory = Join-Path $dataRoot "work"
$schoolFilesDirectory = Join-Path $dataRoot "school-files"
$logDirectory = Join-Path $dataRoot "logs"

Write-Host "Academic Jarvis Windows setup"
Write-Host "Repository: $repositoryRoot"
Write-Host "Private data: $dataRoot"
Write-Host "Node: $((& $node --version).Trim())"

if ($CheckOnly) {
  Write-Host "Preflight passed. No files or dependencies were changed."
  return
}

foreach ($directory in @($dataRoot, $profileDirectory, $stateDirectory, $schoolFilesDirectory, $logDirectory)) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$environmentValues = [ordered]@{
  JARVIS_DASHBOARD_URL = ConvertTo-JarvisEnvValue $DashboardUrl
  JARVIS_WORKER_TOKEN_FILE = ConvertTo-JarvisEnvValue $tokenFile
  JARVIS_IAM_DPAPI_FILE = ConvertTo-JarvisEnvValue $credentialFile
  JARVIS_ALLOW_PASSWORD_LOGIN = "true"
  JARVIS_BROWSER_PROFILE_DIR = ConvertTo-JarvisEnvValue $profileDirectory
  JARVIS_STATE_DIR = ConvertTo-JarvisEnvValue $stateDirectory
  JARVIS_SCHOOL_FILES_DIR = ConvertTo-JarvisEnvValue $schoolFilesDirectory
  JARVIS_TIMEZONE = "Europe/Luxembourg"
  JARVIS_SYNC_INTERVAL_MINUTES = "30"
  JARVIS_AGENT_POLL_SECONDS = "60"
}
Update-JarvisEnvironmentFile -Path $configFile -Values $environmentValues -Header "# Academic Jarvis local worker configuration. This file contains paths and settings, not passwords or tokens."
Protect-JarvisFile -Path $configFile
Write-Host "Saved persistent non-secret configuration at $configFile"

if (-not $SkipDependencies) {
  Push-Location $workerRoot
  try {
    Write-Host "Installing worker dependencies..."
    & $npm.Source ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
    Write-Host "Installing Playwright Chromium..."
    & $npx.Source playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw "Playwright Chromium installation failed with exit code $LASTEXITCODE." }
  } finally {
    Pop-Location
  }
}

if (-not $SkipIam) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $workerRoot "scripts\setup-iam-credentials.ps1") -TargetFile $credentialFile
  if ($LASTEXITCODE -ne 0) { throw "IAM credential setup did not complete." }
}

if (-not $SkipToken) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "setup-worker-token.ps1") -TargetFile $tokenFile
  if ($LASTEXITCODE -ne 0) { throw "Worker-token setup did not complete." }
}

$env:JARVIS_CONFIG_FILE = $configFile
Push-Location $workerRoot
try {
  & $node (Join-Path $workerRoot "src\entry.mjs") doctor --offline
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Next: .\scripts\jarvis.ps1 auth webuntis -Headed"
Write-Host "After WebUntis opens successfully: .\scripts\jarvis.ps1 health all"
Write-Host "Start the worker now: .\scripts\jarvis.ps1 start"
Write-Host "Start it automatically at sign-in: .\scripts\jarvis.ps1 install"
