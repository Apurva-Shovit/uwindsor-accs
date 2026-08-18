<#
.SYNOPSIS
    Uploads the seven GitHub Actions secrets the Android workflows need.

.DESCRIPTION
    Reads the release keystore, its passwords, and google-services.json straight
    from where they already live on this machine and pipes each into `gh secret
    set` over stdin. Nothing is written to a temp file and nothing is printed,
    so the signing key does not end up in shell history, scrollback, or a stray
    file someone later syncs to a cloud drive.

    Run once. Re-running is safe and simply overwrites each secret.

    The one value that does not already exist is APP_UPDATE_TOKEN, which this
    generates. It is needed in TWO places -- GitHub and Render -- so it is the
    only thing the script shows you, once, at the end.

.EXAMPLE
    ./scripts/setup-ci-secrets.ps1

.NOTES
    Requires the GitHub CLI. If it is missing the script tells you how to get it
    rather than installing software behind your back.
    See apps/web/ANDROID.md -> "Shipping without a cable".
#>
[CmdletBinding()]
param(
    # Skip the Firebase secret. Without it push notifications are inert in
    # CI-built APKs, which is the documented optional behaviour.
    [switch]$SkipFirebase,

    # Reuse an existing token instead of generating one, e.g. when Render is
    # already configured and you are only (re)filling the GitHub side.
    [string]$AppUpdateToken
)

$ErrorActionPreference = 'Stop'

$repoRoot     = Split-Path -Parent $PSScriptRoot
$androidDir   = Join-Path $repoRoot 'apps/web/android'
$propsPath    = Join-Path $androidDir 'keystore.properties'
$envMobile    = Join-Path $repoRoot 'apps/web/.env.mobile'
$googlePath   = Join-Path $androidDir 'app/google-services.json'

function Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red; exit 1 }
function Ok($msg)   { Write-Host "  [ ok ] $msg" -ForegroundColor Green }
function Note($msg) { Write-Host "  [note] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "ACARE - GitHub Actions secrets" -ForegroundColor Cyan
Write-Host "==============================" -ForegroundColor Cyan
Write-Host ""

# --- Preconditions ----------------------------------------------------------
Write-Host "Checking prerequisites..."

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    Write-Host ""
    Fail @"
GitHub CLI not found. Install it, then re-run this script:

    winget install --id GitHub.cli --source winget

Close and reopen the terminal afterwards so gh lands on PATH, then:

    gh auth login
"@
}
Ok "gh found: $($gh.Source)"

# `gh auth status` exits non-zero when not signed in.
$null = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) { Fail "Not signed in to GitHub. Run:  gh auth login" }
Ok "gh authenticated"

# Target the repo this checkout points at, so a stray default cannot send the
# signing key to the wrong repository.
$originUrl = (git -C $repoRoot remote get-url origin).Trim()
if ($originUrl -notmatch 'github\.com[:/](?<owner>[^/]+)/(?<name>[^/.]+)') {
    Fail "Could not parse a GitHub repo from origin: $originUrl"
}
$repo = "$($Matches.owner)/$($Matches.name)"
Ok "target repository: $repo"

foreach ($p in @($propsPath, $envMobile)) {
    if (-not (Test-Path $p)) { Fail "Missing required file: $p" }
}
Ok "keystore.properties and .env.mobile present"

# --- Gather -----------------------------------------------------------------
Write-Host ""
Write-Host "Reading local configuration..."

$props = @{}
foreach ($line in Get-Content $propsPath) {
    if ($line -match '^\s*([^#=]+?)\s*=\s*(.*?)\s*$') { $props[$Matches[1]] = $Matches[2] }
}
foreach ($k in @('storeFile', 'storePassword', 'keyAlias', 'keyPassword')) {
    if (-not $props.ContainsKey($k)) { Fail "keystore.properties has no '$k'" }
}

$storeFile = $props['storeFile']
if (-not (Test-Path $storeFile)) { Fail "Keystore not found at: $storeFile" }
Ok "keystore found (kept outside the repo, as it should be)"

$apiUrl = (Select-String -Path $envMobile -Pattern '^\s*VITE_API_URL\s*=\s*(.+)$').Matches[0].Groups[1].Value.Trim()
if (-not $apiUrl) { Fail ".env.mobile has no VITE_API_URL" }
if ($apiUrl -notmatch '^https://') {
    Note "VITE_API_URL is '$apiUrl' -- not https. CI would build an APK pointing at a dev backend."
    $answer = Read-Host "  Continue anyway? (y/N)"
    if ($answer -ne 'y') { exit 1 }
}
Ok "API URL: $apiUrl"

# One unwrapped line. A wrapped value breaks `base64 -d` in the workflow.
$keystoreB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($storeFile))
Ok "keystore encoded ($($keystoreB64.Length) chars, single line)"

if ($AppUpdateToken) {
    $token = $AppUpdateToken
    $tokenIsNew = $false
} else {
    # 48 bytes of CSPRNG, URL-safe so it survives being pasted into a dashboard.
    $bytes = [byte[]]::new(48)
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $tokenIsNew = $true
}
Ok "APP_UPDATE_TOKEN ready"

# --- Upload -----------------------------------------------------------------
Write-Host ""
Write-Host "Setting secrets on $repo ..."

function Set-Secret {
    param([string]$Name, [string]$Value)
    # Piped over stdin rather than passed as --body, so the value never appears
    # in this process's command line.
    $Value | gh secret set $Name --repo $repo
    if ($LASTEXITCODE -ne 0) { Fail "could not set $Name" }
    Ok $Name
}

Set-Secret 'MOBILE_API_URL'            $apiUrl
Set-Secret 'APP_UPDATE_TOKEN'          $token
Set-Secret 'ANDROID_KEYSTORE_BASE64'   $keystoreB64
Set-Secret 'ANDROID_KEYSTORE_PASSWORD' $props['storePassword']
Set-Secret 'ANDROID_KEY_ALIAS'         $props['keyAlias']
Set-Secret 'ANDROID_KEY_PASSWORD'      $props['keyPassword']

if ($SkipFirebase) {
    Note "GOOGLE_SERVICES_JSON skipped -- push will be inert in CI-built APKs."
} elseif (Test-Path $googlePath) {
    Set-Secret 'GOOGLE_SERVICES_JSON' (Get-Content $googlePath -Raw)
} else {
    Note "google-services.json not found -- skipping. Push will be inert in CI-built APKs."
}

# --- Hand off the one value Render also needs -------------------------------
Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""

if ($tokenIsNew) {
    Write-Host "One more step -- Render needs the SAME token:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Render dashboard -> your API service -> Environment -> Add:"
    Write-Host ""
    Write-Host "    APP_UPDATE_TOKEN   = " -NoNewline
    Write-Host $token -ForegroundColor Yellow
    Write-Host "    APP_UPDATE_ENABLED = true"
    Write-Host ""
    Write-Host "  Copy it now -- this is the only time it is shown." -ForegroundColor Yellow
    Write-Host "  Until Render has it, /app-updates/bundles returns 503 and CI cannot publish."
    Write-Host "  Clear your scrollback afterwards."
} else {
    Write-Host "Reused the token you passed in; Render should already have it." -ForegroundColor Cyan
}
Write-Host ""
