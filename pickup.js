// 公开取件落地页逻辑（外置脚本以满足严格内容安全策略）
(() => {
  const params = new URLSearchParams(location.search);
  const code = (params.get("code") || "").trim();
  const invalidFlag = params.get("invalid") === "1";

  const panel = document.querySelector("#pickupPanel");
  const panelLogo = document.querySelector("#panelLogo");
  const codeLabel = document.querySelector("#codeLabel");
  const pageTitle = document.querySelector("#pageTitle");
  const pageSub = document.querySelector("#pageSub");
  const verifyStage = document.querySelector("#verifyStage");
  const verifyText = document.querySelector("#verifyText");
  const shareTitle = document.querySelector("#shareTitle");
  const fileSummary = document.querySelector("#fileSummary");
  const fileTypeBadge = document.querySelector("#fileTypeBadge");
  const fileNameEl = document.querySelector("#fileName");
  const fileTypeText = document.querySelector("#fileTypeText");
  const fileMeta = document.querySelector("#fileMeta");
  const downloadActions = document.querySelector("#downloadActions");
  const downloadLink = document.querySelector("#download");
  const downloadFeedback = document.querySelector("#downloadFeedback");
  const errorActions = document.querySelector("#errorActions");
  const retryButton = document.querySelector("#retryButton");

  let rendered = false;

  function formatSize(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n < 0) return "0 B";
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1073741824) return `${(n / 1048576).toFixed(2)} MB`;
    return `${(n / 1073741824).toFixed(2)} GB`;
  }

  function formatExpiry(expiresAt) {
    const ts = Number(expiresAt || 0);
    if (!ts) return { text: "永久有效", tone: "is-success" };
    const left = ts - Math.floor(Date.now() / 1000);
    if (left <= 0) return { text: "即将过期", tone: "is-warn" };
    const days = Math.floor(left / 86400);
    const hours = Math.floor((left % 86400) / 3600);
    const mins = Math.max(1, Math.floor((left % 3600) / 60));
    const remain = days > 0 ? `${days} 天 ${hours} 小时` : hours > 0 ? `${hours} 小时 ${mins} 分钟` : `${mins} 分钟`;
    return { text: `有效期剩余 ${remain}`, tone: days < 1 ? "is-warn" : "" };
  }

  function detectFileKind(name) {
    const ext = String(name || "").split(".").pop().toLowerCase();
    if (["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"].includes(ext)) {
      return {
        label: "压缩归档文件",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"></path><path d="M1 3h22v5H1z"></path><path d="M10 12h4"></path></svg>',
      };
    }
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif"].includes(ext)) {
      return {
        label: "图像文件",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>',
      };
    }
    if (["mp4", "mov", "mkv", "avi", "webm"].includes(ext)) {
      return {
        label: "视频文件",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"></rect><polygon points="10 9 15 12 10 15 10 9"></polygon></svg>',
      };
    }
    if (["mp3", "wav", "flac", "aac", "ogg", "m4a"].includes(ext)) {
      return {
        label: "音频文件",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
      };
    }
    if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv"].includes(ext)) {
      return {
        label: "文档资料",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
      };
    }
    if (["exe", "msi", "dmg", "pkg", "apk", "ipa", "deb", "rpm"].includes(ext)) {
      return {
        label: "安装包程序",
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>',
      };
    }
    return {
      label: "分享文件",
      svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
    };
  }

  function makeChip(text, tone = "") {
    const chip = document.createElement("span");
    chip.className = "meta-chip" + (tone ? " " + tone : "");
    chip.textContent = text;
    return chip;
  }

  function showError(error, allowRetry = true) {
    const raw = String((error && error.message) || "");
    const friendly = /fetch|network|load failed|timeout/i.test(raw) ? "网络异常，请稍后重试" : raw || "取件失败";
    panel.classList.remove("is-loading", "is-ready");
    panel.classList.add("is-error");
    panelLogo.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    codeLabel.classList.remove("eyebrow-mono");
    codeLabel.textContent = "无法提取文件";
    pageTitle.textContent = friendly;
    pageSub.textContent = "请核对取件码是否正确、链接是否仍在有效期内";
    verifyStage.hidden = true;
    shareTitle.hidden = true;
    fileSummary.hidden = true;
    downloadActions.hidden = true;
    errorActions.hidden = false;
    retryButton.hidden = !allowRetry;
  }

  function renderFile(data) {
    // 严格校验下载地址前缀，杜绝伪协议跳转
    if (typeof data.downloadUrl !== "string" || !data.downloadUrl.startsWith("/api/pickup-download?")) {
      showError(new Error("下载地址异常，请刷新重试"));
      return;
    }
    panel.classList.remove("is-loading", "is-error");
    panel.classList.add("is-ready");
    verifyStage.hidden = true;
    errorActions.hidden = true;

    pageTitle.textContent = "文件已就绪";
    pageSub.textContent = "验证通过，点击下方按钮即可安全下载";

    if (data.title) {
      shareTitle.textContent = data.title;
      shareTitle.hidden = false;
    } else {
      shareTitle.hidden = true;
    }

    const kind = detectFileKind(data.name);
    fileTypeBadge.innerHTML = kind.svg;
    fileNameEl.textContent = data.name;
    fileTypeText.textContent = kind.label;

    fileMeta.replaceChildren();
    fileMeta.appendChild(makeChip(`大小 ${formatSize(data.size)}`));
    const exp = formatExpiry(data.expiresAt);
    fileMeta.appendChild(makeChip(exp.text, exp.tone));
    if (data.remaining !== null && data.remaining !== undefined) {
      const rem = Number(data.remaining);
      fileMeta.appendChild(makeChip(`剩余 ${rem} 次下载`, rem <= 1 ? "is-warn" : ""));
    }

    fileSummary.hidden = false;
    downloadLink.href = data.downloadUrl;
    downloadActions.hidden = false;
  }

  async function lookup(token) {
    verifyText.textContent = "验证通过，正在获取文件信息…";
    try {
      const response = await fetch(
        "/api/pickup?code=" + encodeURIComponent(code) + "&cf-turnstile-response=" + encodeURIComponent(token),
        { cache: "no-store" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "取件失败");
      }
      renderFile(data);
    } catch (error) {
      showError(error);
    }
  }

  retryButton.addEventListener("click", () => {
    location.reload();
  });

  downloadLink.addEventListener("click", () => {
    downloadFeedback.hidden = false;
  });

  // 立即校验取件码格式，非法参数直接提示而不消耗验证请求
  if (invalidFlag || !/^\d{5}$/.test(code)) {
    showError(new Error("取件码格式无效，需为 5 位数字"), false);
    return;
  }

  codeLabel.classList.add("eyebrow-mono");
  codeLabel.textContent = "取件码 " + code;

  function renderTurnstile() {
    if (rendered || typeof window.turnstile?.render !== "function") return;
    rendered = true;
    verifyText.textContent = "请完成下方安全验证以提取文件";
    window.turnstile.render("#turnstileBox", {
      sitekey: "0x4AAAAAAFb6Yo8w2o7Tq8Z6",
      theme: "dark",
      callback: (token) => {
        document.querySelector("#turnstileBox").hidden = true;
        lookup(token);
      },
      "expired-callback": () => showError(new Error("安全验证已过期，请刷新页面重试")),
      "timeout-callback": () => showError(new Error("安全验证超时，请刷新页面重试")),
      "error-callback": () => showError(new Error("人机验证加载失败，请刷新页面重试")),
    });
  }

  window.onTurnstileLoad = renderTurnstile;
  if (typeof window.turnstile?.render === "function") {
    renderTurnstile();
  }
})();
