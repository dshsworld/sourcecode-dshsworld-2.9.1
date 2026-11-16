import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { Miniflare } from 'miniflare';

test('deployed Worker accepts large JPG and INSP + display images without IMAGES; preserves nodes and enforces access', async () => {
  const secret = 'isolated-test-session-secret-for-upload';
  const mf = new Miniflare({
    modules: true, scriptPath: 'dist/server/index.js',
    modulesRules: [{ type: 'ESModule', include: ['**/*.js'] }],
    compatibilityDate: '2026-05-01', compatibilityFlags: ['nodejs_compat'], cf: false,
    d1Databases: ['DB'], r2Buckets: ['BUCKET'], bindings: { SESSION_SECRET: secret },
  });
  try {
    const db = await mf.getD1Database('DB');
    for (const file of readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort()) {
      for (const sql of readFileSync(`drizzle/${file}`, 'utf8').split('--> statement-breakpoint').filter(s=>s.trim())) await db.prepare(sql).run();
    }
    const payload = Buffer.from(JSON.stringify({role:'admin',csrf:'upload-test',exp:Date.now()+3600000})).toString('base64url');
    const signature = createHmac('sha256',secret).update(payload).digest('base64url');
    const headers = { cookie:`dshs_session=${payload}.${signature}`, 'x-csrf-token':'upload-test', origin:'https://example.test' };
    const photo = readFileSync('tests/fixtures/panorama.jpg');
    const thumb = readFileSync('tests/fixtures/thumb.jpg');
    function body(insp=false, large=true) {
      const form = new FormData();
      for(const [k,v] of Object.entries({id:'M1-02',title:'본관 사진',floor:'1F',building:'본관',replace:'true'})) form.set(k,v);
      form.set('panorama',new File([photo, ...(large ? [new Uint8Array(23*1024*1024)] : [])],insp?'PHOTO.INSP':'PHOTO.JPG',{type:'application/octet-stream'}));
      form.set('image8k',new File([photo],'8k.jpg',{type:'image/jpeg'}));
      form.set('image4k',new File([photo],'4k.jpg',{type:'image/jpeg'}));
      form.set('thumb',new File([thumb],'thumb.jpg',{type:'image/jpeg'}));
      return form;
    }
    const send=async(form, auth=headers)=>{
      const encoded = new Request('https://example.test/api/admin/scenes',{method:'POST',headers:auth,body:form});
      return mf.dispatchFetch(encoded.url,{method:'POST',headers:Object.fromEntries(encoded.headers),body:await encoded.arrayBuffer()});
    };
    // Early auth rejection needs no large body; Miniflare may close its local
    // HTTP socket before Undici finishes sending an intentionally rejected 24MB.
    assert.equal((await send(body(false,false),{})).status,401);
    assert.equal((await send(body(false,false),{cookie:headers.cookie})).status,403);
    const first = await send(body());
    const firstResult = await first.json();
    assert.equal(first.status,201,JSON.stringify(firstResult));
    const before = await db.prepare("SELECT * FROM scenes WHERE id='M1-02'").first();
    assert.equal(before.initial_yaw,90);assert.equal(before.initial_pitch,0);
    const links = await db.prepare("SELECT count(*) n FROM links WHERE from_scene='M1-02'").first();
    assert(links.n>0);
    await db.prepare("UPDATE scenes SET annotation='keep me' WHERE id='M1-02'").run();
    const image = await mf.dispatchFetch('https://example.test'+firstResult.scene.image8k);
    assert.equal(image.status,200); assert.equal(image.headers.get('content-type'),'image/jpeg');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()),photo);
    assert.equal((await mf.dispatchFetch('https://example.test/api/media/'+before.original_key)).status,404);
    const bucket = await mf.getR2Bucket('BUCKET');
    assert.equal((await bucket.head(before.original_key)).size, photo.length+23*1024*1024);
    const custom=body(true);custom.set('initialYaw','32.5');custom.set('initialPitch','-7');
    const second = await send(custom);
    assert.equal(second.status,201,await second.text());
    const after = await db.prepare("SELECT * FROM scenes WHERE id='M1-02'").first();
    assert(after.original_key.endsWith('.insp')); assert.equal(after.annotation,'keep me');
    assert.equal(after.initial_yaw,32.5);assert.equal(after.initial_pitch,-7,'manual upload view is saved when replacing photos too');
    assert.equal(after.map_x,before.map_x); assert.equal(after.title,before.title);
    assert.equal((await db.prepare("SELECT count(*) n FROM links WHERE from_scene='M1-02'").first()).n,links.n);
    const invalid = body(true); invalid.delete('image8k');
    assert.equal((await send(invalid)).status,400);
    assert.equal((await db.prepare("SELECT image_8k FROM scenes WHERE id='M1-02'").first()).image_8k,after.image_8k);
    const raw = body(true); for (const key of ['image8k','image4k','thumb']) raw.delete(key); raw.set('sourceOnly','true');
    assert.equal((await send(raw)).status,400);
    const pending = await db.prepare("SELECT value FROM settings WHERE key='pending_insp_M1-02'").first();
    assert.equal(pending,null);
    assert.equal((await db.prepare("SELECT image_8k FROM scenes WHERE id='M1-02'").first()).image_8k,after.image_8k);
    const statusUrl = 'https://example.test/api/admin/scenes/M1-02/source';
    assert.equal((await mf.dispatchFetch(statusUrl)).status,401);
    const status = await mf.dispatchFetch(statusUrl,{headers});
    assert.equal((await status.json()).pending,false);
    const optimized=body();optimized.delete('image8k');optimized.set('image8kRef','image4k');
    const shared=await send(optimized);const sharedResult=await shared.json();
    assert.equal(shared.status,201,JSON.stringify(sharedResult));
    assert.equal(sharedResult.scene.image8k,sharedResult.scene.image4k,'small panoramas reuse the one full-resolution display object');
    const sharedImage=await mf.dispatchFetch('https://example.test'+sharedResult.scene.image8k);
    assert.deepEqual(Buffer.from(await sharedImage.arrayBuffer()),photo);
    const spoofed=body();spoofed.set('image8kRef','/api/media/other.jpg');
    assert.equal((await send(spoofed)).status,400,'references can only point at the validated file in this same upload');
    const oversized = await mf.dispatchFetch('https://example.test/api/admin/scenes',{method:'POST',headers:{...headers,'content-type':'multipart/form-data; boundary=x'},body:new Uint8Array(65*1024*1024)});
    assert.equal(oversized.status,413);
  } finally { await mf.dispose(); }
});
