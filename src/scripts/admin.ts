import {
  parseNote,
  parseProject,
  serializeNote,
  serializeProject,
  todayIso,
  type NoteDoc,
  type NoteMeta,
  type ProjectDoc,
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
  type CommitRef,
  type RemoteFile,
} from '../lib/github';

const TOKEN_KEY = 'emolu.admin.token';
const SESSION_TOKEN_KEY = 'emolu.admin.session-token';
const DRAFT_KEY = 'emolu.admin.draft';

const NOTES_DIR = 'src/content/notes';
const PROJECTS_DIR = 'src/content/projects';
const UPLOADS_DIR = 'public/uploads';

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

function announce(message: string, tone: 'idle' | 'ok' | 'warn' = 'idle'): void {
  statusLine.textContent = message;
  statusLine.dataset.tone = tone;
  delete statusLine.dataset.pending;
}

function announceDeploying(): void {
  announce('等待部署…', 'idle');
  statusLine.dataset.pending = 'true';
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

/**
 * 提交后盯着 main 上最新一次部署，直到这次提交真的上线。
 * 连续提交时 GitHub 会取消前一次的部署，那不算失败，继续等新的那次。
 * 运行记录是公开接口，token 的细粒度权限影响不到它。
 * 调用方要先刷新完列表再调它，否则状态栏会被列表的提示盖掉。
 */
function watchDeploy(
  commit: CommitRef,
  doneMessage: string,
  target: ToastLink,
): void {
  stopDeployWatch();
  if (!commit.sha) {
    announce(`${doneMessage}，约 1 分钟生效`, 'ok');
    return;
  }

  const startedAt = Date.now();
  announceDeploying();

  const poll = async (): Promise<void> => {
    if (Date.now() - startedAt > DEPLOY_MAX_MS) {
      // 提交已经进仓库了，只是构建慢，别吓唬人
      announce('提交已完成，部署还在跑', 'idle');
      notify(`${doneMessage}，部署还在跑`, 'ok', target);
      return;
    }

    const run = await latestDeployRun();

    if (run?.status !== 'completed') {
      deployTimer = window.setTimeout(() => void poll(), DEPLOY_POLL_MS);
      return;
    }

    // 被取消是因为后面还有新提交，站点最终会由最新那次决定
    if (run.conclusion === 'cancelled' || run.conclusion === 'skipped') {
      deployTimer = window.setTimeout(() => void poll(), DEPLOY_POLL_MS);
      return;
    }

    if (run.conclusion === 'success') {
      announce('已上线', 'ok');
      notify(doneMessage, 'ok', target);
    } else {
      announce('部署失败', 'warn');
      notify('部署失败，看 Actions 日志', 'warn', {
        href: run.htmlUrl || 'https://github.com/mh567/mainpage/actions',
        label: '看 Actions',
      });
    }
  };

  deployTimer = window.setTimeout(() => void poll(), DEPLOY_POLL_MS);
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

async function loadNotes(): Promise<void> {
  if (!connected) return;
  setBusy(true);
  announce('加载短帖…');
  try {
    const files = await listMarkdown(token, NOTES_DIR);
    const loaded = await mapLimit(files, 6, async (file) => {
      const { text, sha } = await readFile(token, file.path);
      return { ...file, sha, doc: parseNote(text) };
    });
    loaded.sort((a, b) => (a.doc.meta.date < b.doc.meta.date ? 1 : -1));
    state.notes = loaded;
    renderNotes();
    announce(`已加载 ${loaded.length} 条短帖`, 'ok');
  } catch (error) {
    notify(friendly(error), 'warn');
    announce('加载失败', 'warn');
  } finally {
    setBusy(false);
  }
}

function renderNotes(): void {
  notesList.replaceChildren();
  notesCount.textContent = String(state.notes.length);
  notesCount.hidden = state.notes.length === 0;

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
const projectForm = el<HTMLFormElement>('project-form');
const projectFormTitle = el<HTMLElement>('project-form-title');
const projectTitle = el<HTMLInputElement>('project-title');
const projectFile = el<HTMLInputElement>('project-file');
const projectSummary = el<HTMLInputElement>('project-summary');
const projectUrl = el<HTMLInputElement>('project-url');
const projectRepo = el<HTMLInputElement>('project-repo');
const projectStatus = el<HTMLSelectElement>('project-status');
const projectOrder = el<HTMLInputElement>('project-order');
const projectStarted = el<HTMLInputElement>('project-started');
const projectTags = el<HTMLInputElement>('project-tags');
const projectCover = el<HTMLInputElement>('project-cover');
const projectFeatured = el<HTMLInputElement>('project-featured');
const projectBody = el<HTMLTextAreaElement>('project-body');

async function loadProjects(): Promise<void> {
  if (!connected) return;
  setBusy(true);
  announce('加载项目…');
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
    state.projects = loaded;
    renderProjects();
    announce(`已加载 ${loaded.length} 个项目`, 'ok');
  } catch (error) {
    notify(friendly(error), 'warn');
    announce('加载失败', 'warn');
  } finally {
    setBusy(false);
  }
}

function renderProjects(): void {
  projectsList.replaceChildren();

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
    void applyProjectOrder(from, index);
  });
}

async function applyProjectOrder(from: number, to: number): Promise<void> {
  if (from === to || to < 0 || to >= state.projects.length) return;
  if (state.busy) return;

  const previous = [...state.projects];
  const next = [...state.projects];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  // 顺序就是数组下标，重新编号后再和原值比较，只改真正变了的文件
  const changes = next
    .map((item, order) => ({ item, order }))
    .filter(({ item, order }) => item.doc.meta.order !== order);

  if (changes.length === 0) return;

  state.projects = next.map((item, order) => ({
    ...item,
    doc: { ...item.doc, meta: { ...item.doc.meta, order } },
  }));
  renderProjects();
  announce('正在保存顺序…');
  setBusy(true);

  try {
    const commit = await commitFiles(
      token,
      changes.map(({ item, order }) => ({
        path: item.path,
        text: serializeProject({
          meta: { ...item.doc.meta, order },
          body: item.doc.body,
        }),
      })),
      `调整项目顺序（${moved.doc.meta.title} 移到第 ${to + 1} 位）`,
    );
    watchDeploy(commit, '顺序已保存', { href: '/', label: '看首页' });
  } catch (error) {
    // Git Data API 有时会被 token 权限挡住，退回一次一个文件
    try {
      let last: CommitRef = { sha: '', htmlUrl: '' };
      for (const { item, order } of changes) {
        last = await writeText(
          token,
          item.path,
          serializeProject({
            meta: { ...item.doc.meta, order },
            body: item.doc.body,
          }),
          `调整项目顺序：${item.doc.meta.title} → 第 ${order + 1} 位`,
        );
      }
      watchDeploy(last, '顺序已保存', { href: '/', label: '看首页' });
    } catch (fallbackError) {
      state.projects = previous;
      renderProjects();
      notify(friendly(fallbackError), 'warn');
      announce('顺序保存失败', 'warn');
    }
  } finally {
    setBusy(false);
  }
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
  projectOrder.value = String(meta.order);
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
  el<HTMLParagraphElement>('project-hint').textContent = '保存后约 1 分钟生效';
}

el<HTMLButtonElement>('btn-new-project').addEventListener('click', () => {
  resetProjectForm();
  projectForm.hidden = false;
  projectFormTitle.textContent = '新建项目';
  projectFile.disabled = false;
  projectOrder.value = String(state.projects.length);
  projectStarted.value = todayIso();
  projectTitle.focus();
  projectForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

el<HTMLButtonElement>('project-cancel').addEventListener('click', resetProjectForm);

projectForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void saveProject();
});

async function saveProject(): Promise<void> {
  if (state.busy) return;
  if (!connected) {
    notify('先连接 GitHub', 'warn');
    openSettings();
    return;
  }

  const title = projectTitle.value.trim();
  if (!title) {
    notify('项目名称不能为空', 'warn');
    projectTitle.focus();
    return;
  }

  const doc: ProjectDoc = {
    meta: {
      title,
      summary: projectSummary.value.trim(),
      url: projectUrl.value.trim(),
      repo: projectRepo.value.trim(),
      tags: parseTags(projectTags.value),
      status: projectStatus.value as ProjectStatus,
      featured: projectFeatured.checked,
      order: Number(projectOrder.value) || 0,
      started: projectStarted.value,
      cover: projectCover.value.trim(),
    },
    body: projectBody.value.trim(),
  };

  setBusy(true);
  announce('正在保存项目…');
  try {
    let commit: CommitRef;
    let done: string;

    if (state.editingProject) {
      commit = await writeText(
        token,
        state.editingProject.path,
        serializeProject(doc),
        `更新项目 ${title}`,
        state.editingProject.sha,
      );
      done = '项目已更新';
    } else {
      const raw = projectFile.value.trim() || title;
      const base = slugify(raw, 'project');
      const existing = new Set(
        state.projects.map((item) => item.name.replace(/\.md$/, '')),
      );
      const name = `${uniqueName(base, existing)}.md`;
      commit = await writeText(
        token,
        `${PROJECTS_DIR}/${name}`,
        serializeProject(doc),
        `新增项目 ${title}`,
      );
      done = '项目已创建';
    }

    resetProjectForm();
    await loadProjects();
    watchDeploy(commit, done, { href: '/', label: '看首页' });
  } catch (error) {
    notify(friendly(error), 'warn');
    announce('保存失败', 'warn');
  } finally {
    setBusy(false);
  }
}

async function deleteProject(item: RemoteFile & { doc: ProjectDoc }): Promise<void> {
  if (!window.confirm(`删除项目「${item.doc.meta.title}」？\n\n这个操作会直接提交到仓库。`)) {
    return;
  }

  setBusy(true);
  announce('正在删除…');
  try {
    const commit = await removeFile(
      token,
      item.path,
      `删除项目 ${item.doc.meta.title}`,
      item.sha,
    );
    state.projects = state.projects.filter((entry) => entry.path !== item.path);
    if (state.editingProject?.path === item.path) resetProjectForm();
    renderProjects();
    watchDeploy(commit, '已删除', { href: '/', label: '看首页' });
  } catch (error) {
    notify(friendly(error), 'warn');
    announce('删除失败', 'warn');
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
    await Promise.all([loadNotes(), loadProjects()]);
  })();
}

window.addEventListener('pagehide', () => {
  stopDeployWatch();
  window.clearTimeout(toastTimer);
});

boot();
