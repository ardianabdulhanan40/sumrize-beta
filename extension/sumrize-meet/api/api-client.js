/**
 * api/api-client.js
 *
 * HTTP client untuk komunikasi dengan backend Sumrize.
 * Dipakai di Service Worker (background).
 *
 * Base: http://localhost/sumrize-beta/api/meeting
 *
 * Endpoint:
 * - POST create.php
 * - POST transcript.php
 * - POST stop.php
 * - GET  detail.php?id=...   (opsional)
 * - POST transcribe.php      (audio chunk → STT)
 */

(function (global) {
    "use strict";

    /* =========================================================
       CONFIG
       ========================================================= */

    const DEFAULT_BASE_URL = "http://localhost/sumrize-beta/api/meeting";

    /* =========================================================
       HELPERS
       ========================================================= */

    function normalizeError(error) {
        if (!error) return "Unknown error";
        if (typeof error === "string") return error;
        if (error instanceof Error) return error.message;
        if (typeof error.message === "string") return error.message;
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    async function getToken() {
        if (!global.SumrizeStorage) {
            throw new Error("SumrizeStorage tidak tersedia.");
        }

        const token = await global.SumrizeStorage.getAuthToken();

        if (!token) {
            throw new Error(
                "Auth token tidak ditemukan. Silakan login di dashboard Sumrize."
            );
        }

        return token;
    }

    async function getBaseUrl() {
        if (!global.SumrizeStorage) {
            return DEFAULT_BASE_URL;
        }

        try {
            const saved = await global.SumrizeStorage.getApiBaseUrl();
            if (typeof saved === "string" && saved.trim()) {
                return saved.replace(/\/$/, "");
            }
        } catch (error) {
            console.warn(
                "[Sumrize API] Gagal membaca API base URL dari storage:",
                normalizeError(error)
            );
        }

        return DEFAULT_BASE_URL;
    }

    /* =========================================================
       CORE REQUEST (JSON)
       ========================================================= */

    async function request(path, options = {}) {
        const token = await getToken();
        const baseUrl = await getBaseUrl();

        const cleanPath = String(path || "").replace(/^\//, "");
        const url = `${baseUrl}/${cleanPath}`;

        const method = (options.method || "GET").toUpperCase();
        const headers = {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            ...(options.headers || {})
        };

        const fetchOptions = {
            method,
            headers
        };

        if (method !== "GET" && method !== "HEAD") {
            headers["Content-Type"] = "application/json";
            fetchOptions.body = JSON.stringify(options.body || {});
        }

        console.log("[Sumrize API] Request:", {
            url,
            method,
            body: options.body || null
        });

        let response;

        try {
            response = await fetch(url, fetchOptions);
        } catch (error) {
            throw new Error(
                `Tidak dapat terhubung ke backend: ${normalizeError(error)}`
            );
        }

        const rawText = await response.text();
        let data = null;

        if (rawText) {
            try {
                data = JSON.parse(rawText);
            } catch {
                data = { raw: rawText };
            }
        }

        console.log("[Sumrize API] Response:", {
            url,
            status: response.status,
            data
        });

        if (!response.ok) {
            let message =
                data?.message ||
                data?.error ||
                data?.raw ||
                `HTTP ${response.status}`;

            // Backend sering kirim { ok:false, error: { code, message } }
            if (data?.error && typeof data.error === "object") {
                message =
                    data.error.message ||
                    data.error.code ||
                    message;
            }

            throw new Error(String(message));
        }

        if (data && typeof data === "object" && data.ok === false) {
            const message =
                data.message ||
                (data.error && data.error.message) ||
                data.error ||
                "Request gagal di backend.";
            throw new Error(
                typeof message === "string" ? message : JSON.stringify(message)
            );
        }

        return data;
    }

    /* =========================================================
       CREATE MEETING SESSION  →  create.php
       ========================================================= */

    async function createMeetingSession({ meetCode, title }) {
        if (!meetCode) {
            throw new Error("Meet code wajib diisi.");
        }

        const payload = {
            meetCode: meetCode,
            meet_code: meetCode,
            title: title || `Google Meet - ${meetCode}`
        };

        console.log("[Sumrize API] Create meeting session:", payload);

        const data = await request("create.php", {
            method: "POST",
            body: payload
        });

        const meetingSessionId =
            data?.meetingSessionId ||
            data?.meeting_session_id ||
            data?.id ||
            data?.data?.meetingSessionId ||
            data?.data?.meeting_session_id ||
            data?.data?.id ||
            null;

        if (!meetingSessionId) {
            console.error(
                "[Sumrize API] Meeting session response invalid:",
                data
            );
            throw new Error(
                "Backend tidak mengembalikan meeting session ID."
            );
        }

        return {
            ok: true,
            meetingSessionId,
            meetCode,
            raw: data
        };
    }

    /* =========================================================
       SEND TRANSCRIPT  →  transcript.php (segments[])
       ========================================================= */

    async function sendTranscript({
        meetingSessionId,
        speaker,
        username,
        text,
        kalimat,
        timestamp,
        sequence
    }) {
        if (!meetingSessionId) {
            throw new Error("Meeting session ID wajib diisi.");
        }

        const validText = String(text || kalimat || "").trim();
        if (!validText) {
            throw new Error("Transcript text kosong.");
        }

        const speakerName = String(speaker || username || "Unknown").trim();

        let timestampSeconds = null;
        if (typeof timestamp === "number" && Number.isFinite(timestamp)) {
            timestampSeconds = Math.max(0, Math.floor(timestamp));
        }

        const segment = {
            speaker: speakerName,
            username: speakerName,
            text: validText,
            kalimat: validText,
            sequence: Number.isFinite(sequence) ? sequence : 1
        };

        if (timestampSeconds !== null) {
            segment.timestampSeconds = timestampSeconds;
        }

        const payload = {
            meetingSessionId: meetingSessionId,
            segments: [segment]
        };

        console.log("[Sumrize API] Send transcript:", payload);

        const data = await request("transcript.php", {
            method: "POST",
            body: payload
        });

        return {
            ok: true,
            raw: data
        };
    }

    /* =========================================================
       STOP MEETING SESSION  →  stop.php
       ========================================================= */

    async function stopMeetingSession({ meetingSessionId }) {
        if (!meetingSessionId) {
            throw new Error("Meeting session ID wajib diisi.");
        }

        const payload = {
            meetingSessionId: meetingSessionId,
            meeting_session_id: meetingSessionId
        };

        console.log("[Sumrize API] Stop meeting session:", payload);

        const data = await request("stop.php", {
            method: "POST",
            body: payload
        });

        return {
            ok: true,
            raw: data
        };
    }

    /* =========================================================
       GET MEETING SESSION  →  detail.php (opsional)
       ========================================================= */

    async function getMeetingSession(meetingSessionId) {
        if (!meetingSessionId) {
            throw new Error("Meeting session ID wajib diisi.");
        }

        const data = await request(
            `detail.php?id=${encodeURIComponent(meetingSessionId)}`,
            { method: "GET" }
        );

        return {
            ok: true,
            raw: data
        };
    }

    /* =========================================================
       TRANSCRIBE AUDIO  →  transcribe.php (multipart)
       ========================================================= */

    async function transcribeAudio({
        meetingSessionId,
        audioBlob,
        mimeType,
        sequence,
        timestamp
    }) {
        if (!meetingSessionId) {
            throw new Error("Meeting session ID wajib diisi.");
        }

        if (!audioBlob) {
            throw new Error("Audio blob kosong.");
        }

        const token = await getToken();
        const baseUrl = await getBaseUrl();
        const url = `${baseUrl}/transcribe.php`;

        const form = new FormData();
        form.append(
            "audio",
            audioBlob,
            `chunk-${sequence ?? 0}.webm`
        );
        form.append("meeting_session_id", meetingSessionId);
        form.append("meetingSessionId", meetingSessionId);
        form.append("sequence", String(sequence ?? 0));
        form.append(
            "timestamp",
            timestamp || new Date().toISOString()
        );
        if (mimeType) {
            form.append("mime_type", mimeType);
        }

        console.log("[Sumrize API] Transcribe audio:", {
            url,
            sequence,
            size: audioBlob.size,
            mimeType: mimeType || audioBlob.type || "audio/webm"
        });

        let response;

        try {
            response = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/json"
                },
                body: form
            });
        } catch (error) {
            throw new Error(
                `Tidak dapat terhubung ke backend STT: ${normalizeError(error)}`
            );
        }

        const rawText = await response.text();
        let data = null;

        if (rawText) {
            try {
                data = JSON.parse(rawText);
            } catch {
                data = { raw: rawText };
            }
        }

        console.log("[Sumrize API] Transcribe response:", {
            status: response.status,
            data
        });

        if (!response.ok) {
            let message =
                data?.message ||
                data?.error ||
                data?.raw ||
                `HTTP ${response.status}`;

            if (data?.error && typeof data.error === "object") {
                message = data.error.message || data.error.code || message;
            }

            throw new Error(String(message));
        }

        if (data && typeof data === "object" && data.ok === false) {
            const message =
                data.message ||
                (data.error && data.error.message) ||
                data.error ||
                "Transcribe gagal di backend.";
            throw new Error(
                typeof message === "string" ? message : JSON.stringify(message)
            );
        }

        const text = String(
            data?.text ||
                data?.transcript ||
                data?.data?.text ||
                data?.data?.transcript ||
                ""
        ).trim();

        return {
            ok: true,
            text,
            speaker: data?.speaker || data?.data?.speaker || "Unknown",
            raw: data
        };
    }

    /* =========================================================
       EXPORT
       ========================================================= */

    global.SumrizeApi = {
        request,
        getToken,
        getBaseUrl,
        createMeetingSession,
        sendTranscript,
        stopMeetingSession,
        getMeetingSession,
        transcribeAudio
    };

    console.log("[Sumrize] API client loaded");
    console.log(
        "[Sumrize] Base URL default:",
        DEFAULT_BASE_URL
    );
    console.log(
        "[Sumrize] SumrizeApi methods:",
        Object.keys(global.SumrizeApi)
    );
})(globalThis);