<#
.SYNOPSIS
  Measures RAM and CPU usage of Nook and its helper processes.

.DESCRIPTION
  Samples Nook processes and the helper process every 10 seconds (or chosen interval)
  for a given duration, calculating Working Set, Private Bytes, and CPU usage as a
  share of one core.

.PARAMETER DurationSeconds
  Total duration to measure in seconds. Default is 600 (10 minutes).

.PARAMETER IntervalSeconds
  Sampling interval in seconds. Default is 10.

.PARAMETER OutJson
  Optional path to export measured summary as JSON.
#>
param(
    [int]$DurationSeconds = 600,
    [int]$IntervalSeconds = 10,
    [string]$OutJson = ""
)

function Get-NookProcMap {
    # Returns a hashtable: PID -> @{ Type = '...'; Name = '...'; Cmd = '...' }
    $cimProcs = Get-CimInstance Win32_Process
    $map = @{}

    # Find main nook process first
    $mainPids = @()
    foreach ($p in $cimProcs) {
        $cmd = if ($p.CommandLine) { $p.CommandLine } else { "" }
        $isMainNook = ($p.Name -in @('Nook.exe', 'poni.exe') -and $cmd -notmatch '--type=') -or
                      ($p.Name -eq 'electron.exe' -and $cmd -like '*poni*' -and $cmd -notmatch '--type=')
        if ($isMainNook) {
            $mainPids += $p.ProcessId
            $map[$p.ProcessId] = @{
                Type = 'main'
                Name = $p.Name
                Cmd  = $cmd
            }
        }
    }

    # Find children and helpers
    foreach ($p in $cimProcs) {
        if ($map.ContainsKey($p.ProcessId)) { continue }
        $cmd = if ($p.CommandLine) { $p.CommandLine } else { "" }

        if ($cmd -like '*helper.ps1*' -or $p.Name -eq 'helper.exe') {
            $map[$p.ProcessId] = @{
                Type = 'PowerShell helper'
                Name = $p.Name
                Cmd  = $cmd
            }
            continue
        }

        $isElectronChild = ($p.Name -in @('Nook.exe', 'poni.exe', 'electron.exe')) -and
                           ($mainPids -contains $p.ParentProcessId -or $cmd -like '*build_workspaces\poni*' -or $cmd -like '*\Programs\Nook\*')

        if ($isElectronChild) {
            $type = 'other'
            if ($cmd -match '--type=([^\s]+)') {
                $raw = $matches[1]
                if ($raw -eq 'gpu-process') {
                    $type = 'gpu-process'
                } elseif ($raw -eq 'renderer') {
                    $type = 'renderer'
                } elseif ($raw -eq 'utility') {
                    if ($cmd -match '--utility-sub-type=([^\s]+)' -and $matches[1] -like '*network*') {
                        $type = 'network utility'
                    } else {
                        $type = 'utility'
                    }
                } elseif ($raw -eq 'crashpad-handler') {
                    $type = 'crashpad'
                } else {
                    $type = $raw
                }
            }
            $map[$p.ProcessId] = @{
                Type = $type
                Name = $p.Name
                Cmd  = $cmd
            }
        }
    }
    return $map
}

Write-Host "Looking for Nook and helper processes..." -ForegroundColor Cyan
$initialMap = Get-NookProcMap

if ($initialMap.Count -eq 0) {
    Write-Warning "No Nook or helper processes found running! Start Nook first (e.g. run.bat or installed app)."
    exit 1
}

Write-Host "Found $($initialMap.Count) processes:" -ForegroundColor Green
foreach ($kv in $initialMap.GetEnumerator()) {
    Write-Host "  PID $($kv.Key): $($kv.Value.Type) ($($kv.Value.Name))"
}

Write-Host "`nSampling every $IntervalSeconds s for $DurationSeconds s total..." -ForegroundColor Cyan

$samples = @()
$procCpuHistory = @{} # PID -> @{ LastTime = DateTime; LastCpu = double }

# Take initial CPU snapshot
$now = [DateTime]::UtcNow
foreach ($pidNum in $initialMap.Keys) {
    try {
        $p = Get-Process -Id $pidNum -ErrorAction Stop
        $procCpuHistory[$pidNum] = @{
            Time = $now
            Cpu  = $p.TotalProcessorTime.TotalSeconds
        }
    } catch {}
}

$startTime = [DateTime]::UtcNow
$endTime = $startTime.AddSeconds($DurationSeconds)
$sampleIndex = 0

while ([DateTime]::UtcNow -lt $endTime) {
    Start-Sleep -Seconds $IntervalSeconds
    $now = [DateTime]::UtcNow
    $elapsed = ($now - $startTime).TotalSeconds
    $sampleIndex++

    # Re-scan processes in case any restarted
    $currentMap = Get-NookProcMap

    # Collect stats for this sample
    $sampleData = @{
        Timestamp = $now
        Elapsed   = [Math]::Round($elapsed, 1)
        Processes = @{}
    }

    $totalWs = 0.0
    $totalPriv = 0.0
    $totalCpu = 0.0

    foreach ($pidNum in $currentMap.Keys) {
        $type = $currentMap[$pidNum].Type
        try {
            $p = Get-Process -Id $pidNum -ErrorAction Stop
            $wsMb = [Math]::Round($p.WorkingSet64 / 1MB, 2)
            $privMb = [Math]::Round($p.PrivateMemorySize64 / 1MB, 2)
            $cpuSec = $p.TotalProcessorTime.TotalSeconds

            $cpuPercent = 0.0
            if ($procCpuHistory.ContainsKey($pidNum)) {
                $last = $procCpuHistory[$pidNum]
                $dt = ($now - $last.Time).TotalSeconds
                $dcpu = $cpuSec - $last.Cpu
                if ($dt -gt 0 -and $dcpu -ge 0) {
                    $cpuPercent = [Math]::Round(($dcpu / $dt) * 100.0, 2)
                }
            }
            $procCpuHistory[$pidNum] = @{ Time = $now; Cpu = $cpuSec }

            $totalWs += $wsMb
            $totalPriv += $privMb
            $totalCpu += $cpuPercent

            if (-not $sampleData.Processes.ContainsKey($type)) {
                $sampleData.Processes[$type] = @{
                    WorkingSetMB = 0.0
                    PrivateMB    = 0.0
                    CpuPercent   = 0.0
                    Count        = 0
                }
            }
            $sampleData.Processes[$type].WorkingSetMB += $wsMb
            $sampleData.Processes[$type].PrivateMB    += $privMb
            $sampleData.Processes[$type].CpuPercent   += $cpuPercent
            $sampleData.Processes[$type].Count++
        } catch {
            # Process may have exited
        }
    }

    $sampleData.Total = @{
        WorkingSetMB = [Math]::Round($totalWs, 2)
        PrivateMB    = [Math]::Round($totalPriv, 2)
        CpuPercent   = [Math]::Round($totalCpu, 2)
    }
    $samples += $sampleData

    $timeStr = "{0:D2}:{1:D2} / {2:D2}:{3:D2}" -f `
        [int]($elapsed / 60), ([int]$elapsed % 60), `
        [int]($DurationSeconds / 60), ($DurationSeconds % 60)

    Write-Host "[$timeStr] Total WS: $($sampleData.Total.WorkingSetMB) MB | Priv: $($sampleData.Total.PrivateMB) MB | CPU (1 core): $($sampleData.Total.CpuPercent)%"
}

# Aggregate results across all samples
$types = @('main', 'gpu-process', 'network utility', 'renderer', 'PowerShell helper')
# Find any additional types that were present
foreach ($s in $samples) {
    foreach ($t in $s.Processes.Keys) {
        if ($types -notcontains $t) { $types += $t }
    }
}

$summaryTable = @()

foreach ($t in $types) {
    $wsValues = @()
    $privValues = @()
    $cpuValues = @()

    foreach ($s in $samples) {
        if ($s.Processes.ContainsKey($t)) {
            $wsValues += $s.Processes[$t].WorkingSetMB
            $privValues += $s.Processes[$t].PrivateMB
            $cpuValues += $s.Processes[$t].CpuPercent
        }
    }

    if ($wsValues.Count -gt 0) {
        $avgWs = [Math]::Round(($wsValues | Measure-Object -Average).Average, 1)
        $peakWs = [Math]::Round(($wsValues | Measure-Object -Maximum).Maximum, 1)
        $avgPriv = [Math]::Round(($privValues | Measure-Object -Average).Average, 1)
        $peakPriv = [Math]::Round(($privValues | Measure-Object -Maximum).Maximum, 1)
        $avgCpu = [Math]::Round(($cpuValues | Measure-Object -Average).Average, 2)
        $peakCpu = [Math]::Round(($cpuValues | Measure-Object -Maximum).Maximum, 2)

        $summaryTable += [PSCustomObject]@{
            Process     = $t
            AvgWS_MB    = $avgWs
            PeakWS_MB   = $peakWs
            AvgPriv_MB  = $avgPriv
            PeakPriv_MB = $peakPriv
            AvgCpu_1c   = $avgCpu
            PeakCpu_1c  = $peakCpu
        }
    }
}

# Total aggregate
$totWsValues = $samples | ForEach-Object { $_.Total.WorkingSetMB }
$totPrivValues = $samples | ForEach-Object { $_.Total.PrivateMB }
$totCpuValues = $samples | ForEach-Object { $_.Total.CpuPercent }

$totSummary = [PSCustomObject]@{
    Process     = 'TOTAL'
    AvgWS_MB    = [Math]::Round(($totWsValues | Measure-Object -Average).Average, 1)
    PeakWS_MB   = [Math]::Round(($totWsValues | Measure-Object -Maximum).Maximum, 1)
    AvgPriv_MB  = [Math]::Round(($totPrivValues | Measure-Object -Average).Average, 1)
    PeakPriv_MB = [Math]::Round(($totPrivValues | Measure-Object -Maximum).Maximum, 1)
    AvgCpu_1c   = [Math]::Round(($totCpuValues | Measure-Object -Average).Average, 2)
    PeakCpu_1c  = [Math]::Round(($totCpuValues | Measure-Object -Maximum).Maximum, 2)
}
$summaryTable += $totSummary

Write-Host "`n=== MEASUREMENT RESULTS ($DurationSeconds s, $($samples.Count) samples) ===" -ForegroundColor Green
$summaryTable | Format-Table -AutoSize

Write-Host "`nMarkdown Table:" -ForegroundColor Yellow
Write-Host "| Process | Avg Working set | Peak Working set | Avg Private | Peak Private | Avg CPU (1 core) | Peak CPU (1 core) |"
Write-Host "|---|---|---|---|---|---|---|"
foreach ($row in $summaryTable) {
    Write-Host "| $($row.Process) | $($row.AvgWS_MB) MB | $($row.PeakWS_MB) MB | $($row.AvgPriv_MB) MB | $($row.PeakPriv_MB) MB | $($row.AvgCpu_1c)% | $($row.PeakCpu_1c)% |"
}

if ($OutJson) {
    $outObj = @{
        DurationSeconds = $DurationSeconds
        IntervalSeconds = $IntervalSeconds
        SampleCount     = $samples.Count
        Summary         = $summaryTable
        Samples         = $samples
    }
    $outObj | ConvertTo-Json -Depth 5 | Set-Content -Path $OutJson -Encoding UTF8
    Write-Host "`nSaved measurement JSON to $OutJson" -ForegroundColor Green
}
