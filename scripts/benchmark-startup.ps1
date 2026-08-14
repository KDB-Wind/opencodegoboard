param([Parameter(Mandatory=$true)][string]$Executable)
$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$startedAt = [System.Diagnostics.Stopwatch]::StartNew()
$process = Start-Process -FilePath $resolvedExecutable -PassThru -WindowStyle Hidden
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  do {
    Start-Sleep -Milliseconds 50
    $process.Refresh()
  } while ($process.MainWindowHandle -eq 0 -and !$process.HasExited -and [DateTime]::UtcNow -lt $deadline)
  if ($process.HasExited -or $process.MainWindowHandle -eq 0) { throw 'Application window did not become ready within 20 seconds.' }
  $startedAt.Stop()
  Start-Sleep -Seconds 3
  $process.Refresh()
  $allProcesses = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $ids = [System.Collections.Generic.HashSet[uint32]]::new()
  $ids.Add([uint32]$process.Id) | Out-Null
  do {
    $added = $false
    foreach ($candidate in $allProcesses) {
      if ($ids.Contains([uint32]$candidate.ParentProcessId) -and $ids.Add([uint32]$candidate.ProcessId)) { $added = $true }
    }
  } while ($added)
  $tree = Get-Process -Id @($ids) -ErrorAction SilentlyContinue
  [pscustomobject]@{
    executable = $resolvedExecutable
    cold_start_ms = $startedAt.ElapsedMilliseconds
    process_count = @($tree).Count
    working_set_mb = [math]::Round(($tree | Measure-Object WorkingSet64 -Sum).Sum / 1MB, 2)
    private_memory_mb = [math]::Round(($tree | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB, 2)
  } | ConvertTo-Json
} finally {
  if (!$process.HasExited) {
    $process.CloseMainWindow() | Out-Null
    if (!$process.WaitForExit(1500)) { Stop-Process -Id $process.Id -Force }
  }
}
