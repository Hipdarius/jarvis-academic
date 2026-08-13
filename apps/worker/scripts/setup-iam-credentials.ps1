[CmdletBinding()]
param(
  [string]$TargetFile = ""
)

$ErrorActionPreference = "Stop"

if (-not $env:LOCALAPPDATA -and -not $TargetFile) {
  throw "LOCALAPPDATA is not available. Pass -TargetFile explicitly."
}

$targetFile = if ($TargetFile) {
  [System.IO.Path]::GetFullPath($TargetFile)
} else {
  Join-Path (Join-Path $env:LOCALAPPDATA "AcademicJarvis") "iam-credential.dpapi.json"
}
$targetDirectory = Split-Path -Parent $targetFile
New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null

$credential = Get-Credential -Message "Academic Jarvis IAM login (stored with Windows DPAPI for this Windows account only)"
if (-not $credential) {
  throw "Credential setup was cancelled."
}

$payload = @{
  username = $credential.UserName
  passwordCipher = ConvertFrom-SecureString $credential.Password
}
$payload | ConvertTo-Json | Set-Content -LiteralPath $targetFile -Encoding UTF8

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$null = & icacls.exe $targetFile "/inheritance:r" "/grant:r" "${identity}:(F)" "/Q"
if ($LASTEXITCODE -ne 0) {
  throw "Could not restrict IAM credential file permissions."
}

Write-Host "IAM credential saved with Windows DPAPI at $targetFile"
Write-Host "Academic Jarvis can decrypt it only while running as this Windows user."
