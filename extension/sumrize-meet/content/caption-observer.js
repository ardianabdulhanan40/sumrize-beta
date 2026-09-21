/**
 * content/caption-observer.js
 * Membaca Live Captions Google Meet (struktur DOM 2025–2026)
 * Menangkap ucapan dari pembicara lokal (Anda) dan orang lain.
 */
(function (global) {
  "use strict";

  if (global.__SUMRIZE_CAPTION_OBSERVER_LOADED__) {
    return;
  }
  global.__SUMRIZE_CAPTION_OBSERVER_LOADED__ = true;

  const LOG_PREFIX = "[Sumrize Caption]";

  const CONFIG = {
    pollInterval: 500,
    maxTextLength: 600,
    minTextLength: 2,
    maxSpeakerLength: 80
  };

  // Selector tombol CC Google Meet
  const CC_BUTTON_SELECTORS = [
    'button[aria-label*="(c)"]',
    'button[data-tooltip*="(c)"]',
    'button[jsname="r8qRAd"]',
    'button[aria-label*="caption" i]',
    'button[aria-label*="teks" i]',
    'button[aria-label*="subtitle" i]',
    'button[aria-label*="subtitel" i]'
  ];

  // Selector container Live Captions
  const CAPTION_CONTAINER_SELECTORS = [
    '[role="region"][aria-label*="caption" i]',
    '[role="region"][aria-label*="teks" i]',
    '[role="region"][aria-label*="Captions"]',
    '[role="region"][aria-label*="subtitle" i]',
    '[role="region"][aria-label*="subtitel" i]',
    '[role="region"][aria-label*="자막"]',
    'div[jscontroller="D1tHje"]',
    'div[jsname="dsyhDe"]',
    'div[jsname="r4nke"]',
    'div.a4cQT',
    'div[class*="a4cQT"]',
    'div[class*="iTTPOb"]'
  ];

  const UI_PATTERNS = [
    "your transcript has been paused",
    "to resume transcribing",
    "live transcript",
    "transcribing:",
    "settings",
    "captions",
    "cc",
    "mute",
    "unmute",
    "microphone",
    "camera",
    "participants",
    "chat",
    "leave call",
    "leave meeting",
    "tutup panggilan",
    "tinggalkan panggilan",
    "devices",
    "more options",
    "orang lain mungkin masih dapat melihat video",
    "looking for others",
    "turn on captions"
  ];

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function containsUiText(text) {
    if (!text) return true;
    const lower = text.toLowerCase();
    return UI_PATTERNS.some((p) => lower.includes(p));
  }

  function isValidText(text) {
    if (!text) return false;
    if (text.length < CONFIG.minTextLength) return false;
    if (text.length > CONFIG.maxTextLength) return false;
    if (containsUiText(text)) return false;
    return true;
  }

  class SumrizeCaptionObserver {
    constructor(options = {}) {
      this.onCaption =
        typeof options.onCaption === "function" ? options.onCaption : () => {};
      this.running = false;
      this.mutationObserver = null;
      this.pollIntervalId = null;
      this.autoCheckCcIntervalId = null;
      this.sequence = 0;
      this.seenKeys = new Set();
      this.lastSpeaker = "Unknown";
      this.cachedUserName = null;
    }

    log(...args) {
      console.log(LOG_PREFIX, ...args);
    }

    warn(...args) {
      console.warn(LOG_PREFIX, ...args);
    }

    /**
     * Dapatkan nama user lokal
     */
    getUserName() {
      if (this.cachedUserName) return this.cachedUserName;
      try {
        const selfEl = document.querySelector("[data-self-name]");
        if (selfEl && selfEl.getAttribute("data-self-name")) {
          this.cachedUserName = selfEl.getAttribute("data-self-name").trim();
          return this.cachedUserName;
        }
      } catch {}
      return "Anda (Saya)";
    }

    /**
     * Cek apakah Closed Captions (CC) Google Meet sedang AKTIF
     */
    isCaptionsEnabled() {
      for (const selector of CC_BUTTON_SELECTORS) {
        const btns = document.querySelectorAll(selector);
        for (const btn of btns) {
          const isPressed = btn.getAttribute("aria-pressed");
          const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
          const tooltip = (btn.getAttribute("data-tooltip") || "").toLowerCase();

          // Jika aria-pressed="true", pasti aktif
          if (isPressed === "true") {
            return true;
          }

          // Indikator teks nonaktifkan (berarti saat ini sedang aktif)
          if (
            ariaLabel.startsWith("turn off") ||
            ariaLabel.startsWith("nonaktifkan") ||
            ariaLabel.includes("turn off captions") ||
            ariaLabel.includes("nonaktifkan teks") ||
            tooltip.startsWith("turn off") ||
            tooltip.startsWith("nonaktifkan")
          ) {
            return true;
          }
        }
      }
      return false;
    }

    /**
     * Pastikan CC aktif tanpa mematikannya jika sudah menyala
     */
    ensureCaptionsEnabled() {
      try {
        if (this.isCaptionsEnabled()) {
          this.log("Live Captions (CC) Google Meet sudah aktif.");
          return true;
        }

        for (const selector of CC_BUTTON_SELECTORS) {
          const btns = document.querySelectorAll(selector);
          for (const btn of btns) {
            const isPressed = btn.getAttribute("aria-pressed");
            const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();

            // Hanya klik jika saat ini TIDAK aktif
            const isTurnOnBtn =
              isPressed === "false" ||
              ariaLabel.startsWith("turn on") ||
              ariaLabel.startsWith("aktifkan") ||
              ariaLabel.includes("turn on captions") ||
              ariaLabel.includes("aktifkan teks");

            if (isTurnOnBtn) {
              this.log("Mengaktifkan Live Captions (CC) Google Meet secara otomatis...");
              btn.click();
              btn.dispatchEvent(
                new MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                  view: window
                })
              );
              return true;
            }
          }
        }
      } catch (err) {
        this.warn("Gagal auto-enable CC:", err);
      }
      return false;
    }

    /**
     * Cari container live caption di DOM
     */
    findCaptionContainer() {
      for (const selector of CAPTION_CONTAINER_SELECTORS) {
        try {
          const els = document.querySelectorAll(selector);
          for (const el of els) {
            if (el) return el;
          }
        } catch {}
      }

      // Fallback: cari elemen yang memiliki role="region" dengan konten teks aktif
      const regions = document.querySelectorAll('[role="region"]');
      for (const reg of regions) {
        const label = (reg.getAttribute("aria-label") || "").toLowerCase();
        if (
          label.includes("caption") ||
          label.includes("teks") ||
          label.includes("subtit")
        ) {
          return reg;
        }
      }

      return null;
    }

    /**
     * Ekstrak item transkrip dari container secara struktural
     */
    extractRows(container) {
      if (!container) return [];

      const results = [];

      // 1. Strategi berbasis Avatar Gambar (Standar Google Meet)
      const imgs = container.querySelectorAll("img");
      if (imgs.length > 0) {
        for (const img of imgs) {
          try {
            // Speaker nama biasanya ada di elemen saudara dari img
            let speaker = "";
            let text = "";

            const sibling = img.nextElementSibling;
            if (sibling) {
              speaker = normalizeText(sibling.innerText || sibling.textContent);
            }

            // Teks transkrip ada di saudara container avatar
            const parent = img.parentElement;
            if (parent && parent.nextElementSibling) {
              text = normalizeText(
                parent.nextElementSibling.innerText || parent.nextElementSibling.textContent
              );
            }

            // Jika belum dapat teks, cari elemen teks terdekat
            if (!text && parent && parent.parentElement) {
              const textDivs = parent.parentElement.querySelectorAll(
                'div[jsname], span[jsname], [class*="VbkSUe"], [class*="ygicle"]'
              );
              if (textDivs.length > 0) {
                text = normalizeText(textDivs[textDivs.length - 1].innerText);
              }
            }

            if (isValidText(text)) {
              results.push({ speaker: speaker || this.lastSpeaker || "Unknown", text });
            }
          } catch {}
        }
      }

      // 2. Strategi berbasis baris item (div dengan jsname="ys97fc" atau anak langsung)
      if (results.length === 0) {
        const itemNodes = container.querySelectorAll(
          'div[jsname="ys97fc"], [class*="nMcdL"], [class*="CNusmb"]'
        );

        if (itemNodes.length > 0) {
          for (const item of itemNodes) {
            try {
              let speaker = "";
              const speakerEl = item.querySelector(
                '[class*="NWpY1d"], [class*="zQRpq"], [class*="iOzk7"], span'
              );
              if (speakerEl) {
                speaker = normalizeText(speakerEl.innerText || speakerEl.textContent);
              }

              let text = "";
              const textEl = item.querySelector(
                '[class*="VbkSUe"], [class*="ygicle"], span[jsname="tgaKEf"]'
              );
              if (textEl) {
                text = normalizeText(textEl.innerText || textEl.textContent);
              } else {
                // Clone dan hapus speaker
                const clone = item.cloneNode(true);
                if (speakerEl) {
                  clone.querySelectorAll("span, img").forEach((n) => n.remove());
                }
                text = normalizeText(clone.innerText || clone.textContent);
              }

              if (isValidText(text)) {
                results.push({ speaker: speaker || this.lastSpeaker || "Unknown", text });
              }
            } catch {}
          }
        }
      }

      // 3. Fallback: ambil baris teks langsung
      if (results.length === 0) {
        const rawText = normalizeText(container.innerText || container.textContent);
        if (isValidText(rawText) && rawText.length < 300) {
          results.push({ speaker: this.lastSpeaker || "Unknown", text: rawText });
        }
      }

      return results;
    }

    processSpeaker(rawSpeaker) {
      const clean = normalizeText(rawSpeaker);
      if (!clean) return this.lastSpeaker || "Unknown";

      const lower = clean.toLowerCase();
      if (lower === "anda" || lower === "you") {
        return this.getUserName();
      }

      return clean;
    }

    emit(item) {
      if (!item || !isValidText(item.text)) return;

      const speaker = this.processSpeaker(item.speaker);
      const text = item.text.trim();

      // Jangan kirim jika speaker sama dengan teks (UI glitch)
      if (speaker.toLowerCase() === text.toLowerCase()) return;

      const key = `${speaker}::${text}`;
      if (this.seenKeys.has(key)) return;
      this.seenKeys.add(key);

      // Batasi cache memory
      if (this.seenKeys.size > 500) {
        const arr = Array.from(this.seenKeys);
        this.seenKeys = new Set(arr.slice(-250));
      }

      this.lastSpeaker = speaker;
      this.sequence++;

      const transcript = {
        speaker,
        username: speaker,
        text,
        kalimat: text,
        sequence: this.sequence,
        source: "google_meet_cc",
        timestamp: new Date().toISOString()
      };

      try {
        this.onCaption(transcript);
      } catch (err) {
        this.warn("Error onCaption:", err);
      }
    }

    scan() {
      if (!this.running) return;

      const container = this.findCaptionContainer();
      if (!container) {
        return;
      }

      const rows = this.extractRows(container);
      for (const row of rows) {
        this.emit(row);
      }
    }

    start() {
      if (this.running) {
        return;
      }

      this.running = true;
      this.sequence = 0;
      this.seenKeys.clear();
      this.lastSpeaker = "Unknown";

      this.log("Memulai Live Captions observer...");

      // Coba aktifkan CC otomatis
      this.ensureCaptionsEnabled();

      try {
        this.mutationObserver = new MutationObserver(() => this.scan());
        if (document.body) {
          this.mutationObserver.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
          });
        }
      } catch (err) {
        this.warn("MutationObserver error:", err);
      }

      this.pollIntervalId = setInterval(() => this.scan(), CONFIG.pollInterval);

      // Periodik cek untuk memastikan CC tetap menyala
      this.autoCheckCcIntervalId = setInterval(() => {
        if (this.running && !this.isCaptionsEnabled()) {
          this.ensureCaptionsEnabled();
        }
      }, 4000);

      this.scan();
      this.log("Live Captions observer aktif.");
    }

    stop() {
      if (!this.running) return;

      this.running = false;

      if (this.mutationObserver) {
        try {
          this.mutationObserver.disconnect();
        } catch {}
        this.mutationObserver = null;
      }

      if (this.pollIntervalId) {
        clearInterval(this.pollIntervalId);
        this.pollIntervalId = null;
      }

      if (this.autoCheckCcIntervalId) {
        clearInterval(this.autoCheckCcIntervalId);
        this.autoCheckCcIntervalId = null;
      }

      this.log(`Live Captions observer berhenti. Total item: ${this.sequence}`);
    }
  }

  global.SumrizeCaptionObserver = SumrizeCaptionObserver;
})(window);