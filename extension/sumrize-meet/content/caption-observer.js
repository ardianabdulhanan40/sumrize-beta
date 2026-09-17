/**
 * content/caption-observer.js
 *
 * Google Meet Caption Observer
 *
 * Membaca caption Google Meet yang sudah dirender di DOM.
 * Karena struktur DOM Google Meet dapat berubah, observer menggunakan
 * beberapa strategi pencarian dan fallback.
 */
(function (global) {
  "use strict";

  if (global.__SUMRIZE_CAPTION_OBSERVER_LOADED__) {
    console.warn("[Sumrize] Caption observer sudah dimuat. Skip duplicate.");
    return;
  }

  global.__SUMRIZE_CAPTION_OBSERVER_LOADED__ = true;

  const DEBUG_PREFIX = "[Sumrize Caption]";

  function log(...args) {
    console.log(DEBUG_PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(DEBUG_PREFIX, ...args);
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Selector yang umum digunakan Google Meet.
   * Tidak bergantung hanya pada satu selector.
   */
  const GoogleMeetAdapter = {
    containerSelectors: [
      '[jsname="dsyhDe"]',
      '[aria-live="polite"]',
      '[aria-live="assertive"]',
      '[role="log"]',
      '[data-caption-container]',
      '[data-message-text]',
      '[jscontroller*="caption"]',
      '[jsname*="caption" i]',
      '[class*="caption" i]',
    ],

    lineSelectors: [
      '[jsname="tgaKEf"]',
      '[data-caption-line]',
      '[data-message-text]',
      '[data-message-id]',
      '[class*="caption-line" i]',
      '[class*="caption-text" i]',
      '[class*="caption" i]',
    ],

    speakerSelectors: [
      '[jsname="YSxPC"]',
      '.speaker-name',
      '[class*="speaker" i]',
      '[class*="name" i]',
    ],

    /**
     * Cari semua kandidat container caption.
     */
    findContainers() {
      const results = [];
      const seen = new Set();

      for (const selector of this.containerSelectors) {
        let elements = [];

        try {
          elements = document.querySelectorAll(selector);
        } catch (err) {
          continue;
        }

        elements.forEach((element) => {
          if (seen.has(element)) return;

          const text = normalizeText(element.textContent);

          /*
           * Hindari memasukkan element besar seperti body/main
           * sebagai container caption.
           */
          if (
            text.length > 0 &&
            text.length < 2000
          ) {
            seen.add(element);
            results.push(element);
          }
        });
      }

      return results;
    },

    /**
     * Cari container terbaik.
     */
    findBestContainer() {
      const containers = this.findContainers();

      if (!containers.length) {
        return null;
      }

      /*
       * Prioritaskan container yang paling kecil.
       * Container caption biasanya lebih kecil dibanding
       * parent besar seperti main/dialog.
       */
      containers.sort((a, b) => {
        const aLength = normalizeText(a.textContent).length;
        const bLength = normalizeText(b.textContent).length;

        return aLength - bLength;
      });

      const container = containers[0];

      log(
        "Candidate caption container ditemukan:",
        container,
        "text:",
        normalizeText(container.textContent).slice(0, 150)
      );

      return container;
    },

    /**
     * Cari line caption di dalam container.
     */
    findLines(container) {
      const results = [];
      const seen = new Set();

      for (const selector of this.lineSelectors) {
        let elements = [];

        try {
          elements = container.querySelectorAll(selector);
        } catch (err) {
          continue;
        }

        elements.forEach((element) => {
          if (seen.has(element)) return;

          const text = normalizeText(element.textContent);

          if (text) {
            seen.add(element);
            results.push(element);
          }
        });

        /*
         * Kalau sudah menemukan kandidat yang masuk akal,
         * tidak perlu terus mengambil selector yang terlalu umum.
         */
        if (results.length > 0) {
          break;
        }
      }

      return results;
    },

    /**
     * Ambil nama speaker.
     */
    extractSpeaker(element) {
      for (const selector of this.speakerSelectors) {
        try {
          const speakerElement = element.querySelector(selector);

          if (speakerElement) {
            const speaker = normalizeText(
              speakerElement.textContent
            );

            if (speaker) {
              return speaker;
            }
          }
        } catch (err) {
          // Ignore selector error.
        }
      }

      /*
       * Fallback: cek attribute yang mungkin berisi nama.
       */
      const possibleAttributes = [
        "data-speaker",
        "data-speaker-name",
        "aria-label",
        "title",
      ];

      for (const attribute of possibleAttributes) {
        const value = normalizeText(
          element.getAttribute(attribute)
        );

        if (
          value &&
          value.length < 100 &&
          !/caption|subtitle|teks otomatis|live caption/i.test(value)
        ) {
          return value;
        }
      }

      return "Unknown";
    },

    /**
     * Ambil text caption.
     */
    extractText(element) {
      /*
       * Clone element supaya kita bisa menghapus
       * node speaker tanpa mengubah DOM asli.
       */
      const clone = element.cloneNode(true);

      for (const selector of this.speakerSelectors) {
        try {
          clone.querySelectorAll(selector).forEach((speaker) => {
            speaker.remove();
          });
        } catch (err) {
          // Ignore.
        }
      }

      return normalizeText(clone.textContent);
    },

    /**
     * Ambil caption dari satu element.
     */
    extractLine(element) {
      const speaker = this.extractSpeaker(element);
      const text = this.extractText(element);

      return {
        speaker,
        text,
      };
    },

    /**
     * Mencoba mencari tombol Captions.
     */
    findCaptionButton() {
      const elements = document.querySelectorAll(
        'button, [role="button"]'
      );

      for (const element of elements) {
        const ariaLabel = normalizeText(
          element.getAttribute("aria-label")
        );

        const text = normalizeText(
          element.textContent
        );

        const combined = `${ariaLabel} ${text}`;

        if (
          /captions/i.test(combined) ||
          /live captions/i.test(combined) ||
          /teks otomatis/i.test(combined) ||
          /subtitle/i.test(combined)
        ) {
          return element;
        }
      }

      return null;
    },

    enableCaptions() {
      const button = this.findCaptionButton();

      if (!button) {
        log("Tombol Captions belum ditemukan.");
        return false;
      }

      const label = normalizeText(
        button.getAttribute("aria-label")
      );

      /*
       * Jangan klik kalau tombol terlihat seperti
       * tombol untuk mematikan caption.
       */
      if (
        /turn off captions/i.test(label) ||
        /matikan teks otomatis/i.test(label)
      ) {
        log("Captions sudah aktif.");
        return true;
      }

      try {
        button.click();
        log("Mencoba mengaktifkan Captions.");
        return true;
      } catch (err) {
        warn("Gagal klik tombol Captions:", err);
        return false;
      }
    },
  };

  class CaptionObserver {
    constructor({ onCaption }) {
      this.onCaption = onCaption;

      this.observer = null;
      this.documentObserver = null;

      this.containerEl = null;

      this.pollTimer = null;

      this.captionCount = 0;

      this.lastText = "";
      this.lastSpeaker = "";

      this.running = false;

      this.processTimer = null;
    }

    start() {
      if (this.running) {
        log("Observer sudah berjalan.");
        return true;
      }

      this.running = true;

      log("Memulai Caption Observer...");

      /*
       * Jangan mengandalkan caption sudah aktif.
       * Coba aktifkan setelah observer berjalan.
       */
      GoogleMeetAdapter.enableCaptions();

      /*
       * Cari container sekarang.
       */
      this._findAndAttach();

      /*
       * Google Meet sering membuat element caption
       * beberapa detik setelah tombol Captions ditekan.
       *
       * Karena itu kita monitor perubahan seluruh document
       * sampai container ditemukan.
       */
      this.documentObserver = new MutationObserver(() => {
        if (!this.running) return;

        if (!this.containerEl) {
          this._findAndAttach();
          return;
        }

        this._scheduleProcess();
      });

      this.documentObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });

      /*
       * Fallback polling.
       */
      this.pollTimer = setInterval(() => {
        if (!this.running) return;

        if (!this.containerEl) {
          GoogleMeetAdapter.enableCaptions();
          this._findAndAttach();
        } else {
          this._processContainer();
        }
      }, 1500);

      return Boolean(this.containerEl);
    }

    _findAndAttach() {
      const container = GoogleMeetAdapter.findBestContainer();

      if (!container) {
        log(
          "Caption container belum ditemukan. Menunggu perubahan DOM..."
        );
        return false;
      }

      if (container === this.containerEl) {
        return true;
      }

      this.containerEl = container;

      this._attachObserver();

      return true;
    }

    _attachObserver() {
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }

      if (!this.containerEl) {
        return;
      }

      log(
        "Memasang MutationObserver pada caption container:",
        this.containerEl
      );

      this.observer = new MutationObserver(() => {
        this._scheduleProcess();
      });

      this.observer.observe(this.containerEl, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      global.SumrizeLogger?.info(
        "Caption observer aktif."
      );

      this._processContainer();
    }

    _scheduleProcess() {
      if (this.processTimer) {
        return;
      }

      this.processTimer = setTimeout(() => {
        this.processTimer = null;

        if (!this.running) return;

        this._processContainer();
      }, 100);
    }

    _processContainer() {
      if (!this.containerEl) {
        return;
      }

      const lines = GoogleMeetAdapter.findLines(
        this.containerEl
      );

      /*
       * Kalau selector line tidak menemukan apa pun,
       * coba gunakan container sebagai fallback.
       */
      const targets =
        lines.length > 0
          ? lines
          : [this.containerEl];

      for (const element of targets) {
        const result =
          GoogleMeetAdapter.extractLine(element);

        const speaker = normalizeText(
          result.speaker || "Unknown"
        );

        const text = normalizeText(
          result.text
        );

        if (!text) {
          continue;
        }

        /*
         * Hindari mengirim teks UI Google Meet.
         */
        if (this._isProbablyUiText(text)) {
          continue;
        }

        /*
         * Hindari caption yang sama dikirim berkali-kali.
         */
        if (
          text === this.lastText &&
          speaker === this.lastSpeaker
        ) {
          continue;
        }

        this.lastText = text;
        this.lastSpeaker = speaker;

        this.captionCount += 1;

        log(
          `Caption #${this.captionCount}:`,
          {
            speaker,
            text,
          }
        );

        if (this.captionCount === 1) {
          global.SumrizeLogger?.info(
            "Caption Google Meet pertama diterima."
          );
        }

        try {
          this.onCaption?.({
            speaker,
            text,
          });
        } catch (err) {
          console.error(
            `${DEBUG_PREFIX} onCaption error:`,
            err
          );
        }
      }
    }

    _isProbablyUiText(text) {
      const lower = text.toLowerCase();

      const uiPatterns = [
        "turn on captions",
        "turn off captions",
        "live captions",
        "captions",
        "teks otomatis",
        "matikan teks otomatis",
        "aktifkan teks otomatis",
        "present now",
        "more options",
        "more options",
        "leave call",
        "join now",
        "ask to join",
      ];

      return uiPatterns.some((pattern) =>
        lower === pattern ||
        lower.includes(pattern)
      );
    }

    stop() {
      log("Menghentikan Caption Observer...");

      this.running = false;

      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }

      if (this.documentObserver) {
        this.documentObserver.disconnect();
        this.documentObserver = null;
      }

      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }

      if (this.processTimer) {
        clearTimeout(this.processTimer);
        this.processTimer = null;
      }

      this.containerEl = null;

      log(
        `Caption Observer berhenti. Total caption: ${this.captionCount}`
      );
    }
  }

  global.SumrizeGoogleMeetAdapter =
    GoogleMeetAdapter;

  global.SumrizeCaptionObserver =
    CaptionObserver;

  log("Caption Observer module loaded.");
})(window);