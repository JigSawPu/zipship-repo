# Render setup and upgrade guide

## New installation

1. Change the service name in `render.yaml` to a globally unique name.
2. Push the complete project to GitHub.
3. Create a GitHub App with:

```text
Homepage URL: https://YOUR-SERVICE.onrender.com
Callback URL: https://YOUR-SERVICE.onrender.com/api/auth/github/callback
Setup URL: https://YOUR-SERVICE.onrender.com
```

4. Enable repository permissions:

```text
Contents: Read and write
Pull requests: Read and write
Metadata: Read-only
```

5. Generate a private key and store its Base64 value in Render as `GITHUB_PRIVATE_KEY_BASE64`.
6. Create a Render Blueprint from this repository.
7. Enter the requested GitHub App environment variables.
8. Install the GitHub App on the repositories ZipShip should access.

## Upgrade an existing service

1. Extract this release.
2. Preserve your existing service name in `render.yaml`.
3. Replace all repository files with the contents of the extracted `zipship-web-service` folder.
4. Commit and push.
5. Sync the Blueprint if Render prompts you.
6. Choose **Manual Deploy → Clear build cache & deploy**.

The build log should contain:

```text
Using Node.js version 22.22.3
npm ci --include=dev --no-audit --no-fund
npm run typecheck
vite building for production
```

## Using Undo latest commit

1. Select a repository and branch.
2. Open **Undo latest commit**.
3. Tap **Preview undo**.
4. Review the commit being undone and the parent state being restored.
5. For a merge commit, choose the correct parent. The first parent is normally the branch state before the merge.
6. Keep **Create revert branch and pull request** selected for the safest workflow.
7. Confirm the action.

ZipShip stops the operation if the branch changes after preview. Refresh the preview and review the new head before trying again.

## Protected branches

Use the pull-request delivery option. Direct revert may be rejected by GitHub branch rules.

## Important limitation

Undo restores the complete file tree of the chosen parent commit. It is intended for undoing the latest commit. It does not remove secrets from older Git history; rotate leaked credentials separately.
