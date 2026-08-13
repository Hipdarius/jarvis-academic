[CmdletBinding()]
param(
  [string]$TargetFile = "",
  [string]$DataDirectory = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-common.ps1")

$dataRoot = Get-JarvisDataDirectory -Override $DataDirectory
$target = if ($TargetFile) {
  [System.IO.Path]::GetFullPath($TargetFile)
} else {
  Join-Path $dataRoot "worker_token"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
Write-Host "Create a one-time worker token in Jarvis > Systems, then enter it below."
Write-Host "The token is hidden while you type and is never sent anywhere by this setup script."
$secureToken = Read-Host "Worker token" -AsSecureString
$pointer = [IntPtr]::Zero
try {
  $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $token = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ($token -notmatch '^jrv_[A-Za-z0-9_-]{32,96}$') {
    throw "That does not look like an Academic Jarvis worker token. Create a fresh token in Jarvis > Systems."
  }
  [System.IO.File]::WriteAllText($target, $token, (New-Object System.Text.UTF8Encoding($false)))
} finally {
  if ($pointer -ne [IntPtr]::Zero) {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
  Remove-Variable token -ErrorAction SilentlyContinue
}

Protect-JarvisFile -Path $target
Write-Host "Worker token saved in a user-only file at $target"
