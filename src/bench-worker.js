// Carga de CPU fija para el test: mezcla de enteros, coma flotante y memoria. Devuelve iteraciones/ms.
onmessage = (e) => {
  const ms = e.data.ms || 3000, end = performance.now() + ms;
  const buf = new Float64Array(4096);
  let it = 0, x = 1.0001, h = 2166136261;
  while (performance.now() < end) {
    for (let i = 0; i < 2000; i++) {
      x = Math.sqrt(x * 1.0000001 + i) * 0.999 + Math.sin(i * 0.001);
      h = Math.imul(h ^ i, 16777619) >>> 0;
      buf[(h + i) & 4095] += x;
    }
    it++;
  }
  postMessage({ rate: it / ms, chk: buf[7] + h });
};
