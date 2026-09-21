/**
 * offscreen.js
 *
 * Capture audio Google Meet dari tabCapture,
 * konversi menjadi PCM,
 * potong menjadi WAV 16 kHz mono,
 * lalu kirim setiap chunk ke service worker.
 */

let mediaStream = null;
let audioContext = null;

let sourceNode = null;
let analyserNode = null;
let processorNode = null;

let isCapturing = false;

let chunkIndex = 0;

let audioBuffer = [];

let accumulatedSamples = 0;

const CHUNK_SECONDS = 4;
const TARGET_SAMPLE_RATE = 16000;

/**
 * ============================================
 * MESSAGE HANDLER
 * ============================================
 */

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.target !== "offscreen") {
      return;
    }

    if (message.type === "START_TAB_AUDIO") {
      startCapture(message.streamId)
        .then(() => {
          sendResponse({
            ok: true
          });
        })
        .catch((err) => {
          console.error(
            "[Sumrize Offscreen] Start failed:",
            err?.message || err
          );

          cleanupAudio();

          sendResponse({
            ok: false,
            error: String(
              err?.message || err
            )
          });
        });

      return true;
    }

    if (message.type === "STOP_TAB_AUDIO") {
      stopCapture();

      sendResponse({
        ok: true
      });

      return true;
    }
  }
);

/**
 * ============================================
 * START CAPTURE
 * ============================================
 */

async function startCapture(streamId) {
  if (isCapturing) {
    console.log(
      "[Sumrize Offscreen] Capture already active."
    );

    return;
  }

  if (!streamId) {
    throw new Error("streamId kosong.");
  }

  isCapturing = true;

  chunkIndex = 0;

  audioBuffer = [];

  accumulatedSamples = 0;

  /**
   * --------------------------------------------
   * GET TAB AUDIO
   * --------------------------------------------
   */

  mediaStream =
    await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

  const audioTracks =
    mediaStream.getAudioTracks();

  console.log(
    "[Sumrize Offscreen] Audio tracks:",
    audioTracks.length
  );

  if (audioTracks.length === 0) {
    throw new Error(
      "Audio track Google Meet tidak ditemukan."
    );
  }

  /**
   * --------------------------------------------
   * AUDIO CONTEXT
   * --------------------------------------------
   */

  audioContext = new AudioContext();

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  console.log(
    "[Sumrize Offscreen] AudioContext:",
    audioContext.state
  );

  console.log(
    "[Sumrize Offscreen] Input sample rate:",
    audioContext.sampleRate
  );

  /**
   * --------------------------------------------
   * SOURCE
   * --------------------------------------------
   */

  sourceNode =
    audioContext.createMediaStreamSource(
      mediaStream
    );

  /**
   * --------------------------------------------
   * ANALYSER
   * --------------------------------------------
   */

  analyserNode =
    audioContext.createAnalyser();

  analyserNode.fftSize = 2048;

  sourceNode.connect(analyserNode);

  /**
   * --------------------------------------------
   * KEEP GOOGLE MEET AUDIO AUDIBLE
   * --------------------------------------------
   */

  sourceNode.connect(
    audioContext.destination
  );

  /**
   * --------------------------------------------
   * PROCESSOR
   * --------------------------------------------
   *
   * ScriptProcessor dipakai untuk mendapatkan
   * PCM audio langsung dari AudioContext.
   *
   * Walaupun deprecated di spesifikasi modern,
   * ini masih tersedia di Chrome dan praktis
   * untuk MVP extension lokal.
   */

  processorNode =
    audioContext.createScriptProcessor(
      4096,
      1,
      1
    );

  sourceNode.connect(
    processorNode
  );

  /**
   * Processor harus tersambung ke destination
   * supaya onaudioprocess tetap berjalan.
   *
   * Output processor dibuat SILENCE supaya
   * audio Meet tidak terdengar dua kali.
   */

  processorNode.connect(
    audioContext.destination
  );

  /**
   * --------------------------------------------
   * PROCESS PCM
   * --------------------------------------------
   */

  processorNode.onaudioprocess = (event) => {
    if (!isCapturing) {
      return;
    }

    const input =
      event.inputBuffer.getChannelData(0);

    /**
     * Copy karena buffer input milik browser
     * akan dipakai ulang.
     */

    const copy =
      new Float32Array(input.length);

    copy.set(input);

    audioBuffer.push(copy);

    accumulatedSamples += copy.length;

    /**
     * Beri diagnostic audio level.
     */

    let sum = 0;

    for (let i = 0; i < copy.length; i++) {
      sum += copy[i] * copy[i];
    }

    const rms =
      Math.sqrt(
        sum / copy.length
      );

    /**
     * Target chunk berdasarkan sample rate asli.
     */

    const requiredSamples =
      audioContext.sampleRate *
      CHUNK_SECONDS;

    if (
      accumulatedSamples >=
      requiredSamples
    ) {
      flushAudioChunk();
    }
  };

  /**
   * --------------------------------------------
   * MONITOR LEVEL
   * --------------------------------------------
   */

  startAudioMonitor();

  console.log(
    `[Sumrize Offscreen] PCM capture started. Target=${TARGET_SAMPLE_RATE}Hz`
  );
}

/**
 * ============================================
 * FLUSH AUDIO CHUNK
 * ============================================
 */

async function flushAudioChunk() {
  if (
    audioBuffer.length === 0 ||
    accumulatedSamples === 0
  ) {
    return;
  }

  /**
   * Ambil semua Float32Array yang sudah terkumpul.
   */

  const totalLength =
    accumulatedSamples;

  const combined =
    new Float32Array(totalLength);

  let offset = 0;

  for (const buffer of audioBuffer) {
    combined.set(buffer, offset);

    offset += buffer.length;
  }

  /**
   * Reset buffer SEBELUM async operation
   * supaya capture berikutnya tetap berjalan.
   */

  audioBuffer = [];

  accumulatedSamples = 0;

  /**
   * Downsample ke 16 kHz.
   */

  const downsampled =
    downsampleBuffer(
      combined,
      audioContext.sampleRate,
      TARGET_SAMPLE_RATE
    );

  /**
   * Buat WAV standalone.
   */

  const wavBuffer =
    encodeWav(
      downsampled,
      TARGET_SAMPLE_RATE
    );

  const bytes =
    Array.from(
      new Uint8Array(wavBuffer)
    );

  chunkIndex += 1;

  console.log(
    `[Sumrize Offscreen] WAV chunk #${chunkIndex}:`,
    {
      bytes: bytes.length,
      sampleRate:
        TARGET_SAMPLE_RATE,
      duration:
        (
          downsampled.length /
          TARGET_SAMPLE_RATE
        ).toFixed(2) + "s"
    }
  );

  /**
   * Kirim ke service worker.
   */

  chrome.runtime.sendMessage({
    type: "AUDIO_CHUNK",

    chunkIndex,

    mimeType: "audio/wav",

    buffer: bytes,

    timestamp:
      new Date().toISOString()
  });
}

/**
 * ============================================
 * DOWNSAMPLE
 * ============================================
 */

function downsampleBuffer(
  buffer,
  inputSampleRate,
  outputSampleRate
) {
  if (
    outputSampleRate ===
    inputSampleRate
  ) {
    return buffer;
  }

  if (
    outputSampleRate >
    inputSampleRate
  ) {
    throw new Error(
      "Output sample rate tidak boleh lebih besar dari input."
    );
  }

  const ratio =
    inputSampleRate /
    outputSampleRate;

  const newLength =
    Math.round(
      buffer.length / ratio
    );

  const result =
    new Float32Array(
      newLength
    );

  let offsetResult = 0;
  let offsetBuffer = 0;

  while (
    offsetResult <
      result.length &&
    offsetBuffer <
      buffer.length
  ) {
    const nextOffsetBuffer =
      Math.round(
        (offsetResult + 1) *
          ratio
      );

    let accum = 0;

    let count = 0;

    for (
      let i = offsetBuffer;
      i < nextOffsetBuffer &&
      i < buffer.length;
      i++
    ) {
      accum += buffer[i];

      count++;
    }

    result[offsetResult] =
      count > 0
        ? accum / count
        : 0;

    offsetResult++;

    offsetBuffer =
      nextOffsetBuffer;
  }

  return result;
}

/**
 * ============================================
 * ENCODE WAV
 * ============================================
 */

function encodeWav(
  samples,
  sampleRate
) {
  const numChannels = 1;

  const bitsPerSample = 16;

  const bytesPerSample =
    bitsPerSample / 8;

  const dataSize =
    samples.length *
    bytesPerSample;

  const buffer =
    new ArrayBuffer(
      44 + dataSize
    );

  const view =
    new DataView(buffer);

  /**
   * RIFF
   */

  writeString(
    view,
    0,
    "RIFF"
  );

  view.setUint32(
    4,
    36 + dataSize,
    true
  );

  /**
   * WAVE
   */

  writeString(
    view,
    8,
    "WAVE"
  );

  /**
   * fmt
   */

  writeString(
    view,
    12,
    "fmt "
  );

  view.setUint32(
    16,
    16,
    true
  );

  /**
   * PCM
   */

  view.setUint16(
    20,
    1,
    true
  );

  /**
   * Channels
   */

  view.setUint16(
    22,
    numChannels,
    true
  );

  /**
   * Sample rate
   */

  view.setUint32(
    24,
    sampleRate,
    true
  );

  /**
   * Byte rate
   */

  view.setUint32(
    28,
    sampleRate *
      numChannels *
      bytesPerSample,
    true
  );

  /**
   * Block align
   */

  view.setUint16(
    32,
    numChannels *
      bytesPerSample,
    true
  );

  /**
   * Bits per sample
   */

  view.setUint16(
    34,
    bitsPerSample,
    true
  );

  /**
   * data
   */

  writeString(
    view,
    36,
    "data"
  );

  view.setUint32(
    40,
    dataSize,
    true
  );

  /**
   * PCM samples
   */

  let offset = 44;

  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    let sample =
      samples[i];

    /**
     * Clamp
     */

    sample =
      Math.max(
        -1,
        Math.min(1, sample)
      );

    /**
     * Float → Int16
     */

    const value =
      sample < 0
        ? sample * 0x8000
        : sample * 0x7fff;

    view.setInt16(
      offset,
      value,
      true
    );

    offset += 2;
  }

  return buffer;
}

/**
 * ============================================
 * WRITE STRING
 * ============================================
 */

function writeString(
  view,
  offset,
  string
) {
  for (
    let i = 0;
    i < string.length;
    i++
  ) {
    view.setUint8(
      offset + i,
      string.charCodeAt(i)
    );
  }
}

/**
 * ============================================
 * AUDIO LEVEL MONITOR
 * ============================================
 */

function startAudioMonitor() {
  if (!analyserNode) {
    return;
  }

  const data =
    new Uint8Array(
      analyserNode.fftSize
    );

  const check = () => {
    if (
      !isCapturing ||
      !analyserNode
    ) {
      return;
    }

    analyserNode.getByteTimeDomainData(
      data
    );

    let sum = 0;

    for (
      let i = 0;
      i < data.length;
      i++
    ) {
      const value =
        (data[i] - 128) /
        128;

      sum += value * value;
    }

    const rms =
      Math.sqrt(
        sum / data.length
      );

    const percent =
      Math.round(
        Math.min(
          1,
          rms * 5
        ) * 100
      );

    console.log(
      "[Sumrize Offscreen] AUDIO LEVEL:",
      percent + "%",
      "RMS:",
      rms.toFixed(4)
    );

    setTimeout(
      check,
      1000
    );
  };

  check();
}

/**
 * ============================================
 * STOP CAPTURE
 * ============================================
 */

function stopCapture() {
  console.log(
    "[Sumrize Offscreen] Stopping capture..."
  );

  isCapturing = false;

  /**
   * Kirim sisa audio yang belum mencapai
   * 4 detik.
   */

  if (
    accumulatedSamples > 0
  ) {
    flushAudioChunk();
  }

  /**
   * Tunggu sedikit agar chunk terakhir
   * selesai dibuat dan dikirim.
   */

  setTimeout(() => {
    cleanupAudio();

    console.log(
      "[Sumrize Offscreen] Capture stopped."
    );
  }, 500);
}

/**
 * ============================================
 * CLEANUP
 * ============================================
 */

function cleanupAudio() {
  try {
    if (processorNode) {
      processorNode.disconnect();
    }
  } catch {}

  try {
    if (sourceNode) {
      sourceNode.disconnect();
    }
  } catch {}

  try {
    if (analyserNode) {
      analyserNode.disconnect();
    }
  } catch {}

  processorNode = null;
  sourceNode = null;
  analyserNode = null;

  audioBuffer = [];

  accumulatedSamples = 0;

  if (mediaStream) {
    try {
      mediaStream
        .getTracks()
        .forEach((track) => {
          try {
            track.stop();
          } catch {}
        });
    } catch {}

    mediaStream = null;
  }

  if (audioContext) {
    try {
      if (
        audioContext.state !== "closed"
      ) {
        audioContext.close();
      }
    } catch {}

    audioContext = null;
  }
}