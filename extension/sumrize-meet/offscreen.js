/**
 * offscreen.js
 * Capture audio tab Google Meet, potong per chunk, kirim ke service worker.
 */
let mediaStream = null;
let audioContext = null;
let mediaRecorder = null;
let isCapturing = false;
let chunkIndex = 0;

const CHUNK_MS = 4000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") return;

  if (message.type === "START_TAB_AUDIO") {
    startCapture(message.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[Sumrize Offscreen] start failed:", err);
        sendResponse({ ok: false, error: String(err?.message || err) });
      });
    return true;
  }

  if (message.type === "STOP_TAB_AUDIO") {
    stopCapture();
    sendResponse({ ok: true });
    return true;
  }
});

async function startCapture(streamId) {
  if (isCapturing) return;
  if (!streamId) throw new Error("streamId kosong");

  isCapturing = true;
  chunkIndex = 0;

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  // Supaya audio Meet tetap terdengar
  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(mediaStream);
  source.connect(audioContext.destination);

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  mediaRecorder = new MediaRecorder(mediaStream, {
    mimeType,
    audioBitsPerSecond: 128000
  });

  mediaRecorder.ondataavailable = async (event) => {
    if (!event.data || event.data.size < 800) return;

    chunkIndex += 1;
    const ab = await event.data.arrayBuffer();
    const bytes = Array.from(new Uint8Array(ab));

    chrome.runtime.sendMessage({
      type: "AUDIO_CHUNK",
      chunkIndex,
      mimeType: event.data.type || mimeType,
      buffer: bytes,
      timestamp: new Date().toISOString()
    });
  };

  mediaRecorder.onerror = (e) => {
    console.error("[Sumrize Offscreen] MediaRecorder error:", e);
  };

  mediaRecorder.start(CHUNK_MS);
  console.log("[Sumrize Offscreen] Tab audio capture started");
}

function stopCapture() {
  isCapturing = false;

  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  } catch {}

  mediaRecorder = null;

  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  if (audioContext) {
    try {
      audioContext.close();
    } catch {}
    audioContext = null;
  }

  console.log("[Sumrize Offscreen] Tab audio capture stopped");
}