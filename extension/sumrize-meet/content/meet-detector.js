(function (global) {
  "use strict";

  const MEET_CODE_PATTERN = /([a-z]{3}-[a-z]{4}-[a-z]{3})/i;

  function getMeetCode() {
    const match = window.location.pathname.match(MEET_CODE_PATTERN);
    return match ? match[1].toLowerCase() : null;
  }

  function isValidMeetingPage() {
    if (window.location.hostname !== "meet.google.com") return false;
    return Boolean(getMeetCode());
  }

  function isInCall() {
    try {
      return Boolean(
        document.querySelector(
          '[aria-label*="Leave call" i], [aria-label*="Tinggalkan panggilan" i], [aria-label*="Keluar dari panggilan" i]'
        )
      );
    } catch {
      return false;
    }
  }

  function getCurrentUserAccount() {
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
    let detectedEmail = null;
    let detectedName = null;

    // 1. Cek atribut data-email langsung
    const dataEmailEl = document.querySelector('[data-email]');
    if (dataEmailEl) {
      const emailAttr = dataEmailEl.getAttribute('data-email');
      if (emailAttr && emailAttr.includes('@')) {
        detectedEmail = emailAttr.trim().toLowerCase();
      }
    }

    // 2. Cek atribut data-identifier
    if (!detectedEmail) {
      const identEl = document.querySelector('[data-identifier*="@"]');
      if (identEl) {
        const identAttr = identEl.getAttribute('data-identifier');
        if (identAttr && identAttr.includes('@')) {
          detectedEmail = identAttr.trim().toLowerCase();
        }
      }
    }

    // 3. Cek tombol Akun Google via aria-label
    if (!detectedEmail) {
      const ariaElements = document.querySelectorAll('[aria-label*="@"]');
      for (const el of ariaElements) {
        const label = el.getAttribute('aria-label') || '';
        const match = label.match(emailRegex);
        if (match) {
          detectedEmail = match[1].toLowerCase();
          // Coba ekstrak nama dari label: "Akun Google: Nama (email)" atau "Google Account: Nama\n(email)"
          const nameMatch = label.match(/(?:Akun Google|Google Account):\s*([^(\n\r]+)/i);
          if (nameMatch && nameMatch[1]) {
            detectedName = nameMatch[1].trim();
          }
          break;
        }
      }
    }

    // 4. Cek tautan SignOut / Switch account
    if (!detectedEmail) {
      const accountLinks = document.querySelectorAll('a[href*="accounts.google.com"], a[href*="SignOutOptions"]');
      for (const el of accountLinks) {
        const text = (el.getAttribute('aria-label') || '') + ' ' + (el.title || '') + ' ' + (el.innerText || '');
        const match = text.match(emailRegex);
        if (match) {
          detectedEmail = match[1].toLowerCase();
          break;
        }
      }
    }

    // 5. Cek script tags atau window.WIZ_global_data
    if (!detectedEmail && typeof window.WIZ_global_data === 'object' && window.WIZ_global_data) {
      try {
        for (const val of Object.values(window.WIZ_global_data)) {
          if (typeof val === 'string' && val.includes('@')) {
            const match = val.match(emailRegex);
            if (match) {
              detectedEmail = match[1].toLowerCase();
              break;
            }
          }
        }
      } catch {}
    }

    return {
      email: detectedEmail,
      name: detectedName
    };
  }

  const MIC_BUTTON_SELECTORS = [
    'button[data-is-muted]',
    'div[role="button"][data-is-muted]',
    'button[aria-label*="+ d" i]',
    'button[data-tooltip*="+ d" i]',
    'div[role="button"][aria-label*="+ d" i]',
    'div[role="button"][data-tooltip*="+ d" i]',
    'button[aria-label*="microphone" i]',
    'button[aria-label*="mikrofon" i]',
    'div[role="button"][aria-label*="microphone" i]',
    'div[role="button"][aria-label*="mikrofon" i]',
    '[data-is-muted]'
  ];

  function getMicButton() {
    for (const selector of MIC_BUTTON_SELECTORS) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const label = (el.getAttribute("aria-label") || el.getAttribute("data-tooltip") || "").toLowerCase();
        if (label.includes("camera") || label.includes("kamera") || label.includes("video")) {
          continue;
        }
        if (
          label.includes("+ d") ||
          label.includes("ctrl + d") ||
          label.includes("⌘ + d") ||
          label.includes("mic") ||
          label.includes("mikrofon") ||
          el.hasAttribute("data-is-muted")
        ) {
          return el;
        }
      }
    }
    return null;
  }

  function isMicMuted() {
    // 1. Cek tombol mikrofon utama di bottom bar
    const btn = getMicButton();
    if (btn) {
      if (btn.hasAttribute("data-is-muted")) {
        return btn.getAttribute("data-is-muted") === "true";
      }

      const label = (btn.getAttribute("aria-label") || btn.getAttribute("data-tooltip") || "").toLowerCase();
      // 1. Indikator tombol untuk mematikan mic (berarti saat ini sedang AKTIF / UNMUTED)
      if (
        label.includes("turn off") ||
        label.includes("nonaktifkan") ||
        label.includes("matikan") ||
        label.includes("désactiver") ||
        label.includes("desactivar") ||
        (label.includes("mute") && !label.includes("unmute"))
      ) {
        return false;
      }

      // 2. Indikator tombol untuk menyalakan mic (berarti saat ini sedang NONAKTIF / MUTED)
      if (
        label.includes("turn on") ||
        label.includes("aktifkan") ||
        label.includes("nyalakan") ||
        label.includes("unmute") ||
        label.includes("activer") ||
        label.includes("activar") ||
        label.includes("stumm")
      ) {
        return true;
      }
    }

    // 2. Cek indikator data-is-muted di tile lokal peserta
    const selfTileIndicator = document.querySelector(
      '[data-requested-participant-id="self"] [data-is-muted], [data-self-name] [data-is-muted]'
    );
    if (selfTileIndicator && selfTileIndicator.hasAttribute("data-is-muted")) {
      return selfTileIndicator.getAttribute("data-is-muted") === "true";
    }

    // 3. Fallback: cari elemen apa saja yang memiliki data-is-muted selain kamera
    const anyMuted = document.querySelectorAll('[data-is-muted]');
    for (const el of anyMuted) {
      const lbl = (el.getAttribute("aria-label") || el.getAttribute("data-tooltip") || "").toLowerCase();
      if (!lbl.includes("camera") && !lbl.includes("kamera") && !lbl.includes("video")) {
        return el.getAttribute("data-is-muted") === "true";
      }
    }

    return false;
  }

  function watchMicStatus(callback) {
    if (typeof callback !== "function") return () => {};

    let lastMuted = isMicMuted();
    callback(lastMuted);

    const check = () => {
      const current = isMicMuted();
      if (current !== lastMuted) {
        lastMuted = current;
        callback(current);
      }
    };

    let observer = null;
    try {
      observer = new MutationObserver(() => check());
      if (document.body) {
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ["data-is-muted", "aria-label", "data-tooltip", "class"],
          subtree: true
        });
      }
    } catch {}

    const intervalId = setInterval(check, 300);

    const keyHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        setTimeout(check, 80);
        setTimeout(check, 300);
      }
    };
    window.addEventListener("keydown", keyHandler, true);

    return function unwatch() {
      if (observer) {
        try { observer.disconnect(); } catch {}
        observer = null;
      }
      clearInterval(intervalId);
      window.removeEventListener("keydown", keyHandler, true);
    };
  }

  global.SumrizeMeetDetector = {
    getMeetCode,
    isValidMeetingPage,
    isInCall,
    getCurrentUserAccount,
    getMicButton,
    isMicMuted,
    watchMicStatus
  };
})(window);