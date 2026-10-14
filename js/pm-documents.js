const TEMPLATE_BASE = new URL('../docs/', import.meta.url);
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

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
