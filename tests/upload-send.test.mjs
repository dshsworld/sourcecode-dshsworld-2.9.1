import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function client() {
  let request;
  class XMLHttpRequest {
    upload = {}; headers = {};
    constructor() { request = this; }
    open(method,url) { this.method=method;this.url=url; }
    setRequestHeader(key,value) { this.headers[key]=value; }
    send(data) { this.data=data; }
  }
  const window={};
  vm.runInNewContext(readFileSync(new URL('../public/upload.js',import.meta.url),'utf8'),{window,XMLHttpRequest});
  return {window,getRequest:()=>request};
}

test('progress reports actual bytes and waits for server storage before declaring success',async()=>{
 const {window,getRequest}=client(),events=[];
 const data=new FormData();
 const result=window.sendPanoramaUpload(data,{csrf:'csrf-value',progress:event=>events.push({...event})});
 const xhr=getRequest();
 assert.equal(xhr.url,'/api/admin/scenes');assert.equal(xhr.method,'POST');
 assert.equal(xhr.withCredentials,true);assert.equal(xhr.headers['X-CSRF-Token'],'csrf-value');
 assert.equal(xhr.data,data);
 xhr.upload.onprogress({lengthComputable:true,loaded:512,total:1024});
 assert.deepEqual(events[0],{phase:'uploading',loaded:512,total:1024});
 xhr.upload.onload();
 assert.deepEqual(events[1],{phase:'saving'});
 let settled=false;result.then(()=>{settled=true;});
 await Promise.resolve();assert.equal(settled,false,'100% sent is not the same as safely stored');
 xhr.status=201;xhr.responseText=JSON.stringify({ok:true,scene:{id:'M1-02'}});xhr.onload();
 assert.equal((await result).scene.id,'M1-02');
});

test('failed uploads reject and expose server errors instead of reporting success',async()=>{
 const {window,getRequest}=client();
 const result=window.sendPanoramaUpload(new FormData());
 const xhr=getRequest();xhr.status=401;xhr.responseText=JSON.stringify({error:'다시 로그인해 주세요.'});xhr.onload();
 await assert.rejects(result,/다시 로그인/);
 const failed=window.sendPanoramaUpload(new FormData());getRequest().onerror();
 await assert.rejects(failed,/전송이 중단/);
});
