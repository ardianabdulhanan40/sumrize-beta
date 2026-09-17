/**
 * content/transcript-buffer.js
 * Buffer sementara untuk menggabungkan caption yang masih berubah
 * sebelum dikirim sebagai segment final.
 */
(function (global) {
  "use strict";

  if (global.__SUMRIZE_TRANSCRIPT_BUFFER_LOADED__) {
    return;
  }
  global.__SUMRIZE_TRANSCRIPT_BUFFER_LOADED__ = true;

  const SILENCE_TIMEOUT_MS = 1500;

  class SumrizeTranscriptBuffer {
    constructor(options = {}) {
      this.onSegment =
        typeof options.onSegment === "function" ? options.onSegment : null;

      this.currentSpeaker = null;
      this.currentText = "";
      this.startedAt = null;
      this.sequence = 0;
      this.silenceTimer = null;
      this.finalizedTexts = new Set();
    }

    setOnSegment(callback) {
      if (typeof callback === "function") {
        this.onSegment = callback;
      }
    }

    /**
     * Tambah caption.
     * Bisa dipanggil sebagai:
     *   buffer.add(speaker, text)
     *   atau
     *   buffer.add({ speaker, text })
     *   atau
     *   buffer.push({ speaker, text })
     */
    add(speakerOrData, textMaybe) {
      let speaker = "Unknown";
      let text = "";

      if (typeof speakerOrData === "object" && speakerOrData !== null) {
        speaker = String(speakerOrData.speaker || "Unknown").trim();
        text = String(speakerOrData.text || "").trim();
      } else {
        speaker = String(speakerOrData || "Unknown").trim();
        text = String(textMaybe || "").trim();
      }

      if (!text) return;

      // Jika speaker berubah → finalize segment sebelumnya
      if (this.currentText && this.currentSpeaker !== speaker) {
        this.finalize();
      }

      if (!this.startedAt) {
        this.startedAt = new Date();
      }

      this.currentSpeaker = speaker;

      // Update text (Google Meet sering refine kalimat yang sama)
      if (this.currentText !== text) {
        this.currentText = text;
      }

      // Reset silence timer
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

      const text = this.currentText.trim();
      if (!text) {
        this.resetCurrent();
        return;
      }

      // Dedup final
      if (this.finalizedTexts.has(text)) {
        this.resetCurrent();
        return;
      }

      this.finalizedTexts.add(text);

      // Batasi memory
      if (this.finalizedTexts.size > 1000) {
        const first = this.finalizedTexts.values().next().value;
        this.finalizedTexts.delete(first);
      }

      const segment = {
        speaker: this.currentSpeaker || "Unknown",
        text,
        timestamp: (this.startedAt || new Date()).toISOString(),
        sequence: this.sequence++
      };

      if (typeof this.onSegment === "function") {
        try {
          this.onSegment(segment);
        } catch (error) {
          console.error("[Sumrize Buffer] onSegment failed:", error);
        }
      }

      this.resetCurrent();
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
      this.finalizedTexts.clear();
    }
  }

  global.SumrizeTranscriptBuffer = SumrizeTranscriptBuffer;
})(window);