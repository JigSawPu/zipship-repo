import { createPrivateKey } from 'node:crypto';
import { SignJWT } from 'jose';
import type { Response } from 'express';
import { config } from './config.js';
import { writeSession, type AuthSession, type UserProfile } from './session.js';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.details = details;
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

async function githubFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': config.githubApiVersion,
      'User-Agent': 'ZipShip-Web-Service',
      ...(init.headers ?? {})
    }
  });

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const message = typeof body === 'object' && body && 'message' in body
      ? String((body as { message: unknown }).message)
      : `GitHub request failed with status ${response.status}`;
    throw new GitHubError(message, response.status, body);
  }

  return body as T;
}

async function exchangeToken(params: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });
  const data = await response.json() as TokenResponse;
  if (!response.ok || data.error || !data.access_token) {
    throw new GitHubError(data.error_description || data.error || 'GitHub sign-in failed.', response.status || 400, data);
  }
  return data;
}

export async function exchangeCodeForSession(code: string): Promise<AuthSession> {
  const token = await exchangeToken(new URLSearchParams({
    client_id: config.githubClientId,
    client_secret: config.githubClientSecret,
    code,
    redirect_uri: `${config.appUrl}/api/auth/github/callback`
  }));

  const user = await githubFetch<{ id: number; login: string; name: string | null; avatar_url: string }>('/user', token.access_token!);
  const now = Date.now();
  return {
    accessToken: token.access_token!,
    accessTokenExpiresAt: token.expires_in ? now + token.expires_in * 1000 : undefined,
    refreshToken: token.refresh_token,
    refreshTokenExpiresAt: token.refresh_token_expires_in ? now + token.refresh_token_expires_in * 1000 : undefined,
    user: {
      id: user.id,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatar_url
    }
  };
}

export async function ensureUserToken(session: AuthSession, res: Response): Promise<{ token: string; session: AuthSession }> {
  const refreshSoon = session.accessTokenExpiresAt && session.accessTokenExpiresAt < Date.now() + 5 * 60 * 1000;
  if (!refreshSoon) {
    writeSession(res, session);
    return { token: session.accessToken, session };
  }

  if (!session.refreshToken || (session.refreshTokenExpiresAt && session.refreshTokenExpiresAt <= Date.now())) {
    throw new GitHubError('Your GitHub sign-in has expired. Please sign in again.', 401);
  }

  const refreshed = await exchangeToken(new URLSearchParams({
    client_id: config.githubClientId,
    client_secret: config.githubClientSecret,
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken
  }));

  const now = Date.now();
  const next: AuthSession = {
    ...session,
    accessToken: refreshed.access_token!,
    accessTokenExpiresAt: refreshed.expires_in ? now + refreshed.expires_in * 1000 : undefined,
    refreshToken: refreshed.refresh_token ?? session.refreshToken,
    refreshTokenExpiresAt: refreshed.refresh_token_expires_in
      ? now + refreshed.refresh_token_expires_in * 1000
      : session.refreshTokenExpiresAt
  };
  writeSession(res, next);
  return { token: next.accessToken, session: next };
}

async function createAppJwt(): Promise<string> {
  let pem: string;
  try {
    pem = Buffer.from(config.githubPrivateKeyBase64, 'base64').toString('utf8');
  } catch {
    throw new GitHubError('The GitHub private key environment variable is invalid.', 500);
  }
  let privateKey;
  try {
    privateKey = createPrivateKey(pem);
  } catch {
    throw new GitHubError('The GitHub private key could not be read. Recreate its Base64 value and update Render.', 500);
  }
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .setIssuer(config.githubAppId)
    .sign(privateKey);
}

export interface Installation {
  id: number;
  account: { login: string; avatar_url: string; type: string };
}

export async function listUserInstallations(userToken: string): Promise<Installation[]> {
  const data = await githubFetch<{ installations: Installation[] }>('/user/installations?per_page=100', userToken);
  return data.installations;
}

export async function assertInstallationAccess(userToken: string, installationId: number): Promise<void> {
  const installs = await listUserInstallations(userToken);
  if (!installs.some((installation) => installation.id === installationId)) {
    throw new GitHubError('You do not have access to this GitHub App installation.', 403);
  }
}

export async function createInstallationToken(installationId: number): Promise<string> {
  const jwt = await createAppJwt();
  const data = await githubFetch<{ token: string }>(`/app/installations/${installationId}/access_tokens`, jwt, { method: 'POST' });
  return data.token;
}

export interface RepoSummary {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  installationId: number;
  accountAvatarUrl: string;
}

export async function listRepositories(userToken: string): Promise<RepoSummary[]> {
  const installations = await listUserInstallations(userToken);
  const all: RepoSummary[] = [];

  for (const installation of installations) {
    const installationToken = await createInstallationToken(installation.id);
    for (let page = 1; page <= 10; page += 1) {
      const data = await githubFetch<{
        repositories: Array<{
          id: number;
          full_name: string;
          name: string;
          private: boolean;
          archived: boolean;
          default_branch: string;
          owner: { login: string };
        }>;
      }>(`/installation/repositories?per_page=100&page=${page}`, installationToken);

      for (const repo of data.repositories) {
        all.push({
          id: repo.id,
          fullName: repo.full_name,
          owner: repo.owner.login,
          name: repo.name,
          private: repo.private,
          archived: repo.archived,
          defaultBranch: repo.default_branch,
          installationId: installation.id,
          accountAvatarUrl: installation.account.avatar_url
        });
      }
      if (data.repositories.length < 100) break;
    }
  }

  return all.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export interface BranchSummary {
  name: string;
  protected: boolean;
}

export async function listBranches(token: string, owner: string, repo: string): Promise<BranchSummary[]> {
  const branches: BranchSummary[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const data = await githubFetch<Array<{ name: string; protected: boolean }>>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100&page=${page}`,
      token
    );
    branches.push(...data);
    if (data.length < 100) break;
  }
  return branches;
}

export interface GitTreeItem {
  path?: string;
  mode?: string;
  type?: string;
  sha?: string;
  size?: number;
}

export interface RepoSnapshot {
  commitSha: string;
  treeSha: string;
  tree: GitTreeItem[];
  truncated: boolean;
}

function refPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

export async function getRepoSnapshot(token: string, owner: string, repo: string, branch: string): Promise<RepoSnapshot> {
  const ref = await githubFetch<{ object: { sha: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${refPath(branch)}`,
    token
  );
  const commit = await githubFetch<{ tree: { sha: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${ref.object.sha}`,
    token
  );
  const tree = await githubFetch<{ tree: GitTreeItem[]; truncated: boolean }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${commit.tree.sha}?recursive=1`,
    token
  );
  return { commitSha: ref.object.sha, treeSha: commit.tree.sha, tree: tree.tree, truncated: tree.truncated };
}

export async function createBlob(token: string, owner: string, repo: string, content: Buffer): Promise<string> {
  const data = await githubFetch<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' })
    }
  );
  return data.sha;
}

export interface TreeEntry {
  path: string;
  mode: '100644' | '100755';
  type: 'blob';
  sha: string | null;
}

export async function createTree(
  token: string,
  owner: string,
  repo: string,
  baseTree: string,
  tree: TreeEntry[]
): Promise<string> {
  const data = await githubFetch<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_tree: baseTree, tree })
    }
  );
  return data.sha;
}

export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  message: string,
  treeSha: string,
  parentSha: string
): Promise<{ sha: string; htmlUrl: string }> {
  const data = await githubFetch<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] })
    }
  );
  return { sha: data.sha, htmlUrl: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${data.sha}` };
}

export async function createBranch(token: string, owner: string, repo: string, branch: string, sha: string): Promise<void> {
  await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha })
    }
  );
}

export async function updateBranch(token: string, owner: string, repo: string, branch: string, sha: string): Promise<void> {
  await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${refPath(branch)}`,
    token,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha, force: false })
    }
  );
}

export async function openPullRequest(
  token: string,
  owner: string,
  repo: string,
  head: string,
  base: string,
  title: string
): Promise<{ number: number; htmlUrl: string }> {
  const data = await githubFetch<{ number: number; html_url: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        head,
        base,
        body: 'Created by ZipShip from an uploaded ZIP archive.'
      })
    }
  );
  return { number: data.number, htmlUrl: data.html_url };
}

export async function getUserProfile(userToken: string): Promise<UserProfile> {
  const user = await githubFetch<{ id: number; login: string; name: string | null; avatar_url: string }>('/user', userToken);
  return { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatar_url };
}
