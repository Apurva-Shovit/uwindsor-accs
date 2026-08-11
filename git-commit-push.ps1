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

Write-Host "Staging changes..." -ForegroundColor Cyan
git add .

Write-Host "Committing on branch '$currentBranch' with message: '$Message'..." -ForegroundColor Cyan
git commit -m "$Message"

Write-Host "Pushing to origin $currentBranch..." -ForegroundColor Cyan
git push origin $currentBranch

Write-Host "Git auto-commit & push to $currentBranch completed successfully!" -ForegroundColor Green
