import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type {
  AppConfig, BranchSummary, ChangeStatus, PreviewResult, PublishResult, RepoSummary,
  RevertPreview, RevertResult, UserProfile
} from './types';

type Theme = 'light' | 'dark';
type Tab = 'upload' | 'revert';
type UploadMode = 'overlay' | 'mirror';
type RevertDelivery = 'pull_request' | 'direct';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  if (response.status === 204) return undefined as T;
  let body: unknown = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : 'Request failed.';
    throw new ApiError(message, response.status);
  }
  return body as T;
}

function Icon({ name, size = 20 }: { name: 'zip' | 'github' | 'sun' | 'moon' | 'upload' | 'branch' | 'check' | 'logout' | 'download' | 'refresh' | 'shield' | 'folder' | 'file' | 'external' | 'undo' | 'warning'; size?: number }) {
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
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v7H4V6h7"/></>,
    undo: <><path d="M9 8 4 12l5 4"/><path d="M5 12h8a6 6 0 0 1 6 6v1"/></>,
    warning: <><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5M12 17.5h.01"/></>
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill={name === 'github' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: string }) {
  return <label className="toggle-row"><span><strong>{label}</strong>{description && <small>{description}</small>}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle" aria-hidden="true"><span /></span></label>;
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB']; let value = bytes / 1024; let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) { value /= 1024; unit = units[index]; }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}
function shortSha(sha: string): string { return sha.slice(0, 7); }
function firstLine(message: string): string { return message.split('\n')[0]; }
function formatDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Unknown date';
}
function StatusPill({ status }: { status: ChangeStatus }) { return <span className={`status status-${status}`}>{status}</span>; }

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('zipship-theme') as Theme) || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [tab, setTab] = useState<Tab>('upload');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [repoSearch, setRepoSearch] = useState('');
  const [repoId, setRepoId] = useState<number | null>(null);
  const [branches, setBranches] = useState<BranchSummary[]>([]);
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [deferredInstall, setDeferredInstall] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosInstall, setShowIosInstall] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [targetFolder, setTargetFolder] = useState('');
  const [stripRoot, setStripRoot] = useState(true);
  const [mode, setMode] = useState<UploadMode>('overlay');
  const [commitMessage, setCommitMessage] = useState('Upload project with ZipShip');
  const [useNewBranch, setUseNewBranch] = useState(true);
  const [newBranch, setNewBranch] = useState('');
  const [openPr, setOpenPr] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [revertPreview, setRevertPreview] = useState<RevertPreview | null>(null);
  const [selectedParentSha, setSelectedParentSha] = useState('');
  const [revertDelivery, setRevertDelivery] = useState<RevertDelivery>('pull_request');
  const [revertBranch, setRevertBranch] = useState('');
  const [revertMessage, setRevertMessage] = useState('');
  const [revertResult, setRevertResult] = useState<RevertResult | null>(null);

  const selectedRepo = repos.find((repo) => repo.id === repoId) ?? null;
  const selectedBranchInfo = branches.find((item) => item.name === branch) ?? null;
  const filteredRepos = useMemo(() => repos.filter((repo) => repo.fullName.toLowerCase().includes(repoSearch.toLowerCase())), [repos, repoSearch]);
  const isStandalone = matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('zipship-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111827' : '#f8fafc');
  }, [theme]);
  useEffect(() => {
    const handler = (event: Event) => { event.preventDefault(); setDeferredInstall(event as BeforeInstallPromptEvent); };
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
    ]).then(([appConfig, me]) => {
      setConfig(appConfig);
      if (me.authenticated && 'user' in me && me.user) setUser(me.user);
    }).catch(handleError).finally(() => setBooting(false));
  }, []);
  useEffect(() => {
    if (!user) return;
    setBusy('repos');
    api<{ repositories: RepoSummary[] }>('/api/repos').then(({ repositories }) => {
      setRepos(repositories);
      const remembered = Number(localStorage.getItem('zipship-repo-id'));
      const preferred = repositories.find((repo) => repo.id === remembered) ?? repositories[0];
      if (preferred) setRepoId(preferred.id);
    }).catch(handleError).finally(() => setBusy(null));
  }, [user]);
  useEffect(() => {
    setPreview(null); setPublishResult(null); setRevertPreview(null); setRevertResult(null); setSelectedParentSha('');
    if (!selectedRepo) { setBranches([]); setBranch(''); return; }
    localStorage.setItem('zipship-repo-id', String(selectedRepo.id));
    setBusy('branches');
    const params = new URLSearchParams({ installationId: String(selectedRepo.installationId), owner: selectedRepo.owner, repo: selectedRepo.name });
    api<{ branches: BranchSummary[] }>(`/api/branches?${params}`).then(({ branches: next }) => {
      setBranches(next);
      setBranch(next.some((item) => item.name === selectedRepo.defaultBranch) ? selectedRepo.defaultBranch : next[0]?.name ?? '');
    }).catch(handleError).finally(() => setBusy(null));
  }, [selectedRepo?.id]);
  useEffect(() => {
    setPreview(null); setPublishResult(null); setRevertPreview(null); setRevertResult(null); setSelectedParentSha('');
  }, [branch]);

  function handleError(requestError: unknown) {
    setError(requestError instanceof Error ? requestError.message : 'Something went wrong.');
    if (requestError instanceof ApiError && requestError.status === 401) { setUser(null); setRepos([]); }
  }
  function chooseFile(next: File | null) {
    if (next && !next.name.toLowerCase().endsWith('.zip')) { setError('Please choose a .zip file.'); return; }
    setFile(next); setPreview(null); setPublishResult(null); setError('');
    if (next && commitMessage === 'Upload project with ZipShip') setCommitMessage(`Upload ${next.name.replace(/\.zip$/i, '')} with ZipShip`);
  }
  function buildUploadForm(includePublish: boolean): FormData {
    if (!selectedRepo || !branch || !file) throw new Error('Select a repository, branch, and ZIP archive.');
    const data = new FormData();
    data.append('zip', file); data.append('installationId', String(selectedRepo.installationId)); data.append('owner', selectedRepo.owner);
    data.append('repo', selectedRepo.name); data.append('branch', branch); data.append('targetFolder', targetFolder);
    data.append('stripRoot', String(stripRoot)); data.append('mode', mode);
    if (includePublish) {
      data.append('commitMessage', commitMessage); data.append('useNewBranch', String(useNewBranch));
      data.append('newBranch', newBranch); data.append('openPr', String(openPr));
    }
    return data;
  }
  async function previewUpload(event?: FormEvent) {
    event?.preventDefault(); setError(''); setPublishResult(null); setBusy('preview');
    try { setPreview(await api<PreviewResult>('/api/preview', { method: 'POST', headers: { 'x-zipship-request': '1' }, body: buildUploadForm(false) })); }
    catch (requestError) { handleError(requestError); }
    finally { setBusy(null); }
  }
  async function publish() {
    if (!preview) { setError('Preview the ZIP before publishing.'); return; }
    if (mode === 'mirror' && !confirm('Mirror mode deletes repository files absent from the ZIP within the selected target folder. Continue?')) return;
    setError(''); setBusy('publish');
    try {
      const result = await api<PublishResult>('/api/publish', { method: 'POST', headers: { 'x-zipship-request': '1' }, body: buildUploadForm(true) });
      setPublishResult(result); if (!result.noChanges) setPreview(null);
    } catch (requestError) { handleError(requestError); }
    finally { setBusy(null); }
  }
  async function loadRevertPreview(parentSha?: string) {
    if (!selectedRepo || !branch) { setError('Select a repository and branch.'); return; }
    setError(''); setRevertResult(null); setBusy('revert-preview');
    try {
      const params = new URLSearchParams({ installationId: String(selectedRepo.installationId), owner: selectedRepo.owner, repo: selectedRepo.name, branch });
      if (parentSha) params.set('parentSha', parentSha);
      const result = await api<RevertPreview>(`/api/revert-preview?${params}`);
      setRevertPreview(result);
      const chosen = result.selectedParent?.sha ?? result.parents[0]?.sha ?? '';
      setSelectedParentSha(chosen);
      if (result.canRevert) {
        setRevertMessage(`Revert \"${firstLine(result.head.message)}\"`);
        setRevertBranch(`zipship/revert-${shortSha(result.head.sha)}`);
        setRevertDelivery(result.protected ? 'pull_request' : 'pull_request');
      }
    } catch (requestError) { handleError(requestError); }
    finally { setBusy(null); }
  }
  async function changeParent(sha: string) { setSelectedParentSha(sha); await loadRevertPreview(sha); }
  async function executeRevert() {
    if (!selectedRepo || !branch || !revertPreview?.canRevert || !selectedParentSha) return;
    const warning = revertDelivery === 'direct'
      ? `Create a revert commit directly on ${branch}? This preserves history but changes the selected branch immediately.`
      : `Create a revert branch and pull request into ${branch}?`;
    if (!confirm(warning)) return;
    setError(''); setBusy('revert');
    try {
      const result = await api<RevertResult>('/api/revert', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-zipship-request': '1' },
        body: JSON.stringify({
          installationId: selectedRepo.installationId, owner: selectedRepo.owner, repo: selectedRepo.name, branch,
          expectedHeadSha: revertPreview.head.sha, selectedParentSha, delivery: revertDelivery,
          newBranch: revertBranch, commitMessage: revertMessage
        })
      });
      setRevertResult(result); setRevertPreview(null);
    } catch (requestError) { handleError(requestError); }
    finally { setBusy(null); }
  }
  async function signOut() {
    await api<void>('/api/auth/logout', { method: 'POST', headers: { 'x-zipship-request': '1' } });
    setUser(null); setRepos([]); setRepoId(null);
  }
  async function installPwa() {
    if (deferredInstall) { await deferredInstall.prompt(); await deferredInstall.userChoice; setDeferredInstall(null); }
    else if (isIos) setShowIosInstall(true);
  }

  if (booting) return <div className="loading-screen"><span className="brand-mark"><Icon name="zip" size={28} /></span><span className="spinner" />Loading ZipShip…</div>;
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/"><span className="brand-mark"><Icon name="zip" size={25} /></span><span>ZipShip<small>GitHub publisher</small></span></a>
      <div className="top-actions">
        {!isStandalone && (deferredInstall || isIos) && <button className="button ghost compact" onClick={installPwa}><Icon name="download" size={17} /><span className="hide-mobile">Install</span></button>}
        <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        {user && <div className="user-menu"><img src={user.avatarUrl} alt="" /><span className="hide-mobile">{user.name || user.login}</span><button className="icon-button small" onClick={signOut} aria-label="Sign out"><Icon name="logout" size={17} /></button></div>}
      </div>
    </header>
    <main>
      {error && <div className="notice error" role="alert"><strong>Unable to continue</strong><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
      {showIosInstall && <div className="notice info"><strong>Install on iPhone</strong><span>In Safari, tap Share, then Add to Home Screen.</span><button onClick={() => setShowIosInstall(false)}>×</button></div>}
      {!config?.configured ? <SetupRequired /> : !user ? <LoginScreen /> : <>
        <section className="hero"><div><span className="eyebrow"><Icon name="shield" size={16} /> Safe GitHub operations</span><h1>Publish projects. Undo mistakes.</h1><p>Upload a ZIP as one commit or safely restore a branch to its previous file state without deleting history.</p></div></section>
        <section className="card destination-card">
          <div className="section-heading"><div><span className="step-number">1</span><div><h2>Choose destination</h2><p>The repository and branch are shared by both tools.</p></div></div>{config.installUrl && <a className="inline-link" href={config.installUrl} target="_blank" rel="noreferrer">Repository access <Icon name="external" size={14} /></a>}</div>
          <div className="field-grid two">
            <Field label="Repository"><div className="select-with-search"><input value={repoSearch} onChange={(event) => setRepoSearch(event.target.value)} placeholder="Search repositories" /><select value={repoId ?? ''} onChange={(event) => setRepoId(Number(event.target.value))} disabled={busy === 'repos'}>{filteredRepos.map((repo) => <option key={repo.id} value={repo.id}>{repo.fullName}{repo.private ? ' · private' : ''}</option>)}</select></div></Field>
            <Field label="Branch"><select value={branch} onChange={(event) => setBranch(event.target.value)} disabled={!selectedRepo || busy === 'branches'}>{branches.map((item) => <option key={item.name} value={item.name}>{item.name}{item.protected ? ' · protected' : ''}</option>)}</select></Field>
          </div>
        </section>
        <div className="tool-tabs" role="tablist">
          <button className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}><Icon name="upload" size={18} />Publish ZIP</button>
          <button className={tab === 'revert' ? 'active' : ''} onClick={() => setTab('revert')}><Icon name="undo" size={18} />Undo latest commit</button>
        </div>
        {tab === 'upload' ? <div className="workspace">
          <form className="workflow" onSubmit={previewUpload}>
            <section className="card step-card"><div className="step-heading"><span className="step-number">2</span><div><h2>ZIP archive</h2><p>Validate and compare files before publishing.</p></div></div>
              <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
              <div className={`drop-zone ${file ? 'has-file' : ''}`} onClick={() => fileInput.current?.click()} role="button" tabIndex={0}><span className="drop-icon"><Icon name={file ? 'check' : 'upload'} size={29} /></span>{file ? <><strong>{file.name}</strong><span>{formatBytes(file.size)} · tap to replace</span></> : <><strong>Select a ZIP from Files</strong><span>Maximum {config.limits.maxZipMb} MB</span></>}</div>
              <div className="field-grid two settings-grid"><Field label="Target folder" hint="Leave empty for repository root."><input value={targetFolder} onChange={(event) => { setTargetFolder(event.target.value); setPreview(null); }} placeholder="apps/viewer" /></Field><Field label="Upload behavior"><select value={mode} onChange={(event) => { setMode(event.target.value as UploadMode); setPreview(null); }}><option value="overlay">Overlay — add and update</option><option value="mirror">Mirror — also delete missing</option></select></Field></div>
              <Toggle checked={stripRoot} onChange={(checked) => { setStripRoot(checked); setPreview(null); }} label="Remove common ZIP root folder" description="Useful when the archive contains one wrapping project folder." />
              <button className="button primary full" disabled={!file || !branch || busy !== null}>{busy === 'preview' ? <><span className="spinner small" />Inspecting…</> : <><Icon name="refresh" size={18} />Preview changes</>}</button>
            </section>
            <section className="card step-card"><div className="step-heading"><span className="step-number">3</span><div><h2>Publish</h2><p>Create a new branch and pull request by default.</p></div></div>
              <Field label="Commit message"><input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} maxLength={500} /></Field>
              <Toggle checked={useNewBranch} onChange={(checked) => { setUseNewBranch(checked); if (!checked) setOpenPr(false); }} label="Create a new branch" description="Recommended for protected or important branches." />
              {useNewBranch && <div className="nested-settings"><Field label="New branch name" hint="Leave empty for an automatic name."><input value={newBranch} onChange={(event) => setNewBranch(event.target.value)} placeholder="zipship/my-update" /></Field><Toggle checked={openPr} onChange={setOpenPr} label="Open a pull request" description={`Merge into ${branch || 'the selected branch'}.`} /></div>}
              <button className="button success full" type="button" onClick={publish} disabled={!preview || !commitMessage.trim() || busy !== null}>{busy === 'publish' ? <><span className="spinner small" />Publishing…</> : <><Icon name="github" size={18} />Publish changes</>}</button>
            </section>
          </form>
          <aside className="preview-panel"><UploadPreview preview={preview} result={publishResult} /></aside>
        </div> : <div className="revert-workspace">
          <section className="card step-card revert-control"><div className="step-heading"><span className="step-number"><Icon name="undo" size={18} /></span><div><h2>Undo the latest commit</h2><p>Creates a new commit that restores the selected parent state. Existing history remains intact.</p></div></div>
            {!revertPreview && !revertResult && <div className="safe-box"><Icon name="shield" size={24} /><div><strong>History-preserving undo</strong><p>ZipShip will not force-reset the branch. It restores the previous tree in a new commit.</p></div></div>}
            <button className="button primary full" type="button" onClick={() => loadRevertPreview()} disabled={!selectedRepo || !branch || busy !== null}>{busy === 'revert-preview' ? <><span className="spinner small" />Loading latest commit…</> : <><Icon name="refresh" size={18} />Preview undo</>}</button>
            {revertPreview?.canRevert && <div className="revert-settings">
              {revertPreview.parents.length > 1 && <Field label="Restore parent" hint="Merge commits have multiple parents. The first parent is usually the branch state before the merge."><select value={selectedParentSha} onChange={(event) => changeParent(event.target.value)}>{revertPreview.parents.map((parent, index) => <option value={parent.sha} key={parent.sha}>{index === 0 ? 'First parent · ' : `Parent ${index + 1} · `}{shortSha(parent.sha)} · {firstLine(parent.message)}</option>)}</select></Field>}
              <Field label="Delivery"><select value={revertDelivery} onChange={(event) => setRevertDelivery(event.target.value as RevertDelivery)}><option value="pull_request">Create revert branch and pull request — recommended</option><option value="direct">Revert directly on selected branch</option></select></Field>
              {revertDelivery === 'pull_request' && <Field label="Revert branch"><input value={revertBranch} onChange={(event) => setRevertBranch(event.target.value)} /></Field>}
              <Field label="Revert commit message"><input value={revertMessage} onChange={(event) => setRevertMessage(event.target.value)} maxLength={500} /></Field>
              {revertDelivery === 'direct' && <div className="warning"><Icon name="warning" size={17} />This immediately updates <strong>{branch}</strong>. Protected branch rules may reject it.</div>}
              <button className="button danger full" type="button" onClick={executeRevert} disabled={!revertMessage.trim() || (revertDelivery === 'pull_request' && !revertBranch.trim()) || busy !== null}>{busy === 'revert' ? <><span className="spinner small" />Creating revert…</> : <><Icon name="undo" size={18} />{revertDelivery === 'pull_request' ? 'Create revert pull request' : `Revert ${branch} now`}</>}</button>
            </div>}
          </section>
          <aside className="preview-panel"><RevertDetails preview={revertPreview} result={revertResult} protectedBranch={Boolean(selectedBranchInfo?.protected)} /></aside>
        </div>}
      </>}
    </main>
    <footer><span><Icon name="shield" size={15} /> ZIPs are processed in memory. Reverts preserve Git history.</span><span>ZipShip v1.1.0</span></footer>
  </div>;

  function LoginScreen() {
    return <section className="login-screen"><div className="login-art"><span className="brand-mark large"><Icon name="zip" size={42} /></span><div className="orbit orbit-one" /><div className="orbit orbit-two" /></div><div className="login-copy"><span className="eyebrow">Installable iPhone PWA</span><h1>Ship projects and recover safely.</h1><p>Sign in once, publish ZIP archives, and undo the latest branch commit without rewriting history.</p><a className="button github large-button" href="/api/auth/github"><Icon name="github" size={22} />Continue with GitHub</a></div></section>;
  }
  function SetupRequired() {
    return <section className="setup-card card"><span className="brand-mark large"><Icon name="zip" size={38} /></span><span className="eyebrow">Configuration required</span><h1>Connect your GitHub App</h1><p>Add the required GitHub App environment variables in Render and redeploy.</p><code>GITHUB_APP_ID · GITHUB_CLIENT_ID · GITHUB_CLIENT_SECRET · GITHUB_PRIVATE_KEY_BASE64 · SESSION_SECRET</code></section>;
  }
}

function UploadPreview({ preview, result }: { preview: PreviewResult | null; result: PublishResult | null }) {
  return <><section className="card preview-card"><div className="preview-title"><div><span className="eyebrow">Change preview</span><h2>{preview ? 'Ready to publish' : 'No preview yet'}</h2></div>{preview && <span className="file-total">{preview.files.length} files</span>}</div>
    {!preview ? <div className="empty-state"><span><Icon name="folder" size={34} /></span><strong>Your ZIP changes appear here</strong><p>Select an archive and preview it.</p></div> : <><div className="summary-grid">{(['added', 'modified', 'deleted', 'unchanged'] as ChangeStatus[]).map((status) => <div key={status}><strong>{preview.counts[status]}</strong><span>{status}</span></div>)}</div>{preview.archiveWarnings.map((warning) => <div className="warning" key={warning}>{warning}</div>)}<div className="file-list">{preview.files.map((item) => <div className="file-row" key={`${item.status}:${item.path}`}><div><span className="file-path">{item.path}</span><span className="file-size">{formatBytes(item.size)}</span>{item.warnings.map((warning) => <span className="file-warning" key={warning}>{warning}</span>)}</div><StatusPill status={item.status} /></div>)}</div></>}
  </section>{result && <ResultCard title={result.noChanges ? 'Nothing to publish' : 'Published successfully'} description={result.message || `Committed to ${result.branch}.`} commitUrl={result.commit?.htmlUrl} pr={result.pullRequest} />}</>;
}

function RevertDetails({ preview, result, protectedBranch }: { preview: RevertPreview | null; result: RevertResult | null; protectedBranch: boolean }) {
  if (result) return <ResultCard title={result.delivery === 'pull_request' ? 'Revert pull request created' : 'Branch reverted'} description={`Restored the file state of ${shortSha(result.restoredTo.sha)} while preserving history.`} commitUrl={result.commit.htmlUrl} pr={result.pullRequest} />;
  return <section className="card preview-card revert-preview-card"><div className="preview-title"><div><span className="eyebrow">Undo preview</span><h2>{preview ? (preview.canRevert ? 'Review restore point' : 'Cannot undo') : 'No undo preview yet'}</h2></div>{(preview?.protected || protectedBranch) && <span className="protected-pill"><Icon name="shield" size={13} />Protected</span>}</div>
    {!preview ? <div className="empty-state"><span><Icon name="undo" size={34} /></span><strong>Inspect the latest branch commit</strong><p>ZipShip will show exactly what an undo restores or removes.</p></div> : !preview.canRevert ? <div className="empty-state"><span><Icon name="warning" size={34} /></span><strong>No earlier state</strong><p>{preview.reason}</p></div> : <>
      <div className="commit-card current"><span>Commit being undone</span><a href={preview.head.htmlUrl} target="_blank" rel="noreferrer"><code>{shortSha(preview.head.sha)}</code> {firstLine(preview.head.message)} <Icon name="external" size={13} /></a><small>{preview.head.authorName} · {formatDate(preview.head.authorDate)}</small></div>
      {preview.selectedParent && <div className="commit-card parent"><span>File state being restored</span><a href={preview.selectedParent.htmlUrl} target="_blank" rel="noreferrer"><code>{shortSha(preview.selectedParent.sha)}</code> {firstLine(preview.selectedParent.message)} <Icon name="external" size={13} /></a><small>{preview.selectedParent.authorName} · {formatDate(preview.selectedParent.authorDate)}</small></div>}
      <div className="revert-summary"><div><strong>{preview.changes?.files ?? 0}</strong><span>affected files</span></div><div><strong>{(preview.changes?.actionCounts.restore ?? 0) + (preview.changes?.actionCounts['restore content'] ?? 0) + (preview.changes?.actionCounts['restore previous name'] ?? 0)}</strong><span>restored</span></div><div><strong>{preview.changes?.actionCounts.delete ?? 0}</strong><span>removed</span></div></div>
      <div className="file-list">{preview.files?.map((item) => <div className="file-row" key={`${item.status}:${item.path}`}><div><span className="file-path">{item.previousPath ? `${item.previousPath} → ${item.path}` : item.path}</span><span className="file-size">Latest commit: +{item.additions} −{item.deletions}</span></div><span className={`undo-action action-${item.undoAction.replaceAll(' ', '-')}`}>{item.undoAction}</span></div>)}</div>
    </>}
  </section>;
}

function ResultCard({ title, description, commitUrl, pr }: { title: string; description: string; commitUrl?: string; pr?: { number: number; htmlUrl: string } | null }) {
  return <section className="card result-card"><span className="result-icon"><Icon name="check" size={27} /></span><div><h3>{title}</h3><p>{description}</p><div className="result-links">{commitUrl && <a href={commitUrl} target="_blank" rel="noreferrer">View commit <Icon name="external" size={13} /></a>}{pr && <a href={pr.htmlUrl} target="_blank" rel="noreferrer">Open pull request #{pr.number} <Icon name="external" size={13} /></a>}</div></div></section>;
}
