/**
 * content/caption-observer.js
 * Membaca Live Captions Google Meet (struktur DOM 2025–2026)
 * dan mengirim data satu per satu ke collector.
 *
 * PENTING: Live Captions (CC) HARUS aktif di Google Meet.
 */
(function (global) {
  "use strict";

  if (global.__SUMRIZE_CAPTION_OBSERVER_LOADED__) {
    console.log("[Sumrize Transcript] Caption observer sudah pernah dimuat.");
    return;
  }
  global.__SUMRIZE_CAPTION_OBSERVER_LOADED__ = true;

  const LOG_PREFIX = "[Sumrize Transcript]";

  const CONFIG = {
    pollInterval: 700,
    maxTextLength: 500,
    minTextLength: 2,
    maxSpeakerLength: 80
  };

  // ========== SELECTORS (prioritas) ==========
  const CAPTION_CONTAINER_SELECTORS = [
    '[role="region"][aria-label*="caption" i]',
    '[role="region"][aria-label*="Captions"]',
    '[role="region"][aria-label*="subtitle" i]',
    '[role="region"][aria-label*="자막"]',
    '[jsname="dsyhDe"]'
  ];

  const CAPTION_ITEM_SELECTORS = [
    ".nMcdL.bj4p3b",
    ".nMcdL",
    '[class*="nMcdL"]'
  ];

  const SPEAKER_SELECTORS = [
    ".NWpY1d",
    ".zQRpq",
    ".iOzk7",
    '[class*="NWpY1d"]'
  ];

  const TEXT_SELECTORS = [
    ".ygicle.VbkSUe",
    ".bh44bd.VbkSUe",
    ".ygicle",
    ".VbkSUe",
    '[class*="ygicle"]'
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
    "devices",
    "more options",
    "orang lain mungkin masih dapat melihat video"
  ];

  /* ========== Utility ========== */

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    try {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        parseFloat(style.opacity || "1") > 0
      );
    } catch {
      return false;
    }
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

  /* ========== Caption Observer ========== */

  class SumrizeCaptionObserver {
    constructor(options = {}) {
      this.onCaption =
        typeof options.onCaption === "function" ? options.onCaption : () => {};
      this.running = false;
      this.mutationObserver = null;
      this.pollIntervalId = null;
      this.sequence = 0;
      this.seenKeys = new Set();
      this.lastSpeaker = "Unknown";
      this._warnedNoContainer = false;
    }

    log(...args) {
      console.log(LOG_PREFIX, ...args);
    }

    warn(...args) {
      console.warn(LOG_PREFIX, ...args);
    }

    findCaptionContainer() {
      for (const selector of CAPTION_CONTAINER_SELECTORS) {
        try {
          const el = document.querySelector(selector);
          if (el && isVisible(el)) return el;
        } catch {}
      }
      return null;
    }

    findCaptionItems(container) {
      if (!container) return [];

      for (const selector of CAPTION_ITEM_SELECTORS) {
        try {
          const items = container.querySelectorAll(selector);
          if (items.length > 0) {
            return Array.from(items).filter(isVisible);
          }
        } catch {}
      }
      return [];
    }

    extractSpeaker(item) {
      for (const selector of SPEAKER_SELECTORS) {
        try {
          const el = item.querySelector(selector);
          if (!el) continue;
          const name = normalizeText(el.innerText || el.textContent);
          if (
            name &&
            name.length >= 2 &&
            name.length <= CONFIG.maxSpeakerLength &&
            !containsUiText(name)
          ) {
            return name;
          }
        } catch {}
      }
      return null;
    }

    extractText(item) {
      for (const selector of TEXT_SELECTORS) {
        try {
          const el = item.querySelector(selector);
          if (!el) continue;
          const text = normalizeText(el.innerText || el.textContent);
          if (isValidText(text)) return text;
        } catch {}
      }

      // Fallback: clone & hapus speaker
      try {
        const clone = item.cloneNode(true);
        SPEAKER_SELECTORS.forEach((sel) => {
          clone.querySelectorAll(sel).forEach((n) => n.remove());
        });
        const text = normalizeText(clone.innerText || clone.textContent);
        if (isValidText(text)) return text;
      } catch {}

      return "";
    }

    processItem(item) {
      const speaker =
        this.extractSpeaker(item) || this.lastSpeaker || "Unknown";
      const text = this.extractText(item);

      if (!isValidText(text)) return null;
      if (text.toLowerCase() === speaker.toLowerCase()) return null;

      this.lastSpeaker = speaker;
      return { speaker, text };
    }

    emit(data) {
      if (!data) return;

      const key = `${data.speaker}::${data.text}`;
      if (this.seenKeys.has(key)) return;
      this.seenKeys.add(key);

      // Batasi memory
      if (this.seenKeys.size > 300) {
        const arr = Array.from(this.seenKeys);
        this.seenKeys = new Set(arr.slice(-150));
      }

      this.sequence++;

      const transcript = {
        speaker: data.speaker,
        text: data.text,
        sequence: this.sequence,
        timestamp: new Date().toISOString()
      };

      this.log(
        `Transcript #${transcript.sequence} | Speaker: ${transcript.speaker} | "${transcript.text}" | ${transcript.timestamp}`
      );

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
        if (!this._warnedNoContainer) {
          this.warn(
            "Caption container belum ditemukan. Pastikan Live Captions (CC) sudah AKTIF di Google Meet."
          );
          this._warnedNoContainer = true;
        }
        return;
      }

      this._warnedNoContainer = false;

      const items = this.findCaptionItems(container);

      if (items.length === 0) {
        // Fallback: ambil text langsung dari container (jika pendek)
        const direct = normalizeText(container.innerText);
        if (isValidText(direct) && direct.length < 250) {
          this.emit({
            speaker: this.lastSpeaker || "Unknown",
            text: direct
          });
        }
        return;
      }

      items.forEach((item) => {
        const data = this.processItem(item);
        if (data) this.emit(data);
      });
    }

    start() {
      if (this.running) {
        this.log("Observer sudah berjalan.");
        return;
      }

      this.running = true;
      this.sequence = 0;
      this.seenKeys.clear();
      this.lastSpeaker = "Unknown";
      this._warnedNoContainer = false;

      this.log("Memulai observer Live Transcript Google Meet...");

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
        this.warn("MutationObserver gagal:", err);
      }

      this.pollIntervalId = setInterval(() => this.scan(), CONFIG.pollInterval);
      this.scan();

      this.log("Observer Live Transcript aktif.");
    }

    stop() {
      if (!this.running) return;

      this.log("Menghentikan observer...");
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

      this.log(`Observer berhenti. Total transcript: ${this.sequence}`);
    }

    reset() {
      this.seenKeys.clear();
      this.sequence = 0;
      this.lastSpeaker = "Unknown";
      this.log("History transcript di-reset.");
    }
  }

  global.SumrizeCaptionObserver = SumrizeCaptionObserver;
  console.log(`${LOG_PREFIX} Caption observer berhasil dimuat.`);
})(window);