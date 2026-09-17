<?php

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/response.php';

if (!function_exists('sumrize_uuid')) {
    require_once __DIR__ . '/uuid.php';
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sumrize_error(
        'method_not_allowed',
        'Method POST diperlukan.',
        405
    );
}

try {

    /*
    |--------------------------------------------------------------------------
    | 1. AUTHENTICATION
    |--------------------------------------------------------------------------
    */

    $authUser = sumrize_authenticate();

    if (
        !is_array($authUser) ||
        !isset($authUser['user_id'])
    ) {
        sumrize_error(
            'unauthorized',
            'User tidak terautentikasi.',
            401
        );
    }

    // sumrize_authenticate() mengembalikan array user.
    // Ambil user_id saja untuk proses meeting session.
    $userId = (int) $authUser['user_id'];

    /*
    |--------------------------------------------------------------------------
    | 2. READ REQUEST BODY
    |--------------------------------------------------------------------------
    */

    $rawBody = file_get_contents('php://input');
    $body = json_decode($rawBody, true);

    if (!is_array($body)) {
        sumrize_error(
            'invalid_json',
            'Request body harus berupa JSON.',
            422
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 3. REQUEST DATA
    |--------------------------------------------------------------------------
    */

    $connectorSlug = trim(
        (string)($body['connector'] ?? '')
    );

    $meetCode = trim(
        (string)($body['meetCode'] ?? '')
    );

    $title = trim(
        (string)($body['title'] ?? '')
    );

    /*
    |--------------------------------------------------------------------------
    | 4. DEBUG LOG
    |--------------------------------------------------------------------------
    */

    error_log(
        '[Sumrize] CREATE SESSION DEBUG | ' .
        'userId=' . var_export($userId, true) .
        ' | connector=' . var_export($connectorSlug, true) .
        ' | meetCode=' . var_export($meetCode, true) .
        ' | title=' . var_export($title, true)
    );

    /*
    |--------------------------------------------------------------------------
    | 5. VALIDATION
    |--------------------------------------------------------------------------
    */

    if ($connectorSlug === '') {
        sumrize_error(
            'missing_connector',
            'Connector wajib diisi.',
            422
        );
    }

    if ($title === '') {
        sumrize_error(
            'missing_title',
            'Title meeting wajib diisi.',
            422
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 6. DATABASE
    |--------------------------------------------------------------------------
    */

    $pdo = sumrize_db();

    /*
    |--------------------------------------------------------------------------
    | 7. FIND CONNECTOR + USER CONNECTION
    |--------------------------------------------------------------------------
    */

    $stmt = $pdo->prepare("
        SELECT
            c.id,
            c.slug,
            c.name,
            c.type,
            c.status AS connector_status,
            cc.id AS connection_id,
            cc.user_id,
            cc.status AS connection_status
        FROM connectors c
        INNER JOIN connector_connections cc
            ON cc.connector_id = c.id
            AND cc.user_id = ?
        WHERE c.slug = ?
        LIMIT 1
    ");

    $stmt->execute([
        $userId,
        $connectorSlug
    ]);

    $connector = $stmt->fetch(PDO::FETCH_ASSOC);

    /*
    |--------------------------------------------------------------------------
    | 8. CONNECTOR NOT FOUND
    |--------------------------------------------------------------------------
    */

    if (!$connector) {

        error_log(
            '[Sumrize] CREATE SESSION DEBUG | ' .
            'connector connection NOT FOUND | ' .
            'userId=' . var_export($userId, true) .
            ' | connector=' . var_export($connectorSlug, true)
        );

        sumrize_error(
            'connector_not_connected',
            'Connector belum terhubung untuk user ini.',
            409
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 9. CONNECTOR DEBUG
    |--------------------------------------------------------------------------
    */

    error_log(
        '[Sumrize] CREATE SESSION DEBUG | ' .
        'connectorId=' . var_export(
            $connector['id'],
            true
        ) .
        ' | connectionId=' . var_export(
            $connector['connection_id'],
            true
        ) .
        ' | connectorStatus=' . var_export(
            $connector['connector_status'],
            true
        ) .
        ' | connectionStatus=' . var_export(
            $connector['connection_status'],
            true
        )
    );

    /*
    |--------------------------------------------------------------------------
    | 10. CHECK CONNECTOR STATUS
    |--------------------------------------------------------------------------
    */

    if ($connector['connector_status'] !== 'active') {

        sumrize_error(
            'connector_inactive',
            'Connector Google Meet sedang tidak aktif.',
            409
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 11. CHECK USER CONNECTION
    |--------------------------------------------------------------------------
    */

    if ($connector['connection_status'] !== 'connected') {

        sumrize_error(
            'connector_not_connected',
            'Google Meet belum terhubung untuk user ini.',
            409
        );
    }

    /*
    |--------------------------------------------------------------------------
    | 12. CREATE MEETING SESSION ID
    |--------------------------------------------------------------------------
    */

    $meetingSessionId = sumrize_new_meeting_session_id();

    /*
    |--------------------------------------------------------------------------
    | 13. CURRENT TIME
    |--------------------------------------------------------------------------
    */

    $now = new DateTime(
        'now',
        new DateTimeZone('Asia/Jakarta')
    );

    $now = $now->format('Y-m-d H:i:s');

    /*
    |--------------------------------------------------------------------------
    | 14. INSERT MEETING SESSION
    |--------------------------------------------------------------------------
    */

    $stmt = $pdo->prepare("
        INSERT INTO meeting_sessions (
            id,
            user_id,
            connector_id,
            title,
            external_meeting_code,
            summary,
            started_at,
            ended_at,
            duration,
            status,
            created_at,
            updated_at
        )
        VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            NULL,
            ?,
            NULL,
            NULL,
            'capturing',
            ?,
            ?
        )
    ");

    $stmt->execute([
        $meetingSessionId,
        $userId,
        $connector['id'],
        $title,
        $meetCode !== '' ? $meetCode : null,
        $now,
        $now,
        $now
    ]);

    /*
    |--------------------------------------------------------------------------
    | 15. SUCCESS LOG
    |--------------------------------------------------------------------------
    */

    error_log(
        '[Sumrize] CREATE SESSION SUCCESS | ' .
        'meetingSessionId=' . $meetingSessionId .
        ' | userId=' . $userId .
        ' | connectorId=' . $connector['id']
    );

    /*
    |--------------------------------------------------------------------------
    | 16. RESPONSE
    |--------------------------------------------------------------------------
    */

    sumrize_success([
        'meetingSessionId' => $meetingSessionId,
        'status' => 'capturing',
        'connector' => $connector['slug']
    ], 201);

} catch (Throwable $e) {

    error_log(
        '[Sumrize] CREATE MEETING SESSION ERROR: ' .
        $e->getMessage() .
        ' | FILE: ' .
        $e->getFile() .
        ' | LINE: ' .
        $e->getLine()
    );

    sumrize_error(
        'create_meeting_session_failed',
        'Gagal membuat meeting session: ' .
        $e->getMessage(),
        500
    );
}