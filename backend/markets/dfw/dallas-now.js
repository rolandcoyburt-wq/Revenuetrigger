import { DFW_SOURCES } from './sources.js';
import {
  cleanText,
  makeNormalizedRecord,
  makeParticipant,
  normalizeAddress,
  parseDate,
  parseMoney,
} from './normalize.js';

const BASE = 'https://aca-prod.accela.com/DALLASTX';
const REQUIRED_HEADERS = Object.freeze([
  'Record Type',
  'Record ID',
  'DallasNow Link',
  'Record Status',
  'Opened Date',
  'Issued Date',
  'Description of Work',
  'Valuation',
  'Applicant Name',
  'Applicant Business Name',
  'Record Address',
]);

const REPORTS = Object.freeze({
  issued: Object.freeze({ id: '8279', label: 'Building Issued', sourceKey: 'dallas_dallasnow_building_issued' }),
  submitted: Object.freeze({ id: '8280', label: 'Building Submitted', sourceKey: 'dallas_dallasnow_building_submitted' }),
});

function decodeXml(value = '') {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#([0-9]+);/g, (_, x) => String.fromCodePoint(parseInt(x, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripHtml(value = '') {
  return decodeXml(String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function parseAttributes(tag = '') {
  const out = {};
  for (const m of String(tag).matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) out[m[1]] = decodeXml(m[3]);
  return out;
}

function splitSetCookie(value = '') {
  if (!value) return [];
  return String(value).split(/,(?=\s*[^;,=\s]+=[^;,]*)/).map((x) => x.trim()).filter(Boolean);
}

class CookieJar {
  constructor() { this.cookies = new Map(); }
  absorb(response) {
    let values = [];
    try {
      if (typeof response?.headers?.getSetCookie === 'function') values = response.headers.getSetCookie();
    } catch {}
    if (!values.length) values = splitSetCookie(response?.headers?.get?.('set-cookie') || '');
    for (const raw of values) {
      const first = String(raw).split(';')[0];
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

function parameterUrl(reportId) {
  return `${BASE}/Report/ReportParameter.aspx?module=Building&reportID=${reportId}&reportType=LINK_REPORT_LIST`;
}

function showReportUrl(reportId) {
  return `${BASE}/Report/ShowReport.aspx?module=Building&reportID=${reportId}&reportType=LINK_REPORT_LIST`;
}

function parseReportForm(html) {
  const form = String(html).match(/<form\b[\s\S]*?<\/form>/i)?.[0];
  if (!form) throw new Error('DallasNow report parameter form missing');

  const hidden = {};
  for (const m of form.matchAll(/<input\b[^>]*>/gi)) {
    const attrs = parseAttributes(m[0]);
    if (String(attrs.type || '').toLowerCase() === 'hidden' && attrs.name) hidden[attrs.name] = attrs.value || '';
  }

  for (const required of ['ACA_CS_FIELD', '__VIEWSTATE', '__VIEWSTATEGENERATOR']) {
    if (!hidden[required]) throw new Error(`DallasNow required ASP.NET state missing: ${required}`);
  }

  const labels = {};
  for (const m of form.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)) {
    const attrs = parseAttributes(m[0]);
    const text = stripHtml(m[0]).replace(/:$/, '').trim().toLowerCase();
    if (attrs.for && text) labels[text] = attrs.for;
  }

  const controls = [...form.matchAll(/<(?:input|select)\b[^>]*>/gi)].map(m => parseAttributes(m[0]));
  const resolve = label => {
    const matches = controls.filter(control => control.id === labels[label]);
    if (!labels[label] || matches.length !== 1 || !matches[0].name) {
      throw new Error(`DallasNow report control missing or ambiguous: ${label}`);
    }
    return matches[0].name;
  };
  const start = resolve('start date');
  const end = resolve('end date');
  const district = resolve('council district');
  const districtSelect = [...form.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi)]
    .find(m => parseAttributes(m[0].match(/^<select\b[^>]*>/i)[0]).id === labels['council district'])?.[0] || '';
  if (!/value=["']ALL["']/i.test(districtSelect)) throw new Error('DallasNow Council District ALL option missing');

  return { hidden, controls: { start, end, district } };
}

function formatDallasDate(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('month')}/${get('day')}/${get('year')}`;
}

function rollingWindow(days, now = Date.now()) {
  const endText = formatDallasDate(now);
  const [month, day, year] = endText.split('/').map(Number);
  const endUtc = Date.UTC(year, month - 1, day, 12);
  const startUtc = endUtc - (Math.max(1, Number(days) || 7) - 1) * 86_400_000;
  return { startDate: formatDallasDate(startUtc), endDate: endText };
}

function normalizeHeader(value) {
  return cleanText(value)?.replace(/\s+/g, ' ') || null;
}

function columnIndex(ref = '') {
  const letters = String(ref).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || '';
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function findEndOfCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error('DallasNow XLSX ZIP directory not found');
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('Deflate decompression is unavailable');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error('DallasNow report payload is not a genuine XLSX ZIP');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(bytes);
  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const directorySize = view.getUint32(eocd + 12, true);
  if (eocd + 22 + view.getUint16(eocd + 20, true) !== bytes.length ||
      view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true) ||
      count !== view.getUint16(eocd + 8, true) || !count ||
      directoryOffset + directorySize !== eocd) throw new Error('DallasNow XLSX ZIP directory is incomplete');
  const decoder = new TextDecoder();
  const entries = new Map();
  let pos = directoryOffset;

  for (let i = 0; i < count; i++) {
    if (pos + 46 > eocd) throw new Error('DallasNow XLSX central directory is truncated');
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error('DallasNow XLSX central directory is malformed');
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    if (pos + 46 + nameLength + extraLength + commentLength > eocd || localOffset + 30 > directoryOffset ||
        view.getUint16(pos + 8, true) & 1) throw new Error('DallasNow XLSX ZIP entry is malformed');
    const expectedSize = view.getUint32(pos + 24, true);
    const expectedCRC = view.getUint32(pos + 16, true);
    const name = decoder.decode(bytes.slice(pos + 46, pos + 46 + nameLength));

    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('DallasNow XLSX local ZIP header is malformed');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > directoryOffset ||
        decoder.decode(bytes.slice(localOffset + 30, localOffset + 30 + localNameLength)) !== name ||
        view.getUint16(localOffset + 8, true) !== method || entries.has(name)) {
      throw new Error('DallasNow XLSX ZIP entry is incomplete or inconsistent');
    }
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);

    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = await inflateRaw(compressed);
    else throw new Error(`DallasNow XLSX uses unsupported ZIP compression method ${method}`);

    if (data.length !== expectedSize || crc32(data) !== expectedCRC) throw new Error('DallasNow XLSX ZIP integrity check failed');
    entries.set(name, data);
    pos += 46 + nameLength + extraLength + commentLength;
  }
  if (pos !== eocd) throw new Error('DallasNow XLSX ZIP directory length mismatch');
  return entries;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Validate the entire XML document before extracting rows; regex extraction alone
// silently ignores an unfinished row and can turn a truncated report into success.
function validateXml(xml, root) {
  const stack = [];
  let offset = 0, roots = 0;
  const tokens = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<\/?[A-Za-z_][\w:.-]*(?:\s+(?:[^<>"']|"[^"<>]*"|'[^'<>]*')*)?\s*\/?>/g;
  for (const match of xml.matchAll(tokens)) {
    const text = xml.slice(offset, match.index);
    if (text.includes('<') || (!stack.length && text.trim())) throw new Error('DallasNow malformed worksheet/XML content');
    offset = match.index + match[0].length;
    const tag = match[0];
    if (tag.startsWith('<?') || tag.startsWith('<!--')) continue;
    const name = tag.match(/^<\/?([\w:.-]+)/)[1];
    if (tag.startsWith('</')) {
      if (stack.pop() !== name) throw new Error('DallasNow mismatched worksheet/XML content');
    } else {
      if (!stack.length && (++roots !== 1 || name !== root)) throw new Error('DallasNow unexpected XML root');
      if (!tag.endsWith('/>')) stack.push(name);
    }
  }
  if (stack.length || roots !== 1 || xml.slice(offset).trim()) throw new Error('DallasNow truncated worksheet/XML content');
}

function xmlTextFromInlineString(cellXml) {
  const parts = [];
  for (const m of String(cellXml).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)) parts.push(decodeXml(m[1]));
  return parts.join('');
}

function parseRelationships(xml = '') {
  const byId = new Map();
  for (const m of String(xml).matchAll(/<Relationship\b[^>]*>/gi)) {
    const attrs = parseAttributes(m[0]);
    if (attrs.Id && attrs.Target) byId.set(attrs.Id, attrs.Target);
  }
  return byId;
}

function parseHyperlinks(sheetXml = '', relationships = new Map()) {
  const byCell = new Map();
  for (const m of String(sheetXml).matchAll(/<hyperlink\b[^>]*>/gi)) {
    const attrs = parseAttributes(m[0]);
    const rel = attrs['r:id'];
    if (attrs.ref && rel && relationships.has(rel)) byCell.set(attrs.ref, relationships.get(rel));
  }
  return byCell;
}

function parseRows(sheetXml, sharedStrings = [], hyperlinks = new Map()) {
  const rows = [];
  for (const rowMatch of String(sheetXml).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const cells = new Map();
    for (const cellMatch of rowMatch[1].matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/gi)) {
      const cellXml = cellMatch[0];
      const openTag = cellXml.match(/^<c\b[^>]*>/i)?.[0] || cellXml;
      const attrs = parseAttributes(openTag);
      const ref = attrs.r;
      if (!ref) continue;
      let value = '';
      if (attrs.t === 'inlineStr') value = xmlTextFromInlineString(cellXml);
      else {
        const raw = cellXml.match(/<v>([\s\S]*?)<\/v>/i)?.[1] ?? '';
        if (attrs.t === 's') value = sharedStrings[Number(raw)] ?? '';
        else value = decodeXml(raw);
      }
      cells.set(columnIndex(ref), { ref, value: cleanText(value), url: hyperlinks.get(ref) || null });
    }
    rows.push(cells);
  }
  return rows;
}

function parseSharedStrings(xml = '') {
  const out = [];
  for (const m of String(xml).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) out.push(xmlTextFromInlineString(m[1]));
  return out;
}

export async function parseDallasNowXlsx(arrayBuffer) {
  const entries = await unzipEntries(arrayBuffer);
  const sheetBytes = entries.get('xl/worksheets/sheet1.xml');
  if (!sheetBytes) throw new Error('DallasNow XLSX worksheet missing');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const sheetXml = decoder.decode(sheetBytes);
  for (const [path, root] of [['[Content_Types].xml', 'Types'], ['xl/workbook.xml', 'workbook'], ['xl/_rels/workbook.xml.rels', 'Relationships']]) {
    if (!entries.has(path)) throw new Error(`DallasNow XLSX required workbook content missing: ${path}`);
    validateXml(decoder.decode(entries.get(path)), root);
  }
  const workbookXml = decoder.decode(entries.get('xl/workbook.xml'));
  const workbookRelationships = parseRelationships(decoder.decode(entries.get('xl/_rels/workbook.xml.rels')));
  const sheetDeclared = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].some(m => {
    const target = workbookRelationships.get(parseAttributes(m[0])['r:id']);
    return target && new URL(target, 'https://xlsx.invalid/xl/workbook.xml').href === 'https://xlsx.invalid/xl/worksheets/sheet1.xml';
  });
  if (!sheetDeclared) throw new Error('DallasNow XLSX worksheet relationship missing');
  validateXml(sheetXml, 'worksheet');
  if (!/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/.test(sheetXml)) throw new Error('DallasNow worksheet sheetData missing');
  for (const [path, root] of [['xl/sharedStrings.xml', 'sst'], ['xl/worksheets/_rels/sheet1.xml.rels', 'Relationships']]) {
    if (entries.has(path)) validateXml(decoder.decode(entries.get(path)), root);
  }
  const sharedStrings = entries.has('xl/sharedStrings.xml') ? parseSharedStrings(decoder.decode(entries.get('xl/sharedStrings.xml'))) : [];
  const relationships = entries.has('xl/worksheets/_rels/sheet1.xml.rels')
    ? parseRelationships(decoder.decode(entries.get('xl/worksheets/_rels/sheet1.xml.rels')))
    : new Map();
  const hyperlinks = parseHyperlinks(sheetXml, relationships);
  const rows = parseRows(sheetXml, sharedStrings, hyperlinks);

  let headerRowIndex = -1;
  let headerByColumn = new Map();
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const candidate = new Map();
    for (const [col, cell] of rows[i]) {
      const h = normalizeHeader(cell.value);
      if (h) candidate.set(col, h);
    }
    const values = new Set(candidate.values());
    if (REQUIRED_HEADERS.every((h) => values.has(h))) {
      headerRowIndex = i;
      headerByColumn = candidate;
      break;
    }
  }
  if (headerRowIndex < 0) throw new Error('DallasNow required XLSX headers disappeared');

  const headers = [...new Set([...headerByColumn.values()])];
  for (const required of REQUIRED_HEADERS) {
    if (!headers.includes(required)) throw new Error(`DallasNow required XLSX header missing: ${required}`);
  }

  const data = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const sourceRow = rows[i];
    const row = {};
    let sourceUrl = null;
    for (const [col, header] of headerByColumn) {
      const cell = sourceRow.get(col);
      row[header] = cell?.value ?? null;
      if (header === 'DallasNow Link' && cell?.url) sourceUrl = cell.url;
    }
    if (!cleanText(row['Record ID'])) continue;
    row._DallasNowURL = sourceUrl;
    data.push(row);
  }
  return { headers, rows: data, headerRowIndex };
}

async function fetchReport(report, { startDate, endDate, fetchFn = fetch } = {}) {
  const jar = new CookieJar();
  const url = parameterUrl(report.id);
  const get = await fetchFn(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
  if (get.status >= 300 && get.status < 400) throw new Error(`DallasNow ${report.label} unexpected redirect (${get.status}); report aborted`);
  jar.absorb(get);
  if (!get.ok) throw new Error(`DallasNow ${report.label} parameter GET failed: ${get.status}`);
  const html = await get.text();
  const { hidden, controls } = parseReportForm(html);

  const body = new URLSearchParams(hidden);
  body.set(controls.start, startDate);
  body.set(controls.end, endDate);
  body.set(controls.district, 'ALL');
  body.set('__EVENTTARGET', 'btnSave');
  body.set('__EVENTARGUMENT', '');

  const post = await fetchFn(url, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://aca-prod.accela.com',
      referer: url,
      ...(jar.header() ? { cookie: jar.header() } : {}),
    },
    body: body.toString(),
  });
  if (post.status >= 300 && post.status < 400) throw new Error(`DallasNow ${report.label} unexpected redirect (${post.status}); report aborted`);
  jar.absorb(post);
  if (!post.ok) throw new Error(`DallasNow ${report.label} parameter POST failed: ${post.status}`);
  const postHtml = await post.text();
  if (!new RegExp(`ShowReport\\.aspx[^"'<>]*reportID=${report.id}`, 'i').test(postHtml)) {
    throw new Error(`DallasNow ${report.label} generation did not produce ShowReport`);
  }

  const reportUrl = showReportUrl(report.id);
  const xlsx = await fetchFn(reportUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
      referer: url,
      ...(jar.header() ? { cookie: jar.header() } : {}),
    },
  });
  if (xlsx.status >= 300 && xlsx.status < 400) throw new Error(`DallasNow ${report.label} unexpected redirect (${xlsx.status}); report aborted`);
  jar.absorb(xlsx);
  if (!xlsx.ok) throw new Error(`DallasNow ${report.label} XLSX GET failed: ${xlsx.status}`);
  const contentType = String(xlsx.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) {
    throw new Error(`DallasNow ${report.label} returned unexpected content type: ${contentType || 'missing'}`);
  }
  const arrayBuffer = await xlsx.arrayBuffer();
  const parsed = await parseDallasNowXlsx(arrayBuffer);
  return { ...parsed, report, startDate, endDate };
}

function parseDallasAddress(value) {
  if (value === null || value === undefined) return normalizeAddress({ city: 'Dallas', state: 'TX' });
  const raw = String(value).trim();
  if (!raw) return normalizeAddress({ city: 'Dallas', state: 'TX' });
  if (/^(?:Dallas[ ,]*)?(?:TX|Texas)?(?:\s+\d{5}(?:-\d{4})?)?$/i.test(raw)) return normalizeAddress({ city: 'Dallas', state: 'TX' });
  const compact = raw.replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').trim();
  const m = compact.match(/^(.*?)(?:(?:,\s*)|(?:\s+))Dallas,?\s*TX\s*(\d{5}(?:-\d{4})?)?$/i);
  if (m) return normalizeAddress({ full: m[1].replace(/,\s*$/,''), city: 'Dallas', state: 'TX', zip: m[2] });
  return normalizeAddress({ full: compact, city: 'Dallas', state: 'TX' });
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function identityText(value) {
  return (cleanText(value) || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function dallasDate(value, field, { required, now }) {
  const text = cleanText(value);
  if (!text && !required) return null;
  // Dallas reports use calendar dates. Reject Date.parse rollover and missing
  // required dates rather than letting leadFrom supply a current timestamp.
  const match = text?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?)?$/i);
  const parsed = match ? parseDate(`${match[1]}/${match[2]}/${match[3]}`, { now, maxFutureDays: 2 }) : null;
  const date = parsed ? new Date(parsed) : null;
  if (!date || date.getUTCFullYear() !== Number(match[3]) || date.getUTCMonth() + 1 !== Number(match[1]) || date.getUTCDate() !== Number(match[2])) {
    throw new Error(`DallasNow invalid required source date: ${field}`);
  }
  return parsed;
}

export function normalizeDallasNowRow(row, { observation, now = Date.now() } = {}) {
  if (!['submitted', 'issued'].includes(observation)) throw new Error('Dallas observation must be submitted or issued');
  const recordId = cleanText(row['Record ID']);
  if (!recordId) throw new Error('DallasNow Record ID missing');
  const openedDate = dallasDate(row['Opened Date'], 'Opened Date', { required: true, now });
  const issuedDate = dallasDate(row['Issued Date'], 'Issued Date', { required: observation === 'issued', now });
  const rawStatus = cleanText(row['Record Status']);
  const status = rawStatus || (observation === 'submitted' ? 'Submitted' : 'Issued');
  const applicantName = cleanText(row['Applicant Name']);
  const applicantBusiness = cleanText(row['Applicant Business Name']);
  const address = parseDallasAddress(row['Record Address']);
  const workDescription = cleanText(row['Description of Work']);
  const dallasNowLink = cleanText(row['DallasNow Link']);
  const sourceUrl = cleanText(row._DallasNowURL);
  const fingerprintBasis = [
    identityText(address.display),
    identityText(workDescription),
    identityText(applicantName),
    openedDate || '',
  ].join('|');

  const normalized = makeNormalizedRecord({
    market: 'Dallas',
    jurisdiction: 'City of Dallas',
    sourceKey: DFW_SOURCES.dallasNow.key,
    sourceRecordId: recordId,
    permitNumber: recordId,
    recordType: row['Record Type'],
    statusRaw: status,
    fileDate: openedDate,
    statusDate: issuedDate,
    eventDate: observation === 'issued' ? issuedDate : openedDate,
    address,
    projectName: null,
    workDescription,
    useType: row['Existing Land Use'],
    specificUse: row['Proposed Land Use'],
    valuation: parseMoney(row['Valuation']),
    participants: [
      makeParticipant('applicant_contact', applicantName, { sourceField: 'Applicant Name' }),
      makeParticipant('applicant', applicantBusiness, { sourceField: 'Applicant Business Name', participantType: 'business' }),
    ],
    sourceUrl,
    lineage: {
      sourceRecordId: 'Record ID',
      dallasNowLink: 'DallasNow Link',
      recordType: 'Record Type',
      status: 'Record Status/report lifecycle',
      fileDate: 'Opened Date',
      statusDate: 'Issued Date',
      workDescription: 'Description of Work',
      useType: 'Existing Land Use',
      specificUse: 'Proposed Land Use',
      valuation: 'Valuation',
      applicant: 'Applicant Name',
      applicantBusiness: 'Applicant Business Name',
      address: 'Record Address',
      parcelNumber: 'Parcel Number',
      councilDistrict: 'Council District',
    },
    raw: row,
  });

  return {
    ...normalized,
    companyCandidate: applicantBusiness || null,
    dallasNowLink,
    parcelNumber: cleanText(row['Parcel Number']),
    councilDistrict: cleanText(row['Council District']),
    temporaryId: /TMP-/i.test(recordId),
    secondaryFingerprint: `dallas-v1:${fnv1a(fingerprintBasis)}`,
    identityHints: {
      dallasNowLink,
      address: address.display,
      description: workDescription,
      applicant: applicantName,
      openedDate,
    },
    sourceObservations: [{
      report: observation,
      reportId: REPORTS[observation].id,
      recordId,
      dallasNowLink,
      sourceUrl,
      status: rawStatus,
      openedDate,
      issuedDate,
      retrievedAt: normalized.retrievedAt,
    }],
  };
}

export function mergeDallasObservations(submitted = [], issued = []) {
  const merged = new Map();
  for (const record of submitted) merged.set(record.sourceRecordId, record);
  let exactOverlapCount = 0;

  for (const issuedRecord of issued) {
    const existing = merged.get(issuedRecord.sourceRecordId);
    if (!existing) {
      merged.set(issuedRecord.sourceRecordId, issuedRecord);
      continue;
    }
    exactOverlapCount++;
    merged.set(issuedRecord.sourceRecordId, {
      ...issuedRecord,
      sourceObservations: [...(existing.sourceObservations || []), ...(issuedRecord.sourceObservations || [])],
    });
  }

  const rows = [...merged.values()].sort((a, b) => new Date(b.eventDate || 0) - new Date(a.eventDate || 0));
  const temporaryIdCount = rows.filter((r) => r.temporaryId).length;
  Object.defineProperty(rows, '_meta', {
    value: {
      submittedCount: submitted.length,
      issuedCount: issued.length,
      exactOverlapCount,
      mergedCount: rows.length,
      temporaryIdCount,
    },
    enumerable: false,
  });
  return rows;
}

export async function fetchDallasNowBuildingRecords({
  days = 7,
  fetchFn = fetch,
  now = Date.now(),
} = {}) {
  const { startDate, endDate } = rollingWindow(days, now);
  const [submittedReport, issuedReport] = await Promise.all([
    fetchReport(REPORTS.submitted, { startDate, endDate, fetchFn }),
    fetchReport(REPORTS.issued, { startDate, endDate, fetchFn }),
  ]);
  const submitted = submittedReport.rows.map((row) => normalizeDallasNowRow(row, { observation: 'submitted', now }));
  const issued = issuedReport.rows.map((row) => normalizeDallasNowRow(row, { observation: 'issued', now }));
  const merged = mergeDallasObservations(submitted, issued);
  Object.defineProperty(merged, '_reports', {
    value: {
      startDate,
      endDate,
      submitted: { count: submitted.length, headers: submittedReport.headers },
      issued: { count: issued.length, headers: issuedReport.headers },
    },
    enumerable: false,
  });
  return merged;
}

export const DALLAS_REQUIRED_HEADERS = REQUIRED_HEADERS;
export const DALLAS_REPORTS = REPORTS;
