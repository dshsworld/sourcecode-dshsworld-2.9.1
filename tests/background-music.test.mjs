import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('starts the attributed donated soundtrack on entering the tour', async () => {
  const html = await readFile(new URL('../public/tour.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../worker/index.ts', import.meta.url), 'utf8');

  assert.match(html, /id="site-version">2\.9\.1<\/dd>/);
  assert.match(html, /id="background-music"[^>]*loop/);
  assert.match(html, /wrtFileMediaPlay\.do\?wrtSn=13073706&amp;fileSn=1/);
  assert.match(html, /id="music-toggle"/);
  assert.match(html, /Fly With Me/);
  assert.match(html, /김성원/);
  assert.match(html, /기증저작물 자유이용/);
  assert.match(html, /wrtSn=13073706/);
  const enterHandler = app.match(/\$\("#enter-button"\)\.addEventListener\("click", \(\) => \{([\s\S]*?)\n  \}\);/)?.[1];
  assert.ok(enterHandler, 'start button still opens the tour');
  assert.match(enterHandler, /backgroundMusic\.start\(\)/);
  assert.match(app, /audio\.loop = true/);
  assert.match(app, /button\.addEventListener\("click", toggle\)/);
  assert.match(app, /if \(audio\.paused\) start\(\)/);
  assert.match(worker, /media-src 'self' https:\/\/gongu\.copyright\.or\.kr/);
});
