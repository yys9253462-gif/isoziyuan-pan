// 公开取件码首页交互逻辑（外置脚本以满足严格内容安全策略）
(() => {
  const grid = document.querySelector("#codeGrid");
  const boxes = [...document.querySelectorAll(".code-grid input")];
  const button = document.querySelector("#pickupButton");
  const buttonText = document.querySelector("#pickupButtonText");
  const helper = document.querySelector("#codeHelper");
  const clearButton = document.querySelector("#clearCode");
  const form = document.querySelector("#pickupForm");

  function currentCode() {
    return boxes.map((input) => input.value.trim()).join("");
  }

  function sync() {
    let filledCount = 0;
    boxes.forEach((input) => {
      const filled = Boolean(input.value.trim());
      input.classList.toggle("is-filled", filled);
      if (filled) filledCount += 1;
    });
    const ready = filledCount === 5;
    button.disabled = !ready;
    clearButton.hidden = filledCount === 0;
    if (ready) {
      helper.textContent = "已输入 5 位取件码，按回车或点击按钮提取";
    } else if (filledCount > 0) {
      helper.textContent = `已输入 ${filledCount} / 5 位数字`;
    } else {
      helper.textContent = "可直接粘贴取件链接或 5 位数字";
    }
  }

  // 从粘贴文案或取件链接中优先识别五位取件码
  function extractCode(text) {
    const raw = String(text || "");
    const fromLink = raw.match(/(?:pickup\/|[?&]code=|取件码[：:\s]*)(\d{5})/);
    if (fromLink) return fromLink[1];
    const standalone = raw.match(/(?:^|\D)(\d{5})(?:\D|$)/);
    if (standalone) return standalone[1];
    return raw.replace(/\D/g, "").slice(0, 5);
  }

  function fill(text) {
    const digits = extractCode(text);
    if (!digits) {
      shake();
      return;
    }
    boxes.forEach((input, idx) => {
      input.value = digits[idx] || "";
    });
    const nextIdx = Math.min(digits.length, 4);
    boxes[nextIdx].focus();
    sync();
  }

  function shake() {
    grid.classList.remove("is-shake");
    void grid.offsetWidth;
    grid.classList.add("is-shake");
  }

  function submitCode() {
    const code = currentCode();
    if (!/^\d{5}$/.test(code)) {
      shake();
      const firstEmpty = boxes.find((input) => !input.value.trim()) || boxes[0];
      firstEmpty.focus();
      return;
    }
    button.disabled = true;
    buttonText.textContent = "正在前往取件页…";
    location.href = "/pickup/" + code;
  }

  boxes.forEach((box, i) => {
    box.addEventListener("input", () => {
      const cleaned = box.value.replace(/\D/g, "");
      if (cleaned.length > 1) {
        fill(cleaned);
        return;
      }
      box.value = cleaned.slice(-1);
      if (box.value && i < 4) boxes[i + 1].focus();
      sync();
    });

    box.addEventListener("focus", () => {
      box.select();
    });

    box.addEventListener("keydown", (e) => {
      if (e.key === "Backspace") {
        if (!box.value && i > 0) {
          boxes[i - 1].value = "";
          boxes[i - 1].focus();
          sync();
          e.preventDefault();
        }
        return;
      }
      if (e.key === "ArrowLeft" && i > 0) {
        boxes[i - 1].focus();
        e.preventDefault();
      } else if (e.key === "ArrowRight" && i < 4) {
        boxes[i + 1].focus();
        e.preventDefault();
      } else if (e.key === "Home") {
        boxes[0].focus();
        e.preventDefault();
      } else if (e.key === "End") {
        boxes[4].focus();
        e.preventDefault();
      } else if (e.key === "Enter" && currentCode().length === 5) {
        e.preventDefault();
        submitCode();
      }
    });

    box.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = e.clipboardData ? e.clipboardData.getData("text") : "";
      fill(text);
    });
  });

  clearButton.addEventListener("click", () => {
    boxes.forEach((input) => {
      input.value = "";
    });
    sync();
    boxes[0].focus();
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitCode();
  });

  // 支持从浏览器返回时恢复按钮状态
  window.addEventListener("pageshow", () => {
    buttonText.textContent = "立即提取";
    sync();
  });

  sync();
})();
