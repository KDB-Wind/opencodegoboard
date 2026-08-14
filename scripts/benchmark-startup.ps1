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
  [pscustomobject]@{
    executable = $resolvedExecutable
    cold_start_ms = $startedAt.ElapsedMilliseconds
    working_set_mb = [math]::Round($process.WorkingSet64 / 1MB, 2)
    private_memory_mb = [math]::Round($process.PrivateMemorySize64 / 1MB, 2)
  } | ConvertTo-Json
} finally {
  if (!$process.HasExited) { $process.CloseMainWindow() | Out-Null }
}
