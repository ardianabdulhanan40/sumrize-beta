<?php

require_once __DIR__ . '/common.php';

$config = sumrize_google_config();
sumrize_google_start_session();

error_log('[Sumrize] Google OAuth callback received.');

/**
 * Redirect ke halaman onboarding dengan status error.
 *
 * Jangan pernah memasukkan client_secret atau token
 * ke dalam URL.
 */
function sumrize_google_callback_error(
    array $config,
    string $code,
    string $message = ''
): never {
    $query = [
        'google_oauth' => 'error',
        'code' => $code,
    ];

    if ($message !== '') {
        $query['message'] = $message;
    }

    sumrize_google_redirect(
        $config,
        '?' . http_build_query($query)
    );
}

/**
 * Redirect sukses.
 */
function sumrize_google_callback_success(
    array $config
): never {
    sumrize_google_redirect($config, '?google_connected=1');
}


/*
|--------------------------------------------------------------------------
| 1. Ambil OAuth session
|--------------------------------------------------------------------------
*/

$oauth = $_SESSION['sumrize_google_oauth'] ?? null;
$state = $_GET['state'] ?? '';

if (!is_array($oauth)) {
    sumrize_google_callback_error(
        $config,
        'oauth_session_missing',
        'OAuth session tidak ditemukan. Silakan mulai koneksi Google Meet dari awal.'
    );
}


/*
|--------------------------------------------------------------------------
| 2. Validasi state
|--------------------------------------------------------------------------
*/

$sessionState = (string) ($oauth['state'] ?? '');

if (
    $sessionState === '' ||
    $state === '' ||
    !hash_equals($sessionState, (string) $state)
) {
    unset($_SESSION['sumrize_google_oauth']);

    sumrize_google_callback_error(
        $config,
        'invalid_state',
        'OAuth state tidak valid.'
    );
}

error_log('[Sumrize] Google OAuth state validated.');


/*
|--------------------------------------------------------------------------
| 3. Cek expiration state
|--------------------------------------------------------------------------
*/

if (($oauth['expires_at'] ?? 0) < time()) {
    unset($_SESSION['sumrize_google_oauth']);

    sumrize_google_callback_error(
        $config,
        'state_expired',
        'Sesi koneksi Google sudah kedaluwarsa. Silakan coba lagi.'
    );
}


/*
|--------------------------------------------------------------------------
| 4. Tangani error dari Google
|--------------------------------------------------------------------------
*/

if (isset($_GET['error'])) {
    $googleError = (string) $_GET['error'];
    $googleDescription = (string) (
        $_GET['error_description'] ?? ''
    );

    unset($_SESSION['sumrize_google_oauth']);

    error_log(
        '[Sumrize] Google OAuth authorization error: ' .
        $googleError .
        ($googleDescription !== ''
            ? ' - ' . $googleDescription
            : '')
    );

    if ($googleError === 'access_denied') {
        sumrize_google_callback_error(
            $config,
            'access_denied',
            'Akses Google ditolak atau akun belum diizinkan untuk menggunakan aplikasi.'
        );
    }

    sumrize_google_callback_error(
        $config,
        'authorization_failed',
        $googleDescription !== ''
            ? $googleDescription
            : 'Google OAuth authorization gagal.'
    );
}


/*
|--------------------------------------------------------------------------
| 5. Ambil authorization code
|--------------------------------------------------------------------------
*/

$code = trim((string) ($_GET['code'] ?? ''));

if ($code === '') {
    unset($_SESSION['sumrize_google_oauth']);

    sumrize_google_callback_error(
        $config,
        'missing_authorization_code',
        'Authorization code dari Google tidak ditemukan.'
    );
}

error_log('[Sumrize] Google authorization code received.');


/*
|--------------------------------------------------------------------------
| 6. Validasi konfigurasi Google
|--------------------------------------------------------------------------
*/

if (
    empty($config['client_id']) ||
    empty($config['client_secret']) ||
    empty($config['redirect_uri'])
) {
    unset($_SESSION['sumrize_google_oauth']);

    error_log(
        '[Sumrize] Google OAuth configuration incomplete.'
    );

    sumrize_google_callback_error(
        $config,
        'google_config_missing',
        'Konfigurasi Google OAuth belum lengkap.'
    );
}


/*
|--------------------------------------------------------------------------
| 7. Tukar authorization code menjadi token
|--------------------------------------------------------------------------
|
| Kita lakukan request secara eksplisit agar error dari Google
| dapat dibaca dengan jelas.
|
*/

try {

    error_log('[Sumrize] Google token exchange started.');

    $tokenUrl = 'https://oauth2.googleapis.com/token';

    $postData = http_build_query([
        'code' => $code,
        'client_id' => $config['client_id'],
        'client_secret' => $config['client_secret'],
        'redirect_uri' => $config['redirect_uri'],
        'grant_type' => 'authorization_code',
    ]);

    $ch = curl_init($tokenUrl);

    if ($ch === false) {
        throw new RuntimeException(
            'Gagal menginisialisasi cURL.'
        );
    }

    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,

        CURLOPT_HTTPHEADER => [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: application/json',
        ],

        CURLOPT_POSTFIELDS => $postData,

        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 30,

        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    $tokenResponse = curl_exec($ch);

    $curlError = curl_error($ch);
    $curlErrno = curl_errno($ch);

    $httpCode = (int) curl_getinfo(
        $ch,
        CURLINFO_HTTP_CODE
    );

    curl_close($ch);


    /*
    |--------------------------------------------------------------------------
    | cURL error
    |--------------------------------------------------------------------------
    */

    if ($tokenResponse === false) {

        error_log(
            '[Sumrize] Google token request cURL error (' .
            $curlErrno .
            '): ' .
            $curlError
        );

        unset($_SESSION['sumrize_google_oauth']);

        sumrize_google_callback_error(
            $config,
            'token_request_failed',
            'Gagal menghubungi Google OAuth server.'
        );
    }


    /*
    |--------------------------------------------------------------------------
    | Decode response Google
    |--------------------------------------------------------------------------
    */

    $token = json_decode(
        $tokenResponse,
        true
    );


    if (!is_array($token)) {

        error_log(
            '[Sumrize] Google token response is not valid JSON. HTTP ' .
            $httpCode .
            '. Response: ' .
            substr($tokenResponse, 0, 1000)
        );

        unset($_SESSION['sumrize_google_oauth']);

        sumrize_google_callback_error(
            $config,
            'invalid_token_response',
            'Respons token dari Google tidak valid.'
        );
    }


    /*
    |--------------------------------------------------------------------------
    | Google mengembalikan OAuth error
    |--------------------------------------------------------------------------
    */

    if (
        $httpCode !== 200 ||
        isset($token['error'])
    ) {

        $googleError = (string) (
            $token['error'] ?? 'token_exchange_failed'
        );

        $googleDescription = (string) (
            $token['error_description'] ??
            'Google gagal menukar authorization code menjadi token.'
        );

        error_log(
            '[Sumrize] Google token exchange failed. ' .
            'HTTP=' . $httpCode .
            ' error=' . $googleError .
            ' description=' . $googleDescription
        );

        unset($_SESSION['sumrize_google_oauth']);


        /*
        |--------------------------------------------------------------------------
        | invalid_grant
        |--------------------------------------------------------------------------
        |
        | Biasanya authorization code sudah expired / sudah digunakan
        | / redirect_uri atau client tidak cocok.
        |
        */

        if ($googleError === 'invalid_grant') {
            sumrize_google_callback_error(
                $config,
                'invalid_grant',
                'Authorization code Google tidak valid atau sudah digunakan. Silakan mulai koneksi Google dari awal.'
            );
        }

        $safeErrorCodes = [
            'invalid_client',
            'redirect_uri_mismatch',
            'invalid_request',
            'unauthorized_client'
        ];

        $browserErrorCode = in_array(
            $googleError,
            $safeErrorCodes,
            true
        )
            ? $googleError
            : 'token_exchange_failed';

        sumrize_google_callback_error(
            $config,
            $browserErrorCode,
            $googleDescription
        );
    }

    error_log('[Sumrize] Google token exchange successful.');


    /*
    |--------------------------------------------------------------------------
    | 8. Pastikan access token tersedia
    |--------------------------------------------------------------------------
    */

    $accessToken = trim(
        (string) ($token['access_token'] ?? '')
    );

    if ($accessToken === '') {

        error_log(
            '[Sumrize] Google OAuth response tidak memiliki access_token.'
        );

        unset($_SESSION['sumrize_google_oauth']);

        sumrize_google_callback_error(
            $config,
            'access_token_missing',
            'Google tidak mengembalikan access token.'
        );
    }


    /*
    |--------------------------------------------------------------------------
    | 9. Ambil informasi akun Google
    |--------------------------------------------------------------------------
    */

    $googleAccount = [];

    try {

        $googleAccount = sumrize_google_http_json(
            'https://openidconnect.googleapis.com/v1/userinfo',
            'GET',
            null,
            'Bearer ' . $accessToken
        );

        if (!is_array($googleAccount)) {
            $googleAccount = [];
        }

    } catch (Throwable $accountError) {

        /*
         * Userinfo bukan bagian yang wajib untuk menyelesaikan
         * token exchange. Jadi kalau gagal, kita tetap lanjut.
         */

        error_log(
            '[Sumrize] Google userinfo request failed: ' .
            $accountError->getMessage()
        );

        $googleAccount = [];
    }

    error_log('[Sumrize] Google account retrieved.');


    /*
    |--------------------------------------------------------------------------
    | 10. Ambil database
    |--------------------------------------------------------------------------
    */

    $pdo = sumrize_db();

    error_log('[Sumrize] Google database connection started.');

    $connector = sumrize_google_connector($pdo);

    error_log(
        '[Sumrize] Google connector found. connector_id=' .
        $connector['id']
    );

    $key = sumrize_google_require_encryption_key(
        $config
    );

    $userId = (int) ($oauth['user_id'] ?? 0);

    if ($userId <= 0) {

        unset($_SESSION['sumrize_google_oauth']);

        sumrize_google_callback_error(
            $config,
            'invalid_user',
            'User Sumrize tidak ditemukan.'
        );
    }


    /*
    |--------------------------------------------------------------------------
    | 11. Ambil koneksi Google yang sudah ada
    |--------------------------------------------------------------------------
    |
    | Dibutuhkan agar refresh token lama dapat dipertahankan
    | jika Google tidak mengirim refresh_token baru.
    |
    */

    $existingStmt = $pdo->prepare("
        SELECT
            refresh_token_encrypted
        FROM connector_connections
        WHERE user_id = ?
          AND connector_id = ?
        LIMIT 1
    ");

    $existingStmt->execute([
        $userId,
        $connector['id'],
    ]);

    $existing = $existingStmt->fetch(
        PDO::FETCH_ASSOC
    );


    /*
    |--------------------------------------------------------------------------
    | 12. Simpan refresh token
    |--------------------------------------------------------------------------
    */

    $refreshToken = trim(
        (string) ($token['refresh_token'] ?? '')
    );

    if ($refreshToken !== '') {

        $encryptedRefreshToken =
            sumrize_google_encrypt(
                $refreshToken,
                $key
            );

    } else {

        /*
         * Google dapat tidak mengirim refresh_token
         * pada reconnect jika consent sebelumnya sudah ada.
         */

        $encryptedRefreshToken =
            $existing['refresh_token_encrypted'] ?? null;
    }


    /*
    |--------------------------------------------------------------------------
    | Refresh token wajib
    |--------------------------------------------------------------------------
    */

    if (!$encryptedRefreshToken) {

        error_log(
            '[Sumrize] Google refresh token missing. ' .
            'User needs to reconnect with consent.'
        );

        unset($_SESSION['sumrize_google_oauth']);

        sumrize_google_callback_error(
            $config,
            'refresh_token_missing',
            'Refresh token Google tidak tersedia. Silakan hubungkan Google Meet kembali.'
        );
    }


    /*
    |--------------------------------------------------------------------------
    | 13. Encrypt access token
    |--------------------------------------------------------------------------
    */

    $encryptedAccessToken =
        sumrize_google_encrypt(
            $accessToken,
            $key
        );


    /*
    |--------------------------------------------------------------------------
    | 14. Hitung expiration access token
    |--------------------------------------------------------------------------
    */

    $expiresIn = max(
        0,
        (int) ($token['expires_in'] ?? 3600)
    );

    $expiresAt = date(
        'Y-m-d H:i:s',
        time() + $expiresIn
    );


    /*
    |--------------------------------------------------------------------------
    | 15. Data akun Google
    |--------------------------------------------------------------------------
    */

    $externalAccountId =
        !empty($googleAccount['sub'])
            ? (string) $googleAccount['sub']
            : null;

    $externalEmail =
        !empty($googleAccount['email'])
            ? (string) $googleAccount['email']
            : null;


    /*
    |--------------------------------------------------------------------------
    | 16. Simpan connector connection
    |--------------------------------------------------------------------------
    */

    $stmt = $pdo->prepare("
        INSERT INTO connector_connections (
            user_id,
            connector_id,
            external_account_id,
            external_email,
            access_token_encrypted,
            refresh_token_encrypted,
            token_expires_at,
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
            ?,
            ?,
            'connected',
            NOW(),
            NOW()
        )
        ON DUPLICATE KEY UPDATE
            external_account_id =
                VALUES(external_account_id),

            external_email =
                VALUES(external_email),

            access_token_encrypted =
                VALUES(access_token_encrypted),

            refresh_token_encrypted =
                VALUES(refresh_token_encrypted),

            token_expires_at =
                VALUES(token_expires_at),

            status =
                'connected',

            updated_at =
                NOW()
    ");


    $stmt->execute([
        $userId,
        $connector['id'],
        $externalAccountId,
        $externalEmail,
        $encryptedAccessToken,
        $encryptedRefreshToken,
        $expiresAt,
    ]);

    error_log('[Sumrize] Google connector saved.');

    $verifyStmt = $pdo->prepare("\n+        SELECT user_id, connector_id, external_account_id, external_email,\n+               status, token_expires_at\n+        FROM connector_connections\n+        WHERE user_id = ?\n+          AND connector_id = ?\n+        LIMIT 1\n+    ");
    $verifyStmt->execute([
        $userId,
        $connector['id']
    ]);
    $verifiedConnection = $verifyStmt->fetch(PDO::FETCH_ASSOC);

    if (
        !$verifiedConnection ||
        $verifiedConnection['status'] !== 'connected'
    ) {
        error_log('[Sumrize] Google connector verification failed.');
        unset($_SESSION['sumrize_google_oauth']);
        sumrize_google_callback_error(
            $config,
            'connection_verification_failed',
            'Koneksi Google tidak ditemukan setelah disimpan.'
        );
    }

    error_log('[Sumrize] Google connector verification successful.');


    /*
    |--------------------------------------------------------------------------
    | 17. Bersihkan OAuth session
    |--------------------------------------------------------------------------
    */

    unset(
        $_SESSION['sumrize_google_oauth']
    );


    
    error_log(
        '[Sumrize] Google Meet connector connected successfully. ' .
        'user_id=' . $userId .
        ' connector_id=' . $connector['id']
    );

    error_log('[Sumrize] Google OAuth redirect success.');

    sumrize_google_callback_success(
        $config
    );


} catch (Throwable $error) {

    /*
    |--------------------------------------------------------------------------
    | Unexpected error
    |--------------------------------------------------------------------------
    */

    unset(
        $_SESSION['sumrize_google_oauth']
    );

    error_log(
        '[Sumrize] Google OAuth callback unexpected error: ' .
        $error->getMessage() .
        ' | File: ' .
        $error->getFile() .
        ' | Line: ' .
        $error->getLine()
    );


    /*
    |--------------------------------------------------------------------------
    | Jangan tampilkan detail internal database/PHP ke browser.
    |--------------------------------------------------------------------------
    */

    sumrize_google_callback_error(
        $config,
        'callback_failed',
        'Terjadi kesalahan saat menyimpan koneksi Google Meet.'
    );
}