/**
 * content/transcript-collector.js
 *
 * Mengatur proses capture transcript Google Meet.
 */

(function (global) {

    /*
    |--------------------------------------------------------------------------
    | GUARD
    |--------------------------------------------------------------------------
    */

    if (global.__SUMRIZE_CONTENT_COLLECTOR_LOADED__) {
        console.log(
            "[Sumrize] Transcript collector already loaded."
        );
        return;
    }

    global.__SUMRIZE_CONTENT_COLLECTOR_LOADED__ = true;


    /*
    |--------------------------------------------------------------------------
    | STATE
    |--------------------------------------------------------------------------
    */

    let state = "idle";

    let meetingSessionId = null;

    let meetCode = null;

    let captionObserver = null;

    let transcriptBuffer = null;

    let startedAt = null;


    /*
    |--------------------------------------------------------------------------
    | ERROR
    |--------------------------------------------------------------------------
    */

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


    /*
    |--------------------------------------------------------------------------
    | SEND MESSAGE TO SERVICE WORKER
    |--------------------------------------------------------------------------
    */

    function sendRuntimeMessage(message) {

        return new Promise((resolve, reject) => {

            chrome.runtime.sendMessage(
                message,
                (response) => {

                    if (chrome.runtime.lastError) {

                        reject(
                            new Error(
                                chrome.runtime.lastError.message
                            )
                        );

                        return;
                    }

                    resolve(response);
                }
            );

        });
    }


    /*
    |--------------------------------------------------------------------------
    | SEND TRANSCRIPT
    |--------------------------------------------------------------------------
    */

    async function sendTranscriptSegment(segment) {

        if (!meetingSessionId) {

            console.warn(
                "[Sumrize] Transcript skipped: meeting session belum tersedia."
            );

            return;
        }


        /*
         * Pastikan segment benar-benar object.
         */

        if (
            !segment ||
            typeof segment !== "object"
        ) {

            console.warn(
                "[Sumrize] Invalid transcript segment:",
                segment
            );

            return;
        }


        /*
         * Ambil text dari berbagai kemungkinan
         * struktur hasil CaptionObserver / Buffer.
         */

        const text =
            typeof segment.text === "string"
                ? segment.text.trim()
                : typeof segment.transcript === "string"
                    ? segment.transcript.trim()
                    : typeof segment.content === "string"
                        ? segment.content.trim()
                        : "";


        /*
         * Jangan kirim transcript kosong.
         */

        if (!text) {

            console.warn(
                "[Sumrize] Transcript skipped: text kosong.",
                segment
            );

            return;
        }


        const speaker =
            typeof segment.speaker === "string" &&
            segment.speaker.trim()
                ? segment.speaker.trim()
                : "Unknown";


        const timestamp =
            segment.timestamp ||
            new Date().toISOString();


        const sequence =
            Number.isFinite(segment.sequence)
                ? segment.sequence
                : null;


        console.log(
            "[Sumrize] Sending transcript:",
            {
                meetingSessionId,
                speaker,
                text,
                timestamp,
                sequence
            }
        );


        try {

            const response =
                await sendRuntimeMessage({

                    type:
                        "TRANSCRIPT_SEGMENT",

                    meetingSessionId,

                    speaker,

                    text,

                    timestamp,

                    sequence

                });


            if (!response?.ok) {

                throw new Error(
                    response?.error ||
                    "Transcript gagal dikirim."
                );
            }


            console.log(
                "[Sumrize] Transcript sent successfully:",
                response
            );


        } catch (error) {

            console.warn(
                "[Sumrize] WARN Transcript send failed:",
                normalizeError(error)
            );

        }
    }


    /*
    |--------------------------------------------------------------------------
    | START CAPTURE
    |--------------------------------------------------------------------------
    */

    async function startCapture() {

        if (state === "capturing") {

            console.log(
                "[Sumrize] Capture already running."
            );

            return {

                ok: true,

                state,

                meetingSessionId,

                meetCode

            };
        }


        /*
        |--------------------------------------------------------------------------
        | VALIDATE MEET
        |--------------------------------------------------------------------------
        */

        if (
            !global.SumrizeMeetDetector
        ) {

            throw new Error(
                "SumrizeMeetDetector tidak tersedia."
            );
        }


        if (
            !global.SumrizeMeetDetector
                .isValidMeetingPage()
        ) {

            throw new Error(
                "Halaman Google Meet tidak valid."
            );
        }


        meetCode =
            global.SumrizeMeetDetector
                .getMeetCode();


        if (!meetCode) {

            throw new Error(
                "Meet code tidak ditemukan."
            );
        }


        console.log(
            "[Sumrize] Starting capture:",
            meetCode
        );


        /*
        |--------------------------------------------------------------------------
        | CREATE MEETING SESSION
        |--------------------------------------------------------------------------
        */

        const createResponse =
            await sendRuntimeMessage({

                type:
                    "CREATE_MEETING_SESSION",

                meetCode,

                title:
                    `Google Meet - ${meetCode}`

            });


        console.log(
            "[Sumrize] Create session response:",
            createResponse
        );


        if (!createResponse?.ok) {

            throw new Error(
                createResponse?.error ||
                "Gagal membuat meeting session."
            );
        }


        meetingSessionId =
            createResponse.meetingSessionId ||
            createResponse.meeting_session_id ||
            createResponse.id ||
            null;


        if (!meetingSessionId) {

            throw new Error(
                "Meeting session ID tidak diterima dari backend."
            );
        }


        /*
        |--------------------------------------------------------------------------
        | START STATE
        |--------------------------------------------------------------------------
        */

        startedAt =
            new Date();


        state =
            "capturing";


        /*
        |--------------------------------------------------------------------------
        | STORAGE
        |--------------------------------------------------------------------------
        */

        if (global.SumrizeStorage) {

            await global.SumrizeStorage.set({

                captureState:
                    "capturing",

                meetingSessionId,

                meetCode,

                lastError:
                    null

            });

        }


        /*
        |--------------------------------------------------------------------------
        | TRANSCRIPT BUFFER
        |--------------------------------------------------------------------------
        */

        if (
            !global.SumrizeTranscriptBuffer
        ) {

            throw new Error(
                "SumrizeTranscriptBuffer tidak tersedia."
            );
        }


        transcriptBuffer =
            new global.SumrizeTranscriptBuffer({

                onFinalized:
                    sendTranscriptSegment

            });


        /*
        |--------------------------------------------------------------------------
        | CAPTION OBSERVER
        |--------------------------------------------------------------------------
        */

        if (
            !global.SumrizeCaptionObserver
        ) {

            throw new Error(
                "SumrizeCaptionObserver tidak tersedia."
            );
        }


        captionObserver =
            new global.SumrizeCaptionObserver({

                onCaption:
                    (caption) => {

                        console.log(
                            "[Sumrize] Caption received:",
                            caption
                        );


                        /*
                         * Pastikan caption punya text.
                         */

                        if (
                            !caption ||
                            typeof caption.text !==
                            "string" ||
                            !caption.text.trim()
                        ) {

                            console.warn(
                                "[Sumrize] Caption ignored because text is empty:",
                                caption
                            );

                            return;
                        }


                        /*
                         * Kirim ke buffer.
                         */

                        transcriptBuffer.add(
                            caption
                        );

                    }

            });


        /*
        |--------------------------------------------------------------------------
        | START OBSERVER
        |--------------------------------------------------------------------------
        */

        captionObserver.start();


        console.log(
            "[Sumrize] Capture started successfully.",
            {
                meetingSessionId,
                meetCode
            }
        );


        return {

            ok: true,

            state,

            meetingSessionId,

            meetCode

        };
    }


    /*
    |--------------------------------------------------------------------------
    | STOP CAPTURE
    |--------------------------------------------------------------------------
    */

    async function stopCapture() {

        if (state === "idle") {

            return {

                ok: true,

                state: "idle"

            };
        }


        console.log(
            "[Sumrize] Stopping capture..."
        );


        state =
            "stopping";


        /*
        |--------------------------------------------------------------------------
        | STOP CAPTION OBSERVER
        |--------------------------------------------------------------------------
        */

        if (captionObserver) {

            try {

                captionObserver.stop();

            } catch (error) {

                console.warn(
                    "[Sumrize] Caption observer stop failed:",
                    normalizeError(error)
                );

            }

            captionObserver =
                null;
        }


        /*
        |--------------------------------------------------------------------------
        | FLUSH BUFFER
        |--------------------------------------------------------------------------
        */

        if (transcriptBuffer) {

            try {

                await transcriptBuffer.flush();

            } catch (error) {

                console.warn(
                    "[Sumrize] Transcript buffer flush failed:",
                    normalizeError(error)
                );

            }

            transcriptBuffer =
                null;
        }


        /*
        |--------------------------------------------------------------------------
        | STOP BACKEND SESSION
        |--------------------------------------------------------------------------
        */

        const sessionId =
            meetingSessionId;


        if (sessionId) {

            try {

                const response =
                    await sendRuntimeMessage({

                        type:
                            "STOP_MEETING_SESSION",

                        meetingSessionId:
                            sessionId

                    });


                console.log(
                    "[Sumrize] Stop meeting response:",
                    response
                );


                if (!response?.ok) {

                    throw new Error(
                        response?.error ||
                        "Gagal menghentikan meeting session."
                    );
                }


            } catch (error) {

                console.error(
                    "[Sumrize] Stop meeting failed:",
                    normalizeError(error)
                );

            }

        }


        /*
        |--------------------------------------------------------------------------
        | RESET
        |--------------------------------------------------------------------------
        */

        state =
            "idle";


        meetingSessionId =
            null;


        meetCode =
            null;


        startedAt =
            null;


        if (global.SumrizeStorage) {

            await global.SumrizeStorage.reset();

        }


        console.log(
            "[Sumrize] Capture stopped."
        );


        return {

            ok: true,

            state: "idle"

        };
    }


    /*
    |--------------------------------------------------------------------------
    | GET STATE
    |--------------------------------------------------------------------------
    */

    function getState() {

        return {

            state,

            meetingSessionId,

            meetCode,

            startedAt

        };
    }


    /*
    |--------------------------------------------------------------------------
    | MESSAGE LISTENER
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
            | START
            |--------------------------------------------------------------------------
            */

            if (
                message.type ===
                "POPUP_START_CAPTURE"
            ) {

                startCapture()

                    .then(
                        (result) => {

                            sendResponse(
                                result
                            );

                        }
                    )

                    .catch(
                        (error) => {

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

                        }
                    );


                return true;
            }


            /*
            |--------------------------------------------------------------------------
            | STOP
            |--------------------------------------------------------------------------
            */

            if (
                message.type ===
                "POPUP_STOP_CAPTURE"
            ) {

                stopCapture()

                    .then(
                        (result) => {

                            sendResponse(
                                result
                            );

                        }
                    )

                    .catch(
                        (error) => {

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

                        }
                    );


                return true;
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

                sendResponse({

                    ok: true,

                    ...getState()

                });


                return true;
            }


            /*
            |--------------------------------------------------------------------------
            | PING
            |--------------------------------------------------------------------------
            */

            if (
                message.type ===
                "SUMRIZE_CONTENT_PING"
            ) {

                sendResponse({

                    ok: true,

                    state,

                    meetingSessionId,

                    meetCode

                });


                return true;
            }

        }
    );


    /*
    |--------------------------------------------------------------------------
    | AUTO STOP WHEN LEAVING MEET
    |--------------------------------------------------------------------------
    */

    let leaveCheckInterval =
        null;


    function startLeaveWatcher() {

        if (leaveCheckInterval) {
            return;
        }


        leaveCheckInterval =
            setInterval(
                async () => {

                    if (
                        state !==
                        "capturing"
                    ) {
                        return;
                    }


                    try {

                        const inCall =
                            global.SumrizeMeetDetector
                                ?.isInCall();


                        if (
                            inCall === false
                        ) {

                            console.log(
                                "[Sumrize] Meeting ended. Auto stopping capture."
                            );


                            await stopCapture();

                        }

                    } catch (error) {

                        console.warn(
                            "[Sumrize] Leave watcher failed:",
                            normalizeError(error)
                        );

                    }

                },
                3000
            );
    }


    // startLeaveWatcher();


    /*
    |--------------------------------------------------------------------------
    | EXPORT
    |--------------------------------------------------------------------------
    */

    global.SumrizeTranscriptCollector = {

        startCapture,

        stopCapture,

        getState

    };


    console.log(
        "[Sumrize] Transcript Collector loaded."
    );

})(window);