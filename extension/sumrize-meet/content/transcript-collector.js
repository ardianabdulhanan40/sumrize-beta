/**
 * content/transcript-collector.js
 *
 * Mengoordinasikan Live Captions Observer dan Local Speech Recognizer,
 * menampilkan logging real-time di console, menampilkan floating widget di layar Meet,
 * serta menyimpan transkrip ke backend & folder hasiltranscribe/
 */
(function (global) {
  "use strict";

  if (global.__SUMRIZE_CONTENT_COLLECTOR_LOADED__) {
    return;
  }
  global.__SUMRIZE_CONTENT_COLLECTOR_LOADED__ = true;

  let state = "idle";
  let meetingSessionId = null;
  let meetCode = null;
  let startedAt = null;

  let captionObserver = null;
  let speechRecognizer = null;
  let transcriptBuffer = null;
  let segmentsFinalized = 0;

  // Floating UI Widget
  let overlayContainer = null;
  let overlayTextEl = null;
  let overlayCountEl = null;
  let overlayCcBtn = null;

  function normalizeError(error) {
    if (!error) return "Unknown error";
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message;
    if (typeof error?.message === "string") return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  /* =========================================================
     FLOATING OVERLAY WIDGET DI GOOGLE MEET
     ========================================================= */

  function createFloatingOverlay() {
    if (overlayContainer) return;

    overlayContainer = document.createElement("div");
    overlayContainer.id = "sumrize-live-overlay";
    overlayContainer.style.cssText = `
      position: fixed;
      bottom: 85px;
      left: 24px;
      z-index: 999999;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      padding: 10px 14px;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
      max-width: 380px;
      min-width: 260px;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      gap: 6px;
      pointer-events: auto;
    `;

    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 6px;
    `;

    const titleBadge = document.createElement("div");
    titleBadge.style.cssText = `display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px;`;
    titleBadge.innerHTML = `
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block; box-shadow: 0 0 8px #10b981;"></span>
      <span>Sumrize Live Transcribe</span>
    `;

    overlayCountEl = document.createElement("span");
    overlayCountEl.style.cssText = `font-size: 11px; color: #94a3b8; font-weight: 500;`;
    overlayCountEl.textContent = "0 kalimat";

    header.appendChild(titleBadge);
    header.appendChild(overlayCountEl);

    // Live Text Preview
    overlayTextEl = document.createElement("div");
    overlayTextEl.style.cssText = `
      font-size: 12px;
      color: #e2e8f0;
      line-height: 1.4;
      max-height: 48px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      font-style: italic;
    `;
    overlayTextEl.textContent = "Mendengarkan percakapan...";

    // Footer actions
    const footer = document.createElement("div");
    footer.style.cssText = `display: flex; align-items: center; justify-content: space-between; font-size: 11px; margin-top: 2px;`;

    overlayCcBtn = document.createElement("button");
    overlayCcBtn.style.cssText = `
      background: rgba(59, 130, 246, 0.2);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #60a5fa;
      border-radius: 6px;
      padding: 2px 8px;
      font-size: 11px;
      cursor: pointer;
    `;
    overlayCcBtn.textContent = "Toggle CC";
    overlayCcBtn.onclick = () => {
      if (captionObserver) {
        captionObserver.ensureCaptionsEnabled();
        updateCcButtonStatus();
      }
    };

    const targetFolderInfo = document.createElement("span");
    targetFolderInfo.style.cssText = `color: #64748b; font-size: 10px;`;
    targetFolderInfo.textContent = "📁 hasiltranscribe/";

    footer.appendChild(overlayCcBtn);
    footer.appendChild(targetFolderInfo);

    overlayContainer.appendChild(header);
    overlayContainer.appendChild(overlayTextEl);
    overlayContainer.appendChild(footer);

    document.body.appendChild(overlayContainer);
    updateCcButtonStatus();
  }

  function updateCcButtonStatus() {
    if (!overlayCcBtn || !captionObserver) return;
    const isCcOn = captionObserver.isCaptionsEnabled();
    if (isCcOn) {
      overlayCcBtn.textContent = "✓ CC Aktif";
      overlayCcBtn.style.background = "rgba(16, 185, 129, 0.2)";
      overlayCcBtn.style.borderColor = "rgba(16, 185, 129, 0.4)";
      overlayCcBtn.style.color = "#34d399";
    } else {
      overlayCcBtn.textContent = "⚠ Aktifkan CC";
      overlayCcBtn.style.background = "rgba(245, 158, 11, 0.2)";
      overlayCcBtn.style.borderColor = "rgba(245, 158, 11, 0.4)";
      overlayCcBtn.style.color = "#fbbf24";
    }
  }

  function updateOverlayPreview(speaker, text) {
    if (overlayTextEl) {
      overlayTextEl.textContent = `${speaker}: "${text}"`;
      overlayTextEl.style.fontStyle = "normal";
    }
    if (overlayCountEl) {
      overlayCountEl.textContent = `${segmentsFinalized} kalimat`;
    }
    updateCcButtonStatus();
  }

  function removeFloatingOverlay() {
    if (overlayContainer) {
      try {
        overlayContainer.remove();
      } catch {}
      overlayContainer = null;
      overlayTextEl = null;
      overlayCountEl = null;
      overlayCcBtn = null;
    }
  }

  /* =========================================================
     TRANSCRIPT DISPATCHER (CONSOLE & SAVING)
     ========================================================= */

  async function sendTranscriptSegment(segment) {
    if (!meetingSessionId) {
      console.warn("[Sumrize] Transcript skipped: meetingSessionId belum siap.");
      return;
    }

    if (!segment || typeof segment !== "object") {
      return;
    }

    const text = String(segment.text || segment.kalimat || "").trim();
    if (!text) {
      return;
    }

    const speaker = String(segment.speaker || segment.username || "Unknown").trim();
    const timestamp = segment.timestamp || new Date().toISOString();
    const sequence = Number.isFinite(segment.sequence) ? segment.sequence : ++segmentsFinalized;

    // 1. LOG KE CONSOLE SECARA JELAS & REAL-TIME
    console.log(
      `%c[Sumrize Live] %c${speaker}: %c"${text}"`,
      "background: #10b981; color: #ffffff; font-weight: bold; padding: 3px 8px; border-radius: 4px; font-size: 12px;",
      "color: #3b82f6; font-weight: bold; font-size: 13px;",
      "color: #1f2937; font-size: 13px; font-weight: normal;"
    );

    // 2. UPDATE FLOATING OVERLAY DI LAYAR
    updateOverlayPreview(speaker, text);

    const payload = {
      meetingSessionId,
      meetCode,
      speaker,
      username: speaker,
      text,
      kalimat: text,
      timestamp,
      sequence
    };

    // 3. KIRIM KE SERVICE WORKER (BACKEND RESMI -> transcript.php)
    try {
      sendRuntimeMessage({
        type: "TRANSCRIPT_SEGMENT",
        ...payload
      }).catch((e) => console.warn("[Sumrize] SW send error:", e?.message));
    } catch {}

    // 4. DIRECT FALLBACK SAVE LANGSUNG KE HASILTRANSCRIBE (save-local.php)
    // Menjamin data selalu tersimpan di folder hasiltranscribe/ tanpa hambatan auth
    try {
      fetch("http://localhost/sumrize-beta/api/meeting/save-local.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch {}
  }

  /* =========================================================
     START & STOP CAPTURE
     ========================================================= */

  function extractCleanMeetCode() {
    if (global.SumrizeMeetDetector?.getMeetCode) {
      const code = global.SumrizeMeetDetector.getMeetCode();
      if (code) return code;
    }
    const match = window.location.pathname.match(/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
    return match ? match[1] : null;
  }

  async function startCapture() {
    if (state === "capturing") {
      return { ok: true, state, meetingSessionId, meetCode };
    }

    meetCode = extractCleanMeetCode();
    if (!meetCode) {
      throw new Error("Meet code tidak ditemukan. Buka halaman panggilan Google Meet.");
    }

    console.log(
      "%c[Sumrize] Memulai Transkripsi Live Google Meet untuk: " + meetCode,
      "background: #3b82f6; color: white; padding: 4px 8px; font-weight: bold; border-radius: 4px;"
    );

    // 1. Buat session di backend
    try {
      const createResponse = await sendRuntimeMessage({
        type: "CREATE_MEETING_SESSION",
        meetCode,
        title: `Google Meet - ${meetCode}`
      });

      meetingSessionId =
        createResponse?.meetingSessionId ||
        createResponse?.meeting_session_id ||
        createResponse?.id ||
        null;
    } catch (err) {
      console.warn("[Sumrize] Warning create meeting:", err);
    }

    if (!meetingSessionId) {
      // Fallback session ID lokal jika backend belum terhubung
      meetingSessionId = `ms_${meetCode.replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now()}`;
    }

    // 2. Inisialisasi Buffer
    if (!global.SumrizeTranscriptBuffer) {
      throw new Error("SumrizeTranscriptBuffer tidak tersedia.");
    }

    transcriptBuffer = new global.SumrizeTranscriptBuffer({
      onSegment: async (segment) => {
        await sendTranscriptSegment(segment);
      }
    });

    // 3. Inisialisasi Caption Observer (Live Captions Google Meet)
    if (global.SumrizeCaptionObserver) {
      captionObserver = new global.SumrizeCaptionObserver({
        onCaption: (caption) => {
          if (transcriptBuffer) {
            transcriptBuffer.add(caption);
          }
        }
      });
      captionObserver.start();
    }

    // 4. Inisialisasi Speech Recognizer (Mikrofon Lokal User)
    if (global.SumrizeSpeechRecognizer) {
      speechRecognizer = new global.SumrizeSpeechRecognizer({
        onTranscript: (speech) => {
          if (transcriptBuffer) {
            transcriptBuffer.add(speech);
          }
        }
      });
      speechRecognizer.start();
    }

    state = "capturing";
    startedAt = new Date();
    segmentsFinalized = 0;

    // Buat floating overlay
    createFloatingOverlay();

    if (global.SumrizeStorage?.set) {
      await global.SumrizeStorage.set({
        captureState: "capturing",
        meetingSessionId,
        meetCode,
        lastError: null
      });
    }

    console.log(
      "%c[Sumrize] Transkripsi AKTIF! Berbicaralah di Google Meet.",
      "background: #10b981; color: white; padding: 4px 8px; font-weight: bold; border-radius: 4px;"
    );

    return { ok: true, state, meetingSessionId, meetCode };
  }

  async function stopCapture() {
    if (state === "idle") {
      return { ok: true, state: "idle" };
    }

    console.log("[Sumrize] Menghentikan transkripsi...");
    state = "stopping";

    // Flush sisa kata di buffer
    if (transcriptBuffer) {
      try {
        await transcriptBuffer.flush();
      } catch (err) {
        console.warn("[Sumrize] Flush buffer error:", normalizeError(err));
      }
    }

    // Hentikan observer
    if (captionObserver) {
      try {
        captionObserver.stop();
      } catch {}
      captionObserver = null;
    }

    // Hentikan speech recognizer
    if (speechRecognizer) {
      try {
        speechRecognizer.stop();
      } catch {}
      speechRecognizer = null;
    }

    // Beritahu backend untuk stop session
    const sessionId = meetingSessionId;
    if (sessionId) {
      try {
        await sendRuntimeMessage({
          type: "STOP_MEETING_SESSION",
          meetingSessionId: sessionId
        });
      } catch {}
    }

    removeFloatingOverlay();

    state = "idle";
    meetingSessionId = null;
    meetCode = null;
    startedAt = null;
    transcriptBuffer = null;

    if (global.SumrizeStorage?.reset) {
      await global.SumrizeStorage.reset();
    }

    console.log(`[Sumrize] Transkripsi selesai. Total: ${segmentsFinalized} kalimat.`);
    return { ok: true, state: "idle", count: segmentsFinalized };
  }

  function getState() {
    return {
      state,
      meetingSessionId,
      meetCode,
      startedAt,
      segmentsFinalized,
      isCcOn: captionObserver ? captionObserver.isCaptionsEnabled() : false
    };
  }

  /* =========================================================
     MESSAGE LISTENER DARI POPUP / SERVICE WORKER
     ========================================================= */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type) return;

    if (message.type === "POPUP_START_CAPTURE") {
      startCapture()
        .then((r) => sendResponse(r))
        .catch((err) => {
          console.error("[Sumrize] Start failed:", err);
          sendResponse({ ok: false, error: normalizeError(err) });
        });
      return true;
    }

    if (message.type === "POPUP_STOP_CAPTURE") {
      stopCapture()
        .then((r) => sendResponse(r))
        .catch((err) => {
          console.error("[Sumrize] Stop failed:", err);
          sendResponse({ ok: false, error: normalizeError(err) });
        });
      return true;
    }

    if (message.type === "POPUP_GET_STATE") {
      sendResponse({ ok: true, ...getState() });
      return true;
    }

    if (message.type === "SUMRIZE_CONTENT_PING") {
      sendResponse({ ok: true, state, meetingSessionId, meetCode });
      return true;
    }
  });

  global.SumrizeTranscriptCollector = {
    startCapture,
    stopCapture,
    getState
  };

  console.log("[Sumrize] Transcript Collector (Live Captions & Speech API) siap.");
})(window);