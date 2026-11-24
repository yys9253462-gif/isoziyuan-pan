// 爱搜云盘管理后台核心脚本（外置脚本以配合严格内容安全策略）
(() => {
  const authView = document.querySelector("#authView");
  const appView = document.querySelector("#appView");
  const rows = document.querySelector("#fileRows");
  const crumbs = document.querySelector("#crumbs");
  const statusEl = document.querySelector("#uploadStatus");
  const notice = document.querySelector("#notice");
  const filePanel = document.querySelector("#filePanel");
  const dropOverlay = document.querySelector("#dropOverlay");
  const dropOverlayPath = document.querySelector("#dropOverlayPath");
  const uploadBanner = document.querySelector("#uploadBanner");
  const uploadBannerFile = document.querySelector("#uploadBannerFile");
  const uploadBannerPct = document.querySelector("#uploadBannerPct");
  const uploadBannerFill = document.querySelector("#uploadBannerFill");
  const searchInput = document.querySelector("#searchInput");
  const searchClear = document.querySelector("#searchClear");
  const passwordInput = document.querySelector("#password");
  const togglePasswordBtn = document.querySelector("#togglePassword");
  const loginErrorBox = document.querySelector("#loginError");
  const loginErrorText = document.querySelector("#loginErrorText");
  const loginSubmitBtn = document.querySelector("#loginSubmit");

  const state = {
    folder: "",
    storage: "r2",
    files: [],
    query: "",
    loadingFiles: false,
    uploading: false,
    aws: null,
    usage: null,
    r2Accounts: [],
  };

  let r2Helpers = {
    loadR2Accounts: async () => {},
    selectedR2: () => undefined,
  };

  let toastTimer = null;
  let confirmResolver = null;
  let shareState = { fileId: null, style: "day", value: 7, existing: [] };

  const esc = (s) =>
    String(s ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

  const safeDecode = (s) => {
    try {
      return decodeURIComponent(String(s || ""));
    } catch {
      return "";
    }
  };

  const fmt = (n) => {
    const v = Number(n || 0);
    if (!Number.isFinite(v) || v < 0) return "0 B";
    if (v < 1024) return `${v} B`;
    if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
    if (v < 1073741824) return `${(v / 1048576).toFixed(1)} MB`;
    return `${(v / 1073741824).toFixed(2)} GB`;
  };

  // 储存桶用量按十进制口径（一吉字节等于十亿字节）展示，与云厂商计费口径一致
  const fmtDec = (n) => {
    const v = Number(n || 0);
    if (!Number.isFinite(v) || v < 0) return "0 B";
    if (v < 1000) return `${v} B`;
    if (v < 1e6) return `${(v / 1e3).toFixed(1)} KB`;
    if (v < 1e9) return `${(v / 1e6).toFixed(1)} MB`;
    if (v < 1e12) return `${(v / 1e9).toFixed(2)} GB`;
    return `${(v / 1e12).toFixed(2)} TB`;
  };

  function toast(message, tone = "") {
    const el = document.querySelector("#toast");
    el.textContent = message;
    el.className = "toast show" + (tone ? " is-" + tone : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove("show");
    }, 3200);
  }

  function setStatus(el, text, tone = "") {
    el.textContent = text;
    el.className = "dialog-status" + (tone ? " is-" + tone : "");
  }

  function showAuth(message = "") {
    appView.hidden = true;
    authView.hidden = false;
    state.files = [];
    if (message) {
      loginErrorText.textContent = message;
      loginErrorBox.hidden = false;
    } else {
      loginErrorBox.hidden = true;
      loginErrorText.textContent = "";
    }
    passwordInput.focus();
  }

  async function api(url, options) {
    const response = await fetch(url, { cache: "no-store", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || `请求失败（状态码 ${response.status}）`);
      err.status = response.status;
      throw err;
    }
    return data;
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const tmp = document.createElement("textarea");
      tmp.value = text;
      tmp.style.position = "fixed";
      tmp.style.opacity = "0";
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand && document.execCommand("copy");
      tmp.remove();
    }
    toast(`${label}已复制`, "success");
  }

  function bindBackdropClose(dialog, onClose) {
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) {
        dialog.close();
        if (onClose) onClose();
      }
    });
  }

  // 统一危险操作确认弹窗，替代浏览器原生阻塞弹窗
  const confirmDialog = document.querySelector("#confirmDialog");
  const confirmTitleEl = document.querySelector("#confirmTitle");
  const confirmTargetEl = document.querySelector("#confirmTarget");
  const confirmMessageEl = document.querySelector("#confirmMessage");
  const confirmOkBtn = document.querySelector("#confirmOk");

  function finishConfirm(result) {
    confirmDialog.close();
    if (confirmResolver) {
      const resolve = confirmResolver;
      confirmResolver = null;
      resolve(result);
    }
  }

  function confirmAction({ title = "确认执行操作", target = "", message = "", confirmLabel = "确认删除" }) {
    confirmTitleEl.textContent = title;
    if (target) {
      confirmTargetEl.textContent = target;
      confirmTargetEl.hidden = false;
    } else {
      confirmTargetEl.hidden = true;
    }
    confirmMessageEl.textContent = message;
    confirmOkBtn.textContent = confirmLabel;
    confirmDialog.showModal();
    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  document.querySelector("#confirmCancel").addEventListener("click", () => finishConfirm(false));
  document.querySelector("#confirmClose").addEventListener("click", () => finishConfirm(false));
  confirmOkBtn.addEventListener("click", () => finishConfirm(true));
  confirmDialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    finishConfirm(false);
  });
  bindBackdropClose(confirmDialog, () => finishConfirm(false));

  function updateSpaceCount() {
    const count = 2 + (state.r2Accounts ? state.r2Accounts.length : 0);
    const badge = document.querySelector("#spaceCount");
    if (badge) badge.textContent = String(count);
  }

  function currentSpaceLabel() {
    const selected = r2Helpers.selectedR2();
    if (selected) return selected.name;
    return state.storage === "aws" ? "AWS S3" : "Cloudflare R2";
  }

  function iconSvgFor(file) {
    if (file.kind === "folder") {
      return {
        cls: "folder",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
      };
    }
    const ext = String(file.name || "").split(".").pop().toLowerCase();
    if (["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"].includes(ext)) {
      return {
        cls: "archive",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"></path><path d="M1 3h22v5H1z"></path><path d="M10 12h4"></path></svg>',
      };
    }
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "mp4", "mov", "mkv", "webm", "mp3", "wav", "flac"].includes(ext)) {
      return {
        cls: "media",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
      };
    }
    if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "json"].includes(ext)) {
      return {
        cls: "doc",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
      };
    }
    return {
      cls: "file",
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    };
  }

  async function loadAws() {
    try {
      state.aws = await api("/api/storage-config");
      document.querySelector("#awsState").textContent = state.aws.enabled ? state.aws.bucket : "未配置";
      document.querySelector("#awsUsage").textContent = state.aws.enabled ? fmt(Number(state.aws.usage?.bytes || 0)) : "—";
      document.querySelector("#awsUsageHint").textContent = state.aws.enabled ? `本月上限 ${state.aws.monthlyTransferGb} GB` : "启用 AWS 后显示";
    } catch {
      state.aws = { enabled: false };
    }
  }

  async function loadUsage(force = false) {
    const space = state.storage;
    const button = document.querySelector("#usageRefresh");
    const hint = document.querySelector("#usageHint");
    button.disabled = true;
    button.classList.add("is-spinning");
    if (!state.usage) hint.textContent = "正在遍历储存桶，首次统计请稍候…";
    try {
      const endpoint = space.startsWith("r2:")
        ? "/api/r2-usage?id=" + encodeURIComponent(space.slice(3)) + (force ? "&refresh=1" : "")
        : "/api/storage-usage" + (force ? "?refresh=1" : "");
      const data = await api(endpoint);
      if (state.storage === space) state.usage = data;
    } catch (error) {
      if (state.storage === space) state.usage = { error: error.message };
    } finally {
      if (state.storage === space) {
        button.disabled = false;
        button.classList.remove("is-spinning");
        renderUsage();
      }
    }
  }

  function renderUsage() {
    const value = document.querySelector("#usageBytes");
    const hint = document.querySelector("#usageHint");
    const fill = document.querySelector("#usageFill");
    const note = document.querySelector("#usageNote");
    const isAws = state.storage === "aws";
    const data = state.usage ? (isAws ? state.usage.aws : state.usage.r2) : null;
    const blank = (text, extra = "") => {
      value.textContent = "—";
      hint.textContent = text;
      hint.title = "";
      fill.style.width = "0";
      fill.className = "";
      note.textContent = extra;
    };
    if (!data) {
      blank(isAws ? "暂无统计数据" : "正在遍历储存桶…");
      return;
    }
    if (!data.ok && !data.stale) {
      blank("统计失败，可点击右上角重试", data.error || "");
      return;
    }
    if (isAws && !data.enabled) {
      blank("AWS 尚未启用", "配置并启用后自动统计");
      return;
    }
    const limit = isAws
      ? Number(state.usage.capacityGb || 0) * 1e9
      : Number(state.storage.startsWith("r2:") ? state.usage.capacityGb * 1e9 : state.usage.r2FreeTierBytes || 0);
    const bytes = Number(data.bytes || 0);
    const pct = limit > 0 ? Math.min(100, (bytes / limit) * 100) : 0;
    value.textContent = fmtDec(bytes);
    hint.textContent = `${data.bucket || (isAws ? "AWS S3" : "R2")} · ${data.objects} 个对象`;
    hint.title = data.prefix ? `统计范围：${data.prefix}` : "";
    fill.style.width = (bytes > 0 ? Math.max(pct, 2) : 0) + "%";
    fill.className = pct >= 90 ? "danger" : pct >= 70 ? "warn" : "";
    const stamp = state.usage.at ? new Date(state.usage.at * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "—";
    const parts = [
      `${isAws || state.storage.startsWith("r2:") ? "容量参考" : "R2 免费额度参考"} ${fmtDec(limit)}`,
      `已用 ${pct.toFixed(pct < 10 ? 1 : 0)}%`,
      `${stamp} 更新`,
    ];
    if (state.usage.cached) parts.push("缓存");
    if (data.stale) parts.push("沿用上次结果");
    if (data.limited) parts.push("对象数较多仅统计前段");
    note.textContent = parts.join(" · ");
  }

  function renderSkeleton() {
    rows.innerHTML = Array.from({ length: 4 })
      .map(
        () =>
          '<tr><td class="col-name"><span class="skeleton-line w-lg"></span></td><td class="col-size"><span class="skeleton-line w-sm"></span></td><td class="col-time"><span class="skeleton-line w-md"></span></td><td class="col-actions align-right"><span class="skeleton-line w-md"></span></td></tr>'
      )
      .join("");
  }

  function setStorage(storage) {
    state.storage = storage;
    state.folder = "";
    state.query = "";
    searchInput.value = "";
    searchClear.hidden = true;
    state.files = [];
    state.usage = null;
    document.querySelectorAll(".storage-tab").forEach((el) => {
      el.classList.toggle("active", el.dataset.storage === storage);
    });
    render();
    loadUsage();
    load();
  }

  async function load() {
    const space = state.storage;
    const folder = state.folder;
    const refreshBtn = document.querySelector("#refresh");
    state.loadingFiles = true;
    refreshBtn.classList.add("is-spinning");
    renderSkeleton();
    try {
      const data = await api("/api/files?storage=" + encodeURIComponent(space) + "&folder=" + encodeURIComponent(folder));
      if (space !== state.storage || folder !== state.folder) return;
      state.files = data.files || [];
      state.loadingFiles = false;
      render();
      renderUsage();
    } catch (error) {
      state.loadingFiles = false;
      if (error.status === 401 || error.message.includes("登录")) {
        showAuth("会话已过期，请重新登录");
      } else {
        toast(error.message, "error");
        render();
      }
    } finally {
      refreshBtn.classList.remove("is-spinning");
    }
  }

  function render() {
    const folders = state.files.filter((x) => x.kind === "folder");
    const files = state.files.filter((x) => x.kind === "file");
    const selected = r2Helpers.selectedR2();

    document.querySelector("#fileCount").textContent = String(files.length);
    document.querySelector("#folderCount").textContent = String(folders.length);
    document.querySelector("#storageName").textContent = selected ? selected.name : state.storage === "aws" ? "AWS S3" : "R2";
    document.querySelector("#storageHint").textContent =
      state.storage === "aws" ? state.aws?.bucket || "未配置" : selected?.bucket || "Cloudflare R2";
    document.querySelector("#activeSpaceBadge").textContent = currentSpaceLabel();

    notice.hidden = !(state.storage === "aws" && !state.aws?.enabled);

    // 面包屑路径导航
    const parts = state.folder.split("/").filter(Boolean);
    const crumbHtml = [
      `<button type="button" class="crumb${parts.length === 0 ? " is-current" : ""}" data-go="">全部文件</button>`,
    ];
    parts.forEach((part, idx) => {
      const target = parts.slice(0, idx + 1).join("/") + "/";
      const isLast = idx === parts.length - 1;
      crumbHtml.push('<span class="crumb-sep" aria-hidden="true">/</span>');
      crumbHtml.push(
        `<button type="button" class="crumb${isLast ? " is-current" : ""}" data-go="${esc(encodeURIComponent(target))}">${esc(part)}</button>`
      );
    });
    crumbs.innerHTML = crumbHtml.join("");

    if (state.loadingFiles) {
      renderSkeleton();
      return;
    }

    const q = state.query.trim().toLowerCase();
    const visible = q ? state.files.filter((item) => String(item.name || "").toLowerCase().includes(q)) : state.files;

    if (!visible.length) {
      if (q) {
        rows.innerHTML = `<tr><td colspan="4" class="empty"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div><b>未找到匹配 “${esc(state.query.trim())}” 的项目</b><small>请尝试其他关键词或清空筛选条件</small><div class="empty-actions"><button type="button" class="button secondary" data-clear-filter="1">清空筛选</button></div></td></tr>`;
      } else {
        rows.innerHTML =
          '<tr><td colspan="4" class="empty"><div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></div><b>当前目录还没有文件</b><small>将文件拖拽到此面板，或点击右上方按钮上传文件、新建文件夹</small></td></tr>';
      }
      return;
    }

    rows.innerHTML = visible
      .map((file) => {
        const icon = iconSvgFor(file);
        const safeId = esc(file.id);
        const safeName = esc(file.name);
        const openPath = esc(encodeURIComponent(state.folder + file.name + "/"));
        const shareCount = Number(file.shareCount || 0);
        const shareActive = Number(file.shareActive || 0);
        const shareDownloads = Number(file.shareDownloads || 0);
        const shareTitleTip = esc(
          (shareActive > 0 ? `${shareActive} 个有效取件码` : "历史分享已全部过期") +
            (shareDownloads > 0 ? ` · 累计下载 ${shareDownloads} 次` : "") +
            "，点击查看分享"
        );
        const shareBadge =
          file.kind === "file" && shareCount > 0
            ? `<button type="button" class="share-badge${shareActive > 0 ? "" : " expired"}" data-share="${safeId}" title="${shareTitleTip}">${
                shareActive > 0 ? `已分享 ${shareActive}` : "已过期"
              }${shareDownloads > 0 ? `<i class="share-badge-dl">↓ ${shareDownloads}</i>` : ""}</button>`
            : "";

        const nameCell =
          file.kind === "folder"
            ? `<button type="button" class="file-name-btn" data-open="${openPath}"><span class="file-icon ${icon.cls}">${icon.svg}</span><strong title="${safeName}">${safeName}</strong></button>`
            : `<span class="file-icon ${icon.cls}">${icon.svg}</span><strong title="${safeName}">${safeName}</strong>${shareBadge}`;

        const timeText = esc(
          new Date(Number(file.updatedAt || 0) * 1000).toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        );

        const actionsHtml =
          file.kind === "folder"
            ? `<button type="button" class="table-button" data-open="${openPath}">打开</button>`
            : `<a class="table-button" href="/api/download?id=${encodeURIComponent(file.id)}" rel="noopener">下载</a><button type="button" class="table-button" data-share="${safeId}">分享</button>`;

        return `<tr><td class="col-name"><div class="file-name">${nameCell}</div></td><td class="col-size">${
          file.kind === "folder" ? "文件夹" : esc(fmt(file.size))
        }</td><td class="col-time">${timeText}</td><td class="col-actions align-right row-actions">${actionsHtml}<button type="button" class="table-button delete" data-delete="${safeId}">删除</button></td></tr>`;
      })
      .join("");
  }

  // 登录与显隐密码
  togglePasswordBtn.addEventListener("click", () => {
    const showing = passwordInput.type === "text";
    passwordInput.type = showing ? "password" : "text";
    togglePasswordBtn.setAttribute("aria-label", showing ? "显示密码" : "隐藏密码");
    togglePasswordBtn.innerHTML = showing
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
  });

  document.querySelector("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    loginErrorBox.hidden = true;
    loginErrorText.textContent = "";
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = "正在验证身份…";
    try {
      await api("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput.value }),
      });
      // 登录成功后立即清空密码输入框，避免密码长期驻留页面内存
      passwordInput.value = "";
      passwordInput.type = "password";
      showApp();
    } catch (err) {
      loginErrorText.textContent = err.message;
      loginErrorBox.hidden = false;
      passwordInput.select();
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = "进入控制台";
    }
  });

  document.querySelector("#logout").addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      passwordInput.value = "";
      showAuth();
      toast("已安全退出登录");
    }
  });

  document.querySelector("#refresh").addEventListener("click", () => {
    load();
    loadUsage(false);
  });

  document.querySelector("#usageRefresh").addEventListener("click", () => loadUsage(true));
  document.querySelector("#noticeConfigure").addEventListener("click", () => document.querySelector("#openSettings").click());

  document.querySelectorAll(".storage-tab").forEach((el) => {
    el.addEventListener("click", () => setStorage(el.dataset.storage));
  });

  // 搜索筛选
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    searchClear.hidden = !state.query;
    render();
  });

  searchClear.addEventListener("click", () => {
    state.query = "";
    searchInput.value = "";
    searchClear.hidden = true;
    render();
    searchInput.focus();
  });

  crumbs.addEventListener("click", (e) => {
    const target = e.target.closest("[data-go]");
    if (!target) return;
    state.folder = safeDecode(target.dataset.go);
    state.query = "";
    searchInput.value = "";
    searchClear.hidden = true;
    load();
  });

  rows.addEventListener("click", (e) => {
    const clearBtn = e.target.closest("[data-clear-filter]");
    if (clearBtn) {
      state.query = "";
      searchInput.value = "";
      searchClear.hidden = true;
      render();
      return;
    }
    const open = e.target.closest("[data-open]");
    if (open) {
      state.folder = safeDecode(open.dataset.open);
      state.query = "";
      searchInput.value = "";
      searchClear.hidden = true;
      load();
      return;
    }
    const del = e.target.closest("[data-delete]");
    if (del) {
      removeFile(del.dataset.delete);
      return;
    }
    const shareBtn = e.target.closest("[data-share]");
    if (shareBtn) {
      shareFile(shareBtn.dataset.share);
    }
  });

  // 新建文件夹弹窗
  const folderDialog = document.querySelector("#folderDialog");
  const folderForm = document.querySelector("#folderForm");
  const folderNameInput = document.querySelector("#folderNameInput");
  const folderPathPreview = document.querySelector("#folderPathPreview");
  const folderStatus = document.querySelector("#folderStatus");
  const folderConfirm = document.querySelector("#folderConfirm");

  function updateFolderPreview() {
    const raw = folderNameInput.value.trim();
    const preview = "/" + state.folder + (raw ? raw + "/" : "");
    folderPathPreview.innerHTML = `创建位置：<code>${esc(preview)}</code>`;
  }

  document.querySelector("#newFolder").addEventListener("click", () => {
    folderNameInput.value = "";
    setStatus(folderStatus, "");
    updateFolderPreview();
    folderDialog.showModal();
    folderNameInput.focus();
  });

  folderNameInput.addEventListener("input", () => {
    setStatus(folderStatus, "");
    updateFolderPreview();
  });

  document.querySelector("#folderCancel").addEventListener("click", () => folderDialog.close());
  document.querySelector("#folderClose").addEventListener("click", () => folderDialog.close());
  bindBackdropClose(folderDialog);

  folderForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = folderNameInput.value.trim();
    if (!name) {
      setStatus(folderStatus, "请输入文件夹名称", "error");
      return;
    }
    if (/[\\/\u0000-\u001f\u007f]/.test(name) || name === "." || name === ".." || name === ".connection-check") {
      setStatus(folderStatus, "名称不能包含斜杠、控制字符或保留目录符号", "error");
      return;
    }
    folderConfirm.disabled = true;
    setStatus(folderStatus, "正在创建文件夹…");
    try {
      await api("/api/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: state.folder + name, storage: state.storage }),
      });
      folderDialog.close();
      toast(`已创建文件夹「${name}」`, "success");
      load();
    } catch (error) {
      setStatus(folderStatus, error.message, "error");
    } finally {
      folderConfirm.disabled = false;
    }
  });

  // 文件上传（按钮选择与拖拽上传共用同一管线）
  function putFile(info, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", info.uploadUrl);
      xhr.setRequestHeader("Content-Type", info.contentType || "application/octet-stream");
      if (!info.direct) xhr.setRequestHeader("X-File-Size", String(file.size));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let data = null;
          try {
            data = JSON.parse(xhr.responseText);
          } catch {
            data = null;
          }
          resolve(data);
        } else {
          let err = `上传失败（状态码 ${xhr.status}）`;
          try {
            const d = JSON.parse(xhr.responseText);
            if (d.error) err = d.error;
          } catch {
            // 保留默认提示
          }
          reject(new Error(err));
        }
      };
      xhr.onerror = () => reject(new Error("网络异常，上传已中断"));
      xhr.send(file);
    });
  }

  async function uploadFiles(fileList) {
    const files = [...fileList].filter(Boolean);
    if (!files.length || state.uploading) return;
    if (state.storage === "aws" && !state.aws?.enabled) {
      toast("请先配置并启用 AWS S3 储存桶", "error");
      return;
    }
    const space = state.storage;
    const folder = state.folder;
    const uploadBtn = document.querySelector("#uploadButton");
    state.uploading = true;
    uploadBtn.disabled = true;
    uploadBanner.hidden = false;

    let okCount = 0;
    let overwriteCount = 0;
    try {
      for (let idx = 0; idx < files.length; idx += 1) {
        const file = files[idx];
        const prefix = files.length > 1 ? `[${idx + 1}/${files.length}] ` : "";
        uploadBannerFile.textContent = `${prefix}正在准备上传 ${file.name}`;
        uploadBannerPct.textContent = "0%";
        uploadBannerFill.style.width = "0%";
        statusEl.textContent = `准备上传 ${file.name}`;

        const info = await api("/api/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: folder + file.name, storage: space, size: file.size, contentType: file.type }),
        });

        const putRes = await putFile(info, file, (pct) => {
          uploadBannerFile.textContent = `${prefix}正在上传 ${file.name}`;
          uploadBannerPct.textContent = `${pct}%`;
          uploadBannerFill.style.width = `${pct}%`;
        });

        let compRes = {};
        if (info.direct) {
          uploadBannerFile.textContent = `${prefix}正在核验落盘 ${file.name}`;
          compRes = await api("/api/upload-complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: folder + file.name, storage: space, size: file.size, contentType: file.type }),
          });
        }

        const isOverwritten = info.direct ? Boolean(compRes?.overwritten) : Boolean(putRes?.overwritten);
        okCount += 1;
        if (isOverwritten) overwriteCount += 1;
        uploadBannerPct.textContent = "100%";
        uploadBannerFill.style.width = "100%";
      }
      if (overwriteCount > 0 && okCount === 1) {
        toast("文件已覆盖更新，原取件码与链接保持有效", "success");
      } else if (overwriteCount > 0) {
        toast(`已完成 ${okCount} 个文件上传（含 ${overwriteCount} 个覆盖更新）`, "success");
      } else {
        toast(`已成功上传 ${okCount} 个文件`, "success");
      }
    } catch (error) {
      statusEl.textContent = error.message;
      toast(error.message, "error");
    } finally {
      state.uploading = false;
      uploadBtn.disabled = false;
      setTimeout(() => {
        if (!state.uploading) uploadBanner.hidden = true;
      }, 900);
      load();
      loadUsage(true);
    }
  }

  document.querySelector("#uploadButton").addEventListener("click", () => document.querySelector("#filePicker").click());
  document.querySelector("#filePicker").addEventListener("change", (e) => {
    const picked = e.target.files;
    uploadFiles(picked);
    e.target.value = "";
  });

  // 拖拽上传支持
  let dragDepth = 0;
  filePanel.addEventListener("dragenter", (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
    dragDepth += 1;
    dropOverlayPath.textContent = `将上传到「/${state.folder || ""}」`;
    filePanel.classList.add("is-dragover");
    dropOverlay.hidden = false;
  });
  filePanel.addEventListener("dragover", (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes("Files")) return;
    e.preventDefault();
  });
  filePanel.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      filePanel.classList.remove("is-dragover");
      dropOverlay.hidden = true;
    }
  });
  filePanel.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    filePanel.classList.remove("is-dragover");
    dropOverlay.hidden = true;
    if (e.dataTransfer?.files?.length) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  // 删除文件或目录
  async function removeFile(id) {
    const item = state.files.find((x) => x.id === id);
    const isFolder = item?.kind === "folder";
    const confirmed = await confirmAction({
      title: isFolder ? "确认删除文件夹" : "确认删除文件",
      target: item ? item.name : id,
      message: isFolder
        ? "删除文件夹将一并清除其中的全部子文件与关联取件码，此操作不可撤销。"
        : "删除后底层对象及关联取件码将永久失效，此操作不可撤销。",
      confirmLabel: "确认删除",
    });
    if (!confirmed) return;
    try {
      await api("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      toast("已删除", "success");
      load();
      loadUsage(true);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  // 分享弹窗
  const shareDialog = document.querySelector("#shareDialog");
  const shareTitleInput = document.querySelector("#shareTitle");
  const shareTitleCount = document.querySelector("#shareTitleCount");
  const shareTitleEcho = document.querySelector("#shareTitleEcho");
  const shareStatusEl = document.querySelector("#shareStatus");

  function syncTitleCount() {
    shareTitleCount.textContent = `${shareTitleInput.value.length} / 60`;
  }
  shareTitleInput.addEventListener("input", syncTitleCount);

  function shareExpiryText(s) {
    if (s.remaining !== null && s.remaining !== undefined) {
      return `限次分享 · 剩余 ${Number(s.remaining)} 次`;
    }
    if (!s.expiresAt) return "永久有效";
    const left = s.expiresAt - Math.floor(Date.now() / 1000);
    if (left <= 0) return "已过期";
    const d = Math.floor(left / 86400);
    const h = Math.floor((left % 86400) / 3600);
    const m = Math.max(1, Math.floor((left % 3600) / 60));
    const remain = d > 0 ? `${d} 天 ${h} 小时` : h > 0 ? `${h} 小时 ${m} 分` : `${m} 分钟`;
    return `剩余 ${remain} · ${new Date(s.expiresAt * 1000).toLocaleDateString("zh-CN")} 过期`;
  }

  function renderShareList(list) {
    document.querySelector("#shareList").innerHTML = list
      .map((s) => {
        const safeCode = esc(s.code);
        const link = `${location.origin}/pickup/${encodeURIComponent(s.code)}`;
        return `<div class="share-item"><div class="share-item-top"><div class="share-item-code"><strong>${safeCode}</strong></div><div class="share-item-btns"><button type="button" class="table-button" data-copy-code="${safeCode}">复制码</button><button type="button" class="table-button" data-copy-url="${esc(link)}">复制链接</button></div></div>${
          s.title ? `<p class="share-item-title">${esc(s.title)}</p>` : ""
        }<div class="share-item-meta"><span>${esc(shareExpiryText(s))}</span><span>已下载 ${Number(
          s.downloads || 0
        )} 次</span><a class="share-item-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">打开取件页</a></div></div>`;
      })
      .join("");
  }

  async function shareFile(id) {
    const file = state.files.find((x) => x.id === id);
    shareState = { fileId: id, style: "day", value: 7, existing: [] };
    document.querySelector("#shareFileName").textContent = file ? file.name : "—";
    shareTitleInput.value = "";
    syncTitleCount();
    setStatus(shareStatusEl, "正在查询历史分享…");
    document.querySelector("#shareResult").hidden = true;
    document.querySelector("#shareStage").hidden = true;
    document.querySelector("#shareExisting").hidden = true;
    document.querySelector("#shareConfirm").hidden = true;
    document.querySelector("#shareConfirm").disabled = false;
    document.querySelector("#shareNewLink").hidden = true;
    document.querySelectorAll(".share-option").forEach((x) => {
      x.classList.toggle("active", x.dataset.style === "day" && x.dataset.value === "7");
    });
    shareDialog.showModal();
    try {
      const data = await api("/api/share?fileId=" + encodeURIComponent(id));
      const active = (data.shares || []).filter((s) => !s.expired && !s.exhausted);
      shareState.existing = active;
      setStatus(shareStatusEl, "");
      if (active.length) {
        renderShareList(active);
        document.querySelector("#shareExisting").hidden = false;
        document.querySelector("#shareNewLink").hidden = false;
      } else {
        document.querySelector("#shareStage").hidden = false;
        document.querySelector("#shareConfirm").hidden = false;
      }
    } catch (error) {
      setStatus(shareStatusEl, error.message, "error");
      document.querySelector("#shareStage").hidden = false;
      document.querySelector("#shareConfirm").hidden = false;
    }
  }

  document.querySelectorAll(".share-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".share-option").forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      shareState.style = btn.dataset.style;
      shareState.value = Number(btn.dataset.value);
    });
  });

  document.querySelector("#shareClose").addEventListener("click", () => shareDialog.close());
  document.querySelector("#shareCloseTop").addEventListener("click", () => shareDialog.close());
  bindBackdropClose(shareDialog);

  document.querySelector("#shareNewLink").addEventListener("click", () => {
    document.querySelector("#shareExisting").hidden = true;
    document.querySelector("#shareNewLink").hidden = true;
    document.querySelector("#shareStage").hidden = false;
    document.querySelector("#shareConfirm").hidden = false;
    setStatus(shareStatusEl, "");
  });

  document.querySelector("#shareConfirm").addEventListener("click", async () => {
    const btn = document.querySelector("#shareConfirm");
    btn.disabled = true;
    setStatus(shareStatusEl, "正在生成安全取件码…");
    try {
      const data = await api("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: shareState.fileId,
          title: shareTitleInput.value,
          style: shareState.style,
          value: shareState.style === "forever" ? 0 : shareState.value || 7,
        }),
      });
      document.querySelector("#shareCode").textContent = data.code;
      document.querySelector("#shareUrl").value = data.url;
      if (data.title) {
        shareTitleEcho.textContent = data.title;
        shareTitleEcho.hidden = false;
      } else {
        shareTitleEcho.textContent = "";
        shareTitleEcho.hidden = true;
      }
      document.querySelector("#shareStage").hidden = true;
      document.querySelector("#shareResult").hidden = false;
      btn.hidden = true;
      setStatus(shareStatusEl, "");
      load();
    } catch (error) {
      setStatus(shareStatusEl, error.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  document.querySelector("#shareList").addEventListener("click", (e) => {
    const codeBtn = e.target.closest("[data-copy-code]");
    if (codeBtn) {
      copyText(codeBtn.dataset.copyCode, "取件码");
      return;
    }
    const urlBtn = e.target.closest("[data-copy-url]");
    if (urlBtn) {
      copyText(urlBtn.dataset.copyUrl, "分享链接");
    }
  });

  document.querySelector("#copyLink").addEventListener("click", () => copyText(document.querySelector("#shareUrl").value, "分享链接"));
  document.querySelector("#copyCode").addEventListener("click", () => copyText(document.querySelector("#shareCode").textContent, "取件码"));
  document.querySelector("#copyShareText").addEventListener("click", () => {
    const t = shareTitleEcho.hidden ? "" : shareTitleEcho.textContent.trim();
    const code = document.querySelector("#shareCode").textContent.trim();
    const url = document.querySelector("#shareUrl").value.trim();
    copyText((t ? t + "\n" : "") + `取件码：${code}\n${url}`, "完整分享文案");
  });

  // AWS S3 设置弹窗
  const settingsDialog = document.querySelector("#settingsDialog");
  const cfgStatus = document.querySelector("#cfgStatus");
  const awsCorsJson = JSON.stringify(
    [
      {
        AllowedOrigins: [location.origin, "https://pan.ailxw.com"].filter((v, i, a) => a.indexOf(v) === i),
        AllowedMethods: ["GET", "PUT", "HEAD", "DELETE"],
        AllowedHeaders: ["*"],
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 3600,
      },
    ],
    null,
    2
  );
  document.querySelector("#awsCors").textContent = awsCorsJson;
  document.querySelector("#copyAwsCors").addEventListener("click", () => copyText(awsCorsJson, "跨域配置"));

  document.querySelector("#openSettings").addEventListener("click", () => {
    const a = state.aws || {};
    document.querySelector("#cfgEnabled").checked = Boolean(a.enabled);
    document.querySelector("#cfgBucket").value = a.bucket || "";
    document.querySelector("#cfgRegion").value = a.region || "us-east-1";
    document.querySelector("#cfgPrefix").value = a.prefix || "";
    document.querySelector("#cfgCapacity").value = a.capacityGb || 250;
    document.querySelector("#cfgTransfer").value = a.monthlyTransferGb || 500;
    document.querySelector("#cfgAccess").value = "";
    document.querySelector("#cfgSecret").value = "";
    setStatus(cfgStatus, a.hasCredentials ? "密钥已安全加密保存，留空即可继续沿用" : "首次启用需要填写访问密钥编号与私密密钥");
    settingsDialog.showModal();
  });

  document.querySelector("#awsClose").addEventListener("click", () => settingsDialog.close());
  document.querySelector("#awsCancel").addEventListener("click", () => settingsDialog.close());
  bindBackdropClose(settingsDialog);

  document.querySelector("#saveAws").addEventListener("click", async () => {
    const button = document.querySelector("#saveAws");
    button.disabled = true;
    setStatus(cfgStatus, "正在验证储存桶连通与权限…", "warn");
    try {
      await api("/api/storage-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: document.querySelector("#cfgEnabled").checked,
          bucket: document.querySelector("#cfgBucket").value,
          region: document.querySelector("#cfgRegion").value,
          prefix: document.querySelector("#cfgPrefix").value,
          capacityGb: Number(document.querySelector("#cfgCapacity").value),
          monthlyTransferGb: Number(document.querySelector("#cfgTransfer").value),
          accessKey: document.querySelector("#cfgAccess").value,
          secretKey: document.querySelector("#cfgSecret").value,
        }),
      });
      document.querySelector("#cfgAccess").value = "";
      document.querySelector("#cfgSecret").value = "";
      settingsDialog.close();
      toast("AWS 设置已验证并保存", "success");
      await loadAws();
      if (state.storage === "aws") {
        load();
        loadUsage(true);
      }
    } catch (error) {
      setStatus(cfgStatus, error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#removeAws").addEventListener("click", async () => {
    const confirmed = await confirmAction({
      title: "停用并清除 AWS S3 配置",
      target: state.aws?.bucket || "当前 AWS S3 配置",
      message: "停用后将清除已加密保存的接入密钥，但不会删除 AWS 储存桶内已有对象。",
      confirmLabel: "停用并清除",
    });
    if (!confirmed) return;
    try {
      await api("/api/storage-config", { method: "DELETE" });
      settingsDialog.close();
      toast("已停用并清除 AWS 配置", "success");
      await loadAws();
      if (state.storage === "aws") setStorage("r2");
    } catch (error) {
      setStatus(cfgStatus, error.message, "error");
    }
  });

  function showApp() {
    authView.hidden = true;
    appView.hidden = false;
    loadUsage();
    Promise.all([loadAws(), r2Helpers.loadR2Accounts()])
      .then(() => {
        updateSpaceCount();
        return load();
      })
      .catch((error) => toast(error.message, "error"));
  }

  async function boot() {
    try {
      const auth = await api("/api/auth/login");
      if (auth.admin) showApp();
    } catch {
      // 未登录时停留在登录页
    }
  }

  window.PanAdmin = {
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
    setR2Helpers(helpers) {
      r2Helpers = { ...r2Helpers, ...helpers };
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    queueMicrotask(boot);
  }
})();
