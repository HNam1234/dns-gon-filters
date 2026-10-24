import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function renderPrivateModule(template, endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || !/^\/[A-Za-z0-9_-]{40,64}$/.test(url.pathname) || url.search || url.hash) throw Error('invalid-private-endpoint');
  let output = template.replace(/^#!arguments=.*\r?\n/m, '');
  output = output.replace('argument="worker_url={{{worker_url}}}"', 'argument="worker_url=' + url.href + '"');
  if (/\{\{\{|REPLACE-WITH|\$token/.test(output) || !output.includes('worker_url=' + endpoint)) throw Error('unresolved-module-placeholder');
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const secret = new URL('../secrets/youtube-worker-auth-token.txt', import.meta.url);
  const target = new URL('../secrets/DNSGon-YouTubeApp-PrivateWorker.local.sgmodule', import.meta.url);
  const template = await readFile(new URL('../shadowrocket/DNSGon-YouTubeApp-PrivateWorker.template.sgmodule', import.meta.url), 'utf8');
  const token = (await readFile(secret, 'utf8')).trim();
  const endpoint = 'https://dnsgon-youtube-ump.myfavblueone.workers.dev/' + token;
  const output = renderPrivateModule(template, endpoint);
  try { await copyFile(target, new URL('../secrets/DNSGon-YouTubeApp-PrivateWorker.before-v03.sgmodule', import.meta.url), 1); } catch (e) { if (e.code !== 'EEXIST' && e.code !== 'ENOENT') throw e; }
  await writeFile(target, output);
  console.log('Private module rendered; token verified and kept local.');
}
