import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { extractDocxText, extractXlsx, fetchWebsiteText, htmlToText } from '../lib/source-adapters';
import { extractSource } from '../lib/source-extractors';
import { readUpload } from '../lib/file-validation';
import { createHttpOcrProvider } from '../lib/ocr';
import { isPublicAddress, type WebsiteTransport } from '../lib/website-fetch';

function websiteTransport(html = '<p>Fixture</p>'): WebsiteTransport {
  return { resolve: async () => [{ address: '93.184.216.34', family: 4 }], connect: async () => ({ status: 200, contentType: 'text/html', remoteAddress: '93.184.216.34', bytes: Buffer.from(html) }) };
}

test('website DNS, connected destination, redirects and size fail closed without a network', async () => {
  for (const address of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.2', '100.64.1.1', '224.0.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '2002:7f00:1::', '2001:db8::1']) assert.equal(isPublicAddress(address), false, address);
  let connections = 0;
  const privateDns: WebsiteTransport = { resolve: async () => [{ address: '127.0.0.1', family: 4 }], connect: async () => { connections++; throw new Error('Must never connect'); } };
  await assert.rejects(() => fetchWebsiteText('https://example.com', privateDns), /non-public/);
  assert.equal(connections, 0);
  const base = websiteTransport();
  for (const override of [{ remoteAddress: '127.0.0.1' }, { remoteAddress: '93.184.216.35' }, { status: 302 }, { contentType: 'application/json' }, { bytes: new Uint8Array(2 * 1024 * 1024 + 1) }]) {
    await assert.rejects(() => fetchWebsiteText('https://example.com', { ...base, connect: async (...args) => ({ ...await base.connect(...args), ...override }) }));
  }
  await assert.rejects(() => fetchWebsiteText('https://example.com', websiteTransport(`<p>${'A'.repeat(60001)}</p>`)), /60,000/);
  assert.throws(() => createHttpOcrProvider({ endpoint: 'http://ocr.example.test' }), /HTTPS/);
  await assert.rejects(() => createHttpOcrProvider({ endpoint: 'https://ocr.example.test', fetcher: async () => Response.json({ text: 'Partial', complete: false }) }).extract(new Uint8Array([1]), 'image/png'), /incomplete/);
});

function zip(files: Record<string, string>) {
  const entries: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = Buffer.from(name); const data = deflateRawSync(Buffer.from(value));
    const local = Buffer.alloc(30 + nameBytes.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(Buffer.byteLength(value), 22); local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30); entries.push(Buffer.concat([local, data]));
    const record = Buffer.alloc(46 + nameBytes.length); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(8, 10); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(Buffer.byteLength(value), 24); record.writeUInt16LE(nameBytes.length, 28); record.writeUInt32LE(offset, 42); nameBytes.copy(record, 46); central.push(record); offset += local.length + data.length;
    local.writeUInt32LE(crc32(Buffer.from(value)), 14); entries[entries.length - 1].writeUInt32LE(crc32(Buffer.from(value)), 14); record.writeUInt32LE(crc32(Buffer.from(value)), 16);
  }
  const directory = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); return new Uint8Array(Buffer.concat([...entries, directory, end]));
}

test('HTML excludes script content but retains header/footer contact data', () => {
  assert.equal(htmlToText('<html><head><title>Studio</title><script>alert(1)</script></head><body><nav>Menu</nav><h1>Hello</h1><p>World &amp; more</p></body></html>'), 'Title: Studio\n\nMenu\n# Hello\nWorld & more');
});

test('website adapter enforces public HTTPS and bounded mocked fetch', async () => {
  await assert.rejects(() => fetchWebsiteText('http://example.com'), /public HTTPS/);
  await assert.rejects(() => fetchWebsiteText('https://localhost'), /public HTTPS/);
  const result = await fetchWebsiteText('https://example.com/about', websiteTransport('<title>About</title><p>Published copy</p>'));
  assert.equal(result.url, 'https://example.com/about'); assert.match(result.text, /Published copy/);
});

test('website DNS and response stalls share the deadline without retries or a live network', async () => {
  const original = AbortSignal.timeout;
  try {
    for (const stage of ['dns', 'body']) {
      const controller = new AbortController(); AbortSignal.timeout = () => controller.signal;
      let calls = 0; const base = websiteTransport();
      const pending = fetchWebsiteText('https://example.com', {
        resolve: stage === 'dns' ? () => new Promise(() => {}) : base.resolve,
        connect: async () => { calls++; return new Promise(() => {}); },
      });
      await new Promise<void>(resolve => setImmediate(resolve)); controller.abort();
      await assert.rejects(pending, /15 second/);
      assert.equal(calls, stage === 'dns' ? 0 : 1);
    }
  } finally { AbortSignal.timeout = original; }
});

test('DOCX adapter extracts paragraphs from a bounded OOXML package', () => {
  const bytes = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>Second &amp; more</w:t></w:r></w:p></w:body></w:document>' });
  assert.equal(extractDocxText(bytes), 'First\nSecond & more');
});

test('integration: DOCX tracked edits and referenced non-text content fail explicitly instead of losing meaning', () => {
  for (const content of ['<w:del><w:delText>Old address</w:delText></w:del><w:ins><w:t>New address</w:t></w:ins>', '<w:footnoteReference w:id="1"/>', '<w:drawing/>']) {
    assert.throws(() => extractDocxText(zip({ 'word/document.xml': `<w:document><w:p><w:t>Name: Harbor Studio</w:t>${content}</w:p></w:document>` })), /unsupported|partial/i);
  }
});

test('XLSX adapter resolves shared strings and sheet rows', () => {
  const bytes = zip({
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Alpha</t></si><si><t>Offering</t></si></sst>',
    'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="Catalog" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="n"><v>12</v></c></row></sheetData></worksheet>',
  });
  const result = extractXlsx(bytes); assert.deepEqual(result.sheets[0].rows, [['Name', 'Offering'], ['Alpha', '12']]); assert.match(result.text, /\[Sheet: Catalog\]/);
});

test('XLSX provenance retains exact cells, formulas as source text, and merged ranges without evaluating them', async () => {
  const bytes = zip({
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Price</t></si><si><t>Alpha</t></si></sst>',
    'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="Catalog" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><mergeCells><mergeCell ref="A2:A3"/></mergeCells><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><f>SUM(1,2)</f><v>3</v></c></row></sheetData></worksheet>',
  });
  const extracted = extractXlsx(bytes); const cells = extracted.sheets[0].cells;
  assert.equal(cells.find(cell => cell.ref === 'B2')?.value, '=SUM(1,2)');
  assert.equal(cells.find(cell => cell.ref === 'A2')?.mergedRange, 'A2:A3');
  const source = await extractSource('catalog.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
  const provenance = (await import('../lib/source-extractors')).interpretSourceWithProvenance('catalog.xlsx', source)!.provenance;
  assert.ok(provenance.anchors.some(anchor => anchor.cellRange === 'B2' && anchor.formula === 'SUM(1,2)'));
  assert.ok(provenance.anchors.some(anchor => anchor.cellRange === 'A2:A3'));
  const price = provenance.fields.find(field => field.field === 'attributes.price');
  assert.equal(provenance.anchors.find(anchor => anchor.id === price?.anchorIds[0])?.cellRange, 'B2');
});

test('XLSX provenance keeps physical row numbers when blank rows are omitted from the table view', async () => {
  const bytes = zip({
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Price</t></si><si><t>Alpha</t></si></sst>',
    'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="Catalog" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><v>19</v></c></row></sheetData></worksheet>',
  });
  const extracted = extractXlsx(bytes);
  assert.deepEqual(extracted.sheets[0].rowNumbers, [1, 3]);
  const source = await extractSource('sparse.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
  const provenance = (await import('../lib/source-extractors')).interpretSourceWithProvenance('sparse.xlsx', source)!.provenance;
  const price = provenance.fields.find(field => field.field === 'attributes.price');
  assert.equal(provenance.anchors.find(anchor => anchor.id === price?.anchorIds[0])?.cellRange, 'B3');
});

test('OCR is an injectable extraction stage and does not require a live provider in tests', async () => {
  const source = await extractSource('scan.png', 'image/png', new Uint8Array([1, 2, 3]), { ocrProvider: { extract: async () => 'Name: Scanned\nSummary: Read locally' } });
  assert.equal(source.format, 'ocr'); assert.equal(source.text, 'Name: Scanned\nSummary: Read locally');
});

test('managed OCR adapter is bounded, credential-safe, and remains mockable offline', async () => {
  let request: Request | undefined;
  const provider = createHttpOcrProvider({ endpoint: 'https://ocr.example.test/recognize', token: 'test-token', fetcher: async (input, init) => {
    request = new Request(input, init); return Response.json({ text: 'Name: Managed scan', complete: true });
  } });
  assert.equal(await provider.extract(new Uint8Array([1, 2, 3]), 'image/png'), 'Name: Managed scan');
  assert.equal(request?.method, 'POST'); assert.equal(request?.headers.get('authorization'), 'Bearer test-token');
  const payload = await request?.json() as { imageBase64: string; mime: string }; assert.equal(payload.mime, 'image/png'); assert.equal(payload.imageBase64, 'AQID');
  await assert.rejects(() => createHttpOcrProvider({ endpoint: 'https://ocr.example.test/recognize', fetcher: async () => new Response('x'.repeat(251_000), { status: 200 }) }).extract(new Uint8Array([1]), 'image/png'), /oversized/);
});

test('Office uploads pass the existing private file boundary without being sent to chat automatically', async () => {
  const bytes = zip({ 'word/document.xml': '<w:document><w:p><w:r><w:t>Private</w:t></w:r></w:p></w:document>' });
  const result = await readUpload(new Request('http://127.0.0.1/api/upload', { method: 'POST', headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'x-site-revision': '1', 'x-file-name': 'notes.docx',
  }, body: bytes }));
  assert.equal(result.file.kind, 'text'); assert.equal(result.file.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
});

function workbook(sheet: string, extras: Record<string, string> = {}) {
  return zip({ 'xl/workbook.xml': "<workbook><sheets><sheet r:id='r1' name='A &amp; B'/></sheets></workbook>",
    'xl/_rels/workbook.xml.rels': "<Relationships><Relationship Target='worksheets/sheet1.xml' Id='r1'/></Relationships>",
    'xl/worksheets/sheet1.xml': sheet, ...extras });
}
test('XLSX handles reordered attributes, escaped sheet names, rich text and self-closing blank cells exactly', async () => {
  const bytes = workbook("<worksheet><sheetData><row r='1'><c t='inlineStr' r='A1'><is><t>Name</t></is></c><c r='B1' t='inlineStr'><is><t>Price [USD]</t></is></c></row><row r='2'/><row r='3'><c t='inlineStr' r='A3'><is><r><t>Blue </t></r><r><t>Bowl</t></r></is></c><c r='B3'/></row><row r='4'><c r='A4' t='inlineStr'><is><t>White Bowl</t></is></c><c r='B4'><v>42</v></c></row></sheetData></worksheet>");
  const source = await extractSource('rich.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes);
  const parsed = (await import('../lib/source-extractors')).interpretSourceWithProvenance('rich.xlsx', source)!;
  assert.equal(parsed.catalog.entities[0].name, 'Blue Bowl');
  assert.equal(parsed.catalog.entities[0].attributes['price-usd'], null);
  assert.equal(parsed.catalog.entities[1].attributes['price-usd'], 42);
  assert.ok(parsed.provenance.anchors.some(anchor => anchor.sheet === 'A & B' && anchor.cellRange === 'B4'));
});

test('Office corruption, oversized coordinates, missing sheets, merged conflicts and implicit date formats fail closed', () => {
  const bytes = zip({ 'word/document.xml': '<w:document><w:p>Hi</w:p></w:document>' });
  const corrupt = new Uint8Array(bytes); corrupt[corrupt.length - 22 - ('word/document.xml'.length + 46) + 16] ^= 255;
  assert.throws(() => extractDocxText(corrupt), /checksum/);
  assert.throws(() => extractDocxText(zip({ '../word/document.xml': 'bad' })), /unsafe/);
  assert.throws(() => extractDocxText(zip({ 'word/document.xml': '<!DOCTYPE foo><w:document>bad</w:document>' })), /unsupported/);
  assert.throws(() => extractXlsx(workbook('<worksheet><row r="2"><c r="ZZZZZZZZZ2"><v>1</v></c></row></worksheet>')), /locations/);
  assert.throws(() => extractXlsx(workbook('<worksheet><mergeCell ref="A2:B2"/><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c></row></worksheet>')), /merged/);
  assert.throws(() => extractXlsx(workbook('<worksheet><row r="2"><c r="A2" s="1"><v>46000</v></c></row></worksheet>', { 'xl/styles.xml': '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>' })), /ISO date/);
  assert.throws(() => extractXlsx(workbook('<worksheet/>', { 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/missing.xml"/></Relationships>' })), /missing/);
});

test('DOCX hierarchy/table context and multi-sheet XLSX are retained without partial omission', async () => {
  const document = extractDocxText(zip({ 'word/document.xml': '<w:document><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Policies</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p>Age</w:p></w:tc><w:tc><w:p>Condition</w:p></w:tc></w:tr><w:tr><w:tc><w:p>Under 12</w:p></w:tc><w:tc><w:p>Adult required</w:p></w:tc></w:tr></w:tbl></w:document>' }));
  assert.match(document, /## Policies/); assert.match(document, /Under 12\tAdult required/);
  const sheet = (name: string) => `<worksheet><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>${name}</t></is></c></row></worksheet>`;
  const bytes = workbook(sheet('Blue Bowl'), { 'xl/workbook.xml': '<workbook><sheet name="One" r:id="r1"/><sheet r:id="r2" name="Two"/></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>', 'xl/worksheets/sheet2.xml': sheet('Blue Bowl') });
  const parsed = (await import('../lib/source-extractors')).interpretSourceWithProvenance('both.xlsx', await extractSource('both.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes))!;
  assert.equal(parsed.catalog.entities.length, 2, 'same name on two sheets is not proof of identity');
  assert.equal(new Set(parsed.catalog.entities.map(entity => entity.id)).size, 2);
  assert.deepEqual([...new Set(parsed.provenance.anchors.map(anchor => anchor.sheet))], ['One', 'Two']);
});
