import path from 'node:path';
import process from 'node:process';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { config, githubConfigured } from './config.js';
import {
  assertInstallationAccess,
  compareCommits,
  createBlob,
  createBranch,
  createCommit,
  createInstallationToken,
  createTree,
  ensureUserToken,
  exchangeCodeForSession,
  getBranch,
  getCommitDetails,
  getRepoSnapshot,
  GitHubError,
  listBranches,
  listRepositories,
  openPullRequest,
  updateBranch,
  type TreeEntry
} from './github.js';
import { clearSession, createOauthState, readSession, verifyOauthState, writeSession } from './session.js';
import { buildPreview, deletionPaths, normalizeTargetFolder, readArchive } from './zip.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://avatars.githubusercontent.com; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://github.com");
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxZipBytes, files: 1, fields: 20 },
  fileFilter: (_req, file, callback) => {
    const looksLikeZip = file.originalname.toLowerCase().endsWith('.zip') || ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(file.mimetype);
    if (!looksLikeZip) { callback(new Error('Please select a ZIP archive.')); return; }
    callback(null, true);
  }
});

function mutationGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.get('x-zipship-request') !== '1') { res.status(403).json({ error: 'Request verification failed.' }); return; }
  next();
}
function requiredString(value: unknown, label: string, maxLength = 300): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new Error(`${label} is too long.`);
  return trimmed;
}
function parseBoolean(value: unknown): boolean { return value === true || value === 'true' || value === '1' || value === 'on'; }
function validRepoPart(value: string, label: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}
function validSha(value: string, label = 'Commit SHA'): string {
  if (!/^[a-f0-9]{40}$/i.test(value)) throw new Error(`${label} is invalid.`);
  return value.toLowerCase();
}
function validBranchName(input: string): string {
  const branch = input.trim();
  if (!branch || branch.length > 180 || !/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('/') || branch.endsWith('/') || branch.endsWith('.') || branch.includes('..') || branch.includes('//') || branch.includes('@{') || branch.endsWith('.lock')) {
    throw new Error('The branch name is invalid. Use letters, numbers, dots, underscores, dashes, and slashes.');
  }
  return branch;
}
function automaticBranchName(prefix = 'zipship'): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${prefix}/${stamp}`;
}
async function authenticated(req: Request, res: Response): Promise<{ userToken: string }> {
  const session = readSession(req);
  if (!session) throw new GitHubError('Please sign in with GitHub.', 401);
  const ensured = await ensureUserToken(session, res);
  return { userToken: ensured.token };
}
async function repositoryTokens(req: Request, res: Response, installationId: number): Promise<{ userToken: string; installationToken: string }> {
  const { userToken } = await authenticated(req, res);
  await assertInstallationAccess(userToken, installationId);
  return { userToken, installationToken: await createInstallationToken(installationId) };
}
function repoRequest(values: Record<string, unknown>): { installationId: number; owner: string; repo: string; branch: string } {
  const installationId = Number(values.installationId);
  if (!Number.isInteger(installationId) || installationId <= 0) throw new Error('Invalid installation.');
  return {
    installationId,
    owner: validRepoPart(requiredString(values.owner, 'Repository owner', 100), 'repository owner'),
    repo: validRepoPart(requiredString(values.repo, 'Repository name', 100), 'repository name'),
    branch: validBranchName(requiredString(values.branch, 'Branch', 180))
  };
}

app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
app.get('/api/config', (_req, res) => res.json({
  configured: githubConfigured(),
  installUrl: config.githubAppSlug ? `https://github.com/apps/${encodeURIComponent(config.githubAppSlug)}/installations/new` : null,
  limits: { maxZipMb: Math.round(config.maxZipBytes / 1024 / 1024), maxExtractedMb: Math.round(config.maxExtractedBytes / 1024 / 1024), maxFiles: config.maxFiles }
}));
app.get('/api/auth/github', (_req, res) => {
  if (!githubConfigured()) { res.redirect('/?error=GitHub%20App%20is%20not%20configured'); return; }
  const state = createOauthState(res);
  const params = new URLSearchParams({ client_id: config.githubClientId, redirect_uri: `${config.appUrl}/api/auth/github/callback`, state });
  res.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});
app.get('/api/auth/github/callback', async (req, res, next) => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (!verifyOauthState(req, res, state)) throw new GitHubError('GitHub sign-in verification failed. Please try again.', 400);
    const session = await exchangeCodeForSession(requiredString(req.query.code, 'Authorization code', 500));
    writeSession(res, session);
    res.redirect('/?signedIn=1');
  } catch (error) { next(error); }
});
app.post('/api/auth/logout', mutationGuard, (_req, res) => { clearSession(res); res.status(204).end(); });
app.get('/api/me', async (req, res, next) => {
  try {
    const session = readSession(req);
    if (!session) { res.status(401).json({ authenticated: false }); return; }
    await ensureUserToken(session, res);
    res.json({ authenticated: true, user: session.user });
  } catch (error) { clearSession(res); next(error); }
});
app.get('/api/repos', async (req, res, next) => {
  try { res.json({ repositories: await listRepositories((await authenticated(req, res)).userToken) }); }
  catch (error) { next(error); }
});
app.get('/api/branches', async (req, res, next) => {
  try {
    const { installationId, owner, repo } = repoRequest({ ...req.query, branch: 'temporary' });
    const { installationToken } = await repositoryTokens(req, res, installationId);
    res.json({ branches: await listBranches(installationToken, owner, repo) });
  } catch (error) { next(error); }
});

app.post('/api/preview', mutationGuard, upload.single('zip'), async (req, res, next) => {
  try {
    if (!req.file) throw new Error('Choose a ZIP archive.');
    const { installationId, owner, repo, branch } = repoRequest(req.body as Record<string, unknown>);
    const mode = req.body.mode === 'mirror' ? 'mirror' : 'overlay';
    const targetFolder = normalizeTargetFolder(typeof req.body.targetFolder === 'string' ? req.body.targetFolder : '');
    const { installationToken } = await repositoryTokens(req, res, installationId);
    const [archive, snapshot] = await Promise.all([
      readArchive(req.file.buffer, { stripRoot: parseBoolean(req.body.stripRoot), targetFolder }),
      getRepoSnapshot(installationToken, owner, repo, branch)
    ]);
    const preview = buildPreview(archive, snapshot, { mode, targetFolder });
    if (mode === 'mirror' && preview.treeTruncated) throw new Error('Mirror mode is unavailable because GitHub returned a truncated repository tree. Use overlay mode.');
    res.json(preview);
  } catch (error) { next(error); }
});

async function mapInBatches<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor; cursor += 1; results[index] = await mapper(items[index]); }
  });
  await Promise.all(workers);
  return results;
}

app.post('/api/publish', mutationGuard, upload.single('zip'), async (req, res, next) => {
  try {
    if (!req.file) throw new Error('Choose a ZIP archive.');
    const { installationId, owner, repo, branch: baseBranch } = repoRequest(req.body as Record<string, unknown>);
    const commitMessage = requiredString(req.body.commitMessage, 'Commit message', 500);
    const mode = req.body.mode === 'mirror' ? 'mirror' : 'overlay';
    const targetFolder = normalizeTargetFolder(typeof req.body.targetFolder === 'string' ? req.body.targetFolder : '');
    const useNewBranch = parseBoolean(req.body.useNewBranch);
    const shouldOpenPr = useNewBranch && parseBoolean(req.body.openPr);
    const targetBranch = useNewBranch ? validBranchName(typeof req.body.newBranch === 'string' && req.body.newBranch.trim() ? req.body.newBranch : automaticBranchName()) : baseBranch;
    const { installationToken } = await repositoryTokens(req, res, installationId);
    const [archive, snapshot] = await Promise.all([
      readArchive(req.file.buffer, { stripRoot: parseBoolean(req.body.stripRoot), targetFolder }),
      getRepoSnapshot(installationToken, owner, repo, baseBranch)
    ]);
    if (mode === 'mirror' && snapshot.truncated) throw new Error('Mirror mode is unavailable because GitHub returned a truncated repository tree. Use overlay mode.');
    const existing = new Map(snapshot.tree.filter((item) => item.type === 'blob' && item.path).map((item) => [item.path!, item.sha]));
    const changedFiles = archive.files.filter((file) => existing.get(file.path) !== file.gitSha);
    const deleted = mode === 'mirror' ? deletionPaths(archive, snapshot, targetFolder) : [];
    if (!changedFiles.length && !deleted.length) { res.json({ noChanges: true, branch: baseBranch, message: 'The repository already matches this ZIP.' }); return; }
    const blobShas = await mapInBatches(changedFiles, 5, (file) => createBlob(installationToken, owner, repo, file.content));
    const entries: TreeEntry[] = changedFiles.map((file, index) => ({ path: file.path, mode: file.mode, type: 'blob', sha: blobShas[index] }));
    entries.push(...deleted.map((filePath) => ({ path: filePath, mode: '100644' as const, type: 'blob' as const, sha: null })));
    const treeSha = await createTree(installationToken, owner, repo, snapshot.treeSha, entries);
    const commit = await createCommit(installationToken, owner, repo, commitMessage, treeSha, snapshot.commitSha);
    if (useNewBranch) await createBranch(installationToken, owner, repo, targetBranch, commit.sha);
    else await updateBranch(installationToken, owner, repo, baseBranch, commit.sha);
    const pullRequest = shouldOpenPr ? await openPullRequest(installationToken, owner, repo, targetBranch, baseBranch, commitMessage, 'Created by ZipShip from an uploaded ZIP archive.') : null;
    res.json({ noChanges: false, branch: targetBranch, commit, pullRequest, summary: { uploaded: changedFiles.length, deleted: deleted.length } });
  } catch (error) { next(error); }
});

function undoAction(status: string): 'delete' | 'restore' | 'restore previous name' | 'restore content' {
  if (status === 'added' || status === 'copied') return 'delete';
  if (status === 'removed') return 'restore';
  if (status === 'renamed') return 'restore previous name';
  return 'restore content';
}

app.get('/api/revert-preview', async (req, res, next) => {
  try {
    const { installationId, owner, repo, branch } = repoRequest(req.query as Record<string, unknown>);
    const requestedParent = typeof req.query.parentSha === 'string' && req.query.parentSha ? validSha(req.query.parentSha, 'Parent SHA') : null;
    const { installationToken } = await repositoryTokens(req, res, installationId);
    const [snapshot, branchInfo] = await Promise.all([
      getRepoSnapshot(installationToken, owner, repo, branch),
      getBranch(installationToken, owner, repo, branch)
    ]);
    const head = await getCommitDetails(installationToken, owner, repo, snapshot.commitSha);
    if (!head.parents.length) {
      res.json({ canRevert: false, reason: 'This is the initial commit, so there is no earlier repository state to restore.', branch, protected: branchInfo.protected, head, parents: [] });
      return;
    }
    const parentDetails = await Promise.all(head.parents.map((parent) => getCommitDetails(installationToken, owner, repo, parent.sha)));
    const selected = requestedParent
      ? parentDetails.find((parent) => parent.sha === requestedParent)
      : parentDetails[0];
    if (!selected) throw new Error('The selected commit is not a parent of the branch head. Refresh the preview.');
    const comparison = await compareCommits(installationToken, owner, repo, selected.sha, head.sha);
    const files = comparison.files.map((file) => ({
      path: file.filename,
      previousPath: file.previousFilename ?? null,
      status: file.status,
      undoAction: undoAction(file.status),
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes
    }));
    const counts = files.reduce((result, file) => {
      result[file.undoAction] = (result[file.undoAction] ?? 0) + 1;
      return result;
    }, {} as Record<string, number>);
    res.json({
      canRevert: true,
      branch,
      protected: branchInfo.protected,
      head,
      parents: parentDetails.map((parent) => ({ sha: parent.sha, message: parent.message, authorName: parent.authorName, authorDate: parent.authorDate, htmlUrl: parent.htmlUrl })),
      selectedParent: { sha: selected.sha, message: selected.message, authorName: selected.authorName, authorDate: selected.authorDate, htmlUrl: selected.htmlUrl },
      changes: {
        files: files.length,
        additions: files.reduce((sum, file) => sum + file.additions, 0),
        deletions: files.reduce((sum, file) => sum + file.deletions, 0),
        actionCounts: counts
      },
      files
    });
  } catch (error) { next(error); }
});

app.post('/api/revert', mutationGuard, async (req, res, next) => {
  try {
    const { installationId, owner, repo, branch } = repoRequest(req.body as Record<string, unknown>);
    const expectedHeadSha = validSha(requiredString(req.body.expectedHeadSha, 'Expected head SHA', 40), 'Expected head SHA');
    const selectedParentSha = validSha(requiredString(req.body.selectedParentSha, 'Selected parent SHA', 40), 'Selected parent SHA');
    const delivery = req.body.delivery === 'direct' ? 'direct' : 'pull_request';
    const commitMessage = requiredString(req.body.commitMessage, 'Revert commit message', 500);
    const newBranch = delivery === 'pull_request'
      ? validBranchName(typeof req.body.newBranch === 'string' && req.body.newBranch.trim() ? req.body.newBranch : automaticBranchName('zipship/revert'))
      : branch;
    const { installationToken } = await repositoryTokens(req, res, installationId);
    const snapshot = await getRepoSnapshot(installationToken, owner, repo, branch);
    if (snapshot.commitSha.toLowerCase() !== expectedHeadSha) throw new GitHubError('This branch changed after the preview. Refresh the undo preview before continuing.', 409);
    const head = await getCommitDetails(installationToken, owner, repo, snapshot.commitSha);
    if (!head.parents.some((parent) => parent.sha.toLowerCase() === selectedParentSha)) throw new GitHubError('The selected restore point is no longer a parent of the branch head.', 409);
    const selectedParent = await getCommitDetails(installationToken, owner, repo, selectedParentSha);
    const revertCommit = await createCommit(installationToken, owner, repo, commitMessage, selectedParent.treeSha, head.sha);
    let pullRequest: { number: number; htmlUrl: string } | null = null;
    if (delivery === 'pull_request') {
      await createBranch(installationToken, owner, repo, newBranch, revertCommit.sha);
      pullRequest = await openPullRequest(
        installationToken, owner, repo, newBranch, branch, commitMessage,
        `This pull request restores **${branch}** to the file state of commit \`${selectedParent.sha.slice(0, 7)}\` while preserving Git history.\n\nLatest commit being undone: \`${head.sha.slice(0, 7)}\`\n\nCreated by ZipShip.`
      );
    } else {
      await updateBranch(installationToken, owner, repo, branch, revertCommit.sha);
    }
    res.json({
      branch: delivery === 'direct' ? branch : newBranch,
      targetBranch: branch,
      delivery,
      commit: revertCommit,
      pullRequest,
      restoredTo: { sha: selectedParent.sha, message: selectedParent.message },
      undoneCommit: { sha: head.sha, message: head.message }
    });
  } catch (error) { next(error); }
});

if (config.nodeEnv === 'production') {
  const distPath = path.resolve(process.cwd(), 'dist');
  app.use(express.static(distPath, { maxAge: '1h', etag: true }));
  app.get(/^(?!\/api\/|\/health$).*/, (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('ZipShip API is running. Open the Vite development server at http://localhost:5173.'));
}
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? `ZIP exceeds the ${Math.round(config.maxZipBytes / 1024 / 1024)} MB upload limit.` : error.message });
    return;
  }
  if (error instanceof GitHubError) { res.status(error.status >= 400 && error.status < 600 ? error.status : 502).json({ error: error.message }); return; }
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  console.error(error);
  res.status(400).json({ error: message });
});
app.listen(config.port, '0.0.0.0', () => console.log(`ZipShip listening on port ${config.port}`));
