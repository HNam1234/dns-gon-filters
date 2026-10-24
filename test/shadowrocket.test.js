import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const parse = text => text.split('\n').filter(x=>x && !x.startsWith('#')).map(x=>{
  assert.match(x,/^DOMAIN-SUFFIX,[a-z0-9.-]+$/);
  return x.slice('DOMAIN-SUFFIX,'.length);
});
const block=parse(await readFile(new URL('../data/shadowrocket-ads.list',import.meta.url),'utf8'));
const allow=parse(await readFile(new URL('../data/shadowrocket-allow.list',import.meta.url),'utf8'));
const match=(host,list)=>list.some(d=>host===d || host.endsWith('.'+d));
const blocked=host=>!match(host,allow)&&match(host,block);
test('mobile rule data blocks known ad infrastructure and retains normal account and shared video hosts',()=>{
  assert.ok(block.length>1000 && block.length<100000);
  assert.equal(blocked('pagead2.googlesyndication.com'),true);
  assert.equal(blocked('securepubads.g.doubleclick.net'),true);
  for(const h of ['apple.com','accounts.google.com','oauth2.googleapis.com','graph.facebook.com','streamvl.online'])
    assert.equal(blocked(h),false,h);
  assert.equal(blocked('pagead2.googlesyndication.com.example.test'),false);
});
