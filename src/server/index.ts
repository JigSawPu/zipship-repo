import path from 'node:path';
import process from 'node:process';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { config, githubConfigured } from './config.js';
import {
  assertInstallationAccess,
  createBlob,
  createBranch,
  createCommit,
  createInstallationToken,
  createTree,
  ensureUserToken,
  exchangeCodeForSession,
  getRepoSnapshot,
  GitHubError,
  listBranches,
  listRepositories,
  openPullRequest,
  updateBranch,
  type TreeEntry
} from './github.js';
import {
  clearSession,
  createOauthState,
  readSession,
  verifyOauthState,
  writeSession
} from './session.js';
import { buildPreview, deletionPaths, normalizeTargetFolder, readArchive } from './zip.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://github.com"
  );
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxZipBytes,
    files: 1,
    fields: 20
  },
  fileFilter: (_req, file, callback) => {
    const looksLikeZip = file.originalname.toLowerCase().endsWith('.zip') || ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(file.mimetype);
    if (!looksLikeZip) {
      callback(new Error('Please select a ZIP archive.'));
      return;
    }
    callback(null, true);
  }
});

function mutationGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.get('x-zipship-request') !== '1') {
    res.status(403).json({ error: 'Request verification failed.' });
    return;
  }
  next();
}

function requiredString(value: unknown, label: string, maxLength = 300): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${label} is too long.`);
  return trimmed;
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

function validRepoPart(value: string, label: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function validBranchName(input: string): string {
  const branch = input.trim();
  if (
    !branch ||
    branch.length > 180 ||
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.includes('..') ||
    branch.includes('//') ||
    branch.includes('@{') ||
    branch.endsWith('.lock')
  ) {
    throw new Error('The branch name is invalid. Use letters, numbers, dots, underscores, dashes, and slashes.');
  }
  return branch;
}

function automaticBranchName(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `zipship/${stamp}`;
}

async function authenticated(req: Request, res: Response): Promise<{ userToken: string; installationToken?: string }> {
  const session = readSession(req);
  if (!session) throw new GitHubError('Please sign in with GitHub.', 401);
  const ensured = await ensureUserToken(session, res);
  return { userToken: ensured.token };
}

async function repositoryTokens(req: Request, res: Response, installationId: number): Promise<{ userToken: string; installationToken: string }> {
  const { userToken } = await authenticated(req, res);
  await assertInstallationAccess(userToken, installationId);
  const installationToken = await createInstallationToken(installationId);
  return { userToken, installationToken };
}

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/api/config', (_req, res) => {
  res.json({
    configured: githubConfigured(),
    installUrl: config.githubAppSlug ? `https://github.com/apps/${encodeURIComponent(config.githubAppSlug)}/installations/new` : null,
    limits: {
      maxZipMb: Math.round(config.maxZipBytes / 1024 / 1024),
      maxExtractedMb: Math.round(config.maxExtractedBytes / 1024 / 1024),
      maxFiles: config.maxFiles
    }
  });
});

app.get('/api/auth/github', (req, res) => {
  if (!githubConfigured()) {
    res.redirect('/?error=GitHub%20App%20is%20not%20configured');
    return;
  }
  const state = createOauthState(res);
  const params = new URLSearchParams({
    client_id: config.githubClientId,
    redirect_uri: `${config.appUrl}/api/auth/github/callback`,
    state
  });
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

app.get('/api/auth/github/callback', async (req, res, next) => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (!verifyOauthState(req, res, state)) throw new GitHubError('GitHub sign-in verification failed. Please try again.', 400);
    const code = requiredString(req.query.code, 'Authorization code', 500);
    const session = await exchangeCodeForSession(code);
    writeSession(res, session);
    res.redirect('/?signedIn=1');
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', mutationGuard, (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

app.get('/api/me', async (req, res, next) => {
  try {
    const session = readSession(req);
    if (!session) {
      res.status(401).json({ authenticated: false });
      return;
    }
    await ensureUserToken(session, res);
    res.json({ authenticated: true, user: session.user });
  } catch (error) {
    clearSession(res);
    next(error);
  }
});

app.get('/api/repos', async (req, res, next) => {
  try {
    const { userToken } = await authenticated(req, res);
    const repositories = await listRepositories(userToken);
    res.json({ repositories });
  } catch (error) {
    next(error);
  }
});

app.get('/api/branches', async (req, res, next) => {
  try {
    const installationId = Number(req.query.installationId);
    if (!Number.isInteger(installationId) || installationId <= 0) throw new Error('Invalid installation.');
    const owner = validRepoPart(requiredString(req.query.owner, 'Repository owner', 100), 'repository owner');
    const repo = validRepoPart(requiredString(req.query.repo, 'Repository name', 100), 'repository name');
    const { installationToken } = await repositoryTokens(req, res, installationId);
    const branches = await listBranches(installationToken, owner, repo);
    res.json({ branches });
  } catch (error) {
    next(error);
  }
});

app.post('/api/preview', mutationGuard, upload.single('zip'), async (req, res, next) => {
  try {
    if (!req.file) throw new Error('Choose a ZIP archive.');
    const installationId = Number(req.body.installationId);
    if (!Number.isInteger(installationId) || installationId <= 0) throw new Error('Invalid installation.');
    const owner = validRepoPart(requiredString(req.body.owner, 'Repository owner', 100), 'repository owner');
    const repo = validRepoPart(requiredString(req.body.repo, 'Repository name', 100), 'repository name');
    const branch = validBranchName(requiredString(req.body.branch, 'Branch', 180));
    const mode = req.body.mode === 'mirror' ? 'mirror' : 'overlay';
    const targetFolder = normalizeTargetFolder(typeof req.body.targetFolder === 'string' ? req.body.targetFolder : '');
    const stripRoot = parseBoolean(req.body.stripRoot);

    const { installationToken } = await repositoryTokens(req, res, installationId);
    const [archive, snapshot] = await Promise.all([
      readArchive(req.file.buffer, { stripRoot, targetFolder }),
      getRepoSnapshot(installationToken, owner, repo, branch)
    ]);
    const preview = buildPreview(archive, snapshot, { mode, targetFolder });
    if (mode === 'mirror' && preview.treeTruncated) {
      throw new Error('Mirror mode is unavailable because GitHub returned a truncated repository tree. Use overlay mode.');
    }
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

async function mapInBatches<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

app.post('/api/publish', mutationGuard, upload.single('zip'), async (req, res, next) => {
  try {
    if (!req.file) throw new Error('Choose a ZIP archive.');
    const installationId = Number(req.body.installationId);
    if (!Number.isInteger(installationId) || installationId <= 0) throw new Error('Invalid installation.');
    const owner = validRepoPart(requiredString(req.body.owner, 'Repository owner', 100), 'repository owner');
    const repo = validRepoPart(requiredString(req.body.repo, 'Repository name', 100), 'repository name');
    const baseBranch = validBranchName(requiredString(req.body.branch, 'Branch', 180));
    const commitMessage = requiredString(req.body.commitMessage, 'Commit message', 500);
    const mode = req.body.mode === 'mirror' ? 'mirror' : 'overlay';
    const targetFolder = normalizeTargetFolder(typeof req.body.targetFolder === 'string' ? req.body.targetFolder : '');
    const stripRoot = parseBoolean(req.body.stripRoot);
    const useNewBranch = parseBoolean(req.body.useNewBranch);
    const shouldOpenPr = useNewBranch && parseBoolean(req.body.openPr);
    const requestedBranch = typeof req.body.newBranch === 'string' && req.body.newBranch.trim()
      ? req.body.newBranch
      : automaticBranchName();
    const targetBranch = useNewBranch ? validBranchName(requestedBranch) : baseBranch;

    const { installationToken } = await repositoryTokens(req, res, installationId);
    const [archive, snapshot] = await Promise.all([
      readArchive(req.file.buffer, { stripRoot, targetFolder }),
      getRepoSnapshot(installationToken, owner, repo, baseBranch)
    ]);
    if (mode === 'mirror' && snapshot.truncated) {
      throw new Error('Mirror mode is unavailable because GitHub returned a truncated repository tree. Use overlay mode.');
    }

    const existing = new Map(
      snapshot.tree.filter((item) => item.type === 'blob' && item.path).map((item) => [item.path!, item.sha])
    );
    const changedFiles = archive.files.filter((file) => existing.get(file.path) !== file.gitSha);
    const deleted = mode === 'mirror' ? deletionPaths(archive, snapshot, targetFolder) : [];

    if (changedFiles.length === 0 && deleted.length === 0) {
      res.json({ noChanges: true, branch: baseBranch, message: 'The repository already matches this ZIP.' });
      return;
    }

    const blobShas = await mapInBatches(changedFiles, 5, (file) => createBlob(installationToken, owner, repo, file.content));
    const treeEntries: TreeEntry[] = changedFiles.map((file, index) => ({
      path: file.path,
      mode: file.mode,
      type: 'blob',
      sha: blobShas[index]
    }));
    treeEntries.push(...deleted.map((filePath) => ({ path: filePath, mode: '100644' as const, type: 'blob' as const, sha: null })));

    const treeSha = await createTree(installationToken, owner, repo, snapshot.treeSha, treeEntries);
    const commit = await createCommit(installationToken, owner, repo, commitMessage, treeSha, snapshot.commitSha);

    if (useNewBranch) {
      await createBranch(installationToken, owner, repo, targetBranch, commit.sha);
    } else {
      await updateBranch(installationToken, owner, repo, baseBranch, commit.sha);
    }

    let pullRequest: { number: number; htmlUrl: string } | null = null;
    if (shouldOpenPr) {
      pullRequest = await openPullRequest(installationToken, owner, repo, targetBranch, baseBranch, commitMessage);
    }

    res.json({
      noChanges: false,
      branch: targetBranch,
      commit: { sha: commit.sha, htmlUrl: commit.htmlUrl },
      pullRequest,
      summary: { uploaded: changedFiles.length, deleted: deleted.length }
    });
  } catch (error) {
    next(error);
  }
});

if (config.nodeEnv === 'production') {
  const distPath = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distPath, { maxAge: '1h', etag: true }));
  app.get(/^(?!\/api\/|\/health$).*/, (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text').send('ZipShip API is running. Open the Vite development server at http://localhost:5173.');
  });
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `ZIP exceeds the ${Math.round(config.maxZipBytes / 1024 / 1024)} MB upload limit.`
      : error.message;
    res.status(400).json({ error: message });
    return;
  }
  if (error instanceof GitHubError) {
    res.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({ error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  console.error(error);
  res.status(400).json({ error: message });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`ZipShip listening on port ${config.port}`);
});
