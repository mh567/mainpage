const OWNER = 'mh567';
const REPO = 'mainpage';
const BRANCH = 'main';
const API = 'https://api.github.com';

/** 官方支持的预填参数，把 Contents 权限和有效期直接带进创建页。 */
export function tokenCreateUrl(): string {
  const params = new URLSearchParams({
    name: 'emolu admin',
    description: 'Emolu 个人主页后台：读写 src/content 与 public/uploads',
    expires_in: '366',
    contents: 'write',
  });
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}

export class GitHubError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

export interface RemoteFile {
  name: string;
  path: string;
  sha: string;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function request<T>(
  token: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await fetch(API + path, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new GitHubError(401, 'Token 无效或已过期');
    }
    let message = response.statusText;
    try {
      const data = await response.json();
      if (typeof data?.message === 'string') message = data.message;
    } catch {
      message = response.statusText;
    }
    throw new GitHubError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function commitUrl(path: string): string {
  return `https://github.com/${OWNER}/${REPO}/commits/${BRANCH}/${encodePath(path)}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function contentsPath(path: string): string {
  return `/repos/${OWNER}/${REPO}/contents/${encodePath(path)}`;
}

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function fromBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function verifyToken(token: string): Promise<boolean> {
  const data = await request<{ permissions?: { push?: boolean } }>(
    token,
    `/repos/${OWNER}/${REPO}`,
  );
  return Boolean(data.permissions?.push);
}

export async function listMarkdown(
  token: string,
  directory: string,
): Promise<RemoteFile[]> {
  const data = await request<unknown>(
    token,
    `${contentsPath(directory)}?ref=${BRANCH}`,
  );

  if (!Array.isArray(data)) {
    throw new GitHubError(500, `${directory} 不是目录`);
  }

  return data
    .filter(
      (entry): entry is { name: string; path: string; sha: string; type: string } =>
        typeof entry === 'object' &&
        entry !== null &&
        (entry as { type?: string }).type === 'file' &&
        String((entry as { name?: string }).name).endsWith('.md'),
    )
    .map((entry) => ({ name: entry.name, path: entry.path, sha: entry.sha }));
}

export async function readFile(
  token: string,
  path: string,
): Promise<{ text: string; sha: string }> {
  const data = await request<{ content: string; sha: string }>(
    token,
    `${contentsPath(path)}?ref=${BRANCH}`,
  );
  return { text: fromBase64(data.content), sha: data.sha };
}

export interface CommitRef {
  sha: string;
  htmlUrl: string;
}

interface MutationResponse {
  commit?: { sha?: string; html_url?: string };
}

function toCommitRef(data: MutationResponse, path: string): CommitRef {
  return {
    sha: data.commit?.sha ?? '',
    htmlUrl: data.commit?.html_url ?? commitUrl(path),
  };
}

export async function writeText(
  token: string,
  path: string,
  text: string,
  message: string,
  sha?: string,
): Promise<CommitRef> {
  return writeBase64(token, path, toBase64(text), message, sha);
}

export async function writeBase64(
  token: string,
  path: string,
  base64: string,
  message: string,
  sha?: string,
): Promise<CommitRef> {
  const data = await request<MutationResponse>(token, contentsPath(path), {
    method: 'PUT',
    body: {
      message,
      content: base64,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    },
  });
  return toCommitRef(data, path);
}

export interface CommitEntry {
  path: string;
  /** 有 text 就写入，delete 为 true 就删掉这个文件 */
  text?: string;
  delete?: boolean;
}

/**
 * 一次提交写多个文件。排序、批量编辑会同时改好几个 .md，
 * 逐个提交会刷出一堆 commit，也就会触发一堆部署。
 * 走 Git Data API：base tree → 新 tree → commit → 更新分支引用。
 */
export async function commitFiles(
  token: string,
  entries: CommitEntry[],
  message: string,
): Promise<CommitRef> {
  if (entries.length === 0) {
    return { sha: '', htmlUrl: `https://github.com/${OWNER}/${REPO}/commits/${BRANCH}` };
  }

  const head = await request<{ object: { sha: string }; sha: string }>(
    token,
    `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`,
  );
  const headSha = head.object.sha;

  const commit = await request<{ tree: { sha: string } }>(
    token,
    `/repos/${OWNER}/${REPO}/git/commits/${headSha}`,
  );

  const tree = await request<{ sha: string }>(
    token,
    `/repos/${OWNER}/${REPO}/git/trees`,
    {
      method: 'POST',
      body: {
        base_tree: commit.tree.sha,
        tree: entries.map((entry) =>
          entry.delete
            ? // tree 里 sha 为 null 表示删除这个路径
              { path: entry.path, mode: '100644', type: 'blob', sha: null }
            : {
                path: entry.path,
                mode: '100644',
                type: 'blob',
                content: entry.text ?? '',
              },
        ),
      },
    },
  );

  const created = await request<{ sha: string; html_url?: string }>(
    token,
    `/repos/${OWNER}/${REPO}/git/commits`,
    {
      method: 'POST',
      body: { message, tree: tree.sha, parents: [headSha] },
    },
  );

  await request(token, `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: { sha: created.sha, force: false },
  });

  return {
    sha: created.sha,
    htmlUrl: created.html_url ?? `https://github.com/${OWNER}/${REPO}/commit/${created.sha}`,
  };
}

export async function removeFile(
  token: string,
  path: string,
  message: string,
  sha: string,
): Promise<CommitRef> {
  const data = await request<MutationResponse>(token, contentsPath(path), {
    method: 'DELETE',
    body: { message, sha, branch: BRANCH },
  });
  return toCommitRef(data, path);
}

export interface DeployRun {
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed' | string;
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  htmlUrl: string;
}

/**
 * 部署由 Actions 完成，Pages 自己的 builds 接口对这类仓库是 404，
 * 所以看 main 上最新一次 workflow run 才是可靠信号。
 *
 * 注意不要按 commit sha 去精确匹配：连续几次提交时 GitHub 会取消前一次的
 * 部署（同一时间只允许一个 Pages 部署），被取消的那次并不代表站点没更新。
 * 公开仓库的运行记录不需要鉴权，这里刻意不带 token，免得被细粒度权限挡住。
 */
export async function latestDeployRun(): Promise<DeployRun | null> {
  try {
    const response = await fetch(
      `${API}/repos/${OWNER}/${REPO}/actions/runs?branch=${BRANCH}&per_page=1`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        cache: 'no-store',
      },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      workflow_runs?: Array<{
        head_sha?: string;
        status?: string;
        conclusion?: string | null;
        html_url?: string;
      }>;
    };

    const run = data.workflow_runs?.[0];
    if (!run) return null;

    return {
      headSha: run.head_sha ?? '',
      status: run.status ?? '',
      conclusion: (run.conclusion as DeployRun['conclusion']) ?? null,
      htmlUrl: run.html_url ?? '',
    };
  } catch {
    return null;
  }
}

/**
 * GitHub 对并发请求有二级限流，一次拉几十个文件会被打进 403。
 * 这里限制在 6 路并发，既不会太慢也不会撞墙。
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
