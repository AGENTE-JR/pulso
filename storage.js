// Almacenamiento: análisis de disco, archivos grandes, duplicados y limpieza de basura
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { app, ipcMain, dialog, shell } = require('electron');
const si = require('systeminformation');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const HOME = os.homedir();
const DAY = 86400000;
const MB = 1048576;
const DUP_MIN = MB; // duplicados: solo archivos de 1 MB o más
const TOP_N = 300;
const norm = (p) => (IS_WIN ? p.toLowerCase() : p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (b) => { if (b < 1024) return b + ' B'; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { b /= 1024; i++; } while (b >= 1024 && i < 3); return (b >= 100 ? b.toFixed(0) : b.toFixed(1)) + ' ' + u[i]; };

let getWin = () => null;
const send = (ch, d) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, d); };

// Limita operaciones de disco simultáneas
function limiter(n) {
  let active = 0; const q = [];
  const next = () => {
    while (active < n && q.length) {
      const { fn, res, rej } = q.shift(); active++;
      Promise.resolve().then(fn).then(res, rej).finally(() => { active--; next(); });
    }
  };
  return (fn) => new Promise((res, rej) => { q.push({ fn, res, rej }); next(); });
}
const io = limiter(48);

// ---------- Categorías por extensión ----------
const CAT_EXT = {
  video: 'mp4 mov mkv avi wmv flv webm m4v mpg mpeg 3gp mts m2ts',
  imagen: 'jpg jpeg png gif bmp webp heic heif tif tiff psd raw cr2 cr3 nef arw dng svg ico',
  audio: 'mp3 wav flac aac ogg m4a wma aiff opus',
  documento: 'pdf doc docx xls xlsx ppt pptx txt md csv odt ods rtf epub',
  comprimido: 'zip rar 7z tar gz tgz bz2 xz iso img dmg',
  programa: 'exe msi msix appx apk pkg deb rpm dll'
};
const EXT = {};
for (const [c, l] of Object.entries(CAT_EXT)) for (const e of l.split(' ')) EXT[e] = c;
const catOf = (name) => EXT[path.extname(name).slice(1).toLowerCase()] || 'otros';

// ---------- Rutas protegidas (nunca se pueden mandar a la papelera) ----------
const PROT_TREE = (IS_WIN
  ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432, process.env.ProgramData]
  : ['/System', '/Library', '/usr', '/bin', '/sbin', '/etc', '/var', '/private', '/opt', '/boot', '/proc', '/sys', '/dev', '/lib', '/lib64', '/snap']
).filter(Boolean).map((p) => norm(path.resolve(p)));
let PROT_EXACT = new Set();
const SYS_FILES = /^(pagefile\.sys|hiberfil\.sys|swapfile\.sys|dumpstack\.log(\.tmp)?|bootmgr|ntldr)$/i;
const SYS_DIRS = /[\\/](\$recycle\.bin|system volume information|recovery|\$windows\.~bt|\$winreagent)([\\/]|$)/i;

function initProtected() {
  PROT_TREE.push(norm(path.resolve(app.getAppPath())), norm(path.resolve(path.dirname(process.execPath))), norm(path.resolve(app.getPath('userData'))));
  const exact = [HOME, ...['desktop', 'documents', 'downloads', 'pictures', 'videos', 'music'].map((k) => { try { return app.getPath(k); } catch { return null; } }),
    ...['AppData', 'AppData/Local', 'AppData/Roaming', 'AppData/LocalLow', 'OneDrive', 'Library', 'Applications', '.config', '.local'].map((f) => path.join(HOME, f))];
  PROT_EXACT = new Set(exact.filter(Boolean).map((p) => norm(path.resolve(p))));
}
function isProtected(p) {
  const n = norm(path.resolve(p));
  if (path.parse(n).root === n) return true; // raíz de unidad
  if (PROT_EXACT.has(n) || SYS_FILES.test(path.basename(n)) || SYS_DIRS.test(n)) return true;
  return PROT_TREE.some((q) => n === q || n.startsWith(q + path.sep));
}
// Carpetas donde no se buscan duplicados (sistema, apps, código, ocultas)
const NO_DUP = new Set(['node_modules', 'appdata', 'windows', 'program files', 'program files (x86)', 'programdata', '$recycle.bin', 'system volume information', 'library', 'site-packages', 'venv']);
const skipDup = (name) => name.startsWith('.') || NO_DUP.has(name.toLowerCase());

function fixRoot(p) { if (IS_WIN && /^[a-z]:$/i.test(p)) p += '\\'; return path.resolve(p); }

// ---------- Escáner ----------
let scan = null;

function addTop(s, f) {
  if (s.top.length >= TOP_N && f.size <= s.minTop) return;
  s.top.push(f);
  if (s.top.length > TOP_N * 2) { s.top.sort((a, b) => b.size - a.size); s.top.length = TOP_N; s.minTop = s.top[TOP_N - 1].size; }
}

async function scanDir(s, dir, parent, noDup, stack, order) {
  const node = { parent, size: 0, files: 0, kids: [] };
  s.nodes.set(dir, node); order.push(dir); s.dirs++; s.current = dir;
  let ents;
  try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { s.errors++; return; }
  const files = [];
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { node.kids.push(p); stack.push([p, dir, noDup || skipDup(e.name)]); }
    else if (e.isFile() || e.isSymbolicLink()) files.push(e); // en Windows OneDrive aparece como enlace: se comprueba con lstat
  }
  for (let i = 0; i < files.length && !s.cancelled; i += 32) {
    await Promise.all(files.slice(i, i + 32).map(async (e) => {
      const p = path.join(dir, e.name);
      let st; try { st = await fsp.lstat(p); } catch { s.errors++; return; }
      if (st.isSymbolicLink()) return;
      if (st.isDirectory()) { node.kids.push(p); stack.push([p, dir, noDup || skipDup(e.name)]); return; }
      if (!st.isFile()) return;
      const size = st.size, cat = catOf(e.name);
      node.size += size; node.files++; s.files++; s.bytes += size;
      s.cats[cat] = (s.cats[cat] || 0) + size;
      addTop(s, { path: p, size, mtime: st.mtimeMs, cat });
      if (!noDup && size >= DUP_MIN) { const l = s.bySize.get(size); l ? l.push(p) : s.bySize.set(size, [p]); }
    }));
  }
}

async function runScan(s) {
  const noDup = isProtected(s.root) || s.root.split(/[\\/]/).some((x) => x && skipDup(x));
  const stack = [[s.root, null, noDup]], order = [];
  let active = 0;
  const worker = async () => {
    while (!s.cancelled) {
      const job = stack.pop();
      if (!job) { if (!active) return; await sleep(4); continue; }
      active++;
      try { await scanDir(s, ...job, stack, order); } catch { s.errors++; } finally { active--; }
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  // Suma de abajo hacia arriba: los hijos siempre se descubren después que el padre
  for (let i = order.length - 1; i >= 0; i--) {
    const n = s.nodes.get(order[i]); const par = n.parent != null && s.nodes.get(n.parent);
    if (par) { par.size += n.size; par.files += n.files; }
  }
}

const progress = (s) => ({ root: s.root, files: s.files, dirs: s.dirs, bytes: s.bytes, errors: s.errors, current: s.current, secs: Math.round((Date.now() - s.t0) / 1000) });

function startScan(root) {
  if (scan && !scan.done) scan.cancelled = true;
  if (dupJob) dupJob.cancelled = true;
  const s = scan = { root: fixRoot(root), nodes: new Map(), top: [], minTop: 0, cats: {}, bySize: new Map(), files: 0, dirs: 0, bytes: 0, errors: 0, current: '', cancelled: false, done: false, t0: Date.now() };
  const tick = setInterval(() => send('storage:progress', progress(s)), 300);
  runScan(s).finally(() => {
    clearInterval(tick);
    s.top.sort((a, b) => b.size - a.size); if (s.top.length > TOP_N) s.top.length = TOP_N;
    s.done = true;
    if (scan === s || s.cancelled) send('storage:progress', { ...progress(s), done: true, cancelled: s.cancelled, total: s.nodes.get(s.root)?.size || 0 });
  });
  return s.root;
}

// Quita un archivo/carpeta del árbol tras moverlo a la papelera
function treeRemove(p, size) {
  const s = scan; if (!s) return;
  const n = s.nodes.get(p); let files = 1, parent = path.dirname(p);
  if (n) {
    size = n.size; files = n.files; parent = n.parent;
    const pre = p + path.sep;
    for (const k of s.nodes.keys()) if (k === p || k.startsWith(pre)) s.nodes.delete(k);
    const pn = s.nodes.get(parent); if (pn) pn.kids = pn.kids.filter((k) => k !== p);
  } else { const c = catOf(p); s.cats[c] = Math.max(0, (s.cats[c] || 0) - size); }
  for (let q = parent; q != null;) { const x = s.nodes.get(q); if (!x) break; x.size -= size; x.files -= files; q = x.parent; }
  s.bytes -= size; s.files -= files;
  s.top = s.top.filter((f) => f.path !== p && !f.path.startsWith(p + path.sep));
}

async function listDir(dir) {
  const s = scan; const node = s && s.done && s.nodes.get(dir);
  if (!node) return null;
  const items = [];
  for (const k of node.kids) { const n = s.nodes.get(k); if (n) items.push({ name: path.basename(k), path: k, dir: true, size: n.size, files: n.files, prot: isProtected(k) }); }
  let ents = []; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch {}
  await Promise.all(ents.filter((e) => e.isFile() || e.isSymbolicLink()).map((e) => io(async () => {
    const p = path.join(dir, e.name);
    try { const st = await fsp.lstat(p); if (st.isFile()) items.push({ name: e.name, path: p, dir: false, size: st.size, mtime: st.mtimeMs, cat: catOf(e.name), prot: isProtected(p) }); } catch {}
  })));
  items.sort((a, b) => b.size - a.size);
  const crumbs = [];
  for (let q = dir; q != null;) { crumbs.unshift({ name: path.basename(q) || q, path: q }); q = s.nodes.get(q)?.parent ?? null; }
  return { path: dir, size: node.size, files: node.files, items: items.slice(0, 500), more: Math.max(0, items.length - 500), crumbs };
}

// ---------- Duplicados ----------
let dupJob = null;

async function hashPart(p, size) {
  const fh = await fsp.open(p, 'r');
  try {
    const n = Math.min(65536, size), h = crypto.createHash('md5');
    const a = Buffer.alloc(n); await fh.read(a, 0, n, 0); h.update(a);
    if (size > n) { const b = Buffer.alloc(n); await fh.read(b, 0, n, size - n); h.update(b); }
    return h.digest('hex');
  } finally { await fh.close(); }
}
function hashFull(p, job, onBytes) {
  return new Promise((res, rej) => {
    const h = crypto.createHash('md5');
    const rs = fs.createReadStream(p, { highWaterMark: MB });
    rs.on('data', (c) => { if (job.cancelled) { rs.destroy(); rej(new Error('cancelado')); return; } h.update(c); onBytes(c.length); });
    rs.on('error', rej);
    rs.on('end', () => res(h.digest('hex')));
  });
}
const groupPush = (m, k, v) => { const l = m.get(k); l ? l.push(v) : m.set(k, [v]); };

async function findDupes() {
  const s = scan;
  if (!s || !s.done || s.cancelled) return { error: 'Primero analiza una unidad o carpeta.' };
  if (dupJob) dupJob.cancelled = true;
  const job = dupJob = { cancelled: false };
  const p = { phase: 'Comparando inicio y final de archivos del mismo tamaño', done: 0, total: 0, bytesDone: 0, bytesTotal: 0 };
  const tick = setInterval(() => send('storage:dupProgress', p), 300);
  try {
    const cands = [...s.bySize].filter(([, l]) => l.length > 1);
    p.total = cands.reduce((a, [, l]) => a + l.length, 0);
    const lim1 = limiter(16), stage2 = [];
    await Promise.all(cands.map(async ([size, list]) => {
      const by = new Map();
      await Promise.all(list.map((f) => lim1(async () => {
        if (job.cancelled) return;
        try { groupPush(by, await hashPart(f, size), f); } catch {}
        p.done++;
      })));
      for (const l of by.values()) if (l.length > 1) stage2.push([size, l]);
    }));
    if (job.cancelled) return { cancelled: true };

    p.phase = 'Verificando el contenido completo'; p.done = 0;
    p.total = stage2.reduce((a, [, l]) => a + l.length, 0);
    p.bytesTotal = stage2.reduce((a, [sz, l]) => a + sz * l.length, 0);
    const lim2 = limiter(4), groups = [];
    await Promise.all(stage2.map(async ([size, list]) => {
      const by = new Map();
      await Promise.all(list.map((f) => lim2(async () => {
        if (job.cancelled) return;
        try { const h = await hashFull(f, job, (n) => { p.bytesDone += n; }); const st = await fsp.stat(f); groupPush(by, h, { path: f, mtime: st.mtimeMs, prot: isProtected(f) }); } catch {}
        p.done++;
      })));
      for (const [hash, l] of by) if (l.length > 1) groups.push({ size, hash, files: l.sort((a, b) => a.mtime - b.mtime) });
    }));
    if (job.cancelled) return { cancelled: true };
    const waste = (g) => g.size * (g.files.length - 1);
    groups.sort((a, b) => waste(b) - waste(a));
    return { groups, wasted: groups.reduce((a, g) => a + waste(g), 0) };
  } finally { clearInterval(tick); if (dupJob === job) dupJob = null; }
}

// ---------- Basura ----------
const isSafeDir = (p) => p && path.isAbsolute(p) && p.length > 8 && !isRootish(p);
const isRootish = (p) => { const n = norm(path.resolve(p)); return path.parse(n).root === n || n === norm(HOME); };
const existing = (l) => l.filter((p) => isSafeDir(p) && fs.existsSync(p));
function subdirs(base, re) {
  try { return fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory() && (!re || re.test(e.name))).map((e) => path.join(base, e.name)); } catch { return []; }
}
const electronCaches = (dir) => ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache'].map((c) => path.join(dir, c));

function browserCaches() {
  const L = process.env.LOCALAPPDATA, out = [];
  if (!L) return out;
  for (const base of ['Google/Chrome/User Data', 'Microsoft/Edge/User Data', 'BraveSoftware/Brave-Browser/User Data', 'Vivaldi/User Data'].map((b) => path.join(L, b))) {
    out.push(path.join(base, 'ShaderCache'), path.join(base, 'GrShaderCache'), path.join(base, 'GraphiteDawnCache'));
    for (const prof of subdirs(base, /^(Default|Profile \d+|Guest Profile)$/)) out.push(...electronCaches(prof));
  }
  out.push(path.join(L, 'Opera Software', 'Opera Stable', 'Cache'), path.join(L, 'Opera Software', 'Opera GX Stable', 'Cache'));
  for (const prof of subdirs(path.join(L, 'Mozilla', 'Firefox', 'Profiles'))) out.push(path.join(prof, 'cache2'));
  return existing(out);
}
function appCaches() {
  const L = process.env.LOCALAPPDATA, R = process.env.APPDATA, out = [];
  if (R) for (const a of ['discord', 'Slack', 'Code', 'Microsoft/Teams', 'Notion', 'obs-studio', 'WhatsApp', 'Figma', 'CapCut']) out.push(...electronCaches(path.join(R, a)));
  if (R) out.push(path.join(R, 'Code', 'CachedData'), path.join(R, 'Code', 'logs'));
  if (L) out.push(path.join(L, 'Spotify', 'Data'), path.join(L, 'Steam', 'htmlcache'), path.join(L, 'D3DSCache'), path.join(L, 'NVIDIA', 'DXCache'), path.join(L, 'NVIDIA', 'GLCache'), path.join(L, 'AMD', 'DxCache'));
  return existing(out);
}

async function binRoots() {
  if (!IS_WIN) return existing([IS_MAC ? path.join(HOME, '.Trash') : path.join(HOME, '.local', 'share', 'Trash')]);
  let mounts = []; try { mounts = (await si.fsSize()).map((d) => d.mount); } catch {}
  return mounts.filter((m) => /^[a-z]:$/i.test(m)).map((m) => m + '\\$Recycle.Bin').filter((p) => fs.existsSync(p));
}

async function junkDefs() {
  const L = process.env.LOCALAPPDATA || '', R = process.env.APPDATA || '', W = process.env.SystemRoot || 'C:\\Windows', PD = process.env.ProgramData || 'C:\\ProgramData';
  const downloads = (() => { try { return app.getPath('downloads'); } catch { return path.join(HOME, 'Downloads'); } })();
  const bin = { id: 'bin', name: IS_WIN ? 'Papelera de reciclaje' : 'Papelera', desc: 'Vaciarla borra su contenido para siempre.', paths: await binRoots(), special: 'bin', def: false };
  const old = { id: 'old', name: 'Descargas antiguas (más de 90 días)', desc: 'No es basura segura: revísalas. Se mueven a la Papelera.', paths: existing([downloads]), minAge: 90 * DAY, shallow: true, toTrash: true, def: false };
  if (IS_WIN) return [
    { id: 'tmp', name: 'Archivos temporales del usuario', desc: 'Restos de instaladores y programas. Se saltan los usados en las últimas 24 h.', paths: existing([os.tmpdir()]), minAge: DAY, def: true },
    { id: 'wtmp', name: 'Temporales de Windows', desc: 'Lo que esté bloqueado o requiera administrador se salta.', paths: existing([path.join(W, 'Temp')]), minAge: DAY, def: true },
    { id: 'browser', name: 'Caché de navegadores', desc: 'Chrome, Edge, Brave, Opera, Firefox. Cierra el navegador para limpiar todo.', paths: browserCaches(), def: true },
    { id: 'apps', name: 'Caché de apps y GPU', desc: 'Discord, Spotify, VS Code, Teams, OBS, caché de sombreadores de NVIDIA/AMD…', paths: appCaches(), def: true },
    { id: 'crash', name: 'Informes de errores y volcados', desc: 'Volcados de memoria de programas que se cerraron mal.', paths: existing([path.join(L, 'CrashDumps'), path.join(L, 'Microsoft', 'Windows', 'WER'), path.join(PD, 'Microsoft', 'Windows', 'WER', 'ReportArchive'), path.join(PD, 'Microsoft', 'Windows', 'WER', 'ReportQueue')]), def: true },
    { id: 'thumbs', name: 'Caché de miniaturas', desc: 'Windows las vuelve a generar al abrir carpetas.', paths: existing([path.join(L, 'Microsoft', 'Windows', 'Explorer')]), match: /^(thumbcache|iconcache)_.*\.db$/i, def: false },
    { id: 'dev', name: 'Caché de desarrollo', desc: 'npm, pip, yarn, Electron. Se vuelve a descargar si hace falta (Pulso usa la de Electron al instalar).', paths: existing([path.join(L, 'npm-cache'), path.join(R, 'npm-cache'), path.join(L, 'pip', 'Cache'), path.join(L, 'Yarn', 'Cache'), path.join(L, 'electron', 'Cache'), path.join(L, 'electron-builder', 'Cache')]), def: false },
    { id: 'wu', name: 'Descargas de Windows Update', desc: 'Actualizaciones ya instaladas. Necesita abrir Pulso como administrador.', paths: existing([path.join(W, 'SoftwareDistribution', 'Download')]), def: false },
    bin, old
  ];
  const cache = IS_MAC ? path.join(HOME, 'Library', 'Caches') : (process.env.XDG_CACHE_HOME || path.join(HOME, '.cache'));
  return [
    { id: 'cache', name: 'Caché de apps', desc: 'Se regenera sola. Se saltan los archivos usados en las últimas 24 h.', paths: existing([cache]), minAge: DAY, def: true },
    { id: 'logs', name: 'Registros (logs)', desc: 'Historial de diagnóstico de las apps.', paths: existing([IS_MAC ? path.join(HOME, 'Library', 'Logs') : path.join(HOME, '.local', 'state')]), match: /\.log(\.\d+)?$/i, minAge: 7 * DAY, def: IS_MAC },
    bin, old
  ];
}

const passes = (def) => (name, st) => (!def.match || def.match.test(name)) && (!def.minAge || Date.now() - st.mtimeMs > def.minAge);

async function sizeTree(dir, filt, acc) {
  let ents; try { ents = await io(() => fsp.readdir(dir, { withFileTypes: true })); } catch { return; }
  await Promise.all(ents.map(async (e) => {
    if (e.isSymbolicLink()) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sizeTree(p, filt, acc);
    if (!e.isFile()) return;
    try { const st = await io(() => fsp.lstat(p)); if (filt(e.name, st)) { acc.size += st.size; acc.count++; } } catch {}
  }));
}
async function deleteTree(dir, filt, def, acc) {
  let ents; try { ents = await io(() => fsp.readdir(dir, { withFileTypes: true })); } catch { return; }
  await Promise.all(ents.map(async (e) => {
    if (e.isSymbolicLink()) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await deleteTree(p, filt, def, acc);
      try { const st = await fsp.lstat(p); if (!def.minAge || Date.now() - st.mtimeMs > def.minAge) await fsp.rmdir(p); } catch {}
      return;
    }
    if (!e.isFile()) return;
    try { const st = await io(() => fsp.lstat(p)); if (!filt(e.name, st)) return; await io(() => fsp.unlink(p)); acc.size += st.size; acc.count++; } catch { acc.skipped++; }
  }));
}

let junk = null;
async function analyzeJunk() {
  const defs = await junkDefs();
  await Promise.all(defs.map(async (d) => {
    const acc = { size: 0, count: 0 }; d.items = [];
    for (const root of d.paths) {
      if (d.shallow) {
        let ents = []; try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch {}
        for (const e of ents) {
          if (e.isSymbolicLink()) continue;
          const p = path.join(root, e.name);
          try {
            const st = await fsp.lstat(p);
            if (Date.now() - st.mtimeMs < d.minAge) continue;
            const a = { size: 0, count: 0 };
            if (st.isDirectory()) await sizeTree(p, () => true, a); else { a.size = st.size; a.count = 1; }
            d.items.push({ path: p, size: a.size }); acc.size += a.size; acc.count += a.count;
          } catch {}
        }
      } else await sizeTree(root, passes(d), acc);
    }
    d.size = acc.size; d.count = acc.count;
  }));
  junk = defs;
  return defs.map(({ id, name, desc, size, count, def, toTrash }) => ({ id, name, desc, size, count, def, toTrash }));
}

function ps(cmd) {
  return new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 120000 }, (err) => res(!err)));
}

async function cleanJunk(ids) {
  const sel = (junk || []).filter((j) => ids.includes(j.id) && j.size > 0);
  if (!sel.length) return null;
  const total = sel.reduce((a, j) => a + j.size, 0);
  const notes = [];
  if (sel.some((j) => !j.toTrash)) notes.push('Temporales, cachés y papelera se borran definitivamente (los programas los regeneran).');
  if (sel.some((j) => j.toTrash)) notes.push('Las descargas antiguas van a la Papelera de reciclaje.');
  notes.push('Lo que esté en uso se salta.');
  const r = await dialog.showMessageBox(getWin(), {
    type: 'warning', buttons: ['Limpiar', 'Cancelar'], defaultId: 1, cancelId: 1, noLink: true, title: 'Limpiar basura',
    message: `¿Liberar hasta ${fmt(total)}?`, detail: sel.map((j) => `• ${j.name}: ${fmt(j.size)}`).join('\n') + '\n\n' + notes.join(' ')
  });
  if (r.response !== 0) return null;
  const acc = { size: 0, count: 0, skipped: 0 };
  for (const d of sel) {
    if (d.toTrash) {
      for (const it of d.items) { if (isProtected(it.path)) continue; try { await shell.trashItem(it.path); acc.size += it.size; acc.count++; } catch { acc.skipped++; } }
    } else if (d.special === 'bin' && IS_WIN) {
      if (await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue')) { acc.size += d.size; acc.count += d.count; }
    } else {
      for (const root of d.paths) if (isSafeDir(root)) await deleteTree(root, passes(d), d, acc);
    }
  }
  return acc;
}

// ---------- Papelera (archivos del usuario) ----------
async function trash(paths) {
  paths = [...new Set((Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && path.isAbsolute(p)))];
  const blocked = paths.filter(isProtected);
  paths = paths.filter((p) => !isProtected(p));
  if (!paths.length) return { blocked: blocked.length, ok: 0, freed: 0, failed: [] };
  const sizes = await Promise.all(paths.map(async (p) => {
    const n = scan && scan.nodes.get(p);
    if (n) return n.size;
    try { return (await fsp.lstat(p)).size; } catch { return 0; }
  }));
  const total = sizes.reduce((a, b) => a + b, 0);
  const names = paths.slice(0, 8).map((p) => '• ' + path.basename(p)).join('\n') + (paths.length > 8 ? `\n…y ${paths.length - 8} más` : '');
  const r = await dialog.showMessageBox(getWin(), {
    type: 'question', buttons: ['Mover a la papelera', 'Cancelar'], defaultId: 0, cancelId: 1, noLink: true, title: 'Mover a la papelera',
    message: `¿Mover ${paths.length} elemento${paths.length > 1 ? 's' : ''} (${fmt(total)}) a la papelera?`,
    detail: names + '\n\nPodrás recuperarlos desde la papelera hasta que la vacíes.' + (blocked.length ? `\n${blocked.length} elemento(s) del sistema se omitieron.` : '')
  });
  if (r.response !== 0) return null;
  let ok = 0, freed = 0; const failed = [];
  for (let i = 0; i < paths.length; i++) {
    try { await shell.trashItem(paths[i]); ok++; freed += sizes[i]; treeRemove(paths[i], sizes[i]); }
    catch { failed.push(path.basename(paths[i])); }
  }
  return { ok, freed, failed, blocked: blocked.length };
}

// ---------- Unidades y carpetas rápidas ----------
async function drives() {
  let list = [];
  try {
    list = (await si.fsSize()).filter((d) => d.size > 0).map((d) => ({ mount: d.mount, root: fixRoot(d.mount), size: d.size, used: d.used, free: d.available ?? d.size - d.used }));
  } catch {}
  if (!IS_WIN) list = list.filter((d) => d.mount === '/' || /^\/(Volumes|media|mnt|run\/media)\//.test(d.mount));
  const folders = [['Descargas', 'downloads'], ['Escritorio', 'desktop'], ['Documentos', 'documents'], ['Videos', 'videos'], ['Imágenes', 'pictures'], ['Mi usuario', 'home']]
    .map(([name, k]) => { try { return { name, path: app.getPath(k) }; } catch { return null; } })
    .filter((f) => f && fs.existsSync(f.path));
  return { drives: list, folders };
}

function init(gw) {
  getWin = gw;
  initProtected();
  ipcMain.handle('storage:drives', () => drives());
  ipcMain.handle('storage:pick', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Elige una carpeta para analizar', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('storage:scan', (_e, root) => (typeof root === 'string' && fs.existsSync(root) ? startScan(root) : null));
  ipcMain.handle('storage:cancel', () => { if (scan) scan.cancelled = true; if (dupJob) dupJob.cancelled = true; });
  ipcMain.handle('storage:dir', (_e, dir) => listDir(dir));
  ipcMain.handle('storage:top', () => (scan && scan.done ? { files: scan.top.map((f) => ({ ...f, prot: isProtected(f.path) })), cats: scan.cats, total: scan.bytes } : null));
  ipcMain.handle('storage:dupes', () => findDupes());
  ipcMain.handle('storage:junk', () => analyzeJunk());
  ipcMain.handle('storage:junkClean', (_e, ids) => cleanJunk(Array.isArray(ids) ? ids : []));
  ipcMain.handle('storage:trash', (_e, paths) => trash(paths));
  ipcMain.handle('storage:reveal', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });
}

module.exports = { init };
