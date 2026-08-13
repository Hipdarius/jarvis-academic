$ErrorActionPreference = "Stop"

$targetDirectory = Join-Path $env:LOCALAPPDATA "AcademicJarvis"
$targetFile = Join-Path $targetDirectory "iam-credential.dpapi.json"
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

Write-Host "IAM credential saved with Windows DPAPI at $targetFile"
Write-Host "Academic Jarvis can decrypt it only while running as this Windows user."
