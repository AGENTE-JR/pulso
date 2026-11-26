// Tablas de referencia para estimar rendimiento. Valores aproximados (3DMark Time Spy Graphics para GPU,
// índice de rendimiento por núcleo para CPU) tomados de resultados públicos típicos. 100 % local.
const PerfDB = (() => {
  // [regex sobre el nombre normalizado, puntuación, vram GB]
  const GPUS = [
    // NVIDIA escritorio
    [/rtx 5090/, 48000, 32], [/rtx 5080/, 32000, 16], [/rtx 5070 ti/, 27000, 16], [/rtx 5070/, 22000, 12], [/rtx 5060 ti/, 15500, 16], [/rtx 5060/, 12500, 8],
    [/rtx 4090/, 36000, 24], [/rtx 4080/, 28000, 16], [/rtx 4070 ti/, 22500, 12], [/rtx 4070 super/, 21000, 12], [/rtx 4070/, 17800, 12],
    [/rtx 4060 ti/, 13500, 8], [/rtx 4060/, 10600, 8], [/rtx 3090 ti/, 21500, 24], [/rtx 3090/, 20000, 24], [/rtx 3080 ti/, 19000, 12], [/rtx 3080/, 17500, 10],
    [/rtx 3070 ti/, 14700, 8], [/rtx 3070/, 13500, 8], [/rtx 3060 ti/, 11700, 8], [/rtx 3060/, 8800, 12], [/rtx 3050/, 6200, 8],
    [/rtx 2080 ti/, 14500, 11], [/rtx 2080 super/, 12000, 8], [/rtx 2080/, 11000, 8], [/rtx 2070 super/, 10500, 8], [/rtx 2070/, 9000, 8], [/rtx 2060 super/, 8800, 8], [/rtx 2060/, 7500, 6],
    [/gtx 1660 ti/, 6300, 6], [/gtx 1660 super/, 6000, 6], [/gtx 1660/, 5500, 6], [/gtx 1650 super/, 4800, 4], [/gtx 1650/, 3600, 4],
    [/gtx 1080 ti/, 9800, 11], [/gtx 1080/, 7500, 8], [/gtx 1070 ti/, 6800, 8], [/gtx 1070/, 6000, 8], [/gtx 1060/, 4100, 6], [/gtx 1050 ti/, 2400, 4], [/gtx 1050/, 1900, 2],
    // AMD escritorio
    [/rx 9070 xt/, 29000, 16], [/rx 9070/, 25000, 16], [/rx 7900 xtx/, 30000, 24], [/rx 7900 xt/, 26500, 20], [/rx 7900 gre/, 21500, 16], [/rx 7800 xt/, 19800, 16],
    [/rx 7700 xt/, 17000, 12], [/rx 7600 xt/, 11500, 16], [/rx 7600/, 11000, 8], [/rx 6950 xt/, 21500, 16], [/rx 6900 xt/, 20500, 16], [/rx 6800 xt/, 19500, 16], [/rx 6800/, 16500, 16],
    [/rx 6750 xt/, 13500, 12], [/rx 6700 xt/, 12500, 12], [/rx 6650 xt/, 10300, 8], [/rx 6600 xt/, 10000, 8], [/rx 6600/, 8500, 8], [/rx 6500 xt/, 4800, 4],
    [/rx 5700 xt/, 8800, 8], [/rx 5700/, 8000, 8], [/rx 5600 xt/, 7500, 6], [/rx 580/, 4200, 8], [/rx 570/, 3800, 4],
    // Intel
    [/arc b580/, 14500, 12], [/arc b570/, 12500, 10], [/arc a770/, 13500, 16], [/arc a750/, 13000, 8], [/arc a580/, 11000, 8], [/arc a380/, 4500, 6], [/arc a3\d0m|arc a5\d0m|arc a7\d0m/, 7000, 8],
    [/arc 1\d0v|arc graphics/, 3800, 0], [/iris xe/, 1400, 0], [/uhd/, 650, 0], [/hd graphics/, 450, 0],
    // AMD integradas
    [/890m/, 4000, 0], [/880m/, 3600, 0], [/780m/, 2800, 0], [/760m/, 2400, 0], [/680m/, 2400, 0], [/660m/, 1800, 0], [/vega/, 1100, 0], [/radeon graphics/, 1300, 0],
    // Apple
    [/m4 max/, 17000, 0], [/m4 pro/, 9000, 0], [/m4/, 4200, 0], [/m3 max/, 13000, 0], [/m3 pro/, 6000, 0], [/m3/, 3300, 0],
    [/m2 max/, 9500, 0], [/m2 pro/, 5500, 0], [/m2/, 2600, 0], [/m1 max/, 8500, 0], [/m1 pro/, 4500, 0], [/m1/, 2000, 0],
  ];
  // Portátiles NVIDIA/AMD (rinden menos que la versión de escritorio con el mismo nombre)
  const GPUS_LAPTOP = [
    [/rtx 5090/, 24000, 24], [/rtx 5080/, 20000, 16], [/rtx 5070 ti/, 15000, 12], [/rtx 5070/, 12500, 8], [/rtx 5060/, 11000, 8],
    [/rtx 4090/, 20000, 16], [/rtx 4080/, 17500, 12], [/rtx 4070/, 12000, 8], [/rtx 4060/, 10500, 8], [/rtx 4050/, 8600, 6],
    [/rtx 3080 ti/, 12500, 16], [/rtx 3080/, 11500, 8], [/rtx 3070 ti/, 10500, 8], [/rtx 3070/, 9800, 8], [/rtx 3060/, 8400, 6],
    [/rtx 3050 ti/, 5000, 4], [/rtx 3050.*6\s?gb|rtx 3050 a/, 5600, 6], [/rtx 3050/, 4800, 4], [/rtx 2080/, 9000, 8], [/rtx 2070/, 7800, 8], [/rtx 2060/, 6000, 6],
    [/gtx 1660 ti/, 5300, 6], [/gtx 1650 ti/, 3600, 4], [/gtx 1650/, 3400, 4], [/mx\s?5\d0/, 2200, 2], [/mx\s?4\d0/, 1900, 2], [/mx\s?\d50/, 1400, 2],
    [/rx 7600s|rx 7600m/, 9000, 8], [/rx 6800m/, 12500, 12], [/rx 6700m/, 10000, 10], [/rx 6600m/, 8500, 8], [/rx 6500m/, 4500, 4],
  ];

  const norm = (s) => String(s || '').toLowerCase().replace(/\(r\)|\(tm\)|nvidia|geforce|amd|radeon(?! graphics)|intel\(r\)|®|™/g, ' ').replace(/\s+/g, ' ').trim();
  function gpu(name) {
    const n = norm(name), laptop = /laptop|mobile|max-q|notebook|\bm\b/.test(n) || /\d{4}m\b/.test(n);
    const t = (laptop ? GPUS_LAPTOP.find(([r]) => r.test(n)) : null) || GPUS.find(([r]) => r.test(n));
    if (!t) return null;
    const vram = +(n.match(/(\d+)\s?gb/) || [])[1] || t[2];
    return { score: t[1], vram, laptop, integrated: t[2] === 0 };
  }
  // Elige la GPU dedicada más potente de la lista
  function bestGpu(names) {
    return (names || []).map((n) => ({ name: n, ...(gpu(n) || { score: 0 }) })).sort((a, b) => b.score - a.score)[0] || null;
  }

  // Índice de CPU para juegos: 1.0 ≈ Core i7 de 13.ª gen / Ryzen 7 7700. Combina generación, gama y sufijo.
  function cpu(name, threads, maxGHz) {
    const n = String(name || '').toLowerCase();
    let idx = null, m;
    if ((m = n.match(/core\(tm\)\s*ultra\s*([579])\s*(\d)(\d\d)/) || n.match(/ultra\s*([579])\s*(\d)(\d\d)/))) {
      idx = ({ 5: 0.9, 7: 0.98, 9: 1.03 })[m[1]] * (m[2] === '2' ? 1.06 : 1.0);
    } else if ((m = n.match(/i([3579])-(\d{4,5})([a-z]*)/))) {
      const num = m[2], gen = num.length === 5 ? +num.slice(0, 2) : +num[0];
      const g = { 2: 0.3, 3: 0.33, 4: 0.38, 5: 0.4, 6: 0.48, 7: 0.52, 8: 0.6, 9: 0.65, 10: 0.7, 11: 0.8, 12: 0.92, 13: 1.0, 14: 1.03 }[gen] || 0.6;
      idx = g * ({ 3: 0.8, 5: 0.92, 7: 1.0, 9: 1.06 })[m[1]] + (/hx|k/.test(m[3]) ? 0.03 : /u|y/.test(m[3]) ? -0.12 : /p/.test(m[3]) ? -0.06 : 0);
    } else if ((m = n.match(/ryzen\s*([3579])\s*(?:pro\s*)?(\d)(\d{3})([a-z0-9]*)/))) {
      const g = { 1: 0.52, 2: 0.58, 3: 0.68, 4: 0.72, 5: 0.86, 6: 0.88, 7: 1.0, 8: 0.98, 9: 1.08 }[m[2]] || 0.7;
      idx = g * ({ 3: 0.82, 5: 0.94, 7: 1.0, 9: 1.04 })[m[1]] + (/x3d/.test(m[4]) ? 0.14 : /u/.test(m[4]) ? -0.12 : 0);
    } else if ((m = n.match(/ryzen\s*ai\s*(?:max\+?\s*)?([579])/))) {
      idx = 1.02;
    } else if ((m = n.match(/apple m(\d)\s*(pro|max|ultra)?/))) {
      idx = ({ 1: 0.86, 2: 0.93, 3: 1.0, 4: 1.1 })[m[1]] || 1;
    }
    if (idx == null) idx = Math.min(1.1, Math.max(0.35, (maxGHz || 3) / 5));
    const tf = threads >= 16 ? 1 : threads >= 12 ? 0.97 : threads >= 8 ? 0.9 : threads >= 6 ? 0.8 : 0.65;
    return { idx: +(idx * tf).toFixed(3), guessed: !m };
  }

  // Juegos: fps a 1080p Alto con una GPU de referencia (RTX 4060 = 10600) y tope de CPU (índice 1.0)
  const REF = 10600;
  const GAMES = [
    { n: 'Cyberpunk 2077', g: 'RPG · mundo abierto', ab: 'CP', f: 75, cap: 150, vram: 6, ram: 16 },
    { n: 'Black Myth: Wukong', g: 'Acción · Unreal 5', ab: 'BM', f: 55, cap: 140, vram: 6, ram: 16 },
    { n: 'Alan Wake 2', g: 'Terror · sin RT', ab: 'AW', f: 45, cap: 130, vram: 7, ram: 16 },
    { n: 'Red Dead Redemption 2', g: 'Mundo abierto', ab: 'RD', f: 72, cap: 150, vram: 6, ram: 12 },
    { n: 'Hogwarts Legacy', g: 'RPG · mundo abierto', ab: 'HL', f: 70, cap: 120, vram: 7, ram: 16 },
    { n: 'Call of Duty: Warzone', g: 'Battle royale', ab: 'WZ', f: 100, cap: 220, vram: 6, ram: 16 },
    { n: 'GTA V', g: 'Mundo abierto', ab: 'GTA', f: 125, cap: 190, vram: 4, ram: 8 },
    { n: 'Fortnite', g: 'Battle royale · DX12', ab: 'FN', f: 115, cap: 260, vram: 6, ram: 8 },
    { n: 'Marvel Rivals', g: 'Hero shooter', ab: 'MR', f: 85, cap: 180, vram: 6, ram: 16 },
    { n: 'Apex Legends', g: 'Battle royale', ab: 'AL', f: 160, cap: 300, vram: 6, ram: 8, limit: 300 },
    { n: 'Counter-Strike 2', g: 'Shooter competitivo', ab: 'CS2', f: 230, cap: 420, vram: 4, ram: 8 },
    { n: 'Valorant', g: 'Shooter competitivo', ab: 'VAL', f: 400, cap: 600, vram: 2, ram: 8 },
    { n: 'League of Legends', g: 'MOBA', ab: 'LoL', f: 350, cap: 450, vram: 2, ram: 8 },
    { n: 'Elden Ring', g: 'RPG · tope 60 FPS', ab: 'ER', f: 85, cap: 140, vram: 6, ram: 12, limit: 60 },
    { n: "Baldur's Gate 3", g: 'RPG por turnos', ab: 'BG3', f: 90, cap: 130, vram: 6, ram: 16 },
    { n: 'Forza Horizon 5', g: 'Conducción', ab: 'FH5', f: 110, cap: 200, vram: 6, ram: 16 },
    { n: 'Starfield', g: 'RPG espacial', ab: 'SF', f: 55, cap: 95, vram: 6, ram: 16 },
    { n: 'Minecraft con shaders', g: 'Sandbox', ab: 'MC', f: 110, cap: 220, vram: 4, ram: 8 },
  ];
  // Programas: misma fórmula, sin selector de resolución/calidad (escenario fijo indicado en "g")
  const APPS = [
    { n: 'DaVinci Resolve', g: 'Reproducir timeline 4K H.265', ab: 'DR', f: 52, cap: 90, vram: 6, ram: 16, limit: 60, u: 'fps timeline' },
    { n: 'Premiere Pro', g: 'Vista previa 4K a resolución 1/2', ab: 'Pr', f: 45, cap: 70, vram: 4, ram: 16, limit: 60, u: 'fps vista previa' },
    { n: 'After Effects', g: 'Vista previa comp. 1080p con efectos', ab: 'Ae', f: 30, cap: 26, vram: 4, ram: 16, limit: 30, u: 'fps vista previa', cpuHeavy: true },
    { n: 'Blender · Eevee', g: 'Viewport escena media 1080p', ab: 'Bl', f: 95, cap: 200, vram: 6, ram: 16, u: 'fps viewport' },
    { n: 'Unreal Engine 5', g: 'Editor · escena Lumen', ab: 'UE', f: 50, cap: 120, vram: 8, ram: 24, u: 'fps editor' },
    { n: 'OBS + juego', g: 'Grabar 1080p60 mientras juegas', ab: 'OBS', f: 60, cap: 60, vram: 4, ram: 16, limit: 60, u: 'fps grabación', obs: true },
    { n: 'Remotion (tu canal)', g: 'Render vídeo 1080p · CPU', ab: 'Rm', f: 0, cap: 30, vram: 0, ram: 8, u: 'fps de render', render: true },
  ];

  const RES = { 1080: 1, 1440: 0.68, 2160: 0.38 };
  const Q = { medio: 1.38, alto: 1, ultra: 0.78 };
  const VRAM_NEED = { 1080: 1, 1440: 1.2, 2160: 1.5 };

  // Devuelve { fps, limit: 'GPU'|'CPU'|'VRAM'|'RAM'|'tope' }
  function estimate(it, s, res = 1080, q = 'alto', isApp = false) {
    const gs = Math.max(200, s.gpu), cs = s.cpu;
    let gpuFps = it.f * Math.pow(gs / REF, 0.85) * (isApp ? 1 : RES[res] * Q[q]);
    let cpuFps = it.cap * cs * (isApp ? 1 : q === 'medio' ? 1.08 : 1);
    if (it.render) { const t = s.threads || 8; return { fps: Math.max(1, it.cap * cs * Math.min(1.6, t / 20 + 0.2)), limit: 'CPU' }; }
    if (it.obs) { const enc = s.nvenc || gs > 4000; return { fps: enc ? 60 : gs > 2000 ? 45 : 30, limit: enc ? 'tope' : 'GPU' }; }
    let fps = Math.min(gpuFps, cpuFps), limit = gpuFps <= cpuFps ? 'GPU' : 'CPU';
    const vneed = it.vram * (isApp ? 1 : VRAM_NEED[res] * (q === 'ultra' ? 1.15 : q === 'medio' ? 0.8 : 1));
    if (s.vram && vneed > s.vram + 0.5) { fps *= Math.max(0.65, Math.pow(s.vram / vneed, 0.7)); limit = 'VRAM'; }
    if (s.ramGB && s.ramGB < it.ram - 1) { fps *= Math.max(0.6, s.ramGB / it.ram); limit = 'RAM'; }
    if (it.limit && fps > it.limit) { fps = it.limit; limit = 'tope'; }
    return { fps: Math.max(1, fps), limit };
  }

  // Puntuación global 0–10 000 y por componente 0–100
  function scores(s) {
    const gpu = Math.min(100, 100 * Math.sqrt(Math.max(0, s.gpu) / 36000));
    const cpu = Math.min(100, s.cpu * 82 * Math.min(1.15, 0.8 + (s.threads || 8) / 80));
    const ram = Math.min(100, (s.ramGB >= 64 ? 96 : s.ramGB >= 32 ? 88 : s.ramGB >= 24 ? 80 : s.ramGB >= 16 ? 66 : s.ramGB >= 12 ? 50 : s.ramGB >= 8 ? 36 : 20) + (/ddr5/i.test(s.ramType || '') ? 4 : 0));
    const total = Math.round((gpu * 0.6 + cpu * 0.25 + ram * 0.15) * 100);
    return { gpu: Math.round(gpu), cpu: Math.round(cpu), ram: Math.round(ram), total };
  }
  const tier = (t) => t >= 8000 ? ['Entusiasta', 'Máximo nivel: 1440p y 4K en ultra.'] : t >= 6500 ? ['Muy alto', 'Juegos AAA en 1440p alto con fluidez.']
    : t >= 4800 ? ['Alto', 'AAA a 1080p alto y shooters competitivos por encima de 120 FPS.'] : t >= 3200 ? ['Medio', 'AAA a 1080p medio y juegos competitivos muy fluidos.']
    : t >= 1800 ? ['Básico', 'Juegos ligeros y competitivos a 1080p bajo/medio.'] : ['Ofimática', 'Ideal para trabajo y juegos muy ligeros.'];

  return { gpu, bestGpu, cpu, estimate, scores, tier, GAMES, APPS, REF };
})();
