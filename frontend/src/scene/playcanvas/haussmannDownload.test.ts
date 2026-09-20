import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { downloadHaussmann, prepareHaussmann } from './haussmannDownload';

const raw = [Buffer.from(JSON.stringify({ version: 2, count: 2, means: { files: ['means.webp'] } })), Buffer.from('texture-fixture')];
const source = { baseUrl: 'https://room.example/v1/', count: 2, files: raw.map((bytes, i) => ({
  name: i ? 'means.webp' : 'meta.json', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
})) };
function fixture() {
  const saved = new Map<string, Response>();
  const calls: string[] = [];
  const cache = {
    match: async (url: RequestInfo | URL) => saved.get(String(url))?.clone(),
    put: async (url: RequestInfo | URL, response: Response) => { saved.set(String(url), response.clone()); },
    delete: async (url: RequestInfo | URL) => saved.delete(String(url)),
  };
  const request: typeof fetch = async url => {
    calls.push(String(url));
    return new Response(raw[String(url).endsWith('meta.json') ? 0 : 1]);
  };
  return { saved, calls, cache, request };
}

test('Haussmann uses an existing local asset without downloading from the creator', async () => {
  let requests = 0;
  const result = await prepareHaussmann('/room.sog', () => {}, undefined, async (_url, options) => {
    requests++; assert.equal(options?.method, 'HEAD');
    return new Response(null, { headers: { 'content-type': 'application/octet-stream' } });
  });
  assert.equal(result.url, '/room.sog'); assert.equal(requests, 1); result.release();
});

test('missing binaries and SPA HTML fallbacks both trigger the browser download, while server failures do not', async () => {
  for (const status of [404, 410, 200, 503]) {
    const calls: string[] = [];
    await assert.rejects(prepareHaussmann('/room.sog', () => {}, undefined, async url => {
      calls.push(String(url));
      return new Response(null, { status: calls.length === 1 ? status : 503, headers: { 'content-type': 'text/html' } });
    }));
    assert.equal(calls.length, status === 503 ? 1 : 2);
  }
});

test('verified cold download reports real byte progress and reopens entirely from browser cache', async () => {
  const f = fixture(); const progress: number[] = [];
  const result = await downloadHaussmann(v => progress.push(v.loaded), undefined, { source, cache: f.cache, fetch: f.request });
  assert.equal(f.calls.length, 2); assert.equal(f.saved.size, 2);
  assert.equal(result.data?.count, 2); assert.match(result.mapUrl!('means.webp'), /^blob:/);
  assert.ok(progress.every((n, i) => i === 0 || n >= progress[i - 1]));
  assert.equal(progress.at(-1), raw.reduce((n, b) => n + b.length, 0));
  result.release(); assert.throws(() => result.mapUrl!('means.webp'), /unknown file/);
  const cached = await downloadHaussmann(() => {}, undefined, { source, cache: f.cache, fetch: async () => { throw Error('network must not be used'); } });
  assert.equal(cached.data?.count, 2); cached.release();
});

test('corrupt cached data is replaced, but altered network bytes never enter the cache', async () => {
  const f = fixture(); f.saved.set(source.baseUrl + 'means.webp', new Response('corrupt'));
  const result = await downloadHaussmann(() => {}, undefined, { source, cache: f.cache, fetch: f.request });
  result.release(); assert.equal(f.calls.length, 2);
  const other = fixture();
  await assert.rejects(downloadHaussmann(() => {}, undefined, { source, cache: other.cache, fetch: async url =>
    new Response(String(url).endsWith('meta.json') ? raw[0] : Buffer.alloc(raw[1].length)),
  }), /incomplete or changed/);
  assert.equal(other.saved.size, 1, 'only the already-verified metadata may survive a failed transfer');
});

test('aborted downloads stop before the next file and retries reuse completed files', async () => {
  const f = fixture(); const controller = new AbortController();
  await assert.rejects(downloadHaussmann(value => {
    if (value.loaded === raw[0].length && value.message === 'Preparing your apartment…') controller.abort();
  }, controller.signal, { source, cache: f.cache, fetch: f.request }), { name: 'AbortError' });
  assert.equal(f.calls.length, 1); assert.equal(f.saved.size, 1);
  const result = await downloadHaussmann(() => {}, undefined, { source, cache: f.cache, fetch: f.request });
  assert.equal(f.calls.length, 2); result.release();
});

test('unavailable browser storage still permits loading and oversized responses fail closed', async () => {
  const f = fixture();
  const result = await downloadHaussmann(() => {}, undefined, { source, cache: {
    match: async () => { throw Error('storage denied'); }, put: async () => { throw Error('quota'); }, delete: async () => false,
  }, fetch: f.request });
  result.release();
  await assert.rejects(downloadHaussmann(() => {}, undefined, { source, cache: null,
    fetch: async () => new Response(new Uint8Array(2000)),
  }), /files have changed/);
});

// The real creator CDN, CORS, SHA-256 pins and PlayCanvas mapUrl path are also
// exercised in the missing-assets browser run recorded in the Haussmann guide.
