# Working Instructions

## Git workflow
- Commit changes on a regular basis rather than batching everything into one large commit at the end — commit after each discrete, working unit of work (e.g. a feature, a bug fix), not mid-task.
- Use `git-commit-push.ps1` (repo root) to commit and push: `./git-commit-push.ps1 -Message "..."`. It runs `git add .`, so before invoking it, check `git status` — if unrelated in-flight changes are sitting in the working tree, flag them and confirm before running it, since it will stage and commit everything, not just the current task's files.
- Keep unrelated in-flight changes out of a commit; if the working tree has other uncommitted work that isn't part of the current task, leave it untouched and flag it rather than folding it in.
