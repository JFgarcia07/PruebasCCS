/* PDF formal del reporte de un estudiante (jsPDF, cargado solo al descargar). */
import { fdate } from './util.js';

const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const loadScript = src => new Promise((res, rej) => {
  if (loadScript[src]) return res();
  const s = document.createElement('script'); s.src = src;
  s.onload = () => { loadScript[src] = true; res(); };
  s.onerror = () => rej(new Error('No se pudo cargar el generador de PDF. Revisa tu conexión.'));
  document.head.appendChild(s);
});
/* Imagen del sitio → PNG (con transparencia) reducido: jsPDF no lee webp */
const imgPng = (src, px = 360) => new Promise(res => {
  const im = new Image();
  im.onload = () => {
    const k = Math.min(1, px / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/png'));
  };
  im.onerror = () => res(null);
  im.src = src;
});

const NAVY = [27, 38, 68], GOLD = [201, 168, 119], GRAY = [102, 112, 137], INK = [22, 33, 63], SOFT = [238, 241, 248], LINE = [214, 219, 232];
const CLS = { ok: [21, 128, 61], warn: [180, 83, 9], bad: [185, 28, 28] };

/* s: estudiante (report-calc) · sum: summarize() · rubricName: rúbrica de reporte usada (o '') */
export async function reportPDF(s, sum, rubricName) {
  await loadScript(JSPDF);
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 48, CW = W - 2 * M, BOTTOM = H - 62;
  const [logo] = await Promise.all([imgPng('logo-white.webp', 240)]);
  let y = 0;
  const font = (style, size, color) => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const text = (t, x, yy, opt) => doc.text(String(t), x, yy, opt);
  const wrap = (t, w, size = 9.5) => { font('normal', size, INK); return doc.splitTextToSize(String(t), w); };
  const need = h => { if (y + h > BOTTOM) { doc.addPage(); y = M; } };

  // Encabezado institucional
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 108, 'F');
  doc.setFillColor(...GOLD); doc.rect(0, 108, W, 4, 'F');
  if (logo) doc.addImage(logo, 'PNG', M, 18, 72, 72);
  font('bold', 21, [255, 255, 255]); text('Calvary Christian School', M + 90, 52);
  font('normal', 11, GOLD); text('Informe integral del estudiante', M + 90, 72);
  font('normal', 8.5, [190, 198, 220]); text('ACADEMICS · DISCIPLESHIP · EXCELLENCE', M + 90, 90);
  font('normal', 9, [190, 198, 220]); text('Emitido: ' + new Date().toLocaleDateString('es'), W - M, 52, { align: 'right' });
  text('Documento confidencial', W - M, 68, { align: 'right' });
  y = 144;

  // Datos del estudiante
  font('bold', 8.5, GRAY); text('ESTUDIANTE', M, y); y += 20;
  font('bold', 19, NAVY); text(s.name, M, y); y += 17;
  if (s.email) { font('normal', 10, GRAY); text(s.email, M, y); y += 14; }
  y += 8;

  // Resumen: total acumulado y rango de la rúbrica de reporte
  const lv = sum.level, color = lv ? (CLS[lv.cls] || NAVY) : GRAY;
  const lines = lv && lv.text ? wrap(lv.text, CW - 36) : [];
  const adj = sum.adjusted ? wrap(`Nota ajustada manualmente por la administración (suma automática: ${sum.auto}).` + (s.override.reason ? ' Motivo: ' + s.override.reason : ''), CW - 36, 9) : [];
  const bh = 82 + (lines.length ? lines.length * 13 + 8 : 0) + (adj.length ? adj.length * 12 + 10 : 0);
  need(bh + 10);
  doc.setFillColor(...SOFT); doc.roundedRect(M, y, CW, bh, 6, 6, 'F');
  doc.setFillColor(...GOLD); doc.rect(M, y, 4, bh, 'F');
  font('bold', 8.5, GRAY); text('TOTAL ACUMULADO', M + 20, y + 22);
  const big = `${sum.total} / ${sum.max}`;
  font('bold', 28, NAVY); text(big, M + 20, y + 56); const bw = doc.getTextWidth(big);
  font('normal', 12, GRAY); text(`${sum.pct} %`, M + 20 + bw + 12, y + 56);
  if (lv) {
    font('bold', 11, [255, 255, 255]); const tw = doc.getTextWidth(lv.name) + 24;
    doc.setFillColor(...color); doc.roundedRect(W - M - 18 - tw, y + 26, tw, 24, 12, 12, 'F');
    text(lv.name, W - M - 18 - tw / 2, y + 42, { align: 'center' });
    font('bold', 8.5, GRAY); text(rubricName ? 'NIVEL · ' + rubricName.toUpperCase().slice(0, 34) : 'NIVEL', W - M - 18, y + 20, { align: 'right' });
  }
  let by = y + 82;
  if (lines.length) { font('normal', 9.5, INK); doc.text(lines, M + 20, by); by += lines.length * 13 + 8; }
  if (adj.length) { font('italic', 9, GRAY); doc.text(adj, M + 20, by + 2); }
  y += bh + 22;

  // Sección con tabla
  const section = (title, sub, rows = 1) => { need(Math.min(300, rows * 26 + 70)); font('bold', 13, NAVY); text(title, M, y); doc.setFillColor(...GOLD); doc.rect(M, y + 5, 34, 2.2, 'F');
    if (sub) { font('normal', 9, GRAY); text(sub, W - M, y, { align: 'right' }); } y += 22; };
  const table = (cols, rows, empty) => {
    if (!rows.length) { font('italic', 10, GRAY); text(empty, M, y + 4); y += 26; return; }
    const draw = (cells, head, odd) => {
      const ls = cells.map((c, i) => wrap(c, cols[i].w - 12, head ? 8.5 : 9.5)), h = Math.max(...ls.map(l => l.length)) * 12 + 12;
      if (!head) need(h + 24); else need(h + 40);
      if (head) { doc.setFillColor(...NAVY); doc.rect(M, y, CW, h, 'F'); }
      else { if (odd) { doc.setFillColor(...SOFT); doc.rect(M, y, CW, h, 'F'); } doc.setDrawColor(...LINE); doc.setLineWidth(.5); doc.line(M, y + h, M + CW, y + h); }
      let x = M;
      cells.forEach((c, i) => {
        font(head ? 'bold' : (i === 0 ? 'bold' : 'normal'), head ? 8.5 : 9.5, head ? [255, 255, 255] : INK);
        const al = cols[i].r ? 'right' : 'left';
        doc.text(ls[i], cols[i].r ? x + cols[i].w - 8 : x + 8, y + 16, { align: al }); x += cols[i].w;
      });
      y += h;
    };
    draw(cols.map(c => c.t), true); rows.forEach((r, i) => draw(r, false, i % 2));
    y += 18;
  };
  const pc = (a, b) => b ? Math.round(a / b * 100) + ' %' : '—';
  const sumRow = (label, a, b) => { need(30); doc.setFillColor(...SOFT); doc.rect(M, y - 10, CW, 24, 'F'); font('bold', 10, NAVY); text(label, M + 8, y + 6); text(`${a} / ${b}`, M + CW - 8, y + 6, { align: 'right' }); y += 44; };

  const ex = s.exams;
  section('Exámenes', ex.length ? ex.length + (ex.length === 1 ? ' examen' : ' exámenes') : '', ex.length + 2);
  table([{ t: 'EXAMEN', w: 270 }, { t: 'FECHA', w: 90 }, { t: 'NOTA', w: 90, r: 1 }, { t: '%', w: CW - 450, r: 1 }],
    ex.map(e => [e.title + (e.edited ? '  (nota editada)' : ''), fdate(e.date).split(',')[0], `${e.score} / ${e.max}`, pc(e.score, e.max)]), 'Sin exámenes registrados.');
  if (ex.length) { y -= 8; sumRow('Subtotal exámenes', Math.round(ex.reduce((a, e) => a + e.score, 0) * 100) / 100, Math.round(ex.reduce((a, e) => a + e.max, 0) * 100) / 100); }

  const iv = s.interviews;
  section('Entrevistas', iv.length ? iv.length + (iv.length === 1 ? ' entrevista' : ' entrevistas') : '', iv.length + 2);
  table([{ t: 'RÚBRICA', w: 150 }, { t: 'ENTREVISTADO', w: 80 }, { t: 'ENTREVISTADOR', w: 110 }, { t: 'FECHA', w: 70 }, { t: 'PUNTOS', w: CW - 410, r: 1 }],
    iv.map(i => [i.rubric, i.who, i.interviewer || '—', fdate(i.date).split(',')[0], `${i.score} / ${i.max}`]), 'Sin entrevistas registradas.');
  if (iv.length) { y -= 8; sumRow('Subtotal entrevistas', Math.round(iv.reduce((a, e) => a + e.score, 0) * 100) / 100, Math.round(iv.reduce((a, e) => a + e.max, 0) * 100) / 100); }

  const cv = s.coeval;
  section('Coevaluación docente', cv ? 'Actualizada ' + fdate(cv.date).split(',')[0] : '', 5);
  table([{ t: 'ÁREA', w: CW - 260 }, { t: 'PORCENTAJE', w: 120, r: 1 }, { t: 'PUNTOS', w: 140, r: 1 }],
    cv ? [...cv.parts.map(p => [p.name, `${p.pct} %`, `${p.points} / ${p.outOf}`]), ['Total coevaluación', pc(cv.score, cv.max), `${cv.score} / ${cv.max}`]] : [], 'Sin coevaluación registrada.');
  if (cv && cv.comment) { const ls = wrap(cv.comment, CW - 16); need(ls.length * 12 + 34); font('bold', 9, GRAY); text('Comentario', M, y - 2); y += 10; font('normal', 9.5, INK); doc.text(ls, M + 8, y); y += ls.length * 12 + 14; }

  // Pie de página en todas las hojas
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setDrawColor(...LINE); doc.setLineWidth(.6); doc.line(M, H - 44, W - M, H - 44);
    font('normal', 8.5, GRAY); text('Calvary Christian School · Informe del estudiante · Documento confidencial', M, H - 30); text(`Página ${p} de ${n}`, W - M, H - 30, { align: 'right' });
  }
  const slug = s.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  doc.save(`informe-${slug || 'estudiante'}.pdf`);
}
