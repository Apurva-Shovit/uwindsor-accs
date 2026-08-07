@echo off
if "%~1"=="" (
    echo Error: Commit message required. Usage: git-commit-push.cmd "commit message"
    exit /b 1
)

for /f "tokens=*" %%i in ('git rev-parse --abbrev-ref HEAD') do set CURRENT_BRANCH=%%i

if "%CURRENT_BRANCH%"=="main" (
    echo ERROR: Direct push to 'main' branch is blocked because 'main' is linked to Render and Vercel production deployments.
    echo Please switch to 'dev' or a feature branch before committing/pushing.
    exit /b 1
)

echo Staging changes...
git add .

echo Committing on branch '%CURRENT_BRANCH%' with message: "%~1"...
git commit -m "%~1"

echo Pushing to origin %CURRENT_BRANCH%...
git push origin %CURRENT_BRANCH%

echo Git auto-commit ^& push to %CURRENT_BRANCH% completed successfully!
