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
  if (index === 2 || index === 8) return 'trimestriel';
  if (index === 5) return 'semi annuel';
  if (index === 11) return 'annuel';
  return 'mensuel';
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
  const requestDate = task.scheduled_date;
  const startAt = task.started_at || requestDate;
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
    cycle: maintenanceCycle(requestDate),
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
  const pattern = new RegExp(`(<t[^>]*>)${escapedLabel}[^<]*(</t>)`);
  if (!pattern.test(xml)) throw new Error(`Checklist field not found: ${label}`);
  return xml.replace(pattern, `$1${label}${escapeXml(value)}$2`);
}

function fillChecklistXml(xml, data) {
  xml = appendChecklistLabel(xml, 'Numéro de série du CTX : ', data.machine);
  xml = appendChecklistLabel(xml, 'Adresse du CTX : ', data.line);
  xml = appendChecklistLabel(xml, 'Nom du ou des techniciens de maintenance : ', data.technician);
  xml = appendChecklistLabel(xml, 'Date de début de la MP : ', data.startedAt);
  xml = appendChecklistLabel(xml, 'Date de fin de la MP : ', data.endedAt);
  return xml;
}

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
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

async function patchChecklist(data) {
  const zip = await loadZip('Cheklist_PM.xlsx');
  const path = 'xl/sharedStrings.xml';
  zip.file(path, fillChecklistXml(await zip.file(path).async('string'), data));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileStamp(data) {
  return `${data.machine}-${data.date.replaceAll('/', '-')}`;
}

export async function downloadPmDocuments(task, technicianName) {
  const data = documentData(task, technicianName);
  await downloadBlob(await patchWordDocument(data), `PM-${fileStamp(data)}.docx`);
  await downloadBlob(await patchChecklist(data), `Checklist-PM-${fileStamp(data)}.xlsx`);
}

function normalise(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function loadTemplateDocument(data) {
  const response = await fetch(new URL('PM template.html', TEMPLATE_BASE));
  if (!response.ok) throw new Error('PM Word template could not be loaded');
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const cells = () => [...doc.querySelectorAll('td')];
  const findCell = text => cells().find(cell => normalise(cell.textContent).includes(normalise(text)));
  const fillEmptyParagraph = (cell, value) => {
    if (!cell) throw new Error('Template field not found');
    const paragraph = [...cell.querySelectorAll('p')].find(node => !normalise(node.textContent)) || cell.querySelector('p') || cell;
    paragraph.textContent = String(value ?? '');
  };

  fillEmptyParagraph(findCell('Date et heure de la demande')?.closest('tr')?.nextElementSibling?.cells[0], data.requestDate);

  const interventionRow = (findCell('Date et heure de l’intervention') || findCell("Date et heure de l'intervention"))
    ?.closest('tr')?.nextElementSibling;
  fillEmptyParagraph(interventionRow?.cells[0], data.interventionDate);
  fillEmptyParagraph(interventionRow?.cells[2], data.machine);
  fillEmptyParagraph(interventionRow?.cells[3], data.startedTime);
  fillEmptyParagraph(interventionRow?.cells[4], data.endedTime);
  fillEmptyParagraph(interventionRow?.cells[5], data.duration);

  const partsRows = findCell('Désignation')?.closest('table')
    ? [...findCell('Désignation').closest('table').querySelectorAll('tr')].slice(2)
    : [];
  partsRows.forEach((row, index) => {
    const part = data.parts[index];
    if (!part) return;
    fillEmptyParagraph(row.cells[0], part.designation);
    fillEmptyParagraph(row.cells[1], part.reference);
    fillEmptyParagraph(row.cells[2], part.quantity);
  });

  const maintenanceCell = cells().find(cell =>
    /^maintenance pr[ée]ventive\s*$/i.test(normalise(cell.textContent))
    && /compte rendu/i.test(normalise(cell.closest('table')?.textContent))
  );
  const maintenanceNode = maintenanceCell && [...maintenanceCell.querySelectorAll('font, p, li')].reverse()
    .find(node => /maintenance pr[ée]ventive/i.test(node.textContent || ''));
  if (!maintenanceNode) throw new Error('Template field not found: Maintenance préventive');
  maintenanceNode.appendChild(doc.createTextNode(data.cycle));

  const signatureRow = findCell('Prestataire')?.closest('tr')?.nextElementSibling;
  if (!signatureRow?.cells[0] || !signatureRow?.cells[1]) throw new Error('Template signature fields not found');
  [signatureRow.cells[0], signatureRow.cells[1]].forEach(cell => {
    const dateParagraph = [...cell.querySelectorAll('p')].find(node => /date/i.test(node.textContent || ''));
    if (dateParagraph) dateParagraph.appendChild(doc.createTextNode(` ${data.date}`));
  });

  for (const image of doc.querySelectorAll('img[src]')) {
    const imageResponse = await fetch(new URL(image.getAttribute('src'), TEMPLATE_BASE));
    if (!imageResponse.ok) continue;
    const blob = await imageResponse.blob();
    image.src = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

export async function printPmDocument(task, technicianName) {
  const data = documentData(task, technicianName);
  const templateHtml = await loadTemplateDocument(data);
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) throw new Error('Please allow pop-ups to print the document');
  printWindow.document.write(templateHtml);
  printWindow.document.close();
  printWindow.focus();
  printWindow.addEventListener('load', () => printWindow.print(), { once: true });
}

export function printChecklist(task, technicianName) {
  const data = documentData(task, technicianName);
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) throw new Error('Please allow pop-ups to print the checklist');
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Checklist PM ${escapeHtml(data.machine)}</title>
    <style>@page{size:A4;margin:16mm}body{font-family:Arial,sans-serif;font-size:11pt}h1{text-align:center;font-size:16pt}
    table{width:100%;border-collapse:collapse}td{border:1px solid #222;padding:9px}.label{font-weight:bold;width:42%}</style></head><body>
    <h1>Rapport de maintenance préventive régulière</h1><table>
    <tr><td class="label">Numéro de série du CTX</td><td>${escapeHtml(data.machine)}</td></tr>
    <tr><td class="label">Adresse du CTX</td><td>${escapeHtml(data.line)}</td></tr>
    <tr><td class="label">Nom du ou des techniciens de maintenance</td><td>${escapeHtml(data.technician)}</td></tr>
    <tr><td class="label">Date de début de la MP</td><td>${escapeHtml(data.startedAt)}</td></tr>
    <tr><td class="label">Date de fin de la MP</td><td>${escapeHtml(data.endedAt)}</td></tr></table>
    </body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.addEventListener('load', () => printWindow.print(), { once: true });
}
