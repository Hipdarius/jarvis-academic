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
  Join-Path $dataRoot "sites_bypass_token"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
Write-Host "Enter the private Sites API bypass token below."
Write-Host "The token is hidden while you type and is stored only in a user-protected local file."
$secureToken = Read-Host "Sites bypass token" -AsSecureString
$pointer = [IntPtr]::Zero
try {
  $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  $token = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ($token -notmatch '^[A-Za-z0-9_-]{32,256}$') {
    throw "That does not look like a Sites bypass token."
  }
  [System.IO.File]::WriteAllText($target, $token, (New-Object System.Text.UTF8Encoding($false)))
} finally {
  if ($pointer -ne [IntPtr]::Zero) {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
  Remove-Variable token -ErrorAction SilentlyContinue
}

Protect-JarvisFile -Path $target
Write-Host "Sites bypass token saved in a user-only file at $target"
