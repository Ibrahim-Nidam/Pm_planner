const TEMPLATE_BASE = new URL('../docs/', import.meta.url);
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function parseDate(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  return date ? `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` : '';
}

function isoWeek(date) {
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (local.getDay() + 6) % 7;
  local.setDate(local.getDate() - day + 3);
  const weekYearStart = new Date(local.getFullYear(), 0, 4);
  const startDay = (weekYearStart.getDay() + 6) % 7;
  weekYearStart.setDate(weekYearStart.getDate() - startDay);
  return Math.floor((local - weekYearStart) / 86400000 / 7) + 1;
}

function formatDateWithWeek(value) {
  const date = parseDate(value);
  if (!date) return '';
  return `${formatDate(date)} S${isoWeek(date)}`;
}

function formatTime(value) {
  const date = parseDate(value);
  return date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : '';
}

function formatDateTime(value) {
  const date = parseDate(value);
  if (!date) return '';
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function duration(start, end) {
  const from = parseDate(start);
  const to = parseDate(end);
  if (!from || !to) return '';
  const minutes = Math.max(0, Math.round((to - from) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} h ${pad(rest)} min`;
  if (hours) return `${hours} h`;
  return `${rest} min`;
}

function maintenanceCycle(dateValue) {
  const date = parseDate(dateValue) || new Date();
  const index = (((date.getFullYear() - 2026) * 12 + date.getMonth()) % 12 + 12) % 12;
  if (index === 2 || index === 8) return 'trimestrielle';
  if (index === 5) return 'semi annuel';
  if (index === 11) return 'annuel';
  return 'mensuel';
}

const CHECKLIST_PERIOD_ROWS = {
  quarterlyOrLonger: [53, 58, 84, 85, 87, 88],
  semiAnnualOrAnnual: [55]
};

function periodAllowsTask(period, row) {
  if (CHECKLIST_PERIOD_ROWS.quarterlyOrLonger.includes(row)) {
    return period !== 'mensuel';
  }
  if (CHECKLIST_PERIOD_ROWS.semiAnnualOrAnnual.includes(row)) {
    return period === 'semi annuel' || period === 'annuel';
  }
  return true;
}

function normaliseParts(parts) {
  return Array.isArray(parts)
    ? parts.filter(part => part && (part.designation || part.reference || part.quantity))
      .map(part => ({
        designation: String(part.designation || ''),
        reference: String(part.reference || ''),
        quantity: String(part.quantity || '')
      }))
    : [];
}

function documentData(task, technicianName) {
  // The fiche dates describe when the PM actually happened, not when it was planned.
  const startAt = task.started_at || task.ended_at || task.scheduled_date;
  const requestDate = startAt;
  return {
    requestDate: formatDateWithWeek(requestDate),
    interventionDate: formatDateWithWeek(startAt),
    machine: task.machines?.code || '',
    line: task.machines?.line || '',
    startedTime: formatTime(task.started_at),
    endedTime: formatTime(task.ended_at),
    startedAt: formatDateTime(task.started_at),
    endedAt: formatDateTime(task.ended_at),
    duration: duration(task.started_at, task.ended_at),
    // The PM period belongs to the planned cycle, so it still follows the scheduled date.
    cycle: maintenanceCycle(task.scheduled_date || startAt),
    date: formatDate(startAt),
    technician: technicianName || '',
    parts: normaliseParts(task.parts)
  };
}

function requireMarker(xml, marker, label) {
  const index = xml.indexOf(marker);
  if (index < 0) throw new Error(`Template field not found: ${label}`);
  return index;
}

function rowBoundsAfter(xml, markerIndex) {
  const start = xml.indexOf('</w:tr>', markerIndex);
  if (start < 0) throw new Error('Template row not found');
  const end = xml.indexOf('</w:tr>', start + 1);
  if (end < 0) throw new Error('Template row not found');
  return { start, end };
}

function fillEmptyRun(xml, from, to, value) {
  const token = '</w:rPr></w:r>';
  const index = xml.indexOf(token, from);
  if (index < 0 || index >= to) throw new Error('Template field not found');
  const insert = `<w:t xml:space="preserve">${escapeXml(value)}</w:t>`;
  const at = index + '</w:rPr>'.length;
  return {
    xml: `${xml.slice(0, at)}${insert}${xml.slice(at)}`,
    next: at + insert.length + '</w:r>'.length
  };
}

function fillNextPartCell(xml, from, to, value) {
  const emptyToken = '</w:rPr></w:r>';
  const spaceToken = '<w:t xml:space="preserve"> </w:t>';
  const emptyAt = xml.indexOf(emptyToken, from);
  const spaceAt = xml.indexOf(spaceToken, from);
  const emptyOk = emptyAt >= 0 && emptyAt < to;
  const spaceOk = spaceAt >= 0 && spaceAt < to;
  if (spaceOk && (!emptyOk || spaceAt < emptyAt)) {
    const insert = `<w:t xml:space="preserve">${escapeXml(value)}</w:t>`;
    return {
      xml: `${xml.slice(0, spaceAt)}${insert}${xml.slice(spaceAt + spaceToken.length)}`,
      next: spaceAt + insert.length
    };
  }
  return fillEmptyRun(xml, from, to, value);
}

function replaceOnce(xml, search, replacement, label) {
  const index = xml.indexOf(search);
  if (index < 0) throw new Error(`Template field not found: ${label}`);
  return xml.slice(0, index) + replacement + xml.slice(index + search.length);
}

function fillWordXml(xml, data) {
  const request = rowBoundsAfter(xml, requireMarker(xml, 'Date et heure de la demande</w:t>', 'Date et heure de la demande'));
  ({ xml } = fillEmptyRun(xml, request.start, request.end, data.requestDate));

  let cursor = xml.indexOf('</w:tr>', requireMarker(xml, 'Date et heure de l\u2019intervention</w:t>', "Date et heure de l'intervention"));
  for (const value of [data.interventionDate, data.machine, data.startedTime, data.endedTime, data.duration]) {
    const filled = fillEmptyRun(xml, cursor, xml.indexOf('</w:tr>', cursor + 1), value);
    xml = filled.xml;
    cursor = filled.next;
  }

  if (data.parts.length) {
    cursor = xml.indexOf('</w:tr>', requireMarker(xml, 'Désignation</w:t>', 'Désignation'));
    for (const part of data.parts) {
      for (const value of [part.designation, part.reference, part.quantity]) {
        const filled = fillNextPartCell(xml, cursor, xml.indexOf('</w:tbl>', cursor), value);
        xml = filled.xml;
        cursor = filled.next;
      }
    }
  }

  xml = replaceOnce(
    xml,
    'Maintenance préventive  </w:t>',
    `Maintenance préventive  ${escapeXml(data.cycle)}</w:t>`,
    'Maintenance préventive'
  );

  const dateLabel = 'Date\u00a0: </w:t>';
  xml = xml.replaceAll(dateLabel, `Date\u00a0: ${escapeXml(data.date)}</w:t>`);
  if (!xml.includes(`Date\u00a0: ${data.date}</w:t>`)) {
    throw new Error('Template signature date fields not found');
  }
  return xml;
}

function appendChecklistLabel(xml, label, value) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(<t[^>]*>[^<]*${escapedLabel})[^<]*(</t>)`);
  if (!pattern.test(xml)) throw new Error(`Checklist field not found: ${label}`);
  return xml.replace(pattern, `$1${escapeXml(value)}$2`);
}

function fillChecklistXml(xml, data) {
  xml = appendChecklistLabel(xml, 'Numéro de série du CTX : ', data.machine);
  xml = appendChecklistLabel(xml, 'Adresse du CTX : ', data.line);
  xml = appendChecklistLabel(xml, 'Période de MP :  ', data.cycle);
  xml = appendChecklistLabel(xml, 'Nom du ou des techniciens de maintenance : ', data.technician);
  xml = appendChecklistLabel(xml, 'Date de début de la MP : ', data.startedAt);
  xml = appendChecklistLabel(xml, 'Date de fin de la MP : ', data.endedAt);
  return xml;
}

function fillChecklistSheetXml(xml, data) {
  for (const row of [...CHECKLIST_PERIOD_ROWS.quarterlyOrLonger, ...CHECKLIST_PERIOD_ROWS.semiAnnualOrAnnual]) {
    const answer = periodAllowsTask(data.cycle, row) ? 'OUI' : 'NON';
    const pattern = new RegExp(`<c([^>]*\\br="${`C${row}`}\\b[^>]*)>.*?</c>`);
    const match = xml.match(pattern);
    if (!match) throw new Error(`Checklist answer cell not found: C${row}`);
    const attributes = match[1].replace(/\s+t="[^"]*"/, '');
    xml = xml.replace(pattern, `<c${attributes} t="inlineStr"><is><t>${answer}</t></is></c>`);
  }
  return xml;
}

// Correct MIME types keep mobile browsers from renaming the files (e.g. to .zip).
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ZIP_MIME = 'application/zip';
// Revoking too early aborts downloads that are still queued on mobile browsers.
const OBJECT_URL_TTL_MS = 60000;

async function loadZip(filename) {
  const JSZip = (await import(JSZIP_URL)).default;
  const response = await fetch(new URL(filename, TEMPLATE_BASE));
  if (!response.ok) throw new Error(`${filename} could not be loaded`);
  return JSZip.loadAsync(await response.arrayBuffer());
}

async function patchWordDocument(data) {
  const zip = await loadZip('PM template.docx');
  const path = 'word/document.xml';
  zip.file(path, fillWordXml(await zip.file(path).async('string'), data));
  return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
}

async function patchChecklist(data) {
  const zip = await loadZip('Cheklist_PM.xlsx');
  const sharedStringsPath = 'xl/sharedStrings.xml';
  const worksheetPath = 'xl/worksheets/sheet1.xml';
  zip.file(sharedStringsPath, fillChecklistXml(await zip.file(sharedStringsPath).async('string'), data));
  zip.file(worksheetPath, fillChecklistSheetXml(await zip.file(worksheetPath).async('string'), data));
  return zip.generateAsync({ type: 'blob', mimeType: XLSX_MIME, compression: 'DEFLATE' });
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_TTL_MS);
}

async function bundleFiles(files) {
  const JSZip = (await import(JSZIP_URL)).default;
  const bundle = new JSZip();
  for (const file of files) bundle.file(file.name, file.blob);
  return bundle.generateAsync({ type: 'blob', mimeType: ZIP_MIME, compression: 'DEFLATE' });
}

// iOS/iPadOS only honours one download per action and cancels the previous one,
// so both documents travel together in a single archive there.
function keepsOnlyLastDownload() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /\b(iPhone|iPad|iPod)\b/.test(ua)
    || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}

function fileStamp(data) {
  return `${data.machine}-${data.date.replaceAll('/', '-')}`;
}

export async function downloadPmDocuments(task, technicianName) {
  const data = documentData(task, technicianName);
  const stamp = fileStamp(data);
  const [docxBlob, checklistBlob] = await Promise.all([
    patchWordDocument(data),
    patchChecklist(data)
  ]);
  const files = [
    { blob: docxBlob, name: `PM-${stamp}.docx` },
    { blob: checklistBlob, name: `Checklist-PM-${stamp}.xlsx` }
  ];

  if (keepsOnlyLastDownload()) {
    saveBlob(await bundleFiles(files), `PM-${stamp}.zip`);
    return 'zip';
  }

  // Both blobs are ready first, then saved together so the two downloads start in one go.
  files.forEach(file => saveBlob(file.blob, file.name));
  return 'files';
}

export {
  documentData,
  fillWordXml,
  fillChecklistXml,
  fillChecklistSheetXml,
  maintenanceCycle
};

const PRINT_CONTROLS_CSS = `@media print{.pm-print-bar{display:none !important}}
.pm-print-bar{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;padding:10px 14px;background:#0f172a;color:#fff;font-family:Arial,sans-serif;font-size:13px}
.pm-print-bar .pm-print-title{font-weight:700;letter-spacing:.03em;text-transform:uppercase;font-size:11px}
.pm-print-bar button{padding:9px 18px;font-size:13px;font-weight:700;border:0;border-radius:8px;background:#fff;color:#0f172a;cursor:pointer}
.pm-print-bar button + button{background:#475569;color:#fff;margin-left:8px}`;

function printBarMarkup(title) {
  return `<div class="pm-print-bar"><span class="pm-print-title">${escapeHtml(title)}</span><span>`
    + `<button type="button" onclick="window.print()">Print</button>`
    + `<button type="button" onclick="window.close()">Close</button></span></div>`;
}

function openPrintWindow(label) {
  // No "noopener": the browser returns null with it, which leaves a blank page behind.
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error(`Please allow pop-ups to ${label}`);
  return printWindow;
}

function schedulePrint(printWindow) {
  const runPrint = () => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch (err) {
      console.error('Print failed:', err);
    }
  };
  // The load event may already have fired while the document was written.
  if (printWindow.document.readyState === 'complete') setTimeout(runPrint, 250);
  else printWindow.addEventListener('load', () => setTimeout(runPrint, 250), { once: true });
}

function writePrintShell(printWindow, title, headCss, bodyHtml) {
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_CONTROLS_CSS}${headCss}</style></head><body>${printBarMarkup(title)}${bodyHtml}</body></html>`);
  printWindow.document.close();
}

// ---------------------------------------------------------------------------
// PM fiche: the print preview renders the very same .docx that is downloaded.
// ---------------------------------------------------------------------------

const DOCX_PREVIEW_LIBS = {
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  preview: 'https://cdn.jsdelivr.net/npm/docx-preview@0.4.1/dist/docx-preview.min.js'
};

const DOCX_PREVIEW_OPTIONS = {
  inWrapper: true,
  breakPages: true,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  useBase64URL: true,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  hideWrapperOnPrint: true
};

const DOCX_PREVIEW_CSS = `@page{size:A4 portrait;margin:0}
html,body{margin:0;padding:0;background:#fff}
body{font-family:Calibri,"Segoe UI",Arial,sans-serif}
/* docx-preview injects its own stylesheet after ours, so lock the print box down. */
@media print{
  .docx-wrapper{background:#fff !important;padding:0 !important;margin:0 !important}
  .docx-wrapper > section.docx{margin:0 !important;border:0 !important;box-shadow:none !important;background:#fff !important}
}`;

// The browser lays this document out a little taller than Word does, which would
// push it onto a third sheet. Wrap the flowing content, scale it into the page box
// and pin every section to one A4 sheet, so the preview prints on 2 pages like the .docx.
// The content box keeps the width of the document's text column, so the line breaks
// and the tables stay those of the .docx.
function fitDocxSections(printWindow) {
  const doc = printWindow.document;
  const sections = [...doc.querySelectorAll('section.docx')];
  if (!sections.length) return;
  const pageHeightPt = parseFloat(sections[0].style.minHeight) || 841.9;
  const box = getComputedStyle(sections[0]);
  const padTop = parseFloat(box.paddingTop) || 0;
  const padBottom = parseFloat(box.paddingBottom) || 0;
  const sheetHeightPx = (pageHeightPt * 96) / 72;
  const contentHeightPx = sheetHeightPx - padTop - padBottom;
  const flowOf = section => [...section.children].filter(child => getComputedStyle(child).position !== 'absolute');

  const scale = Math.min(1, ...sections.map(section => {
    const flow = flowOf(section);
    if (!flow.length) return 1;
    const top = section.getBoundingClientRect().top;
    const bottom = Math.max(...flow.map(child => child.getBoundingClientRect().bottom));
    return (contentHeightPx - 1) / (bottom - top - padTop);
  }));

  if (scale < 0.999) {
    // docx-preview styles these as "section > article" / "section > footer".
    const style = doc.createElement('style');
    style.textContent = '.pm-fit{display:flex;flex-flow:column nowrap;flex:1 0 auto;transform-origin:top center}'
      + '.pm-fit>article{margin-bottom:auto;z-index:1}.pm-fit>footer{z-index:1}';
    doc.head.appendChild(style);
  }

  sections.forEach(section => {
    const flow = flowOf(section);
    if (flow.length && scale < 0.999) {
      const fit = doc.createElement('div');
      fit.className = 'pm-fit';
      // Tall enough that, once scaled, the footer still lands on the page bottom.
      fit.style.height = `${(contentHeightPx / scale).toFixed(2)}px`;
      fit.style.transform = `scale(${Number(scale.toFixed(4))})`;
      section.insertBefore(fit, flow[0]);
      flow.forEach(child => fit.appendChild(child));
    }
    // Exactly one A4 sheet per section, with the document's own margins.
    section.style.minHeight = '0';
    section.style.height = `${(pageHeightPt - 0.5).toFixed(2)}pt`;
    section.style.overflow = 'hidden';
  });
  // Each section of the document starts on its own sheet.
  for (let index = 1; index < sections.length; index++) sections[index].style.breakBefore = 'page';
}

function injectScript(printWindow, src) {
  return new Promise((resolve, reject) => {
    const script = printWindow.document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Print preview could not be loaded, check the internet connection'));
    printWindow.document.head.appendChild(script);
  });
}

async function loadDocxRenderer(printWindow) {
  if (printWindow.docx?.renderAsync) return printWindow.docx;
  if (!printWindow.JSZip) await injectScript(printWindow, DOCX_PREVIEW_LIBS.jszip);
  await injectScript(printWindow, DOCX_PREVIEW_LIBS.preview);
  if (!printWindow.docx?.renderAsync) throw new Error('Print preview could not be loaded, check the internet connection');
  return printWindow.docx;
}

export async function printPmDocument(task, technicianName) {
  // Opened before the first await so mobile browsers still count the user gesture.
  const printWindow = openPrintWindow('print the document');
  try {
    const data = documentData(task, technicianName);
    writePrintShell(printWindow, `Fiche d'intervention PM ${data.machine}`, DOCX_PREVIEW_CSS, '<div id="pm-docx"></div>');
    const renderer = await loadDocxRenderer(printWindow);
    await renderer.renderAsync(
      await patchWordDocument(data),
      printWindow.document.getElementById('pm-docx'),
      null,
      DOCX_PREVIEW_OPTIONS
    );
    fitDocxSections(printWindow);
    schedulePrint(printWindow);
  } catch (err) {
    printWindow.close();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Checklist: the print preview renders the very same .xlsx that is downloaded.
// ---------------------------------------------------------------------------

// A4 portrait minus 10mm side margins, at 96dpi, matching the sheet page setup.
const SHEET_PAGE_WIDTH_PX = 718;
const SHEET_PREVIEW_CSS = `@page{size:A4 portrait;margin:10mm}
html,body{margin:0;padding:0;background:#fff}
body{font-family:Calibri,Arial,sans-serif;line-height:1.15}
table.sheet{border-collapse:collapse;table-layout:fixed;width:100%;margin:0 auto}
table.sheet td{padding:1px 3px;vertical-align:bottom;overflow-wrap:break-word}
table.sheet img{display:block;height:auto}`;

const BORDER_WIDTH = { hair: 0.5, dotted: 1, dashed: 1, thin: 1, medium: 2, thick: 3, double: 3 };
const BORDER_STYLE = { hair: 'dotted', dotted: 'dotted', dashed: 'dashed', double: 'double' };

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Template XML could not be parsed');
  return doc;
}

const descendants = (node, localName) => [...node.getElementsByTagNameNS('*', localName)];
const descendant = (node, localName) => node.getElementsByTagNameNS('*', localName)[0];

function columnNumberOf(ref) {
  const letters = (String(ref).match(/^[A-Z]+/) || ['A'])[0];
  return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);
}

function applyTint(hex, tint) {
  const amount = Number(tint);
  if (!amount || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const mixed = [1, 3, 5].map(index => {
    const channel = parseInt(hex.slice(index, index + 2), 16);
    return amount > 0 ? channel + (255 - channel) * amount : channel * (1 + amount);
  });
  return `#${mixed.map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

function resolveColor(node, theme, fallback = '') {
  const rgb = node?.getAttribute('rgb');
  if (rgb) return `#${rgb.slice(-6)}`;
  const themeIndex = node?.getAttribute('theme');
  if (themeIndex !== null && themeIndex !== undefined && theme[themeIndex]) {
    return applyTint(theme[themeIndex], node.getAttribute('tint'));
  }
  return fallback;
}

function parseTheme(text) {
  const scheme = descendant(parseXml(text), 'clrScheme');
  const theme = {};
  if (scheme) {
    [...scheme.children].forEach((entry, index) => {
      const color = entry.firstElementChild;
      const hex = color?.getAttribute('lastClr') || color?.getAttribute('val') || '';
      theme[index] = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '';
      theme[entry.localName] = theme[index];
    });
  }
  return theme;
}

function parseSharedStrings(text) {
  if (!text) return [];
  return descendants(parseXml(text), 'si').map(si => [...si.children].map(part => {
    if (part.localName === 't') return part.textContent;
    if (part.localName === 'r') return descendant(part, 't')?.textContent || '';
    return '';
  }).join(''));
}

function parseSheetStyles(text, theme) {
  const doc = parseXml(text);
  const fonts = descendants(doc, 'font').map(font => ({
    bold: Boolean(descendant(font, 'b')),
    italic: Boolean(descendant(font, 'i')),
    size: Number(descendant(font, 'sz')?.getAttribute('val') || 11),
    name: descendant(font, 'name')?.getAttribute('val') || 'Calibri',
    color: resolveColor(descendant(font, 'color'), theme, '#000000')
  }));
  const fills = descendants(doc, 'fill').map(fill => {
    const pattern = descendant(fill, 'patternFill');
    return pattern?.getAttribute('patternType') === 'solid' ? resolveColor(descendant(pattern, 'fgColor'), theme, '') : '';
  });
  const borders = descendants(doc, 'border').map(border => {
    const side = name => {
      const element = descendant(border, name);
      const style = element?.getAttribute('style');
      if (!style) return null;
      return {
        width: BORDER_WIDTH[style] || 1,
        style: BORDER_STYLE[style] || 'solid',
        color: resolveColor(descendant(element, 'color'), theme, '#000000')
      };
    };
    return { left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom') };
  });
  const cellXfs = descendant(doc, 'cellXfs');
  const xfs = cellXfs ? [...cellXfs.children].map(xf => {
    const alignment = descendant(xf, 'alignment');
    return {
      fontId: Number(xf.getAttribute('fontId') || 0),
      fillId: Number(xf.getAttribute('fillId') || 0),
      borderId: Number(xf.getAttribute('borderId') || 0),
      horizontal: alignment?.getAttribute('horizontal') || 'general',
      vertical: alignment?.getAttribute('vertical') || 'bottom',
      wrap: Boolean(alignment?.getAttribute('wrapText'))
    };
  }) : [];
  return { fonts, fills, borders, xfs };
}

function resolveZipPath(basePath, target) {
  const parts = basePath.split('/');
  parts.pop();
  for (const segment of String(target).split('/')) {
    if (segment === '..') parts.pop();
    else if (segment && segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function readSheetImages(zip) {
  const drawingFile = zip.file(/xl\/drawings\/drawing\d+\.xml$/)[0];
  const anchors = [];
  if (!drawingFile) return anchors;
  const relationships = {};
  const relsFile = zip.file(`xl/drawings/_rels/${drawingFile.name.split('/').pop()}.rels`);
  if (relsFile) {
    descendants(parseXml(await relsFile.async('string')), 'Relationship')
      .forEach(rel => { relationships[rel.getAttribute('Id')] = rel.getAttribute('Target'); });
  }
  const drawing = parseXml(await drawingFile.async('string'));
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  for (const anchor of [...descendants(drawing, 'twoCellAnchor'), ...descendants(drawing, 'oneCellAnchor')]) {
    const from = descendant(anchor, 'from');
    const to = descendant(anchor, 'to');
    const embed = descendant(anchor, 'blip')?.getAttributeNS(REL_NS, 'embed');
    const target = relationships[embed];
    if (!from || !target) continue;
    const imageFile = zip.file(resolveZipPath(drawingFile.name, target));
    if (!imageFile) continue;
    const startColumn = Number(descendant(from, 'col')?.textContent || 0);
    const startColumnOffset = Number(descendant(from, 'colOff')?.textContent || 0);
    const startRow = Number(descendant(from, 'row')?.textContent || 0);
    const startRowOffset = Number(descendant(from, 'rowOff')?.textContent || 0);
    const endColumn = to ? Number(descendant(to, 'col')?.textContent || startColumn + 1) : startColumn + 1;
    const endColumnOffset = to ? Number(descendant(to, 'colOff')?.textContent || 0) : 0;
    const extension = target.split('.').pop().toLowerCase();
    const mime = extension === 'png' ? 'image/png' : extension === 'gif' ? 'image/gif' : 'image/jpeg';
    anchors.push({
      column: startColumn + 1,
      row: startRow + 1,
      fromColumn: startColumn,
      toColumn: endColumn,
      offset: startColumnOffset / 9525, // px into the anchor column
      rowOffset: startRowOffset / 9525, // px down from the anchor cell
      toOffset: endColumnOffset / 9525,
      src: await blobToDataUrl(new Blob([await imageFile.async('uint8array')], { type: mime }))
    });
  }
  return anchors;
}

async function checklistSheetHtml(workbookBlob) {
  const JSZip = (await import(JSZIP_URL)).default;
  const zip = await JSZip.loadAsync(workbookBlob);
  const read = async path => (zip.file(path) ? await zip.file(path).async('string') : '');
  const sharedStrings = parseSharedStrings(await read('xl/sharedStrings.xml'));
  const theme = parseTheme(await read('xl/theme/theme1.xml'));
  const styles = parseSheetStyles(await read('xl/styles.xml'), theme);
  const anchors = await readSheetImages(zip);
  const sheet = parseXml(await read('xl/worksheets/sheet1.xml'));

  const declaredWidths = [];
  descendants(sheet, 'col').forEach(col => {
    const min = Number(col.getAttribute('min'));
    const max = Math.min(Number(col.getAttribute('max')), 26);
    for (let column = min; column <= max; column++) declaredWidths[column] = Number(col.getAttribute('width') || 8.43);
  });

  const cells = new Map();
  let maxRow = 0;
  let maxColumn = 0;
  descendants(sheet, 'row').forEach(row => {
    [...row.children].filter(node => node.localName === 'c').forEach(cell => {
      const ref = cell.getAttribute('r') || '';
      const column = columnNumberOf(ref);
      const rowNumber = Number((ref.match(/\d+/) || [0])[0]);
      if (!column || !rowNumber) return;
      maxRow = Math.max(maxRow, rowNumber);
      maxColumn = Math.max(maxColumn, column);
      const type = cell.getAttribute('t');
      let value = '';
      if (type === 'inlineStr') value = descendants(cell, 't').map(node => node.textContent).join('');
      else {
        const raw = descendant(cell, 'v')?.textContent ?? '';
        value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : raw;
      }
      cells.set(`${column}:${rowNumber}`, { value, styleId: Number(cell.getAttribute('s') || 0) });
    });
  });

  const covered = new Set();
  const origins = new Map();
  descendants(sheet, 'mergeCell').forEach(node => {
    const [start, end] = String(node.getAttribute('ref') || '').split(':');
    const startColumn = columnNumberOf(start);
    const startRow = Number((String(start).match(/\d+/) || [0])[0]);
    const endColumn = columnNumberOf(end || start);
    const endRow = Number((String(end || start).match(/\d+/) || [0])[0]);
    origins.set(`${startColumn}:${startRow}`, { columns: endColumn - startColumn + 1, rows: endRow - startRow + 1 });
    for (let row = startRow; row <= endRow; row++) {
      for (let column = startColumn; column <= endColumn; column++) {
        if (column !== startColumn || row !== startRow) covered.add(`${column}:${row}`);
      }
    }
  });
  // An image anchored inside a merged range travels with the merged cell.
  const originKeyOf = key => {
    for (const [origin, range] of origins) {
      const [column, row] = key.split(':').map(Number);
      const [originColumn, originRow] = origin.split(':').map(Number);
      if (column >= originColumn && column < originColumn + range.columns && row >= originRow && row < originRow + range.rows) return origin;
    }
    return key;
  };

  const imagesByCell = new Map();
  anchors.forEach(anchor => {
    const key = originKeyOf(`${anchor.column}:${anchor.row}`);
    if (!imagesByCell.has(key)) imagesByCell.set(key, []);
    imagesByCell.get(key).push(anchor);
  });

  const widths = [];
  for (let column = 1; column <= maxColumn; column++) widths[column] = declaredWidths[column] || 8.43;
  const pixelWidth = width => Math.round(width * 7 + 5);
  const totalWidth = widths.slice(1, maxColumn + 1).reduce((sum, width) => sum + pixelWidth(width), 0) || SHEET_PAGE_WIDTH_PX;
  const scale = SHEET_PAGE_WIDTH_PX / totalWidth;
  const sideCss = side => (side ? `${(side.width * scale).toFixed(2)}px ${side.style} ${side.color}` : 'none');
  // Left edge of an Excel column, in sheet pixels.
  const columnStartPx = index => {
    let start = 0;
    for (let column = 0; column < index; column++) start += pixelWidth(widths[column + 1] || 8.43);
    return start;
  };
  // Images hang off their anchor cell so they follow the row as it wraps.
  const imageHtml = anchor => {
    const cellWidth = pixelWidth(widths[anchor.fromColumn + 1] || 8.43);
    const widthPx = Math.max(8, (columnStartPx(anchor.toColumn) + anchor.toOffset)
      - (columnStartPx(anchor.fromColumn) + anchor.offset));
    return `<img src="${anchor.src}" alt="" style="position:absolute;`
      + `left:${((anchor.offset / cellWidth) * 100).toFixed(2)}%;`
      + `top:${(anchor.rowOffset * scale).toFixed(1)}px;`
      + `width:${((widthPx / cellWidth) * 100).toFixed(2)}%">`;
  };

  const rowsHtml = [];
  for (let row = 1; row <= maxRow; row++) {
    const cellsHtml = [];
    for (let column = 1; column <= maxColumn; column++) {
      const key = `${column}:${row}`;
      if (covered.has(key)) continue;
      const cell = cells.get(key);
      const style = styles.xfs[cell?.styleId] || styles.xfs[0];
      const font = styles.fonts[style?.fontId] || styles.fonts[0];
      const border = styles.borders[style?.borderId] || styles.borders[0];
      const fill = style ? styles.fills[style.fillId] : '';
      const merge = origins.get(key);
      const images = (imagesByCell.get(key) || []).map(imageHtml).join('');
      const css = [
        font && `font-family:'${font.name}',Arial,sans-serif`,
        font && `font-size:${(font.size * scale).toFixed(2)}pt`,
        font?.bold && 'font-weight:700',
        font?.italic && 'font-style:italic',
        font?.color && `color:${font.color}`,
        fill && `background:${fill}`,
        border && `border-top:${sideCss(border.top)}`,
        border && `border-right:${sideCss(border.right)}`,
        border && `border-bottom:${sideCss(border.bottom)}`,
        border && `border-left:${sideCss(border.left)}`,
        style?.horizontal === 'center' && 'text-align:center',
        style?.horizontal === 'right' && 'text-align:right',
        style?.vertical === 'middle' && 'vertical-align:middle',
        style?.vertical === 'top' && 'vertical-align:top',
        style?.wrap && 'white-space:pre-wrap',
        images && 'position:relative;overflow:visible'
      ].filter(Boolean).join(';');
      cellsHtml.push(`<td${merge ? ` colspan="${merge.columns}" rowspan="${merge.rows}"` : ''} style="${css}">${escapeHtml(cell?.value ?? '')}${images}</td>`);
    }
    rowsHtml.push(`<tr>${cellsHtml.join('')}</tr>`);
  }

  const columnHtml = Array.from({ length: maxColumn }, (_, index) =>
    `<col style="width:${((pixelWidth(widths[index + 1]) / totalWidth) * 100).toFixed(3)}%">`
  ).join('');
  return `<table class="sheet"><colgroup>${columnHtml}</colgroup>${rowsHtml.join('')}</table>`;
}

export async function printChecklist(task, technicianName) {
  const printWindow = openPrintWindow('print the checklist');
  try {
    const data = documentData(task, technicianName);
    const html = await checklistSheetHtml(await patchChecklist(data));
    writePrintShell(printWindow, `Checklist PM ${data.machine}`, SHEET_PREVIEW_CSS, html);
    schedulePrint(printWindow);
  } catch (err) {
    printWindow.close();
    throw err;
  }
}
