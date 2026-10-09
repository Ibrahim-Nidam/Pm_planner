import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { documentData, fillWordXml, fillChecklistXml, maintenanceCycle } from '../js/pm-documents.js';

function zipText(archive, innerPath) {
  return execFileSync('python', ['-c', `import zipfile,sys; sys.stdout.reconfigure(encoding='utf-8'); print(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode('utf-8'), end='')`, archive, innerPath], {
    encoding: 'utf8'
  });
}

const task = {
  scheduled_date: '2026-10-07',
  started_at: '2026-10-07T21:05:00',
  ended_at: '2026-10-07T23:40:00',
  parts: [
    { designation: 'Belt', reference: 'RF-12', quantity: '1' },
    { designation: 'Filter', reference: 'FL-9', quantity: '2' }
  ],
  machines: { code: 'K279', line: 'L5' }
};

test('document fields use full technician name, week number, and cycle', () => {
  const data = documentData(task, 'Ahmed Benali');
  assert.equal(data.technician, 'Ahmed Benali');
  assert.match(data.requestDate, /^\d{2}\/\d{2}\/2026 S\d+$/);
  assert.equal(data.machine, 'K279');
  assert.equal(data.line, 'L5');
  assert.equal(data.startedTime, '21:05');
  assert.equal(data.endedTime, '23:40');
  assert.equal(data.duration, '2 h 35 min');
  assert.equal(data.cycle, 'mensuel');
  assert.equal(data.parts[0].designation, 'Belt');
  assert.equal(data.parts[0].reference, 'RF-12');
  assert.equal(data.parts[0].quantity, '1');
});

test('maintenance cycle follows 2-1-2-1 months from January 2026', () => {
  assert.equal(maintenanceCycle('2026-01-15'), 'mensuel');
  assert.equal(maintenanceCycle('2026-02-15'), 'mensuel');
  assert.equal(maintenanceCycle('2026-03-15'), 'trimestrielle');
  assert.equal(maintenanceCycle('2026-06-15'), 'semi annuel');
  assert.equal(maintenanceCycle('2026-09-15'), 'trimestrielle');
  assert.equal(maintenanceCycle('2026-12-15'), 'annuel');
});

test('Word template is filled in the original cells without mixing parts', () => {
  const xml = zipText('docs/PM template.docx', 'word/document.xml');
  const filled = fillWordXml(xml, documentData(task, 'Ahmed Benali'));
  assert.match(filled, /07\/10\/2026 S\d+/);
  assert.match(filled, />K279</);
  assert.match(filled, />21:05</);
  assert.match(filled, />23:40</);
  assert.match(filled, />2 h 35 min</);
  assert.match(filled, />Belt</);
  assert.match(filled, />RF-12</);
  assert.match(filled, />1</);
  assert.match(filled, />Filter</);
  assert.match(filled, />FL-9</);
  assert.match(filled, />2</);
  assert.match(filled, /Maintenance préventive  mensuel</);
  assert.match(filled, /Date\u00a0: 07\/10\/2026</);
  assert.equal((filled.match(/Date\u00a0: 07\/10\/2026</g) || []).length, 2);
});

test('Excel checklist appends values after the original labels', () => {
  const xml = zipText('docs/Cheklist_PM.xlsx', 'xl/sharedStrings.xml');
  const filled = fillChecklistXml(xml, documentData(task, 'Ahmed Benali'));
  assert.match(filled, /Numéro de série du CTX : K279/);
  assert.match(filled, /Adresse du CTX : L5/);
  assert.match(filled, /Période de MP :  mensuel/);
  assert.match(filled, /Nom du ou des techniciens de maintenance : Ahmed Benali/);
  assert.match(filled, /Date de début de la MP : 07\/10\/2026 21:05/);
  assert.match(filled, /Date de fin de la MP : 07\/10\/2026 23:40/);
  assert.doesNotMatch(filled, /Date de fin de la MP : <\/t>/);
});

test('Excel checklist marks period-specific tasks as non-applicable', async () => {
  const { fillChecklistSheetXml } = await import('../js/pm-documents.js');
  const sheetXml = zipText('docs/Cheklist_PM.xlsx', 'xl/worksheets/sheet1.xml');
  const monthly = fillChecklistSheetXml(sheetXml, documentData(task, 'Ahmed Benali'));
  assert.match(monthly, /r="C53"[^>]*t="inlineStr"><is><t>NON<\/t>/);
  assert.match(monthly, /r="C55"[^>]*t="inlineStr"><is><t>NON<\/t>/);
  assert.match(monthly, /r="C84"[^>]*t="inlineStr"><is><t>NON<\/t>/);

  const quarterlyTask = { ...task, scheduled_date: '2026-03-07' };
  const quarterly = fillChecklistSheetXml(sheetXml, documentData(quarterlyTask, 'Ahmed Benali'));
  assert.match(quarterly, /r="C53"[^>]*t="inlineStr"><is><t>OUI<\/t>/);
  assert.match(quarterly, /r="C55"[^>]*t="inlineStr"><is><t>NON<\/t>/);

  const semiAnnualTask = { ...task, scheduled_date: '2026-06-07' };
  const semiAnnual = fillChecklistSheetXml(sheetXml, documentData(semiAnnualTask, 'Ahmed Benali'));
  assert.match(semiAnnual, /r="C53"[^>]*t="inlineStr"><is><t>OUI<\/t>/);
  assert.match(semiAnnual, /r="C55"[^>]*t="inlineStr"><is><t>OUI<\/t>/);
});
