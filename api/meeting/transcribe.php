<?php
/**
 * POST /api/meeting/transcribe.php
 * multipart/form-data:
 *   audio, meeting_session_id | meetingSessionId, sequence, timestamp
 */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/response.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sumrize_error('method_not_allowed', 'Method POST diperlukan.', 405);
}

$user = sumrize_authenticate();

$meetingSessionId = trim(
    (string) (
        $_POST['meeting_session_id']
        ?? $_POST['meetingSessionId']
        ?? ''
    )
);
$sequence  = isset($_POST['sequence']) ? (int) $_POST['sequence'] : 0;
$timestamp = trim((string) ($_POST['timestamp'] ?? ''));

if ($meetingSessionId === '') {
    sumrize_error(
        'missing_meeting_session_id',
        'meetingSessionId wajib diisi.',
        422
    );
}

if (
    empty($_FILES['audio']) ||
    $_FILES['audio']['error'] !== UPLOAD_ERR_OK
) {
    sumrize_error('missing_audio', 'File audio wajib diupload.', 422);
}

$pdo = sumrize_db();
sumrize_assert_owns_session(
    $pdo,
    $meetingSessionId,
    (int) $user['user_id']
);

$tmpDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'sumrize_audio';
if (!is_dir($tmpDir)) {
    mkdir($tmpDir, 0775, true);
}

$orig = $_FILES['audio'];
$ext  = strtolower(pathinfo($orig['name'], PATHINFO_EXTENSION) ?: 'webm');
$safe = preg_replace('/[^a-zA-Z0-9_-]/', '', $meetingSessionId);
$base = 'chunk_' . $safe . '_' . $sequence . '_' . time();
$src  = $tmpDir . DIRECTORY_SEPARATOR . $base . '.' . $ext;
$wav  = $tmpDir . DIRECTORY_SEPARATOR . $base . '.wav';

if (!move_uploaded_file($orig['tmp_name'], $src)) {
    sumrize_error('upload_failed', 'Gagal menyimpan audio.', 500);
}
$FFMPEG  = '/usr/bin/ffmpeg';
$WHISPER = '/home/yan/.local/bin/whisper';

$cmdF = sprintf(
    '%s -y -i %s -ar 16000 -ac 1 -c:a pcm_s16le %s 2>&1',
    escapeshellcmd($FFMPEG),
    escapeshellarg($src),
    escapeshellarg($wav)
);
exec($cmdF, $outF, $codeF);

$audio = ($codeF === 0 && is_file($wav)) ? $wav : $src;

$speaker = trim((string) ($_POST['speaker'] ?? $_POST['username'] ?? 'Unknown'));


$cmdW = sprintf(
    'HOME=/home/yan PATH=/home/yan/.local/bin:/usr/local/bin:/usr/bin:/bin %s %s --model tiny --language id --output_format txt --output_dir %s 2>&1',
    escapeshellcmd($WHISPER),
    escapeshellarg($audio),
    escapeshellarg($tmpDir)
);
exec($cmdW, $outW, $codeW);

$text = '';
$txt  = $tmpDir . DIRECTORY_SEPARATOR . pathinfo($audio, PATHINFO_FILENAME) . '.txt';
if (is_file($txt)) {
    $text = trim((string) file_get_contents($txt));
    @unlink($txt);
}

@unlink($src);
if (is_file($wav)) {
    @unlink($wav);
}

// Return gracefully even if whisper fails/empty, avoiding 500 loop
sumrize_success([
    'text'             => $text,
    'speaker'          => $speaker !== '' ? $speaker : 'Unknown',
    'sequence'         => $sequence,
    'meetingSessionId' => $meetingSessionId,
    'timestamp'        => $timestamp !== '' ? $timestamp : date('c')
]);