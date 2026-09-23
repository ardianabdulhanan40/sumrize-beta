/**
 * content/transcript-collector.js
 *
 * Sumrize Meeting Assistant - In-Meet Docked Sidebar Panel
 * Menampilkan live feed kalimat transkrip dan rangkuman AI langsung pada sisi panel Google Meet
 * dengan kemampuan minimize dan maximize tanpa menutupi layar meeting utama.
 *
 * Mengikuti standar PRD SUM-53:
 * - Sequence 2: Deteksi Google Meet & Tampilkan Sidebar Otomatis (Docked tanpa overlap)
 * - Sequence 3: Privacy Notice Modal & Start Capture
 * - Sequence 4 & 5: Real-time Transcript Feed, Live Metrics, CC & Mic Status
 * - Sequence 6: Stop Capture, AI Rangkuman & Notula, Export/Copy/Download
 */
(function (global) {
  "use strict";

  if (global.__SUMRIZE_CONTENT_COLLECTOR_LOADED__) {
    return;
  }
  global.__SUMRIZE_CONTENT_COLLECTOR_LOADED__ = true;

  /* =========================================================
     STATE MANAGEMENT
     ========================================================= */

  let state = "idle"; // "idle" | "capturing" | "stopping" | "stopped"
  let meetingSessionId = null;
  let meetCode = null;
  let startedAt = null;
  let endedAt = null;

  let captionObserver = null;
  let speechRecognizer = null;
  let transcriptBuffer = null;
  let isMicMuted = false;
  let unwatchMicStatus = null;

  let segmentsFinalized = 0;
  let wordsCount = 0;
  let lastSpeaker = "Unknown";
  let lastText = "";
  let capturedHistory = []; // Array of { speaker, text, timestamp, sequence }

  // Sidebar UI State
  let activeTab = "transcripts"; // "transcripts" | "summary" | "info"
  let sidebarMode = "docked"; // "docked" | "expanded" | "minimized" | "hidden"
  let searchQuery = "";
  let isUserScrolledUp = false;
  let unreadWhileScrolled = 0;

  // AI Summary State
  let lastSummaryData = null;
  let isGeneratingSummary = false;

  // UI Elements
  let panelContainer = null;
  let minimizedPill = null;
  let timerInterval = null;
  let ccCheckInterval = null;

  // Theme & Connector
  let currentThemeIsDark = true;
  let cachedConnectorInfo = null;
  let cachedUserInfo = null;

  /* =========================================================
     UTILITY HELPERS
     ========================================================= */

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

  function formatDuration(start, end = new Date()) {
    if (!start) return "00:00";
    const s = Math.max(0, Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 1000));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  function formatTime(isoOrDate) {
    if (!isoOrDate) return "";
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function extractCleanMeetCode() {
    if (global.SumrizeMeetDetector?.getMeetCode) {
      const code = global.SumrizeMeetDetector.getMeetCode();
      if (code) return code;
    }
    const match = window.location.pathname.match(/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
    return match ? match[1].toLowerCase() : null;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getSpeakerColor(speaker) {
    const isMe =
      speaker === "Anda (Saya)" ||
      speaker === "Anda" ||
      speaker === "You" ||
      speaker === "Saya";

    if (isMe) {
      return { bg: "rgba(255, 68, 56, 0.2)", border: "#FF4438", text: "#ff827a", initials: "Anda" };
    }

    const palette = [
      { bg: "rgba(59, 130, 246, 0.2)", border: "#3b82f6", text: "#93c5fd" },
      { bg: "rgba(16, 185, 129, 0.2)", border: "#10b981", text: "#6ee7b7" },
      { bg: "rgba(139, 92, 246, 0.2)", border: "#8b5cf6", text: "#c4b5fd" },
      { bg: "rgba(245, 158, 11, 0.2)", border: "#f59e0b", text: "#fcd34d" },
      { bg: "rgba(236, 72, 153, 0.2)", border: "#ec4899", text: "#f472b6" },
      { bg: "rgba(6, 182, 212, 0.2)", border: "#06b6d4", text: "#67e8f9" }
    ];

    let hash = 0;
    for (let i = 0; i < (speaker || "").length; i++) {
      hash = speaker.charCodeAt(i) + ((hash << 5) - hash);
    }
    const item = palette[Math.abs(hash) % palette.length];
    const initials = (speaker || "U")
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();

    return { ...item, initials: initials || "U" };
  }

  /* =========================================================
     THEME & ASSETS
     ========================================================= */

  async function resolveActiveTheme() {
    if (global.SumrizeStorage?.isDarkMode) {
      currentThemeIsDark = await global.SumrizeStorage.isDarkMode();
    } else if (window.matchMedia) {
      currentThemeIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } else {
      currentThemeIsDark = true;
    }
    return currentThemeIsDark;
  }

  function getLogoAssetUrl() {
    const filename = currentThemeIsDark ? "assets/logo-white.png" : "assets/logo-black.png";
    return chrome.runtime.getURL(filename);
  }

  function updateLogoImages() {
    const logoUrl = getLogoAssetUrl();
    const imgs = document.querySelectorAll(".sumrize-logo-img");
    imgs.forEach((img) => {
      img.src = logoUrl;
    });
  }

  async function fetchConnectorAccount(email = null) {
    let baseUrl = "http://localhost:8000/api/meeting";
    if (global.SumrizeStorage?.getApiBaseUrl) {
      baseUrl = await global.SumrizeStorage.getApiBaseUrl();
    }

    let targetEmail = email;
    if (!targetEmail && global.SumrizeMeetDetector?.getCurrentUserAccount) {
      const acc = global.SumrizeMeetDetector.getCurrentUserAccount();
      if (acc?.email) targetEmail = acc.email;
    }
    if (!targetEmail && global.SumrizeStorage?.getDetectedMeetEmail) {
      targetEmail = await global.SumrizeStorage.getDetectedMeetEmail();
    }

    if (global.SumrizeStorage) {
      cachedConnectorInfo = await global.SumrizeStorage.getConnectorInfo();
      cachedUserInfo = await global.SumrizeStorage.getUserInfo();
    }

    try {
      let detectUrl = `${baseUrl}/detect-connector.php`;
      if (targetEmail) {
        detectUrl += `?email=${encodeURIComponent(targetEmail)}`;
      }

      const res = await fetch(detectUrl, {
        headers: { Accept: "application/json" }
      });
      const result = await res.json().catch(() => null);

      if (result?.ok && result?.data?.connected) {
        const data = result.data;
        cachedConnectorInfo = data.connector || null;
        cachedUserInfo = data.user || null;

        if (global.SumrizeStorage) {
          if (data.token) await global.SumrizeStorage.setAuthToken(data.token);
          if (data.connector) await global.SumrizeStorage.setConnectorInfo(data.connector);
          if (data.user) await global.SumrizeStorage.setUserInfo(data.user);
          await global.SumrizeStorage.set({ authMethod: "connector_auto" });
          if (targetEmail) await global.SumrizeStorage.setDetectedMeetEmail(targetEmail);
        }

        return { connected: true, connector: data.connector, user: data.user };
      }
    } catch (err) {
      console.warn("[Sumrize Content] Gagal memanggil detect-connector:", err);
    }

    if (cachedConnectorInfo && cachedConnectorInfo.status === "connected") {
      return { connected: true, connector: cachedConnectorInfo, user: cachedUserInfo };
    }

    return { connected: false, connector: null, user: null };
  }

  /* =========================================================
     CSS STYLES & LAYOUT DISPLACEMENT
     ========================================================= */

  function ensureStyles() {
    if (document.getElementById("sumrize-panel-styles")) return;
    const style = document.createElement("style");
    style.id = "sumrize-panel-styles";
    style.textContent = `
      /* === LAYOUT DISPLACEMENT (TANPA MENUTUPI LAYAR MEETING) === */
      body.sumrize-sidebar-docked {
        margin-right: 380px !important;
        width: calc(100% - 380px) !important;
        transition: margin-right 0.25s cubic-bezier(0.16, 1, 0.3, 1), width 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        box-sizing: border-box !important;
      }
      body.sumrize-sidebar-expanded {
        margin-right: 520px !important;
        width: calc(100% - 520px) !important;
        transition: margin-right 0.25s cubic-bezier(0.16, 1, 0.3, 1), width 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        box-sizing: border-box !important;
      }

      /* === GOOGLE MEET SIDEBAR PANEL === */
      #sumrize-meet-panel {
        position: fixed !important;
        top: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 380px !important;
        height: 100vh !important;
        max-height: 100vh !important;
        background: rgba(13, 17, 26, 0.97) !important;
        backdrop-filter: blur(20px) !important;
        -webkit-backdrop-filter: blur(20px) !important;
        border-left: 1px solid rgba(255, 255, 255, 0.12) !important;
        border-top: none !important;
        border-right: none !important;
        border-bottom: none !important;
        border-radius: 0 !important;
        box-shadow: -8px 0 36px rgba(0, 0, 0, 0.55) !important;
        color: #f8fafc !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
        font-size: 13px !important;
        z-index: 999990 !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), width 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        box-sizing: border-box !important;
      }

      #sumrize-meet-panel.expanded {
        width: 520px !important;
      }

      #sumrize-meet-panel.minimized {
        transform: translateX(100%) !important;
        pointer-events: none !important;
      }

      /* Light Mode theme */
      body.sumrize-light #sumrize-meet-panel {
        background: rgba(255, 255, 255, 0.98) !important;
        color: #0f172a !important;
        border-left: 1px solid rgba(0, 0, 0, 0.12) !important;
        box-shadow: -8px 0 30px rgba(0, 0, 0, 0.15) !important;
      }

      /* === MINIMIZED DOCK PILL === */
      #sumrize-minimized-pill {
        position: fixed !important;
        right: 18px !important;
        bottom: 84px !important;
        z-index: 999995 !important;
        background: rgba(15, 23, 42, 0.94) !important;
        backdrop-filter: blur(14px) !important;
        border: 1px solid rgba(255, 68, 56, 0.45) !important;
        border-radius: 30px !important;
        padding: 8px 16px !important;
        cursor: pointer !important;
        display: none;
        align-items: center !important;
        gap: 8px !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6), 0 0 14px rgba(255, 68, 56, 0.25) !important;
        color: #f8fafc !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      #sumrize-minimized-pill:hover {
        transform: translateY(-2px) scale(1.03) !important;
        border-color: #FF4438 !important;
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.7), 0 0 18px rgba(255, 68, 56, 0.35) !important;
      }

      /* === HEADER === */
      .sumrize-sb-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        background: rgba(255, 255, 255, 0.03);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        flex-shrink: 0;
      }
      body.sumrize-light .sumrize-sb-header {
        background: rgba(0, 0, 0, 0.03);
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      }
      .sumrize-sb-brand {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        font-size: 13px;
      }
      .sumrize-logo-img {
        height: 18px;
        max-width: 85px;
        width: auto;
        object-fit: contain;
        vertical-align: middle;
      }
      .sumrize-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .sumrize-btn-tool {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        transition: all 0.15s ease;
      }
      .sumrize-btn-tool:hover {
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
      }
      body.sumrize-light .sumrize-btn-tool:hover {
        background: rgba(0, 0, 0, 0.08);
        color: #0f172a;
      }

      /* === TABS NAV === */
      .sumrize-tabs-nav {
        display: flex;
        align-items: center;
        padding: 6px 12px 0 12px;
        background: rgba(255, 255, 255, 0.015);
        border-bottom: 1px solid rgba(255, 255, 255, 0.07);
        flex-shrink: 0;
        gap: 4px;
      }
      body.sumrize-light .sumrize-tabs-nav {
        background: rgba(0, 0, 0, 0.02);
        border-bottom: 1px solid rgba(0, 0, 0, 0.07);
      }
      .sumrize-tab-btn {
        flex: 1;
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        padding: 8px 6px;
        color: #94a3b8;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.2s ease;
        white-space: nowrap;
      }
      .sumrize-tab-btn:hover {
        color: #f8fafc;
      }
      body.sumrize-light .sumrize-tab-btn:hover {
        color: #0f172a;
      }
      .sumrize-tab-btn.active {
        color: #FF4438 !important;
        border-bottom-color: #FF4438 !important;
      }
      .sumrize-tab-badge {
        background: rgba(255, 68, 56, 0.2);
        color: #ff827a;
        font-size: 10px;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 10px;
      }
      .sumrize-tab-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #10b981;
      }

      /* === BODY / CONTENT AREA === */
      .sumrize-sb-body {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 0;
      }
      .sumrize-sb-body::-webkit-scrollbar {
        width: 5px;
      }
      .sumrize-sb-body::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);
        border-radius: 4px;
      }

      /* === TRANSCRIPT FEED === */
      .sumrize-search-bar {
        position: relative;
        flex-shrink: 0;
      }
      .sumrize-search-input {
        width: 100%;
        box-sizing: border-box;
        background: rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        padding: 7px 10px 7px 28px;
        color: #f8fafc;
        font-size: 12px;
        outline: none;
        transition: border-color 0.2s ease;
      }
      .sumrize-search-input:focus {
        border-color: #FF4438;
      }
      body.sumrize-light .sumrize-search-input {
        background: #f1f5f9;
        color: #0f172a;
        border: 1px solid #cbd5e1;
      }
      .sumrize-search-icon {
        position: absolute;
        left: 8px;
        top: 50%;
        transform: translateY(-50%);
        color: #64748b;
        font-size: 12px;
        pointer-events: none;
      }

      .sumrize-feed-container {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 120px;
        position: relative;
        padding-right: 2px;
      }
      .sumrize-feed-container::-webkit-scrollbar {
        width: 4px;
      }
      .sumrize-feed-container::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);
        border-radius: 4px;
      }

      .sumrize-turn-card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 8px 10px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        transition: background 0.15s ease;
      }
      .sumrize-turn-card:hover {
        background: rgba(255, 255, 255, 0.05);
      }
      body.sumrize-light .sumrize-turn-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }
      .sumrize-turn-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .sumrize-turn-speaker-wrap {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .sumrize-avatar-badge {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        flex-shrink: 0;
      }
      .sumrize-turn-speaker-name {
        font-weight: 600;
        font-size: 11px;
      }
      .sumrize-turn-time {
        font-size: 10px;
        color: #64748b;
      }
      .sumrize-turn-text {
        font-size: 12px;
        line-height: 1.45;
        color: #e2e8f0;
        word-break: break-word;
      }
      body.sumrize-light .sumrize-turn-text {
        color: #1e293b;
      }

      .sumrize-btn-scroll-down {
        position: absolute;
        bottom: 8px;
        left: 50%;
        transform: translateX(-50%);
        background: #FF4438;
        color: #fff;
        border: none;
        border-radius: 20px;
        padding: 4px 12px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
        display: none;
        align-items: center;
        gap: 4px;
        z-index: 10;
        animation: sumrizeBounce 1.5s infinite;
      }
      @keyframes sumrizeBounce {
        0%, 100% { transform: translate(-50%, 0); }
        50% { transform: translate(-50%, -3px); }
      }

      /* === SUMMARY TAB === */
      .sumrize-summary-box {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .sumrize-summary-card {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      body.sumrize-light .sumrize-summary-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }
      .sumrize-summary-title {
        font-size: 12px;
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 6px;
        color: #f1f5f9;
      }
      body.sumrize-light .sumrize-summary-title {
        color: #0f172a;
      }
      .sumrize-summary-body {
        font-size: 12px;
        line-height: 1.5;
        color: #cbd5e1;
      }
      body.sumrize-light .sumrize-summary-body {
        color: #334155;
      }
      .sumrize-summary-list {
        margin: 0;
        padding-left: 18px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .sumrize-summary-list li {
        font-size: 11.5px;
        line-height: 1.4;
      }

      /* === FOOTER / ACTIONS === */
      .sumrize-sb-footer {
        padding: 10px 14px;
        background: rgba(0, 0, 0, 0.3);
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      body.sumrize-light .sumrize-sb-footer {
        background: #f1f5f9;
        border-top: 1px solid #cbd5e1;
      }

      .sumrize-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        border-radius: 8px;
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
        border: none;
        transition: all 0.2s ease;
      }
      .sumrize-btn-primary {
        background: #FF4438;
        color: #fff;
        box-shadow: 0 4px 12px rgba(255, 68, 56, 0.3);
      }
      .sumrize-btn-primary:hover {
        background: #ff5e54;
      }
      .sumrize-btn-danger {
        background: #dc2626;
        color: #fff;
      }
      .sumrize-btn-danger:hover {
        background: #ef4444;
      }
      .sumrize-btn-secondary {
        background: rgba(255, 255, 255, 0.08);
        color: #f8fafc;
        border: 1px solid rgba(255, 255, 255, 0.12);
      }
      .sumrize-btn-secondary:hover {
        background: rgba(255, 255, 255, 0.15);
      }
      body.sumrize-light .sumrize-btn-secondary {
        background: #e2e8f0;
        color: #0f172a;
        border: 1px solid #cbd5e1;
      }
      body.sumrize-light .sumrize-btn-secondary:hover {
        background: #cbd5e1;
      }

      .sumrize-pulse {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ef4444;
        display: inline-block;
        box-shadow: 0 0 8px #ef4444;
        animation: sumrizePulseAnim 1.5s infinite;
      }
      @keyframes sumrizePulseAnim {
        0% { transform: scale(0.9); opacity: 0.8; }
        50% { transform: scale(1.3); opacity: 1; }
        100% { transform: scale(0.9); opacity: 0.8; }
      }

      .sumrize-empty-feed {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 36px 16px;
        gap: 8px;
        color: #64748b;
      }
      .sumrize-empty-icon {
        font-size: 28px;
      }
      .sumrize-empty-title {
        font-weight: 600;
        font-size: 12px;
        color: #94a3b8;
      }
      .sumrize-empty-desc {
        font-size: 11px;
        max-width: 240px;
        line-height: 1.4;
      }

      .sumrize-btn-copy-meet {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.16);
        color: #cbd5e1;
        border-radius: 6px;
        padding: 2px 7px;
        font-size: 10px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-weight: 500;
        transition: all 0.2s ease;
      }
      .sumrize-btn-copy-meet:hover {
        background: rgba(255, 255, 255, 0.16);
        color: #fff;
      }
      .sumrize-btn-copy-meet.copied {
        background: rgba(16, 185, 129, 0.25);
        border-color: rgba(16, 185, 129, 0.5);
        color: #34d399;
      }
    `;
    document.head.appendChild(style);
  }

  function applyLayoutOffset(mode) {
    sidebarMode = mode;
    document.body.classList.remove("sumrize-sidebar-docked", "sumrize-sidebar-expanded");

    if (panelContainer) {
      if (mode === "minimized") {
        panelContainer.classList.add("minimized");
        panelContainer.classList.remove("expanded");
        if (minimizedPill) minimizedPill.style.display = "flex";
      } else if (mode === "expanded") {
        panelContainer.classList.remove("minimized");
        panelContainer.classList.add("expanded");
        document.body.classList.add("sumrize-sidebar-docked", "sumrize-sidebar-expanded");
        if (minimizedPill) minimizedPill.style.display = "none";
      } else if (mode === "docked") {
        panelContainer.classList.remove("minimized", "expanded");
        document.body.classList.add("sumrize-sidebar-docked");
        if (minimizedPill) minimizedPill.style.display = "none";
      } else if (mode === "hidden") {
        panelContainer.style.display = "none";
        if (minimizedPill) minimizedPill.style.display = "none";
      }
    }

    // Trigger window resize event agar Google Meet menyesuaikan area videonya tanpa tertutup!
    try {
      window.dispatchEvent(new Event("resize"));
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 260);
    } catch { }
  }

  /* =========================================================
     SIDEBAR PANEL CONSTRUCTION & RENDERING
     ========================================================= */

  function createMeetSidebar() {
    if (panelContainer) return;
    ensureStyles();

    meetCode = extractCleanMeetCode();

    // 1. Minimized Pill (Tepi layar kanan bawah, tidak menutupi meeting)
    minimizedPill = document.createElement("div");
    minimizedPill.id = "sumrize-minimized-pill";
    minimizedPill.innerHTML = `
      <img class="sumrize-logo-img" src="${getLogoAssetUrl()}" alt="Sumrize" style="height:15px; width:auto;" />
      <span id="sumrize-pill-status">Sumrize</span>
      <span id="sumrize-pill-count" style="color:#ff827a; font-size:11px; background:rgba(255,68,56,0.18); padding:1px 6px; border-radius:10px;">0 kal</span>
      <span style="font-size:11px; color:#94a3b8;">❮</span>
    `;
    minimizedPill.onclick = () => {
      applyLayoutOffset("docked");
    };
    document.body.appendChild(minimizedPill);

    // 2. Full Sidebar Panel (Sisi kanan Google Meet)
    panelContainer = document.createElement("div");
    panelContainer.id = "sumrize-meet-panel";

    renderSidebar();
    document.body.appendChild(panelContainer);

    // Aktifkan docked layout otomatis
    applyLayoutOffset("docked");
    startCcWatcher();
  }

  function renderSidebar() {
    if (!panelContainer) return;

    const isLive = state === "capturing";
    const timerText = startedAt ? formatDuration(startedAt) : "00:00";
    const isExpanded = sidebarMode === "expanded";

    panelContainer.innerHTML = `
      <!-- Top Header -->
      <div class="sumrize-sb-header">
        <div class="sumrize-sb-brand">
          ${isLive ? '<span class="sumrize-pulse"></span>' : '<span style="font-size:14px;">🎯</span>'}
          <img class="sumrize-logo-img" src="${getLogoAssetUrl()}" alt="Sumrize" />
          <span id="sumrize-header-timer" style="font-size:11px; font-weight:normal; color:#94a3b8;">${timerText}</span>
        </div>

        <div class="sumrize-header-actions">
          <!-- Maximize / Restore Toggle -->
          <button class="sumrize-btn-tool" id="sumrize-btn-toggle-expand" title="${isExpanded ? 'Kembalikan Ukuran Normal' : 'Perluas Panel (Maximize)'}">
            ${isExpanded ? '⤡' : '⤢'}
          </button>
          <!-- Minimize to Pill -->
          <button class="sumrize-btn-tool" id="sumrize-btn-minimize" title="Ciutkan ke Samping (Minimize)">
            —
          </button>
          <!-- Close / Hide -->
          <button class="sumrize-btn-tool" id="sumrize-btn-close" title="Tutup Panel">
            ×
          </button>
        </div>
      </div>

      <!-- Navigation Tabs -->
      <div class="sumrize-tabs-nav">
        <button class="sumrize-tab-btn ${activeTab === 'transcripts' ? 'active' : ''}" data-tab="transcripts" id="sumrize-tab-nav-transcripts">
          <span>💬 Transkrip</span>
          <span class="sumrize-tab-badge" id="sumrize-tab-count">${segmentsFinalized}</span>
        </button>

        <button class="sumrize-tab-btn ${activeTab === 'summary' ? 'active' : ''}" data-tab="summary" id="sumrize-tab-nav-summary">
          <span>🤖 Rangkuman AI</span>
          <span class="sumrize-tab-dot" id="sumrize-tab-summary-dot" style="${lastSummaryData ? '' : 'display:none;'}"></span>
        </button>

        <button class="sumrize-tab-btn ${activeTab === 'info' ? 'active' : ''}" data-tab="info" id="sumrize-tab-nav-info">
          <span>⚙️ Info</span>
        </button>
      </div>

      <!-- Body Content Area -->
      <div class="sumrize-sb-body" id="sumrize-sb-body">
        ${renderActiveTabContent()}
      </div>

      <!-- Persistent Bottom Actions Bar -->
      <div class="sumrize-sb-footer" id="sumrize-sb-footer">
        ${renderFooterActions()}
      </div>
    `;

    bindSidebarEvents();
    if (activeTab === "transcripts") {
      updateTranscriptFeedDOM();
    }
  }

  function renderActiveTabContent() {
    if (activeTab === "transcripts") {
      return `
        <!-- Search & Filter Bar -->
        <div class="sumrize-search-bar">
          <span class="sumrize-search-icon">🔍</span>
          <input
            type="text"
            class="sumrize-search-input"
            id="sumrize-transcript-search"
            placeholder="Cari kalimat percakapan..."
            value="${escapeHtml(searchQuery)}"
          />
        </div>

        <!-- Metric Counter Bar -->
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#94a3b8; padding:0 2px;">
          <span>${segmentsFinalized} kalimat • ${wordsCount} kata</span>
          <div style="display:flex; gap:8px;">
            <button id="sumrize-feed-copy-btn" class="sumrize-btn-copy-meet" title="Salin seluruh transkrip">Salin Semua</button>
            <button id="sumrize-feed-download-btn" class="sumrize-btn-copy-meet" title="Unduh transkrip TXT">Unduh TXT</button>
          </div>
        </div>

        <!-- Scrollable Feed List -->
        <div class="sumrize-feed-container" id="sumrize-feed-list">
          <!-- Feed items will be populated by updateTranscriptFeedDOM() -->
        </div>

        <!-- Floating Scroll to Bottom Button -->
        <button class="sumrize-btn-scroll-down" id="sumrize-btn-scroll-bottom">
          <span>⬇ Kalimat Terbaru</span>
          <span id="sumrize-unread-badge" style="background:#fff; color:#FF4438; border-radius:10px; padding:0 5px; font-size:10px;"></span>
        </button>
      `;
    }

    if (activeTab === "summary") {
      return `
        <div class="sumrize-summary-box">
          <!-- Header Rangkuman -->
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div>
              <div style="font-weight:700; font-size:12px; color:#f8fafc;">Rangkuman Rapat AI</div>
              <div style="font-size:10px; color:#94a3b8;">
                ${lastSummaryData?.updated_at ? `Diperbarui: ${formatTime(lastSummaryData.updated_at)}` : "Dapat diperbarui secara langsung"}
              </div>
            </div>

            <button class="sumrize-btn sumrize-btn-primary" id="sumrize-btn-refresh-summary" style="padding:4px 10px; font-size:11px;">
              <span>${isGeneratingSummary ? '⏳ Merangkum...' : '⚡ Perbarui Rangkuman'}</span>
            </button>
          </div>

          <!-- Summary Content -->
          <div id="sumrize-summary-content">
            ${renderSummaryBodyHtml()}
          </div>
        </div>
      `;
    }

    if (activeTab === "info") {
      return `
        <div style="display:flex; flex-direction:column; gap:10px;">
          <!-- Google Meet Code -->
          <div style="display:flex; align-items:center; justify-content:space-between; padding:10px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:8px;">
            <div>
              <div style="font-size:10px; color:#94a3b8;">Ruang Rapat Google Meet</div>
              <div style="font-size:12px; font-weight:700; color:#34d399;">${meetCode || "Active Call"}</div>
            </div>
            <button class="sumrize-btn-copy-meet" id="sumrize-btn-copy-meet" title="Salin link Google Meet">
              <span id="sumrize-copy-meet-text">Salin Link</span>
            </button>
          </div>

          <!-- Connector Auto-Detect Strip -->
          <div id="sumrize-panel-account-strip" style="display:flex; align-items:center; justify-content:space-between; padding:10px; background:rgba(16, 185, 129, 0.08); border:1px solid rgba(16, 185, 129, 0.2); border-radius:8px;">
            <div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">
              <span style="font-size:14px; flex-shrink:0;">🔗</span>
              <div style="min-width:0; flex:1;">
                <div style="font-size:11px; font-weight:600; color:#34d399; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" id="sumrize-panel-connector-title">Konektor Google Meet Terhubung</div>
                <div style="font-size:10px; color:#94a3b8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" id="sumrize-panel-connector-desc">Mendeteksi akun...</div>
              </div>
            </div>
            <span id="sumrize-panel-connector-badge" style="background:rgba(16,185,129,0.2); color:#34d399; font-size:9px; padding:2px 6px; border-radius:10px; font-weight:600; flex-shrink:0;">Otomatis</span>
          </div>

          <!-- Live Captions Notice -->
          <div id="sumrize-cc-banner" style="display:none; font-size:11px; padding:8px 10px; border-radius:8px; background:rgba(245,158,11,0.15); border:1px solid rgba(245,158,11,0.3); color:#fbbf24;">
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <span>⚠️ Live Captions belum aktif.</span>
              <button id="sumrize-btn-enable-cc" style="background:none; border:none; color:#60a5fa; text-decoration:underline; cursor:pointer; font-size:11px;">Nyalakan CC</button>
            </div>
          </div>

          <!-- Mic Muted Notice -->
          <div id="sumrize-mic-banner" style="display:none; font-size:11px; padding:8px 10px; border-radius:8px; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#fca5a5;">
            <span>🔇 Mikrofon Meet dinonaktifkan — Suara Anda dijeda.</span>
          </div>

          <!-- Session Metadata -->
          <div style="font-size:11px; color:#94a3b8; padding:8px; background:rgba(255,255,255,0.02); border-radius:6px; display:flex; flex-direction:column; gap:4px;">
            <div style="display:flex; justify-content:space-between;">
              <span>ID Sesi:</span>
              <span style="color:#e2e8f0; font-family:monospace;">${meetingSessionId ? meetingSessionId.substring(0, 16) + '...' : '-'}</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span>Status:</span>
              <span style="color:#34d399; font-weight:600;">${state.toUpperCase()}</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span>Mulai:</span>
              <span style="color:#e2e8f0;">${startedAt ? formatTime(startedAt) : '-'}</span>
            </div>
          </div>
        </div>
      `;
    }

    return "";
  }

  function renderFooterActions() {
    if (state === "capturing") {
      return `
        <button class="sumrize-btn sumrize-btn-danger" id="sumrize-btn-stop" style="width:100%;">
          <span>⏹</span>
          <span>Selesai & Buat Notula (Stop)</span>
        </button>
      `;
    }

    if (state === "stopping") {
      return `
        <div style="display:flex; align-items:center; justify-content:center; gap:8px; font-size:12px; color:#94a3b8; padding:4px;">
          <span>⏳</span>
          <span>Memproses notula rapat dengan AI...</span>
        </div>
      `;
    }

    if (state === "stopped") {
      return `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
          <button class="sumrize-btn sumrize-btn-primary" id="sumrize-btn-open-dash">
            <span>🚀 Dashboard</span>
          </button>
          <button class="sumrize-btn sumrize-btn-secondary" id="sumrize-btn-restart">
            <span>🔄 Rapat Baru</span>
          </button>
        </div>
      `;
    }

    // Idle
    return `
      <button class="sumrize-btn sumrize-btn-primary" id="sumrize-btn-start" style="width:100%;">
        <span>▶</span>
        <span>Mulai Transkripsi Rapat</span>
      </button>
    `;
  }

  /* =========================================================
     LIVE TRANSCRIPTS FEED RENDERING
     ========================================================= */

  function updateTranscriptFeedDOM() {
    const feedList = document.getElementById("sumrize-feed-list");
    if (!feedList) return;

    let items = capturedHistory;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      items = items.filter(
        (it) =>
          (it.text && it.text.toLowerCase().includes(q)) ||
          (it.speaker && it.speaker.toLowerCase().includes(q))
      );
    }

    if (items.length === 0) {
      feedList.innerHTML = `
        <div class="sumrize-empty-feed">
          <div class="sumrize-empty-icon">🎙️</div>
          <div class="sumrize-empty-title">
            ${searchQuery ? "Tidak ada kalimat yang cocok" : "Menunggu percakapan rapat..."}
          </div>
          <div class="sumrize-empty-desc">
            ${searchQuery ? "Coba kata kunci lain." : "Setiap kalimat yang diucapkan dalam Google Meet akan muncul di panel ini secara real-time."}
          </div>
        </div>
      `;
      return;
    }

    // Kelompokkan turns berturutan dari pembicara yang sama
    const turns = [];
    let currentTurn = null;

    for (const seg of items) {
      if (!currentTurn || currentTurn.speaker !== seg.speaker) {
        currentTurn = {
          speaker: seg.speaker,
          timestamp: seg.timestamp,
          sentences: [seg.text]
        };
        turns.push(currentTurn);
      } else {
        currentTurn.sentences.push(seg.text);
      }
    }

    let html = "";
    for (const turn of turns) {
      const spkColor = getSpeakerColor(turn.speaker);
      const isMe =
        turn.speaker === "Anda (Saya)" ||
        turn.speaker === "Anda" ||
        turn.speaker === "You" ||
        turn.speaker === "Saya";

      html += `
        <div class="sumrize-turn-card">
          <div class="sumrize-turn-header">
            <div class="sumrize-turn-speaker-wrap">
              <div class="sumrize-avatar-badge" style="background:${spkColor.bg}; border:1px solid ${spkColor.border}; color:${spkColor.text};">
                ${escapeHtml(spkColor.initials)}
              </div>
              <span class="sumrize-turn-speaker-name" style="color:${spkColor.text};">
                ${escapeHtml(turn.speaker)} ${isMe ? '<span style="font-size:9px; background:rgba(255,68,56,0.25); color:#ff827a; padding:1px 5px; border-radius:6px; margin-left:4px;">Anda</span>' : ''}
              </span>
            </div>
            <span class="sumrize-turn-time">${formatTime(turn.timestamp)}</span>
          </div>
          <div class="sumrize-turn-text">
            ${turn.sentences.map((s) => escapeHtml(s)).join(" ")}
          </div>
        </div>
      `;
    }

    feedList.innerHTML = html;

    // Auto-scroll logic
    if (!isUserScrolledUp) {
      feedList.scrollTop = feedList.scrollHeight;
    }
  }

  /* =========================================================
     AI SUMMARY GENERATOR & VIEW
     ========================================================= */

  async function generateMeetingSummary(forceRefresh = false) {
    if (capturedHistory.length === 0) {
      lastSummaryData = null;
      renderSidebar();
      return;
    }

    isGeneratingSummary = true;
    renderSidebar();

    try {
      // 1. Coba panggil backend API Sumrize jika session aktif
      let backendSummary = null;
      if (meetingSessionId) {
        try {
          const detailRes = await fetch(
            `http://localhost:8000/api/meeting/detail.php?id=${encodeURIComponent(meetingSessionId)}`
          );
          const detailData = await detailRes.json().catch(() => null);
          if (detailData?.ok && detailData?.data?.meeting?.summary) {
            backendSummary = {
              summary: detailData.data.meeting.summary,
              action_items: (detailData.data.action_items || []).map((a) => a.task || a.description || a),
              decisions: (detailData.data.decisions || []).map((d) => d.decision || d),
              follow_ups: (detailData.data.follow_ups || []).map((f) => f.description || f),
              updated_at: new Date()
            };
          }
        } catch { }
      }

      if (backendSummary) {
        lastSummaryData = backendSummary;
      } else {
        // 2. Intelligent Real-time Synthesizer dari capturedHistory
        lastSummaryData = buildIntelligentLocalSummary();
      }
    } catch (err) {
      console.warn("[Sumrize] Gagal merangkum:", err);
      lastSummaryData = buildIntelligentLocalSummary();
    } finally {
      isGeneratingSummary = false;
      renderSidebar();
    }
  }

  function buildIntelligentLocalSummary() {
    const total = capturedHistory.length;
    if (total === 0) return null;

    // Kumpulkan pembicara aktif
    const speakerMap = {};
    for (const it of capturedHistory) {
      speakerMap[it.speaker] = (speakerMap[it.speaker] || 0) + 1;
    }
    const speakers = Object.keys(speakerMap);

    // Filter kalimat yang mengindikasikan action items / tugas
    const actionKeywords = [
      "akan", "tolong", "bisa", "nanti", "perlu", "harus", "siapkan", "buat", "kirim",
      "jadwalkan", "cek", "selesaikan", "task", "deadline", "besok", "lusa", "minggu depan"
    ];
    const decisionKeywords = [
      "setuju", "sepakat", "putuskan", "deal", "keputusan", "fix", "oke", "disepakati",
      "diputuskan", "kesepakatan", "pilihan"
    ];

    const actionItems = [];
    const decisions = [];
    const keyPoints = [];

    for (const it of capturedHistory) {
      const lower = it.text.toLowerCase();

      // Cek action items
      if (actionKeywords.some((k) => lower.includes(k)) && it.text.length > 15) {
        if (!actionItems.includes(it.text) && actionItems.length < 5) {
          actionItems.push(`[${it.speaker}]: ${it.text}`);
        }
      }

      // Cek keputusan
      if (decisionKeywords.some((k) => lower.includes(k)) && it.text.length > 12) {
        if (!decisions.includes(it.text) && decisions.length < 4) {
          decisions.push(`[${it.speaker}]: ${it.text}`);
        }
      }

      // Kumpulkan highlight topik penting
      if (it.text.length > 25 && keyPoints.length < 6) {
        if (!keyPoints.includes(it.text)) {
          keyPoints.push(it.text);
        }
      }
    }

    // Bentuk ringkasan eksekutif
    const topicExcerpt = keyPoints.slice(0, 3).join(" ");
    let execSummary = `Pertemuan Google Meet (${meetCode || "Sesi"}) melibatkan ${speakers.length} pembicara (${speakers.join(", ")}). `;
    if (topicExcerpt) {
      execSummary += `Topik diskusi mencakup: "${topicExcerpt.substring(0, 180)}..."`;
    } else {
      execSummary += `Diskusi berfokus pada pembahasan poin-poin agenda yang telah ditranskrip secara otomatis.`;
    }

    return {
      summary: execSummary,
      key_points: keyPoints.slice(0, 4),
      action_items: actionItems.length > 0 ? actionItems : ["Memastikan follow-up catatan rapat bersama tim."],
      decisions: decisions.length > 0 ? decisions : ["Menyetujui ringkasan dan alur yang telah dibahas."],
      speakers,
      updated_at: new Date()
    };
  }

  function renderSummaryBodyHtml() {
    if (!lastSummaryData) {
      return `
        <div class="sumrize-empty-feed" style="padding:24px 12px;">
          <div class="sumrize-empty-icon">📝</div>
          <div class="sumrize-empty-title">Rangkuman belum dibuat</div>
          <div class="sumrize-empty-desc">
            Klik tombol <strong>"⚡ Perbarui Rangkuman"</strong> di atas kapan saja untuk menyusun intisari rapat saat ini.
          </div>
        </div>
      `;
    }

    const { summary, key_points, action_items, decisions } = lastSummaryData;

    return `
      <!-- Ringkasan Eksekutif -->
      <div class="sumrize-summary-card">
        <div class="sumrize-summary-title">
          <span>📌</span> <span>Ringkasan Eksekutif</span>
        </div>
        <div class="sumrize-summary-body">
          ${escapeHtml(summary || "Belum ada ringkasan teks.")}
        </div>
      </div>

      <!-- Poin Penting -->
      ${key_points && key_points.length > 0 ? `
        <div class="sumrize-summary-card">
          <div class="sumrize-summary-title">
            <span>🎯</span> <span>Poin Pembahasan Utama</span>
          </div>
          <ul class="sumrize-summary-list">
            ${key_points.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
          </ul>
        </div>
      ` : ''}

      <!-- Tindak Lanjut / Action Items -->
      <div class="sumrize-summary-card">
        <div class="sumrize-summary-title">
          <span>✅</span> <span>Tindak Lanjut & Action Items</span>
        </div>
        <ul class="sumrize-summary-list">
          ${(action_items || []).map((a) => `<li>${escapeHtml(a)}</li>`).join("")}
        </ul>
      </div>

      <!-- Keputusan -->
      <div class="sumrize-summary-card">
        <div class="sumrize-summary-title">
          <span>💡</span> <span>Keputusan yang Disepakati</span>
        </div>
        <ul class="sumrize-summary-list">
          ${(decisions || []).map((d) => `<li>${escapeHtml(d)}</li>`).join("")}
        </ul>
      </div>

      <!-- Action Buttons -->
      <div style="display:flex; gap:6px; margin-top:4px;">
        <button class="sumrize-btn sumrize-btn-secondary" id="sumrize-btn-copy-summary" style="flex:1;">
          <span>📋 Salin Rangkuman</span>
        </button>
        <button class="sumrize-btn sumrize-btn-primary" id="sumrize-btn-dash-summary" style="flex:1;">
          <span>🚀 Buka Notula ↗</span>
        </button>
      </div>
    `;
  }

  /* =========================================================
     BIND EVENTS
     ========================================================= */

  function bindSidebarEvents() {
    if (!panelContainer) return;

    // 1. Maximize / Restore Toggle
    const btnExpand = panelContainer.querySelector("#sumrize-btn-toggle-expand");
    if (btnExpand) {
      btnExpand.onclick = () => {
        if (sidebarMode === "expanded") {
          applyLayoutOffset("docked");
        } else {
          applyLayoutOffset("expanded");
        }
        renderSidebar();
      };
    }

    // 2. Minimize to Pill
    const btnMin = panelContainer.querySelector("#sumrize-btn-minimize");
    if (btnMin) {
      btnMin.onclick = () => {
        applyLayoutOffset("minimized");
      };
    }

    // 3. Close / Hide
    const btnClose = panelContainer.querySelector("#sumrize-btn-close");
    if (btnClose) {
      btnClose.onclick = () => {
        applyLayoutOffset("hidden");
      };
    }

    // 4. Tabs Navigation
    const tabTranscripts = panelContainer.querySelector("#sumrize-tab-nav-transcripts");
    if (tabTranscripts) {
      tabTranscripts.onclick = () => {
        activeTab = "transcripts";
        renderSidebar();
      };
    }

    const tabSummary = panelContainer.querySelector("#sumrize-tab-nav-summary");
    if (tabSummary) {
      tabSummary.onclick = () => {
        activeTab = "summary";
        if (!lastSummaryData && capturedHistory.length > 0) {
          generateMeetingSummary();
        } else {
          renderSidebar();
        }
      };
    }

    const tabInfo = panelContainer.querySelector("#sumrize-tab-nav-info");
    if (tabInfo) {
      tabInfo.onclick = () => {
        activeTab = "info";
        renderSidebar();
        updateAccountInPanel();
        updateCcBanner();
        updateMicBanner();
      };
    }

    // 5. Search in Transcripts
    const searchInput = panelContainer.querySelector("#sumrize-transcript-search");
    if (searchInput) {
      searchInput.oninput = (e) => {
        searchQuery = e.target.value;
        updateTranscriptFeedDOM();
      };
    }

    // 6. Feed Scroll Listener & Auto-Scroll Button
    const feedList = panelContainer.querySelector("#sumrize-feed-list");
    const btnScrollDown = panelContainer.querySelector("#sumrize-btn-scroll-bottom");
    if (feedList) {
      feedList.onscroll = () => {
        const atBottom = feedList.scrollHeight - feedList.scrollTop - feedList.clientHeight < 40;
        isUserScrolledUp = !atBottom;
        if (atBottom) {
          unreadWhileScrolled = 0;
          if (btnScrollDown) btnScrollDown.style.display = "none";
        }
      };
    }

    if (btnScrollDown) {
      btnScrollDown.onclick = () => {
        if (feedList) {
          feedList.scrollTop = feedList.scrollHeight;
          isUserScrolledUp = false;
          unreadWhileScrolled = 0;
          btnScrollDown.style.display = "none";
        }
      };
    }

    // 7. Copy All & Download TXT
    const btnFeedCopy = panelContainer.querySelector("#sumrize-feed-copy-btn");
    if (btnFeedCopy) {
      btnFeedCopy.onclick = async () => {
        const txt = capturedHistory.map((s) => `[${s.speaker}]: ${s.text}`).join("\n");
        await navigator.clipboard.writeText(txt || "Tidak ada transkrip.");
        btnFeedCopy.textContent = "Tersalin! ✓";
        btnFeedCopy.classList.add("copied");
        setTimeout(() => {
          btnFeedCopy.textContent = "Salin Semua";
          btnFeedCopy.classList.remove("copied");
        }, 1800);
      };
    }

    const btnFeedDownload = panelContainer.querySelector("#sumrize-feed-download-btn");
    if (btnFeedDownload) {
      btnFeedDownload.onclick = () => {
        let content = `SUMRIZE MEETING TRANSCRIPT\nMeet Code: ${meetCode || "-"}\nTanggal: ${new Date().toLocaleString()}\n\n`;
        content += capturedHistory.map((s) => `[${s.speaker}]: ${s.text}`).join("\n\n");
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Transkrip-${meetCode || "Meeting"}-${Date.now()}.txt`;
        a.click();
        URL.revokeObjectURL(url);
      };
    }

    // 8. Refresh Summary Button
    const btnRefreshSum = panelContainer.querySelector("#sumrize-btn-refresh-summary");
    if (btnRefreshSum) {
      btnRefreshSum.onclick = () => {
        generateMeetingSummary(true);
      };
    }

    // 9. Copy Summary Button
    const btnCopySum = panelContainer.querySelector("#sumrize-btn-copy-summary");
    if (btnCopySum && lastSummaryData) {
      btnCopySum.onclick = async () => {
        let sumText = `RANGKUMAN RAPAT SUMRIZE\nGoogle Meet: ${meetCode || "-"}\n\n`;
        sumText += `RINGKASAN EKSEKUTIF:\n${lastSummaryData.summary}\n\n`;
        if (lastSummaryData.action_items?.length) {
          sumText += `TINDAK LANJUT / ACTION ITEMS:\n${lastSummaryData.action_items.map((a) => "- " + a).join("\n")}\n\n`;
        }
        if (lastSummaryData.decisions?.length) {
          sumText += `KEPUTUSAN:\n${lastSummaryData.decisions.map((d) => "- " + d).join("\n")}\n`;
        }
        await navigator.clipboard.writeText(sumText);
        btnCopySum.innerHTML = "<span>✓ Tersalin!</span>";
        setTimeout(() => {
          btnCopySum.innerHTML = "<span>📋 Salin Rangkuman</span>";
        }, 1800);
      };
    }

    // 10. Open Dashboard Notula Button
    const btnDashSum = panelContainer.querySelector("#sumrize-btn-dash-summary");
    if (btnDashSum) {
      btnDashSum.onclick = () => {
        const url = `http://localhost/sumrize-beta/dashboard/meeting-detail.html?id=${encodeURIComponent(meetingSessionId || "")}`;
        window.open(url, "_blank");
      };
    }

    // 11. Copy Meet Link
    const btnCopyMeet = panelContainer.querySelector("#sumrize-btn-copy-meet");
    if (btnCopyMeet) {
      btnCopyMeet.onclick = async (e) => {
        e.stopPropagation();
        const code = meetCode || extractCleanMeetCode();
        const link = code ? `https://meet.google.com/${code}` : window.location.href.split("?")[0];
        try {
          await navigator.clipboard.writeText(link);
          btnCopyMeet.classList.add("copied");
          const copyTxt = panelContainer.querySelector("#sumrize-copy-meet-text");
          if (copyTxt) copyTxt.textContent = "Tersalin! ✓";
          setTimeout(() => {
            btnCopyMeet.classList.remove("copied");
            if (copyTxt) copyTxt.textContent = "Salin Link";
          }, 2000);
        } catch (err) {
          console.warn("[Sumrize] Gagal menyalin link:", err);
        }
      };
    }

    // 12. Start Capture
    const btnStart = panelContainer.querySelector("#sumrize-btn-start");
    if (btnStart) {
      btnStart.onclick = async () => {
        let consentGiven = false;
        if (global.SumrizeStorage?.getPrivacyConsent) {
          consentGiven = await global.SumrizeStorage.getPrivacyConsent();
        }
        if (!consentGiven) {
          showPrivacyModalInPanel();
          return;
        }
        await startCapture();
      };
    }

    // 13. Stop Capture
    const btnStop = panelContainer.querySelector("#sumrize-btn-stop");
    if (btnStop) {
      btnStop.onclick = async () => {
        await stopCapture();
      };
    }

    // 14. Restart / Dashboard Buttons
    const btnOpenDash = panelContainer.querySelector("#sumrize-btn-open-dash");
    if (btnOpenDash) {
      btnOpenDash.onclick = () => {
        const url = `http://localhost/sumrize-beta/dashboard/meeting-detail.html?id=${encodeURIComponent(meetingSessionId || "")}`;
        window.open(url, "_blank");
      };
    }

    const btnRestart = panelContainer.querySelector("#sumrize-btn-restart");
    if (btnRestart) {
      btnRestart.onclick = () => {
        state = "idle";
        segmentsFinalized = 0;
        wordsCount = 0;
        capturedHistory = [];
        lastSummaryData = null;
        activeTab = "transcripts";
        renderSidebar();
      };
    }

    // 15. Enable CC
    const btnEnableCc = panelContainer.querySelector("#sumrize-btn-enable-cc");
    if (btnEnableCc) {
      btnEnableCc.onclick = () => {
        if (captionObserver) {
          captionObserver.ensureCaptionsEnabled();
        }
        updateCcBanner();
      };
    }
  }

  function showPrivacyModalInPanel() {
    if (!panelContainer) return;
    const bodyEl = panelContainer.querySelector("#sumrize-sb-body");
    if (!bodyEl) return;

    bodyEl.innerHTML = `
      <div style="font-size:12px; line-height:1.5; display:flex; flex-direction:column; gap:10px; padding:8px 2px;">
        <div style="font-weight:700; color:#fff; display:flex; align-items:center; gap:6px; font-size:13px;">
          <span>🔒</span> <span>Izin & Privasi Transkripsi</span>
        </div>
        <p style="color:#94a3b8; font-size:11.5px;">
          Sumrize membaca teks percakapan rapat di tab ini untuk menyusun transkrip dan notula AI Anda. Tidak ada rekaman audio permanen tanpa persetujuan Anda.
        </p>
        <label style="display:flex; align-items:center; gap:6px; cursor:pointer; font-size:11px; color:#cbd5e1;">
          <input type="checkbox" id="sumrize-chk-remember" checked>
          <span>Ingat pilihan saya untuk rapat berikutnya</span>
        </label>
        <div style="display:flex; gap:6px; margin-top:8px;">
          <button class="sumrize-btn sumrize-btn-secondary" id="sumrize-privacy-cancel" style="flex:1;">Batal</button>
          <button class="sumrize-btn sumrize-btn-primary" id="sumrize-privacy-agree" style="flex:1;">Setuju & Mulai</button>
        </div>
      </div>
    `;

    const btnCancel = bodyEl.querySelector("#sumrize-privacy-cancel");
    const btnAgree = bodyEl.querySelector("#sumrize-privacy-agree");
    const chkRemember = bodyEl.querySelector("#sumrize-chk-remember");

    if (btnCancel) {
      btnCancel.onclick = () => renderSidebar();
    }
    if (btnAgree) {
      btnAgree.onclick = async () => {
        if (chkRemember?.checked && global.SumrizeStorage?.setPrivacyConsent) {
          await global.SumrizeStorage.setPrivacyConsent(true);
        }
        await startCapture();
      };
    }
  }

  async function updateAccountInPanel() {
    if (!panelContainer) return;
    const titleEl = panelContainer.querySelector("#sumrize-panel-connector-title");
    const descEl = panelContainer.querySelector("#sumrize-panel-connector-desc");
    const badgeEl = panelContainer.querySelector("#sumrize-panel-connector-badge");
    const stripBox = panelContainer.querySelector("#sumrize-panel-account-strip");

    let connData = null;
    if (cachedConnectorInfo?.status === "connected") {
      connData = { connected: true, connector: cachedConnectorInfo, user: cachedUserInfo };
    } else {
      connData = await fetchConnectorAccount();
    }

    if (connData?.connected && connData?.connector) {
      const email = connData.connector.external_email || connData.user?.email || "Akun Terhubung";
      const userName = connData.user?.name ? ` (${connData.user.name})` : "";

      if (stripBox) {
        stripBox.style.background = "rgba(16, 185, 129, 0.08)";
        stripBox.style.borderColor = "rgba(16, 185, 129, 0.22)";
      }
      if (titleEl) {
        titleEl.textContent = "Konektor Google Meet Terhubung";
        titleEl.style.color = "#34d399";
      }
      if (descEl) {
        descEl.textContent = `${email}${userName}`;
        descEl.title = `${email}${userName}`;
      }
      if (badgeEl) {
        badgeEl.textContent = "Otomatis 🟢";
        badgeEl.style.background = "rgba(16, 185, 129, 0.2)";
        badgeEl.style.color = "#34d399";
      }
    } else {
      let detectedEmail = null;
      if (global.SumrizeMeetDetector?.getCurrentUserAccount) {
        detectedEmail = global.SumrizeMeetDetector.getCurrentUserAccount()?.email;
      }
      if (!detectedEmail && global.SumrizeStorage?.getDetectedMeetEmail) {
        detectedEmail = await global.SumrizeStorage.getDetectedMeetEmail();
      }

      if (stripBox) {
        stripBox.style.background = "rgba(245, 158, 11, 0.08)";
        stripBox.style.borderColor = "rgba(245, 158, 11, 0.22)";
      }
      if (titleEl) {
        titleEl.textContent = "Konektor Belum Terhubung";
        titleEl.style.color = "#fbbf24";
      }
      if (descEl) {
        descEl.textContent = detectedEmail ? `Akun Meet: ${detectedEmail}` : "Mendeteksi sesi rapat...";
        descEl.title = descEl.textContent;
      }
      if (badgeEl) {
        badgeEl.textContent = "Lokal";
        badgeEl.style.background = "rgba(245, 158, 11, 0.2)";
        badgeEl.style.color = "#fbbf24";
      }
    }
  }

  function updateCcBanner() {
    if (!panelContainer) return;
    const banner = panelContainer.querySelector("#sumrize-cc-banner");
    if (!banner) return;

    const isCcOn = captionObserver ? captionObserver.isCaptionsEnabled() : false;
    banner.style.display = isCcOn ? "none" : "block";
  }

  function updateMicBanner() {
    if (!panelContainer) return;
    const banner = panelContainer.querySelector("#sumrize-mic-banner");
    if (!banner) return;

    const currentlyMuted = global.SumrizeMeetDetector?.isMicMuted
      ? global.SumrizeMeetDetector.isMicMuted()
      : isMicMuted;
    isMicMuted = currentlyMuted;

    banner.style.display = currentlyMuted && state === "capturing" ? "block" : "none";
  }

  function startCcWatcher() {
    if (ccCheckInterval) clearInterval(ccCheckInterval);
    ccCheckInterval = setInterval(() => {
      updateCcBanner();
      updateMicBanner();
    }, 2500);
  }

  /* =========================================================
     TRANSCRIPT DISPATCHER (LIVE FEED, BACKEND, OVERLAY)
     ========================================================= */

  async function sendTranscriptSegment(segment) {
    if (!meetingSessionId) {
      return;
    }

    if (!segment || typeof segment !== "object") return;
    const text = String(segment.text || segment.kalimat || "").trim();
    if (!text) return;

    const currentlyMuted = isMicMuted || (global.SumrizeMeetDetector?.isMicMuted ? global.SumrizeMeetDetector.isMicMuted() : false);
    if (segment.source === "mic_speech_api" && currentlyMuted) {
      return;
    }

    const speaker = String(segment.speaker || segment.username || "Unknown").trim();
    const timestamp = segment.timestamp || new Date().toISOString();
    const sequence = Number.isFinite(segment.sequence) ? segment.sequence : ++segmentsFinalized;

    lastSpeaker = speaker;
    lastText = text;
    wordsCount += text.split(/\s+/).filter(Boolean).length;
    capturedHistory.push({ speaker, text, timestamp, sequence });

    // 1. Console Log
    console.log(
      `%c[Sumrize Live] %c${speaker}: %c"${text}"`,
      "background: #10b981; color: #ffffff; font-weight: bold; padding: 2px 6px; border-radius: 3px; font-size: 11px;",
      "color: #3b82f6; font-weight: bold;",
      "color: #1f2937;"
    );

    // 2. Update Live Feed & Badges di Sidebar
    const tabCountBadge = document.getElementById("sumrize-tab-count");
    if (tabCountBadge) tabCountBadge.textContent = String(segmentsFinalized);

    const pillCount = document.getElementById("sumrize-pill-count");
    if (pillCount) pillCount.textContent = `${segmentsFinalized} kal`;

    if (activeTab === "transcripts") {
      updateTranscriptFeedDOM();

      if (isUserScrolledUp) {
        unreadWhileScrolled++;
        const btnScroll = document.getElementById("sumrize-btn-scroll-bottom");
        const unreadBadge = document.getElementById("sumrize-unread-badge");
        if (btnScroll) btnScroll.style.display = "flex";
        if (unreadBadge) unreadBadge.textContent = `+${unreadWhileScrolled}`;
      }
    }

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

    // 3. Kirim ke Service Worker
    try {
      sendRuntimeMessage({
        type: "TRANSCRIPT_SEGMENT",
        ...payload
      }).catch(() => { });
    } catch { }

    // 4. Simpan ke Backend lokal
    try {
      fetch("http://localhost:8000/api/meeting/save-local.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => { });
    } catch { }
  }

  /* =========================================================
     START & STOP CAPTURE LIFECYCLE
     ========================================================= */

  async function startCapture() {
    if (state === "capturing") {
      return { ok: true, state, meetingSessionId, meetCode };
    }

    meetCode = extractCleanMeetCode();
    if (!meetCode) {
      throw new Error("Kode Google Meet tidak ditemukan.");
    }

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
      console.warn("[Sumrize] Create session warning:", err);
    }

    if (!meetingSessionId) {
      meetingSessionId = `ms_${meetCode.replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now()}`;
    }

    // Inisialisasi Buffer
    if (global.SumrizeTranscriptBuffer) {
      transcriptBuffer = new global.SumrizeTranscriptBuffer({
        onSegment: async (seg) => {
          await sendTranscriptSegment(seg);
        }
      });
    }

    // Inisialisasi Caption Observer
    if (global.SumrizeCaptionObserver) {
      captionObserver = new global.SumrizeCaptionObserver({
        onCaption: (cap) => {
          if (transcriptBuffer) transcriptBuffer.add(cap);
        }
      });
      captionObserver.start();
      captionObserver.ensureCaptionsEnabled();
    }

    isMicMuted = global.SumrizeMeetDetector?.isMicMuted ? global.SumrizeMeetDetector.isMicMuted() : false;

    if (global.SumrizeMeetDetector?.watchMicStatus) {
      if (unwatchMicStatus) {
        try { unwatchMicStatus(); } catch { }
      }
      unwatchMicStatus = global.SumrizeMeetDetector.watchMicStatus((muted) => {
        isMicMuted = muted;
        if (muted && transcriptBuffer) {
          transcriptBuffer.onMicMuted();
        }
        updateMicBanner();
      });
    }

    // Inisialisasi Speech Recognizer
    if (global.SumrizeSpeechRecognizer) {
      speechRecognizer = new global.SumrizeSpeechRecognizer({
        onTranscript: (speech) => {
          const micMutedNow = isMicMuted || (global.SumrizeMeetDetector?.isMicMuted ? global.SumrizeMeetDetector.isMicMuted() : false);
          if (micMutedNow) return;
          if (transcriptBuffer) transcriptBuffer.add(speech);
        },
        onMuteChange: (muted) => {
          isMicMuted = muted;
          if (muted && transcriptBuffer) {
            transcriptBuffer.onMicMuted();
          }
          updateMicBanner();
        }
      });
      speechRecognizer.start();
    }

    state = "capturing";
    startedAt = new Date();
    segmentsFinalized = 0;
    wordsCount = 0;
    capturedHistory = [];
    lastSummaryData = null;

    renderSidebar();

    // Timer
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const timerEl = document.getElementById("sumrize-header-timer");
      if (timerEl && startedAt) {
        timerEl.textContent = formatDuration(startedAt);
      }
    }, 1000);

    if (minimizedPill) {
      const pillStatus = minimizedPill.querySelector("#sumrize-pill-status");
      if (pillStatus) pillStatus.innerHTML = `<span class="sumrize-pulse"></span> Merekam`;
    }

    if (global.SumrizeStorage?.set) {
      await global.SumrizeStorage.set({
        captureState: "capturing",
        meetingSessionId,
        meetCode
      });
    }

    return { ok: true, state, meetingSessionId, meetCode, startedAt };
  }

  async function stopCapture() {
    if (state === "idle") {
      return { ok: true, state: "idle" };
    }

    state = "stopping";
    renderSidebar();

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    if (transcriptBuffer) {
      try { await transcriptBuffer.flush(); } catch { }
    }

    if (captionObserver) {
      try { captionObserver.stop(); } catch { }
      captionObserver = null;
    }

    if (speechRecognizer) {
      try { speechRecognizer.stop(); } catch { }
      speechRecognizer = null;
    }

    if (unwatchMicStatus) {
      try { unwatchMicStatus(); } catch { }
      unwatchMicStatus = null;
    }

    endedAt = new Date();

    const sessionId = meetingSessionId;
    if (sessionId) {
      try {
        await sendRuntimeMessage({
          type: "STOP_MEETING_SESSION",
          meetingSessionId: sessionId
        });
      } catch { }
    }

    state = "stopped";

    // Otomatis beralih ke tab Rangkuman AI agar user langsung membaca intisari rapat!
    activeTab = "summary";
    await generateMeetingSummary(true);

    if (minimizedPill) {
      const pillStatus = minimizedPill.querySelector("#sumrize-pill-status");
      if (pillStatus) pillStatus.textContent = "Selesai";
    }

    if (global.SumrizeStorage?.setLastMeeting) {
      await global.SumrizeStorage.setLastMeeting({
        id: meetingSessionId,
        meetCode,
        startedAt,
        endedAt,
        segmentsCount: segmentsFinalized
      });
    }

    if (global.SumrizeStorage?.set) {
      await global.SumrizeStorage.set({
        captureState: "stopped",
        meetingSessionId: null
      });
    }

    return { ok: true, state: "stopped", count: segmentsFinalized };
  }

  function getState() {
    const detectedAccount = global.SumrizeMeetDetector?.getCurrentUserAccount
      ? global.SumrizeMeetDetector.getCurrentUserAccount()
      : null;

    if (detectedAccount?.email && global.SumrizeStorage?.setDetectedMeetEmail) {
      global.SumrizeStorage.setDetectedMeetEmail(detectedAccount.email).catch(() => { });
    }

    const currentMicMuted = global.SumrizeMeetDetector?.isMicMuted
      ? global.SumrizeMeetDetector.isMicMuted()
      : isMicMuted;

    return {
      state,
      meetingSessionId,
      meetCode,
      startedAt,
      segmentsFinalized,
      lastSpeaker,
      lastText,
      detectedAccount,
      isCcOn: captionObserver ? captionObserver.isCaptionsEnabled() : false,
      isMicMuted: currentMicMuted,
      sidebarMode,
      activeTab
    };
  }

  /* =========================================================
     MESSAGE LISTENER
     ========================================================= */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message?.type) return;

    if (message.type === "POPUP_START_CAPTURE") {
      startCapture()
        .then((r) => sendResponse(r))
        .catch((err) => sendResponse({ ok: false, error: normalizeError(err) }));
      return true;
    }

    if (message.type === "POPUP_STOP_CAPTURE") {
      stopCapture()
        .then((r) => sendResponse(r))
        .catch((err) => sendResponse({ ok: false, error: normalizeError(err) }));
      return true;
    }

    if (message.type === "POPUP_GET_STATE") {
      sendResponse({ ok: true, ...getState() });
      return true;
    }

    if (message.type === "SUMRIZE_TOGGLE_CC") {
      if (captionObserver) {
        captionObserver.ensureCaptionsEnabled();
      }
      updateCcBanner();
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === "SUMRIZE_CONTENT_PING") {
      sendResponse({ ok: true, state, meetingSessionId, meetCode });
      return true;
    }

    if (message.type === "SUMRIZE_OPEN_SIDEBAR") {
      if (panelContainer) {
        panelContainer.style.display = "flex";
        applyLayoutOffset("docked");
      } else {
        createMeetSidebar();
      }
      sendResponse({ ok: true });
      return true;
    }
  });

  global.SumrizeTranscriptCollector = {
    startCapture,
    stopCapture,
    getState,
    createMeetSidebar,
    createFloatingPanel: createMeetSidebar
  };

  /* =========================================================
     INITIALIZATION & RECOVERY
     ========================================================= */

  async function restoreExistingSession() {
    if (!global.SumrizeStorage) return;
    try {
      const stored = await global.SumrizeStorage.get(["captureState", "meetingSessionId", "meetCode"]);
      const currentCode = extractCleanMeetCode();
      if (
        stored?.captureState === "capturing" &&
        stored?.meetingSessionId &&
        stored?.meetCode === currentCode &&
        state !== "capturing"
      ) {
        console.log(`[Sumrize] Memulihkan sesi transkripsi aktif (${stored.meetingSessionId})...`);
        meetingSessionId = stored.meetingSessionId;
        meetCode = stored.meetCode;
        await startCapture();
      }
    } catch (e) {
      console.warn("[Sumrize] Gagal memulihkan sesi transkripsi:", e);
    }
  }

  async function initMeetPanel() {
    await resolveActiveTheme();

    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area === "local") {
          if (changes.theme) {
            await resolveActiveTheme();
            updateLogoImages();
          }
          if (changes.connectorInfo || changes.userInfo) {
            cachedConnectorInfo = changes.connectorInfo?.newValue || cachedConnectorInfo;
            cachedUserInfo = changes.userInfo?.newValue || cachedUserInfo;
            updateAccountInPanel();
          }
        }
      });
    }

    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", async () => {
        await resolveActiveTheme();
        updateLogoImages();
      });
    }

    const checkInterval = setInterval(() => {
      const code = extractCleanMeetCode();
      if (code) {
        clearInterval(checkInterval);
        createMeetSidebar();
        restoreExistingSession();
        console.log(`[Sumrize] Google Meet terdeteksi (${code}). Sisi Panel Sidebar siap.`);
      }
    }, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMeetPanel);
  } else {
    initMeetPanel();
  }
})(window);