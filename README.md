# ZipShip v1.1.0

ZipShip is a mobile-first web service and installable PWA that publishes a ZIP archive to GitHub as one commit and can safely undo the latest commit on a selected branch.

## New in v1.1.0

- **Undo latest commit** tool for any accessible branch
- Preview of the latest commit and the parent state to be restored
- Affected-file list with restore/delete/rename-back actions
- Merge-commit parent selection
- Branch-head consistency check before undoing
- Safe default: create a revert branch and pull request
- Optional direct revert for unprotected branches
- History-preserving implementation: no force push or hard reset

## Existing features

- GitHub App sign-in with encrypted, secure, HTTP-only sessions
- Automatic GitHub token refresh
- Installable iPhone PWA with light and dark themes
- ZIP validation, common-root removal, and secret warnings
- Overlay and mirror upload modes
- Direct commit, new branch, and pull-request publishing
- One Render Web Service; no database or persistent ZIP storage

## Deploying an update

For an existing ZipShip service:

1. Replace the repository contents with this release.
2. Preserve the current service name in `render.yaml`.
3. Commit and push to the branch connected to Render.
4. In Render, sync the Blueprint if prompted.
5. Choose **Manual Deploy → Clear build cache & deploy**.

Existing Render environment variables are not stored in this ZIP and do not need to be re-entered.

## Build commands

```bash
npm ci --include=dev --no-audit --no-fund
npm run build
npm start
```

## GitHub App permissions

```text
Contents: Read and write
Pull requests: Read and write
Metadata: Read-only
```

The undo feature uses the same permissions as ZIP publishing.

## How undo works

If the branch history is:

```text
A -- B -- C   (branch head)
```

ZipShip creates a new commit `R` whose tree matches `B` but whose parent is `C`:

```text
A -- B -- C -- R
```

This restores the files without removing `C` from history. For pull-request delivery, `R` is placed on a new branch and a PR is opened into the selected branch.

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`.
