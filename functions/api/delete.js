import { errorResponse, isAdmin, json, requireAdmin } from "../_lib.js";
import { awsRequest } from "../aws.js";
import { getAwsConfig } from "../storage.js";
import { getAccount, remoteKey } from '../r2-accounts.js';

export async function onRequestPost({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  const data = await request.json().catch(() => ({}));
  const id = String(data.id || "");
  if (!id) return json({ error: "文件不存在" }, 400);
  try {
    const row = await env.DB.prepare("SELECT * FROM files WHERE id = ?1").bind(id).first();
    if (!row) return json({ error: "文件不存在" }, 404);
    const prefix=`${row.folder}${row.name}/`;
    const rows = row.kind === "folder"
      ? await env.DB.prepare("SELECT * FROM files WHERE storage = ?1 AND storage_id = ?2 AND (id = ?3 OR substr(folder,1,length(?4)) = ?4)").bind(row.storage || "r2",row.storage_id||'', id,prefix).all()
      : { results: [row] };
    const all = rows.results || [];
    const awsConfig = row.storage === "aws" ? await getAwsConfig(env) : null;
    const remoteConfig=row.storage_id?await getAccount(env,row.storage_id):null;
    for (const item of all) {
      if (remoteConfig||row.storage === "aws") {
        if(item.kind==='folder'&&remoteConfig)continue;
        const response=await awsRequest(remoteConfig||awsConfig, "DELETE",remoteConfig?remoteKey(remoteConfig,item):item.object_key);
        if(!response.ok)throw new Error('对象删除失败');
      }
      else await env.R2.delete(item.object_key);
    }
    await env.DB.prepare(row.kind === "folder" ? "DELETE FROM files WHERE storage = ?1 AND storage_id = ?2 AND (id = ?3 OR substr(folder,1,length(?4)) = ?4)" : "DELETE FROM files WHERE id = ?1").bind(...(row.kind === "folder" ? [row.storage || "r2",row.storage_id||'', id,prefix] : [id])).run();
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error, "删除失败");
  }
}
