# India Earnings Tracker - PowerShell cron wrapper (Windows)
# ---------------------------------------------------------------------------
# Called by Task Scheduler. Equivalent of cron.example.sh for Windows hosts.
# Usage:
#   powershell -File scripts/cron.ps1 -Mode daily
#   powershell -File scripts/cron.ps1 -Mode hourly
#   powershell -File scripts/cron.ps1 -Mode backfill

param(
    [Parameter(Position = 0)]
    [ValidateSet("daily", "hourly", "backfill")]
    [string]$Mode = "hourly"
)

$ErrorActionPreference = "Continue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir
Set-Location $appDir

# Load .env (simple KEY=VALUE parser, quotes tolerated).
$envFile = Join-Path $appDir ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match "^[^#].*=" } | ForEach-Object {
        $k, $v = $_ -split "=", 2
        $v = $v.Trim().Trim('"').Trim("'")
        [System.Environment]::SetEnvironmentVariable($k.Trim(), $v, "Process")
    }
}

# Pick python - prefer venv, then `py` launcher, then `python`.
$py = if (Test-Path ".venv\Scripts\python.exe") {
    ".venv\Scripts\python.exe"
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    "py"
} else {
    "python"
}

$logDir = Join-Path $appDir "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("earnings-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

function Append-Log { param($line) "$((Get-Date).ToString('o'))  $line" | Add-Content $logFile }

Append-Log "=== mode=$Mode start ==="

try {
    switch ($Mode) {
        "daily" {
            & $py scripts\nse_calendar.py --include-untracked 2>&1 | Tee-Object -FilePath $logFile -Append
            & $py scripts\bse_calendar.py --include-untracked 2>&1 | Tee-Object -FilePath $logFile -Append
            & $py scripts\moneycontrol_calendar.py            2>&1 | Tee-Object -FilePath $logFile -Append
        }
        "hourly" {
            & $py scripts\nse_results.py           2>&1 | Tee-Object -FilePath $logFile -Append
            & $py scripts\fetch_results.py         2>&1 | Tee-Object -FilePath $logFile -Append
        }
        "backfill" {
            & $py scripts\nse_results.py --all --quarters 2 2>&1 | Tee-Object -FilePath $logFile -Append
            & $py scripts\screener_results.py --missing     2>&1 | Tee-Object -FilePath $logFile -Append
        }
    }
} catch {
    Append-Log ("ERROR: " + $_.Exception.Message)
    exit 1
}

Append-Log "=== done ==="
