/**
 * background/service-worker.js
 *
 * Service Worker untuk Sumrize Meeting Assistant.
 *
 * Tugas:
 * - Menangani komunikasi Popup ↔ Content Script
 * - Membuat Meeting Session
 * - Mengirim transcript ke backend
 * - Menghentikan Meeting Session
 * - Menerima auth token dari Dashboard
 */


/*
|--------------------------------------------------------------------------
| LOAD DEPENDENCIES
|--------------------------------------------------------------------------
|
| Manifest menggunakan:
| "type": "module"
|
| Jadi TIDAK menggunakan importScripts().
|
*/

import "../utils/storage.js";
import "../api/api-client.js";


console.log(
    "[Sumrize] Service Worker loaded"
);

console.log(
    "[Sumrize] Storage:",
    typeof globalThis.SumrizeStorage
);

console.log(
    "[Sumrize] API:",
    typeof globalThis.SumrizeApi
);


/*
|--------------------------------------------------------------------------
| ERROR NORMALIZER
|--------------------------------------------------------------------------
*/

function normalizeError(error) {

    if (!error) {
        return "Unknown error";
    }

    if (
        typeof error === "string"
    ) {
        return error;
    }

    if (
        error instanceof Error
    ) {
        return error.message;
    }

    if (
        typeof error.message === "string"
    ) {
        return error.message;
    }

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}


/*
|--------------------------------------------------------------------------
| POPUP MESSAGE HANDLER
|--------------------------------------------------------------------------
*/

chrome.runtime.onMessage.addListener(
    (
        message,
        sender,
        sendResponse
    ) => {

        if (!message?.type) {
            return;
        }


        /*
        |--------------------------------------------------------------------------
        | GET STATE
        |--------------------------------------------------------------------------
        */

        if (
            message.type ===
            "POPUP_GET_STATE"
        ) {

            handleGetState()
                .then((result) => {

                    sendResponse({
                        ok: true,
                        state: result
                    });

                })
                .catch((error) => {

                    console.error(
                        "[Sumrize] Get state failed:",
                        error
                    );

                    sendResponse({
                        ok: false,
                        error:
                            normalizeError(
                                error
                            )
                    });
                });

            return true;
        }


        /*
        |--------------------------------------------------------------------------
        | START CAPTURE
        |--------------------------------------------------------------------------
        */

        if (
            message.type ===
            "POPUP_START_CAPTURE"
        ) {

            startCapture(message)
                .then((result) => {

                    sendResponse({
                        ok: true,
                        ...result
                    });

                })
                .catch((error) => {

                    console.error(
                        "[Sumrize] Start capture failed:",
                        error
                    );

                    sendResponse({
                        ok: false,
                        error:
                            normalizeError(
                                error
                            )
                    });
                });

            return true;
        }


        /*
        |--------------------------------------------------------------------------
        | STOP CAPTURE
        |--------------------------------------------------------------------------
        */

        if (
            message.type ===
            "POPUP_STOP_CAPTURE"
        ) {

            stopCapture(message)
                .then((result) => {

                    sendResponse({
                        ok: true,
                        ...result
                    });

                })
                .catch((error) => {

                    console.error(
                        "[Sumrize] Stop capture failed:",
                        error
                    );

                    sendResponse({
                        ok: false,
                        error:
                            normalizeError(
                                error
                            )
                    });
                });

            return true;
        }


        /*
        |--------------------------------------------------------------------------
        | CREATE MEETING SESSION
        |--------------------------------------------------------------------------
        */

        if (
            message.type ===
            "CREATE_MEETING_SESSION"
        ) {

            createMeeting(message)
                .then((result) => {

                    sendResponse({
                        ok: true,
                        ...result
                    });

                })
                .catch((error) => {

                    console.error(
                        "[Sumrize] Create meeting failed:",
                        error
                    );

                    sendResponse({
                        ok: false,
                        error:
                            normalizeError(
                                error
                            )
                    });
                });

            return true;
        }


        /*
        |--------------------------------------------------------------------------
        | TRANSCRIPT SEGMENT
        |--------------------------------------------------------------------------
        */

        if (
            message.type ===
            "TRANSCRIPT_SEGMENT"
        ) {

            handleTranscript(message)
                .then((result) => {

                    sendResponse({
                        ok: true,
                        ...result
                    });

                })
                .catch((error) => {

                    console.error(
                        "[Sumrize] Transcript failed:",
                        error
                    );

                    sendResponse({
                        ok: false,
                        error:
                            normalizeError(
                                error
                            )
                    });
                });

            return true;
        }


        /*
        |--------------------------------------------------------------------------
        | STOP MEETING SESSION
        |--------------------------------------------------------------------------
        */

        if (
            message.type ===
            "STOP_MEETING_SESSION"
        ) {

            stopMeeting(message)
                .then((result) => {

                    sendResponse({
                        ok: true,
                        ...result
                    });

                })
                .catch((error) => {

                    console.error(
                        "[Sumrize] Stop meeting failed:",
                        error
                    );

                    sendResponse({
                        ok: false,
                        error:
                            normalizeError(
                                error
                            )
                    });
                });

            return true;
        }
    }
);


/*
|--------------------------------------------------------------------------
| GET STATE
|--------------------------------------------------------------------------
*/

async function handleGetState() {

    if (
        !globalThis.SumrizeStorage
    ) {

        throw new Error(
            "SumrizeStorage tidak tersedia."
        );
    }

    return await globalThis.SumrizeStorage
        .getAll();
}


/*
|--------------------------------------------------------------------------
| START CAPTURE
|--------------------------------------------------------------------------
*/

async function startCapture(message) {

    console.log(
        "[Sumrize] Start capture request"
    );


    let tabId =
        message?.tabId || null;


    /*
    |--------------------------------------------------------------------------
    | Jika popup tidak mengirim tabId,
    | cari active tab.
    |--------------------------------------------------------------------------
    */

    if (!tabId) {

        const tabs =
            await chrome.tabs.query({
                active: true,
                currentWindow: true
            });


        const activeTab =
            tabs?.[0];


        if (!activeTab?.id) {

            throw new Error(
                "Tab Google Meet tidak ditemukan."
            );
        }


        tabId =
            activeTab.id;
    }


    /*
    |--------------------------------------------------------------------------
    | Pastikan API tersedia
    |--------------------------------------------------------------------------
    */

    if (
        !globalThis.SumrizeApi
    ) {

        throw new Error(
            "SumrizeApi tidak tersedia."
        );
    }


    /*
    |--------------------------------------------------------------------------
    | Kirim perintah ke Content Script
    |--------------------------------------------------------------------------
    */

    const response =
        await chrome.tabs.sendMessage(
            tabId,
            {
                type:
                    "POPUP_START_CAPTURE"
            }
        );


    if (!response?.ok) {

        throw new Error(
            response?.error ||
            "Content script gagal memulai capture."
        );
    }


    return response;
}


/*
|--------------------------------------------------------------------------
| STOP CAPTURE
|--------------------------------------------------------------------------
*/

async function stopCapture(message) {

    console.log(
        "[Sumrize] Stop capture request"
    );


    let tabId =
        message?.tabId || null;


    if (!tabId) {

        const tabs =
            await chrome.tabs.query({
                active: true,
                currentWindow: true
            });


        const activeTab =
            tabs?.[0];


        if (!activeTab?.id) {

            throw new Error(
                "Tab Google Meet tidak ditemukan."
            );
        }


        tabId =
            activeTab.id;
    }


    const response =
        await chrome.tabs.sendMessage(
            tabId,
            {
                type:
                    "POPUP_STOP_CAPTURE"
            }
        );


    if (!response?.ok) {

        throw new Error(
            response?.error ||
            "Content script gagal menghentikan capture."
        );
    }


    return response;
}


/*
|--------------------------------------------------------------------------
| CREATE MEETING SESSION
|--------------------------------------------------------------------------
*/

async function createMeeting(message) {

    console.log(
        "[Sumrize] Create meeting session request"
    );


    if (
        !globalThis.SumrizeApi
    ) {

        throw new Error(
            "SumrizeApi tidak tersedia."
        );
    }


    if (
        typeof
            globalThis.SumrizeApi
                .createMeetingSession !==
            "function"
    ) {

        throw new Error(
            "SumrizeApi.createMeetingSession tidak tersedia."
        );
    }


    const meetCode =
        message?.meetCode;


    if (!meetCode) {

        throw new Error(
            "Meet code tidak tersedia."
        );
    }


    const title =
        message?.title ||
        `Google Meet - ${meetCode}`;


    console.log(
        "[Sumrize] Creating meeting session:",
        meetCode
    );


    const response =
        await globalThis.SumrizeApi
            .createMeetingSession({

                meetCode,

                title
            });


    return response;
}


/*
|--------------------------------------------------------------------------
| SEND TRANSCRIPT
|--------------------------------------------------------------------------
*/

async function handleTranscript(message) {

    if (
        !globalThis.SumrizeApi
    ) {

        throw new Error(
            "SumrizeApi tidak tersedia."
        );
    }


    if (
        typeof
            globalThis.SumrizeApi
                .sendTranscript !==
            "function"
    ) {

        throw new Error(
            "SumrizeApi.sendTranscript tidak tersedia."
        );
    }


    const meetingSessionId =
        message?.meetingSessionId;


    if (!meetingSessionId) {

        throw new Error(
            "Meeting session ID tidak tersedia."
        );
    }


    if (!message?.text) {

        throw new Error(
            "Transcript text tidak tersedia."
        );
    }


    return await globalThis.SumrizeApi
        .sendTranscript({

            meetingSessionId,

            speaker:
                message.speaker ||
                "Unknown",

            text:
                message.text,

            timestamp:
                message.timestamp,

            sequence:
                message.sequence
        });
}


/*
|--------------------------------------------------------------------------
| STOP MEETING SESSION
|--------------------------------------------------------------------------
*/

async function stopMeeting(message) {

    console.log(
        "[Sumrize] Stop meeting session request:",
        message
    );


    if (!globalThis.SumrizeApi) {

        throw new Error(
            "SumrizeApi tidak tersedia."
        );
    }


    if (
        typeof globalThis.SumrizeApi
            .stopMeetingSession !==
        "function"
    ) {

        throw new Error(
            "SumrizeApi.stopMeetingSession tidak tersedia."
        );
    }


    const meetingSessionId =
        message?.meetingSessionId;


    if (!meetingSessionId) {

        throw new Error(
            "Meeting session ID tidak tersedia untuk STOP."
        );
    }


    console.log(
        "[Sumrize] Sending STOP for:",
        meetingSessionId
    );


    const response =
        await globalThis.SumrizeApi
            .stopMeetingSession({

                meetingSessionId

            });


    console.log(
        "[Sumrize] STOP backend response:",
        response
    );


    return response;
}


/*
|--------------------------------------------------------------------------
| EXTERNAL AUTH BRIDGE
|--------------------------------------------------------------------------
|
| Dashboard:
| http://localhost:3000
|
| Dashboard localStorage
|        ↓
| SUMRIZE_AUTH_TOKEN
|        ↓
| Service Worker
|        ↓
| chrome.storage.local
|
|--------------------------------------------------------------------------
*/

chrome.runtime.onMessageExternal.addListener(
    (
        message,
        sender,
        sendResponse
    ) => {

        try {

            const senderUrl =
                sender?.url || "";


            const origin =
                senderUrl
                    ? new URL(
                        senderUrl
                    ).origin
                    : "";


            /*
            |--------------------------------------------------------------------------
            | SECURITY CHECK
            |--------------------------------------------------------------------------
            */

            if (
                origin !==
                "http://localhost:3000"
            ) {

                sendResponse({

                    ok: false,

                    error:
                        "Origin tidak diizinkan."
                });

                return;
            }


            /*
            |--------------------------------------------------------------------------
            | AUTH TOKEN
            |--------------------------------------------------------------------------
            */

            if (
                message?.type ===
                "SUMRIZE_AUTH_TOKEN"
            ) {


                if (!message.token) {

                    sendResponse({

                        ok: false,

                        error:
                            "Auth token kosong."
                    });

                    return;
                }


                globalThis.SumrizeStorage
                    .setAuthToken(
                        message.token
                    )

                    .then(() => {

                        console.log(
                            "[Sumrize] Auth token berhasil disimpan."
                        );


                        sendResponse({

                            ok: true
                        });

                    })

                    .catch((error) => {

                        console.error(

                            "[Sumrize] Gagal menyimpan auth token:",

                            error
                        );


                        sendResponse({

                            ok: false,

                            error:
                                normalizeError(
                                    error
                                )
                        });
                    });


                return true;
            }


            sendResponse({

                ok: false,

                error:
                    "Message type external tidak dikenal."
            });

        } catch (error) {

            console.error(

                "[Sumrize] External message error:",

                error
            );


            sendResponse({

                ok: false,

                error:
                    normalizeError(
                        error
                    )
            });
        }
    }
);