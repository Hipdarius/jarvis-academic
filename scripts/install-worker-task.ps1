[CmdletBinding()]
param(
  [switch]$Remove,
  [switch]$Status
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "windows-common.ps1")

if ($env:OS -ne "Windows_NT") {
  throw "The background worker task is only supported on Windows."
}

$taskName = "Academic Jarvis Worker"
$repositoryRoot = Get-JarvisRepositoryRoot
$launcher = Join-Path $PSScriptRoot "jarvis.ps1"
$service = New-Object -ComObject "Schedule.Service"
$service.Connect()
$folder = $service.GetFolder("\")

if ($Status) {
  try {
    $task = $folder.GetTask($taskName)
    Write-Host "Academic Jarvis background task is installed. State: $($task.State)"
  } catch {
    Write-Host "Academic Jarvis background task is not installed."
  }
  return
}

if ($Remove) {
  try {
    $folder.DeleteTask($taskName, 0)
    Write-Host "Removed the Academic Jarvis background task. Local credentials and worker data were not deleted."
  } catch {
    Write-Host "Academic Jarvis background task was not installed."
  }
  return
}

$definition = $service.NewTask(0)
$definition.RegistrationInfo.Description = "Starts the private Academic Jarvis school worker when Darius signs in."
$definition.Settings.Enabled = $true
$definition.Settings.Hidden = $true
$definition.Settings.StartWhenAvailable = $true
$definition.Settings.DisallowStartIfOnBatteries = $false
$definition.Settings.StopIfGoingOnBatteries = $false
$definition.Settings.ExecutionTimeLimit = "PT0S"
$definition.Settings.MultipleInstances = 2

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$definition.Principal.UserId = $currentUser
$definition.Principal.LogonType = 3
$definition.Principal.RunLevel = 0

$trigger = $definition.Triggers.Create(9)
$trigger.Enabled = $true
$trigger.UserId = $currentUser

$action = $definition.Actions.Create(0)
$action.Path = (Get-Command powershell.exe).Source
$action.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" start -Background"
$action.WorkingDirectory = $repositoryRoot

$null = $folder.RegisterTaskDefinition($taskName, $definition, 6, $currentUser, $null, 3, $null)
Write-Host "Installed the Academic Jarvis background task for $currentUser."
Write-Host "It will start at the next Windows sign-in. Check it with .\scripts\jarvis.ps1 status"
