# Deploy ZipShip on Render

This guide is written so the full setup can be completed from an iPhone. Safari works, though GitHub and Render are easier in landscape mode for a few settings screens.

## Before starting

You need:

- A GitHub account
- A GitHub repository containing this ZipShip project
- A Render account connected to GitHub
- The iPhone Shortcuts app for safely converting the GitHub private key to Base64

Do not paste the GitHub private key into an online Base64 converter.

---

## 1. Choose the Render service name

Open `render.yaml` and replace:

```yaml
name: zipship-web
```

with a globally unique lowercase name, for example:

```yaml
name: arun-zipship
```

Your expected Render URL will be:

```text
https://arun-zipship.onrender.com
```

Commit this change to the GitHub repository that will host ZipShip.

---

## 2. Register a GitHub App

In GitHub:

1. Open your profile menu.
2. Open **Settings**.
3. Open **Developer settings**.
4. Open **GitHub Apps**.
5. Tap **New GitHub App**.

Use these settings, replacing the example service name with yours.

### Basic information

```text
GitHub App name: Your unique ZipShip name
Homepage URL: https://arun-zipship.onrender.com
Callback URL: https://arun-zipship.onrender.com/api/auth/github/callback
Setup URL: https://arun-zipship.onrender.com
```

Enable **Request user authorization (OAuth) during installation**.

Disable **Webhook active** because this version does not need webhooks.

### Repository permissions

Set:

```text
Contents: Read and write
Pull requests: Read and write
Metadata: Read-only (GitHub normally enables this automatically)
```

No organization or account permissions are required.

### Installation scope

For a private personal tool, choose:

```text
Only on this account
```

Choose **Any account** only when you intentionally want other GitHub users or organizations to install the app.

Tap **Create GitHub App**.

---

## 3. Collect the GitHub App credentials

On the GitHub App settings page, copy these values into a temporary secure note:

```text
App ID
Client ID
Client secret
App slug
```

The app slug is the final portion of the GitHub App page address. For example, the slug in:

```text
https://github.com/apps/arun-zipship
```

is:

```text
arun-zipship
```

Under **Private keys**, tap **Generate a private key**. GitHub downloads a `.pem` file to the iPhone Files app.

Keep that file private.

---

## 4. Convert the private key to Base64 on iPhone

Create a temporary Shortcut:

1. Open **Shortcuts**.
2. Tap **+**.
3. Add the **Select File** action.
4. Add the **Base64 Encode** action.
5. Add the **Copy to Clipboard** action.
6. Run the shortcut.
7. Select the downloaded GitHub `.pem` file.

The one-line Base64 value is now on your clipboard. This becomes `GITHUB_PRIVATE_KEY_BASE64` in Render.

Delete the temporary secure note and Shortcut after the deployment is working, or retain them only in a trusted password manager.

Desktop alternative:

```bash
base64 < your-app.private-key.pem | tr -d '\n'
```

---

## 5. Deploy the Render Blueprint

In Render:

1. Open the dashboard.
2. Tap **New**.
3. Choose **Blueprint**.
4. Connect the GitHub repository containing ZipShip.
5. Render detects `render.yaml`.
6. Confirm the service creation.

Render asks for the environment values marked `sync: false`.

Enter:

```text
GITHUB_APP_ID              = the numeric App ID
GITHUB_CLIENT_ID           = the GitHub App client ID
GITHUB_CLIENT_SECRET       = the generated client secret
GITHUB_APP_SLUG            = the app slug
GITHUB_PRIVATE_KEY_BASE64  = the Base64 value copied from Shortcuts
```

`SESSION_SECRET` is generated automatically by the Blueprint. Do not replace or rotate it unless you intentionally want to sign out every user.

Tap **Apply** or **Deploy**.

Render runs:

```text
npm ci && npm run build
npm start
```

The health check path is:

```text
/health
```

After deployment, open the Render URL and confirm that the ZipShip sign-in screen appears.

---

## 6. Install the GitHub App on repositories

Open:

```text
https://github.com/apps/YOUR-APP-SLUG/installations/new
```

Or use the **Add or change repository access** link inside ZipShip after signing in.

Choose either:

```text
All repositories
```

or, preferably:

```text
Only select repositories
```

Select the repositories ZipShip should be able to publish to and complete the installation.

Repository access can be changed later in GitHub under:

```text
Settings → Applications → Installed GitHub Apps
```

---

## 7. Sign in and test safely

1. Open the Render URL.
2. Tap **Continue with GitHub**.
3. Select a test repository.
4. Select a non-critical branch or keep **Create a new branch** enabled.
5. Upload a small ZIP.
6. Tap **Preview GitHub changes**.
7. Review added, modified, unchanged, and deleted files.
8. Publish with **Create a new branch** and **Open a pull request** enabled.
9. Open the generated pull request and verify the result.

Only after this test should you use direct commits on important repositories.

---

## 8. Install ZipShip as an iPhone PWA

Use Safari, not an in-app browser.

1. Open the deployed ZipShip URL in Safari.
2. Tap the Safari **Share** button.
3. Scroll and tap **Add to Home Screen**.
4. Keep the name **ZipShip** or rename it.
5. Tap **Add**.

ZipShip now opens in standalone app mode from the Home Screen.

The app shell can open when offline, but GitHub sign-in, repository loading, preview comparison, and publishing require an internet connection.

---

## Staying signed in

ZipShip stores an encrypted HTTP-only session cookie for 30 days by default. The lifetime slides forward while you use the app.

GitHub's expiring user access token is refreshed automatically when possible. You will need to sign in again when:

- The ZipShip cookie has not been used for longer than `SESSION_DAYS`
- GitHub authorization is revoked
- The GitHub refresh token expires
- `SESSION_SECRET` is changed
- Safari site data is cleared

To use a different inactivity period, change `SESSION_DAYS` in Render. Keep it at or below 180 days.

---

## Updating ZipShip later

Push changes to the connected GitHub repository. With `autoDeploy: true`, Render automatically builds and deploys the latest commit.

If a deployment fails, open the Render service and inspect the build log. The most useful checks are:

```bash
npm ci
npm run typecheck
npm run build
```

---

## Troubleshooting

### “GitHub App is not configured”

At least one required environment variable is missing. Check the five GitHub variables in Render and redeploy.

### “GitHub sign-in verification failed”

Confirm the exact callback URL in GitHub:

```text
https://YOUR-SERVICE.onrender.com/api/auth/github/callback
```

It must use HTTPS and must match the deployed service name.

### No repositories appear

Install the GitHub App on at least one repository. Then reload ZipShip or sign out and sign in again.

### Private key cannot be read

Recreate the Base64 value directly from the original `.pem` file. Ensure it is copied as one uninterrupted line with no spaces or surrounding quotes.

### Direct publishing fails on a protected branch

Enable **Create a new branch** and **Open a pull request**. Protected branch rules can intentionally reject direct updates.

### Mirror mode is blocked

GitHub can truncate extremely large recursive repository trees. ZipShip blocks mirror mode in that situation because it cannot safely calculate every deletion. Use overlay mode.

### First opening is slow

A free Render Web Service may need to start after inactivity. A paid instance avoids free-tier spin-down behavior.

---

## Recommended production settings

```text
SESSION_DAYS=30
MAX_ZIP_MB=15
MAX_EXTRACTED_MB=75
MAX_FILE_MB=10
MAX_FILES=1500
GITHUB_API_VERSION=2026-03-10
```

For larger projects, increase limits carefully. The service processes ZIPs in memory, so limits should remain comfortably below the instance's available memory.
