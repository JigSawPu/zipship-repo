import { createHash } from 'node:crypto';
import path from 'node:path';
import JSZip from 'jszip';
import { config } from './config.js';
import type { GitTreeItem, RepoSnapshot } from './github.js';

export type ChangeStatus = 'added' | 'modified' | 'unchanged' | 'deleted';

export interface UploadFile {
  path: string;
  content: Buffer;
  size: number;
  mode: '100644' | '100755';
  gitSha: string;
  warnings: string[];
}

export interface PreviewFile {
  path: string;
  size: number;
  status: ChangeStatus;
  warnings: string[];
}

export interface ArchiveResult {
  files: UploadFile[];
  ignored: string[];
  totalBytes: number;
  commonRoot: string | null;
  warnings: string[];
}

export interface PreviewResult {
  files: PreviewFile[];
  counts: Record<ChangeStatus, number>;
  ignored: string[];
  totalBytes: number;
  archiveWarnings: string[];
  treeTruncated: boolean;
}

const ignoredBasenames = new Set(['.DS_Store', 'Thumbs.db']);
const suspiciousBasenames = [
  /^\.env(?:\.|$)/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)$/i,
  /\.(?:pem|key|p12|pfx)$/i,
  /^credentials(?:\.json)?$/i,
  /^secrets?(?:\.|$)/i
];

const secretPatterns: Array<[RegExp, string]> = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'Private key content detected'],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, 'Possible GitHub token detected'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'Possible AWS access key detected'],
  [/\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?[A-Za-z0-9_./+\-=]{12,}/i, 'Possible embedded credential detected']
];

function normalizeArchivePath(input: string): string {
  const slashPath = input.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!slashPath || slashPath.includes('\0') || slashPath.startsWith('/') || /^[A-Za-z]:\//.test(slashPath)) {
    throw new Error(`Unsafe archive path: ${input}`);
  }
  const normalized = path.posix.normalize(slashPath);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`Unsafe archive path traversal: ${input}`);
  }
  return normalized.replace(/\/$/, '');
}

export function normalizeTargetFolder(input: string): string {
  const trimmed = input.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!trimmed) return '';
  const normalized = normalizeArchivePath(trimmed);
  if (normalized === '.') return '';
  return normalized;
}

function shouldIgnore(filePath: string): boolean {
  const parts = filePath.split('/');
  return parts.includes('.git') || parts.includes('__MACOSX') || ignoredBasenames.has(parts.at(-1) ?? '');
}

function gitBlobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`);
  return createHash('sha1').update(header).update(content).digest('hex');
}

function detectWarnings(filePath: string, content: Buffer): string[] {
  const warnings: string[] = [];
  const base = path.posix.basename(filePath);
  if (suspiciousBasenames.some((pattern) => pattern.test(base))) {
    warnings.push('Sensitive-looking filename');
  }
  if (content.length <= 1024 * 1024) {
    const text = content.toString('utf8');
    for (const [pattern, message] of secretPatterns) {
      if (pattern.test(text)) warnings.push(message);
    }
  }
  return [...new Set(warnings)];
}

function executableMode(unixPermissions: string | number | null | undefined): '100644' | '100755' {
  const permissions = typeof unixPermissions === 'string'
    ? Number.parseInt(unixPermissions, 8)
    : unixPermissions ?? 0;
  return (permissions & 0o111) !== 0 ? '100755' : '100644';
}

function isSymlink(unixPermissions: string | number | null | undefined): boolean {
  const permissions = typeof unixPermissions === 'string'
    ? Number.parseInt(unixPermissions, 8)
    : unixPermissions ?? 0;
  return (permissions & 0o170000) === 0o120000;
}

function findCommonRoot(paths: string[]): string | null {
  if (!paths.length) return null;
  const parts = paths.map((item) => item.split('/'));
  if (parts.some((item) => item.length < 2)) return null;
  const candidate = parts[0][0];
  return parts.every((item) => item[0] === candidate) ? candidate : null;
}

interface ZipInternalData {
  uncompressedSize?: number;
}

export async function readArchive(
  buffer: Buffer,
  options: { stripRoot: boolean; targetFolder: string }
): Promise<ArchiveResult> {
  if (buffer.length > config.maxZipBytes) {
    throw new Error(`ZIP exceeds the ${Math.round(config.maxZipBytes / 1024 / 1024)} MB upload limit.`);
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false });
  } catch {
    throw new Error('The selected file is not a valid ZIP archive or is corrupted.');
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > config.maxFiles) {
    throw new Error(`Archive contains more than ${config.maxFiles} files.`);
  }

  const normalized = entries.map((entry) => ({ entry, originalPath: normalizeArchivePath(entry.unsafeOriginalName ?? entry.name) }));
  const visiblePaths = normalized.filter(({ originalPath }) => !shouldIgnore(originalPath)).map(({ originalPath }) => originalPath);
  const commonRoot = options.stripRoot ? findCommonRoot(visiblePaths) : null;
  const targetFolder = normalizeTargetFolder(options.targetFolder);
  const files: UploadFile[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;

  for (const { entry, originalPath } of normalized) {
    if (shouldIgnore(originalPath)) {
      ignored.push(originalPath);
      continue;
    }
    if (isSymlink(entry.unixPermissions)) {
      throw new Error(`Symbolic links are not allowed: ${originalPath}`);
    }

    const internal = (entry as unknown as { _data?: ZipInternalData })._data;
    const declaredSize = internal?.uncompressedSize;
    if (declaredSize && declaredSize > config.maxFileBytes) {
      throw new Error(`${originalPath} exceeds the per-file size limit.`);
    }
    if (declaredSize && totalBytes + declaredSize > config.maxExtractedBytes) {
      throw new Error('The extracted archive exceeds the configured size limit.');
    }

    let relativePath = originalPath;
    if (commonRoot && relativePath.startsWith(`${commonRoot}/`)) {
      relativePath = relativePath.slice(commonRoot.length + 1);
    }
    const finalPath = targetFolder ? `${targetFolder}/${relativePath}` : relativePath;
    const safeFinalPath = normalizeArchivePath(finalPath);
    if (seen.has(safeFinalPath)) {
      throw new Error(`Multiple archive entries resolve to the same path: ${safeFinalPath}`);
    }
    seen.add(safeFinalPath);

    const content = await entry.async('nodebuffer');
    totalBytes += content.length;
    if (content.length > config.maxFileBytes) {
      throw new Error(`${originalPath} exceeds the per-file size limit.`);
    }
    if (totalBytes > config.maxExtractedBytes) {
      throw new Error('The extracted archive exceeds the configured size limit.');
    }

    files.push({
      path: safeFinalPath,
      content,
      size: content.length,
      mode: executableMode(entry.unixPermissions),
      gitSha: gitBlobSha(content),
      warnings: detectWarnings(safeFinalPath, content)
    });
  }

  if (!files.length) {
    throw new Error('The ZIP archive does not contain any publishable files.');
  }

  const warnings: string[] = [];
  if (files.some((file) => file.warnings.length > 0)) {
    warnings.push('Review files marked with credential or secret warnings before publishing.');
  }

  return { files, ignored, totalBytes, commonRoot, warnings };
}

function existingBlobMap(tree: GitTreeItem[]): Map<string, GitTreeItem> {
  return new Map(
    tree
      .filter((item) => item.type === 'blob' && item.path)
      .map((item) => [item.path!, item])
  );
}

function inMirrorScope(filePath: string, targetFolder: string): boolean {
  return !targetFolder || filePath === targetFolder || filePath.startsWith(`${targetFolder}/`);
}

export function buildPreview(
  archive: ArchiveResult,
  snapshot: RepoSnapshot,
  options: { mode: 'overlay' | 'mirror'; targetFolder: string }
): PreviewResult {
  const existing = existingBlobMap(snapshot.tree);
  const uploadedPaths = new Set(archive.files.map((file) => file.path));
  const files: PreviewFile[] = archive.files.map((file) => {
    const current = existing.get(file.path);
    const status: ChangeStatus = !current ? 'added' : current.sha === file.gitSha ? 'unchanged' : 'modified';
    return { path: file.path, size: file.size, status, warnings: file.warnings };
  });

  if (options.mode === 'mirror') {
    const targetFolder = normalizeTargetFolder(options.targetFolder);
    for (const [existingPath, item] of existing) {
      if (inMirrorScope(existingPath, targetFolder) && !uploadedPaths.has(existingPath)) {
        files.push({ path: existingPath, size: item.size ?? 0, status: 'deleted', warnings: [] });
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  const counts: Record<ChangeStatus, number> = { added: 0, modified: 0, unchanged: 0, deleted: 0 };
  for (const file of files) counts[file.status] += 1;

  const archiveWarnings = [...archive.warnings];
  if (snapshot.truncated) {
    archiveWarnings.push('GitHub returned a truncated repository tree. Overlay upload is safe, but comparison counts may be incomplete; mirror mode is blocked.');
  }

  return {
    files,
    counts,
    ignored: archive.ignored,
    totalBytes: archive.totalBytes,
    archiveWarnings,
    treeTruncated: snapshot.truncated
  };
}

export function deletionPaths(
  archive: ArchiveResult,
  snapshot: RepoSnapshot,
  targetFolder: string
): string[] {
  const uploadedPaths = new Set(archive.files.map((file) => file.path));
  const target = normalizeTargetFolder(targetFolder);
  return snapshot.tree
    .filter((item) => item.type === 'blob' && item.path && inMirrorScope(item.path, target) && !uploadedPaths.has(item.path))
    .map((item) => item.path!);
}
