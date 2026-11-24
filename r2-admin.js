// 多账号 R2 管理控制模块（密钥仅写入加密库，接口永不回传明文）
(() => {
  const {
    state,
    esc,
    api,
    toast,
    setStatus,
    setStorage,
    loadUsage,
    copyText,
    confirmAction,
    bindBackdropClose,
    updateSpaceCount,
  } = window.PanAdmin;

  const r2Dialog = document.querySelector("#r2Dialog");
  const r2Status = document.querySelector("#r2Status");
  let editingId = "";

  function selectedR2() {
    return (state.r2Accounts || []).find((a) => "r2:" + a.id === state.storage);
  }

  function renderR2Connections() {
    const container = document.querySelector("#r2Connections");
    const list = state.r2Accounts || [];
    if (!list.length) {
      container.innerHTML = '<p class="muted">尚未添加其他 R2 账号，默认原生 R2 空间不受任何影响。</p>';
      return;
    }
    container.innerHTML = list
      .map(
        (a) =>
          `<div class="r2-connection${editingId === a.id ? " is-editing" : ""}"><div><b>${esc(a.name)}</b><small>${esc(
            a.bucket
          )} · 前缀 ${esc(a.prefix)} · ${esc(a.accountId.slice(0, 8))}…</small></div><button type="button" class="table-button" data-edit-r2="${esc(
            a.id
          )}">${editingId === a.id ? "正在编辑" : "编辑"}</button></div>`
      )
      .join("");
  }

  async function loadR2Accounts() {
    const data = await api("/api/r2-accounts");
    state.r2Accounts = data.accounts || [];
    document.querySelector("#r2Spaces").innerHTML = state.r2Accounts
      .map(
        (a) =>
          `<button type="button" class="storage-tab" data-storage="r2:${esc(
            a.id
          )}"><span class="storage-dot r2" aria-hidden="true"></span><span class="storage-tab-body"><b>${esc(
            a.name
          )}</b><small>${esc(a.bucket)}</small></span><svg class="storage-tab-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg></button>`
      )
      .join("");

    document.querySelectorAll(".storage-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.storage === state.storage);
      tab.onclick = () => setStorage(tab.dataset.storage);
    });
    updateSpaceCount();
    renderR2Connections();
  }

  function editR2(id = "") {
    editingId = id;
    const a = (state.r2Accounts || []).find((x) => x.id === id) || {};
    document.querySelector("#r2Id").value = a.id || "";
    const mapping = [
      ["r2Name", "name", ""],
      ["r2Account", "accountId", ""],
      ["r2Bucket", "bucket", ""],
      ["r2Prefix", "prefix", "pan-cloudflare/"],
      ["r2Jurisdiction", "jurisdiction", ""],
      ["r2Capacity", "capacityGb", 10],
    ];
    for (const [field, key, fallback] of mapping) {
      document.querySelector("#" + field).value = a[key] ?? fallback;
    }
    for (const field of ["r2Account", "r2Bucket", "r2Prefix", "r2Jurisdiction"]) {
      document.querySelector("#" + field).disabled = Boolean(id);
    }
    document.querySelector("#r2Access").value = "";
    document.querySelector("#r2Secret").value = "";
    setStatus(
      r2Status,
      id ? "密钥留空沿用原值；账号、桶名与前缀不可原地修改，防止已有取件码失效。" : "填写目标账号的对象存储凭据，系统将自动探测读写删除权限。"
    );
    document.querySelector("#removeR2").hidden = !id;
    renderR2Connections();
  }

  document.querySelector("#openR2Settings").addEventListener("click", async () => {
    r2Dialog.showModal();
    editR2();
    try {
      await loadR2Accounts();
    } catch (e) {
      setStatus(r2Status, e.message, "error");
    }
  });

  document.querySelector("#newR2").addEventListener("click", () => editR2());
  document.querySelector("#r2Connections").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-edit-r2]");
    if (btn) editR2(btn.dataset.editR2);
  });

  document.querySelector("#r2Close").addEventListener("click", () => r2Dialog.close());
  document.querySelector("#r2CloseTop").addEventListener("click", () => r2Dialog.close());
  bindBackdropClose(r2Dialog);

  document.querySelector("#saveR2").addEventListener("click", async () => {
    const btn = document.querySelector("#saveR2");
    btn.disabled = true;
    setStatus(r2Status, "正在校验 R2 储存桶读写删除权限…", "warn");
    try {
      const data = {};
      const fields = [
        ["r2Id", "id"],
        ["r2Name", "name"],
        ["r2Account", "accountId"],
        ["r2Bucket", "bucket"],
        ["r2Prefix", "prefix"],
        ["r2Jurisdiction", "jurisdiction"],
        ["r2Capacity", "capacityGb"],
        ["r2Access", "accessKey"],
        ["r2Secret", "secretKey"],
      ];
      for (const [field, key] of fields) {
        data[key] = document.querySelector("#" + field).value;
      }
      const res = await api("/api/r2-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      document.querySelector("#r2Access").value = "";
      document.querySelector("#r2Secret").value = "";
      await loadR2Accounts();
      editR2(res.account.id);
      setStatus(r2Status, "连接已验证并加密保存；上传前请确认目标桶已粘贴下方跨域策略。", "success");
      toast("R2 连接已保存", "success");
      if (state.storage === "r2:" + res.account.id) loadUsage(true);
    } catch (e) {
      setStatus(r2Status, e.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  document.querySelector("#removeR2").addEventListener("click", async () => {
    const id = document.querySelector("#r2Id").value;
    const target = (state.r2Accounts || []).find((x) => x.id === id);
    const confirmed = await confirmAction({
      title: "移除外部 R2 连接",
      target: target ? `${target.name}（${target.bucket}）` : id,
      message: "仅当该空间内已无任何文件或文件夹时才允许移除连接，移除后已加密凭据将被彻底清除。",
      confirmLabel: "确认移除",
    });
    if (!confirmed) return;
    try {
      await api("/api/r2-accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await loadR2Accounts();
      editR2();
      if (state.storage === "r2:" + id) setStorage("r2");
      toast("R2 连接已移除", "success");
    } catch (e) {
      setStatus(r2Status, e.message, "error");
    }
  });

  const r2CorsJson = JSON.stringify(
    [
      {
        AllowedOrigins: [location.origin, "https://pan.ailxw.com"].filter((v, i, a) => a.indexOf(v) === i),
        AllowedMethods: ["GET", "PUT", "HEAD"],
        AllowedHeaders: ["Content-Type"],
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 3600,
      },
    ],
    null,
    2
  );
  document.querySelector("#r2Cors").textContent = r2CorsJson;
  document.querySelector("#copyR2Cors").addEventListener("click", () => copyText(r2CorsJson, "跨域配置"));

  window.PanAdmin.setR2Helpers({ loadR2Accounts, selectedR2 });
})();
