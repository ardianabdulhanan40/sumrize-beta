(function (global) {

    if (
        global.__SUMRIZE_TRANSCRIPT_BUFFER_LOADED__
    ) {
        return;
    }

    global.__SUMRIZE_TRANSCRIPT_BUFFER_LOADED__ =
        true;


    const SILENCE_TIMEOUT_MS = 1500;


    class SumrizeTranscriptBuffer {

        constructor(options = {}) {

            this.onSegment =
                typeof options.onSegment === "function"
                    ? options.onSegment
                    : null;

            this.currentSpeaker = null;
            this.currentText = "";

            this.startedAt = null;

            this.sequence = 0;

            this.silenceTimer = null;

            this.finalizedTexts =
                new Set();
        }


        setOnSegment(callback) {

            if (
                typeof callback ===
                "function"
            ) {

                this.onSegment =
                    callback;
            }
        }


        add(
            speaker,
            text
        ) {

            speaker =
                String(
                    speaker ||
                    "Unknown"
                ).trim();


            text =
                String(
                    text ||
                    ""
                ).trim();


            if (!text) {
                return;
            }


            /*
             * Jika speaker berubah,
             * selesaikan segment sebelumnya.
             */

            if (
                this.currentText &&
                this.currentSpeaker !== speaker
            ) {

                this.finalize();
            }


            if (!this.startedAt) {

                this.startedAt =
                    new Date();
            }


            this.currentSpeaker =
                speaker;


            /*
             * Hindari menambahkan teks
             * yang sama berulang kali.
             */

            if (
                this.currentText !== text
            ) {

                this.currentText =
                    text;
            }


            /*
             * Reset silence timer.
             */

            if (this.silenceTimer) {

                clearTimeout(
                    this.silenceTimer
                );
            }


            this.silenceTimer =
                setTimeout(
                    () => {
                        this.finalize();
                    },
                    SILENCE_TIMEOUT_MS
                );
        }


        push(data) {

            if (!data) {
                return;
            }


            this.add(
                data.speaker,
                data.text
            );
        }


        finalize() {

            if (
                !this.currentText
            ) {
                return;
            }


            const text =
                this.currentText.trim();


            if (!text) {
                return;
            }


            /*
             * Dedup final text.
             */

            if (
                this.finalizedTexts.has(text)
            ) {

                this.resetCurrent();

                return;
            }


            this.finalizedTexts.add(
                text
            );


            const segment = {

                speaker:
                    this.currentSpeaker ||
                    "Unknown",

                text,

                timestamp:
                    (
                        this.startedAt ||
                        new Date()
                    ).toISOString(),

                sequence:
                    this.sequence++
            };


            /*
             * Batasi memory dedup.
             */

            if (
                this.finalizedTexts.size > 1000
            ) {

                const first =
                    this.finalizedTexts
                        .values()
                        .next()
                        .value;

                this.finalizedTexts.delete(
                    first
                );
            }


            if (
                typeof this.onSegment ===
                "function"
            ) {

                try {

                    this.onSegment(
                        segment
                    );

                } catch (error) {

                    global.SumrizeLogger?.error(
                        "onSegment callback failed:",
                        error
                    );
                }
            }


            this.resetCurrent();
        }


        resetCurrent() {

            this.currentSpeaker = null;
            this.currentText = "";
            this.startedAt = null;


            if (this.silenceTimer) {

                clearTimeout(
                    this.silenceTimer
                );

                this.silenceTimer = null;
            }
        }


        async flush() {

            this.finalize();
        }


        reset() {

            this.resetCurrent();

            this.sequence = 0;

            this.finalizedTexts.clear();
        }
    }


    global.SumrizeTranscriptBuffer =
        SumrizeTranscriptBuffer;


})(window);