<?php

/**
 * json-exporter.php
 *
 * Menyimpan hasil transkripsi ke folder /hasiltranscribe
 * dalam format JSON lengkap dengan username dan kalimat.
 */

require_once __DIR__ . '/db.php';

function sumrize_export_transcripts_json(
    PDO $pdo,
    string $meetingSessionId
): ?array {
    if (trim($meetingSessionId) === '') {
        return null;
    }

    // 1. Ambil info meeting session
    $stmt = $pdo->prepare("
        SELECT id, external_meeting_code, title, started_at, ended_at, status
        FROM meeting_sessions
        WHERE id = ?
        LIMIT 1
    ");
    $stmt->execute([$meetingSessionId]);
    $session = $stmt->fetch(PDO::FETCH_ASSOC);

    // 2. Ambil seluruh transkrip yang berurutan
    $stmt = $pdo->prepare("
        SELECT speaker, text, timestamp_seconds, sequence, created_at
        FROM transcripts
        WHERE meeting_session_id = ?
        ORDER BY sequence ASC, id ASC
    ");
    $stmt->execute([$meetingSessionId]);
    $rawTranscripts = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (!$rawTranscripts) {
        $rawTranscripts = [];
    }

    // 3. Format transkrip dengan field 'username' dan 'kalimat'
    $formattedTranscripts = [];
    $percakapanGabungan = [];

    // Penggabungan kalimat jika pembicara sama secara berurutan
    $mergedTurns = [];
    $currentTurn = null;

    foreach ($rawTranscripts as $row) {
        $speaker = trim((string) ($row['speaker'] ?? 'Unknown'));
        $text = trim((string) ($row['text'] ?? ''));

        if ($text === '') {
            continue;
        }

        $formattedItem = [
            'username'          => $speaker,
            'kalimat'           => $text,
            'timestamp_seconds' => $row['timestamp_seconds'] !== null ? (int) $row['timestamp_seconds'] : null,
            'sequence'          => (int) ($row['sequence'] ?? 0),
            'created_at'        => $row['created_at'] ?? null,
        ];
        $formattedTranscripts[] = $formattedItem;

        // Susun percakapan baris per baris
        $percakapanGabungan[] = "{$speaker}: {$text}";

        // Gabungkan kalimat berurutan dari user yang sama untuk turn dialog
        if ($currentTurn === null) {
            $currentTurn = [
                'username'   => $speaker,
                'kalimat'    => $text,
                'started_at' => $row['created_at'] ?? null,
                'sequence'   => (int) ($row['sequence'] ?? 0)
            ];
        } elseif ($currentTurn['username'] === $speaker) {
            // Sambungkan kalimat dengan spasi
            $currentTurn['kalimat'] .= ' ' . $text;
        } else {
            // Pembicara berbeda -> simpan giliran bicara sebelumnya
            $mergedTurns[] = $currentTurn;
            $currentTurn = [
                'username'   => $speaker,
                'kalimat'    => $text,
                'started_at' => $row['created_at'] ?? null,
                'sequence'   => (int) ($row['sequence'] ?? 0)
            ];
        }
    }

    if ($currentTurn !== null) {
        $mergedTurns[] = $currentTurn;
    }

    $meetCode = $session['external_meeting_code'] ?? null;
    $now = date('Y-m-d H:i:s');

    $exportData = [
        'meeting_session_id' => $meetingSessionId,
        'meet_code'          => $meetCode,
        'title'              => $session['title'] ?? "Google Meet - {$meetCode}",
        'status'             => $session['status'] ?? 'capturing',
        'started_at'         => $session['started_at'] ?? null,
        'last_updated'       => $now,
        'total_transcripts'  => count($formattedTranscripts),
        'total_turns'        => count($mergedTurns),
        // Item detail setiap potongan transkripsi (username, kalimat)
        'transcripts'        => $formattedTranscripts,
        // Dialog yang sudah digabungkan per giliran pembicara
        'dialog_tergabung'   => $mergedTurns,
        // Teks percakapan lengkap baris per baris
        'percakapan_gabungan' => $percakapanGabungan
    ];

    // 4. Pastikan direktori hasiltranscribe ada dan writable
    $targetDir = realpath(__DIR__ . '/../../hasiltranscribe');
    if (!$targetDir) {
        $targetDir = __DIR__ . '/../../hasiltranscribe';
    }

    if (!is_dir($targetDir)) {
        @mkdir($targetDir, 0777, true);
    }

    $jsonString = json_encode(
        $exportData,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );

    if ($jsonString === false) {
        return null;
    }

    // 5. Tulis ke file JSON
    $safeSession = preg_replace('/[^a-zA-Z0-9_-]/', '', $meetingSessionId);
    $sessionFile = $targetDir . DIRECTORY_SEPARATOR . "meeting_{$safeSession}.json";
    @file_put_contents($sessionFile, $jsonString);
    @chmod($sessionFile, 0666);

    if ($meetCode) {
        $safeMeetCode = preg_replace('/[^a-zA-Z0-9_-]/', '', $meetCode);
        $codeFile = $targetDir . DIRECTORY_SEPARATOR . "meet_{$safeMeetCode}.json";
        @file_put_contents($codeFile, $jsonString);
        @chmod($codeFile, 0666);
    }

    $latestFile = $targetDir . DIRECTORY_SEPARATOR . "latest_transcribe.json";
    @file_put_contents($latestFile, $jsonString);
    @chmod($latestFile, 0666);

    return [
        'saved_to' => [
            $sessionFile,
            $latestFile
        ],
        'total' => count($formattedTranscripts)
    ];
}
