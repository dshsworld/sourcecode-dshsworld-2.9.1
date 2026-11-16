import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const module = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL('../lib/store-upload-objects.ts',import.meta.url),'utf8'), { compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022 } }).outputText;
new Function('module','exports',code)(module,module.exports);
const { storeUploadObjects } = module.exports;
const objects = ['original','8k','4k','thumb'].map(key=>({key,file:new File(['x'],key),type:'image/jpeg'}));

test('storage writes overlap with at most two in flight',async()=>{
 let active=0,peak=0; const stored=[];
 await storeUploadObjects({put:async key=>{
  peak=Math.max(peak,++active);
  await new Promise(resolve=>setImmediate(resolve));
  stored.push(key);active--;
 }},objects);
 assert.equal(peak,2);assert.equal(active,0);
 assert.deepEqual(stored.sort(),objects.map(x=>x.key).sort());
});

test('a failed write waits for in-flight storage before reporting failure for cleanup',async()=>{
 let finishOriginal; const stored=[];
 const write=storeUploadObjects({put:async key=>{
  if(key==='original'){await new Promise(resolve=>{finishOriginal=resolve;});stored.push(key);}
  else throw new Error('storage failed');
 }},objects);
 let settled=false;
 const result=write.catch(error=>{settled=true;return error;});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(settled,false,'cleanup cannot start while another object is still being written');
 finishOriginal();
 assert.match((await result).message,/storage failed/);
 assert.deepEqual(stored,['original']);
});
