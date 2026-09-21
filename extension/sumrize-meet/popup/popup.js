const statusElement = document.getElementById("status");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const viewButton = document.getElementById("view");

function setStatus(message) {
    statusElement.textContent = `Status: ${message}`;
}

/**
 * Kirim pesan ke Service Worker.
 */
function sendToBackground(message, callback) {

    chrome.runtime.sendMessage(
        message,
        (response) => {

            if (chrome.runtime.lastError) {

                const errorMessage =
                    chrome.runtime.lastError.message ||
                    "service_worker_unavailable";

                console.error(
                    "[Sumrize] Background communication error:",
                    errorMessage
                );

                callback({
                    ok: false,
                    error: errorMessage,
                    message: errorMessage
                });

                return;
            }


            if (!response) {

                callback({
                    ok: false,
                    error: "empty_response",
                    message: "Service Worker tidak memberikan response."
                });

                return;
            }


            /*
             * Pastikan error selalu berupa STRING.
             */

            if (response.ok === false) {

                let errorMessage =
                    response.error;


                if (
                    typeof errorMessage === "object"
                ) {

                    errorMessage =
                        errorMessage?.message ||
                        errorMessage?.error ||
                        errorMessage?.code ||
                        JSON.stringify(
                            errorMessage
                        );
                }


                if (!errorMessage) {

                    errorMessage =
                        response.message ||
                        "request_failed";
                }


                callback({
                    ...response,
                    ok: false,
                    error: String(
                        errorMessage
                    ),
                    message: String(
                        response.message ||
                        errorMessage
                    )
                });

                return;
            }


            callback(response);
        }
    );
}

/**
 * Ambil status capture saat popup dibuka.
 */
function loadState() {
    setStatus("Checking...");

    sendToBackground(
        {
            type: "POPUP_GET_STATE"
        },
        (response) => {

            console.log(
                "[Sumrize] GET_STATE response:",
                response
            );

            if (!response?.ok) {

                if (
                    response?.error ===
                    "not_on_meet"
                ) {
                    setStatus(
                        "Buka Google Meet terlebih dahulu."
                    );
                } else {
                    setStatus(
                        "Content script belum aktif."
                    );
                }

                return;
            }

            const state =
                response.state || "idle";

            if (state === "capturing") {

                const captionsReceived =
                    Number(response.captionsReceived || 0);

                const segmentsFinalized =
                    Number(response.segmentsFinalized || 0);

                setStatus(
                    `Capturing... captions: ${captionsReceived}, segments: ${segmentsFinalized}`
                );

            } else if (state === "stopping") {

                setStatus("Stopping...");

            } else {

                setStatus("Ready");
            }
        }
    );
}

/**
 * START CAPTURE
 */
startButton.addEventListener(
    "click",
    () => {

        setStatus("Starting...");

        startButton.disabled = true;

        sendToBackground(
            {
                type: "POPUP_START_CAPTURE"
            },
            (response) => {

                console.log(
                    "[Sumrize] START response:",
                    response
                );

                startButton.disabled = false;

                if (!response?.ok) {

                    const error =
                        response?.error ||
                        response?.message ||
                        "Gagal memulai capture.";

                    console.error(
                        "[Sumrize] Start capture failed:",
                        response
                    );

                    if (
                        error ===
                        "not_on_meet"
                    ) {
                        setStatus(
                            "Buka Google Meet terlebih dahulu."
                        );
                    } else if (
                        error ===
                        "service_worker_unavailable"
                    ) {
                        setStatus(
                            "Service worker tidak aktif."
                        );
                    } else {
                        setStatus(
                            `Gagal: ${error}`
                        );
                    }

                    return;
                }

                setStatus("Capturing...");
            }
        );
    }
);

/**
 * STOP CAPTURE
 */
stopButton.addEventListener(
    "click",
    () => {

        setStatus("Stopping...");

        stopButton.disabled = true;

        sendToBackground(
            {
                type: "POPUP_STOP_CAPTURE"
            },
            (response) => {

                console.log(
                    "[Sumrize] STOP response:",
                    response
                );

                stopButton.disabled = false;

                if (!response?.ok) {

                    const error =
                        response?.error ||
                        response?.message ||
                        "Gagal menghentikan capture.";

                    console.error(
                        "[Sumrize] Stop capture failed:",
                        response
                    );

                    setStatus(
                        `Gagal: ${error}`
                    );

                    return;
                }

                const count =
                    response?.segmentsCount ??
                    response?.count ??
                    0;

                setStatus(
                    `Stopped (${count} segments)`
                );
            }
        );
    }
);

/**
 * VIEW CAPTURED
 *
 * Tampilkan metrik langsung dari content script.
 * Segmen transcript dikirim ke backend, bukan disimpan
 * dengan key `segments` di chrome.storage.
 */
viewButton.addEventListener(
    "click",
    () => {
        sendToBackground(
            { type: "POPUP_GET_STATE" },
            (response) => {
                if (!response?.ok) {
                    setStatus(
                        `Gagal membaca capture: ${response?.error || "state_unavailable"}`
                    );
                    return;
                }

                const captionsReceived =
                    Number(response.captionsReceived || 0);

                const segmentsFinalized =
                    Number(response.segmentsFinalized || 0);

                statusElement.textContent =
                    `Captured: ${segmentsFinalized} segments`;

                alert(
                    JSON.stringify(
                        {
                            meetingSessionId:
                                response.meetingSessionId || "-",
                            meetCode:
                                response.meetCode || "-",
                            captureState:
                                response.state || "idle",
                            captionsReceived,
                            segmentsFinalized
                        },
                        null,
                        2
                    )
                );
            }
        );
    }
);

/**
 * Cek status ketika popup dibuka.
 */
loadState();