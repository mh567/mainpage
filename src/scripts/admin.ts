import {
  parseNote,
  parseProject,
  serializeNote,
  serializeProject,
  todayIso,
  type NoteDoc,
  type NoteMeta,
  type ProjectDoc,
  type ProjectMeta,
  type ProjectStatus,
} from '../lib/content';
import {
  GitHubError,
  commitFiles,
  latestDeployRun,
  listMarkdown,
  mapLimit,
  readFile,
  removeFile,
  tokenCreateUrl,
  verifyToken,
  writeBase64,
  writeText,
  type CommitEntry,
  type CommitRef,
  type RemoteFile,
} from '../lib/github';

const TOKEN_KEY = 'emolu.admin.token';
const SESSION_TOKEN_KEY = 'emolu.admin.session-token';
const DRAFT_KEY = 'emolu.admin.draft';

const NOTES_DIR = 'src/content/notes';
const PROJECTS_DIR = 'src/content/projects';
const UPLOADS_DIR = 'public/uploads';

const PENDING_DEPLOY_KEY = 'emolu.admin.pending-deploy';

interface PendingDeploy {
  sha: string;
  doneMessage: string;
  href: string;
  label: string;
  startedAt: number;
}

const STATUS_LABELS: Record<ProjectStatus, string> = {
  active: '进行中',
  maintained: '维护中',
  wip: '开发中',
  archived: '已归档',
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少元素 #${id}`);
  return node as T;
}

const statusLine = el<HTMLSpanElement>('status-line');
const toast = el<HTMLDivElement>('toast');
const toastText = el<HTMLSpanElement>('toast-text');
const toastLink = el<HTMLAnchorElement>('toast-link');
const settingsDialog = el<HTMLDialogElement>('settings');
const tokenInput = el<HTMLInputElement>('token-input');
const rememberInput = el<HTMLInputElement>('token-remember');
const settingsHint = el<HTMLParagraphElement>('settings-hint');
const createTokenLink = el<HTMLAnchorElement>('btn-create-token');

createTokenLink.href = tokenCreateUrl();

const storedToken = localStorage.getItem(TOKEN_KEY);
let token = storedToken ?? sessionStorage.getItem(SESSION_TOKEN_KEY) ?? '';
let connected = false;
let toastTimer = 0;
let deployTimer = 0;
let deployStatusTimer = 0;

const state: {
  notes: Array<RemoteFile & { doc: NoteDoc }>;
  projects: Array<RemoteFile & { doc: ProjectDoc }>;
  editingNote: { path: string; sha: string } | null;
  editingProject: { path: string; sha: string } | null;
  images: string[];
  busy: boolean;
} = {
  notes: [],
  projects: [],
  editingNote: null,
  editingProject: null,
  images: [],
  busy: false,
};

type Tone = 'idle' | 'ok' | 'warn';

/**
 * 状态栏只有一条，但有两类信息：连接状态和部署进度。
 * 分开存，渲染时部署优先，免得被“已加载 N 条”这种临时提示盖掉。
 */
let connectionStatus: { message: string; tone: Tone } = {
  message: '未连接',
  tone: 'idle',
};
let deployStatus: { message: string; tone: Tone; pending: boolean } | null = null;

function paintStatus(): void {
  const active = deployStatus ?? connectionStatus;
  statusLine.textContent = active.message;
  statusLine.dataset.tone = active.tone;
  if (deployStatus?.pending) statusLine.dataset.pending = 'true';
  else delete statusLine.dataset.pending;
}

function announce(message: string, tone: Tone = 'idle'): void {
  connectionStatus = { message, tone };
  paintStatus();
}

function announceDeploying(): void {
  window.clearTimeout(deployStatusTimer);
  setDeployStatus('等待部署…', 'idle', true);
}

function setDeployStatus(message: string, tone: Tone, pending: boolean): void {
  deployStatus = { message, tone, pending };
  paintStatus();

  // 结束后停留一会儿，再把位置还回连接状态，免得一直挂在“已上线”
  window.clearTimeout(deployStatusTimer);
  if (!pending) {
    deployStatusTimer = window.setTimeout(() => {
      deployStatus = null;
      paintStatus();
    }, 8000);
  }
}

interface ToastLink {
  href: string;
  label: string;
}

function notify(
  message: string,
  tone: 'ok' | 'warn' = 'ok',
  link?: ToastLink,
): void {
  toastText.textContent = message;
  toast.dataset.tone = tone;

  if (link) {
    toastLink.textContent = link.label;
    toastLink.href = link.href;
    toastLink.hidden = false;
  } else {
    toastLink.hidden = true;
    toastLink.removeAttribute('href');
  }

  toast.classList.add('is-on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-on'), 4200);
}

function friendly(error: unknown): string {
  if (error instanceof GitHubError) {
    if (error.status === 401) return 'Token 无效、已过期，或者已被撤销';
    if (error.status === 403) return 'Token 有读权限但没有写权限，检查 Contents 是不是 Read and write';
    if (error.status === 404) {
      return '访问不到仓库：确认 Repository access 里勾选了 mh567/mainpage';
    }
    if (error.status === 409) return '文件已被改动，刷新后重试';
    if (error.status === 422) return '提交内容不被接受，检查文件名';
    return error.message;
  }
  if (error instanceof TypeError) return '网络请求失败，检查网络';
  return error instanceof Error ? error.message : '未知错误';
}

function setBusy(busy: boolean): void {
  state.busy = busy;
  document.body.classList.toggle('is-busy', busy);
}

/* ---------------- token ---------------- */

function persistToken(value: string): void {
  if (rememberInput.checked) {
    localStorage.setItem(TOKEN_KEY, value);
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.setItem(SESSION_TOKEN_KEY, value);
  }
}

async function connect(candidate: string): Promise<boolean> {
  const value = candidate.trim();
  if (!value) {
    announce('未连接', 'warn');
    return false;
  }

  announce('正在连接…');
  try {
    const ok = await verifyToken(value);
    if (!ok) {
      announce('Token 缺少写入权限', 'warn');
      settingsHint.textContent = '这个 token 能读但不能写，需要 Contents: Read and write。';
      return false;
    }

    token = value;
    connected = true;
    persistToken(value);
    announce('已连接', 'ok');
    return true;
  } catch (error) {
    connected = false;
    announce('连接失败', 'warn');
    settingsHint.textContent = friendly(error);
    return false;
  }
}

/* ---------------- deploy watch ---------------- */

const DEPLOY_POLL_MS = 4000;
const DEPLOY_MAX_MS = 180_000;

function stopDeployWatch(): void {
  window.clearTimeout(deployTimer);
  deployTimer = 0;
}

function rememberPendingDeploy(job: PendingDeploy): void {
  try {
    localStorage.setItem(PENDING_DEPLOY_KEY, JSON.stringify(job));
  } catch {
    // 隐私模式下写不进去，只影响刷新后能不能接着显示
  }
}

function forgetPendingDeploy(): void {
  localStorage.removeItem(PENDING_DEPLOY_KEY);
}

function readPendingDeploy(): PendingDeploy | null {
  const raw = localStorage.getItem(PENDING_DEPLOY_KEY);
  if (!raw) return null;
  try {
    const job = JSON.parse(raw) as PendingDeploy;
    if (!job?.sha || typeof job.startedAt !== 'number') return null;
    // 太旧的当作已经结束，别一直挂着
    if (Date.now() - job.startedAt > DEPLOY_MAX_MS) {
      forgetPendingDeploy();
      return null;
    }
    return job;
  } catch {
    forgetPendingDeploy();
    return null;
  }
}

/**
 * 提交后盯着 main 上最新一次部署，直到这次提交真的上线。
 * 连续提交时 GitHub 会取消前一次的部署，那不算失败，继续等新的那次。
 * 部署用带 token 的接口查询，未认证的每小时只有 60 次，很快就会打满。
 * 任务记在 localStorage 里，刷新页面能接着等。
 */
function watchDeploy(
  commit: CommitRef,
  doneMessage: string,
  target: ToastLink,
): void {
  stopDeployWatch();

  // 提交成功后连接状态要恢复，否则部署收尾回落到的是“正在删除…”这种过程提示
  connectionStatus = { message: '已连接', tone: 'ok' };

  if (!commit.sha) {
    announce(`${doneMessage}，约 1 分钟生效`, 'ok');
    return;
  }

  const job: PendingDeploy = {
    sha: commit.sha,
    doneMessage,
    href: target.href,
    label: target.label,
    startedAt: Date.now(),
  };
  rememberPendingDeploy(job);
  runDeployWatch(job);
}

function runDeployWatch(job: PendingDeploy): void {
  announceDeploying();

  let misses = 0;

  const poll = async (): Promise<void> => {
    if (Date.now() - job.startedAt > DEPLOY_MAX_MS) {
      // 提交已经进仓库了，只是构建慢或者状态拿不到，别吓唬人
      setDeployStatus('提交已完成，部署状态未确认', 'idle', false);
      forgetPendingDeploy();
      return;
    }

    const check = await latestDeployRun(token);

    if (check.kind === 'unavailable') {
      misses += 1;
      // 连续几次都拿不到（多半是限流），不要继续空转，直接收尾
      if (misses >= 5) {
        setDeployStatus('提交已完成，部署状态未确认', 'idle', false);
        forgetPendingDeploy();
        return;
      }
      deployTimer = window.setTimeout(() => void poll(), DEPLOY_POLL_MS);
      return;
    }

    misses = 0;
    const run = check.run;

    if (run.status !== 'completed') {
      deployTimer = window.setTimeout(() => void poll(), DEPLOY_POLL_MS);
      return;
    }

    // 被取消是因为后面还有新提交，站点最终会由最新那次决定
    if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') {
      deployTimer = window.setTimeout(() => void poll(), DEPLOY_POLL_MS);
      return;
    }

    forgetPendingDeploy();

    if (run.conclusion === 'success') {
      setDeployStatus('已上线', 'ok', false);
      notify(job.doneMessage, 'ok', { href: job.href, label: job.label });
    } else {
      setDeployStatus('部署失败', 'warn', false);
      notify('部署失败，看 Actions 日志', 'warn', {
        href: run.htmlUrl || 'https://github.com/mh567/mainpage/actions',
        label: '看 Actions',
      });
    }
  };

  deployTimer = window.setTimeout(() => void poll(), DEPLOY_POLL_MS);
}

/** 刷新后如果还有没走完的部署，接着盯。 */
function resumeDeployWatch(): void {
  const job = readPendingDeploy();
  if (!job) return;
  runDeployWatch(job);
}

/* ---------------- helpers ---------------- */

function slugify(input: string, fallback = 'note'): string {
  const ascii = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii.slice(0, 40) || fallback;
}

function uniqueName(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function parseTags(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function extensionOf(file: File): string {
  const fromName = /\.([a-z0-9]+)$/i.exec(file.name)?.[1];
  if (fromName) return fromName.toLowerCase();
  if (file.type === 'image/jpeg') return 'jpg';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/gif') return 'gif';
  if (file.type === 'image/webp') return 'webp';
  return 'png';
}

function readAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

const MAX_EDGE = 1600;
const COMPRESS_THRESHOLD = 600_000;

function guardImage(image: HTMLImageElement): void {
  image.addEventListener('error', () => {
    image.dataset.broken = 'true';
    image.removeAttribute('src');
  });
}

/** 上传后到部署完成前，站点上的 /uploads/... 还是 404，用本地 blob 先顶上。 */
const previews = new Map<string, string>();

function displaySrc(src: string): string {
  return previews.get(src) ?? src;
}

/**
 * 超过阈值就压到最长边 1600 并转 JPEG。
 * 截图类 PNG 重新编码成 PNG 往往比原图还大，所以这类大图统一走 JPEG。
 * 小图原样上传，保留原格式和透明通道。
 */
async function prepareImage(
  file: File,
): Promise<{ base64: string; extension: string }> {
  const extension = extensionOf(file);
  if (file.size < COMPRESS_THRESHOLD) {
    return { base64: await readAsBase64(file), extension };
  }

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法处理图片');

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let best: Blob | null = null;
    for (const quality of [0.86, 0.72, 0.6]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', quality),
      );
      if (!blob) continue;
      best = blob;
      if (blob.size <= 500_000) break;
    }

    if (!best || best.size >= file.size) {
      return { base64: await readAsBase64(file), extension };
    }

    return { base64: await readAsBase64(best), extension: 'jpg' };
  } catch {
    return { base64: await readAsBase64(file), extension };
  }
}

function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return match ? `${match[2]}/${match[3]}` : iso;
}

/* ---------------- tabs ---------------- */

document.querySelectorAll<HTMLButtonElement>('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.pane;
    document.querySelectorAll<HTMLButtonElement>('.tab').forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll<HTMLElement>('.pane').forEach((pane) => {
      pane.hidden = pane.id !== `pane-${target}`;
    });
    if (target === 'notes' && connected && state.notes.length === 0) void loadNotes();
    if (target === 'projects' && connected && state.projects.length === 0) {
      void loadProjects();
    }
  });
});

/* ---------------- compose ---------------- */

const composeForm = el<HTMLFormElement>('compose-form');
const composeTitle = el<HTMLInputElement>('compose-title');
const composeDate = el<HTMLInputElement>('compose-date');
const composeBody = el<HTMLTextAreaElement>('compose-body');
const composeTags = el<HTMLInputElement>('compose-tags');
const composeLink = el<HTMLInputElement>('compose-link');
const composeDraft = el<HTMLInputElement>('compose-draft');
const composeImages = el<HTMLDivElement>('compose-images');
const mediaDrop = el<HTMLDivElement>('media-drop');
const mediaHint = el<HTMLParagraphElement>('media-hint');
const uploadInput = el<HTMLInputElement>('upload-input');
const cancelEditButton = el<HTMLButtonElement>('btn-cancel-edit');
const publishButton = el<HTMLButtonElement>('btn-publish');

composeDate.value = todayIso();

/* 拖拽排序：图片用 data-index，键盘也能用（Alt + 方向键）。 */
let dragIndex: number | null = null;

function moveImage(from: number, to: number): void {
  if (from === to) return;
  if (to < 0 || to >= state.images.length) return;
  const [moved] = state.images.splice(from, 1);
  state.images.splice(to, 0, moved);
  renderImages();
}

function renderImages(): void {
  composeImages.replaceChildren();
  composeImages.hidden = state.images.length === 0;
  mediaHint.hidden = state.images.length > 0;
  mediaDrop.dataset.count = String(state.images.length);
  mediaDrop.dataset.layout =
    state.images.length === 1
      ? 'single'
      : state.images.length === 2
        ? 'duo'
        : state.images.length === 4
          ? 'quad'
          : 'grid';

  state.images.forEach((src, index) => {
    const figure = document.createElement('figure');
    figure.className = 'thumb';
    figure.draggable = state.images.length > 1;
    figure.dataset.index = String(index);
    figure.tabIndex = state.images.length > 1 ? 0 : -1;

    const image = document.createElement('img');
    image.src = displaySrc(src);
    image.alt = '';
    image.loading = 'lazy';
    image.draggable = false;
    guardImage(image);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'thumb-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', '移除图片');
    remove.addEventListener('click', () => {
      state.images.splice(index, 1);
      renderImages();
      saveDraft();
    });

    if (state.images.length > 1) {
      const badge = document.createElement('span');
      badge.className = 'thumb-order';
      badge.textContent = String(index + 1);
      figure.append(badge);
    }

    figure.append(image, remove);

    figure.addEventListener('dragstart', (event) => {
      dragIndex = index;
      figure.classList.add('is-dragging');
      event.dataTransfer?.setData('text/plain', String(index));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });

    figure.addEventListener('dragend', () => {
      dragIndex = null;
      figure.classList.remove('is-dragging');
    });

    figure.addEventListener('dragover', (event) => {
      if (dragIndex === null) return;
      event.preventDefault();
      figure.classList.add('is-over');
    });

    figure.addEventListener('dragleave', () => {
      figure.classList.remove('is-over');
    });

    figure.addEventListener('drop', (event) => {
      event.preventDefault();
      figure.classList.remove('is-over');
      const from = dragIndex ?? Number(event.dataTransfer?.getData('text/plain'));
      if (Number.isInteger(from)) moveImage(from, index);
      dragIndex = null;
      saveDraft();
    });

    figure.addEventListener('keydown', (event) => {
      if (!event.altKey) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveImage(index, index - 1);
        saveDraft();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveImage(index, index + 1);
        saveDraft();
      }
    });

    composeImages.append(figure);
  });
}

async function uploadFiles(files: File[]): Promise<void> {
  const images = files.filter((file) => file.type.startsWith('image/'));
  if (!images.length) return;
  if (!connected) {
    notify('先连接 GitHub', 'warn');
    openSettings();
    return;
  }

  setBusy(true);
  announce('上传图片…');
  try {
    let done = 0;
    for (const file of images) {
      const { base64, extension } = await prepareImage(file);
      const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
      const path = `${UPLOADS_DIR}/${name}`;
      await writeBase64(token, path, base64, `上传图片 ${name}`);
      const publicPath = `/uploads/${name}`;
      previews.set(publicPath, URL.createObjectURL(file));
      state.images.push(publicPath);
      renderImages();
      done += 1;
      announce(`上传图片 ${done}/${images.length}…`);
    }
    announce('图片已上传', 'ok');
  } catch (error) {
    notify(friendly(error), 'warn');
    announce('上传失败', 'warn');
  } finally {
    setBusy(false);
  }
}

uploadInput.addEventListener('change', () => {
  const files = Array.from(uploadInput.files ?? []);
  uploadInput.value = '';
  void uploadFiles(files);
});

composeBody.addEventListener('paste', (event) => {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (!files.length) return;
  event.preventDefault();
  void uploadFiles(files);
});

/* 整个页面接收文件拖入，落点不在图片区也算 */
let dragDepth = 0;

mediaDrop.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  dragDepth += 1;
  mediaDrop.classList.add('is-drop');
});

mediaDrop.addEventListener('dragover', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});

mediaDrop.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) mediaDrop.classList.remove('is-drop');
});

mediaDrop.addEventListener('drop', (event) => {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) return;
  event.preventDefault();
  dragDepth = 0;
  mediaDrop.classList.remove('is-drop');
  void uploadFiles(files);
});

function collectNote(): NoteMeta {
  return {
    date: composeDate.value || todayIso(),
    title: composeTitle.value.trim(),
    images: [...state.images],
    link: composeLink.value.trim(),
    tags: parseTags(composeTags.value),
    draft: composeDraft.checked,
  };
}

/** 草稿和发布长得很像，按钮文字必须说清楚，免得存成草稿却以为上线了。 */
function syncPublishLabel(): void {
  if (state.editingNote) {
    publishButton.textContent = '保存修改';
    return;
  }
  publishButton.textContent = composeDraft.checked ? '存为草稿' : '发布';
}

composeDraft.addEventListener('change', () => {
  syncPublishLabel();
  saveDraft();
});

function resetCompose(): void {
  state.editingNote = null;
  state.images = [];
  composeForm.reset();
  composeDate.value = todayIso();
  composeTags.value = '';
  composeDraft.checked = false;
  renderImages();
  cancelEditButton.hidden = true;
  syncPublishLabel();
  el<HTMLParagraphElement>('compose-hint').textContent = '⌘ / Ctrl + Enter 立即发布';
  localStorage.removeItem(DRAFT_KEY);
}

function loadDraft(): void {
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as Partial<NoteMeta> & { body?: string };
    if (typeof saved.body === 'string') composeBody.value = saved.body;
    if (typeof saved.title === 'string') composeTitle.value = saved.title;
    if (typeof saved.tags === 'string') composeTags.value = saved.tags;
    if (typeof saved.link === 'string') composeLink.value = saved.link;
    if (typeof saved.date === 'string' && saved.date) composeDate.value = saved.date;
    if (Array.isArray(saved.images)) state.images = saved.images;
    composeDraft.checked = Boolean((saved as { draft?: boolean }).draft);
    renderImages();
    syncPublishLabel();
  } catch {
    localStorage.removeItem(DRAFT_KEY);
  }
}

function saveDraft(): void {
  if (state.editingNote) return;
  const payload = {
    title: composeTitle.value,
    body: composeBody.value,
    tags: composeTags.value,
    link: composeLink.value,
    date: composeDate.value,
    images: state.images,
    draft: composeDraft.checked,
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
}

composeForm.addEventListener('input', saveDraft);

composeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void publish();
});

composeBody.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    void publish();
  }
});

async function publish(): Promise<void> {
  if (state.busy) return;
  if (!connected) {
    notify('先连接 GitHub', 'warn');
    openSettings();
    return;
  }

  const meta = collectNote();
  const body = composeBody.value.trim();
  if (!body && meta.images.length === 0) {
    notify('写点内容或加张图片', 'warn');
    composeBody.focus();
    return;
  }

  const doc: NoteDoc = { meta, body };
  setBusy(true);
  announce('正在提交…');

  try {
    let commit: CommitRef;
    let done: string;
    let target: ToastLink;

    const asDraft = meta.draft;
    let slug: string;

    if (state.editingNote) {
      const path = state.editingNote.path;
      commit = await writeText(
        token,
        path,
        serializeNote(doc),
        `更新短帖 ${path.split('/').pop()}`,
        state.editingNote.sha,
      );
      slug = path.split('/').pop()?.replace(/\.md$/, '') ?? '';
      done = asDraft ? '已保存草稿' : '已更新';
    } else {
      const existing = new Set(state.notes.map((item) => item.name.replace(/\.md$/, '')));
      const base = `${meta.date}-${slugify(meta.title || body, 'note')}`;
      const name = `${uniqueName(base, existing)}.md`;
      slug = name.replace(/\.md$/, '');
      commit = await writeText(
        token,
        `${NOTES_DIR}/${name}`,
        serializeNote(doc),
        `发布短帖 ${name}`,
      );
      done = asDraft ? '已保存草稿' : '已发布';
    }

    target = { href: `/notes/${slug}/`, label: '看线上' };

    resetCompose();
    await loadNotes();

    if (asDraft) {
      // 草稿不参与构建，盯着部署没有意义
      announce('已保存草稿，站点上不显示', 'ok');
      notify('已保存草稿，站点上不显示', 'ok');
    } else {
      watchDeploy(commit, done, target);
    }
  } catch (error) {
    notify(friendly(error), 'warn');
    announce('提交失败', 'warn');
  } finally {
    setBusy(false);
  }
}

cancelEditButton.addEventListener('click', () => {
  resetCompose();
  notify('已取消编辑');
});

/* ---------------- notes list ---------------- */

const notesList = el<HTMLDivElement>('notes-list');
const notesCount = el<HTMLSpanElement>('notes-count');
const notesListCount = el<HTMLSpanElement>('notes-list-count');

async function loadNotes(): Promise<void> {
  if (!connected) return;
  setBusy(true);
  try {
    const files = await listMarkdown(token, NOTES_DIR);
    const loaded = await mapLimit(files, 6, async (file) => {
      const { text, sha } = await readFile(token, file.path);
      return { ...file, sha, doc: parseNote(text) };
    });
    loaded.sort((a, b) => (a.doc.meta.date < b.doc.meta.date ? 1 : -1));
    state.notes = loaded;
    renderNotes();
  } catch (error) {
    notify(friendly(error), 'warn');
  } finally {
    setBusy(false);
  }
}

function renderNotes(): void {
  notesList.replaceChildren();
  notesCount.textContent = String(state.notes.length);
  notesCount.hidden = state.notes.length === 0;
  notesListCount.textContent = `${state.notes.length} 条`;
  notesListCount.hidden = state.notes.length === 0;

  if (state.notes.length === 0) {
    notesList.append(emptyState('还没有短帖，去「发帖」写一条。'));
    return;
  }

  for (const item of state.notes) {
    const card = document.createElement('article');
    card.className = 'card';

    const head = document.createElement('div');
    head.className = 'card-head';

    const time = document.createElement('time');
    time.textContent = formatDate(item.doc.meta.date);

    head.append(time);

    if (item.doc.meta.draft) {
      const draft = document.createElement('span');
      draft.className = 'draft-tag';
      draft.textContent = '草稿';
      head.append(draft);
    }

    const body = document.createElement('p');
    body.className = 'card-body';
    const preview =
      item.doc.meta.title ||
      item.doc.body.replace(/[#>*_`>-]/g, '').replace(/\s+/g, ' ').trim();
    body.textContent = preview.slice(0, 120) || '（无正文）';

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ghost small';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => startEditNote(item));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost small danger';
    remove.textContent = '删除';
    remove.addEventListener('click', () => deleteNote(item));

    const open = document.createElement('a');
    open.className = 'ghost small';
    open.href = `/notes/${item.name.replace(/\.md$/, '')}/`;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = '查看';

    actions.append(open, edit, remove);
    card.append(head, body, actions);

    if (item.doc.meta.images.length) {
      const thumbs = document.createElement('div');
      thumbs.className = 'card-thumbs';
      item.doc.meta.images.slice(0, 3).forEach((src) => {
        const image = document.createElement('img');
        image.src = displaySrc(src);
        image.alt = '';
        image.loading = 'lazy';
        guardImage(image);
        thumbs.append(image);
      });
      card.append(thumbs);
    }

    notesList.append(card);
  }
}

function emptyState(text: string): HTMLElement {
  const node = document.createElement('p');
  node.className = 'empty';
  node.textContent = text;
  return node;
}

function startEditNote(item: RemoteFile & { doc: NoteDoc }): void {
  const hasUnsent =
    !state.editingNote &&
    (composeBody.value.trim() !== '' || state.images.length > 0);
  if (hasUnsent && !window.confirm('发帖框里还有没发布的内容，编辑会覆盖它。继续？')) {
    return;
  }

  state.editingNote = { path: item.path, sha: item.sha };
  state.images = [...item.doc.meta.images];
  composeTitle.value = item.doc.meta.title;
  composeDate.value = item.doc.meta.date || todayIso();
  composeBody.value = item.doc.body;
  composeTags.value = item.doc.meta.tags.join(' ');
  composeLink.value = item.doc.meta.link;
  composeDraft.checked = item.doc.meta.draft;
  renderImages();
  cancelEditButton.hidden = false;
  syncPublishLabel();
  el<HTMLParagraphElement>('compose-hint').textContent = item.doc.meta.draft
    ? `正在编辑「${item.name}」，当前是草稿，站点上不显示`
    : `正在编辑「${item.name}」`;

  document.querySelector<HTMLButtonElement>('.tab[data-pane="compose"]')?.click();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  composeBody.focus();
}

async function deleteNote(item: RemoteFile & { doc: NoteDoc }): Promise<void> {
  const preview =
    item.doc.meta.title ||
    item.doc.body.replace(/\s+/g, ' ').trim().slice(0, 40) ||
    item.name;
  if (!window.confirm(`删除这条短帖？\n\n${preview}\n\n这个操作会直接提交到仓库。`)) {
    return;
  }

  setBusy(true);
  announce('正在删除…');
  try {
    const commit = await removeFile(token, item.path, `删除短帖 ${item.name}`, item.sha);
    state.notes = state.notes.filter((entry) => entry.path !== item.path);
    if (state.editingNote?.path === item.path) resetCompose();
    renderNotes();
    watchDeploy(commit, '已删除', { href: '/', label: '看首页' });
  } catch (error) {
    notify(friendly(error), 'warn');
    announce('删除失败', 'warn');
  } finally {
    setBusy(false);
  }
}

/* ---------------- projects ---------------- */

const projectsList = el<HTMLDivElement>('projects-list');
const projectsCount = el<HTMLSpanElement>('projects-count');
const pendingBar = el<HTMLDivElement>('pending-bar');
const pendingText = el<HTMLSpanElement>('pending-text');
const btnDiscard = el<HTMLButtonElement>('btn-discard');
const btnCommit = el<HTMLButtonElement>('btn-commit');
const projectForm = el<HTMLFormElement>('project-form');
const projectFormTitle = el<HTMLElement>('project-form-title');
const projectTitle = el<HTMLInputElement>('project-title');
const projectFile = el<HTMLInputElement>('project-file');
const projectSummary = el<HTMLInputElement>('project-summary');
const projectUrl = el<HTMLInputElement>('project-url');
const projectRepo = el<HTMLInputElement>('project-repo');
const projectStatus = el<HTMLSelectElement>('project-status');
const projectStarted = el<HTMLInputElement>('project-started');
const projectTags = el<HTMLInputElement>('project-tags');
const projectCover = el<HTMLInputElement>('project-cover');
const projectFeatured = el<HTMLInputElement>('project-featured');
const projectBody = el<HTMLTextAreaElement>('project-body');

/**
 * 上次从仓库读到的项目文件原文，用来判断哪些真有改动。
 * 空 sha 表示这是本地新建、仓库里还没有的文件。
 */
let projectsBaseline = new Map<string, { sha: string; text: string }>();

async function loadProjects(): Promise<void> {
  if (!connected) return;
  setBusy(true);
  try {
    const files = await listMarkdown(token, PROJECTS_DIR);
    const loaded = await mapLimit(files, 6, async (file) => {
      const { text, sha } = await readFile(token, file.path);
      return { ...file, sha, doc: parseProject(text) };
    });
    loaded.sort(
      (a, b) =>
        a.doc.meta.order - b.doc.meta.order ||
        a.doc.meta.title.localeCompare(b.doc.meta.title, 'zh-CN'),
    );

    // 下标就是顺序。归一下号，避免文件里写的是 0/1/2/5 这种带空洞的值
    loaded.forEach((item, index) => {
      item.doc.meta.order = index;
    });

    state.projects = loaded;
    projectsBaseline = new Map(
      loaded.map((item, index) => [
        item.path,
        { sha: item.sha, text: projectText(item, index) },
      ]),
    );
    renderProjects();
    updatePendingBar();
  } catch (error) {
    notify(friendly(error), 'warn');
  } finally {
    setBusy(false);
  }
}

/** 每个项目文件在“当前顺序”下应该长什么样。 */
function projectText(item: { doc: ProjectDoc }, index: number): string {
  return serializeProject({
    meta: { ...item.doc.meta, order: index },
    body: item.doc.body,
  });
}

interface ProjectChanges {
  entries: CommitEntry[];
  creates: number;
  updates: number;
  deletes: number;
}

function projectChanges(): ProjectChanges {
  const entries: CommitEntry[] = [];
  const seen = new Set<string>();
  let creates = 0;
  let updates = 0;
  let deletes = 0;

  state.projects.forEach((item, index) => {
    const text = projectText(item, index);
    const base = projectsBaseline.get(item.path);
    seen.add(item.path);

    if (!base) {
      entries.push({ path: item.path, text });
      creates += 1;
    } else if (base.text !== text) {
      entries.push({ path: item.path, text });
      updates += 1;
    }
  });

  for (const path of projectsBaseline.keys()) {
    if (seen.has(path)) continue;
    entries.push({ path, delete: true });
    deletes += 1;
  }

  return { entries, creates, updates, deletes };
}

function updatePendingBar(): void {
  const { entries, creates, updates, deletes } = projectChanges();
  pendingBar.hidden = entries.length === 0;
  if (entries.length === 0) return;

  const parts: string[] = [];
  if (creates) parts.push(`新增 ${creates}`);
  if (updates) parts.push(`修改 ${updates}`);
  if (deletes) parts.push(`删除 ${deletes}`);
  pendingText.textContent = `${parts.join(' · ')}，共 ${entries.length} 处待提交`;
  btnCommit.disabled = false;
}

function renderProjects(): void {
  projectsList.replaceChildren();
  projectsCount.textContent = `${state.projects.length} 个`;
  projectsCount.hidden = state.projects.length === 0;

  if (state.projects.length === 0) {
    projectsList.append(emptyState('还没有项目，点「新建项目」。'));
    return;
  }

  state.projects.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = 'card is-sortable';
    card.draggable = state.projects.length > 1;
    card.dataset.index = String(index);

    const head = document.createElement('div');
    head.className = 'card-head';

    const grip = document.createElement('span');
    grip.className = 'drag-grip';
    grip.textContent = '⠿';
    grip.setAttribute('aria-hidden', 'true');

    const order = document.createElement('span');
    order.className = 'order-index';
    order.textContent = String(index + 1);

    const title = document.createElement('strong');
    title.className = 'card-title';
    title.textContent = item.doc.meta.title;

    const status = document.createElement('span');
    status.className = 'kind';
    status.textContent = STATUS_LABELS[item.doc.meta.status];

    head.append(grip, order, title, status);

    const base = projectsBaseline.get(item.path);
    if (!base) {
      const tag = document.createElement('span');
      tag.className = 'draft-tag';
      tag.textContent = '新增';
      head.append(tag);
    } else if (base.text !== projectText(item, index)) {
      const tag = document.createElement('span');
      tag.className = 'draft-tag';
      tag.textContent = '已改';
      head.append(tag);
    }

    const summary = document.createElement('p');
    summary.className = 'card-body';
    summary.textContent = item.doc.meta.summary || '（没有简介）';

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ghost small';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => startEditProject(item));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost small danger';
    remove.textContent = '删除';
    remove.addEventListener('click', () => deleteProject(item));

    actions.append(edit, remove);
    card.append(head, summary, actions);

    bindProjectSort(card, index);
    projectsList.append(card);
  });
}

let projectDragIndex: number | null = null;

function bindProjectSort(card: HTMLElement, index: number): void {
  if (state.projects.length < 2) return;

  card.addEventListener('dragstart', (event) => {
    projectDragIndex = index;
    card.classList.add('is-dragging');
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });

  card.addEventListener('dragend', () => {
    projectDragIndex = null;
    card.classList.remove('is-dragging');
    projectsList
      .querySelectorAll('.card')
      .forEach((node) => node.classList.remove('is-over'));
  });

  card.addEventListener('dragover', (event) => {
    if (projectDragIndex === null) return;
    event.preventDefault();
    card.classList.add('is-over');
  });

  card.addEventListener('dragleave', () => card.classList.remove('is-over'));

  card.addEventListener('drop', (event) => {
    event.preventDefault();
    card.classList.remove('is-over');
    const from =
      projectDragIndex ?? Number(event.dataTransfer?.getData('text/plain'));
    projectDragIndex = null;
    if (!Number.isInteger(from)) return;
    moveProject(from, index);
  });
}

/** 拖拽只改本地顺序，不提交。 */
function moveProject(from: number, to: number): void {
  if (from === to || to < 0 || to >= state.projects.length) return;
  const next = [...state.projects];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  next.forEach((item, index) => {
    item.doc.meta.order = index;
  });
  state.projects = next;
  renderProjects();
  updatePendingBar();
}

function startEditProject(item: RemoteFile & { doc: ProjectDoc }): void {
  state.editingProject = { path: item.path, sha: item.sha };
  const { meta } = item.doc;
  projectFormTitle.textContent = `编辑 ${item.name}`;
  projectTitle.value = meta.title;
  projectFile.value = item.name.replace(/\.md$/, '');
  projectFile.disabled = true;
  projectSummary.value = meta.summary;
  projectUrl.value = meta.url;
  projectRepo.value = meta.repo;
  projectStatus.value = meta.status;
  projectStarted.value = meta.started;
  projectTags.value = meta.tags.join(' ');
  projectCover.value = meta.cover;
  projectFeatured.checked = meta.featured;
  projectBody.value = item.doc.body;
  projectForm.hidden = false;
  projectTitle.focus();
}

function resetProjectForm(): void {
  state.editingProject = null;
  projectForm.reset();
  projectForm.hidden = true;
  projectFile.disabled = false;
  el<HTMLParagraphElement>('project-hint').textContent =
    '改动先在本地攒着，确认后统一提交';
}

el<HTMLButtonElement>('btn-new-project').addEventListener('click', () => {
  resetProjectForm();
  projectForm.hidden = false;
  projectFormTitle.textContent = '新建项目';
  projectFile.disabled = false;
  projectStarted.value = todayIso();
  projectTitle.focus();
  projectForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

el<HTMLButtonElement>('project-cancel').addEventListener('click', resetProjectForm);

projectForm.addEventListener('submit', (event) => {
  event.preventDefault();
  stageProject();
});

/** 表单内容并入工作副本，此时不碰网络。 */
function stageProject(): void {
  const title = projectTitle.value.trim();
  if (!title) {
    notify('项目名称不能为空', 'warn');
    projectTitle.focus();
    return;
  }

  const meta: ProjectMeta = {
    title,
    summary: projectSummary.value.trim(),
    url: projectUrl.value.trim(),
    repo: projectRepo.value.trim(),
    tags: parseTags(projectTags.value),
    status: projectStatus.value as ProjectStatus,
    featured: projectFeatured.checked,
    order: 0,
    started: projectStarted.value,
    cover: projectCover.value.trim(),
  };
  const body = projectBody.value.trim();

  if (state.editingProject) {
    const index = state.projects.findIndex(
      (entry) => entry.path === state.editingProject?.path,
    );
    if (index === -1) {
      resetProjectForm();
      notify('这个项目已不在列表里', 'warn');
      return;
    }
    const current = state.projects[index];
    state.projects[index] = {
      ...current,
      doc: { meta: { ...meta, order: current.doc.meta.order }, body },
    };
    notify('已加入待提交');
  } else {
    const raw = projectFile.value.trim() || title;
    const base = slugify(raw, 'project');
    const existing = new Set(
      state.projects.map((item) => item.name.replace(/\.md$/, '')),
    );
    const name = `${uniqueName(base, existing)}.md`;

    state.projects.push({
      name,
      path: `${PROJECTS_DIR}/${name}`,
      sha: '',
      doc: { meta: { ...meta, order: state.projects.length }, body },
    });
    notify('已加入待提交');
  }

  state.projects.forEach((item, index) => {
    item.doc.meta.order = index;
  });

  resetProjectForm();
  renderProjects();
  updatePendingBar();
}

function deleteProject(item: RemoteFile & { doc: ProjectDoc }): void {
  if (
    !window.confirm(
      `把「${item.doc.meta.title}」标记为删除？\n\n点「提交并部署」后才真正生效。`,
    )
  ) {
    return;
  }

  state.projects = state.projects.filter((entry) => entry.path !== item.path);
  state.projects.forEach((entry, index) => {
    entry.doc.meta.order = index;
  });
  if (state.editingProject?.path === item.path) resetProjectForm();
  renderProjects();
  updatePendingBar();
  notify('已标记删除，提交后生效');
}

el<HTMLButtonElement>('btn-discard').addEventListener('click', () => {
  if (!window.confirm('放弃所有未提交的项目改动？')) return;
  resetProjectForm();
  void loadProjects();
  notify('已放弃改动');
});

el<HTMLButtonElement>('btn-commit').addEventListener('click', () => {
  void commitProjects();
});

async function commitProjects(): Promise<void> {
  if (state.busy) return;
  if (!connected) {
    notify('先连接 GitHub', 'warn');
    openSettings();
    return;
  }

  const { entries, creates, updates, deletes } = projectChanges();
  if (entries.length === 0) {
    notify('没有待提交的改动');
    return;
  }

  const parts: string[] = [];
  if (creates) parts.push(`新增 ${creates}`);
  if (updates) parts.push(`修改 ${updates}`);
  if (deletes) parts.push(`删除 ${deletes}`);
  const message = `项目更新（${parts.join('，')}）`;

  setBusy(true);
  btnCommit.disabled = true;
  try {
    const commit = await commitFiles(token, entries, message);
    await loadProjects();
    watchDeploy(commit, '项目已更新', { href: '/', label: '看首页' });
  } catch (error) {
    // Git Data API 有时会被 token 权限挡住，退回逐个文件
    try {
      let last: CommitRef = { sha: '', htmlUrl: '' };
      for (const entry of entries) {
        if (entry.delete) {
          const base = projectsBaseline.get(entry.path);
          if (!base?.sha) continue;
          last = await removeFile(token, entry.path, message, base.sha);
        } else {
          const base = projectsBaseline.get(entry.path);
          last = await writeText(
            token,
            entry.path,
            entry.text ?? '',
            message,
            base?.sha,
          );
        }
      }
      await loadProjects();
      watchDeploy(last, '项目已更新', { href: '/', label: '看首页' });
    } catch (fallbackError) {
      notify(friendly(fallbackError), 'warn');
      announce('提交失败', 'warn');
      btnCommit.disabled = false;
    }
  } finally {
    setBusy(false);
  }
}

/* ---------------- settings ---------------- */

function openSettings(errorText = ''): void {
  tokenInput.value = token;
  rememberInput.checked = Boolean(localStorage.getItem(TOKEN_KEY)) || !token;
  settingsHint.textContent = errorText;
  if (typeof settingsDialog.showModal === 'function') settingsDialog.showModal();
  else settingsDialog.setAttribute('open', '');
  window.setTimeout(() => tokenInput.focus(), 50);
}

el<HTMLButtonElement>('btn-settings').addEventListener('click', () => openSettings());

el<HTMLFormElement>('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const ok = await connect(tokenInput.value);
  if (ok) {
    settingsDialog.close();
    notify('已连接');
    await Promise.all([loadNotes(), loadProjects()]);
  }
});

el<HTMLButtonElement>('btn-forget').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  token = '';
  connected = false;
  tokenInput.value = '';
  state.notes = [];
  state.projects = [];
  renderNotes();
  renderProjects();
  announce('未连接', 'idle');
  settingsHint.textContent = '已清除，本浏览器不再保存 token。';
});

el<HTMLButtonElement>('btn-refresh').addEventListener('click', () => {
  if (!connected) {
    openSettings();
    return;
  }
  void Promise.all([loadNotes(), loadProjects()]);
});

/* ---------------- boot ---------------- */

function boot(): void {
  renderImages();
  loadDraft();

  // 会话级 token 不能被启动时的自动连接悄悄升级成持久保存
  rememberInput.checked = Boolean(storedToken) || !token;

  if (!token) {
    announce('未连接', 'idle');
    openSettings();
    return;
  }

  void (async () => {
    const ok = await connect(token);
    if (!ok) {
      openSettings(settingsHint.textContent || '');
      return;
    }
    // 刷新前没走完的部署接着盯，状态栏能自己恢复
    resumeDeployWatch();
    await Promise.all([loadNotes(), loadProjects()]);
  })();
}

// 有没提交的项目改动时，关页面或刷新前提醒一句
window.addEventListener('beforeunload', (event) => {
  if (projectChanges().entries.length === 0) return;
  event.preventDefault();
  event.returnValue = '';
});

/**
 * 顶部栏是 sticky，高度会随字号和换行变化。
 * 待提交栏要贴着它下沿，否则中间会露一条缝，滚动的卡片从缝里透出来。
 */
function syncAdminBarHeight(): void {
  const bar = document.querySelector<HTMLElement>('.admin-bar');
  if (!bar) return;
  document.documentElement.style.setProperty(
    '--admin-bar-h',
    `${Math.round(bar.getBoundingClientRect().height)}px`,
  );
}

syncAdminBarHeight();
window.addEventListener('resize', syncAdminBarHeight);

window.addEventListener('pagehide', () => {
  stopDeployWatch();
  window.clearTimeout(toastTimer);
  window.clearTimeout(deployStatusTimer);
});

boot();
