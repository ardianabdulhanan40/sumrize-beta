<?php
/**
 * save-local.php
 * Endpoint penyimpanan transkrip instan ke folder hasiltranscribe/
 * Format: { username, kalimat, ... }
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method POST required']);
    exit;
}

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);

if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid JSON body']);
    exit;
}

$meetingSessionId = trim((string)($body['meetingSessionId'] ?? $body['meeting_session_id'] ?? 'local_session'));
$meetCode = trim((string)($body['meetCode'] ?? $body['meet_code'] ?? ''));
$speaker = trim((string)($body['speaker'] ?? $body['username'] ?? 'Unknown'));
$text = trim((string)($body['text'] ?? $body['kalimat'] ?? ''));
$timestamp = trim((string)($body['timestamp'] ?? date('Y-m-d H:i:s')));
$sequence = (int)($body['sequence'] ?? 0);

if ($text === '') {
    echo json_encode(['ok' => true, 'skipped' => true, 'reason' => 'Empty text']);
    exit;
}

$targetDir = realpath(__DIR__ . '/../../hasiltranscribe') ?: (__DIR__ . '/../../hasiltranscribe');
if (!is_dir($targetDir)) {
    @mkdir($targetDir, 0777, true);
}

$safeSession = preg_replace('/[^a-zA-Z0-9_-]/', '', $meetingSessionId) ?: 'current';
$sessionFile = $targetDir . DIRECTORY_SEPARATOR . "meeting_{$safeSession}.json";
$latestFile = $targetDir . DIRECTORY_SEPARATOR . "latest_transcribe.json";

// Baca data yang sudah ada di session file jika ada
$existingData = [
    'meeting_session_id' => $meetingSessionId,
    'meet_code' => $meetCode,
    'title' => "Google Meet - " . ($meetCode ?: $meetingSessionId),
    'status' => 'capturing',
    'started_at' => date('Y-m-d H:i:s'),
    'last_updated' => date('Y-m-d H:i:s'),
    'total_transcripts' => 0,
    'total_turns' => 0,
    'transcripts' => [],
    'dialog_tergabung' => [],
    'percakapan_gabungan' => []
];

if (is_file($sessionFile)) {
    $content = @file_get_contents($sessionFile);
    if ($content) {
        $parsed = json_decode($content, true);
        if (is_array($parsed) && isset($parsed['transcripts']) && is_array($parsed['transcripts'])) {
            $existingData = $parsed;
        }
    }
}

// Tambahkan item baru
$newTranscriptItem = [
    'username' => $speaker,
    'kalimat' => $text,
    'timestamp_seconds' => time(),
    'sequence' => $sequence > 0 ? $sequence : (count($existingData['transcripts']) + 1),
    'created_at' => $timestamp
];

$existingData['transcripts'][] = $newTranscriptItem;
$existingData['total_transcripts'] = count($existingData['transcripts']);
$existingData['last_updated'] = date('Y-m-d H:i:s');
if ($meetCode && empty($existingData['meet_code'])) {
    $existingData['meet_code'] = $meetCode;
    $existingData['title'] = "Google Meet - {$meetCode}";
}

// Rekonstruksi percakapan_gabungan & dialog_tergabung
$percakapanGabungan = [];
$mergedTurns = [];
$currentTurn = null;

foreach ($existingData['transcripts'] as $item) {
    $spk = $item['username'] ?? 'Unknown';
    $klm = $item['kalimat'] ?? '';
    if ($klm === '') continue;

    $percakapanGabungan[] = "{$spk}: {$klm}";

    if ($currentTurn === null) {
        $currentTurn = [
            'username' => $spk,
            'kalimat' => $klm,
            'started_at' => $item['created_at'] ?? date('Y-m-d H:i:s'),
            'sequence' => (int)($item['sequence'] ?? 0)
        ];
    } elseif ($currentTurn['username'] === $spk) {
        $currentTurn['kalimat'] .= ' ' . $klm;
    } else {
        $mergedTurns[] = $currentTurn;
        $currentTurn = [
            'username' => $spk,
            'kalimat' => $klm,
            'started_at' => $item['created_at'] ?? date('Y-m-d H:i:s'),
            'sequence' => (int)($item['sequence'] ?? 0)
        ];
    }
}
if ($currentTurn !== null) {
    $mergedTurns[] = $currentTurn;
}

$existingData['dialog_tergabung'] = $mergedTurns;
$existingData['total_turns'] = count($mergedTurns);
$existingData['percakapan_gabungan'] = $percakapanGabungan;

$jsonString = json_encode($existingData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

@file_put_contents($sessionFile, $jsonString);
@chmod($sessionFile, 0666);
@file_put_contents($latestFile, $jsonString);
@chmod($latestFile, 0666);

if ($meetCode) {
    $safeMeet = preg_replace('/[^a-zA-Z0-9_-]/', '', $meetCode);
    $meetFile = $targetDir . DIRECTORY_SEPARATOR . "meet_{$safeMeet}.json";
    @file_put_contents($meetFile, $jsonString);
    @chmod($meetFile, 0666);
}

echo json_encode([
    'ok' => true,
    'total' => count($existingData['transcripts']),
    'saved_to' => [$sessionFile, $latestFile]
]);
