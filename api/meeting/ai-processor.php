<?php

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/ollama.php';


/**
 * Process Meeting
 *
 * Alur:
 *
 * Meeting Session
 *      ↓
 * Transcript
 *      ↓
 * Ollama / Qwen3
 *      ↓
 * Summary
 * Action Items
 * Decisions
 * Follow Ups
 *      ↓
 * Database
 */

function sumrize_process_meeting(
    PDO $pdo,
    string $meetingSessionId
): array {

    /*
     * =========================================================
     * 1. Ambil Meeting Session
     * =========================================================
     */

    $stmt = $pdo->prepare("
        SELECT *
        FROM meeting_sessions
        WHERE id = ?
        LIMIT 1
    ");

    $stmt->execute([
        $meetingSessionId
    ]);

    $meeting = $stmt->fetch(
        PDO::FETCH_ASSOC
    );

    if (!$meeting) {

        throw new Exception(
            'Meeting session tidak ditemukan.'
        );
    }


    /*
     * =========================================================
     * 2. Ambil Transcript
     * =========================================================
     */

    $stmt = $pdo->prepare("
        SELECT
            speaker,
            text,
            timestamp_seconds,
            sequence
        FROM transcripts
        WHERE meeting_session_id = ?
        ORDER BY sequence ASC
    ");

    $stmt->execute([
        $meetingSessionId
    ]);

    $transcripts = $stmt->fetchAll(
        PDO::FETCH_ASSOC
    );


    /*
     * =========================================================
     * 3. Jika Transcript Kosong
     * =========================================================
     */

    if (!$transcripts) {

        $stmt = $pdo->prepare("
            UPDATE meeting_sessions
            SET
                status = 'empty_transcript',
                updated_at = NOW()
            WHERE id = ?
        ");

        $stmt->execute([
            $meetingSessionId
        ]);

        return [
            'status' => 'empty_transcript',

            'summary' => null,

            'action_items' => [],

            'decisions' => [],

            'follow_ups' => []
        ];
    }


    /*
     * =========================================================
     * 4. Gabungkan Transcript
     * =========================================================
     */

    $transcriptText = '';

    foreach ($transcripts as $row) {

        $speaker = trim(
            $row['speaker'] ?? ''
        );

        $text = trim(
            $row['text'] ?? ''
        );

        if ($speaker === '') {
            $speaker = 'Unknown';
        }

        if ($text === '') {
            continue;
        }

        $transcriptText .=
            '[' .
            $speaker .
            '] ' .
            $text .
            "\n";
    }


    if (trim($transcriptText) === '') {

        $stmt = $pdo->prepare("
            UPDATE meeting_sessions
            SET
                status = 'empty_transcript',
                updated_at = NOW()
            WHERE id = ?
        ");

        $stmt->execute([
            $meetingSessionId
        ]);

        return [
            'status' => 'empty_transcript',
            'summary' => null,
            'action_items' => [],
            'decisions' => [],
            'follow_ups' => []
        ];
    }


    /*
     * =========================================================
     * 5. Ubah status menjadi processing
     * =========================================================
     */

    $stmt = $pdo->prepare("
        UPDATE meeting_sessions
        SET
            status = 'processing',
            updated_at = NOW()
        WHERE id = ?
    ");

    $stmt->execute([
        $meetingSessionId
    ]);


    /*
     * =========================================================
     * 6. Kirim Transcript ke Ollama
     * =========================================================
     */

    try {

        $aiResult =
            sumrize_ollama_request(
                $transcriptText
            );

    } catch (Throwable $e) {

        /*
         * Jika AI gagal,
         * tandai meeting sebagai ai_failed.
         */

        $stmt = $pdo->prepare("
            UPDATE meeting_sessions
            SET
                status = 'ai_failed',
                updated_at = NOW()
            WHERE id = ?
        ");

        $stmt->execute([
            $meetingSessionId
        ]);

        throw $e;
    }


    /*
     * =========================================================
     * 7. Ambil hasil AI
     * =========================================================
     */

    $summary =
        $aiResult['summary'] ?? '';

    $actionItems =
        $aiResult['action_items'] ?? [];

    $decisions =
        $aiResult['decisions'] ?? [];

    $followUps =
        $aiResult['follow_ups'] ?? [];


    /*
     * =========================================================
     * 8. Simpan hasil AI ke Database
     * =========================================================
     */

    try {

        $pdo->beginTransaction();


        /*
         * -----------------------------------------------------
         * Update Meeting Summary
         * -----------------------------------------------------
         */

        $stmt = $pdo->prepare("
            UPDATE meeting_sessions
            SET
                summary = ?,
                status = 'completed',
                updated_at = NOW()
            WHERE id = ?
        ");

        $stmt->execute([
            $summary,
            $meetingSessionId
        ]);


        /*
         * -----------------------------------------------------
         * Hapus hasil AI sebelumnya
         *
         * Ini berguna jika meeting diproses ulang.
         * -----------------------------------------------------
         */

        $stmt = $pdo->prepare("
            DELETE FROM action_items
            WHERE meeting_session_id = ?
        ");

        $stmt->execute([
            $meetingSessionId
        ]);


        $stmt = $pdo->prepare("
            DELETE FROM decisions
            WHERE meeting_session_id = ?
        ");

        $stmt->execute([
            $meetingSessionId
        ]);


        $stmt = $pdo->prepare("
            DELETE FROM follow_ups
            WHERE meeting_session_id = ?
        ");

        $stmt->execute([
            $meetingSessionId
        ]);


        /*
         * -----------------------------------------------------
         * Simpan Action Items
         * -----------------------------------------------------
         */

        $stmtAction = $pdo->prepare("
            INSERT INTO action_items
            (
                id,
                meeting_session_id,
                task,
                assignee,
                deadline
            )
            VALUES
            (
                ?,
                ?,
                ?,
                ?,
                ?
            )
        ");


        foreach ($actionItems as $item) {

            if (!is_array($item)) {
                continue;
            }

            $task =
                trim(
                    (string) (
                        $item['task'] ?? ''
                    )
                );

            $assignee =
                trim(
                    (string) (
                        $item['assignee'] ?? ''
                    )
                );

            $deadline =
                trim(
                    (string) (
                        $item['deadline'] ?? ''
                    )
                );

            if ($task === '') {
                continue;
            }

            $stmtAction->execute([
                bin2hex(
                    random_bytes(16)
                ),

                $meetingSessionId,

                $task,

                $assignee,

                $deadline
            ]);
        }


        /*
         * -----------------------------------------------------
         * Simpan Decisions
         * -----------------------------------------------------
         */

        $stmtDecision = $pdo->prepare("
            INSERT INTO decisions
            (
                id,
                meeting_session_id,
                decision
            )
            VALUES
            (
                ?,
                ?,
                ?
            )
        ");


        foreach ($decisions as $item) {

            if (!is_array($item)) {
                continue;
            }

            $decision =
                trim(
                    (string) (
                        $item['decision'] ?? ''
                    )
                );

            if ($decision === '') {
                continue;
            }

            $stmtDecision->execute([
                bin2hex(
                    random_bytes(16)
                ),

                $meetingSessionId,

                $decision
            ]);
        }


        /*
         * -----------------------------------------------------
         * Simpan Follow Ups
         * -----------------------------------------------------
         */

        $stmtFollowUp = $pdo->prepare("
            INSERT INTO follow_ups
            (
                id,
                meeting_session_id,
                description
            )
            VALUES
            (
                ?,
                ?,
                ?
            )
        ");


        foreach ($followUps as $item) {

            if (!is_array($item)) {
                continue;
            }

            $description =
                trim(
                    (string) (
                        $item['description'] ?? ''
                    )
                );

            if ($description === '') {
                continue;
            }

            $stmtFollowUp->execute([
                bin2hex(
                    random_bytes(16)
                ),

                $meetingSessionId,

                $description
            ]);
        }


        /*
         * -----------------------------------------------------
         * Commit
         * -----------------------------------------------------
         */

        $pdo->commit();


    } catch (Throwable $e) {

        if (
            $pdo->inTransaction()
        ) {
            $pdo->rollBack();
        }

        /*
         * Jika penyimpanan hasil AI gagal,
         * tandai sebagai ai_failed.
         */

        $stmt = $pdo->prepare("
            UPDATE meeting_sessions
            SET
                status = 'ai_failed',
                updated_at = NOW()
            WHERE id = ?
        ");

        $stmt->execute([
            $meetingSessionId
        ]);

        throw $e;
    }


    /*
     * =========================================================
     * 9. Return Response
     * =========================================================
     */

    return [
        'status' => 'completed',

        'summary' => $summary,

        'action_items' => $actionItems,

        'decisions' => $decisions,

        'follow_ups' => $followUps
    ];
}