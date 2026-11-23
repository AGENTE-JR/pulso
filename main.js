// Pulso — monitor de hardware. Proceso principal: lee sensores y los envía a la interfaz.
const { app, BrowserWindow, ipcMain, Notification, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const si = require('systeminformation');

let win = null;
let mini = null;

// ---------- Configuración persistente ----------
const DATA_DIR = () => app.getPath('userData');
const CONFIG_FILE = () => path.join(DATA_DIR(), 'config.json');
const SESSIONS_DIR = () => path.join(DATA_DIR(), 'sesiones');

const DEFAULT_CONFIG = {
  thresholds: { cpuTemp: 90, gpuTemp: 85, ram: 90 },
  alerts: true,
  groups: [
    { id: 'claude', name: 'Claude', color: '#d97757', match: ['claude'] },
    { id: 'render', name: 'Render / Exportar', color: '#7c8cff', match: ['remotion', 'ffmpeg', 'chrome-headless', 'headless_shell', 'handbrake'] },
    { id: 'browser', name: 'Navegador', color: '#38bdf8', match: ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'safari', 'arc.exe', 'arc.app', 'vivaldi'] },
    { id: 'editor', name: 'Edición / Código', color: '#34d399', match: ['code.exe', 'visual studio code', 'code helper', '/usr/share/code', 'capcut', 'premiere', 'after effects', 'resolve', 'davinci', 'final cut', 'obs64', 'obs.app', '/obs', 'blender', 'photoshop'] }
  ]
};

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
    return { ...DEFAULT_CONFIG, ...c, thresholds: { ...DEFAULT_CONFIG.thresholds, ...(c.thresholds || {}) } };
  } catch { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
}
function saveConfig(c) {
  fs.mkdirSync(DATA_DIR(), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(c, null, 2));
}
let config;

// ---------- Estado de sensores ----------
const state = {
  static: null,
  cpu: { load: 0, cores: [], speed: null, temp: null, tempSource: null },
  gpu: null,
  mem: null,
  net: { rx: 0, tx: 0, iface: null },
  disks: [],
  battery: null,
  procs: [],
  groups: [],
  fans: [],
  ts: 0
};

const run = (cmd, args, timeout = 4000) => new Promise((res) => {
  execFile(cmd, args, { timeout, windowsHide: true }, (err, out) => res(err ? null : String(out)));
});
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// GPU NVIDIA vía nvidia-smi (fiable, sin permisos de admin)
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const IS_LINUX = process.platform === 'linux';

// GPU: NVIDIA (cualquier sistema) → Apple Silicon (ioreg) → AMD en Linux (sysfs) → contador genérico de Windows (AMD/Intel)
async function readGpu() {
  const nv = await readNvidia();
  if (nv) return nv;
  if (IS_MAC) return readAppleGpu();
  if (IS_LINUX) return readLinuxGpu();
  if (IS_WIN && genericGpuLoad != null) {
    const name = state.static && state.static.gpus.length ? state.static.gpus[state.static.gpus.length - 1] : 'GPU';
    return { name, load: genericGpuLoad, temp: null, clock: null, vramUsed: null, power: null, encoder: null, partial: true };
  }
  return null;
}

// Apple Silicon / Mac: ioreg expone "Device Utilization %" sin permisos de administrador
async function readAppleGpu() {
  const out = await run('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], 3000);
  if (!out) return null;
  const util = out.match(/"Device Utilization %"\s*=\s*(\d+)/);
  const mem = out.match(/"In use system memory"\s*=\s*(\d+)/);
  const model = out.match(/"model"\s*=\s*"([^"]+)"/);
  if (!util) return null;
  return {
    name: model ? model[1] : (state.static && state.static.gpus[0]) || 'GPU Apple', load: +util[1], temp: null, clock: null,
    vramUsed: mem ? Math.round(+mem[1] / 1048576) : null, vramTotal: null, power: null, encoder: null, partial: true, unified: true
  };
}

// Linux con AMD: /sys/class/drm/cardX/device/gpu_busy_percent
async function readLinuxGpu() {
  for (let i = 0; i < 4; i++) {
    const base = `/sys/class/drm/card${i}/device/`;
    try {
      const load = parseInt(fs.readFileSync(base + 'gpu_busy_percent', 'utf8'), 10);
      const rd = (f) => { try { return parseInt(fs.readFileSync(base + f, 'utf8'), 10); } catch { return null; } };
      const used = rd('mem_info_vram_used'), total = rd('mem_info_vram_total');
      let temp = null;
      try { const hw = fs.readdirSync(base + 'hwmon')[0]; temp = rd(`hwmon/${hw}/temp1_input`) / 1000; } catch {}
      return { name: (state.static && state.static.gpus[0]) || 'GPU AMD', load, temp, clock: null,
        vramUsed: used ? Math.round(used / 1048576) : null, vramTotal: total ? Math.round(total / 1048576) : null, power: null, encoder: null, partial: true };
    } catch {}
  }
  return null;
}

let hasNvidia = true;
async function readNvidia() {
  if (!hasNvidia) return null;
  const out = await run('nvidia-smi', ['--query-gpu=name,utilization.gpu,temperature.gpu,clocks.gr,clocks.max.gr,memory.used,memory.total,power.draw,power.limit,fan.speed,utilization.encoder',
    '--format=csv,noheader,nounits']);
  if (!out) { hasNvidia = false; return null; }
  const p = out.trim().split('\n')[0].split(',').map((s) => s.trim());
  return {
    name: p[0], load: num(p[1]) ?? 0, temp: num(p[2]), clock: num(p[3]), clockMax: num(p[4]),
    vramUsed: num(p[5]), vramTotal: num(p[6]), power: num(p[7]), powerLimit: num(p[8]),
    fan: num(p[9]), encoder: num(p[10])
  };
}

// Temperaturas/ventiladores de LibreHardwareMonitor si está abierto (opcional, más preciso)
let lhmAvailable = null, lhmCheckedAt = 0;
async function readLHM() {
  if (!IS_WIN) return null;
  const now = Date.now();
  if (lhmAvailable === false && now - lhmCheckedAt < 60000) return null;
  lhmCheckedAt = now;
  const ps = "Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction Stop | Where-Object { $_.SensorType -in 'Temperature','Fan' } | Select-Object Name,SensorType,Value,Parent | ConvertTo-Json -Compress";
  const out = await run('powershell.exe', ['-NoProfile', '-Command', ps], 6000);
  if (!out || !out.trim()) { lhmAvailable = false; return null; }
  try {
    let arr = JSON.parse(out); if (!Array.isArray(arr)) arr = [arr];
    lhmAvailable = true;
    const temps = arr.filter((s) => s.SensorType === 'Temperature');
    const pkg = temps.find((s) => /cpu package|core \(tctl|core max/i.test(s.Name)) || temps.find((s) => /\/cpu/i.test(s.Parent));
    const fans = arr.filter((s) => s.SensorType === 'Fan').map((s) => ({ name: s.Name, rpm: Math.round(s.Value) }));
    return { cpuTemp: pkg ? pkg.Value : null, fans };
  } catch { lhmAvailable = false; return null; }
}

// Frecuencia real de la CPU: Windows reporta solo la base; el contador "% Processor Performance"
// indica cuánto turbo/ahorro aplica. Se lee con un PowerShell persistente para no pagar el arranque cada vez.
// Si no hay NVIDIA, el mismo PowerShell lee el contador genérico "GPU Engine" (sirve para AMD e Intel).
let perfPct = null, perfProc = null, genericGpuLoad = null;
async function startPerfReader() {
  if (!IS_WIN) return;
  const { spawn } = require('child_process');
  const gpuPart = (await readNvidia()) ? '' :
    "try { $g = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Where-Object { $_.Name -like '*engtype_3D' } | Group-Object { ($_.Name -split '_phys')[0] -replace '^pid_\\d+_','' } | ForEach-Object { ($_.Group | Measure-Object UtilizationPercentage -Sum).Sum } | Measure-Object -Maximum; [Console]::Out.WriteLine(\"GPU $([int]$g.Maximum)\") } catch {};";
  const ps = "while($true){ try { $p=(Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter \"Name='_Total'\").PercentProcessorPerformance; [Console]::Out.WriteLine(\"PERF $p\") } catch {}; " + gpuPart + " Start-Sleep -Seconds 2 }";
  perfProc = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
  perfProc.stdout.on('data', (b) => {
    const s = String(b);
    const m = s.match(/PERF (\d+)/g);
    if (m) perfPct = parseInt(m[m.length - 1].slice(5), 10);
    const g = s.match(/GPU (\d+)/g);
    if (g) genericGpuLoad = Math.min(100, parseInt(g[g.length - 1].slice(4), 10));
  });
  perfProc.on('exit', () => { perfProc = null; });
}

async function readStatic() {
  const [cpu, osInfo, graphics, memLayout, system] = await Promise.all([
    si.cpu(), si.osInfo(), si.graphics(), si.memLayout(), si.system()
  ]);
  const gpus = graphics.controllers.map((g) => g.model).filter(Boolean);
  state.static = {
    cpu: `${cpu.manufacturer} ${cpu.brand}`.replace(/\(R\)|\(TM\)|®|™|Gen Intel/g, '').replace(/\s+/g, ' ').trim(),
    cores: cpu.physicalCores, threads: cpu.cores, baseSpeed: cpu.speed, maxSpeed: cpu.speedMax,
    os: `${osInfo.distro} ${osInfo.build ? '(' + osInfo.build + ')' : ''}`.trim(),
    host: osInfo.hostname,
    model: `${system.manufacturer} ${system.model}`.trim(),
    gpus,
    memType: memLayout[0] && memLayout[0].type ? `${memLayout[0].type} ${memLayout[0].clockSpeed ? memLayout[0].clockSpeed + 'MHz' : ''}`.trim() : '',
    platform: process.platform, arch: process.arch, version: app.getVersion()
  };
}

// ---------- Bucles de lectura ----------
function loop(fn, ms) {
  const tick = async () => { try { await fn(); } catch (e) { if (process.env.PULSO_DEBUG) console.error(fn.name, e); } setTimeout(tick, ms); };
  tick();
}

async function fast() {
  const [load, mem, nets, gpu] = await Promise.all([si.currentLoad(), si.mem(), si.networkStats('*'), readGpu()]);
  state.cpu.load = load.currentLoad;
  state.cpu.cores = load.cpus.map((c) => Math.round(c.load));
  const used = mem.total - mem.available;
  state.mem = { total: mem.total, used, pct: (used / mem.total) * 100, swapUsed: mem.swapused, swapTotal: mem.swaptotal };
  let rx = 0, tx = 0, iface = null, best = -1;
  for (const n of nets) {
    rx += n.rx_sec > 0 ? n.rx_sec : 0; tx += n.tx_sec > 0 ? n.tx_sec : 0;
    const t = (n.rx_sec || 0) + (n.tx_sec || 0); if (t > best) { best = t; iface = n.iface; }
  }
  state.net = { rx, tx, iface };
  state.gpu = gpu;
  state.ts = Date.now();
  record();
  checkAlerts();
  broadcast();
}

async function medium() {
  const [speed, temp, battery, lhm] = await Promise.all([
    si.cpuCurrentSpeed(), si.cpuTemperature(), si.battery(), readLHM()
  ]);
  const base = state.static ? state.static.baseSpeed : speed.avg;
  state.cpu.speed = perfPct != null && base ? Math.round(base * 10 * perfPct) : speed.avg ? Math.round(speed.avg * 1000) : null;
  state.cpu.speedMax = speed.max ? Math.round(speed.max * 1000) : null;
  if (lhm && lhm.cpuTemp) { state.cpu.temp = lhm.cpuTemp; state.cpu.tempSource = 'LibreHardwareMonitor'; }
  else if (temp.main && temp.main > 0) { state.cpu.temp = temp.main; state.cpu.tempSource = IS_WIN ? 'ACPI' : 'sensores del sistema'; }
  else { state.cpu.temp = null; state.cpu.tempSource = null; }
  state.fans = lhm ? lhm.fans : [];
  state.battery = battery.hasBattery ? {
    pct: battery.percent, charging: battery.isCharging, plugged: battery.acConnected,
    minutes: battery.timeRemaining > 0 ? battery.timeRemaining : null,
    health: battery.maxCapacity && battery.designedCapacity ? Math.round((battery.maxCapacity / battery.designedCapacity) * 100) : null
  } : null;
}

async function processes() {
  const p = await si.processes();
  const threads = state.static ? state.static.threads : 1;
  // Agrupa por nombre (Chrome tiene decenas de procesos con el mismo nombre)
  const byName = new Map();
  for (const pr of p.list) {
    if (!pr.name || pr.pid === 0 || /^(system idle process|idle)$/i.test(pr.name)) continue;
    const key = pr.name.toLowerCase();
    const e = byName.get(key) || { name: pr.name, count: 0, cpu: 0, mem: 0, path: pr.path || '' };
    e.count++; e.cpu += pr.cpu || 0; e.mem += (pr.memRss || 0) * 1024;
    if (!e.path && pr.path) e.path = pr.path;
    byName.set(key, e);
  }
  state.procs = [...byName.values()].map((e) => ({ ...e, cpu: Math.min(100, e.cpu) }));

  // Grupos vigilados (Claude, render, navegador...)
  // Cada proceso cuenta solo en el primer grupo que coincide (así Remotion no se suma a "Navegador")
  const groups = config.groups.map((g) => ({ id: g.id, name: g.name, color: g.color, cpu: 0, mem: 0, count: 0, apps: [], m: g.match.map((x) => x.toLowerCase()) }));
  for (const pr of p.list) {
    const hay = `${pr.name} ${pr.path || ''} ${pr.command || ''} ${pr.params || ''}`.toLowerCase();
    const g = groups.find((gr) => gr.m.some((m) => hay.includes(m)));
    if (!g) continue;
    g.cpu += pr.cpu || 0; g.mem += (pr.memRss || 0) * 1024; g.count++;
    if (!g.apps.includes(pr.name)) g.apps.push(pr.name);
  }
  state.groups = groups.map(({ m, ...g }) => ({ ...g, cpu: Math.min(100, g.cpu) }));
  void threads;
}

async function slow() {
  const sizes = await si.fsSize();
  state.disks = sizes.filter((d) => d.size > 0).map((d) => ({ mount: d.mount, size: d.size, used: d.used, pct: d.use, type: d.type }));
}

function broadcast() {
  const payload = { ...state, recording: rec ? { start: rec.start, samples: rec.samples.length, label: rec.label } : null };
  if (win && !win.isDestroyed()) win.webContents.send('stats', payload);
  if (mini && !mini.isDestroyed()) mini.webContents.send('stats', payload);
}

// ---------- Alertas ----------
const lastAlert = {};
function alert(key, title, body) {
  if (!config.alerts || !Notification.isSupported()) return;
  const now = Date.now();
  if (lastAlert[key] && now - lastAlert[key] < 120000) return;
  lastAlert[key] = now;
  new Notification({ title, body, silent: false }).show();
}
function checkAlerts() {
  const t = config.thresholds;
  if (state.cpu.temp && state.cpu.temp >= t.cpuTemp) alert('cpu', 'CPU caliente', `La CPU está a ${Math.round(state.cpu.temp)}°C`);
  if (state.gpu && state.gpu.temp >= t.gpuTemp) alert('gpu', 'GPU caliente', `La GPU está a ${state.gpu.temp}°C`);
  if (state.mem && state.mem.pct >= t.ram) alert('ram', 'RAM casi llena', `Usando ${Math.round(state.mem.pct)}% de la memoria`);
}

// ---------- Sesiones de grabación ----------
let rec = null;
function record() {
  if (!rec) return;
  const claude = state.groups.find((g) => g.id === 'claude');
  rec.samples.push({
    t: state.ts,
    cpu: +state.cpu.load.toFixed(1),
    cpuTemp: state.cpu.temp ? Math.round(state.cpu.temp) : null,
    gpu: state.gpu ? state.gpu.load : null,
    gpuTemp: state.gpu ? state.gpu.temp : null,
    gpuPower: state.gpu ? state.gpu.power : null,
    vram: state.gpu ? state.gpu.vramUsed : null,
    ram: +state.mem.pct.toFixed(1),
    ramGB: +(state.mem.used / 1073741824).toFixed(2),
    claudeCpu: claude ? +claude.cpu.toFixed(1) : null,
    claudeMB: claude ? Math.round(claude.mem / 1048576) : null,
    groups: Object.fromEntries(state.groups.map((g) => [g.id, { cpu: +g.cpu.toFixed(1), mb: Math.round(g.mem / 1048576) }]))
  });
}
function summarize(samples) {
  const keys = ['cpu', 'cpuTemp', 'gpu', 'gpuTemp', 'gpuPower', 'vram', 'ram', 'ramGB', 'claudeCpu', 'claudeMB'];
  const out = {};
  for (const k of keys) {
    const v = samples.map((s) => s[k]).filter((x) => x != null);
    out[k] = v.length ? { avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), max: Math.max(...v) } : null;
  }
  const groups = {};
  for (const g of config.groups) {
    const c = samples.map((s) => s.groups[g.id]).filter(Boolean);
    if (!c.length) continue;
    groups[g.id] = {
      name: g.name, color: g.color,
      cpuAvg: +(c.reduce((a, b) => a + b.cpu, 0) / c.length).toFixed(1), cpuMax: Math.max(...c.map((x) => x.cpu)),
      mbAvg: Math.round(c.reduce((a, b) => a + b.mb, 0) / c.length), mbMax: Math.max(...c.map((x) => x.mb))
    };
  }
  out.groups = groups;
  return out;
}
function listSessions() {
  try {
    return fs.readdirSync(SESSIONS_DIR()).filter((f) => f.endsWith('.json'))
      .map((f) => { try { const s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR(), f), 'utf8')); delete s.samples; s.file = f; return s; } catch { return null; } })
      .filter(Boolean).sort((a, b) => b.start - a.start);
  } catch { return []; }
}

// ---------- Ventanas ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 980, minHeight: 640,
    backgroundColor: '#0b0d12', show: false,
    // Mac: semáforos nativos sobre la barra propia; Windows/Linux: botones propios
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 14 } } : { frame: false }),
    icon: path.join(__dirname, 'src', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (process.env.PULSO_DEBUG) win.webContents.on('console-message', (_e, lvl, msg, line, src) => console.error('[ui]', msg, src, line));
  // Depuración: PULSO_SHOT=ruta.png guarda una captura a los 9 s
  if (process.env.PULSO_SHOT) setTimeout(async () => {
    const shot = async (suffix) => fs.writeFileSync(process.env.PULSO_SHOT.replace('.png', suffix + '.png'), (await win.webContents.capturePage()).toPNG());
    await shot('');
    await win.webContents.executeJavaScript("document.querySelector('main').scrollTop=9999");
    await new Promise((r) => setTimeout(r, 600)); await shot('-b');
    await win.webContents.executeJavaScript("go('apps')");
    await new Promise((r) => setTimeout(r, 2500)); await shot('-apps');
  }, +process.env.PULSO_SHOT_DELAY || 15000);
  win.on('closed', () => { win = null; if (mini) mini.close(); });
}
function toggleMini() {
  if (mini && !mini.isDestroyed()) { mini.close(); mini = null; return false; }
  const { workArea } = screen.getPrimaryDisplay();
  mini = new BrowserWindow({
    width: 260, height: 300, x: workArea.x + workArea.width - 280, y: workArea.y + 20,
    frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, transparent: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  mini.setAlwaysOnTop(true, 'screen-saver');
  mini.loadFile(path.join(__dirname, 'src', 'mini.html'));
  mini.on('closed', () => { mini = null; if (win) win.webContents.send('mini', false); });
  return true;
}

// ---------- IPC ----------
ipcMain.handle('static', () => state.static);
ipcMain.handle('config:get', () => config);
ipcMain.handle('config:set', (_e, c) => { config = { ...config, ...c }; saveConfig(config); return config; });
ipcMain.handle('config:reset', () => { config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); saveConfig(config); return config; });
ipcMain.handle('win', (_e, action) => {
  const w = BrowserWindow.getFocusedWindow() || win;
  if (!w) return;
  if (action === 'min') w.minimize();
  if (action === 'max') w.isMaximized() ? w.unmaximize() : w.maximize();
  if (action === 'close') w.close();
});
ipcMain.handle('mini:toggle', () => toggleMini());
ipcMain.handle('rec:start', (_e, label) => { rec = { start: Date.now(), label: label || 'Sesión sin nombre', samples: [] }; return true; });
ipcMain.handle('rec:stop', () => {
  if (!rec) return null;
  const s = { ...rec, end: Date.now(), summary: summarize(rec.samples) };
  rec = null;
  fs.mkdirSync(SESSIONS_DIR(), { recursive: true });
  const base = `sesion-${new Date(s.start).toISOString().replace(/[:.]/g, '-')}`;
  fs.writeFileSync(path.join(SESSIONS_DIR(), base + '.json'), JSON.stringify(s));
  const cols = ['t', 'cpu', 'cpuTemp', 'gpu', 'gpuTemp', 'gpuPower', 'vram', 'ram', 'ramGB', 'claudeCpu', 'claudeMB'];
  const csv = [cols.join(',')].concat(s.samples.map((x) => cols.map((c) => (c === 't' ? new Date(x.t).toISOString() : x[c] ?? '')).join(','))).join('\n');
  fs.writeFileSync(path.join(SESSIONS_DIR(), base + '.csv'), csv);
  const out = { ...s }; delete out.samples; out.file = base + '.json';
  return out;
});
ipcMain.handle('sessions:list', () => listSessions());
ipcMain.handle('sessions:get', (_e, file) => {
  try { return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR(), path.basename(file)), 'utf8')); } catch { return null; }
});
ipcMain.handle('sessions:delete', (_e, file) => {
  const b = path.basename(file, '.json');
  for (const ext of ['.json', '.csv']) { try { fs.unlinkSync(path.join(SESSIONS_DIR(), b + ext)); } catch {} }
  return listSessions();
});
ipcMain.handle('sessions:folder', () => { fs.mkdirSync(SESSIONS_DIR(), { recursive: true }); shell.openPath(SESSIONS_DIR()); });
ipcMain.handle('open:url', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

require('./storage').init(() => win);

// ---------- Arranque ----------
app.whenReady().then(async () => {
  app.setAppUserModelId('Pulso Monitor');
  config = loadConfig();
  createWindow();
  await readStatic().catch(() => {});
  if (win) win.webContents.send('static', state.static);
  startPerfReader();
  loop(fast, 1000);
  loop(medium, 3000);
  loop(processes, 2500);
  loop(slow, 20000);
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { if (perfProc) perfProc.kill(); });
