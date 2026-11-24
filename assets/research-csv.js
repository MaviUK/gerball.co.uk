(function (root) {
  'use strict';

  function cell(value) {
    if (value !== null && value !== undefined && !['string', 'number', 'boolean', 'bigint'].includes(typeof value)) throw Error('CSV cells must contain text or numbers.');
    if (typeof value === 'number' && !Number.isFinite(value)) throw Error('CSV numbers must be finite.');
    let text = value === null || value === undefined ? '' : String(value);
    if (typeof value === 'string') {
      const numeric = !/[\u0000-\u001f\uFEFF]/.test(text) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?%?$/.test(text.trim());
      if ((!numeric && /^[\s\uFEFF\u0000-\u001f]*[=+@-]/.test(text)) || /^[\u0000-\u001f]/.test(text)) text = "'" + text;
    }
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function stringify(rows) {
    if (!Array.isArray(rows)) throw Error('CSV rows must be an array.');
    if (!rows.length) return '';
    const width = Array.isArray(rows[0]) ? rows[0].length : 0;
    if (!width || rows.some(row => !Array.isArray(row) || row.length !== width)) throw Error('Every CSV row must have the same number of columns.');
    return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
  }

  function download(rows, filename) {
    const csv = stringify(rows);
    if (!csv) return false;
    if (typeof filename !== 'string' || !filename.trim()) throw Error('Choose a CSV filename.');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = root.URL.createObjectURL(blob), link = root.document.createElement('a');
    link.href = url; link.download = filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
    try { root.document.body.appendChild(link); link.click(); }
    finally { link.remove(); root.setTimeout(() => root.URL.revokeObjectURL(url), 1000); }
    return true;
  }

  root.GerballCSV = Object.freeze({ stringify, download });
})(typeof window === 'undefined' ? globalThis : window);
