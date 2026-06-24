import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import type {
  AppConfig,
  BranchSummary,
  ChangeStatus,
  PreviewResult,
  PublishResult,
  RepoSummary,
  UserProfile
} from './types';

type Theme = 'light' | 'dark';
type UploadMode = 'overlay' | 'mirror';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  if (response.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : 'Request failed.';
    throw new ApiError(message, response.status);
  }
  return body as T;
}

function Icon({ name, size = 20 }: { name: 'zip' | 'github' | 'sun' | 'moon' | 'upload' | 'branch' | 'check' | 'logout' | 'download' | 'refresh' | 'shield' | 'folder' | 'file' | 'external'; size?: number }) {
  const paths: Record<typeof name, ReactNode> = {
    zip: <><path d="M8 3h8l5 5v13H3V3h5Z"/><path d="M13 3v5h5"/><path d="M9 3v3h3V3M9 6v3h3V6M9 9v3h3V9M9 12v3h3v-3M9 18h3v-3H9v3Z"/></>,
    github: <path d="M12 .9a11.1 11.1 0 0 0-3.5 21.6c.6.1.8-.3.8-.6v-2.2c-3.4.7-4.1-1.4-4.1-1.4-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.4 3.8 18.4 4 18.4 4c.6 1.6.2 2.9.1 3.2.8.9 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.1 11.1 0 0 0 12 .9Z"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
    moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v5h16v-5"/></>,
    branch: <><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 7v10M8 7c0 3 2 5 8 5"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h7v18h-7"/></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 11M5.5 15A7 7 0 0 0 18 17.5l2-4.5"/></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.8 8.4 7 10 4.2-1.6 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    folder: <path d="M3 6h7l2 2h9v11H3V6Z"/>,
    file: <><path d="M6 2h8l4 4v16H6V2Z"/><path d="M14 2v5h5"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></>
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill={name === 'github' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function StatusPill({ status }: { status: ChangeStatus }) {
  return <span className={`status status-${status}`}>{status}</span>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

function Toggle({ checked, onChange, label, description, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return <label className={`toggle-row ${disabled ? 'disabled' : ''}`}>
    <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
    <span className="toggle" aria-hidden="true"><span /></span>
  </label>;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('zipship-theme') as Theme) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [repoSearch, setRepoSearch] = useState('');
  const [repoId, setRepoId] = useState<number | null>(null);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branch, setBranch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [targetFolder, setTargetFolder] = useState('');
  const [stripRoot, setStripRoot] = useState(true);
  const [mode, setMode] = useState<UploadMode>('overlay');
  const [commitMessage, setCommitMessage] = useState('Upload project with ZipShip');
  const [useNewBranch, setUseNewBranch] = useState(true);
  const [newBranch, setNewBranch] = useState('');
  const [openPr, setOpenPr] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [busy, setBusy] = useState<'repos' | 'branches' | 'preview' | 'publish' | null>(null);
  const [error, setError] = useState('');
  const [deferredInstall, setDeferredInstall] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosInstall, setShowIosInstall] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedRepo = repos.find((repo) => repo.id === repoId) ?? null;
  const filteredRepos = useMemo(() => repos.filter((repo) => repo.fullName.toLowerCase().includes(repoSearch.toLowerCase())), [repos, repoSearch]);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('zipship-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111827' : '#f8fafc');
  }, [theme]);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setDeferredInstall(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const authError = params.get('error');
    if (authError) setError(authError);
    if (params.has('signedIn') || authError) history.replaceState({}, '', '/');

    Promise.all([
      api<AppConfig>('/api/config'),
      api<{ authenticated: boolean; user?: UserProfile }>('/api/me').catch((requestError: unknown) => {
        if (requestError instanceof ApiError && requestError.status === 401) return { authenticated: false };
        throw requestError;
      })
    ])
      .then(([appConfig, me]) => {
        setConfig(appConfig);
        if (me.authenticated && 'user' in me && me.user) setUser(me.user);
      })
      .catch((requestError: unknown) => setError(requestError instanceof Error ? requestError.message : 'Unable to start ZipShip.'))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    setBusy('repos');
    api<{ repositories: RepoSummary[] }>('/api/repos')
      .then(({ repositories }) => {
        setRepos(repositories);
        const remembered = Number(localStorage.getItem('zipship-repo-id'));
        const preferred = repositories.find((repo) => repo.id === remembered) ?? repositories[0];
        if (preferred) setRepoId(preferred.id);
      })
      .catch(handleError)
      .finally(() => setBusy(null));
  }, [user]);

  useEffect(() => {
    if (!selectedRepo) {
      setBranches([]);
      setBranch('');
      return;
    }
    localStorage.setItem('zipship-repo-id', String(selectedRepo.id));
    setPreview(null);
    setResult(null);
    setBusy('branches');
    const params = new URLSearchParams({
      installationId: String(selectedRepo.installationId),
      owner: selectedRepo.owner,
      repo: selectedRepo.name
    });
    api<{ branches: BranchSummary[] }>(`/api/branches?${params}`)
      .then(({ branches: nextBranches }) => {
        setBranches(nextBranches);
        setBranch(nextBranches.some((item) => item.name === selectedRepo.defaultBranch) ? selectedRepo.defaultBranch : nextBranches[0]?.name ?? '');
      })
      .catch(handleError)
      .finally(() => setBusy(null));
  }, [selectedRepo?.id]);

  function handleError(requestError: unknown) {
    const message = requestError instanceof Error ? requestError.message : 'Something went wrong.';
    setError(message);
    if (requestError instanceof ApiError && requestError.status === 401) {
      setUser(null);
      setRepos([]);
    }
  }

  function invalidatePreview() {
    setPreview(null);
    setResult(null);
    setError('');
  }

  function chooseFile(nextFile: File | null) {
    if (nextFile && !nextFile.name.toLowerCase().endsWith('.zip')) {
      setError('Please choose a .zip file.');
      return;
    }
    setFile(nextFile);
    invalidatePreview();
    if (nextFile && commitMessage === 'Upload project with ZipShip') {
      setCommitMessage(`Upload ${nextFile.name.replace(/\.zip$/i, '')} with ZipShip`);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    chooseFile(event.dataTransfer.files[0] ?? null);
  }

  function buildFormData(includePublishSettings = false): FormData {
    if (!selectedRepo || !file || !branch) throw new Error('Select a repository, branch, and ZIP archive.');
    const data = new FormData();
    data.append('zip', file);
    data.append('installationId', String(selectedRepo.installationId));
    data.append('owner', selectedRepo.owner);
    data.append('repo', selectedRepo.name);
    data.append('branch', branch);
    data.append('targetFolder', targetFolder);
    data.append('stripRoot', String(stripRoot));
    data.append('mode', mode);
    if (includePublishSettings) {
      data.append('commitMessage', commitMessage);
      data.append('useNewBranch', String(useNewBranch));
      data.append('newBranch', newBranch);
      data.append('openPr', String(openPr));
    }
    return data;
  }

  async function previewUpload(event?: FormEvent) {
    event?.preventDefault();
    setError('');
    setResult(null);
    try {
      setBusy('preview');
      const response = await api<PreviewResult>('/api/preview', {
        method: 'POST',
        headers: { 'x-zipship-request': '1' },
        body: buildFormData(false)
      });
      setPreview(response);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    if (!preview) {
      setError('Preview the ZIP before publishing.');
      return;
    }
    if (mode === 'mirror' && !window.confirm('Mirror mode deletes repository files that are absent from the ZIP within the selected target folder. Continue?')) return;
    setError('');
    try {
      setBusy('publish');
      const response = await api<PublishResult>('/api/publish', {
        method: 'POST',
        headers: { 'x-zipship-request': '1' },
        body: buildFormData(true)
      });
      setResult(response);
      if (!response.noChanges) setPreview(null);
    } catch (requestError) {
      handleError(requestError);
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    await api<void>('/api/auth/logout', { method: 'POST', headers: { 'x-zipship-request': '1' } });
    setUser(null);
    setRepos([]);
    setRepoId(null);
    setPreview(null);
    setResult(null);
  }

  async function installPwa() {
    if (deferredInstall) {
      await deferredInstall.prompt();
      await deferredInstall.userChoice;
      setDeferredInstall(null);
    } else if (isIos) {
      setShowIosInstall(true);
    }
  }

  if (booting) {
    return <div className="loading-screen"><div className="brand-mark"><Icon name="zip" size={30} /></div><span className="spinner" />Loading ZipShip…</div>;
  }

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="ZipShip home"><span className="brand-mark"><Icon name="zip" size={25} /></span><span>ZipShip<small>GitHub publisher</small></span></a>
      <div className="top-actions">
        {!isStandalone && (deferredInstall || isIos) && <button className="button ghost compact" onClick={installPwa}><Icon name="download" size={18} /><span className="hide-mobile">Install app</span></button>}
        <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        {user && <div className="user-menu"><img src={user.avatarUrl} alt="" /><span className="hide-mobile">{user.name || user.login}</span><button className="icon-button small" onClick={signOut} aria-label="Sign out"><Icon name="logout" size={17} /></button></div>}
      </div>
    </header>

    <main>
      {error && <div className="notice error" role="alert"><strong>Unable to continue</strong><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
      {showIosInstall && <div className="notice info"><strong>Install on iPhone</strong><span>In Safari, tap Share, then “Add to Home Screen,” and confirm Add.</span><button onClick={() => setShowIosInstall(false)} aria-label="Dismiss">×</button></div>}

      {!config?.configured ? <SetupRequired /> : !user ? <LoginScreen /> : <>
        <section className="hero">
          <div><span className="eyebrow"><Icon name="shield" size={16} /> Secure ZIP publishing</span><h1>Ship a project to GitHub from your phone.</h1><p>Choose a repository, preview every change, then publish the archive as one clean commit.</p></div>
          <div className="hero-badge"><Icon name="github" size={32} /><span><strong>{repos.length || '—'}</strong> accessible repositories</span></div>
        </section>

        <div className="workspace">
          <form className="workflow" onSubmit={previewUpload}>
            <section className="card step-card">
              <div className="step-heading"><span className="step-number">1</span><div><h2>Destination</h2><p>Select the repository and base branch.</p></div></div>
              <div className="field-grid two">
                <Field label="Repository">
                  <div className="select-with-search">
                    <input className="repo-search" value={repoSearch} onChange={(event) => setRepoSearch(event.target.value)} placeholder="Search repositories" aria-label="Search repositories" />
                    <select value={repoId ?? ''} onChange={(event) => setRepoId(Number(event.target.value))} disabled={busy === 'repos' || repos.length === 0}>
                      {filteredRepos.length === 0 && <option value="">No repositories found</option>}
                      {filteredRepos.map((repo) => <option key={repo.id} value={repo.id}>{repo.fullName}{repo.private ? ' · private' : ''}</option>)}
                    </select>
                  </div>
                </Field>
                <Field label="Base branch">
                  <select value={branch} onChange={(event) => { setBranch(event.target.value); invalidatePreview(); }} disabled={!selectedRepo || busy === 'branches'}>
                    {branches.map((item) => <option key={item.name} value={item.name}>{item.name}{item.protected ? ' · protected' : ''}</option>)}
                  </select>
                </Field>
              </div>
              {config.installUrl && <a className="inline-link" href={config.installUrl} target="_blank" rel="noreferrer"><Icon name="github" size={17} /> Add or change repository access <Icon name="external" size={15} /></a>}
            </section>

            <section className="card step-card">
              <div className="step-heading"><span className="step-number">2</span><div><h2>ZIP archive</h2><p>Files are validated and compared before anything is committed.</p></div></div>
              <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
              <div className={`drop-zone ${file ? 'has-file' : ''}`} onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={onDrop} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInput.current?.click(); }}>
                <span className="drop-icon"><Icon name={file ? 'check' : 'upload'} size={30} /></span>
                {file ? <><strong>{file.name}</strong><span>{formatBytes(file.size)} · Tap to replace</span></> : <><strong>Select a ZIP from Files</strong><span>or drag and drop · up to {config.limits.maxZipMb} MB</span></>}
              </div>
              <div className="field-grid two settings-grid">
                <Field label="Target folder" hint="Leave empty to publish at the repository root."><input value={targetFolder} onChange={(event) => { setTargetFolder(event.target.value); invalidatePreview(); }} placeholder="example: apps/viewer" /></Field>
                <Field label="Upload behavior">
                  <select value={mode} onChange={(event) => { setMode(event.target.value as UploadMode); invalidatePreview(); }}>
                    <option value="overlay">Overlay — add and update only</option>
                    <option value="mirror">Mirror — also delete missing files</option>
                  </select>
                </Field>
              </div>
              <Toggle checked={stripRoot} onChange={(checked) => { setStripRoot(checked); invalidatePreview(); }} label="Remove a common ZIP root folder" description="Useful when the archive contains one wrapping project folder." />
              <button className="button primary full" type="submit" disabled={!selectedRepo || !branch || !file || busy !== null}>
                {busy === 'preview' ? <><span className="spinner small" />Inspecting archive…</> : <><Icon name="refresh" size={18} />Preview GitHub changes</>}
              </button>
            </section>

            <section className="card step-card">
              <div className="step-heading"><span className="step-number">3</span><div><h2>Publish</h2><p>Create a commit directly or open a safer pull request.</p></div></div>
              <Field label="Commit message"><input value={commitMessage} maxLength={500} onChange={(event) => setCommitMessage(event.target.value)} /></Field>
              <Toggle checked={useNewBranch} onChange={(checked) => { setUseNewBranch(checked); if (!checked) setOpenPr(false); }} label="Create a new branch" description="Recommended, especially for protected default branches." />
              {useNewBranch && <div className="nested-settings">
                <Field label="New branch name" hint="Leave empty to generate a timestamped zipship branch."><input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="zipship/my-update" /></Field>
                <Toggle checked={openPr} onChange={setOpenPr} label="Open a pull request" description={`Merge the new branch into ${branch || 'the base branch'}.`} />
              </div>}
              <button className="button success full" type="button" disabled={!preview || !commitMessage.trim() || busy !== null} onClick={publish}>
                {busy === 'publish' ? <><span className="spinner small" />Publishing to GitHub…</> : <><Icon name="github" size={19} />Publish {preview ? preview.counts.added + preview.counts.modified : 0} changed files</>}
              </button>
            </section>
          </form>

          <aside className="preview-panel">
            <section className="card preview-card">
              <div className="preview-title"><div><span className="eyebrow">Change preview</span><h2>{preview ? 'Ready to publish' : 'No preview yet'}</h2></div>{preview && <span className="file-total">{preview.files.length} files</span>}</div>
              {!preview ? <div className="empty-state"><span><Icon name="folder" size={34} /></span><strong>Your file changes will appear here</strong><p>Select a ZIP and tap Preview GitHub changes.</p></div> : <>
                <div className="summary-grid">
                  {(['added', 'modified', 'deleted', 'unchanged'] as ChangeStatus[]).map((status) => <div key={status}><strong>{preview.counts[status]}</strong><span>{status}</span></div>)}
                </div>
                <div className="preview-meta"><span><Icon name="file" size={16} />{formatBytes(preview.totalBytes)} extracted</span>{preview.ignored.length > 0 && <span>{preview.ignored.length} ignored</span>}</div>
                {preview.archiveWarnings.map((warning) => <div className="warning" key={warning}>⚠ {warning}</div>)}
                <div className="file-list">
                  {preview.files.map((item) => <div className="file-row" key={`${item.status}:${item.path}`}><div><span className="file-path">{item.path}</span><span className="file-size">{formatBytes(item.size)}</span>{item.warnings.map((warning) => <span className="file-warning" key={warning}>{warning}</span>)}</div><StatusPill status={item.status} /></div>)}
                </div>
              </>}
            </section>

            {result && <section className={`card result-card ${result.noChanges ? 'neutral' : ''}`}>
              <span className="result-icon"><Icon name="check" size={28} /></span>
              <div><h3>{result.noChanges ? 'Nothing to publish' : 'Published successfully'}</h3><p>{result.message || `Committed to ${result.branch}.`}</p>
                <div className="result-links">
                  {result.commit && <a href={result.commit.htmlUrl} target="_blank" rel="noreferrer">View commit <Icon name="external" size={14} /></a>}
                  {result.pullRequest && <a href={result.pullRequest.htmlUrl} target="_blank" rel="noreferrer">Open pull request #{result.pullRequest.number} <Icon name="external" size={14} /></a>}
                </div>
              </div>
            </section>}
          </aside>
        </div>
      </>}
    </main>
    <footer><span><Icon name="shield" size={15} /> ZIPs are processed in memory and are not stored.</span><span>ZipShip · React + Node + GitHub App</span></footer>
  </div>;

  function LoginScreen() {
    return <section className="login-screen"><div className="login-art"><span className="brand-mark large"><Icon name="zip" size={42} /></span><div className="orbit orbit-one" /><div className="orbit orbit-two" /></div><div className="login-copy"><span className="eyebrow">Installable iPhone PWA</span><h1>Turn any project ZIP into a clean GitHub commit.</h1><p>Sign in once, select repositories you trust, and stay signed in securely between visits.</p><a className="button github large-button" href="/api/auth/github"><Icon name="github" size={22} />Continue with GitHub</a><div className="login-points"><span><Icon name="shield" size={18} />Encrypted sign-in cookie</span><span><Icon name="branch" size={18} />Branch and PR workflow</span><span><Icon name="upload" size={18} />Safe ZIP validation</span></div></div></section>;
  }

  function SetupRequired() {
    return <section className="setup-card card"><span className="brand-mark large"><Icon name="zip" size={38} /></span><span className="eyebrow">Configuration required</span><h1>Connect your GitHub App</h1><p>The web service is running, but its GitHub credentials are missing. Add the required environment variables in Render, then redeploy.</p><code>GITHUB_APP_ID · GITHUB_CLIENT_ID · GITHUB_CLIENT_SECRET · GITHUB_PRIVATE_KEY_BASE64 · SESSION_SECRET</code><p className="muted">Follow <strong>SETUP_RENDER.md</strong> included in the project.</p></section>;
  }
}
