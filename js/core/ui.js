/* Helpers de interfaz: avisos, confirmaciones y descargas. */
import { $, esc } from './util.js';

export function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 4500);
}
export function ask(msg, ok = 'Aceptar') {
  return new Promise(res => {
    const m = document.createElement('div'); m.className = 'modal small';
    m.innerHTML = `<div class="card"><p>${esc(msg)}</p><div class="row" style="justify-content:flex-end">
      <button class="ghost" data-r="0">Cancelar</button><button data-r="1">${esc(ok)}</button></div></div>`;
    m.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) { m.remove(); res(b.dataset.r === '1'); } });
    document.body.appendChild(m);
  });
}
export function download(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
