@echo off
if "%~1"=="" (
    echo Error: Commit message required. Usage: git-commit-push.cmd "commit message"
    exit /b 1
)

echo Staging changes...
git add .

echo Committing with message: "%~1"...
git commit -m "%~1"

echo Pushing to origin main...
git push origin main

echo Git auto-commit ^& push completed successfully!
