import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const load=name=>readFile(new URL(`../shadowrocket/${name}`,import.meta.url),'utf8');
test('published body replacements remain intact when parsed as whitespace-separated fields',async()=>{
 const module=await load('DNSGon-AdsOnly.sgmodule');
 const lines=module.split('\n').filter(line=>line.startsWith('http-response '));
 for(const line of lines) assert.equal(line.split(/\s+/).length,4,'unquoted body replacement split into additional rule fields');
 const line=lines.find(x=>x.includes('<style>')),parts=line.split(/\s+/);
 const html='<head><title>Fixture</title></head><body><video id="player" controls></video><a href="/next">Next</a></body>';
 const changed=html.replace(new RegExp(parts[2]),parts[3]);
 assert.ok(changed.includes('.ad-place,[class*="ads--"]{display:none!important'));
 assert.ok(changed.includes('<video id="player" controls>'));
 assert.ok(changed.includes('href="/next"'));
});
test('native YouTube community adapter scopes scripts and interception to native API hosts',async()=>{
 const module=await load('DNSGon-YouTubeApp-Community.sgmodule');
 const scriptLines=module.split('\n').filter(x=>x.includes(' = type=http-'));
 assert.equal(scriptLines.length,2);
 for(const line of scriptLines) {
  const pattern=new RegExp(/pattern=([^,]+)/.exec(line)[1]);
  for(const host of ['youtubei.googleapis.com','youtubei-att.googleapis.com','youtube.com','www.youtube.com','m.youtube.com','music.youtube.com']) assert.ok(pattern.test(`https://${host}/youtubei/v1/player`));
  for(const url of ['https://youtubei.googleapis.com.example.test/youtubei/v1/player','https://accounts.google.com/','https://rr1.googlevideo.com/initplayback?x=1','https://www.youtube.com.evil.test/youtubei/v1/player']) assert.equal(pattern.test(url),false);
  assert.ok(line.includes('/3fbf89da6615d2dfdd34fd0f3ffbd2edd3aa80c1/'));
  assert.ok(line.includes('log_enabled=false&capture_raw=false'));
  assert.ok(line.includes('requires-body=1,binary-body-mode=1,engine=webview'));
 }
  assert.ok(module.includes('hostname = %APPEND% youtubei.googleapis.com, youtubei-att.googleapis.com, youtube.com, www.youtube.com, m.youtube.com, music.youtube.com'));
 assert.equal(/ca-p12|ca-passphrase|\[Proxy\]|hostname\s*=\s*\*|skip-server-cert-verify/.test(module),false);
});
