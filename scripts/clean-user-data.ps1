# Wipe SMLPOS local data (Windows) — restores first-run state
$ErrorActionPreference = 'SilentlyContinue'
Get-Process -Name 'SMLPOS' | Stop-Process -Force
Start-Sleep -Seconds 1

$paths = @(
  "$env:APPDATA\SMLPOS",
  "$env:LOCALAPPDATA\SMLPOS",
  "$PSScriptRoot\..\smlpos-dev.db",
  "$PSScriptRoot\..\smlpos-dev.db-wal",
  "$PSScriptRoot\..\smlpos-dev.db-shm"
)

foreach ($p in $paths) {
  if (Test-Path $p) {
    Remove-Item $p -Recurse -Force
    Write-Host "Removed: $p"
  }
}
Write-Host "Done. Launch SMLPOS for a clean first use."
