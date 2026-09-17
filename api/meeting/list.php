<?php

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/response.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sumrize_error(
        'method_not_allowed',
        'Method GET diperlukan.',
        405
    );
}

$user = sumrize_authenticate();

$pdo = sumrize_db();

$stmt = $pdo->prepare("
    SELECT
        ms.id,
        ms.title,
        ms.external_meeting_code,
        ms.started_at,
        ms.ended_at,
        ms.duration,
        ms.status,
        ms.created_at,
        c.slug AS connector,
        c.name AS connector_name
    FROM meeting_sessions ms
    INNER JOIN connectors c
        ON c.id = ms.connector_id
    WHERE ms.user_id = ?
    ORDER BY ms.started_at DESC
");

$stmt->execute([
    $user['user_id']
]);

$meetings = $stmt->fetchAll();

sumrize_success([
    'items' => $meetings,
    'count' => count($meetings)
]);