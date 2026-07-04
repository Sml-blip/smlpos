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

# TSPL barcode coordinates and heights are in dots; label SIZE uses mm.
function MmToDots([double]$mm, [int]$dpi) {
    return [int][math]::Round($mm * $dpi / 25.4)
}

# Map box height (mm) to TSPL font multiplier 1-4.
function FontMul([double]$hMm, [int]$dpi) {
    $dots = $hMm * $dpi / 25.4
    # Keep text compact on 39x20mm labels to avoid overlaps.
    return [string][math]::Max(1, [math]::Min(2, [math]::Round($dots / 14)))
}

function EstimateCode128Modules([string]$text) {
    $len = [string]$text
    if ($len.Length -lt 1) { return 46 }
    return 35 + ($len.Length * 11)
}

function Code128ModuleWidths([double]$boxWidthMm, [string]$value, [int]$dpi) {
    $boxDots = MmToDots $boxWidthMm $dpi
    $modules = EstimateCode128Modules $value
    $quiet = 24
    $narrow = [math]::Floor(($boxDots * 0.95 - $quiet) / $modules)
    if ($narrow -lt 1) { $narrow = 1 }
    if ($narrow -gt 3) { $narrow = 3 }
    # For CODE128 on Gainscha, keeping narrow=wide avoids overly fat bars and right-edge crop.
    $wide = $narrow
    return @([string]$narrow, [string]$wide)
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

        # SIZE takes mm values, not dots
        $wMm = [string][math]::Round([double]$job.widthMm)
        $hMm = [string][math]::Round([double]$job.heightMm)
        $speed    = '4'
        $density  = '8'
        $sensor   = '0'  # 0 = gap sensor
        $gap      = '2'  # 2mm gap between labels
        $offset   = '0'

        if ($useUsb) {
            $null = $dev.setup_USB($wMm, $hMm, $speed, $density, $sensor, $gap, $offset)
        } else {
            $null = $dev.setup($wMm, $hMm, $speed, $density, $sensor, $gap, $offset)
        }

        # DIRECTION: 0 = top-of-form forward (default), 1 = reverse/flip 180
        $direction = if ([int]$job.rotationDeg -eq 180) { 'DIRECTION 1' } else { 'DIRECTION 0' }
        if ($useUsb) { $null = $dev.sendcommand_USB($direction) }
        else { $null = $dev.sendcommand($direction) }

        if ($useUsb) { $null = $dev.clearbuffer_USB() }
        else { $null = $dev.clearbuffer() }

        $stripL = [double]$job.stripLeftMm
        $stripT = [double]$job.stripTopMm

        # ── Name (product title) ─────────────────────────────────────────────
        if ($job.elements.name.visible -eq $true) {
            $el  = $job.elements.name
            $x   = MmToDots ($stripL + [double]$el.x) $dpi
            $y   = MmToDots ($stripT + [double]$el.y) $dpi
            $mul = FontMul ([double]$el.h) $dpi
            $txt = [string]$el.text
            if ($useUsb) { $null = $dev.printerfont_USB("$x", "$y", '3', '0', '1', $mul, $txt) }
            else         { $null = $dev.printerfont("$x", "$y", '3', '0', '1', $mul, $txt) }
        }

        # ── Barcode (CODE128) ─────────────────────────────────────────────────
        if ($job.elements.barcode.visible -eq $true) {
            $el       = $job.elements.barcode
            $x        = MmToDots ($stripL + [double]$el.x) $dpi
            $y        = MmToDots ($stripT + [double]$el.y) $dpi
            $boxHMm   = [double]$el.h
            $boxWMm   = [double]$el.w
            $showText = $job.showBarcodeText -eq $true
            if ($showText) {
                $barHMm = [math]::Max(3, $boxHMm * 0.75)
            } else {
                $barHMm = $boxHMm
            }
            $h = MmToDots $barHMm $dpi
            $moduleWidths = Code128ModuleWidths $boxWMm ([string]$el.value) $dpi
            $narrow = $moduleWidths[0]
            $wide = $moduleWidths[1]
            $value = [string]$el.value
            if ($useUsb) {
                $null = $dev.barcode_USB("$x", "$y", '128', "$h", '0', '0', $narrow, $wide, $value)
            } else {
                $null = $dev.barcode("$x", "$y", '128', "$h", '0', '0', $narrow, $wide, $value)
            }
            if ($showText) {
                $caption = [string]$el.displayText
                if (-not $caption) { $caption = $value }
                # Trim very long captions so they stay inside the label width.
                if ($caption.Length -gt 28) {
                    $caption = $caption.Substring(0, 28)
                }
                $captionY = MmToDots ($stripT + [double]$el.y + $barHMm + 0.35) $dpi
                if ($useUsb) {
                    $null = $dev.printerfont_USB("$x", "$captionY", '2', '0', '1', '1', $caption)
                } else {
                    $null = $dev.printerfont("$x", "$captionY", '2', '0', '1', '1', $caption)
                }
            }
        }

        # ── Price ─────────────────────────────────────────────────────────────
        if ($job.elements.price.visible -eq $true) {
            $el  = $job.elements.price
            $x   = MmToDots ($stripL + [double]$el.x) $dpi
            $y   = MmToDots ($stripT + [double]$el.y) $dpi
            $mul = FontMul ([double]$el.h) $dpi
            $txt = [string]$el.text
            if ($useUsb) { $null = $dev.printerfont_USB("$x", "$y", '3', '0', '1', $mul, $txt) }
            else         { $null = $dev.printerfont("$x", "$y", '3', '0', '1', $mul, $txt) }
        }

        $copies = [string][math]::Max(1, [math]::Min(99, [int]$job.copies))
        if ($useUsb) { $null = $dev.printlabel_USB('1', $copies) }
        else         { $null = $dev.printlabel('1', $copies) }
    }
    finally {
        if ($dev) {
            try {
                if ($useUsb) { $null = $dev.closeport_USB() }
                else         { $null = $dev.closeport() }
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
