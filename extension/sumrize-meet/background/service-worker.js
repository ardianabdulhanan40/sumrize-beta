/**
 * background/service-worker.js
 */
import "../utils/storage.js";
import "../api/api-client.js";

console.log("[Sumrize] Service Worker loaded");

let audioCaptureState = {
  active: false,
  tabId: null,
  meetingSessionId: null,
  chunkIndex: 0
};

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

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Capture Google Meet tab audio for transcription"
  });
}

async function closeOffscreenDocument() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    if (contexts.length > 0) {
      await chrome.offscreen.closeDocument();
    }
  } catch (err) {
    console.warn("[Sumrize] close offscreen:", normalizeError(err));
  }
}

async function sendToOffscreen(payload, retries = 8) {
  await ensureOffscreenDocument();

  for (let i = 0; i < retries; i++) {
    try {
      return await chrome.runtime.sendMessage({
        ...payload,
        target: "offscreen"
      });
    } catch (err) {
      const msg = normalizeError(err);
      if (
        msg.includes("Receiving end does not exist") ||
        msg.includes("Could not establish connection")
      ) {
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Offscreen document tidak merespons.");
}

/* ========== MESSAGE ========== */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === "POPUP_GET_STATE") {
    handleGetState(message?.tabId)
      .then((stateData) =>
        sendResponse({
          ok: true,
          ...stateData,
          state: stateData.state || "idle",
          audioCapture: { ...audioCaptureState }
        })
      )
      .catch((e) => sendResponse({ ok: false, error: normalizeError(e) }));
    return true;
  }

  if (message.type === "POPUP_START_CAPTURE") {
    startCaptureViaContent(message)
      .then((r) => {
        if (globalThis.SumrizeStorage?.set) {
          globalThis.SumrizeStorage.set({
            captureState: "capturing",
            meetingSessionId: r?.meetingSessionId || null,
            meetCode: r?.meetCode || null
          }).catch(() => {});
        }
        sendResponse({ ok: true, ...r });
      })
      .catch((e) => sendResponse({ ok: false, error: normalizeError(e) }));
    return true;
  }

  if (message.type === "POPUP_STOP_CAPTURE") {
    stopCaptureViaContent(message)
      .then((r) => {
        if (globalThis.SumrizeStorage?.set) {
          globalThis.SumrizeStorage.set({
            captureState: "stopped"
          }).catch(() => {});
        }
        sendResponse({ ok: true, ...r });
      })
      .catch((e) => sendResponse({ ok: false, error: normalizeError(e) }));
    return true;
  }

  if (message.type === "CHECK_CONNECTOR_STATUS") {
    checkConnector(message?.email)
      .then((r) => sendResponse({ ok: true, data: r }))
      .catch((e) => sendResponse({ ok: false, error: normalizeError(e) }));
    return true;
  }

  if (message.type === "CREATE_MEETING_SESSION") {
    createMeeting(message)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: normalizeError(e) }));
    return true;
  }

  if (message.type === "TRANSCRIPT_SEGMENT") {
    handleTranscript(message)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: normalizeError(e) }));
    return true;
  }

  if (message.type === "STOP_MEETING_SESSION") {
    stopMeeting(message)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: normalizeError(e) }));
    return true;
  }

  if (message.type === "START_AUDIO_CAPTURE") {
    startAudioCapture(message)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: normalizeError(e) }));
    return true;
  }

  if (message.type === "STOP_AUDIO_CAPTURE") {
    stopAudioCapture()
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => sendResponse({ ok: false, error: normalizeError(e) }));
    return true;
  }

  if (message.type === "AUDIO_CHUNK") {
    handleAudioChunk(message)
      .then((r) => sendResponse({ ok: true, ...r }))
      .catch((e) => {
        console.warn("[Sumrize] chunk error:", normalizeError(e));
        sendResponse({ ok: false, error: normalizeError(e) });
      });
    return true;
  }

  if (message.type === "SUMRIZE_PING") {
    sendResponse({ ok: true, version: "1.1.0", name: "Sumrize Meeting Assistant" });
    return true;
  }
});

/* ========== EXTERNAL DASHBOARD COMMUNICATION (PRD SEQUENCE 1) ========== */

if (chrome.runtime.onMessageExternal) {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (!message?.type) return;

    if (message.type === "SUMRIZE_SET_TOKEN" && message.token) {
      if (globalThis.SumrizeStorage?.setAuthToken) {
        globalThis.SumrizeStorage.setAuthToken(message.token)
          .then(() => sendResponse({ ok: true, message: "Token berhasil disimpan di ekstensi." }))
          .catch((err) => sendResponse({ ok: false, error: normalizeError(err) }));
        return true;
      }
    }

    if (message.type === "SUMRIZE_PING") {
      sendResponse({ ok: true, connected: true, version: "1.1.0" });
      return true;
    }
  });
}

async function handleGetState(preferredTabId) {
  let storageState = {};
  if (globalThis.SumrizeStorage) {
    storageState = (await globalThis.SumrizeStorage.getAll()) || {};
  }

  let contentState = null;
  try {
    const tabId = await resolveMeetTabId(preferredTabId);
    if (tabId) {
      contentState = await chrome.tabs.sendMessage(tabId, {
        type: "POPUP_GET_STATE"
      });
    }
  } catch {}

  const merged = {
    ...storageState,
    ...(contentState || {})
  };

  const resolvedState =
    contentState?.state ||
    storageState?.captureState ||
    "idle";

  merged.state = resolvedState;
  merged.captureState = resolvedState;
  return merged;
}

async function resolveMeetTabId(preferredId) {
  if (preferredId) {
    try {
      const t = await chrome.tabs.get(preferredId);
      if (t && t.url && t.url.includes("meet.google.com")) {
        return preferredId;
      }
    } catch {}
  }

  // Cari semua tab Google Meet di browser
  const tabs = await chrome.tabs.query({ url: "*://meet.google.com/*" });
  if (!tabs || tabs.length === 0) {
    throw new Error("Tab Google Meet tidak ditemukan. Buka tab meet.google.com terlebih dahulu.");
  }

  // Prioritaskan tab yang sedang aktif
  const activeTab = tabs.find((t) => t.active) || tabs[0];
  if (!activeTab?.id) {
    throw new Error("Tab Google Meet tidak valid.");
  }
  return activeTab.id;
}

async function startCaptureViaContent(message) {
  const tabId = await resolveMeetTabId(message?.tabId);

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "POPUP_START_CAPTURE"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Content script gagal start.");
    }
    return response;
  } catch (err) {
    const msg = normalizeError(err);
    if (
      msg.includes("Receiving end does not exist") ||
      msg.includes("Could not establish connection")
    ) {
      throw new Error(
        "Content script belum siap. Refresh tab Google Meet (F5), lalu coba lagi."
      );
    }
    throw err;
  }
}

async function stopCaptureViaContent(message) {
  const tabId = await resolveMeetTabId(message?.tabId);

  if (audioCaptureState.active) {
    try {
      await stopAudioCapture();
    } catch {}
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "POPUP_STOP_CAPTURE"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Content script gagal stop.");
    }
    return response;
  } catch (err) {
    const msg = normalizeError(err);
    if (
      msg.includes("Receiving end does not exist") ||
      msg.includes("Could not establish connection")
    ) {
      return { ok: true, note: "Content script sudah tidak aktif." };
    }
    throw err;
  }
}

async function checkConnector(email) {
  if (!globalThis.SumrizeApi?.detectConnector) {
    throw new Error("SumrizeApi.detectConnector tidak tersedia.");
  }

  let targetEmail = email;
  if (!targetEmail && globalThis.SumrizeStorage?.getDetectedMeetEmail) {
    targetEmail = await globalThis.SumrizeStorage.getDetectedMeetEmail();
  }

  const res = await globalThis.SumrizeApi.detectConnector({ email: targetEmail });
  if (res?.ok && res?.data?.connected && res?.data?.token) {
    if (globalThis.SumrizeStorage) {
      await globalThis.SumrizeStorage.setAuthToken(res.data.token);
      if (res.data.connector) {
        await globalThis.SumrizeStorage.setConnectorInfo(res.data.connector);
      }
      if (res.data.user) {
        await globalThis.SumrizeStorage.setUserInfo(res.data.user);
      }
    }
  }
  return res?.data || res;
}

async function createMeeting(message) {
  if (!globalThis.SumrizeApi?.createMeetingSession) {
    throw new Error("SumrizeApi.createMeetingSession tidak tersedia.");
  }
  const meetCode = message?.meetCode;
  if (!meetCode) throw new Error("Meet code tidak tersedia.");

  return await globalThis.SumrizeApi.createMeetingSession({
    meetCode,
    title: message?.title || `Google Meet - ${meetCode}`
  });
}

async function stopMeeting(message) {
  if (!globalThis.SumrizeApi?.stopMeetingSession) {
    throw new Error("SumrizeApi.stopMeetingSession tidak tersedia.");
  }
  const meetingSessionId = message?.meetingSessionId;
  if (!meetingSessionId) throw new Error("meetingSessionId kosong.");

  return await globalThis.SumrizeApi.stopMeetingSession({ meetingSessionId });
}

async function handleTranscript(message) {
  if (!message?.meetingSessionId) throw new Error("meetingSessionId kosong.");
  const text = String(message.text || message.kalimat || "").trim();
  if (!text) throw new Error("text kosong.");

  const speaker = String(message.speaker || message.username || "Unknown").trim();

  console.log(
    `%c[Sumrize SW Live] %c${speaker}: %c"${text}"`,
    "background: #10b981; color: white; padding: 2px 5px; border-radius: 3px; font-weight: bold;",
    "color: #3b82f6; font-weight: bold;",
    "color: #e2e8f0;"
  );

  if (!globalThis.SumrizeApi?.sendTranscript) {
    throw new Error("SumrizeApi.sendTranscript tidak tersedia.");
  }

  return await globalThis.SumrizeApi.sendTranscript({
    meetingSessionId: message.meetingSessionId,
    speaker,
    username: speaker,
    text,
    kalimat: text,
    timestamp: message.timestamp,
    sequence: message.sequence
  });
}

async function startAudioCapture(message) {
  if (audioCaptureState.active) {
    return { active: true, ...audioCaptureState };
  }

  const meetingSessionId = message?.meetingSessionId;
  if (!meetingSessionId) {
    throw new Error("meetingSessionId wajib untuk audio capture.");
  }

  const tabId = await resolveMeetTabId(message?.tabId);
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId
  });

  if (!streamId) throw new Error("Gagal mendapatkan streamId.");

  const offRes = await sendToOffscreen({
    type: "START_TAB_AUDIO",
    streamId
  });

  if (!offRes?.ok) {
    throw new Error(offRes?.error || "Offscreen gagal start.");
  }

  audioCaptureState = {
    active: true,
    tabId,
    meetingSessionId,
    chunkIndex: 0
  };

  console.log("[Sumrize] Audio capture started", audioCaptureState);
  return { active: true, tabId, meetingSessionId };
}

async function stopAudioCapture() {
  if (!audioCaptureState.active) return { active: false };

  try {
    await sendToOffscreen({ type: "STOP_TAB_AUDIO" });
  } catch (err) {
    console.warn("[Sumrize] stop offscreen:", normalizeError(err));
  }

  await closeOffscreenDocument();

  audioCaptureState = {
    active: false,
    tabId: null,
    meetingSessionId: null,
    chunkIndex: 0
  };

  console.log("[Sumrize] Audio capture stopped");
  return { active: false };
}

async function handleAudioChunk(message) {
  if (!audioCaptureState.active || !audioCaptureState.meetingSessionId) {
    return { skipped: true };
  }

  const { buffer, mimeType, timestamp } = message;
  if (!buffer?.length) return { skipped: true };

  audioCaptureState.chunkIndex += 1;
  const sequence = audioCaptureState.chunkIndex;

  const blob = new Blob([new Uint8Array(buffer)], {
    type: mimeType || "audio/webm"
  });

  console.log(`[Sumrize] Audio chunk #${sequence} size=${blob.size}`);

  if (!globalThis.SumrizeApi?.transcribeAudio) {
    console.warn("[Sumrize] transcribeAudio belum diimplementasi di api-client.");
    return { skipped: true, reason: "no transcribeAudio" };
  }

  const stt = await globalThis.SumrizeApi.transcribeAudio({
    meetingSessionId: audioCaptureState.meetingSessionId,
    audioBlob: blob,
    mimeType: mimeType || "audio/webm",
    sequence,
    timestamp: timestamp || new Date().toISOString()
  });

  const text = stt?.text?.trim();
  if (!text) {
    console.log(`[Sumrize] Chunk #${sequence}: empty`);
    return { ok: true, empty: true };
  }

  console.log(`[Sumrize] STT #${sequence}: "${text}"`);

  await handleTranscript({
    meetingSessionId: audioCaptureState.meetingSessionId,
    speaker: stt.speaker || "Unknown",
    text,
    timestamp: timestamp || new Date().toISOString(),
    sequence
  });

  return { ok: true, text, sequence };
}

/* External auth (dashboard localhost) */
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  try {
    const origin = sender?.url ? new URL(sender.url).origin : "";
    if (origin !== "http://localhost:3000") {
      sendResponse({ ok: false, error: "Origin tidak diizinkan." });
      return;
    }

    if (message?.type === "SUMRIZE_AUTH_TOKEN") {
      if (!message.token) {
        sendResponse({ ok: false, error: "Auth token kosong." });
        return;
      }
      globalThis.SumrizeStorage.setAuthToken(message.token)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: normalizeError(e) }));
      return true;
    }

    sendResponse({ ok: false, error: "Message type tidak dikenal." });
  } catch (e) {
    sendResponse({ ok: false, error: normalizeError(e) });
  }
});