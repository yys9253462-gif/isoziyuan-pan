import {
  R2_BUCKET_NAME,
  R2_FREE_TIER_BYTES,
  USAGE_TTL,
  getAwsConfig,
  readUsageCache,
  scanAwsUsage,
  scanR2Usage,
  writeUsageCache,
} from "../storage.js";
import { PREFIX, errorResponse, isAdmin, json, normalizePath, requireAdmin } from "../_lib.js";

// 返回储存桶已用大小：默认走缓存，带刷新参数时强制重新遍历
export async function onRequestGet({ request, env }) {
  const denied = requireAdmin(await isAdmin(request, env));
  if (denied) return denied;
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const config = await getAwsConfig(env);
    const cached = await readUsageCache(env);
    const now = Math.floor(Date.now() / 1000);
    const meta = { awsEnabled: config.enabled, capacityGb: config.capacityGb, r2FreeTierBytes: R2_FREE_TIER_BYTES, ttl: USAGE_TTL };

    if (!refresh && cached && now - Number(cached.at || 0) < USAGE_TTL) {
      return json({ ...cached, ...meta, cached: true });
    }

    const previous = cached || {};
    const [r2, aws] = await Promise.all([
      scanR2Usage(env)
        .then((value) => ({ ok: true, ...value }))
        .catch((error) => {
          console.error(JSON.stringify({ scope: "scanR2Usage", error: String(error?.message || error) }));
          return {
            ...(previous.r2?.ok ? previous.r2 : { bucket: R2_BUCKET_NAME, prefix: PREFIX, bytes: 0, objects: 0, pages: 0, limited: false }),
            ok: false,
            stale: Boolean(previous.r2?.ok),
            error: "默认储存桶用量统计失败，请稍后重试",
          };
        }),
      config.enabled
        ? scanAwsUsage(config)
            .then((value) => ({ ok: true, ...value }))
            .catch((error) => {
              console.error(JSON.stringify({ scope: "scanAwsUsage", error: String(error?.message || error) }));
              return {
                ...(previous.aws?.ok
                  ? previous.aws
                  : { bucket: config.bucket, prefix: normalizePath(config.prefix || "") || "(整桶)", bytes: 0, objects: 0, pages: 0, limited: false }),
                ok: false,
                stale: Boolean(previous.aws?.ok),
                error: "外部储存桶用量统计失败，请检查读取权限",
              };
            })
        : Promise.resolve({
            ok: true,
            enabled: false,
            bucket: config.bucket,
            prefix: normalizePath(config.prefix || "") || "(整桶)",
            bytes: 0,
            objects: 0,
            pages: 0,
            limited: false,
          }),
    ]);

    const payload = { at: now, r2, aws };
    if (r2.ok || aws.ok) await writeUsageCache(env, payload).catch(() => undefined);
    return json({ ...payload, ...meta, cached: false });
  } catch (error) {
    return errorResponse(error, "无法统计储存桶用量");
  }
}
