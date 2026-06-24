import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Response, Request } from 'express';
import { config } from './config.js';

export interface UserProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface AuthSession {
  accessToken: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  refreshTokenExpiresAt?: number;
  user: UserProfile;
}

const COOKIE_NAME = 'zipship_session';
const STATE_COOKIE = 'zipship_oauth_state';
const AAD = Buffer.from('zipship-session-v1');
const key = createHash('sha256').update(config.sessionSecret).digest();

function encode(value: Buffer): string {
  return value.toString('base64url');
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

export function encryptSession(session: AuthSession): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${encode(iv)}.${encode(tag)}.${encode(ciphertext)}`;
}

export function decryptSession(value: string | undefined): AuthSession | null {
  if (!value) return null;
  try {
    const [ivRaw, tagRaw, ciphertextRaw] = value.split('.');
    if (!ivRaw || !tagRaw || !ciphertextRaw) return null;
    const decipher = createDecipheriv('aes-256-gcm', key, decode(ivRaw));
    decipher.setAAD(AAD);
    decipher.setAuthTag(decode(tagRaw));
    const plaintext = Buffer.concat([decipher.update(decode(ciphertextRaw)), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext) as AuthSession;
  } catch {
    return null;
  }
}

const commonCookie = {
  httpOnly: true,
  secure: config.nodeEnv === 'production',
  sameSite: 'lax' as const,
  path: '/'
};

export function readSession(req: Request): AuthSession | null {
  return decryptSession(req.cookies?.[COOKIE_NAME] as string | undefined);
}

export function writeSession(res: Response, session: AuthSession): void {
  res.cookie(COOKIE_NAME, encryptSession(session), {
    ...commonCookie,
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE_NAME, commonCookie);
}

function signState(state: string): string {
  return createHmac('sha256', key).update(state).digest('base64url');
}

export function createOauthState(res: Response): string {
  const state = randomBytes(24).toString('base64url');
  res.cookie(STATE_COOKIE, `${state}.${signState(state)}`, {
    ...commonCookie,
    maxAge: 10 * 60 * 1000
  });
  return state;
}

export function verifyOauthState(req: Request, res: Response, provided: string | undefined): boolean {
  const cookieValue = req.cookies?.[STATE_COOKIE] as string | undefined;
  res.clearCookie(STATE_COOKIE, commonCookie);
  if (!provided || !cookieValue) return false;
  const [state, signature] = cookieValue.split('.');
  if (!state || !signature || state !== provided) return false;
  const expected = Buffer.from(signState(state));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
