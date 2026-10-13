import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac,createHash} from 'node:crypto';
import {sessionCookie} from '../functions/_lib.js';
import {getAccount,remoteKey} from '../functions/r2-accounts.js';
import {presignedUrl} from '../functions/aws.js';
import * as accounts from '../functions/api/r2-accounts.js';
import * as files from '../functions/api/files.js';
import * as folders from '../functions/api/folder.js';
import * as uploads from '../functions/api/upload-url.js';
import * as complete from '../functions/api/upload-complete.js';
import * as download from '../functions/api/download.js';
import * as pickup from '../functions/api/pickup-download.js';
import * as share from '../functions/api/share.js';
import * as deletion from '../functions/api/delete.js';
import * as usage from '../functions/api/r2-usage.js';
import * as rawUpload from '../functions/api/upload.js';
const db=new DatabaseSync(':memory:');
const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8').replace("  storage_id TEXT NOT NULL DEFAULT '',\n",'');
db.exec(schema);db.exec(readFileSync(new URL('../migration-multi-r2.sql',import.meta.url),'utf8'));
function prepare(sql){let args=[];return {bind(...a){args=a;return this},async first(){return db.prepare(sql).get(Object.fromEntries(args.map((v,i)=>['?'+(i+1),v])))||null},async all(){return {results:db.prepare(sql).all(Object.fromEntries(args.map((v,i)=>['?'+(i+1),v])))}},async run(){const r=db.prepare(sql).run(Object.fromEntries(args.map((v,i)=>['?'+(i+1),v])));return {meta:{changes:r.changes}}}}}
const legacy=new Map();const remote=new Map();let failedDelete=false,failedList=false;
const env={SESSION_SECRET:'fixture-secret-only',CF_ACCOUNT_ID:'c21081d20d9d782cf3ce39dddc17645b',DB:{prepare},R2:{async put(k,b){legacy.set(k,b)},async get(k){return legacy.has(k)?{body:legacy.get(k)}:null},async delete(k){legacy.delete(k)},async head(k){return legacy.has(k)?{size:6}:null}}};
const cookie=(await sessionCookie(env)).split(';')[0];let checks=0;
function equal(a,b){assert.equal(a,b);checks++}
function signature(url,method,headers){
 const u=new URL(url),p=u.searchParams,actual=p.get('X-Amz-Signature');p.delete('X-Amz-Signature');
 const enc=v=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt().toString(16).toUpperCase());
 const q=[...p].map(([k,v])=>[enc(k),enc(v)]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0).map(([k,v])=>k+'='+v).join('&');
 const signed=p.get('X-Amz-SignedHeaders');const canonicalHeaders=signed.split(';').map(k=>k+':'+(k==='host'?u.host:new Headers(headers).get(k))+'\n').join('');
 const req=[method,u.pathname,q,canonicalHeaders,signed,'UNSIGNED-PAYLOAD'].join('\n');
 const [access,date,region]=p.get('X-Amz-Credential').split('/');
 const h=(k,v)=>createHmac('sha256',k).update(v).digest();const key=h(h(h(h('AWS4test-secret',date),region),'s3'),'aws4_request');
 equal(access,'test-access');equal(actual,h(key,'AWS4-HMAC-SHA256\n'+p.get('X-Amz-Date')+'\n'+date+'/'+region+'/s3/aws4_request\n'+createHash('sha256').update(req).digest('hex')).toString('hex'));
}
globalThis.fetch=async (input,options={})=>{
 const u=new URL(input),method=options.method||'GET';signature(input,method,options.headers);
 const key=u.host+u.pathname;
 if(u.searchParams.get('list-type')){if(failedList)return new Response('failed',{status:403});return new Response('<ListBucketResult><Contents><Size>9</Size></Contents><IsTruncated>false</IsTruncated></ListBucketResult>')}
 if(method==='PUT'){remote.set(key,options.body);return new Response(null,{status:200})}
 if(method==='HEAD')return new Response(null,{status:remote.has(key)?200:404,headers:{'content-length':'9','content-type':'text/plain'}});
 if(method==='DELETE'){if(failedDelete)return new Response(null,{status:403});remote.delete(key);return new Response(null,{status:204})}
 throw Error('unexpected fetch '+method);
};
async function call(mod,method,path,data,auth=true){const request=new Request('https://pan.ailxw.com'+path,{method,headers:{...(auth?{Cookie:cookie}:{}),'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return mod['onRequest'+method[0]+method.slice(1).toLowerCase()]({request,env})}
const cfg={name:'账号 A',accountId:'a'.repeat(32),bucket:'bucket-a',prefix:'pan/',capacityGb:10,accessKey:'test-access',secretKey:'test-secret'};
equal((await call(accounts,'GET','/api/r2-accounts',null,false)).status,401);
let response=await call(accounts,'POST','/api/r2-accounts',cfg);equal(response.status,200);const a=(await response.json()).account;equal(a.hasCredentials,true);equal(a.secretKey,undefined);equal(remote.size,0);
const b=(await (await call(accounts,'POST','/api/r2-accounts',{...cfg,name:'账号 B',accountId:'b'.repeat(32)})).json()).account;
equal((await call(accounts,'POST','/api/r2-accounts',{...cfg,id:a.id,bucket:'other-bucket'})).status,409);
equal((await call(accounts,'POST','/api/r2-accounts',{...cfg,prefix:'pan/overlap/'})).status,409);
equal((await call(accounts,'POST','/api/r2-accounts',{...cfg,name:'原桶冲突',accountId:env.CF_ACCOUNT_ID,bucket:'forum-uploads',prefix:'pan-cloudflare/'})).status,409);
const saved=await getAccount(env,a.id);const encrypted=db.prepare('SELECT value FROM settings WHERE key=?').get('r2_account:'+a.id).value;assert.ok(!encrypted.includes('test-secret'));checks++;
for(const id of [a.id,b.id]){
 const folderRes=await call(folders,'POST','/api/folder',{path:'same_%',storage:'r2:'+id});equal(folderRes.status,200);
 const res=await call(uploads,'POST','/api/upload-url',{path:'same_%/中文 +.txt',storage:'r2:'+id,contentType:'text/plain'});equal(res.status,200);const info=await res.json();equal(info.direct,true);const u=new URL(info.uploadUrl);equal(u.pathname,'/bucket-a/pan/same_%25/%E4%B8%AD%E6%96%87%20%2B.txt');equal(u.searchParams.get('X-Amz-Credential').split('/')[2],'auto');
 await fetch(info.uploadUrl,{method:'PUT',headers:{'Content-Type':'text/plain'},body:'contents'});
 response=await call(complete,'POST','/api/upload-complete',{path:'same_%/中文 +.txt',storage:'r2:'+id,size:999999});equal(response.status,200);const data=await response.json();assert.ok(data.id);checks++;
}
const listA=await (await call(files,'GET','/api/files?storage=r2:'+a.id+'&folder=same_%/')).json();const listB=await (await call(files,'GET','/api/files?storage=r2:'+b.id+'&folder=same_%/')).json();equal(listA.files.length,1);equal(listB.files.length,1);assert.notEqual(listA.files[0].id,listB.files[0].id);checks++;
equal(listA.files[0].size,9);const fileId=listA.files[0].id;
const s=await (await call(share,'POST','/api/share',{fileId,style:'count',value:2})).json();equal(s.ok,true);
response=await call(complete,'POST','/api/upload-complete',{path:'same_%/中文 +.txt',storage:'r2:'+a.id});const over=await response.json();equal(over.id,fileId);equal(over.overwritten,true);
response=await call(download,'GET','/api/download?id='+fileId);equal(response.status,302);equal(new URL(response.headers.get('location')).host,'a'.repeat(32)+'.r2.cloudflarestorage.com');
equal((await call(pickup,'GET','/api/pickup-download?code='+s.code,null,false)).status,302);equal((await call(pickup,'GET','/api/pickup-download?code='+s.code,null,false)).status,302);equal((await call(pickup,'GET','/api/pickup-download?code='+s.code,null,false)).status,410);
equal((await call(accounts,'DELETE','/api/r2-accounts',{id:a.id})).status,409);
let stats=await (await call(usage,'GET','/api/r2-usage?id='+a.id)).json();equal(stats.r2.bytes,9);equal(stats.r2.ok,true);failedList=true;stats=await (await call(usage,'GET','/api/r2-usage?id='+a.id+'&refresh=1')).json();equal(stats.r2.stale,true);equal(stats.r2.ok,false);equal(stats.r2.bytes,9);failedList=false;
const rootA=await (await call(files,'GET','/api/files?storage=r2:'+a.id)).json();failedDelete=true;equal((await call(deletion,'POST','/api/delete',{id:rootA.files[0].id})).status,500);equal(db.prepare('SELECT COUNT(*) AS n FROM files WHERE id=?').get(fileId).n,1);failedDelete=false;
equal((await call(deletion,'POST','/api/delete',{id:rootA.files[0].id})).status,200);equal((await (await call(files,'GET','/api/files?storage=r2:'+b.id+'&folder=same_%/')).json()).files.length,1);
equal((await call(accounts,'DELETE','/api/r2-accounts',{id:a.id})).status,200);equal(db.prepare('SELECT COUNT(*) AS n FROM shares WHERE file_id=?').get(fileId).n,0);
const bad=await call(uploads,'POST','/api/upload-url',{path:'x.txt',storage:'r2:invalid'});equal(bad.status,400);
equal((await call(complete,'POST','/api/upload-complete',{path:'not-uploaded.txt',storage:'r2:'+b.id})).status,400);
legacy.set('pan-cloudflare/old.txt','legacy');db.prepare("INSERT INTO files(id,storage,object_key,name,folder,kind,size,created_at,updated_at) VALUES('old','r2','pan-cloudflare/old.txt','old.txt','','file',6,1,1)").run();
equal((await call(download,'GET','/api/download?id=old')).status,200);equal((await (await call(files,'GET','/api/files?storage=r2')).json()).files.length,1);
const aws=await presignedUrl({...cfg,accountId:undefined,region:'us-east-1'},'GET','key');equal(new URL(aws).pathname,'/key');signature(aws,'GET');
console.log('PASS '+checks+' assertions: migration, signature, multi-account isolation, overwrite/share IDs, quota-cache failures, deletion failure, legacy R2, AWS');
export {env,cookie};
