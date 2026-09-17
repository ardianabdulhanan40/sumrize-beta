/**
 * api/api-client.js
 *
 * API Client untuk Sumrize Meeting Assistant
 */

(function (global) {

    const DEFAULT_BASE_URL =
        "http://localhost/sumrize-beta/api/meeting";


    /* =========================================================
       ERROR NORMALIZER
       ========================================================= */

    function normalizeError(error) {

        if (!error) {
            return "Unknown error";
        }

        if (typeof error === "string") {
            return error;
        }

        if (error instanceof Error) {
            return error.message;
        }

        if (typeof error.message === "string") {
            return error.message;
        }

        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }


    /* =========================================================
       TOKEN
       ========================================================= */

    async function getToken() {

        if (!global.SumrizeStorage) {
            throw new Error(
                "SumrizeStorage tidak tersedia."
            );
        }

        const token =
            await global.SumrizeStorage.getAuthToken();

        if (!token) {
            throw new Error(
                "Auth token belum tersedia. Silakan login ke dashboard."
            );
        }

        return token;
    }


    /* =========================================================
       BASE URL
       ========================================================= */

    async function getBaseUrl() {

        if (!global.SumrizeStorage) {
            return DEFAULT_BASE_URL;
        }

        try {

            const baseUrl =
                await global.SumrizeStorage.getApiBaseUrl();

            return (
                baseUrl ||
                DEFAULT_BASE_URL
            );

        } catch {

            return DEFAULT_BASE_URL;
        }
    }


    /* =========================================================
       GENERIC REQUEST
       ========================================================= */

    async function request(
        endpoint,
        options = {}
    ) {

        const token =
            await getToken();

        const baseUrl =
            await getBaseUrl();

        const url =
            `${baseUrl}/${endpoint}`;


        console.log(
            "[Sumrize API] Request:",
            options.method || "GET",
            url
        );


        const headers = {

            "Content-Type":
                "application/json",

            "Authorization":
                `Bearer ${token}`,

            ...(options.headers || {})
        };


        let response;

        try {

            response =
                await fetch(
                    url,
                    {
                        ...options,
                        headers
                    }
                );

        } catch (error) {

            throw new Error(
                `Tidak dapat terhubung ke backend: ${normalizeError(error)}`
            );
        }


        const rawText =
            await response.text();


        let data = null;


        if (rawText) {

            try {

                data =
                    JSON.parse(rawText);

            } catch {

                data = {
                    raw: rawText
                };

            }

        }


        console.log(
            "[Sumrize API] Response:",
            {
                status: response.status,
                data
            }
        );


        /* =====================================================
           HTTP ERROR
           ===================================================== */

        if (!response.ok) {

            console.error(
                "[Sumrize API] HTTP Error:",
                data
            );


            let message =
                `HTTP ${response.status}`;


            if (data) {

                if (
                    typeof data.message ===
                    "string"
                ) {

                    message =
                        data.message;

                } else if (
                    typeof data.error ===
                    "string"
                ) {

                    message =
                        data.error;

                } else if (
                    data.error &&
                    typeof data.error.message ===
                    "string"
                ) {

                    message =
                        data.error.message;

                } else {

                    try {

                        message =
                            JSON.stringify(data);

                    } catch {

                        message =
                            `HTTP ${response.status}`;

                    }

                }

            }


            const error =
                new Error(message);

            error.status =
                response.status;

            error.response =
                data;

            throw error;
        }


        /* =====================================================
           BACKEND ERROR
           ===================================================== */

        if (
            data &&
            data.ok === false
        ) {

            let message =
                "Request gagal.";


            if (
                typeof data.message ===
                "string"
            ) {

                message =
                    data.message;

            } else if (
                typeof data.error ===
                "string"
            ) {

                message =
                    data.error;

            }


            const error =
                new Error(message);

            error.response =
                data;

            throw error;
        }


        return data;
    }


    /* =========================================================
       CREATE MEETING SESSION
       ========================================================= */

    async function createMeetingSession({
        meetCode,
        title
    }) {

        if (!meetCode) {

            throw new Error(
                "Meet code wajib diisi."
            );

        }


        console.log(
            "[Sumrize API] Creating meeting session:",
            meetCode
        );


        const response =
            await request(
                "create.php",
                {
                    method: "POST",

                    body:
                        JSON.stringify({

                            connector:
                                "google_meet",

                            meetCode:
                                meetCode,

                            title:
                                title ||
                                `Google Meet - ${meetCode}`

                        })
                }
            );


        console.log(
            "[Sumrize API] Raw create response:",
            response
        );


        /*
         * Backend create.php kemungkinan mengembalikan
         * salah satu struktur berikut:
         *
         * 1.
         * {
         *   ok: true,
         *   meetingSessionId: "ms_xxx"
         * }
         *
         * 2.
         * {
         *   ok: true,
         *   id: "ms_xxx"
         * }
         *
         * 3.
         * {
         *   ok: true,
         *   data: {
         *      id: "ms_xxx"
         *   }
         * }
         *
         * 4.
         * {
         *   ok: true,
         *   meeting_session: {
         *      id: "ms_xxx"
         *   }
         * }
         *
         * 5.
         * {
         *   ok: true,
         *   meeting_session_id: "ms_xxx"
         * }
         */


        let meetingSessionId =
            response?.meetingSessionId ||
            response?.meeting_session_id ||
            response?.id ||
            response?.data?.meetingSessionId ||
            response?.data?.meeting_session_id ||
            response?.data?.id ||
            response?.meeting_session?.meetingSessionId ||
            response?.meeting_session?.meeting_session_id ||
            response?.meeting_session?.id ||
            response?.meetingSession?.meetingSessionId ||
            response?.meetingSession?.meeting_session_id ||
            response?.meetingSession?.id ||
            null;


        /*
         * Beberapa backend memakai:
         *
         * {
         *   ok: true,
         *   data: {
         *      meeting_session: {
         *          id: "ms_xxx"
         *      }
         *   }
         * }
         */

        if (!meetingSessionId) {

            meetingSessionId =
                response?.data?.meeting_session?.id ||
                response?.data?.meeting_session?.meetingSessionId ||
                response?.data?.meeting_session?.meeting_session_id ||
                response?.data?.meetingSession?.id ||
                response?.data?.meetingSession?.meetingSessionId ||
                response?.data?.meetingSession?.meeting_session_id ||
                null;
        }


        console.log(
            "[Sumrize API] Detected meetingSessionId:",
            meetingSessionId
        );


        if (!meetingSessionId) {

            console.error(
                "[Sumrize API] ID session tidak ditemukan.",
                {
                    response
                }
            );

            throw new Error(
                "Meeting session berhasil dibuat tetapi ID session tidak ditemukan."
            );
        }


        return {

            ok: true,

            meetingSessionId,

            meetCode,

            state:
                "capturing",

            raw:
                response
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

            throw new Error(
                "Meeting session ID wajib diisi."
            );

        }


        if (!text) {

            throw new Error(
                "Transcript text wajib diisi."
            );

        }


        return await request(
            "transcript.php",
            {
                method: "POST",

                body:
                    JSON.stringify({

                        id:
                            meetingSessionId,

                        meetingSessionId:
                            meetingSessionId,

                        speaker:
                            speaker ||
                            "Unknown",

                        text,

                        timestamp:
                            timestamp ||
                            null,

                        sequence:
                            sequence ??
                            null

                    })
            }
        );
    }


    /* =========================================================
       STOP MEETING SESSION
       ========================================================= */

    async function stopMeetingSession({
        meetingSessionId
    }) {

        if (!meetingSessionId) {

            throw new Error(
                "Meeting session ID wajib diisi untuk STOP."
            );

        }


        console.log(
            "[Sumrize API] Stopping meeting session:",
            meetingSessionId
        );


        return await request(
            "stop.php",
            {
                method: "POST",

                body:
                    JSON.stringify({

                        id:
                            meetingSessionId,

                        meetingSessionId:
                            meetingSessionId

                    })
            }
        );
    }


    /* =========================================================
       GET MEETING SESSION
       ========================================================= */

    async function getMeetingSession({
        meetingSessionId
    }) {

        if (!meetingSessionId) {

            throw new Error(
                "Meeting session ID wajib diisi."
            );
        }


        return await request(
            "detail.php?id=" +
            encodeURIComponent(
                meetingSessionId
            ),
            {
                method: "GET"
            }
        );
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

        getMeetingSession

    };


    console.log(
        "[Sumrize] API Client loaded"
    );

})(globalThis);