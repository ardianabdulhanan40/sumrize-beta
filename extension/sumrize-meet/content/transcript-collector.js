/**
 * content/transcript-collector.js
 * Mode: Tab Audio Capture (tanpa CC)
 */
(function (global) {
  "use strict";

  if (global.__SUMRIZE_CONTENT_COLLECTOR_LOADED__) {
    console.log("[Sumrize] Transcript collector already loaded.");
    return;
  }
  global.__SUMRIZE_CONTENT_COLLECTOR_LOADED__ = true;

  let state = "idle";
  let meetingSessionId = null;
  let meetCode = null;
  let startedAt = null;

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

  async function startCapture() {
    if (state === "capturing") {
      return { ok: true, state, meetingSessionId, meetCode };
    }

    if (!global.SumrizeMeetDetector) {
      throw new Error("SumrizeMeetDetector tidak tersedia.");
    }
    if (!global.SumrizeMeetDetector.isValidMeetingPage()) {
      throw new Error("Halaman Google Meet tidak valid.");
    }

    meetCode = global.SumrizeMeetDetector.getMeetCode();
    if (!meetCode) {
      throw new Error("Meet code tidak ditemukan.");
    }

    console.log("[Sumrize] Starting AUDIO capture:", meetCode);

    // 1. Buat session di backend
    const createResponse = await sendRuntimeMessage({
      type: "CREATE_MEETING_SESSION",
      meetCode,
      title: `Google Meet - ${meetCode}`
    });

    if (!createResponse?.ok) {
      throw new Error(
        createResponse?.error || "Gagal membuat meeting session."
      );
    }

    meetingSessionId =
      createResponse.meetingSessionId ||
      createResponse.meeting_session_id ||
      createResponse.id ||
      null;

    if (!meetingSessionId) {
      throw new Error("Meeting session ID tidak diterima dari backend.");
    }

    // 2. Start tab audio di service worker
    const audioResponse = await sendRuntimeMessage({
      type: "START_AUDIO_CAPTURE",
      meetingSessionId
    });

    if (!audioResponse?.ok) {
      throw new Error(
        audioResponse?.error || "Gagal memulai audio capture."
      );
    }

    state = "capturing";
    startedAt = new Date();

    if (global.SumrizeStorage?.set) {
      await global.SumrizeStorage.set({
        captureState: "capturing",
        meetingSessionId,
        meetCode,
        lastError: null
      });
    }

    console.log("[Sumrize] AUDIO capture started", {
      meetingSessionId,
      meetCode
    });

    return { ok: true, state, meetingSessionId, meetCode };
  }

  async function stopCapture() {
    if (state === "idle") {
      return { ok: true, state: "idle" };
    }

    console.log("[Sumrize] Stopping AUDIO capture...");
    state = "stopping";

    try {
      await sendRuntimeMessage({ type: "STOP_AUDIO_CAPTURE" });
    } catch (err) {
      console.warn("[Sumrize] Stop audio failed:", normalizeError(err));
    }

    const sessionId = meetingSessionId;
    if (sessionId) {
      try {
        await sendRuntimeMessage({
          type: "STOP_MEETING_SESSION",
          meetingSessionId: sessionId
        });
      } catch (err) {
        console.error("[Sumrize] Stop meeting failed:", normalizeError(err));
      }
    }

    state = "idle";
    meetingSessionId = null;
    meetCode = null;
    startedAt = null;

    if (global.SumrizeStorage?.reset) {
      await global.SumrizeStorage.reset();
    }

    console.log("[Sumrize] Capture stopped.");
    return { ok: true, state: "idle" };
  }

  function getState() {
    return { state, meetingSessionId, meetCode, startedAt };
  }

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

  console.log("[Sumrize] Transcript Collector (AUDIO mode) loaded.");
})(window);