# ZipShip

ZipShip is a mobile-first web service and installable PWA that safely extracts a ZIP archive, previews its effect on a GitHub repository, and publishes the result as a single Git commit.

It is designed for iPhone and iPad use but also works on desktop browsers.

## Included features

- GitHub App sign-in and repository-scoped access
- Encrypted, secure, HTTP-only session cookie
- Automatic refresh of expiring GitHub user tokens
- Installable PWA with iPhone-safe layouts and light/dark themes
- Repository and branch selection
- ZIP path-traversal, symlink, file-count, and size protections
- Common root-folder removal
- Optional target folder inside the repository
- Overlay mode: add and update files without deleting existing files
- Mirror mode: make a folder match the ZIP, including deletions
- Added, modified, unchanged, and deleted file preview
- Warnings for likely secrets and sensitive filenames
- Direct commit, new branch, and pull-request workflows
- One atomic Git commit using GitHub's Git data API
- No persistent ZIP storage and no database requirement

## Architecture

```text
React + TypeScript + Vite PWA
             │
             ▼
Express + TypeScript web service
             │
             ▼
GitHub App OAuth + installation tokens
```

The React build and API are served from one Render Web Service. Uploaded ZIPs are held only in memory during the request.

## Start here

For the complete deployment walkthrough, open [SETUP_RENDER.md](./SETUP_RENDER.md).

## Local development

Requirements:

- Node.js 24 LTS
- A GitHub App with a local callback URL of `http://localhost:5173/api/auth/github/callback`

```bash
cp .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`.

The Vite development server proxies `/api` and `/health` to the Express server on port 3000.

## Production commands

```bash
npm ci
npm run build
npm start
```

## Important environment variables

| Variable | Purpose |
|---|---|
| `GITHUB_APP_ID` | Numeric GitHub App ID |
| `GITHUB_CLIENT_ID` | GitHub App client ID |
| `GITHUB_CLIENT_SECRET` | GitHub App client secret |
| `GITHUB_APP_SLUG` | App slug used for the repository-installation link |
| `GITHUB_PRIVATE_KEY_BASE64` | One-line Base64 encoding of the downloaded `.pem` key |
| `SESSION_SECRET` | High-entropy encryption secret for login cookies |
| `SESSION_DAYS` | Sliding session-cookie lifetime, default 30 days |
| `APP_URL` | Public origin; optional on Render because `RENDER_EXTERNAL_URL` is detected |
| `MAX_ZIP_MB` | Maximum compressed upload size |
| `MAX_EXTRACTED_MB` | Maximum extracted total size |
| `MAX_FILE_MB` | Maximum size for one extracted file |
| `MAX_FILES` | Maximum number of files in one ZIP |

## Session behavior

GitHub App user tokens normally expire after eight hours. When GitHub supplies a refresh token, ZipShip rotates the user token automatically and rewrites the encrypted session cookie. The cookie uses a sliding lifetime controlled by `SESSION_DAYS`, so regular use keeps the user signed in.

Signing out deletes the cookie. Changing `SESSION_SECRET` also invalidates every existing session.

## Security model

- GitHub credentials and private keys remain on the server.
- Session contents are encrypted with AES-256-GCM.
- Cookies are HTTP-only, secure in production, and SameSite=Lax.
- Mutating API requests require a same-origin verification header.
- GitHub installation access is checked before repository operations.
- Installation tokens are short lived and are not stored.
- Archives with unsafe paths or symbolic links are rejected.
- Archive, extracted, per-file, and file-count limits are enforced.
- Mirror mode is blocked when GitHub returns a truncated repository tree.
- Direct branch updates are non-forced.
- The service uses a restrictive Content Security Policy.

Secret detection is advisory, not a substitute for GitHub secret scanning or a repository security review.

## Recommended GitHub workflow

Use these defaults for most uploads:

```text
Upload behavior: Overlay
Create a new branch: On
Open a pull request: On
```

Use direct commits only on branches where you intentionally allow them. Use mirror mode only after reviewing the deletion list.

## Project structure

```text
src/client/       React PWA
src/server/       Express API, GitHub integration, ZIP validation
public/           PWA manifest, icons, and service worker
render.yaml       Render Blueprint
SETUP_RENDER.md   iPhone-friendly deployment instructions
```

## License

MIT
