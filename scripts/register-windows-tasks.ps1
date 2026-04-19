# Register India Earnings Tracker scheduled tasks on Windows.
# ---------------------------------------------------------------------------
# Run ONCE as the user who should own the tasks (NOT elevated/admin unless
# you want the task to run as SYSTEM):
#     powershell -ExecutionPolicy Bypass -File scripts\register-windows-tasks.ps1
#
# Creates three tasks under "\India Earnings Tracker\":
#   - Daily      → 08:00 IST  (02:30 UTC)  Mon–Fri
#   - Hourly     → every 30 min, 09:30–21:30 IST  Mon–Fri
#   - Backfill   → Sunday 23:30 IST

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir
$cronScript = Join-Path $scriptDir "cron.ps1"
$folder = "\India Earnings Tracker\"

function New-IET-Task {
    param(
        [string]$Name,
        [string]$Mode,
        [Microsoft.Management.Infrastructure.CimInstance[]]$Triggers
    )
    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-ExecutionPolicy Bypass -NoProfile -File `"$cronScript`" -Mode $Mode" `
        -WorkingDirectory $appDir

    $principal = New-ScheduledTaskPrincipal `
        -UserId $env:USERNAME `
        -LogonType S4U

    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

    $task = New-ScheduledTask -Action $action -Trigger $Triggers -Principal $principal -Settings $settings

    Register-ScheduledTask -TaskName $Name -TaskPath $folder -InputObject $task -Force | Out-Null
    Write-Host "  [ok] $folder$Name"
}

Write-Host "Registering India Earnings Tracker tasks..." -ForegroundColor Cyan

# Task 1: Daily — refreshes calendars at 08:00 IST Mon-Fri.
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At "08:00" -DaysInterval 1
# Restrict to weekdays via a second trigger filter:
$dailyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "08:00"
New-IET-Task -Name "daily-calendars" -Mode "daily" -Triggers @($dailyTrigger)

# Task 2: Hourly sweep every 30 min during the announcement window.
$hourlyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At "09:30"
$hourlyTrigger.Repetition = New-ScheduledTaskTrigger `
    -Once -At "09:30" `
    -RepetitionInterval (New-TimeSpan -Minutes 30) `
    -RepetitionDuration (New-TimeSpan -Hours 12) | Select-Object -ExpandProperty Repetition
New-IET-Task -Name "hourly-results" -Mode "hourly" -Triggers @($hourlyTrigger)

# Task 3: Weekly backfill Sunday night.
$backfillTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "23:30"
New-IET-Task -Name "weekly-backfill" -Mode "backfill" -Triggers @($backfillTrigger)

Write-Host ""
Write-Host "Done. To verify, run:  Get-ScheduledTask -TaskPath '$folder'" -ForegroundColor Green
Write-Host "To remove all:         Unregister-ScheduledTask -TaskPath '$folder' -Confirm:`$false" -ForegroundColor DarkGray
