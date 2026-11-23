// Almacenamiento: explorar el disco, archivos grandes, duplicados y basura
(() => {
  const st = api.storage;
  const page = $('#page-storage');
  const fmtSize = (b) => { if (b < 1024) return Math.max(0, b) + ' B'; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { b /= 1024; i++; } while (b >= 1024 && i < 3); return (b >= 100 ? b.toFixed(0) : b.toFixed(1)) + ' ' + u[i]; };
  const fmtNum = (n) => n.toLocaleString('es');
  const fmtDate = (ms) => new Date(ms).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
  const dirOf = (p) => p.replace(/[\\/][^\\/]*$/, '');
  const nameOf = (p) => p.split(/[\\/]/).pop();
  const CAT = { video: ['Video', '#f472b6'], imagen: ['Imágenes', '#a78bfa'], audio: ['Audio', '#60a5fa'], documento: ['Documentos', '#34d399'], comprimido: ['Comprimidos', '#fbbf24'], programa: ['Programas', '#f87171'], otros: ['Otros', '#5b6377'] };
  const IC = {
    dir: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
  };
  const dot = (cat) => `<span class="st-dot" style="background:${(CAT[cat] || CAT.otros)[1]}"></span>`;
  const empty = (msg) => `<article class="card st-empty">${IC.dir}<p>${msg || 'Elige una unidad o carpeta de arriba y pulsa <b>Analizar</b>.'}</p></article>`;

  let tab = 'explore', scanned = false, expected = 0, cur = null, big = null, bigFilter = 'all', dupes = null, dupBusy = false, junk = null, junkBusy = false;
  const sel = { big: new Set(), dupes: new Set(), junk: new Set() };

  // ---------- Unidades ----------
  async function loadDrives() {
    const d = await st.drives();
    $('#stDrives').innerHTML = d.drives.map((k) => {
      const pct = (k.used / k.size) * 100, col = pct > 90 ? 'var(--hot)' : pct > 75 ? 'var(--warn)' : '';
      return `<article class="card st-drive"><div class="row"><b>${esc(k.mount)}</b><span>${fmtSize(k.free)} libres de ${fmtSize(k.size)}</span></div>
        <i class="bar"><em style="width:${pct}%;background:${col}"></em></i>
        <button class="btn primary sm" data-scan="${esc(k.root)}" data-used="${k.used}">Analizar ${esc(k.mount)}</button></article>`;
    }).join('') + `<article class="card st-drive"><div class="row"><b>Carpetas rápidas</b></div>
      <div class="st-chips">${d.folders.map((f) => `<button class="chip" data-scan="${esc(f.path)}">${esc(f.name)}</button>`).join('')}</div></article>`;
  }

  function startScan(root, used) {
    expected = +used || 0;
    scanned = false; cur = big = dupes = null;
    Object.values(sel).forEach((s) => s.clear());
    st.scan(root);
    $('#stProgress').hidden = false;
    $('#stCancel').hidden = false;
    renderTab();
  }

  st.onProgress((p) => {
    const bar = $('#stProgBar');
    $('#stProgTitle').textContent = p.done ? (p.cancelled ? 'Análisis cancelado' : `Análisis completo · ${fmtSize(p.total)}`) : 'Analizando ' + p.root;
    $('#stProgText').textContent = `${fmtNum(p.files)} archivos · ${fmtNum(p.dirs)} carpetas · ${fmtSize(p.bytes)} · ${p.secs} s` +
      (p.errors ? ` · ${fmtNum(p.errors)} sin permiso` : '') + (p.done ? '' : ' · ' + p.current);
    bar.classList.toggle('indet', !p.done && !expected);
    bar.style.width = p.done ? '100%' : expected ? Math.min(99, (p.bytes / expected) * 100) + '%' : '';
    $('#stCancel').hidden = !!p.done;
    if (p.done && !p.cancelled) { scanned = true; openDir(p.root); loadDrives(); if (tab !== 'explore' && tab !== 'junk') renderTab(); }
  });

  // ---------- Explorar ----------
  async function openDir(dir) { cur = await st.dir(dir); if (tab === 'explore') renderExplore(); }

  function renderExplore() {
    const el = $('#st-explore');
    if (!cur) { el.innerHTML = empty(); return; }
    const max = (cur.items[0] && cur.items[0].size) || 1, tot = cur.size || 1;
    el.innerHTML = `<article class="card">
      <div class="st-crumbs">${cur.crumbs.map((c) => `<button class="link" data-open="${esc(c.path)}">${esc(c.name)}</button>`).join('<span>›</span>')}</div>
      <div class="st-sum"><b>${fmtSize(cur.size)}</b><span>${fmtNum(cur.files)} archivos en esta carpeta y subcarpetas</span></div>
      <div class="st-list">${cur.items.map((it) => `
        <div class="st-row${it.dir ? ' dir' : ''}"${it.dir ? ` data-open="${esc(it.path)}"` : ''}>
          <span class="st-ic">${it.dir ? IC.dir : dot(it.cat)}</span>
          <div class="st-name"><b title="${esc(it.path)}">${esc(it.name)}</b><small>${it.dir ? fmtNum(it.files) + ' archivos' : (CAT[it.cat] || CAT.otros)[0] + ' · ' + fmtDate(it.mtime)}</small></div>
          <i class="bar"><em style="width:${(it.size / max) * 100}%"></em></i>
          <span class="st-size">${fmtSize(it.size)}</span><span class="st-pct">${((it.size / tot) * 100).toFixed(1)}%</span>
          <div class="st-act"><button title="Mostrar en la carpeta" data-reveal="${esc(it.path)}">${IC.eye}</button>${it.prot
            ? `<span class="st-lock" title="Protegido: archivo o carpeta del sistema">${IC.lock}</span>`
            : `<button class="danger" title="Mover a la papelera" data-trash="${esc(it.path)}">${IC.trash}</button>`}</div>
        </div>`).join('') || '<p class="hint">Carpeta vacía.</p>'}</div>
      ${cur.more ? `<p class="hint">…y ${fmtNum(cur.more)} elementos más pequeños.</p>` : ''}</article>`;
  }

  // ---------- Archivos grandes ----------
  async function renderBig() {
    const el = $('#st-big');
    if (!scanned) { el.innerHTML = empty(); return; }
    if (!big) big = await st.top();
    if (!big) { el.innerHTML = empty(); return; }
    const total = big.total || 1;
    const cats = Object.entries(big.cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const files = big.files.filter((f) => bigFilter === 'all' || f.cat === bigFilter);
    el.innerHTML = `<article class="card">
      <div class="card-h"><h2>Espacio por tipo de archivo</h2><span class="sub">${fmtSize(big.total)} analizados</span></div>
      <div class="st-stack">${cats.map(([c, v]) => `<i title="${CAT[c][0]}: ${fmtSize(v)}" style="width:${(v / total) * 100}%;background:${CAT[c][1]}"></i>`).join('')}</div>
      <div class="st-chips"><button class="chip${bigFilter === 'all' ? ' active' : ''}" data-cat="all">Todos</button>${cats.map(([c, v]) =>
        `<button class="chip${bigFilter === c ? ' active' : ''}" data-cat="${c}">${dot(c)}${CAT[c][0]} <b>${fmtSize(v)}</b></button>`).join('')}</div>
    </article>
    <article class="card">
      <div class="card-h"><h2>Los ${files.length} archivos más pesados</h2><span class="sub">Marca los que no necesites</span></div>
      <table class="tbl st-tbl"><thead><tr><th>Archivo</th><th>Carpeta</th><th>Modificado</th><th>Tamaño</th><th></th></tr></thead><tbody>
      ${files.map((f) => `<tr><td><label class="st-chk">${f.prot ? `<span class="st-lock" title="Protegido">${IC.lock}</span>` : `<input type="checkbox" data-sel="big" value="${esc(f.path)}"${sel.big.has(f.path) ? ' checked' : ''}>`}${dot(f.cat)}<span title="${esc(f.path)}">${esc(nameOf(f.path))}</span></label></td>
        <td class="st-folder" title="${esc(dirOf(f.path))}">${esc(dirOf(f.path))}</td><td>${fmtDate(f.mtime)}</td><td><b>${fmtSize(f.size)}</b></td>
        <td><button class="st-iconbtn" title="Mostrar en la carpeta" data-reveal="${esc(f.path)}">${IC.eye}</button></td></tr>`).join('')}
      </tbody></table></article>
    <div class="st-actionbar" id="bigBar"></div>`;
    updateBar('big');
  }

  // ---------- Duplicados ----------
  function renderDupes() {
    const el = $('#st-dupes');
    if (!scanned) { el.innerHTML = empty(); return; }
    if (!dupes) {
      el.innerHTML = `<article class="card st-intro"><div><h2>Buscar archivos duplicados</h2>
        <p class="hint">Compara archivos de 1 MB o más con el mismo tamaño y verifica su contenido byte a byte (hash). Se ignoran carpetas del sistema, AppData, node_modules y ocultas.</p>
        <small id="stDupProg"></small></div>
        <button class="btn primary" data-act="dupes"${dupBusy ? ' disabled' : ''}>${dupBusy ? 'Buscando…' : 'Buscar duplicados'}</button></article>`;
      return;
    }
    if (dupes.error) { el.innerHTML = empty(esc(dupes.error)); return; }
    const shown = dupes.groups.slice(0, 200);
    el.innerHTML = `<article class="card st-intro"><div><h2>${fmtNum(dupes.groups.length)} grupos de duplicados · ${fmtSize(dupes.wasted)} recuperables</h2>
      <p class="hint">Se marcan automáticamente todas las copias menos la más antigua (la original). Revisa antes de borrar.</p></div>
      <div class="st-btns"><button class="btn ghost" data-act="dupAuto">Marcar copias</button><button class="btn ghost" data-act="dupNone">Desmarcar todo</button><button class="btn ghost" data-act="dupes">Volver a buscar</button></div></article>
      ${shown.map((g, gi) => `<article class="card st-group">
        <div class="card-h"><h2>${dot(catOfName(g.files[0].path))}${esc(nameOf(g.files[0].path))}</h2><span class="sub">${g.files.length} copias · ${fmtSize(g.size)} c/u · <b>${fmtSize(g.size * (g.files.length - 1))}</b> recuperables</span></div>
        ${g.files.map((f, i) => `<div class="st-drow"><label class="st-chk">${f.prot ? `<span class="st-lock" title="Protegido">${IC.lock}</span>` : `<input type="checkbox" data-sel="dupes" data-g="${gi}" value="${esc(f.path)}"${sel.dupes.has(f.path) ? ' checked' : ''}>`}
          <span title="${esc(f.path)}">${esc(f.path)}</span></label>${i === 0 ? '<em class="st-tag">original</em>' : ''}<small>${fmtDate(f.mtime)}</small>
          <button class="st-iconbtn" title="Mostrar en la carpeta" data-reveal="${esc(f.path)}">${IC.eye}</button></div>`).join('')}
      </article>`).join('')}
      ${dupes.groups.length > 200 ? `<p class="hint">Se muestran los 200 grupos que más espacio ocupan.</p>` : ''}
      ${dupes.groups.length ? '' : empty('No se encontraron duplicados. ¡Todo en orden!')}
      <div class="st-actionbar" id="dupesBar"></div>`;
    updateBar('dupes');
  }
  const EXT_CAT = { mp4: 'video', mov: 'video', mkv: 'video', avi: 'video', webm: 'video', jpg: 'imagen', jpeg: 'imagen', png: 'imagen', psd: 'imagen', heic: 'imagen', mp3: 'audio', wav: 'audio', m4a: 'audio', pdf: 'documento', docx: 'documento', zip: 'comprimido', rar: 'comprimido', '7z': 'comprimido', iso: 'comprimido', exe: 'programa', msi: 'programa' };
  const catOfName = (p) => EXT_CAT[(p.split('.').pop() || '').toLowerCase()] || 'otros';

  function autoSelectDupes() {
    sel.dupes.clear();
    (dupes?.groups || []).slice(0, 200).forEach((g) => g.files.slice(1).forEach((f) => { if (!f.prot) sel.dupes.add(f.path); }));
  }
  async function runDupes() {
    dupBusy = true; dupes = null; renderDupes();
    const r = await st.dupes();
    dupBusy = false;
    if (r && r.cancelled) { renderDupes(); return; }
    dupes = r; autoSelectDupes(); if (tab === 'dupes') renderDupes();
  }
  st.onDupProgress((p) => {
    const e = $('#stDupProg'); if (!e) return;
    e.textContent = `${p.phase}: ${fmtNum(p.done)} / ${fmtNum(p.total)}` + (p.bytesTotal ? ` · ${Math.round((p.bytesDone / p.bytesTotal) * 100)}% de ${fmtSize(p.bytesTotal)}` : '');
  });

  // ---------- Basura ----------
  async function runJunk() {
    junkBusy = true; renderJunk();
    junk = await st.junk();
    junkBusy = false;
    sel.junk = new Set(junk.filter((j) => j.def && j.size > 0).map((j) => j.id));
    if (tab === 'junk') renderJunk();
  }
  function renderJunk() {
    const el = $('#st-junk');
    if (!junk) {
      el.innerHTML = `<article class="card st-intro"><div><h2>${junkBusy ? 'Buscando basura…' : 'Archivos basura'}</h2><p class="hint">Temporales, cachés de navegadores y apps, informes de errores, papelera y descargas antiguas.</p></div>
        <button class="btn primary" data-act="junk"${junkBusy ? ' disabled' : ''}>${junkBusy ? 'Analizando…' : 'Analizar basura'}</button></article>`;
      return;
    }
    const total = junk.reduce((a, j) => a + j.size, 0);
    el.innerHTML = `<article class="card st-intro"><div><h2>${fmtSize(total)} de basura encontrada</h2><p class="hint">Las casillas marcadas son seguras de limpiar. Revisa las demás antes.</p></div>
      <button class="btn ghost" data-act="junk"${junkBusy ? ' disabled' : ''}>${junkBusy ? 'Analizando…' : 'Volver a analizar'}</button></article>
      <article class="card">${junk.map((j) => `<label class="st-junk${j.size ? '' : ' none'}">
        <input type="checkbox" data-sel="junk" value="${j.id}"${sel.junk.has(j.id) ? ' checked' : ''}${j.size ? '' : ' disabled'}>
        <div><b>${esc(j.name)}</b><small>${esc(j.desc)}</small></div>
        <span>${j.size ? `<b>${fmtSize(j.size)}</b><small>${fmtNum(j.count)} archivos</small>` : '<small>Vacío o sin permiso</small>'}</span></label>`).join('')}</article>
      <div class="st-actionbar" id="junkBar"></div>`;
    updateBar('junk');
  }

  // ---------- Barra de acción ----------
  function selTotal(k) {
    if (k === 'big') return big.files.filter((f) => sel.big.has(f.path)).reduce((a, f) => a + f.size, 0);
    if (k === 'dupes') { let t = 0; dupes.groups.forEach((g) => g.files.forEach((f) => { if (sel.dupes.has(f.path)) t += g.size; })); return t; }
    return junk.filter((j) => sel.junk.has(j.id)).reduce((a, j) => a + j.size, 0);
  }
  function updateBar(k) {
    const bar = $('#' + k + 'Bar'); if (!bar) return;
    const n = sel[k].size, t = selTotal(k);
    bar.classList.toggle('show', n > 0);
    bar.innerHTML = `<span><b>${n}</b> ${k === 'junk' ? 'categorías' : 'elementos'} · <b>${fmtSize(t)}</b></span>
      <button class="btn primary" data-act="${k === 'junk' ? 'junkClean' : 'trashSel'}" data-k="${k}">${k === 'junk' ? 'Limpiar seleccionado' : 'Mover a la papelera'}</button>`;
  }

  // ---------- Acciones ----------
  async function doTrash(paths) {
    const r = await st.trash(paths);
    if (!r) return;
    if (r.blocked && !r.ok) { toast('Esos elementos están protegidos por el sistema'); return; }
    toast(`${r.ok} movido(s) a la papelera · ${fmtSize(r.freed)} liberados` + (r.failed.length ? ` · ${r.failed.length} no se pudieron mover` : ''));
    paths.forEach((p) => { sel.big.delete(p); sel.dupes.delete(p); });
    big = null;
    if (dupes && dupes.groups) {
      const gone = new Set(paths);
      dupes.groups = dupes.groups.map((g) => ({ ...g, files: g.files.filter((f) => !gone.has(f.path)) })).filter((g) => g.files.length > 1);
      dupes.wasted = dupes.groups.reduce((a, g) => a + g.size * (g.files.length - 1), 0);
    }
    if (cur) await openDir(cur.path);
    loadDrives(); renderTab();
  }

  page.addEventListener('click', async (e) => {
    const t = e.target.closest('button, [data-open]');
    if (!t || t.disabled) return;
    const d = t.dataset;
    if (d.scan) return startScan(d.scan, d.used);
    if (d.reveal) return st.reveal(d.reveal);
    if (d.trash) return doTrash([d.trash]);
    if (d.open) return openDir(d.open);
    if (d.st) { tab = d.st; $$('[data-st]').forEach((b) => b.classList.toggle('active', b === t)); $$('.st-pane').forEach((p) => p.classList.toggle('active', p.id === 'st-' + tab)); return renderTab(); }
    if (d.cat) { bigFilter = d.cat; return renderBig(); }
    if (d.act === 'dupes') return runDupes();
    if (d.act === 'dupAuto') { autoSelectDupes(); return renderDupes(); }
    if (d.act === 'dupNone') { sel.dupes.clear(); return renderDupes(); }
    if (d.act === 'junk') return runJunk();
    if (d.act === 'junkClean') {
      const r = await st.junkClean([...sel.junk]);
      if (!r) return;
      toast(`${fmtSize(r.size)} liberados · ${fmtNum(r.count)} archivos` + (r.skipped ? ` · ${fmtNum(r.skipped)} en uso (saltados)` : ''));
      loadDrives(); return runJunk();
    }
    if (d.act === 'trashSel') {
      const paths = [...sel[d.k]];
      if (d.k === 'dupes') {
        const all = dupes.groups.filter((g) => g.files.every((f) => sel.dupes.has(f.path)));
        if (all.length && !confirm(`En ${all.length} grupo(s) marcaste TODAS las copias: no quedaría ninguna. ¿Continuar?`)) return;
      }
      return doTrash(paths);
    }
  });
  page.addEventListener('change', (e) => {
    const t = e.target; if (!t.dataset.sel) return;
    const s = sel[t.dataset.sel];
    t.checked ? s.add(t.value) : s.delete(t.value);
    updateBar(t.dataset.sel);
  });
  $('#stPick').addEventListener('click', async () => { const p = await st.pick(); if (p) startScan(p); });
  $('#stCancel').addEventListener('click', () => st.cancel());

  function renderTab() {
    if (tab === 'explore') renderExplore();
    else if (tab === 'big') renderBig();
    else if (tab === 'dupes') renderDupes();
    else { if (!junk && !junkBusy) runJunk(); else renderJunk(); }
  }

  let loaded = false;
  $$('.nav[data-page="storage"]').forEach((n) => n.addEventListener('click', () => { loadDrives(); if (!loaded) { loaded = true; renderTab(); } }));
})();
