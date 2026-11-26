// Interfaz principal de Pulso
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const api = window.pulso;
const OS = api.platform || 'win32';
document.body.classList.add('os-' + OS);

// ---------- Formato ----------
const GB = 1073741824;
const fmtBytes = (b) => (b >= GB ? (b / GB).toFixed(1) + ' GB' : (b / 1048576).toFixed(0) + ' MB');
const fmtRate = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB/s' : b >= 1024 ? (b / 1024).toFixed(0) + ' KB/s' : Math.round(b) + ' B/s');
const fmtDur = (ms) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const tempColor = (t, warn, hot) => (t == null ? '' : t >= hot ? 'var(--hot)' : t >= warn ? 'var(--warn)' : 'var(--ok)');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }

// ---------- Historial ----------
const N = 120;
const hist = { cpu: [], gpu: [], ram: [], rx: [], tx: [], groups: {} };
const push = (arr, v) => { arr.push(v); if (arr.length > N) arr.shift(); };

// ---------- Navegación ----------
let page = 'dash';
function go(p) {
  page = p;
  $$('.nav').forEach((n) => n.classList.toggle('active', n.dataset.page === p));
  $$('.page').forEach((s) => s.classList.toggle('active', s.id === 'page-' + p));
  if (p === 'sessions') renderSessions();
  if (p === 'settings') renderSettings();
  if (last) render(last);
}
$$('.nav').forEach((n) => n.addEventListener('click', () => go(n.dataset.page)));
$$('[data-goto]').forEach((n) => n.addEventListener('click', () => go(n.dataset.goto)));
$$('[data-win]').forEach((b) => b.addEventListener('click', () => api.win(b.dataset.win)));

// ---------- Medidores ----------
const gCpu = Charts.gauge($('#gCpu'), { label: 'Carga' });
const gGpu = Charts.gauge($('#gGpu'), { label: 'Carga' });
const gRam = Charts.gauge($('#gRam'), { label: 'En uso' });

let stat = null, cfg = null, last = null, peakClock = 0;

function setBar(id, pct, color) { const e = $(id); if (!e) return; e.style.width = Math.max(0, Math.min(100, pct)) + '%'; e.style.background = color || ''; }

function renderStatic(s) {
  if (!s) return;
  stat = s;
  $('#device').textContent = s.model || s.host || '';
  $('#cpuName').textContent = s.cpu;
  $('#cpuCores').textContent = `${s.cores} / ${s.threads}`;
  $('#ramType').textContent = s.memType || '';
  const rows = [['Equipo', s.model], ['Sistema', s.os], ['Nombre', s.host], ['Procesador', s.cpu], ['Núcleos / hilos', `${s.cores} / ${s.threads}`],
    ['Frecuencia base / turbo', `${s.baseSpeed} / ${s.maxSpeed} GHz`], ['Gráficos', s.gpus.join(' · ')], ['Memoria', s.memType]];
  $('#specList').innerHTML = rows.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v || '—')}</b></div>`).join('');
}

// ---------- Render principal ----------
function render(d) {
  const th = cfg ? cfg.thresholds : { cpuTemp: 90, gpuTemp: 85, ram: 90 };

  // CPU
  gCpu(d.cpu.load);
  if (d.cpu.temp != null) {
    $('#cpuTemp').textContent = Math.round(d.cpu.temp) + '°C';
    setBar('#cpuTempBar', d.cpu.temp, tempColor(d.cpu.temp, th.cpuTemp - 15, th.cpuTemp));
  } else { $('#cpuTemp').innerHTML = '<span title="El sistema no expone este sensor. Mira Mi equipo → Sensores." style="color:var(--dim);cursor:help">no disponible ⓘ</span>'; }
  if (d.cpu.speed) {
    $('#cpuClock').textContent = d.cpu.speed + ' MHz';
    peakClock = Math.max(peakClock, d.cpu.speed, stat && stat.maxSpeed > stat.baseSpeed ? stat.maxSpeed * 1000 : 0);
    setBar('#cpuClockBar', (d.cpu.speed / peakClock) * 100);
  }

  // GPU
  if (d.gpu) {
    gGpu(d.gpu.load);
    $('#gpuName').textContent = d.gpu.name.replace(/NVIDIA GeForce |\(R\)|\(TM\)/g, '');
    $('#gpuTemp').textContent = d.gpu.temp != null ? d.gpu.temp + '°C' : '—';
    setBar('#gpuTempBar', d.gpu.temp, tempColor(d.gpu.temp, th.gpuTemp - 15, th.gpuTemp));
    $('#gpuClock').textContent = d.gpu.clock != null ? d.gpu.clock + ' MHz' : '—';
    setBar('#gpuClockBar', d.gpu.clockMax ? (d.gpu.clock / d.gpu.clockMax) * 100 : 0);
    $('#gpuVram').textContent = d.gpu.vramUsed == null ? '—' : d.gpu.vramTotal ? `${(d.gpu.vramUsed / 1024).toFixed(1)} / ${(d.gpu.vramTotal / 1024).toFixed(0)} GB`
      : `${(d.gpu.vramUsed / 1024).toFixed(1)} GB${d.gpu.unified ? ' (compartida)' : ''}`;
    setBar('#gpuVramBar', d.gpu.vramTotal ? (d.gpu.vramUsed / d.gpu.vramTotal) * 100 : 0);
    $('#gpuPower').textContent = d.gpu.power != null ? d.gpu.power.toFixed(0) + ' W' : '—';
    $('#gpuEnc').textContent = d.gpu.encoder != null ? d.gpu.encoder + '%' : '—';
  } else if (stat) { $('#gpuName').textContent = (stat.gpus[0] || 'GPU') + ' · sin datos de carga'; }

  // RAM
  if (d.mem) {
    gRam(d.mem.pct);
    $('#ramUsed').textContent = `${(d.mem.used / GB).toFixed(1)} / ${(d.mem.total / GB).toFixed(0)} GB`;
  }
  const topMem = [...d.procs].sort((a, b) => b.mem - a.mem)[0];
  $('#ramTop').textContent = topMem ? `${topMem.name.replace(/\.exe$/i, '')} · ${fmtBytes(topMem.mem)}` : '—';

  // Red
  $('#netDown').textContent = fmtRate(d.net.rx);
  $('#netUp').textContent = fmtRate(d.net.tx);
  $('#netIface').textContent = d.net.iface || '';

  // Discos
  $('#disks').innerHTML = d.disks.map((k) => `<div class="disk"><div class="row"><b>${esc(k.mount)}</b><span>${fmtBytes(k.used)} de ${fmtBytes(k.size)}</span></div>
    <i class="bar"><em style="width:${k.pct}%;background:${k.pct > 90 ? 'var(--hot)' : k.pct > 75 ? 'var(--warn)' : ''}"></em></i></div>`).join('') || '<span class="sub">Leyendo…</span>';

  // Batería
  if (d.battery) {
    const b = d.battery;
    $('#batPct').textContent = Math.round(b.pct) + '%';
    $('#batFill').style.width = b.pct + '%';
    $('#batFill').style.background = b.pct < 20 ? 'var(--hot)' : b.pct < 40 ? 'var(--warn)' : 'var(--ok)';
    $('#batState').textContent = b.charging ? '⚡ Cargando' : b.plugged ? 'Conectada' : 'Con batería';
    $('#batTime').textContent = b.plugged ? 'Enchufada' : b.minutes ? fmtDur(b.minutes * 60000).replace(/:\d\d$/, ' h') : 'Calculando…';
    $('#batHealth').textContent = b.health ? b.health + '%' : '—';
  } else { $('#batPct').textContent = '—'; $('#batState').textContent = 'Sin batería'; }

  // Núcleos
  const cores = $('#cores');
  if (cores.children.length !== d.cpu.cores.length) {
    cores.innerHTML = d.cpu.cores.map(() => '<div class="core"><i></i></div>').join('');
    cores.style.gridTemplateColumns = `repeat(${d.cpu.cores.length > 24 ? Math.ceil(d.cpu.cores.length / 2) : d.cpu.cores.length}, 1fr)`;
  }
  d.cpu.cores.forEach((v, i) => { const c = cores.children[i]; c.firstChild.style.height = v + '%'; c.classList.toggle('hot', v > 85); c.title = `Hilo ${i + 1}: ${v}%`; });

  // Grupos (resumen)
  $('#groupsMini').innerHTML = d.groups.map((g) => `<div class="grp ${g.count ? '' : 'idle'}"><i class="sw" style="background:${g.color}"></i>
    <div class="nm"><b>${esc(g.name)}</b><small>${g.count ? g.count + ' procesos' : 'No está abierto'}</small></div>
    <div class="v"><b>${g.cpu.toFixed(1)}%</b><small>CPU</small></div><div class="v"><b>${fmtBytes(g.mem)}</b><small>RAM</small></div>
    <canvas data-g="${g.id}"></canvas></div>`).join('');
  $$('#groupsMini canvas').forEach((c) => Charts.lines(c, [{ data: hist.groups[c.dataset.g] || [], color: d.groups.find((g) => g.id === c.dataset.g).color }], { max: 'auto', points: 60 }));

  // Procesos principales
  const top = [...d.procs].sort((a, b) => b.cpu - a.cpu).slice(0, 7);
  $('#topProcs').innerHTML = top.map((p) => `<tr><td title="${esc(p.path)}">${esc(p.name)}${p.count > 1 ? ` <span class="sub">×${p.count}</span>` : ''}</td><td>${p.cpu.toFixed(1)}%</td><td>${fmtBytes(p.mem)}</td></tr>`).join('');

  // Sparklines
  if (page === 'dash') {
    Charts.lines($('#sCpu'), [{ data: hist.cpu, color: '#ffffff' }]);
    Charts.lines($('#sGpu'), [{ data: hist.gpu, color: '#9e9e9e' }]);
    Charts.lines($('#sRam'), [{ data: hist.ram, color: '#d0d0d0' }]);
    Charts.lines($('#sNet'), [{ data: hist.rx, color: '#ffffff' }, { data: hist.tx, color: '#9e9e9e' }], { max: 'auto' });
  }
  if (page === 'apps') renderApps(d);
  if (page === 'procs') renderProcs(d);
  if (page === 'specs') renderSensors(d);

  // Estado general
  const hot = (d.cpu.temp && d.cpu.temp >= th.cpuTemp) || (d.gpu && d.gpu.temp >= th.gpuTemp) || (d.mem && d.mem.pct >= th.ram);
  const warn = d.cpu.load > 85 || (d.gpu && d.gpu.load > 90) || (d.mem && d.mem.pct > 80);
  $('#health').className = 'health ' + (hot ? 'hot' : warn ? 'warn' : '');
  $('#healthText').textContent = hot ? 'Temperatura o RAM al límite' : warn ? 'Carga alta' : 'Todo en orden';

  // Grabación
  const r = d.recording;
  $('#recBtn').classList.toggle('on', !!r);
  $('#recText').textContent = r ? 'Grabando ' + fmtDur(Date.now() - r.start) : 'Grabar sesión';
  $('#recBtn2').textContent = r ? '■ Detener y guardar' : '● Empezar a grabar';
  $('#recBtn2').classList.toggle('stop', !!r);
  $('#recTime').textContent = r ? fmtDur(Date.now() - r.start) : '';
  $('#recLabel').disabled = !!r;
}

// ---------- Claude y apps ----------
function renderApps(d) {
  $('#appsLegend').innerHTML = d.groups.map((g) => `<span><i style="background:${g.color}"></i>${esc(g.name)}</span>`).join('');
  Charts.lines($('#cApps'), d.groups.map((g) => ({ data: hist.groups[g.id] || [], color: g.color, fill: g.id === 'claude' })),
    { max: 'auto', grid: true, xLabels: [[0, 'hace 2 min'], [0.5, 'hace 1 min'], [1, 'ahora']] });
  $('#groupCards').innerHTML = d.groups.map((g) => `<article class="card span6 gcard"><i class="accent" style="background:${g.color}"></i>
    <div class="card-h"><h2>${esc(g.name)}</h2><span class="sub">${g.count ? g.count + ' procesos activos' : 'No está abierto'}</span></div>
    <div class="big"><div><b>${g.cpu.toFixed(1)}%</b><span>CPU</span></div><div><b>${fmtBytes(g.mem)}</b><span>RAM</span></div>
    <div><b>${d.mem ? ((g.mem / d.mem.total) * 100).toFixed(1) : 0}%</b><span>de tu RAM</span></div></div>
    <div class="apps">${g.apps.slice(0, 12).map((a) => `<span>${esc(a)}</span>`).join('') || '<span>—</span>'}</div></article>`).join('');
}

// ---------- Procesos ----------
let sortKey = 'cpu', sortDir = -1;
$$('#procTable th[data-sort]').forEach((th) => th.addEventListener('click', () => {
  const k = th.dataset.sort; sortDir = sortKey === k ? -sortDir : (k === 'name' ? 1 : -1); sortKey = k;
  $$('#procTable th[data-sort]').forEach((t) => { t.classList.toggle('sorted', t === th); t.textContent = t.textContent.replace(/ [▾▴]$/, ''); });
  th.textContent += sortDir < 0 ? ' ▾' : ' ▴';
  if (last) renderProcs(last);
}));
$('#procSearch').addEventListener('input', () => last && renderProcs(last));
function renderProcs(d) {
  const q = $('#procSearch').value.trim().toLowerCase();
  const total = d.mem ? d.mem.total : 1;
  const list = d.procs.filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => (sortKey === 'name' ? a.name.localeCompare(b.name) : a[sortKey] - b[sortKey]) * sortDir).slice(0, 80);
  $('#procBody').innerHTML = list.map((p) => {
    const impact = Math.min(100, p.cpu * 1.5 + (p.mem / total) * 100);
    return `<tr><td title="${esc(p.path)}">${esc(p.name)}</td><td>${p.count}</td><td>${p.cpu.toFixed(1)}%</td><td>${fmtBytes(p.mem)}</td>
      <td class="impact"><i class="bar"><em style="width:${impact}%;background:${impact > 60 ? 'var(--hot)' : impact > 30 ? 'var(--warn)' : ''}"></em></i></td></tr>`;
  }).join('');
}

// ---------- Sensores ----------
function renderSensors(d) {
  const noTemp = { win32: 'Bloqueada por Windows. Abre LibreHardwareMonitor (gratis) como administrador.',
    darwin: 'macOS no la expone sin permisos especiales en este equipo.', linux: 'Instala lm-sensors (sudo apt install lm-sensors && sudo sensors-detect).' }[OS];
  const rows = [
    ['Sistema', `${OS === 'win32' ? 'Windows' : OS === 'darwin' ? 'macOS' : 'Linux'} · ${stat ? stat.arch : ''} · Pulso ${stat ? stat.version : ''}`],
    ['Temperatura CPU', d.cpu.temp != null ? `${Math.round(d.cpu.temp)}°C · fuente: ${d.cpu.tempSource}` : noTemp],
    ['GPU', d.gpu ? `OK · ${d.gpu.name}${d.gpu.partial ? ' (datos básicos: carga' + (d.gpu.vramUsed != null ? ' y memoria' : '') + ')' : ' (datos completos vía nvidia-smi)'}` : 'Sin datos de carga para esta GPU'],
    ['Ventiladores', d.fans.length ? d.fans.map((f) => `${f.name}: ${f.rpm} RPM`).join(' · ') : OS === 'win32' ? 'Requiere LibreHardwareMonitor abierto' : 'No disponible'],
    ['Batería', d.battery ? `OK · salud ${d.battery.health ?? '—'}%` : 'No detectada'],
    ['Procesos vigilados', `${d.procs.length} programas distintos`]
  ];
  $('#sensorList').innerHTML = rows.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('') +
    (d.cpu.temp == null && OS === 'win32' ? '<p class="hint" style="margin-top:12px">Consejo: descarga LibreHardwareMonitor (gratis, código abierto) y ábrelo como administrador; basta con que esté abierto (puede ir minimizado). Pulso leerá la temperatura real de la CPU y los ventiladores.</p>' : '');
}

// ---------- Sesiones ----------
async function toggleRec() {
  if (last && last.recording) {
    const s = await api.recStop();
    toast(s ? `Sesión guardada · ${fmtDur(s.end - s.start)}` : 'Nada que guardar');
    if (page === 'sessions') renderSessions(s && s.file);
  } else {
    await api.recStart($('#recLabel').value.trim());
    toast('Grabando… haz tu video y detén al terminar');
  }
}
$('#recBtn').addEventListener('click', toggleRec);
$('#recBtn2').addEventListener('click', toggleRec);
$('#openFolder').addEventListener('click', () => api.openSessions());

const metric = (label, m, unit, cls = '') => `<div class="metric ${cls}"><span>${label}</span><b>${m ? m.avg + unit : '—'}</b> <small>${m ? 'pico ' + m.max + unit : ''}</small></div>`;
async function renderSessions(openFile) {
  const list = await api.sessions();
  $('#sessionList').innerHTML = list.length ? list.map((s) => `<article class="card sess" data-f="${esc(s.file)}">
    <h3>${esc(s.label)}</h3><div class="when">${new Date(s.start).toLocaleString('es')} · ${fmtDur(s.end - s.start)}</div>
    <div class="metrics">${metric('CPU', s.summary.cpu, '%')}${metric('GPU', s.summary.gpu, '%')}${metric('RAM', s.summary.ramGB, ' GB')}
    ${metric('Temp CPU', s.summary.cpuTemp, '°')}${metric('Temp GPU', s.summary.gpuTemp, '°')}${metric('Claude', s.summary.claudeMB, ' MB', 'claude')}</div></article>`).join('')
    : '<div class="empty">Aún no hay sesiones. Pulsa <b>Grabar sesión</b> antes de empezar tu próximo video.</div>';
  $$('.sess').forEach((c) => c.addEventListener('click', () => openSession(c.dataset.f)));
  if (openFile) openSession(openFile);
}
async function openSession(file) {
  const s = await api.session(file);
  if (!s) return;
  const sm = s.summary;
  const groups = Object.values(sm.groups || {}).map((g) => `<div class="metric"><span style="color:${g.color}">${esc(g.name)}</span><b>${g.cpuAvg}%</b> <small>CPU · ${g.mbAvg} MB (pico ${g.mbMax})</small></div>`).join('');
  $('#sessionDetail').innerHTML = `<article class="card detail"><div class="card-h"><h2>${esc(s.label)}</h2>
    <div><button class="btn ghost" id="closeDetail">Cerrar</button> <button class="btn danger" id="delSession">Eliminar</button></div></div>
    <span class="sub">${new Date(s.start).toLocaleString('es')} · duración ${fmtDur(s.end - s.start)} · ${s.samples.length} muestras</span>
    <div class="metrics">${metric('CPU', sm.cpu, '%')}${metric('GPU', sm.gpu, '%')}${metric('RAM', sm.ram, '%')}${metric('Temp CPU', sm.cpuTemp, '°C')}
    ${metric('Temp GPU', sm.gpuTemp, '°C')}${metric('Potencia GPU', sm.gpuPower, ' W')}${metric('VRAM', sm.vram, ' MB')}${metric('Claude CPU', sm.claudeCpu, '%', 'claude')}${metric('Claude RAM', sm.claudeMB, ' MB', 'claude')}</div>
    <div class="legend"><span><i style="background:#ffffff"></i>CPU</span><span><i style="background:#9e9e9e"></i>GPU</span><span><i style="background:#d0d0d0"></i>RAM</span><span><i style="background:#d97757"></i>Claude CPU</span></div>
    <canvas class="chart" id="cSession"></canvas>${groups ? `<div class="metrics">${groups}</div>` : ''}</article>`;
  const pick = (k) => s.samples.map((x) => x[k]);
  Charts.lines($('#cSession'), [
    { data: pick('cpu'), color: '#ffffff', fill: false }, { data: pick('gpu'), color: '#9e9e9e', fill: false },
    { data: pick('ram'), color: '#d0d0d0', fill: false }, { data: pick('claudeCpu'), color: '#d97757' }
  ], { points: s.samples.length, grid: true, xLabels: [[0, 'inicio'], [1, 'fin']] });
  $('#closeDetail').onclick = () => { $('#sessionDetail').innerHTML = ''; };
  $('#delSession').onclick = async () => { if (!confirm('¿Eliminar esta sesión?')) return; await api.deleteSession(file); $('#sessionDetail').innerHTML = ''; renderSessions(); };
  $('#sessionDetail').scrollIntoView({ behavior: 'smooth' });
}

// ---------- Ajustes ----------
function groupRow(g) {
  return `<div class="gedit" data-id="${esc(g.id)}"><input type="color" value="${g.color}"><input class="gname" value="${esc(g.name)}" placeholder="Nombre">
    <input class="gmatch" value="${esc(g.match.join(', '))}" placeholder="textos separados por coma"><button title="Quitar">×</button></div>`;
}
function renderSettings() {
  if (!cfg) return;
  $('#alertsOn').checked = cfg.alerts;
  $('#autostartOn').checked = !!cfg.autostart; $('#trayOn').checked = cfg.tray !== false;
  $('#thCpu').value = cfg.thresholds.cpuTemp; $('#thGpu').value = cfg.thresholds.gpuTemp; $('#thRam').value = cfg.thresholds.ram;
  $('#groupEditor').innerHTML = cfg.groups.map(groupRow).join('');
  $$('.gedit button').forEach((b) => (b.onclick = () => b.parentElement.remove()));
}
$('#addGroup').addEventListener('click', () => {
  $('#groupEditor').insertAdjacentHTML('beforeend', groupRow({ id: 'g' + Date.now(), name: 'Nuevo grupo', color: '#bdbdbd', match: [] }));
  const b = $('#groupEditor').lastElementChild.querySelector('button'); b.onclick = () => b.parentElement.remove();
});
$('#saveCfg').addEventListener('click', async () => {
  const groups = $$('.gedit').map((r) => ({
    id: r.dataset.id, color: r.querySelector('[type=color]').value, name: r.querySelector('.gname').value.trim() || 'Grupo',
    match: r.querySelector('.gmatch').value.split(',').map((s) => s.trim()).filter(Boolean)
  })).filter((g) => g.match.length);
  cfg = await api.setConfig({ alerts: $('#alertsOn').checked, autostart: $('#autostartOn').checked, tray: $('#trayOn').checked, groups,
    thresholds: { cpuTemp: +$('#thCpu').value || 90, gpuTemp: +$('#thGpu').value || 85, ram: +$('#thRam').value || 90 } });
  toast('Ajustes guardados');
});
$('#resetCfg').addEventListener('click', async () => { cfg = await api.resetConfig(); renderSettings(); toast('Valores restaurados'); });

// ---------- Mini widget ----------
$('#miniBtn').addEventListener('click', async () => { const on = await api.toggleMini(); $('#miniBtn').classList.toggle('active', on); });
api.onMini && api.onMini((on) => $('#miniBtn').classList.toggle('active', on));

// ---------- Arranque ----------
api.onStatic(renderStatic);
api.onStats((d) => {
  last = d;
  push(hist.cpu, d.cpu.load); push(hist.gpu, d.gpu ? d.gpu.load : 0); push(hist.ram, d.mem ? d.mem.pct : 0);
  push(hist.rx, d.net.rx); push(hist.tx, d.net.tx);
  for (const g of d.groups) push(hist.groups[g.id] || (hist.groups[g.id] = []), g.cpu);
  render(d);
});
(async () => { renderStatic(await api.getStatic()); cfg = await api.getConfig(); })();
window.addEventListener('resize', () => last && render(last));
