/**
 * popup/popup.js
 *
 * Logika antarmuka modern Sumrize Meeting Assistant.
 * Mengikuti standar PRD SUM-53:
 * - Sequence 1: Onboarding, Auth status, Backend connection check.
 * - Sequence 2: Google Meet detection & Meet code display.
 * - Sequence 3: Privacy Notice Modal & Consent handling.
 * - Sequence 4 & 5: Real-time Live Metrics, Timer, Audio Wave, Live Captions Preview, CC Alert.
 * - Sequence 6: Stop Capture & Post-Meeting Actions (Dashboard ↗, Salin Teks, Download TXT).
 */

(function () {
  "use strict";

  /* =========================================================
     DOM ELEMENTS
     ========================================================= */

  // Header & Status
  const connectionPill = document.getElementById("connection-pill");
  const connectionPillText = document.getElementById("connection-pill-text");
  const brandLink = document.getElementById("brand-link");
  const brandLogoImg = document.getElementById("brand-logo-img");
  const btnToggleTheme = document.getElementById("btn-toggle-theme");

  // Tabs
  const navTabs = document.querySelectorAll(".nav-tab");
  const tabContents = document.querySelectorAll(".tab-content");

  // Meet Status Card
  const badgeMeetDetect = document.getElementById("badge-meet-detect");
  const meetTitleEl = document.getElementById("meet-title");
  const meetCodeEl = document.getElementById("meet-code");
  const noticeNotOnMeet = document.getElementById("notice-not-on-meet");
  const btnOpenMeet = document.getElementById("btn-open-meet");
  const btnCopyMeetCode = document.getElementById("btn-copy-meet-code");
  const copyBtnText = document.getElementById("copy-btn-text");
  const btnToggleSidebarInMeet = document.getElementById("btn-toggle-sidebar-in-meet");

  // Capture Card
  const captureStatusTitle = document.getElementById("capture-status-title");
  const badgeCaptureState = document.getElementById("badge-capture-state");
  const recordingPulseDot = document.getElementById("recording-pulse-dot");
  const audioWaveAnim = document.getElementById("audio-wave-anim");
  const metricTimer = document.getElementById("metric-timer");
  const metricSegments = document.getElementById("metric-segments");
  const noticeCcWarning = document.getElementById("notice-cc-warning");
  const noticeMicMuted = document.getElementById("notice-mic-muted");
  const btnToggleCcPopup = document.getElementById("btn-toggle-cc-popup");
  const snippetSpeaker = document.getElementById("snippet-speaker");
  const snippetText = document.getElementById("snippet-text");
  const btnStartCapture = document.getElementById("btn-start-capture");
  const btnStopCapture = document.getElementById("btn-stop-capture");

  // Post Actions
  const boxPostActions = document.getElementById("box-post-actions");
  const btnOpenDashboardSession = document.getElementById("btn-open-dashboard-session");
  const btnCopyLatestTranscript = document.getElementById("btn-copy-latest-transcript");
  const btnDownloadLatestTxt = document.getElementById("btn-download-latest-txt");

  // Preview Tab
  const btnRefreshPreview = document.getElementById("btn-refresh-preview");
  const previewSessionId = document.getElementById("preview-session-id");
  const previewSegmentsCount = document.getElementById("preview-segments-count");
  const previewFeed = document.getElementById("preview-feed");
  const btnCopyAllPreview = document.getElementById("btn-copy-all-preview");
  const btnOpenDetailPreview = document.getElementById("btn-open-detail-preview");

  // Connector & Integrations
  const boxConnectorStatus = document.getElementById("box-connector-status");
  const connectorStripTitle = document.getElementById("connector-strip-title");
  const connectorStripDesc = document.getElementById("connector-strip-desc");
  const badgeConnectorStrip = document.getElementById("badge-connector-strip");
  const badgeConnectorState = document.getElementById("badge-connector-state");
  const connectorInfoEmail = document.getElementById("connector-info-email");
  const connectorInfoUser = document.getElementById("connector-info-user");
  const connectorInfoStatus = document.getElementById("connector-info-status");
  const noticeConnectorAuto = document.getElementById("notice-connector-auto");
  const btnRecheckConnector = document.getElementById("btn-recheck-connector");
  const btnToggleManualToken = document.getElementById("btn-toggle-manual-token");
  const cardManualSettings = document.getElementById("card-manual-settings");

  // Settings Tab
  const badgeAuthStatus = document.getElementById("badge-auth-status");
  const inputApiUrl = document.getElementById("input-api-url");
  const inputAuthToken = document.getElementById("input-auth-token");
  const btnSaveSettings = document.getElementById("btn-save-settings");
  const settingsStatusNotice = document.getElementById("settings-status-notice");
  const settingsStatusText = document.getElementById("settings-status-text");
  const btnGotoDashboard = document.getElementById("btn-goto-dashboard");
  const btnGotoLibrary = document.getElementById("btn-goto-library");
  const btnResetStorage = document.getElementById("btn-reset-storage");

  // Privacy Modal
  const modalPrivacy = document.getElementById("modal-privacy");
  const checkboxRememberPrivacy = document.getElementById("checkbox-remember-privacy");
  const btnPrivacyCancel = document.getElementById("btn-privacy-cancel");
  const btnPrivacyAgree = document.getElementById("btn-privacy-agree");

  // Toast
  const toastEl = document.getElementById("toast");
  const toastIcon = document.getElementById("toast-icon");
  const toastMessage = document.getElementById("toast-message");

  /* =========================================================
     STATE VARIABLES
     ========================================================= */

  let currentTab = "tab-meeting";
  let captureState = "idle";
  let currentMeetTabId = null;
  let activeMeetingSessionId = null;
  let activeMeetCode = null;
  let timerInterval = null;
  let captureStartTime = null;
  let totalSegments = 0;
  let cachedSegments = [];
  let pollInterval = null;

  /* =========================================================
     THEME MANAGEMENT
     ========================================================= */

  async function applyActiveTheme() {
    let isDark = true;
    if (window.SumrizeStorage?.isDarkMode) {
      isDark = await window.SumrizeStorage.isDarkMode();
    } else if (window.matchMedia) {
      isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    }

    if (isDark) {
      document.body.classList.remove("theme-light");
      if (brandLogoImg) brandLogoImg.src = "../assets/logo-white.png";
      if (btnToggleTheme) {
        btnToggleTheme.textContent = "🌙";
        btnToggleTheme.title = "Tema Gelap aktif (Klik untuk Tema Terang)";
      }
    } else {
      document.body.classList.add("theme-light");
      if (brandLogoImg) brandLogoImg.src = "../assets/logo-black.png";
      if (btnToggleTheme) {
        btnToggleTheme.textContent = "☀️";
        btnToggleTheme.title = "Tema Terang aktif (Klik untuk Tema Gelap)";
      }
    }
  }

  if (btnToggleTheme) {
    btnToggleTheme.onclick = async () => {
      let isDark = true;
      if (window.SumrizeStorage?.isDarkMode) {
        isDark = await window.SumrizeStorage.isDarkMode();
      }
      const targetTheme = isDark ? "light" : "dark";
      if (window.SumrizeStorage?.setTheme) {
        await window.SumrizeStorage.setTheme(targetTheme);
      }
      await applyActiveTheme();
    };
  }

  /* =========================================================
     HELPERS & TOAST
     ========================================================= */

  function showToast(msg, isSuccess = true) {
    if (!toastEl) return;
    toastMessage.textContent = msg;
    toastIcon.textContent = isSuccess ? "✓" : "⚠️";
    toastEl.style.borderColor = isSuccess ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.4)";
    toastEl.classList.add("show");
    setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2400);
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }

  function sendToBackground(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response || { ok: false, error: "empty_response" });
      });
    });
  }

  async function getActiveMeetTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        if (tab && tab.url && tab.url.includes("meet.google.com")) {
          const match = tab.url.match(/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
          resolve({
            id: tab.id,
            url: tab.url,
            meetCode: match ? match[1].toLowerCase() : null
          });
          return;
        }

        // Fallback: cari tab Google Meet manapun jika fokus di jendela popup/ekstensi
        chrome.tabs.query({ url: "*://meet.google.com/*" }, (meetTabs) => {
          if (!meetTabs || meetTabs.length === 0) {
            resolve(null);
            return;
          }
          const activeTab = meetTabs.find((t) => t.active) || meetTabs[0];
          const match = activeTab.url?.match(/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
          resolve({
            id: activeTab.id,
            url: activeTab.url,
            meetCode: match ? match[1].toLowerCase() : null
          });
        });
      });
    });
  }

  /* =========================================================
     TAB NAVIGATION
     ========================================================= */

  function switchTab(tabId) {
    currentTab = tabId;
    navTabs.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    tabContents.forEach((panel) => {
      panel.classList.toggle("active", panel.id === tabId);
    });

    if (tabId === "tab-preview") {
      loadPreviewData();
    } else if (tabId === "tab-settings") {
      loadSettingsData();
    }
  }

  navTabs.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  connectionPill.addEventListener("click", () => switchTab("tab-settings"));

  /* =========================================================
     TIMER CONTROLS
     ========================================================= */

  function startTimer(startTimeDate) {
    stopTimer();
    captureStartTime = startTimeDate ? new Date(startTimeDate).getTime() : Date.now();
    const update = () => {
      const elapsedSec = Math.floor((Date.now() - captureStartTime) / 1000);
      metricTimer.textContent = formatTime(elapsedSec);
    };
    update();
    timerInterval = setInterval(update, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  /* =========================================================
     UI RENDER BY STATE
     ========================================================= */

  function updateUiState(rawState, data = {}) {
    // Normalisasi: rawState bisa string ("capturing") atau objek ({ state: "capturing", ... })
    let state = "idle";
    let mergedData = {};

    if (typeof rawState === "string") {
      state = rawState;
      mergedData = data || {};
    } else if (rawState && typeof rawState === "object") {
      state = rawState.state || rawState.captureState || data?.state || "idle";
      mergedData = { ...rawState, ...(data || {}) };
    } else {
      state = data?.state || "idle";
      mergedData = data || {};
    }

    captureState = state;

    if (state === "capturing") {
      badgeCaptureState.textContent = "Sedang Merekam";
      badgeCaptureState.className = "badge badge--red";
      captureStatusTitle.textContent = "Transkripsi Berlangsung";
      recordingPulseDot.classList.remove("hidden");
      audioWaveAnim.classList.remove("hidden");

      btnStartCapture.classList.add("hidden");
      btnStopCapture.classList.remove("hidden");
      btnStopCapture.disabled = false;
      btnStopCapture.textContent = "⏹ Selesai & Buat Notula (Stop)";
      boxPostActions.classList.add("hidden");

      if (mergedData.startedAt && !timerInterval) {
        startTimer(mergedData.startedAt);
      } else if (!timerInterval && !captureStartTime) {
        startTimer();
      }

      totalSegments = Number(mergedData.segmentsFinalized || mergedData.count || totalSegments);
      metricSegments.textContent = `${totalSegments} kalimat`;

      // Live Captions warning
      if (mergedData.isCcOn === false) {
        noticeCcWarning.classList.remove("hidden");
      } else {
        noticeCcWarning.classList.add("hidden");
      }

      // Mic Muted warning
      if (noticeMicMuted) {
        if (mergedData.isMicMuted === true) {
          noticeMicMuted.classList.remove("hidden");
        } else {
          noticeMicMuted.classList.add("hidden");
        }
      }

      if (mergedData.lastSpeaker && mergedData.lastText) {
        snippetSpeaker.textContent = `🗣️ ${mergedData.lastSpeaker}`;
        snippetText.textContent = `"${mergedData.lastText}"`;
      }
    } else if (state === "stopping") {
      badgeCaptureState.textContent = "Memproses...";
      badgeCaptureState.className = "badge badge--amber";
      captureStatusTitle.textContent = "Menyimpan Transkrip";
      recordingPulseDot.classList.add("hidden");
      audioWaveAnim.classList.add("hidden");

      btnStartCapture.classList.add("hidden");
      btnStopCapture.classList.remove("hidden");
      btnStopCapture.disabled = true;
      btnStopCapture.textContent = "⏳ Memproses Notula...";
    } else if (state === "stopped") {
      stopTimer();
      badgeCaptureState.textContent = "Selesai";
      badgeCaptureState.className = "badge badge--green";
      captureStatusTitle.textContent = "Notula AI Siap";
      recordingPulseDot.classList.add("hidden");
      audioWaveAnim.classList.add("hidden");

      btnStartCapture.classList.remove("hidden");
      btnStartCapture.textContent = "▶ Mulai Transkrip Baru";
      btnStopCapture.classList.add("hidden");
      boxPostActions.classList.remove("hidden");
      noticeCcWarning.classList.add("hidden");

      snippetSpeaker.textContent = "✅ Transkripsi Berhasil";
      snippetText.textContent = `Total ${totalSegments} kalimat tersimpan dan dikirim ke backend Sumrize.`;
    } else {
      // Idle
      stopTimer();
      badgeCaptureState.textContent = "Idle";
      badgeCaptureState.className = "badge badge--neutral";
      captureStatusTitle.textContent = "Status Transkripsi";
      recordingPulseDot.classList.add("hidden");
      audioWaveAnim.classList.add("hidden");

      btnStartCapture.classList.remove("hidden");
      btnStartCapture.textContent = "▶ Mulai Transkripsi";
      btnStopCapture.classList.add("hidden");
      boxPostActions.classList.add("hidden");
      noticeCcWarning.classList.add("hidden");
    }
  }

  /* =========================================================
     CONNECTION & CONNECTOR AUTO-DETECTION
     ========================================================= */

  async function syncConnectorAndAuth(preferredEmail = null) {
    let baseUrl = "http://localhost:8000/api/meeting";
    let existingToken = null;

    if (window.SumrizeStorage) {
      baseUrl = await window.SumrizeStorage.getApiBaseUrl();
      existingToken = await window.SumrizeStorage.getAuthToken();
    }

    // 1. Tentukan target email Google Meet
    let targetEmail = preferredEmail;
    if (!targetEmail && window.SumrizeStorage) {
      targetEmail = await window.SumrizeStorage.getDetectedMeetEmail();
    }

    // 2. Panggil API detect-connector ke backend Sumrize
    try {
      let detectUrl = `${baseUrl}/detect-connector.php`;
      if (targetEmail) {
        detectUrl += `?email=${encodeURIComponent(targetEmail)}`;
      }

      const res = await fetch(detectUrl, {
        headers: { Accept: "application/json" }
      });
      const result = await res.json().catch(() => null);

      if (result?.ok && result?.data?.connected && result?.data?.token) {
        const data = result.data;

        // Simpan token dan info konektor otomatis di storage lokal
        if (window.SumrizeStorage) {
          await window.SumrizeStorage.setAuthToken(data.token);
          if (data.connector) await window.SumrizeStorage.setConnectorInfo(data.connector);
          if (data.user) await window.SumrizeStorage.setUserInfo(data.user);
          await window.SumrizeStorage.set({ authMethod: "connector_auto" });
        }

        // Update Header Pill
        connectionPill.className = "connection-pill connected";
        connectionPillText.textContent = data.user?.name || "Terhubung (Auto)";

        // Update Strip di Card Google Meet
        if (boxConnectorStatus) {
          boxConnectorStatus.classList.remove("hidden");
          if (connectorStripTitle) connectorStripTitle.textContent = "Konektor Google Meet Terhubung";
          if (connectorStripDesc) {
            const acc = data.connector?.external_email || data.user?.email || "Terkoneksi";
            connectorStripDesc.textContent = `${acc}`;
          }
          if (badgeConnectorStrip) {
            badgeConnectorStrip.textContent = "Otomatis";
            badgeConnectorStrip.className = "badge badge--green";
          }
        }

        // Update Card Integrasi di Tab Settings
        if (badgeConnectorState) {
          badgeConnectorState.textContent = "Terhubung Otomatis 🟢";
          badgeConnectorState.className = "badge badge--green";
        }
        if (connectorInfoEmail) {
          connectorInfoEmail.textContent = data.connector?.external_email || data.user?.email || "-";
        }
        if (connectorInfoUser) {
          connectorInfoUser.textContent = `${data.user?.name || "User"} (${data.user?.email || "-"})`;
        }
        if (connectorInfoStatus) {
          connectorInfoStatus.textContent = "Terkoneksi (Aktif)";
          connectorInfoStatus.className = "badge badge--green";
        }
        if (noticeConnectorAuto) {
          noticeConnectorAuto.classList.remove("hidden");
        }
        if (badgeAuthStatus) {
          badgeAuthStatus.textContent = "Token Otomatis 🟢";
          badgeAuthStatus.className = "badge badge--green";
        }
        if (inputAuthToken) {
          inputAuthToken.value = data.token;
        }

        return true;
      }
    } catch (err) {
      console.warn("[Sumrize Popup] Gagal memanggil detect-connector:", err);
    }

    // 3. Fallback: jika konektor tidak terdeteksi, cek token manual yang sudah ada
    if (existingToken) {
      try {
        const resp = await fetch(`${baseUrl}/auth.php`, {
          headers: { Authorization: `Bearer ${existingToken}` }
        });
        const data = await resp.json().catch(() => null);

        if (resp.ok && data?.ok) {
          connectionPill.className = "connection-pill connected";
          connectionPillText.textContent = data.user?.name || "Token Manual";
          if (badgeAuthStatus) {
            badgeAuthStatus.textContent = "Token Manual 🟢";
            badgeAuthStatus.className = "badge badge--green";
          }
          if (badgeConnectorState) {
            badgeConnectorState.textContent = "Token Manual Aktif";
            badgeConnectorState.className = "badge badge--neutral";
          }
          return true;
        }
      } catch { }
    }

    // 4. Jika keduanya gagal
    connectionPill.className = "connection-pill disconnected";
    connectionPillText.textContent = "Belum Terhubung";
    if (badgeAuthStatus) {
      badgeAuthStatus.textContent = "Belum Terhubung";
      badgeAuthStatus.className = "badge badge--amber";
    }
    if (badgeConnectorState) {
      badgeConnectorState.textContent = "Belum Terhubung";
      badgeConnectorState.className = "badge badge--amber";
    }
    if (connectorInfoStatus) {
      connectorInfoStatus.textContent = "Belum Terkoneksi";
      connectorInfoStatus.className = "badge badge--amber";
    }
    if (boxConnectorStatus) {
      if (connectorStripTitle) connectorStripTitle.textContent = "Konektor Belum Terhubung";
      if (connectorStripDesc) connectorStripDesc.textContent = "Hubungkan akun Google Meet di Dashboard";
      if (badgeConnectorStrip) {
        badgeConnectorStrip.textContent = "Belum Ada";
        badgeConnectorStrip.className = "badge badge--amber";
      }
    }

    return false;
  }

  async function checkBackendConnection() {
    return await syncConnectorAndAuth();
  }

  async function checkMeetState() {
    const meetTab = await getActiveMeetTab();
    currentMeetTabId = meetTab?.id || null;

    if (!meetTab) {
      badgeMeetDetect.textContent = "Bukan Google Meet";
      badgeMeetDetect.className = "badge badge--neutral";
      meetTitleEl.textContent = "Tidak di Google Meet";
      meetCodeEl.textContent = "Buka tab meet.google.com";
      if (btnCopyMeetCode) btnCopyMeetCode.classList.add("hidden");
      noticeNotOnMeet.classList.remove("hidden");
      btnOpenMeet.classList.remove("hidden");
      if (btnToggleSidebarInMeet) btnToggleSidebarInMeet.classList.add("hidden");
      btnStartCapture.disabled = true;
      return;
    }

    noticeNotOnMeet.classList.add("hidden");
    btnOpenMeet.classList.add("hidden");
    if (btnToggleSidebarInMeet) btnToggleSidebarInMeet.classList.remove("hidden");
    btnStartCapture.disabled = false;

    activeMeetCode = meetTab.meetCode || "active-room";
    meetTitleEl.textContent = "Google Meet Terhubung";
    meetCodeEl.textContent = `meet.google.com/${activeMeetCode}`;
    badgeMeetDetect.textContent = "Siap Rapat";
    badgeMeetDetect.className = "badge badge--green";
    if (btnCopyMeetCode) btnCopyMeetCode.classList.remove("hidden");

    // Query state dari service worker/content script
    const response = await sendToBackground({
      type: "POPUP_GET_STATE",
      tabId: currentMeetTabId
    });

    if (response?.ok) {
      // Jika tab Meet mendeteksi email akun Google Meet, sinkronkan konektor
      const detectedEmail = response.detectedAccount?.email;
      if (detectedEmail) {
        if (window.SumrizeStorage) {
          await window.SumrizeStorage.setDetectedMeetEmail(detectedEmail);
        }
        await syncConnectorAndAuth(detectedEmail);
      }

      if (response.state) {
        activeMeetingSessionId = response.meetingSessionId || null;
        activeMeetCode = response.meetCode || activeMeetCode;
        updateUiState(response.state, response);
      }
    }
  }

  /* =========================================================
     START & STOP CAPTURE LOGIC
     ========================================================= */

  async function initiateStartCapture() {
    // Cek consent privasi sesuai PRD SUM-53 Sequence 3
    let consentGiven = false;
    if (window.SumrizeStorage) {
      consentGiven = await window.SumrizeStorage.getPrivacyConsent();
    }

    if (!consentGiven) {
      modalPrivacy.classList.add("active");
      return;
    }

    executeStartCapture();
  }

  async function executeStartCapture() {
    btnStartCapture.disabled = true;
    btnStartCapture.textContent = "Memulai...";

    const tabId = currentMeetTabId || (await getActiveMeetTab())?.id;
    const res = await sendToBackground({
      type: "POPUP_START_CAPTURE",
      tabId
    });

    btnStartCapture.disabled = false;

    if (!res?.ok) {
      showToast(`Gagal memulai: ${res?.error || "Error"}`, false);
      updateUiState("idle");
      return;
    }

    activeMeetingSessionId = res.meetingSessionId || null;
    activeMeetCode = res.meetCode || activeMeetCode;
    showToast("Transkripsi dimulai!", true);
    updateUiState("capturing", res);
  }

  async function executeStopCapture() {
    updateUiState("stopping");

    const tabId = currentMeetTabId || (await getActiveMeetTab())?.id;
    const res = await sendToBackground({
      type: "POPUP_STOP_CAPTURE",
      tabId
    });

    if (!res?.ok) {
      showToast(`Gagal menghentikan: ${res?.error || "Error"}`, false);
      updateUiState("capturing");
      return;
    }

    totalSegments = res.count ?? res.segmentsCount ?? totalSegments;

    // Simpan data meeting terakhir ke storage
    if (window.SumrizeStorage) {
      const lastMeetingData = {
        id: activeMeetingSessionId,
        meetCode: activeMeetCode,
        endedAt: new Date().toISOString(),
        segmentsCount: totalSegments
      };
      await window.SumrizeStorage.setLastMeeting(lastMeetingData);
      await window.SumrizeStorage.setCaptureState("stopped");
    }

    showToast("Meeting selesai & tersimpan!", true);
    updateUiState("stopped");
  }

  // Event Listeners
  btnStartCapture.addEventListener("click", initiateStartCapture);
  btnStopCapture.addEventListener("click", executeStopCapture);

  btnPrivacyCancel.addEventListener("click", () => {
    modalPrivacy.classList.remove("active");
  });

  btnPrivacyAgree.addEventListener("click", async () => {
    modalPrivacy.classList.remove("active");
    if (checkboxRememberPrivacy.checked && window.SumrizeStorage) {
      await window.SumrizeStorage.setPrivacyConsent(true);
    }
    executeStartCapture();
  });

  btnOpenMeet.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://meet.google.com/new" });
  });

  if (btnToggleSidebarInMeet) {
    btnToggleSidebarInMeet.addEventListener("click", async () => {
      const meetTab = await getActiveMeetTab();
      if (meetTab?.id) {
        chrome.tabs.sendMessage(meetTab.id, { type: "SUMRIZE_OPEN_SIDEBAR" }, () => {
          showToast("Sidebar Google Meet dibuka!");
        });
      }
    });
  }

  btnToggleCcPopup.addEventListener("click", async () => {
    // Kirim perintah toggle CC ke tab Google Meet
    const meetTab = await getActiveMeetTab();
    if (meetTab?.id) {
      chrome.tabs.sendMessage(meetTab.id, { type: "SUMRIZE_TOGGLE_CC" }, () => {
        showToast("Mencoba mengaktifkan CC Google Meet...", true);
      });
    }
  });

  /* =========================================================
     POST-MEETING ACTIONS
     ========================================================= */

  btnOpenDashboardSession.addEventListener("click", () => {
    const sessionId = activeMeetingSessionId || "";
    const url = `http://localhost:8000/dashboard/meeting-detail.html?id=${encodeURIComponent(sessionId)}`;
    chrome.tabs.create({ url });
  });

  btnCopyLatestTranscript.addEventListener("click", async () => {
    let copyText = `Notula Google Meet (${activeMeetCode || "Sesi"})\nID: ${activeMeetingSessionId || "-"}\nTotal Segmen: ${totalSegments}\n\n`;

    if (cachedSegments && cachedSegments.length > 0) {
      copyText += cachedSegments.map((s) => `[${s.speaker || "Speaker"}]: ${s.text}`).join("\n");
    } else {
      copyText += snippetText.textContent;
    }

    await navigator.clipboard.writeText(copyText);
    showToast("Transkrip berhasil disalin!", true);
  });

  btnDownloadLatestTxt.addEventListener("click", () => {
    let content = `SUMRIZE MEETING ASSISTANT - TRANSKRIP\n`;
    content += `Room Code : ${activeMeetCode || "-"}\n`;
    content += `Session ID: ${activeMeetingSessionId || "-"}\n`;
    content += `Tanggal   : ${new Date().toLocaleString()}\n`;
    content += `==============================================\n\n`;

    if (cachedSegments && cachedSegments.length > 0) {
      content += cachedSegments.map((s) => `[${s.speaker || "Speaker"}]: ${s.text}`).join("\n\n");
    } else {
      content += `[${snippetSpeaker.textContent}]: ${snippetText.textContent}\n`;
    }

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Transkrip-Meet-${activeMeetCode || "Session"}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("File TXT berhasil diunduh!", true);
  });

  /* =========================================================
     TAB 2: PREVIEW LOGIC
     ========================================================= */

  async function loadPreviewData() {
    let lastMeeting = null;
    if (window.SumrizeStorage) {
      lastMeeting = await window.SumrizeStorage.getLastMeeting();
    }

    if (!lastMeeting && !activeMeetingSessionId) {
      previewFeed.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">📝</div>
          <div>Belum ada transkrip tersimpan.</div>
        </div>`;
      return;
    }

    const sessionId = lastMeeting?.id || activeMeetingSessionId;
    previewSessionId.textContent = `Sesi: ${sessionId.slice(0, 14)}...`;
    previewSegmentsCount.textContent = `${lastMeeting?.segmentsCount || totalSegments} kalimat`;

    // Coba ambil transkrip dari backend atau gunakan buffer lokal
    let baseUrl = "http://localhost:8000/api/meeting";
    let token = null;
    if (window.SumrizeStorage) {
      baseUrl = await window.SumrizeStorage.getApiBaseUrl();
      token = await window.SumrizeStorage.getAuthToken();
    }

    try {
      const resp = await fetch(`${baseUrl}/detail.php?id=${encodeURIComponent(sessionId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      const data = await resp.json().catch(() => null);

      if (data?.ok && Array.isArray(data.transcript) && data.transcript.length > 0) {
        cachedSegments = data.transcript;
        renderTranscriptFeed(data.transcript);
        return;
      }
    } catch { }

    // Fallback: Tampilkan preview lokal
    previewFeed.innerHTML = `
      <div class="transcript-feed__item">
        <div class="transcript-feed__speaker">
          <span>${snippetSpeaker.textContent}</span>
          <span class="transcript-feed__time">Terakhir</span>
        </div>
        <div class="transcript-feed__text">${snippetText.textContent}</div>
      </div>
    `;
  }

  function renderTranscriptFeed(segments) {
    previewFeed.innerHTML = "";
    segments.forEach((seg) => {
      const item = document.createElement("div");
      item.className = "transcript-feed__item";
      item.innerHTML = `
        <div class="transcript-feed__speaker">
          <span>🗣️ ${seg.speaker || "Speaker"}</span>
          <span class="transcript-feed__time">${seg.created_at ? new Date(seg.created_at).toLocaleTimeString() : ""}</span>
        </div>
        <div class="transcript-feed__text">${seg.text || seg.kalimat || ""}</div>
      `;
      previewFeed.appendChild(item);
    });
  }

  btnRefreshPreview.addEventListener("click", loadPreviewData);

  btnCopyAllPreview.addEventListener("click", async () => {
    if (!cachedSegments || cachedSegments.length === 0) {
      showToast("Tidak ada teks untuk disalin", false);
      return;
    }
    const txt = cachedSegments.map((s) => `[${s.speaker}]: ${s.text}`).join("\n");
    await navigator.clipboard.writeText(txt);
    showToast("Semua transkrip disalin!", true);
  });

  btnOpenDetailPreview.addEventListener("click", () => {
    const sessionId = activeMeetingSessionId || "";
    chrome.tabs.create({
      url: `http://localhost:8000/dashboard/meeting-detail.html?id=${encodeURIComponent(sessionId)}`
    });
  });

  /* =========================================================
     TAB 3: SETTINGS LOGIC
     ========================================================= */

  async function loadSettingsData() {
    if (!window.SumrizeStorage) return;
    const url = await window.SumrizeStorage.getApiBaseUrl();
    const token = await window.SumrizeStorage.getAuthToken();
    const connector = await window.SumrizeStorage.getConnectorInfo();
    const user = await window.SumrizeStorage.getUserInfo();
    const meetEmail = await window.SumrizeStorage.getDetectedMeetEmail();

    inputApiUrl.value = url || "http://localhost:8000/api/meeting";
    inputAuthToken.value = token || "";

    if (connector && connector.status === "connected") {
      if (badgeConnectorState) {
        badgeConnectorState.textContent = "Terhubung Otomatis 🟢";
        badgeConnectorState.className = "badge badge--green";
      }
      if (connectorInfoEmail) {
        connectorInfoEmail.textContent = connector.external_email || meetEmail || user?.email || "-";
      }
      if (connectorInfoUser) {
        connectorInfoUser.textContent = user ? `${user.name} (${user.email})` : "-";
      }
      if (connectorInfoStatus) {
        connectorInfoStatus.textContent = "Terkoneksi (Aktif)";
        connectorInfoStatus.className = "badge badge--green";
      }
      if (noticeConnectorAuto) {
        noticeConnectorAuto.classList.remove("hidden");
      }
    } else {
      if (connectorInfoEmail && meetEmail) {
        connectorInfoEmail.textContent = meetEmail;
      }
    }
  }

  // Tombol Deteksi Ulang Konektor
  if (btnRecheckConnector) {
    btnRecheckConnector.addEventListener("click", async () => {
      btnRecheckConnector.disabled = true;
      btnRecheckConnector.textContent = "Memeriksa database...";
      showToast("Memeriksa ketersediaan konektor...", true);

      let targetEmail = null;
      if (window.SumrizeStorage) {
        targetEmail = await window.SumrizeStorage.getDetectedMeetEmail();
      }

      const connected = await syncConnectorAndAuth(targetEmail);
      btnRecheckConnector.disabled = false;
      btnRecheckConnector.innerHTML = "<span>🔄 Deteksi Ulang Konektor</span>";

      if (connected) {
        showToast("Konektor Google Meet terdeteksi & terhubung!", true);
      } else {
        showToast("Konektor belum terhubung untuk akun ini.", false);
      }
    });
  }

  // Tombol Toggle Opsi Token Manual
  if (btnToggleManualToken && cardManualSettings) {
    btnToggleManualToken.addEventListener("click", () => {
      cardManualSettings.classList.toggle("hidden");
      if (!cardManualSettings.classList.contains("hidden")) {
        cardManualSettings.scrollIntoView({ behavior: "smooth" });
      }
    });
  }

  btnSaveSettings.addEventListener("click", async () => {
    const newUrl = inputApiUrl.value.trim();
    const newToken = inputAuthToken.value.trim();

    if (!window.SumrizeStorage) return;

    if (newUrl) {
      await window.SumrizeStorage.set({ apiBaseUrl: newUrl });
    }
    if (newToken) {
      await window.SumrizeStorage.setAuthToken(newToken);
      await window.SumrizeStorage.set({ authMethod: "manual" });
    } else {
      await window.SumrizeStorage.clearAuthToken();
    }

    settingsStatusNotice.classList.remove("hidden");
    settingsStatusText.textContent = "Menguji koneksi ke server...";

    const ok = await checkBackendConnection();
    if (ok) {
      settingsStatusText.textContent = "Koneksi backend & token valid!";
      showToast("Pengaturan berhasil disimpan!", true);
    } else {
      settingsStatusText.textContent = "Token belum terdaftar atau server tidak merespons.";
      showToast("Periksa token atau server lokal", false);
    }
  });

  btnGotoDashboard.addEventListener("click", () => {
    chrome.tabs.create({ url: "http://localhost:8000/dashboard/" });
  });

  btnGotoLibrary.addEventListener("click", () => {
    chrome.tabs.create({ url: "http://localhost:8000/dashboard/meeting.html" });
  });

  btnResetStorage.addEventListener("click", async () => {
    if (confirm("Reset semua pengaturan lokal dan sesi meeting aktif?")) {
      if (window.SumrizeStorage) {
        await window.SumrizeStorage.reset();
      }
      showToast("Pengaturan direset", true);
      setTimeout(() => location.reload(), 500);
    }
  });

  /* =========================================================
     INITIALIZATION & POLLING
     ========================================================= */

  // Copy Meet Link Button
  if (btnCopyMeetCode) {
    btnCopyMeetCode.onclick = async (e) => {
      e.stopPropagation();
      const code = activeMeetCode && activeMeetCode !== "active-room" ? activeMeetCode : "";
      const meetUrl = code ? `https://meet.google.com/${code}` : "https://meet.google.com";
      try {
        await navigator.clipboard.writeText(meetUrl);
        btnCopyMeetCode.classList.add("copied");
        if (copyBtnText) copyBtnText.textContent = "Tersalin! ✓";
        showToast("Link Google Meet berhasil disalin!");
        setTimeout(() => {
          btnCopyMeetCode.classList.remove("copied");
          if (copyBtnText) copyBtnText.textContent = "Salin Link";
        }, 2200);
      } catch (err) {
        showToast("Gagal menyalin link Meet", false);
      }
    };
  }

  async function init() {
    await applyActiveTheme();
    await checkBackendConnection();
    await checkMeetState();

    // Listener perubahan preferensi sistem & storage
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        applyActiveTheme();
      });
    }

    // Listener perubahan storage untuk update real-time jika state berubah dari in-meet panel
    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local") {
          if (changes.theme) {
            applyActiveTheme();
          }
          if (changes.captureState) {
            const newState = changes.captureState.newValue;
            if (newState && newState !== captureState) {
              updateUiState(newState);
            }
          }
        }
      });
    }

    // Polling halus setiap 1.8 detik saat popup terbuka
    pollInterval = setInterval(async () => {
      const tabId = currentMeetTabId || (await getActiveMeetTab())?.id;
      if (tabId) {
        const response = await sendToBackground({
          type: "POPUP_GET_STATE",
          tabId
        });

        if (response?.ok && response.state) {
          if (response.state !== captureState) {
            updateUiState(response.state, response);
          } else if (captureState === "capturing") {
            // Live update metrik tanpa mereset UI
            totalSegments = Number(response.segmentsFinalized || response.count || totalSegments);
            metricSegments.textContent = `${totalSegments} kalimat`;

            if (response.lastSpeaker && response.lastText) {
              snippetSpeaker.textContent = `🗣️ ${response.lastSpeaker}`;
              snippetText.textContent = `"${response.lastText}"`;
            }

            if (response.isCcOn === false) {
              noticeCcWarning.classList.remove("hidden");
            } else {
              noticeCcWarning.classList.add("hidden");
            }
          }
        }
      }
    }, 1800);
  }

  window.addEventListener("unload", () => {
    if (pollInterval) clearInterval(pollInterval);
    stopTimer();
  });

  init();
})();