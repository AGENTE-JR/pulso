// Pestaña Rendimiento: puntuación del equipo, medidores CPU/GPU/RAM, test real y FPS estimados.
(() => {
  const $p = (s, r = document) => r.querySelector(s);
  const KEY = 'pulso-bench-v1';
  // Calibración: valores del test en el equipo de referencia (i7-13650HX + RTX 3050 6GB Laptop, enchufado)
  const CAL = { gpuPps: 152, gpuScore: 5600, cpuSingle: 36, cpuIdx: 1.03 };
  let ST = null, live = null, res = 1080, q = 'alto', running = false;
  let bench = null;
  try { bench = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}

  // ---------- Arranque y entrada escalonada ----------
  const boot = $p('#boot'), t0 = performance.now();
  const hideBoot = () => setTimeout(() => boot && boot.classList.add('off'), Math.max(0, 900 - (performance.now() - t0)));
  setTimeout(hideBoot, 2500);
  document.querySelectorAll('.page').forEach((pg) => pg.querySelectorAll('.card, .page-h').forEach((c, i) => c.style.setProperty('--i', Math.min(i, 14))));

  // ---------- Utilidades de animación ----------
  function countTo(el, to, { dec = 0, ms = 1200, suf = '' } = {}) {
    const from = +el.dataset.v || 0; el.dataset.v = to;
    const st = performance.now();
    cancelAnimationFrame(el._raf);
    const step = (t) => {
      const k = Math.min(1, (t - st) / ms), e = 1 - Math.pow(1 - k, 4), v = from + (to - from) * e;
      el.textContent = (dec ? v.toFixed(dec) : Math.round(v).toLocaleString('es-ES')) + suf;
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  // Anillo de puntuación global
  const R = 96, C = 2 * Math.PI * R;
  $p('#pfScore').innerHTML = `<svg viewBox="0 0 230 230">
      <g class="spin"><circle cx="115" cy="115" r="111" fill="none" stroke="#2a2a2a" stroke-width="1" stroke-dasharray="2 6"/></g>
      <g>${Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * Math.PI * 2, r1 = i % 5 ? 103 : 100; return `<line x1="${115 + Math.cos(a) * r1}" y1="${115 + Math.sin(a) * r1}" x2="${115 + Math.cos(a) * 106}" y2="${115 + Math.sin(a) * 106}" stroke="${i % 5 ? '#222' : '#444'}" stroke-width="1.5"/>`; }).join('')}</g>
      <circle cx="115" cy="115" r="${R}" fill="none" stroke="#161616" stroke-width="8"/>
      <circle class="ring" cx="115" cy="115" r="${R}" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" transform="rotate(-90 115 115)"/>
    </svg><div class="in"><b id="pfTotal">0</b><span>Puntuación Pulso</span></div>`;

  // Medidor semicircular por componente
  const ARC = Math.PI * 90;
  function meterSVG() {
    const ticks = Array.from({ length: 21 }, (_, i) => { const a = Math.PI + (i / 20) * Math.PI, r1 = i % 5 ? 78 : 72; return `<line x1="${110 + Math.cos(a) * r1}" y1="${110 + Math.sin(a) * r1}" x2="${110 + Math.cos(a) * 82}" y2="${110 + Math.sin(a) * 82}" stroke="${i % 5 ? '#2a2a2a' : '#555'}" stroke-width="1.5"/>`; }).join('');
    return `<svg viewBox="0 0 220 120">${ticks}
      <path d="M20 110 A90 90 0 0 1 200 110" fill="none" stroke="#1a1a1a" stroke-width="10" stroke-linecap="round"/>
      <path class="fil" d="M20 110 A90 90 0 0 1 200 110" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-dasharray="${ARC}" stroke-dashoffset="${ARC}"/>
      <g class="ndl" style="transform:rotate(-90deg)"><path d="M110 46 L113 110 L107 110 Z" fill="#fff"/><circle cx="110" cy="110" r="6" fill="#000" stroke="#fff" stroke-width="2"/></g>
    </svg><div class="mv"><b>0</b><span>de 100</span></div>`;
  }
  const PARTS = { cpu: 'Procesador', gpu: 'Gráfica', ram: 'Memoria RAM' };
  document.querySelectorAll('.pf-part').forEach((el) => {
    const k = el.dataset.part;
    el.innerHTML = `<div class="ph"><h2>${PARTS[k]}</h2><em>${k.toUpperCase()}</em></div>
      <div><div class="nm" data-f="nm">—</div><div class="sp" data-f="sp"></div></div>
      <div class="meter">${meterSVG()}</div>
      <div class="pf-live" data-f="live"></div>
      <div class="verdict" data-f="vd"></div>`;
  });
  function setMeter(el, v) {
    $p('.fil', el).style.strokeDashoffset = ARC * (1 - v / 100);
    $p('.ndl', el).style.transform = `rotate(${-90 + v * 1.8}deg)`;
    countTo($p('.mv b', el), v);
  }

  // ---------- Especificaciones efectivas ----------
  function specs() {
    if (!ST) return null;
    const g = PerfDB.bestGpu(ST.gpus) || { name: ST.gpus[0] || 'GPU', score: 0 };
    const c = PerfDB.cpu(ST.cpu, ST.threads, ST.maxSpeed);
    let gpu = g.score, cpu = c.idx, src = [];
    if (bench && bench.gpuScore) {
      gpu = g.score ? g.score * 0.5 + Math.max(g.score * 0.5, Math.min(g.score * 1.5, bench.gpuScore)) * 0.5 : bench.gpuScore;
      src.push('ajustado con test real');
    }
    if (bench && bench.cpuIdx) cpu = c.idx * 0.5 + bench.cpuIdx * 0.5;
    if (!g.score && !(bench && bench.gpuScore)) { gpu = 1500; src.push('GPU desconocida: pasa el test'); }
    const vramLive = live && live.gpu && live.gpu.vramTotal ? live.gpu.vramTotal / 1024 : 0;
    const ramGB = live && live.mem ? Math.round(live.mem.total / 1073741824) : 16;
    return { gpu, cpu, threads: ST.threads, vram: vramLive || g.vram || 4, ramGB, ramType: ST.memType, nvenc: /nvidia|rtx|gtx/i.test(g.name || ''), gpuName: g.name, cpuGuess: c.guessed, src };
  }

  // ---------- Pintado ----------
  const clean = (s) => String(s || '').replace(/\(R\)|\(TM\)|NVIDIA GeForce |13th Gen |12th Gen |14th Gen |Intel |Core\s*/g, '').replace(/\s+/g, ' ').trim();
  function paint() {
    const s = specs(); if (!s) return;
    const sc = PerfDB.scores(s), [tn, td] = PerfDB.tier(sc.total);
    countTo($p('#pfTotal'), sc.total, { ms: 1600 });
    $p('#pfScore .ring').style.strokeDashoffset = C * (1 - sc.total / 10000);
    $p('#pfTier').textContent = tn;
    const cyber = PerfDB.estimate(PerfDB.GAMES[0], s, 1080, 'alto').fps, cs2 = PerfDB.estimate(PerfDB.GAMES.find((g) => g.ab === 'CS2'), s, 1080, 'alto').fps;
    $p('#pfTitle').textContent = `Equipo de gama ${tn.toLowerCase()}`;
    const cuello = sc.gpu < sc.cpu - 25 ? ' La gráfica es la que más limita: el procesador podría con más.' : sc.cpu < sc.gpu - 15 ? ' El procesador limita a la gráfica en juegos competitivos.' : ' CPU y GPU están bien equilibrados.';
    $p('#pfDesc').textContent = `${td} Cyberpunk 2077 a 1080p alto: ~${Math.round(cyber)} FPS · CS2: ~${Math.round(cs2)} FPS.${cuello}`;
    $p('#pfSrc').textContent = `GPU ${Math.round(s.gpu).toLocaleString('es-ES')} pts · CPU ×${s.cpu.toFixed(2)} · ${s.ramGB} GB RAM${s.src.length ? ' · ' + s.src.join(' · ') : ' · estimación por tablas'}`;
    $p('#pfLast').textContent = bench ? `Último test: ${new Date(bench.when).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })} · ${Math.round(bench.gpuFps)} FPS en la escena` : 'Test real de ~20 s (CPU + GPU)';

    const parts = {
      cpu: [clean(ST.cpu), `${ST.cores} núcleos · ${ST.threads} hilos`, sc.cpu,
        sc.cpu >= 75 ? '<b>No frena a tu gráfica</b> en casi ningún juego. Va sobrado para editar y renderizar.' : sc.cpu >= 55 ? '<b>Correcto para jugar</b>; en shooters a muchos FPS puede ser el límite.' : '<b>Limitará</b> los FPS en juegos exigentes y los renders serán lentos.'],
      gpu: [clean(s.gpuName), `${s.vram} GB VRAM${s.nvenc ? ' · NVENC para grabar/streamear' : ''}`, sc.gpu,
        sc.gpu >= 70 ? '<b>1440p/4K alto</b> en la mayoría de juegos.' : sc.gpu >= 45 ? `<b>1080p alto</b> en AAA (~${Math.round(cyber)} FPS en Cyberpunk); activa DLSS/FSR para subir.` : sc.gpu >= 30 ? '<b>1080p medio</b> en AAA; competitivos muy fluidos.' : '<b>Juegos ligeros</b> o AAA en bajo con escalado.'],
      ram: [`${s.ramGB} GB ${s.ramType || ''}`.trim(), s.ramGB >= 32 ? 'Capacidad de estación de trabajo' : s.ramGB >= 16 ? 'Capacidad recomendada para jugar' : 'Capacidad justa', sc.ram,
        s.ramGB >= 24 ? '<b>Suficiente</b> para jugar con Discord/OBS abiertos y editar 4K.' : s.ramGB >= 16 ? '<b>Bien para jugar</b>; para editar 4K conviene 32 GB.' : '<b>Se queda corta</b>: cierra apps al jugar o amplía a 16 GB.'],
    };
    Object.entries(parts).forEach(([k, [nm, sp, v, vd]]) => {
      const el = $p(`.pf-part[data-part="${k}"]`);
      $p('[data-f=nm]', el).textContent = nm; $p('[data-f=nm]', el).title = nm;
      $p('[data-f=sp]', el).textContent = sp; $p('[data-f=vd]', el).innerHTML = vd;
      setMeter(el, v);
    });
    paintLive();
    paintList('#pfGames', PerfDB.GAMES, s, false);
    paintList('#pfApps', PerfDB.APPS, s, true);
  }

  function paintList(sel, items, s, isApp) {
    const MAXF = 240;
    $p(sel).innerHTML = items.map((it, i) => {
      const { fps, limit } = PerfDB.estimate(it, s, res, q, isApp);
      const f = Math.round(fps);
      const lab = isApp ? (it.render ? (f >= 20 ? 'Rápido' : f >= 10 ? 'Normal' : 'Lento') : f >= (it.limit || 60) * 0.95 ? 'Fluido' : f >= 24 ? 'Usable' : 'Justo')
        : f >= 144 ? 'Competitivo' : f >= 90 ? 'Muy fluido' : f >= 60 ? 'Fluido' : f >= 30 ? 'Jugable' : 'No recomendado';
      const cls = isApp ? ({ Justo: 'bad', Lento: 'bad', Usable: 'med', Normal: 'med' })[lab] || '' : f < 30 ? 'bad' : f < 60 ? 'med' : '';
      const lim = it.obs && limit === 'tope' ? 'sin pérdidas (NVENC)' : { GPU: 'limita la GPU', CPU: 'limita la CPU', VRAM: 'falta VRAM', RAM: 'falta RAM', tope: 'tope del juego' }[limit];
      const w = Math.min(100, (Math.log(f + 1) / Math.log(MAXF + 1)) * 100);
      const marks = isApp ? '' : [30, 60, 144].map((m) => `<u style="left:${(Math.log(m + 1) / Math.log(MAXF + 1)) * 100}%" title="${m} FPS"></u>`).join('');
      return `<div class="game ${cls}" style="--i:${i}">
        <div class="ic">${it.ab}</div>
        <div class="gn"><b title="${it.n}">${it.n}</b><small>${it.g}</small></div>
        <div class="fps"><b>${f}</b><small>${isApp ? it.u : 'FPS medios'}</small></div>
        <div class="gb">${marks}<i data-w="${w}"></i></div>
        <div class="gm"><span class="lab">${lab}</span><span>${isApp ? '' : `${res === 2160 ? '4K' : res + 'p'} ${q} · `}${lim}</span></div>
      </div>`;
    }).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll(sel + ' .gb i').forEach((b) => (b.style.width = b.dataset.w + '%'))));
  }

  function paintLive() {
    if (!live) return;
    const row = (l, pct, txt) => `<div class="lr"><span>${l}</span><i class="bar"><em style="width:${Math.max(0, Math.min(100, pct || 0))}%"></em></i><b>${txt}</b></div>`;
    const d = live, cpuEl = $p('.pf-part[data-part=cpu] [data-f=live]'), gpuEl = $p('.pf-part[data-part=gpu] [data-f=live]'), ramEl = $p('.pf-part[data-part=ram] [data-f=live]');
    cpuEl.innerHTML = row('Carga', d.cpu.load, Math.round(d.cpu.load) + '%') + row('Temperatura', d.cpu.temp, d.cpu.temp != null ? Math.round(d.cpu.temp) + '°C' : '—') + row('Reloj', (d.cpu.speed / 5200) * 100, d.cpu.speed ? (d.cpu.speed / 1000).toFixed(2) + ' GHz' : '—');
    const g = d.gpu;
    gpuEl.innerHTML = g ? row('Carga', g.load, Math.round(g.load || 0) + '%') + row('Temperatura', g.temp, g.temp != null ? g.temp + '°C' : '—') + row('VRAM', g.vramTotal ? (g.vramUsed / g.vramTotal) * 100 : 0, g.vramUsed != null ? (g.vramUsed / 1024).toFixed(1) + ' GB' : '—') : row('Carga', 0, '—');
    const m = d.mem;
    ramEl.innerHTML = m ? row('En uso', m.pct, Math.round(m.pct) + '%') + row('Ocupada', m.pct, (m.used / 1073741824).toFixed(1) + ' GB') + row('Libre', 100 - m.pct, ((m.total - m.used) / 1073741824).toFixed(1) + ' GB') : '';
    if (running) {
      $p('#pfTCpu').textContent = Math.round(d.cpu.load) + '%';
      $p('#pfTGpu').textContent = g ? Math.round(g.load || 0) + '%' : '—';
      $p('#pfTTemp').textContent = g && g.temp != null ? g.temp + '°C' : '—';
    }
  }

  // ---------- Selectores ----------
  const seg = (id, set) => document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b)); set(b.dataset.v);
    const s = specs(); if (s) paintList('#pfGames', PerfDB.GAMES, s, false);
  }));
  seg('pfRes', (v) => (res = +v)); seg('pfQ', (v) => (q = v));

  // ---------- Test real ----------
  const FS = `precision highp float; uniform vec2 R; uniform float T;
    float map(vec3 p){ vec3 q=p; float d=1e9; for(int i=0;i<6;i++){ q=abs(q)-vec3(.7,.9,.6); q.xy*=mat2(cos(.5+T*.1),-sin(.5+T*.1),sin(.5+T*.1),cos(.5+T*.1)); q.yz*=mat2(cos(.3),-sin(.3),sin(.3),cos(.3)); d=min(d,length(q)-.18);} return max(d,length(p)-3.2); }
    vec3 nor(vec3 p){ vec2 e=vec2(.002,0); return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx))); }
    float sh(vec3 ro,vec3 rd){ float r=1.,t=.05; for(int i=0;i<40;i++){ float h=map(ro+rd*t); r=min(r,10.*h/t); t+=clamp(h,.02,.3); if(h<.001||t>8.)break;} return clamp(r,0.,1.); }
    vec3 px(vec2 fc){ vec2 uv=(fc*2.-R)/R.y; float a=T*.25; vec3 ro=vec3(5.5*sin(a),1.6,5.5*cos(a)), ta=vec3(0), f=normalize(ta-ro), r=normalize(cross(vec3(0,1,0),f)), u=cross(f,r), rd=normalize(uv.x*r+uv.y*u+1.6*f);
      float t=0.; float hit=0.; for(int i=0;i<140;i++){ float h=map(ro+rd*t); if(h<.0008){hit=1.;break;} t+=h; if(t>14.)break; }
      vec3 col=vec3(.02)+.03*(1.-length(uv)*.5);
      if(hit>0.){ vec3 p=ro+rd*t, n=nor(p), l=normalize(vec3(.6,.8,.4)); float dif=max(dot(n,l),0.)*sh(p+n*.01,l); float sp=pow(max(dot(reflect(rd,n),l),0.),32.); float ao=clamp(map(p+n*.2)*4.,0.,1.);
        col=vec3(.9)*dif+vec3(1.)*sp*.8+vec3(.08)*ao; col*=1.-t*.04; }
      return col; }
    void main(){ vec3 c=px(gl_FragCoord.xy+vec2(-.25,-.25))+px(gl_FragCoord.xy+vec2(.25,-.25))+px(gl_FragCoord.xy+vec2(-.25,.25))+px(gl_FragCoord.xy+vec2(.25,.25)); gl_FragColor=vec4(pow(c*.25,vec3(.85)),1.); }`;

  function gpuTest(ms, onTick) {
    return new Promise((resolve, reject) => {
      const cv = $p('#pfCanvas'), gl = cv.getContext('webgl', { antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl) return reject(new Error('WebGL no disponible'));
      const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}'));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const uR = gl.getUniformLocation(pr, 'R'), uT = gl.getUniformLocation(pr, 'T'), px = new Uint8Array(4);
      gl.viewport(0, 0, cv.width, cv.height); gl.uniform2f(uR, cv.width, cv.height);
      const dbg = gl.getExtension('WEBGL_debug_renderer_info'), renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
      let passes = 0, busy = 0, P = 1, frames = 0; const start = performance.now(), warm = 1500;
      const frame = () => {
        const now = performance.now(), el = now - start;
        const a = performance.now();
        for (let i = 0; i < P; i++) { gl.uniform1f(uT, (el + i * 16) / 1000); gl.drawArrays(gl.TRIANGLES, 0, 3); }
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const dt = performance.now() - a;
        if (el > warm) { passes += P; busy += dt; }
        if (dt < 10 && P < 12) P++; else if (dt > 30 && P > 1) P--;
        if (++frames % 6 === 0) onTick(Math.min(1, el / ms), busy ? (passes / busy) * 1000 : (P / dt) * 1000);
        if (el < ms) requestAnimationFrame(frame);
        else resolve({ pps: (passes / busy) * 1000, renderer });
      };
      requestAnimationFrame(frame);
    });
  }
  function cpuTest(workers, ms) {
    return Promise.all(Array.from({ length: workers }, () => new Promise((ok) => {
      const w = new Worker('bench-worker.js');
      w.onmessage = (e) => { ok(e.data.rate); w.terminate(); };
      w.postMessage({ ms });
    }))).then((r) => r.reduce((a, b) => a + b, 0));
  }

  async function runTest() {
    if (running) return;
    running = true;
    const btn = $p('#pfRun'); btn.disabled = true; btn.textContent = 'Midiendo…';
    $p('#pfTest').classList.add('on');
    $p('#pfTest').scrollIntoView({ behavior: 'smooth', block: 'center' });
    const phase = (t, p) => { $p('#pfPhase').textContent = t; $p('#pfProg').style.width = p * 100 + '%'; };
    try {
      phase('01 · CPU un núcleo', 0.02); $p('#pfFpsLab').textContent = 'Puntos CPU (1 hilo)';
      const single = await cpuTest(1, 3000); countTo($p('#pfFps'), single * 10, { ms: 500 });
      phase('02 · CPU todos los hilos', 0.18); $p('#pfFpsLab').textContent = 'Puntos CPU (todos los hilos)';
      const multi = await cpuTest(navigator.hardwareConcurrency || 8, 3000); countTo($p('#pfFps'), multi * 10, { ms: 500 });
      phase('03 · GPU escena 3D (raymarching 1080p · 4× AA)', 0.35); $p('#pfFpsLab').textContent = 'FPS en la escena de prueba';
      const g = await gpuTest(13000, (k, fps) => { $p('#pfFps').textContent = Math.round(fps); $p('#pfProg').style.width = (0.35 + k * 0.65) * 100 + '%'; });
      const gpuScore = CAL.gpuPps ? (g.pps / CAL.gpuPps) * CAL.gpuScore : null;
      const cpuIdx = CAL.cpuSingle ? (single / CAL.cpuSingle) * CAL.cpuIdx : null;
      bench = { when: Date.now(), gpuFps: g.pps, gpuScore, cpuSingle: single, cpuMulti: multi, cpuIdx, renderer: g.renderer };
      try { localStorage.setItem(KEY, JSON.stringify(bench)); } catch {}
      window.__pulsoBench = bench;
      phase(`✓ Listo · ${g.renderer.replace(/ANGLE \(|\)$|Direct3D11.*$/g, '').replace(/,\s*$/, '') || 'GPU'}`, 1);
      if (/intel|uhd|iris/i.test(g.renderer) && /nvidia|rtx|gtx|radeon rx/i.test((ST && ST.gpus.join(' ')) || '')) toast('El test usó la gráfica integrada: enchufa el portátil y fija Pulso a "Alto rendimiento" en Configuración > Gráficos.');
      else toast('Test completado');
      paint();
    } catch (e) { phase('Error: ' + e.message, 0); toast('No se pudo completar el test'); }
    running = false; btn.disabled = false; btn.textContent = '↻ Repetir test';
  }
  $p('#pfRun').addEventListener('click', runTest);
  window.__pulsoRunTest = runTest;

  // ---------- Datos ----------
  let painted = false;
  const onPage = () => $p('#page-perf').classList.contains('active');
  document.querySelector('[data-page="perf"]').addEventListener('click', () => setTimeout(paint, 30));
  api.onStats((d) => {
    live = d; hideBoot();
    if (ST && (!painted || (d.mem && !painted.mem))) { painted = { mem: !!d.mem }; paint(); }
    if (onPage()) paintLive();
  });
  api.getStatic().then((s) => { if (s) { ST = s; if (live) { painted = { mem: !!live.mem }; paint(); } } });
  api.onStatic((s) => { if (s) ST = s; });
})();
