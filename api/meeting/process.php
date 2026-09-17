<?php

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/response.php';
require_once __DIR__ . '/ai-processor.php';


try {

    /*
     * =========================================================
     * 1. Database
     * =========================================================
     */

    $pdo = sumrize_db();


    /*
     * =========================================================
     * 2. Authentication
     * =========================================================
     */

    $user = sumrize_authenticate(
        $pdo
    );


    /*
     * =========================================================
     * 3. Request Body
     * =========================================================
     */

    $body = json_decode(
        file_get_contents('php://input'),
        true
    );

    if (!is_array($body)) {

        sumrize_error(
            'invalid_json',
            'Request body harus berupa JSON.',
            400
        );

        exit;
    }


    /*
     * =========================================================
     * 4. Meeting Session ID
     * =========================================================
     */

    $meetingSessionId =
        trim(
            $body['meetingSessionId']
            ?? ''
        );

    if ($meetingSessionId === '') {

        sumrize_error(
            'missing_meeting_session_id',
            'Parameter meetingSessionId wajib diisi.',
            400
        );

        exit;
    }


    /*
     * =========================================================
     * 5. Pastikan Meeting milik User
     * =========================================================
     */

    sumrize_assert_owns_session(
        $pdo,
        $meetingSessionId,
        (int) $user
    );


    /*
     * =========================================================
     * 6. Jalankan AI Processing
     * =========================================================
     */

    $result =
        sumrize_process_meeting(
            $pdo,
            $meetingSessionId
        );


    /*
     * =========================================================
     * 7. Response
     * =========================================================
     */

    sumrize_success(
        $result
    );


} catch (Throwable $e) {

    sumrize_error(
        'server_error',
        $e->getMessage(),
        500
    );
}