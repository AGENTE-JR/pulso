// Gráficos ligeros sin dependencias: medidor circular y líneas con área.
const Charts = (() => {
  const levelColor = (v, warn = 60, hot = 85) => (v >= hot ? '#ff4d4d' : v >= warn ? '#f5c451' : null);

  function gauge(el, { label = 'Carga', size = 170 } = {}) {
    const r = 70, c = 2 * Math.PI * r, arc = c * 0.75;
    const id = 'g' + Math.random().toString(36).slice(2, 7);
    el.innerHTML = `
      <svg viewBox="0 0 170 170">
        <defs><linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#9e9e9e"/></linearGradient></defs>
        <circle cx="85" cy="85" r="${r}" stroke="#1c1c1c" stroke-width="10" fill="none"
          stroke-dasharray="${arc} ${c}" transform="rotate(135 85 85)"/>
        <circle class="fg" cx="85" cy="85" r="${r}" stroke="url(#${id})" stroke-width="10" fill="none"
          stroke-dasharray="0 ${c}" transform="rotate(135 85 85)" style="transition:stroke-dasharray .6s ease, stroke .6s"/>
      </svg>
      <div class="val"><b>0<sup>%</sup></b><span>${label}</span></div>`;
    const fg = el.querySelector('.fg'), b = el.querySelector('b');
    return (v) => {
      v = Math.max(0, Math.min(100, v || 0));
      fg.setAttribute('stroke-dasharray', `${(arc * v) / 100} ${c}`);
      const lc = levelColor(v);
      fg.setAttribute('stroke', lc || `url(#${id})`);
      b.innerHTML = `${Math.round(v)}<sup>%</sup>`;
    };
  }

  function fit(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  const hexA = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };

  // series: [{ data:[...], color, fill:true }]; max fijo o automático
  function lines(canvas, series, { max = 100, points = 120, grid = false, yLabel = null, xLabels = null } = {}) {
    if (!canvas.clientWidth) return;
    const { ctx, w, h } = fit(canvas);
    const padL = grid ? 34 : 0, padB = xLabels ? 18 : 0, pad = 3;
    const W = w - padL, H = h - padB - pad;
    let top = max;
    if (max === 'auto') top = Math.max(1, ...series.flatMap((s) => s.data.filter((x) => x != null))) * 1.15;
    if (grid) {
      ctx.font = '10px Segoe UI'; ctx.fillStyle = '#5a5a5a'; ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = pad + (H * i) / 4;
        ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke();
        const v = top * (1 - i / 4);
        ctx.fillText(yLabel ? yLabel(v) : (top < 10 ? v.toFixed(1) : Math.round(v)) + '%', 0, y + 4);
      }
    }
    if (xLabels) {
      ctx.fillStyle = '#5a5a5a'; ctx.font = '10px Segoe UI';
      xLabels.forEach(([pos, txt]) => ctx.fillText(txt, padL + pos * (W - 30), h - 4));
    }
    for (const s of series) {
      const d = s.data, n = Math.max(points, d.length);
      if (d.length < 2) continue;
      const x = (i) => padL + ((i + (n - d.length)) / (n - 1)) * W;
      const y = (v) => pad + H - (Math.min(v ?? 0, top) / top) * H;
      ctx.beginPath();
      d.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 1.8; ctx.lineJoin = 'round'; ctx.stroke();
      if (s.fill !== false) {
        ctx.lineTo(x(d.length - 1), pad + H); ctx.lineTo(x(0), pad + H); ctx.closePath();
        const g = ctx.createLinearGradient(0, pad, 0, pad + H);
        g.addColorStop(0, hexA(s.color, 0.28)); g.addColorStop(1, hexA(s.color, 0));
        ctx.fillStyle = g; ctx.fill();
      }
    }
  }

  return { gauge, lines, levelColor };
})();
