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
    $stateNames = @{ 0 = "unknown"; 1 = "disabled"; 2 = "queued"; 3 = "ready"; 4 = "running" }
    $state = if ($stateNames.ContainsKey([int]$task.State)) { $stateNames[[int]$task.State] } else { [string]$task.State }
    Write-Host "Academic Jarvis background task is installed. State: $state"
    Write-Host "Last result: $($task.LastTaskResult)  Last run: $($task.LastRunTime)  Next watchdog: $($task.NextRunTime)"
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
$definition.Settings.RestartCount = 5
$definition.Settings.RestartInterval = "PT1M"

$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$definition.Principal.UserId = $currentUser
$definition.Principal.LogonType = 3
$definition.Principal.RunLevel = 0

$trigger = $definition.Triggers.Create(9)
$trigger.Enabled = $true
$trigger.UserId = $currentUser

# A repeating trigger acts as a watchdog. The scheduler ignores it while the daemon is already running.
$watchdog = $definition.Triggers.Create(2)
$watchdog.Enabled = $true
$watchdog.StartBoundary = (Get-Date).AddMinutes(1).ToString("s")
$watchdog.DaysInterval = 1
$watchdog.Repetition.Interval = "PT15M"
$watchdog.Repetition.Duration = "P1D"
$watchdog.Repetition.StopAtDurationEnd = $false

$action = $definition.Actions.Create(0)
$action.Path = (Get-Command powershell.exe).Source
$action.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" start -Background"
$action.WorkingDirectory = $repositoryRoot

$null = $folder.RegisterTaskDefinition($taskName, $definition, 6, $currentUser, $null, 3, $null)
$registeredTask = $folder.GetTask($taskName)
$null = $registeredTask.Run($null)
Write-Host "Installed the Academic Jarvis background task for $currentUser."
Write-Host "It is starting now, retries up to five times, and is checked every 15 minutes."
Write-Host "Check it with .\scripts\jarvis.ps1 status"
