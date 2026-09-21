/**
 * content/speech-recognizer.js
 *
 * Menggunakan Web Speech API (webkitSpeechRecognition) bawaan Google Chrome
 * untuk mentranskripsi suara pembicara lokal (mikrofon Anda) secara instan,
 * real-time, dan akurat, melengkapi Live Captions (CC) Google Meet.
 */
(function (global) {
  "use strict";

  if (global.__SUMRIZE_SPEECH_RECOGNIZER_LOADED__) {
    return;
  }
  global.__SUMRIZE_SPEECH_RECOGNIZER_LOADED__ = true;

  const LOG_PREFIX = "[Sumrize Mic STT]";

  class SumrizeSpeechRecognizer {
    constructor(options = {}) {
      this.onTranscript =
        typeof options.onTranscript === "function"
          ? options.onTranscript
          : () => {};
      this.language = options.language || "id-ID";
      this.recognition = null;
      this.running = false;
      this.shouldRestart = false;
      this.cachedUserName = null;
      this.lastFinalText = "";
      this.lastFinalTime = 0;
    }

    log(...args) {
      console.log(LOG_PREFIX, ...args);
    }

    warn(...args) {
      console.warn(LOG_PREFIX, ...args);
    }

    /**
     * Dapatkan nama pengguna lokal dari Google Meet
     */
    getUserName() {
      if (this.cachedUserName) return this.cachedUserName;

      try {
        // 1. Coba dari data attribute Google Meet
        const selfEl = document.querySelector("[data-self-name]");
        if (selfEl) {
          const name = selfEl.getAttribute("data-self-name");
          if (name && name.trim()) {
            this.cachedUserName = name.trim();
            return this.cachedUserName;
          }
        }

        // 2. Coba dari tombol akun Google Meet
        const accountBtn = document.querySelector(
          '[aria-label*="Google Account:" i], [aria-label*="Akun Google:" i], [aria-label*="Google-Konto:" i]'
        );
        if (accountBtn) {
          const label = accountBtn.getAttribute("aria-label") || "";
          const match = label.match(/:\s*([^(\n\r]+)/);
          if (match && match[1].trim()) {
            this.cachedUserName = match[1].trim();
            return this.cachedUserName;
          }
        }

        // 3. Coba dari tile video lokal (biasanya memiliki label "Anda" atau nama user)
        const localVideoTiles = document.querySelectorAll(
          '[data-requested-participant-id="self"], [data-is-muted]'
        );
        for (const tile of localVideoTiles) {
          const nameEl = tile.querySelector('[class*="zQRpq"], [class*="NWpY1d"], span');
          if (nameEl && nameEl.textContent.trim()) {
            const t = nameEl.textContent.trim();
            if (t.toLowerCase() !== "anda" && t.toLowerCase() !== "you") {
              this.cachedUserName = t;
              return this.cachedUserName;
            }
          }
        }
      } catch (err) {
        this.warn("Error finding user name:", err);
      }

      return "Anda (Saya)";
    }

    isAvailable() {
      return Boolean(global.SpeechRecognition || global.webkitSpeechRecognition);
    }

    start() {
      if (this.running) {
        return;
      }

      const SpeechRecognition =
        global.SpeechRecognition || global.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        this.warn("Browser tidak mendukung webkitSpeechRecognition.");
        return false;
      }

      try {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = this.language;
        this.recognition.maxAlternatives = 1;

        this.shouldRestart = true;
        this.running = true;

        this.recognition.onstart = () => {
          this.log(`Web Speech API aktif (${this.language}). Mendengarkan suara Anda...`);
        };

        this.recognition.onresult = (event) => {
          if (!this.running) return;

          let interimTranscript = "";
          let finalTranscript = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            } else {
              interimTranscript += transcript;
            }
          }

          const speaker = this.getUserName();
          const cleanFinal = finalTranscript.trim();

          if (cleanFinal && cleanFinal !== this.lastFinalText) {
            this.lastFinalText = cleanFinal;
            this.lastFinalTime = Date.now();

            this.log(`[Anda Berbicara]: "${cleanFinal}"`);

            this.onTranscript({
              speaker,
              text: cleanFinal,
              isFinal: true,
              source: "mic_speech_api",
              timestamp: new Date().toISOString()
            });
          }
        };

        this.recognition.onerror = (event) => {
          // Abaikan error "no-speech" normal saat jeda hening
          if (event.error === "no-speech") {
            return;
          }
          if (event.error === "aborted") {
            return;
          }

          this.warn("Recognition error:", event.error);

          if (event.error === "not-allowed") {
            this.shouldRestart = false;
            this.running = false;
          }
        };

        this.recognition.onend = () => {
          if (this.shouldRestart && this.running) {
            // Auto restart jika terputus tiba-tiba
            setTimeout(() => {
              if (this.shouldRestart && this.running && this.recognition) {
                try {
                  this.recognition.start();
                } catch (e) {
                  // restart retry nanti
                }
              }
            }, 300);
          } else {
            this.running = false;
            this.log("Web Speech API berhenti.");
          }
        };

        this.recognition.start();
        return true;
      } catch (err) {
        this.warn("Gagal memulai SpeechRecognition:", err);
        this.running = false;
        return false;
      }
    }

    stop() {
      this.shouldRestart = false;
      this.running = false;

      if (this.recognition) {
        try {
          this.recognition.stop();
        } catch {}
        this.recognition = null;
      }
      this.log("Speech recognizer dihentikan.");
    }
  }

  global.SumrizeSpeechRecognizer = SumrizeSpeechRecognizer;
})(window);
