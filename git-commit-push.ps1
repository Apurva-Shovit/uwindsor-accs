param (
    [Parameter(Mandatory=$true)]
    [string]$Message
)

Write-Host "Staging changes..." -ForegroundColor Cyan
git add .

Write-Host "Committing with message: '$Message'..." -ForegroundColor Cyan
git commit -m "$Message"

Write-Host "Pushing to origin main..." -ForegroundColor Cyan
git push origin main

Write-Host "Git auto-commit & push completed successfully!" -ForegroundColor Green
