// Explicit live verification. Never part of a normal build. Reads secrets only
// from the environment and prints IDs/statuses, never keys, cookies or content.
import { setBrowserOffline } from './lib/browser-offline.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
process.on('uncaughtException', error => { let message=error.message.split('\n')[0];for(const [name,value] of Object.entries(process.env)){if(value && /^(BLOOM_|BLOB_)/.test(name))message=message.replaceAll(value,'[redacted]');}console.error(`LIVE verifier failed (${error.name}): ${message}`); process.exit(1); });
const origin = 'https://bloom-amber-chi.vercel.app';
const key = process.env.BLOOM_READER_KEY;
if (!process.argv.includes('--live') || !key) throw new Error('Explicit --live and secure BLOOM_READER_KEY binding required');
const headers = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const feedResponse = await fetch(`${origin}/api/feed`, {headers,redirect:'error',signal:AbortSignal.timeout(30000)});
console.log(`LIVE authenticated feed HTTP ${feedResponse.status}`);
assert.equal(feedResponse.status,200,'Authenticated production feed must be reachable before creating captures');
const before = await feedResponse.json();assert.equal(before.schema_version,1);
const unauthorized = await fetch(`${origin}/api/feed`, {redirect:'manual'});
assert.equal(unauthorized.status,401);console.log('LIVE unauthenticated feed denied (401)');
const unauthorizedCapture = await fetch(`${origin}/api/capture`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'must not be queued'}),redirect:'manual'});
assert.equal(unauthorizedCapture.status,401);console.log('LIVE unauthenticated capture denied (401)');
if (process.env.BLOOM_WHATSAPP_APP_SECRET) {
 const body=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{field:'messages',value:{messages:[{id:'bloom-disallowed-synthetic-'+Date.now(),from:'15550000000',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Synthetic sender restriction test; must not produce a card.'}}]}}]}]});
 const endpoint=`${origin}/api/webhooks/whatsapp`;
 const denied=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+'0'.repeat(64)},body});assert.equal(denied.status,401);
 const signature='sha256='+createHmac('sha256',process.env.BLOOM_WHATSAPP_APP_SECRET).update(body).digest('hex');
 const signed=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body});assert.equal(signed.status,200);
 console.log('LIVE synthetic webhook: invalid HMAC rejected 401; signed disallowed-sender event acknowledged (check runtime log for zero enqueues; not a real WhatsApp message)');
}
const inputs = ['Explain why retrieval practice and spaced repetition improve long-term learning.', 'https://en.wikipedia.org/wiki/Spacing_effect'];
const existingIds=process.argv.find(arg=>arg.startsWith('--capture-ids='))?.slice(14).split(',');
const captures = existingIds || await Promise.all(inputs.map(async text=>{
 const res=await fetch(`${origin}/api/capture`,{method:'POST',headers,body:JSON.stringify({text}),redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(res.status,202,'Production capture must enqueue');const body=await res.json();assert.match(body.captureId,/^cap-web-/);console.log(`LIVE capture queued ${body.captureId}`);return body.captureId;
}));
const suffixes=captures.map(id=>createHash('sha256').update(id).digest('hex').slice(0,24));
let found=[];const deadline=Date.now()+240000;
while(Date.now()<deadline){
 const res=await fetch(`${origin}/api/feed`,{headers,signal:AbortSignal.timeout(30000)});assert.equal(res.status,200);
 const feed=await res.json();found=feed.cards.filter(c=>suffixes.some(s=>c.id.endsWith(s)));
 if(found.length===captures.length)break;
 await new Promise(r=>setTimeout(r,5000));
}
assert.equal(found.length,captures.length,'Both concurrent captures must appear in authoritative private feed');
console.log(`LIVE generation, validation, private storage and authenticated feed PASS ${JSON.stringify(found.map(c=>c.id))}`);
if(!process.argv.includes('--browser'))process.exit(0);
const require=createRequire(process.env.BLOOM_BROWSER_PACKAGES ? `${process.env.BLOOM_BROWSER_PACKAGES}/package.json` : import.meta.url);
const {chromium}=require('playwright-core');
let launch={headless:true};
if(process.argv.includes('--serverless-browser')){const binary=require('@sparticuz/chromium');launch={...launch,args:binary.args,executablePath:await binary.executablePath()};}
else launch.executablePath=process.env.BLOOM_CHROMIUM_PATH || '/usr/bin/chromium';
const browser=await chromium.launch(launch);
try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 const page=await context.newPage();const errors=[];page.on('pageerror',()=>errors.push('pageerror'));
 await page.goto(origin,{waitUntil:'domcontentloaded',timeout:60000});
 console.log(`LIVE browser opened production shell; reader gate count ${await page.locator('#reader-key-input').count()}`);
 await page.locator('#reader-key-input').fill(key);await page.locator('#reader-key-form button').click();
 for(const card of found) await page.getByText(card.title,{exact:true}).first().waitFor();
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();
 for(const card of found) await page.getByText(card.title,{exact:true}).first().waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal overflow at phone width');
 console.log(`LIVE browser renders captured card IDs ${JSON.stringify(found.map(c=>c.id))}; phone 390x844 no overflow`);
 if (process.argv.includes('--capture-ui')) {
  await page.locator('#open-settings').click();
  await page.locator('#capture-text').fill('Explain interleaving versus blocked practice for learning a skill.');
  const queued=page.waitForResponse(response=>response.url()===`${origin}/api/capture` && response.request().method()==='POST');
  await page.locator('#capture-submit').click();const response=await queued;assert.equal(response.status(),202);const {captureId}=await response.json();
  console.log(`LIVE browser UI capture queued ${captureId}`);
  const suffix=createHash('sha256').update(captureId).digest('hex').slice(0,24);let uiCard;
  const expires=Date.now()+180000;
  while(Date.now()<expires){const feed=await(await fetch(`${origin}/api/feed`,{headers})).json();uiCard=feed.cards.find(card=>card.id.endsWith(suffix));if(uiCard)break;await new Promise(r=>setTimeout(r,5000));}
  assert.ok(uiCard,'Browser-submitted content must publish');
  await page.locator('#refresh-feed').click();await page.locator(`[data-id="${uiCard.id}"]`).waitFor();
  console.log(`LIVE browser capture-to-render PASS ${captureId} -> ${uiCard.id}`);
 }
 console.log('LIVE browser checking reading state');await page.locator(`[data-id="${found[0].id}"] .open-btn`).click();await page.locator(`[data-id="${found[0].id}"]`).getByRole('button',{name:'Done',exact:true}).click();
 await page.locator('#open-settings').click();const downloaded=page.waitForEvent('download');await page.locator('#export-state').click();const download=await downloaded;const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);const buffer=Buffer.concat(chunks);
 const backup=JSON.parse(buffer.toString('utf8'));assert.ok(backup.cards[found[0].id].first_read);await page.locator('#import-file').setInputFiles({name:'bloom-state.json',mimeType:'application/json',buffer});await page.waitForFunction(()=>document.querySelector('#settings-message').textContent.includes('Imported'));
 await page.locator('#close-settings').click();console.log('LIVE browser state export/import PASS');
 await setBrowserOffline(context, origin);await page.reload();await page.waitForTimeout(1500);console.log('LIVE offline diagnostics',JSON.stringify(await page.evaluate(async()=>({online:navigator.onLine,controller:!!navigator.serviceWorker.controller,notices:document.querySelector('#notices').textContent,cardElements:document.querySelectorAll('.card').length,cacheEntries:await Promise.all((await caches.keys()).map(async name=>({name,paths:(await(await caches.open(name)).keys()).map(req=>new URL(req.url).pathname)})))}))));await page.waitForFunction(()=>document.querySelector('#notices').textContent.includes('Offline'));
 assert.ok(await page.locator(`[data-id="${found[1].id}"]`).count());assert.equal(errors.length,0);console.log('LIVE browser offline reopen PASS; no page errors');
}finally{await browser.close();}
