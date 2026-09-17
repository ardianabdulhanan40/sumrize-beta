/**
 * api/api-client.js
 *
 * HTTP client untuk komunikasi dengan backend Sumrize.
 * Dipakai di Service Worker (background).
 *
 * Endpoint:
 * - POST /start.php
 * - POST /transcript.php
 * - POST /stop.php
 * - GET  /session.php?id=...
 * - POST /transcribe.php   (audio chunk → STT)
 */

(function (global) {
    "use strict";

    /* =========================================================
       CONFIG
       ========================================================= */

    const DEFAULT_BASE_URL = "http://localhost/sumrize-api/api/meeting";

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
            const message =
                data?.message ||
                data?.error ||
                data?.raw ||
                `HTTP ${response.status}`;
            throw new Error(String(message));
        }

        if (data && typeof data === "object" && data.ok === false) {
            throw new Error(
                data.message || data.error || "Request gagal di backend."
            );
        }

        return data;
    }

    /* =========================================================
       CREATE MEETING SESSION
       ========================================================= */

    async function createMeetingSession({ meetCode, title }) {
        if (!meetCode) {
            throw new Error("Meet code wajib diisi.");
        }

        const payload = {
            meet_code: meetCode,
            title: title || `Google Meet - ${meetCode}`
        };

        console.log("[Sumrize API] Create meeting session:", payload);

        const data = await request("start.php", {
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
       SEND TRANSCRIPT
       ========================================================= */

    async function sendTranscript({
        meetingSessionId,
        speaker,
        text,
        timestamp,
        sequence
    }) {
        if (!meetingSessionId) {
            throw new Error("Meeting session ID wajib diisi.");
        }

        if (!text || !String(text).trim()) {
            throw new Error("Transcript text kosong.");
        }

        const payload = {
            meeting_session_id: meetingSessionId,
            speaker: speaker || "Unknown",
            text: String(text).trim(),
            timestamp: timestamp || new Date().toISOString(),
            sequence: Number.isFinite(sequence) ? sequence : null
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
       STOP MEETING SESSION
       ========================================================= */

    async function stopMeetingSession({ meetingSessionId }) {
        if (!meetingSessionId) {
            throw new Error("Meeting session ID wajib diisi.");
        }

        const payload = {
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
       GET MEETING SESSION
       ========================================================= */

    async function getMeetingSession(meetingSessionId) {
        if (!meetingSessionId) {
            throw new Error("Meeting session ID wajib diisi.");
        }

        const data = await request(
            `session.php?id=${encodeURIComponent(meetingSessionId)}`,
            { method: "GET" }
        );

        return {
            ok: true,
            raw: data
        };
    }

    /* =========================================================
       TRANSCRIBE AUDIO (multipart — jangan pakai request())
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
        form.append("sequence", String(sequence ?? 0));
        form.append(
            "timestamp",
            timestamp || new Date().toISOString()
        );
        if (mimeType) {
            form.append("mime_type", mimeType);
        }

        console.log("[Sumrize API] Transcribe audio:", {
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
                    // Jangan set Content-Type — browser set multipart boundary
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
            const message =
                data?.message ||
                data?.error ||
                data?.raw ||
                `HTTP ${response.status}`;
            throw new Error(String(message));
        }

        if (data && typeof data === "object" && data.ok === false) {
            throw new Error(
                data.message || data.error || "Transcribe gagal di backend."
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
        "[Sumrize] SumrizeApi methods:",
        Object.keys(global.SumrizeApi)
    );
})(globalThis);