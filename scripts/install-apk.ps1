<#
.SYNOPSIS
    Installs a release APK onto every connected Android device.

.DESCRIPTION
    Handles the one thing that makes this awkward by hand: a tablet carrying a
    live-reload *debug* build cannot be upgraded in place, because debug and
    release are signed with different keys and Android refuses the swap. This
    detects that case, uninstalls, and reinstalls -- rather than failing with
    INSTALL_FAILED_UPDATE_INCOMPATIBLE and leaving you to work out why.

    Uninstalling clears app data, which here is only the mirrored session token:
    the user signs in again and nothing else is lost. No facility data lives on
    the device.

    This is only needed for the one-time move to versionCode 5, and for any
    later NATIVE release. Frontend changes arrive over the air on their own --
    see apps/web/ANDROID.md.

.PARAMETER ApkPath
    APK to install. Defaults to the newest under dist-apk/.

.PARAMETER KeepData
    Try an in-place upgrade only, and skip any device that would need wiping.
    Use when you would rather re-install a device by hand than clear its session.

.EXAMPLE
    ./scripts/install-apk.ps1

.EXAMPLE
    ./scripts/install-apk.ps1 -ApkPath .\dist-apk\ACARE-1.3.0-vc5.apk
#>
[CmdletBinding()]
param(
    [string]$ApkPath,
    [switch]$KeepData
)

$ErrorActionPreference = 'Stop'
$package = 'ca.uwindsor.acare'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Ok($m)   { Write-Host "  [ ok ] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [warn] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "  [FAIL] $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "ACARE - APK rollout" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host ""

# --- adb --------------------------------------------------------------------
$adb = Get-Command adb -ErrorAction SilentlyContinue
if (-not $adb) {
    $candidate = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    if (Test-Path $candidate) { $adb = $candidate } else { Fail "adb not found. Install Android platform-tools." }
} else {
    $adb = $adb.Source
}
Ok "adb: $adb"

# --- APK --------------------------------------------------------------------
if (-not $ApkPath) {
    $newest = Get-ChildItem (Join-Path $repoRoot 'dist-apk') -Filter *.apk -ErrorAction SilentlyContinue |
              Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $newest) { Fail "No APK in dist-apk/. Pass -ApkPath, or build one (see ANDROID.md)." }
    $ApkPath = $newest.FullName
}
if (-not (Test-Path $ApkPath)) { Fail "APK not found: $ApkPath" }
$apkItem = Get-Item $ApkPath
Ok "APK: $($apkItem.Name)  ($([math]::Round($apkItem.Length / 1MB, 1)) MB)"

$sha = (Get-FileHash $ApkPath -Algorithm SHA256).Hash.ToLower()
Write-Host "         sha256 $sha" -ForegroundColor DarkGray

# --- Devices ----------------------------------------------------------------
$deviceLines = & $adb devices | Select-Object -Skip 1 | Where-Object { $_ -match '\sdevice$' }
if (-not $deviceLines) {
    Fail @"
No devices connected.

  - Plug the tablet in over USB
  - Enable Developer options -> USB debugging
  - Accept the 'Allow USB debugging?' prompt on the tablet
"@
}
$serials = $deviceLines | ForEach-Object { ($_ -split '\s+')[0] }
Ok "$($serials.Count) device(s): $($serials -join ', ')"
Write-Host ""

# --- Install ----------------------------------------------------------------
$installed = 0
$skipped   = 0

foreach ($serial in $serials) {
    $model = (& $adb -s $serial shell getprop ro.product.model).Trim()
    Write-Host "$serial  ($model)" -ForegroundColor Cyan

    $dump = & $adb -s $serial shell dumpsys package $package 2>$null
    $isInstalled = [bool]($dump | Select-String -Pattern "versionCode=" -Quiet)

    if ($isInstalled) {
        $verLine  = ($dump | Select-String -Pattern 'versionCode=(\d+).*' | Select-Object -First 1).Matches[0].Groups[1].Value
        $nameLine = ($dump | Select-String -Pattern 'versionName=(.+)' | Select-Object -First 1)
        $curName  = if ($nameLine) { $nameLine.Matches[0].Groups[1].Value.Trim() } else { '?' }

        # DEBUGGABLE means a live-reload build: different signing key, so an
        # in-place upgrade is impossible.
        $isDebug = [bool]($dump | Select-String -Pattern 'DEBUGGABLE' -Quiet)

        Write-Host "  currently: $curName (versionCode $verLine)$(if ($isDebug) { ' [DEBUG build]' })"

        if ($isDebug) {
            if ($KeepData) {
                Warn "debug build present and -KeepData set; skipping this device."
                $skipped++
                Write-Host ""
                continue
            }
            Warn "debug build -> must uninstall first (clears the saved session only)"
            & $adb -s $serial uninstall $package | Out-Null
            if ($LASTEXITCODE -ne 0) { Warn "uninstall failed; skipping."; $skipped++; Write-Host ""; continue }
            Ok "uninstalled"
        }
    } else {
        Write-Host "  currently: not installed"
    }

    & $adb -s $serial install -r $ApkPath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Warn "install failed. If it reports UPDATE_INCOMPATIBLE, run without -KeepData."
        $skipped++
        Write-Host ""
        continue
    }

    $after = & $adb -s $serial shell dumpsys package $package 2>$null
    $newCode = ($after | Select-String -Pattern 'versionCode=(\d+)' | Select-Object -First 1).Matches[0].Groups[1].Value
    $stillDebug = [bool]($after | Select-String -Pattern 'DEBUGGABLE' -Quiet)
    if ($stillDebug) { Warn "installed build still reports DEBUGGABLE -- that is not a release APK." }

    Ok "installed, now versionCode $newCode"
    $installed++
    Write-Host ""
}

Write-Host "-----------------------------------------" -ForegroundColor DarkGray
Write-Host "installed: $installed   skipped: $skipped"
Write-Host ""
if ($installed -gt 0) {
    Write-Host "These devices will now self-update for frontend changes." -ForegroundColor Green
    Write-Host "Verify with:  adb logcat | Select-String CapgoUpdater"
}
