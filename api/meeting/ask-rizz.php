<?php

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/response.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sumrize_error(
        'method_not_allowed',
        'Method POST diperlukan.',
        405
    );
}

try {

    // =========================
    // AUTH
    // =========================
    $user = sumrize_authenticate();

    // =========================
    // BODY
    // =========================
    $body = json_decode(
        file_get_contents('php://input'),
        true
    );

    if (!is_array($body)) {
        sumrize_error(
            'invalid_json',
            'Request body harus berupa JSON.',
            422
        );
    }

    $meetingSessionId = trim(
        $body['meetingSessionId'] ?? ''
    );

    $question = trim(
        $body['question'] ?? ''
    );

    if ($meetingSessionId === '') {
        sumrize_error(
            'missing_meeting_session_id',
            'meetingSessionId wajib diisi.',
            422
        );
    }

    if ($question === '') {
        sumrize_error(
            'missing_question',
            'Question wajib diisi.',
            422
        );
    }

    // =========================
    // DATABASE
    // =========================
    $pdo = sumrize_db();

    // Pastikan meeting milik user
    $meeting = sumrize_assert_owns_session(
        $pdo,
        $meetingSessionId,
        (int) $user['user_id']
    );

    // =========================
    // AMBIL TRANSCRIPT
    // =========================
    $stmt = $pdo->prepare("
        SELECT
            speaker,
            text,
            sequence
        FROM transcripts
        WHERE meeting_session_id = ?
        ORDER BY sequence ASC, id ASC
    ");

    $stmt->execute([
        $meetingSessionId
    ]);

    $transcripts = $stmt->fetchAll();

    // =========================
    // CEK TRANSCRIPT
    // =========================
    if (count($transcripts) === 0) {

        sumrize_success([
            'meetingSessionId' => $meetingSessionId,
            'question' => $question,
            'answer' => 'Belum ada transcript pada meeting ini.',
            'transcriptCount' => 0
        ]);
    }

    // =========================
    // BUAT CONTEXT
    // =========================
    $context = [];

    foreach ($transcripts as $transcript) {

        $speaker = $transcript['speaker'] ?: 'Unknown';
        $text = $transcript['text'];

        $context[] = "[{$speaker}] {$text}";
    }

    // =========================
    // SEMENTARA TANPA AI
    // =========================
    $answer =
        "Transcript berhasil ditemukan. " .
        "Saat ini AI Processor belum dihubungkan. " .
        "Jumlah transcript: " . count($transcripts) . " segment.";

    // =========================
    // RESPONSE
    // =========================
    sumrize_success([
        'meetingSessionId' => $meetingSessionId,
        'question' => $question,
        'answer' => $answer,
        'transcriptCount' => count($transcripts),
        'context' => $context
    ]);

} catch (PDOException $e) {

    sumrize_error(
        'database_error',
        'Gagal memproses Ask Rizz: ' . $e->getMessage(),
        500
    );

} catch (Throwable $e) {

    sumrize_error(
        'server_error',
        'Terjadi kesalahan server: ' . $e->getMessage(),
        500
    );
}