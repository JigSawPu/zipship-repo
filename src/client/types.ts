export interface AppConfig {
  configured: boolean;
  installUrl: string | null;
  limits: {
    maxZipMb: number;
    maxExtractedMb: number;
    maxFiles: number;
  };
}

export interface UserProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
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

export interface BranchSummary {
  name: string;
  protected: boolean;
}

export type ChangeStatus = 'added' | 'modified' | 'unchanged' | 'deleted';

export interface PreviewFile {
  path: string;
  size: number;
  status: ChangeStatus;
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

export interface PublishResult {
  noChanges: boolean;
  branch: string;
  message?: string;
  commit?: { sha: string; htmlUrl: string };
  pullRequest?: { number: number; htmlUrl: string } | null;
  summary?: { uploaded: number; deleted: number };
}
