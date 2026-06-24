import 'dotenv/config';
import process from 'node:process';

const nodeEnv = process.env.NODE_ENV ?? 'development';

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: numberEnv('PORT', 3000),
  nodeEnv,
  appUrl: (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${numberEnv('PORT', 3000)}`).replace(/\/$/, ''),
  githubAppId: process.env.GITHUB_APP_ID ?? '',
  githubClientId: process.env.GITHUB_CLIENT_ID ?? '',
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
  githubAppSlug: process.env.GITHUB_APP_SLUG ?? '',
  githubPrivateKeyBase64: process.env.GITHUB_PRIVATE_KEY_BASE64 ?? '',
  githubApiVersion: process.env.GITHUB_API_VERSION ?? '2026-03-10',
  sessionSecret: process.env.SESSION_SECRET ?? (nodeEnv === 'development' ? 'development-only-change-me' : ''),
  sessionDays: numberEnv('SESSION_DAYS', 30),
  maxZipBytes: numberEnv('MAX_ZIP_MB', 15) * 1024 * 1024,
  maxExtractedBytes: numberEnv('MAX_EXTRACTED_MB', 75) * 1024 * 1024,
  maxFileBytes: numberEnv('MAX_FILE_MB', 10) * 1024 * 1024,
  maxFiles: numberEnv('MAX_FILES', 1500)
};

export function githubConfigured(): boolean {
  return Boolean(
    config.githubAppId &&
    config.githubClientId &&
    config.githubClientSecret &&
    config.githubPrivateKeyBase64 &&
    config.sessionSecret
  );
}
