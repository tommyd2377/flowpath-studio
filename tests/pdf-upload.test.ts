import test from 'node:test';
import assert from 'node:assert/strict';
import { readUpload } from '../lib/file-validation';
import { extractSource } from '../lib/source-extractors';

const megabyte = 1024 * 1024;
function request(bytes: Buffer, mime = 'application/pdf') {
  return new Request('http://127.0.0.1/upload', { method: 'POST', headers: {
    'content-type': mime, 'x-site-revision': '1', 'x-file-name': 'size-fixture.pdf',
    // The server must enforce bytes received even when the declared length lies.
    'content-length': '1',
  }, body: new Uint8Array(bytes) });
}

test('PDF upload accepts exactly 10 MiB and rejects one byte more', async () => {
  const bytes = Buffer.alloc(10 * megabyte, 32); bytes.write('%PDF-1.4\n');
  const { file } = await readUpload(request(bytes));
  assert.equal(file.size, bytes.length);
  assert.equal(file.kind, 'pdf');
  const oversized = Buffer.concat([bytes, Buffer.from(' ')]);
  await assert.rejects(() => readUpload(request(oversized)), { status: 413 });
  await assert.rejects(() => extractSource('size-fixture.pdf', 'application/pdf', oversized), /upload size limit/);
});

test('PDF size increase retains content validation and other source limits', async () => {
  await assert.rejects(() => readUpload(request(Buffer.alloc(3 * megabyte, 32))), /Use PNG/);
  for (const mime of ['text/html', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']) {
    await assert.rejects(() => readUpload(request(Buffer.alloc(2 * megabyte + 1, 32), mime)), { status: 413 });
  }
  await assert.rejects(() => readUpload(request(Buffer.alloc(256 * 1024 + 1, 32), 'text/csv')), /256 KB/);
});
