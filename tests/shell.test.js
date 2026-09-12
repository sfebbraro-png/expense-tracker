const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('offline install caches every local script, stylesheet, and manifest loaded by the page', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const assets = vm.runInNewContext(worker + '\nASSETS', { self: { addEventListener() {} } });
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map(match => match[1]).filter(url => /\.(?:js|css|webmanifest)(?:\?|$)/.test(url) && !/^https?:/.test(url));
  for (const url of references) {
    assert.ok(assets.includes('./' + url), `Offline cache is missing ${url}`);
    assert.ok(fs.existsSync(path.join(root, url.split('?')[0])), `Asset is missing: ${url}`);
  }
});
