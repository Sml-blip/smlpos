# Gainscha GTSPL SDK print bridge for SMLPOS
# Usage: powershell -ExecutionPolicy Bypass -File gainscha-print.ps1 -JobJsonPath job.json
#        powershell -ExecutionPolicy Bypass -File gainscha-print.ps1 -Detect
param(
    [string]$JobJsonPath = '',
    [switch]$Detect,
    [switch]$Version
)

$ErrorActionPreference = 'Stop'

function Write-JsonResult($obj) {
    $obj | ConvertTo-Json -Compress -Depth 6 | Write-Output
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SdkDir = Join-Path $ScriptDir 'x64'
$DllPath = Join-Path $SdkDir 'GTSPL_SDK.dll'

if (-not (Test-Path $DllPath)) {
    Write-JsonResult @{ success = $false; error = "GTSPL_SDK.dll introuvable: $DllPath" }
    exit 1
}

Set-Location $SdkDir
Add-Type -Path $DllPath

function MmToDots([double]$mm, [int]$dpi) {
    return [int][math]::Round($mm * $dpi / 25.4)
}

function FontMul([double]$hMm, [int]$dpi) {
    $dots = $hMm * $dpi / 25.4
    return [string][math]::Max(1, [math]::Min(4, [math]::Round($dots / 7)))
}

if ($Version) {
    try {
        $driver = New-Object GTSPL_SDK.Driver
        Write-JsonResult @{ success = $true; version = $driver.getDLLVersion(1) }
        exit 0
    } catch {
        Write-JsonResult @{ success = $false; error = $_.Exception.Message }
        exit 1
    }
}

if ($Detect) {
    try {
        $usb = New-Object GTSPL_SDK.USB
        $names = $usb.detectUSB_USB()
        $list = @()
        if ($names) {
            foreach ($n in $names) {
                if ($n) { $list += [string]$n }
            }
        }
        Write-JsonResult @{ success = $true; devices = $list }
        exit 0
    } catch {
        Write-JsonResult @{ success = $false; error = $_.Exception.Message; devices = @() }
        exit 1
    }
}

if (-not $JobJsonPath -or -not (Test-Path $JobJsonPath)) {
    Write-JsonResult @{ success = $false; error = 'JobJsonPath manquant ou invalide' }
    exit 1
}

$job = Get-Content -Raw -Encoding UTF8 $JobJsonPath | ConvertFrom-Json

function Invoke-PrintJob {
    param($job)

    $dpi = [int]$job.dpi
    if ($dpi -lt 72) { $dpi = 203 }

    $useUsb = ([string]$job.connection -eq 'usb') -and [string]$job.usbDevice
    $opened = 0
    $dev = $null

    try {
        if ($useUsb) {
            $dev = New-Object GTSPL_SDK.USB
            $opened = $dev.openports_USB([string]$job.usbDevice)
        } else {
            $dev = New-Object GTSPL_SDK.Driver
            $printer = [string]$job.printerName
            if (-not $printer) { throw 'Nom imprimante Windows requis (mode driver)' }
            $opened = $dev.openport($printer)
        }

        if ($opened -eq 0) { throw 'Impossible d''ouvrir le port imprimante (code 0)' }

        $wDots = MmToDots ([double]$job.widthMm) $dpi
        $hDots = MmToDots ([double]$job.heightMm) $dpi
        $speed = '4'
        $density = '8'
        $sensor = '0'
        $gap = '2'
        $offset = '0'

        if ($useUsb) {
            $null = $dev.setup_USB("$wDots", "$hDots", $speed, $density, $sensor, $gap, $offset)
        } else {
            $null = $dev.setup("$wDots", "$hDots", $speed, $density, $sensor, $gap, $offset)
        }

        if ([int]$job.rotationDeg -eq 180) {
            if ($useUsb) { $null = $dev.sendcommand_USB('DIRECTION 1') }
            else { $null = $dev.sendcommand('DIRECTION 1') }
        }

        if ($useUsb) { $null = $dev.clearbuffer_USB() }
        else { $null = $dev.clearbuffer() }

        $stripL = [double]$job.stripLeftMm
        $stripT = [double]$job.stripTopMm

        if ($job.elements.name.visible -eq $true) {
            $el = $job.elements.name
            $x = MmToDots ($stripL + [double]$el.x) $dpi
            $y = MmToDots ($stripT + [double]$el.y) $dpi
            $ymul = FontMul ([double]$el.h) $dpi
            $text = [string]$el.text
            if ($useUsb) { $null = $dev.printerfont_USB("$x", "$y", '3', '0', '1', $ymul, $text) }
            else { $null = $dev.printerfont("$x", "$y", '3', '0', '1', $ymul, $text) }
        }

        if ($job.elements.barcode.visible -eq $true) {
            $el = $job.elements.barcode
            $x = MmToDots ($stripL + [double]$el.x) $dpi
            $y = MmToDots ($stripT + [double]$el.y) $dpi
            $barHMm = [double]$el.h
            if ($job.showBarcodeText -eq $true) { $barHMm = [math]::Max(4, $barHMm - 3.5) }
            $h = MmToDots $barHMm $dpi
            $readable = if ($job.showBarcodeText -eq $true) { '1' } else { '0' }
            $value = [string]$el.value
            if ($useUsb) {
                $null = $dev.barcode_USB("$x", "$y", 'E80', "$h", $readable, '0', '2', '2', $value)
            } else {
                $null = $dev.barcode("$x", "$y", 'E80', "$h", $readable, '0', '2', '2', $value)
            }
        }

        if ($job.elements.price.visible -eq $true) {
            $el = $job.elements.price
            $x = MmToDots ($stripL + [double]$el.x) $dpi
            $y = MmToDots ($stripT + [double]$el.y) $dpi
            $ymul = FontMul ([double]$el.h) $dpi
            $text = [string]$el.text
            if ($useUsb) { $null = $dev.printerfont_USB("$x", "$y", '3', '0', '1', $ymul, $text) }
            else { $null = $dev.printerfont("$x", "$y", '3', '0', '1', $ymul, $text) }
        }

        $copies = [string][math]::Max(1, [math]::Min(99, [int]$job.copies))
        if ($useUsb) { $null = $dev.printlabel_USB('1', $copies) }
        else { $null = $dev.printlabel('1', $copies) }
    }
    finally {
        if ($dev) {
            try {
                if ($useUsb) { $null = $dev.closeport_USB() }
                else { $null = $dev.closeport() }
            } catch { }
        }
    }
}

try {
    Invoke-PrintJob $job
    Write-JsonResult @{ success = $true }
    exit 0
} catch {
    Write-JsonResult @{ success = $false; error = $_.Exception.Message }
    exit 1
}
