/**
 * content/transcript-buffer.js
 *
 * Buffer transkripsi cerdas yang menggabungkan, menstabilkan,
 * dan mendeduplikasi input dari Live Captions Google Meet dan Web Speech API.
 */
(function (global) {
  "use strict";

  if (global.__SUMRIZE_TRANSCRIPT_BUFFER_LOADED__) {
    return;
  }
  global.__SUMRIZE_TRANSCRIPT_BUFFER_LOADED__ = true;

  const SILENCE_TIMEOUT_MS = 1300;
  const DEDUP_WINDOW_MS = 8000;

  class SumrizeTranscriptBuffer {
    constructor(options = {}) {
      this.onSegment =
        typeof options.onSegment === "function"
          ? options.onSegment
          : typeof options.onFinalized === "function"
          ? options.onFinalized
          : null;

      this.currentSpeaker = null;
      this.currentText = "";
      this.startedAt = null;
      this.sequence = 0;
      this.silenceTimer = null;

      // History untuk deduplikasi: { text, speaker, time }
      this.recentFinalized = [];
    }

    setOnSegment(callback) {
      if (typeof callback === "function") {
        this.onSegment = callback;
      }
    }

    cleanText(str) {
      return String(str || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    /**
     * Cek apakah teks ini duplikat dari kalimat yang baru saja di-finalize
     */
    isDuplicate(speaker, text) {
      const now = Date.now();
      const normText = text.toLowerCase();

      // Buang entri lama di luar jendela dedup
      this.recentFinalized = this.recentFinalized.filter(
        (item) => now - item.time < DEDUP_WINDOW_MS
      );

      for (const item of this.recentFinalized) {
        const itemNorm = item.text.toLowerCase();

        // 1. Teks identik
        if (normText === itemNorm) {
          return true;
        }

        // 2. Teks baru adalah substring dari teks sebelumnya (misal versi pendek dari CC yang terlambat)
        if (itemNorm.length >= normText.length && itemNorm.includes(normText)) {
          return true;
        }

        // 3. Teks sebelumnya adalah substring dari teks baru, jika jeda sangat singkat (<2s)
        if (normText.includes(itemNorm) && (normText.length - itemNorm.length < 5) && now - item.time < 2000) {
          return true;
        }
      }

      return false;
    }

    /**
     * Dipanggil ketika mikrofon Google Meet dimatikan
     * Finalisasi kalimat yang telah selesai diucapkan sebelum tombol mute ditekan
     */
    onMicMuted() {
      if (this.currentText) {
        this.finalize();
      }
    }

    /**
     * Menambahkan potongan transkrip
     */
    add(speakerOrData, textMaybe) {
      let speaker = "Unknown";
      let text = "";
      let source = null;

      if (typeof speakerOrData === "object" && speakerOrData !== null) {
        speaker = String(speakerOrData.speaker || speakerOrData.username || "Unknown").trim();
        text = String(speakerOrData.text || speakerOrData.kalimat || "").trim();
        source = speakerOrData.source || null;
      } else {
        speaker = String(speakerOrData || "Unknown").trim();
        text = String(textMaybe || "").trim();
      }

      // Guard: Jika data berasal dari speech recognizer mikrofon lokal namun mikrofon Meet sedang mute/nonaktif, tolak
      if (source === "mic_speech_api") {
        if (global.SumrizeMeetDetector?.isMicMuted && global.SumrizeMeetDetector.isMicMuted()) {
          return;
        }
      }

      text = this.cleanText(text);
      if (!text || text.length < 2) return;

      // Cek apakah kalimat ini duplikat dari recent finalized
      if (this.isDuplicate(speaker, text)) {
        return;
      }

      // Jika pembicara berganti → finalize ucapan pembicara sebelumnya
      if (this.currentText && this.currentSpeaker && this.currentSpeaker !== speaker) {
        this.finalize();
      }

      if (!this.startedAt) {
        this.startedAt = new Date();
      }

      this.currentSpeaker = speaker;

      // Logika pembaruan teks:
      if (!this.currentText) {
        this.currentText = text;
      } else if (text.startsWith(this.currentText)) {
        // Google Meet menyempurnakan kalimat yang sedang berlangsung
        this.currentText = text;
      } else if (this.currentText.startsWith(text)) {
        // Teks lama lebih lengkap, pertahankan
      } else if (!this.currentText.includes(text)) {
        // Kalimat lanjutan dari pembicara yang sama
        this.currentText = `${this.currentText} ${text}`.trim();
      }

      // Reset jeda timer
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
      }

      this.silenceTimer = setTimeout(() => {
        this.finalize();
      }, SILENCE_TIMEOUT_MS);
    }

    push(data) {
      this.add(data);
    }

    finalize() {
      if (!this.currentText) return;

      const text = this.cleanText(this.currentText);
      const speaker = this.currentSpeaker || "Unknown";

      this.resetCurrent();

      if (!text || text.length < 2) return;

      // Cek duplikasi sekali lagi
      if (this.isDuplicate(speaker, text)) {
        return;
      }

      this.sequence += 1;
      const now = Date.now();

      this.recentFinalized.push({
        speaker,
        text,
        time: now
      });

      const segment = {
        speaker,
        username: speaker,
        text,
        kalimat: text,
        timestamp: new Date().toISOString(),
        sequence: this.sequence
      };

      const handler = this.onSegment || this.onFinalized;
      if (typeof handler === "function") {
        try {
          handler(segment);
        } catch (err) {
          console.error("[Sumrize Buffer] onSegment error:", err);
        }
      }
    }

    resetCurrent() {
      this.currentSpeaker = null;
      this.currentText = "";
      this.startedAt = null;

      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    }

    async flush() {
      this.finalize();
    }

    reset() {
      this.resetCurrent();
      this.sequence = 0;
      this.recentFinalized = [];
    }
  }

  global.SumrizeTranscriptBuffer = SumrizeTranscriptBuffer;
})(window);