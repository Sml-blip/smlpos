param([string]$SourcePath, [switch]$Cleanup)

$ErrorActionPreference = 'Stop'
$expectedHash = 'D2A49FCD9D97A27420E2C2295A95FD6C758398F1E248D08024C9F321C59D449E'
$testDir = 'C:\SMLPOS-test'
$expectedProfile = 'C:\Users\postest'
$expectedData = 'C:\Users\postest\AppData\Roaming\SMLPOS'
$archive = 'C:\Users\postest\AppData\Roaming\SMLPOS-Archive'
Write-Output "User: $env:USERNAME"
if ($env:USERNAME -ine 'postest' -or $env:USERDOMAIN -ine $env:COMPUTERNAME -or $env:USERPROFILE.TrimEnd('\') -ine $expectedProfile -or
    $env:APPDATA.TrimEnd('\') -ine "$expectedProfile\AppData\Roaming") {
    throw 'Run only as the local postest user with its own profile.'
}

function Assert-NoLinks([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing reparse point: $Path" }
    $links = @(Get-ChildItem -LiteralPath $Path -Recurse -Force -Attributes ReparsePoint)
    if ($links.Count) { throw "Refusing reparse points inside $Path" }
}

if ($Cleanup) {
    foreach ($path in @($testDir, $expectedData, $archive)) { Assert-NoLinks $path }
    $exe = Join-Path $testDir 'SMLPOS.exe'
    Get-CimInstance Win32_Process -Filter "Name='SMLPOS.exe'" |
        Where-Object { $_.ExecutablePath -ieq $exe } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    foreach ($path in @($testDir, $expectedData, $archive)) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }
    Write-Output 'Removed only the test folder and postest SMLPOS data/archive.'
    exit 0
}

if (-not (Test-Path -LiteralPath $testDir)) {
    if (-not $SourcePath) { throw 'Provide -SourcePath to a copied win-unpacked directory.' }
    $source = (Resolve-Path -LiteralPath $SourcePath).Path.TrimEnd('\')
    if ($source -match '^C:\\Users\\' -and -not $source.StartsWith("$expectedProfile\", [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Source must not be inside another Windows user profile.'
    }
    Assert-NoLinks $source
    if ((Get-FileHash -LiteralPath (Join-Path $source 'SMLPOS.exe') -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Source hash mismatch.' }
    Copy-Item -LiteralPath $source -Destination $testDir -Recurse
}
Assert-NoLinks $testDir
$exe = Join-Path $testDir 'SMLPOS.exe'
if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Test executable hash mismatch.' }
if (Test-Path -LiteralPath (Join-Path $testDir 'resources\app-update.yml')) { throw 'Update feed exists; refusing launch.' }
$outLog = Join-Path $testDir 'postest-stdout.log'
$errLog = Join-Path $testDir 'postest-stderr.log'
$evidence = Join-Path $testDir 'evidence.txt'
foreach ($path in @($outLog, $errLog, $evidence)) { if (Test-Path -LiteralPath $path) { throw "Existing evidence: $path" } }
$process = Start-Process -FilePath $exe -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog
$lines = [Collections.Generic.List[string]]::new()
$lines.Add("User: $env:USERNAME")
$lines.Add("Executable SHA256: $expectedHash")
$lines.Add("Process ID: $($process.Id)")
function Capture-Connections([string]$Label, [int]$RootId) {
    $all = @(Get-CimInstance Win32_Process)
    $ids = [Collections.Generic.List[int]]::new()
    $ids.Add($RootId)
    for ($i = 0; $i -lt $ids.Count; $i++) {
        foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $ids[$i] }) {
            if (-not $ids.Contains([int]$child.ProcessId)) { $ids.Add([int]$child.ProcessId) }
        }
    }
    $lines.Add("$Label process IDs: $($ids -join ',')")
    foreach ($id in $ids) {
        $connections = @(Get-NetTCPConnection -OwningProcess $id -ErrorAction SilentlyContinue |
            Where-Object { $_.State -ne 'Listen' } | Select-Object -ExpandProperty RemoteAddress -Unique)
        $lines.Add("$Label PID $id remote addresses: $($connections -join ',')")
    }
}
Start-Sleep -Seconds 10
Capture-Connections '10s' $process.Id
Start-Sleep -Seconds 30
Capture-Connections '40s' $process.Id
$appLines = @((Get-Content -LiteralPath $outLog -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $errLog -ErrorAction SilentlyContinue))
$updater = @($appLines | Where-Object { $_ -match '\[updater\] DISABLED \(test build\)' })
$startup = @($appLines | Where-Object { $_ -match '\[startup\] userData=' })
$lines.AddRange([string[]]$updater)
$lines.AddRange([string[]]$startup)
$lines.Add("Updater disabled: $(if ($updater.Count -eq 1) { 'PASS' } else { 'FAIL' })")
$expectedLine = "userData=$expectedData syncBackend=http://127.0.0.1:23001"
$lines.Add("User data and backend: $(if ($startup.Count -eq 1 -and $startup[0].Contains($expectedLine)) { 'PASS' } else { 'FAIL' })")
$lines.Add('Continuous external-network absence: INCONCLUSIVE; two TCP snapshots cannot exclude short-lived connections or UDP.')
$lines | Set-Content -LiteralPath $evidence -Encoding UTF8
Get-Content -LiteralPath $evidence
