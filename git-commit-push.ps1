param (
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()

if ($currentBranch -eq "main") {
    Write-Host "ERROR: Direct push to 'main' branch is blocked because 'main' is linked to Render and Vercel production deployments." -ForegroundColor Red
    Write-Host "Please switch to 'dev' or a feature branch before committing/pushing." -ForegroundColor Yellow
    exit 1
}

if ($Message -match '"') {
    Write-Host "ERROR: -Message contains a double quote." -ForegroundColor Red
    Write-Host "Windows PowerShell splits the argument at that quote, so git receives the rest of the message as pathspecs and the commit fails. Use single quotes inside the message instead." -ForegroundColor Yellow
    exit 1
}

Write-Host "Staging changes..." -ForegroundColor Cyan
git add .
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: 'git add' failed (exit $LASTEXITCODE). Nothing was committed or pushed." -ForegroundColor Red
    exit $LASTEXITCODE
}

# Nothing staged is not a failure, but committing would be, so stop cleanly.
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host "No staged changes - nothing to commit. Working tree is already clean." -ForegroundColor Yellow
    exit 0
}

Write-Host "Committing on branch '$currentBranch' with message: '$Message'..." -ForegroundColor Cyan
git commit -m "$Message"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: 'git commit' failed (exit $LASTEXITCODE). Nothing was pushed; your changes are still staged." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Pushing to origin $currentBranch..." -ForegroundColor Cyan
git push origin $currentBranch
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: 'git push' failed (exit $LASTEXITCODE). The commit exists locally but is NOT on origin/$currentBranch." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Git auto-commit & push to $currentBranch completed successfully!" -ForegroundColor Green
