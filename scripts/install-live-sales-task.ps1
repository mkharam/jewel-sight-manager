<#
  Installs the "Amarsoft Live Sales" scheduled task on the shop server: amarsoft-sync.ps1 -Watch, which sends a
  branch's new invoice to Jewel Sight Manager seconds after Amarsoft saves it (the 5-minute "Amarsoft Sales Sync"
  task stays as it is). Runs as SYSTEM, starts at boot, and the 5-minute trigger only restarts it if it stopped.
  Run once from an elevated PowerShell. Remove with: Unregister-ScheduledTask 'Amarsoft Live Sales' -Confirm:$false
#>
$script = 'C:\ProgramData\AmarsoftSync\amarsoft-sync.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Watch"
$atBoot = New-ScheduledTaskTrigger -AtStartup
$every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(15) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'Amarsoft Live Sales' -Action $action -Trigger $atBoot, $every5 -Settings $settings -Principal $principal `
    -Description 'Sends a new Amarsoft invoice to Jewel Sight Manager seconds after it is saved (amarsoft-sync.ps1 -Watch).' -Force |
    Select-Object TaskName, State
Start-ScheduledTask 'Amarsoft Live Sales'
