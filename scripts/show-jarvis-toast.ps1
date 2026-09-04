$ErrorActionPreference = "Stop"

$payload = ($input | Out-String | ConvertFrom-Json)
if (-not $payload.title -or -not $payload.body) { exit 1 }

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$escape = { param([string]$Value) [System.Security.SecurityElement]::Escape($Value) }
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$title = & $escape ([string]$payload.title).Substring(0, [Math]::Min(200, ([string]$payload.title).Length))
$body = & $escape ([string]$payload.body).Substring(0, [Math]::Min(500, ([string]$payload.body).Length))
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$body</text></binding></visual></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Microsoft.WindowsPowerShell").Show($toast)
