Set-StrictMode -Version Latest
$script:JarvisScriptsDirectory = $PSScriptRoot

function Get-JarvisRepositoryRoot {
  return [System.IO.Path]::GetFullPath((Join-Path $script:JarvisScriptsDirectory ".."))
}

function Get-JarvisDataDirectory {
  param([string]$Override = "")

  if ($Override) {
    return [System.IO.Path]::GetFullPath($Override)
  }
  if (-not $env:LOCALAPPDATA) {
    throw "LOCALAPPDATA is unavailable. Pass -DataDirectory explicitly."
  }
  return Join-Path $env:LOCALAPPDATA "AcademicJarvis"
}

function Protect-JarvisFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $null = & icacls.exe $Path "/inheritance:r" "/grant:r" "${identity}:(F)" "/Q"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not restrict file permissions for $Path. icacls exited with code $LASTEXITCODE."
  }
}

function ConvertTo-JarvisEnvValue {
  param([Parameter(Mandatory = $true)][string]$Value)

  return '"' + $Value.Replace('"', '\"') + '"'
}

function Update-JarvisEnvironmentFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Values,
    [string]$Header = ""
  )

  [string[]]$existingLines = @()
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    $existingLines = @(Get-Content -LiteralPath $Path)
  }
  $written = @{}
  $output = New-Object System.Collections.Generic.List[string]
  if ($existingLines.Length -eq 0 -and $Header) {
    $output.Add($Header)
  }

  foreach ($line in $existingLines) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
      $key = $Matches[1]
      if ($Values.Contains($key)) {
        if (-not $written.ContainsKey($key)) {
          $output.Add("$key=$($Values[$key])")
          $written[$key] = $true
        }
        continue
      }
    }
    $output.Add($line)
  }

  foreach ($key in $Values.Keys) {
    if (-not $written.ContainsKey($key)) {
      $output.Add("$key=$($Values[$key])")
    }
  }

  [System.IO.File]::WriteAllLines($Path, $output, (New-Object System.Text.UTF8Encoding($false)))
}

function Assert-JarvisNodeVersion {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node.js is not installed or node.exe is not on PATH. Install Node.js 22.13 or newer."
  }

  $versionText = (& $nodeCommand.Source --version).TrimStart("v")
  $version = [version]$versionText
  if ($version -lt [version]"22.13.0") {
    throw "Node.js $version is too old. Academic Jarvis requires Node.js 22.13 or newer."
  }
  return $nodeCommand.Source
}
