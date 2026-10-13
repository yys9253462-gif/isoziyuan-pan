import { isAdmin,requireAdmin,json } from '../_lib.js';
import { getAccount } from '../r2-accounts.js';
import { scanAwsUsage,USAGE_TTL } from '../storage.js';

export async function onRequestGet({request,env}) {
  const denied=requireAdmin(await isAdmin(request,env));if(denied)return denied;
  const url=new URL(request.url);
  try {
    const c=await getAccount(env,url.searchParams.get('id'));
    const key='r2_usage:'+c.id;
    const saved=await env.DB.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first();
    const previous=saved?JSON.parse(saved.value):null;
    const now=Math.floor(Date.now()/1000);
    if(previous&&url.searchParams.get('refresh')!=='1'&&now-previous.at<USAGE_TTL)return json({...previous,cached:true});
    try {
      const payload={at:now,capacityGb:c.capacityGb,r2:{ok:true,...await scanAwsUsage(c)}};
      await env.DB.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,JSON.stringify(payload),now).run();
      return json({...payload,cached:false});
    } catch {
      return json({...previous,capacityGb:c.capacityGb,r2:{...previous?.r2,ok:false,stale:Boolean(previous),error:'R2 统计失败，请检查桶读取权限'},cached:false});
    }
  } catch { return json({error:'无法读取 R2 用量'},400); }
}
