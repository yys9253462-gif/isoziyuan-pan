import { encryptConfig, decryptConfig, awsKey, presignedUrl } from "./aws.js";
import { getSessionSecret, normalizePath, safeContentDisposition } from "./_lib.js";

const KEY = "r2_account:";

export function parseStorage(value = "r2") {
  if (value === "r2" || value === "aws") return { storage: value, storageId: "" };
  if (/^r2:[0-9a-f-]{36}$/.test(value)) return { storage: "r2", storageId: value.slice(3) };
  throw new Error("存储空间无效");
}

export function spaceOf(row) {
  return row.storage_id ? `r2:${row.storage_id}` : row.storage || "r2";
}

export function databaseKey(config, path) {
  // 使用独立的数据库命名空间避开历史唯一键冲突，严禁将此键直接发往对象存储
  return `@r2/${config.id}/${normalizePath(path)}`;
}

export function remoteKey(config, row) {
  const marker = `@r2/${config.id}/`;
  if (!row.object_key.startsWith(marker)) throw new Error("文件存储空间不匹配");
  return awsKey(config, row.object_key.slice(marker.length));
}

export function publicAccount(c) {
  return {
    id: c.id,
    name: c.name,
    accountId: c.accountId,
    bucket: c.bucket,
    prefix: c.prefix,
    jurisdiction: c.jurisdiction || "",
    capacityGb: c.capacityGb,
    hasCredentials: Boolean(c.accessKey && c.secretKey),
  };
}

export async function listAccounts(env) {
  const secret = getSessionSecret(env);
  const result = await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'r2_account:%' ORDER BY key").all();
  return Promise.all(
    (result.results || []).map(async (row) => {
      const c = await decryptConfig(row.value, secret);
      if (!c) throw new Error("外部对象存储配置解密失败，请检查会话密钥");
      return c;
    })
  );
}

export async function getAccount(env, id) {
  if (!/^[0-9a-f-]{36}$/.test(String(id || ""))) throw new Error("外部存储账号编号无效");
  const secret = getSessionSecret(env);
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(KEY + id).first();
  if (!row) throw new Error("外部存储空间不存在");
  const c = await decryptConfig(row.value, secret);
  if (!c) throw new Error("外部存储配置解密失败");
  return c;
}

export async function saveAccount(env, c) {
  const secret = getSessionSecret(env);
  const value = await encryptConfig(c, secret);
  await env.DB
    .prepare("INSERT INTO settings (key,value,updated_at) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at")
    .bind(KEY + c.id, value, Math.floor(Date.now() / 1000))
    .run();
  await env.DB.prepare("DELETE FROM settings WHERE key = ?1").bind("r2_usage:" + c.id).run();
}

export async function remoteDownload(env, row) {
  const c = await getAccount(env, row.storage_id);
  const key = remoteKey(c, row);
  const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(15000) : undefined;
  const head = await fetch(await presignedUrl(c, "HEAD", key, { expires: 60 }), { method: "HEAD", signal });
  if (!head.ok) throw new Error("远程对象文件不可用");
  return presignedUrl(c, "GET", key, {
    expires: 900,
    query: { "response-content-disposition": safeContentDisposition(row.name) },
  });
}
