import { isAdmin, requireAdmin, json, normalizePath } from '../_lib.js';
import { listAccounts, publicAccount, getAccount, saveAccount } from '../r2-accounts.js';
import { validateAwsConfig, awsKey, awsRequest } from '../aws.js';

export async function onRequestGet({request,env}) {
  const denied=requireAdmin(await isAdmin(request,env)); if(denied)return denied;
  try { return json({accounts:(await listAccounts(env)).map(publicAccount)}); }
  catch { return json({error:'无法读取 R2 账号配置'},500); }
}
export async function onRequestPost({request,env}) {
  const denied=requireAdmin(await isAdmin(request,env)); if(denied)return denied;
  const d=await request.json().catch(()=>({}));
  try {
    const old=d.id?await getAccount(env,String(d.id)):null;
    const c={id:old?.id||crypto.randomUUID(),name:String(d.name||'').trim().slice(0,60),accountId:String(d.accountId||'').trim().toLowerCase(),bucket:String(d.bucket||'').trim(),prefix:normalizePath(d.prefix||'pan-cloudflare/',true),jurisdiction:String(d.jurisdiction||''),region:'auto',capacityGb:Number(d.capacityGb||10),accessKey:String(d.accessKey||'').trim()||old?.accessKey,secretKey:String(d.secretKey||'').trim()||old?.secretKey};
    if(!c.name||!/^[0-9a-f]{32}$/.test(c.accountId)||!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(c.bucket)||!['','eu','fedramp'].includes(c.jurisdiction)||!Number.isFinite(c.capacityGb)||c.capacityGb<1||c.capacityGb>100000) return json({error:'请检查名称、32 位 Account ID、桶名、区域和容量'},400);
    if(!c.accessKey||!c.secretKey)return json({error:'首次连接需填写 R2 S3 Access Key ID 和 Secret Access Key'},400);
    if(old&&['accountId','bucket','prefix','jurisdiction'].some(k=>c[k]!==old[k]))return json({error:'存储定位不可修改，请新增账号；可编辑名称、容量及轮换密钥'},409);
    const accounts=await listAccounts(env);
    if(accounts.some(a=>a.id!==c.id&&a.accountId===c.accountId&&a.bucket===c.bucket&&a.prefix===c.prefix&&a.jurisdiction===c.jurisdiction))return json({error:'相同账号、桶及前缀已经连接'},409);
    // Reject overlapping namespaces to prevent two spaces overwriting the same objects.
    if(accounts.some(a=>a.id!==c.id&&a.accountId===c.accountId&&a.bucket===c.bucket&&a.jurisdiction===c.jurisdiction&&(a.prefix.startsWith(c.prefix)||c.prefix.startsWith(a.prefix))))return json({error:'同桶的路径前缀不能重叠'},409);
    if(c.accountId===env.CF_ACCOUNT_ID&&c.bucket==='forum-uploads'&&c.jurisdiction===''&&('pan-cloudflare/'.startsWith(c.prefix)||c.prefix.startsWith('pan-cloudflare/')))return json({error:'与原 R2 空间重叠，请使用不同的路径前缀'},409);
    await validateAwsConfig(c);
    const probe=awsKey(c,'.connection-check/'+crypto.randomUUID());
    try {
      const put=await awsRequest(c,'PUT',probe,{body:new Uint8Array(0)});
      if(!put.ok)throw new Error('无写入权限');
      const head=await awsRequest(c,'HEAD',probe);
      if(!head.ok)throw new Error('无读取权限');
    } finally {
      const removed=await awsRequest(c,'DELETE',probe);
      if(!removed.ok)throw new Error('无删除权限');
    }
    await saveAccount(env,c);
    return json({ok:true,account:publicAccount(c)});
  } catch { return json({error:'R2 连接验证失败，请检查 Account ID、桶名、S3 密钥和对象读写权限'},400); }
}
export async function onRequestDelete({request,env}) {
  const denied=requireAdmin(await isAdmin(request,env)); if(denied)return denied;
  const d=await request.json().catch(()=>({}));
  try {
    const c=await getAccount(env,String(d.id||''));
    const row=await env.DB.prepare('SELECT COUNT(*) AS count FROM files WHERE storage_id = ?1').bind(c.id).first();
    if(Number(row.count))return json({error:'空间内仍有文件或文件夹，不能移除连接'},409);
    await env.DB.prepare('DELETE FROM settings WHERE key IN (?1,?2)').bind('r2_account:'+c.id,'r2_usage:'+c.id).run();
    return json({ok:true});
  } catch { return json({error:'移除 R2 连接失败'},400); }
}
