import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const code = await readFile(new URL('../shadowrocket/youtube-web-ads.js', import.meta.url), 'utf8');
function run(body) {
  let answer, count=0;
  runInNewContext(code, { $response: { body }, $done(value) { answer=value;count++; } }, { timeout: 1000 });
  assert.equal(count,1);
  return JSON.parse(JSON.stringify(answer));
}
test('YouTube JSON removes ad fields and promoted items, preserving playback and normal account fields',()=>{
  const data={playerAds:[{ad:1}],adPlacements:[{}],adSlots:[{}],streamingData:{formats:[{url:'https://media.example/normal'}]},
    playabilityStatus:{status:'OK'},videoDetails:{videoId:'normal'},account:{premium:false},
    contents:[{videoRenderer:{videoId:'one'}},{adSlotRenderer:{x:1}},{itemSectionRenderer:{contents:[{promotedVideoRenderer:{}},{videoRenderer:{videoId:'two'}}]}}]};
  const output=JSON.parse(run(JSON.stringify(data)).body);
  assert.equal('playerAds' in output,false);assert.equal('adPlacements' in output,false);assert.equal('adSlots' in output,false);
  assert.deepEqual(output.streamingData,data.streamingData);assert.deepEqual(output.account,data.account);
  assert.deepEqual(output.playabilityStatus,data.playabilityStatus);
  assert.equal(output.contents.length,2);assert.equal(output.contents[1].itemSectionRenderer.contents[0].videoRenderer.videoId,'two');
});
test('HTML modifies only initial JSON payloads while retaining page, scripts and controls',()=>{
  const payload={playerAds:[{}],videoDetails:{title:'A } brace and "quote"'},streamingData:{formats:[{url:'normal'}]}};
  const html='<!doctype html><html><head><title>Fixture</title></head><body><button id="next">Next</button><script>var ytInitialPlayerResponse = '+JSON.stringify(payload)+';window["ytInitialData"] = {"contents":[{"videoRenderer":{"id":"normal"}},{"displayAdRenderer":{}}]};</script></body></html>';
  const result=run(html).body;
  assert.ok(result.includes('id="next"'));assert.ok(result.includes('streamingData'));assert.ok(result.includes('videoRenderer'));
  assert.equal(result.includes('playerAds'),false);assert.equal(result.includes('displayAdRenderer'),false);
});
test('unchanged, malformed, oversized and deeply nested responses pass through without breaking the page',()=>{
  for(const body of ['{"ok":true}','not json','{"playerAds":', 'x'.repeat(2097153),'{"x":'+'['.repeat(90)+'0'+']'.repeat(90)+'}'])
    assert.deepEqual(run(body),{});
});
test('script has no external request, persistence, telemetry, account or entitlement mutation',()=>{
  assert.equal(/\$httpClient|\$task|fetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|\$persistentStore|console\./.test(code),false);
  assert.equal(/is_premium|entitlements|subscriptions|premium\s*[:=]|receipt\s*[:=]/.test(code),false);
});
