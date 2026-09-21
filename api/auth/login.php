<?php

require_once __DIR__ . '/../meeting/db.php';
require_once __DIR__ . '/../meeting/auth.php';
require_once __DIR__ . '/../meeting/response.php';

/*
|--------------------------------------------------------------------------
| Method
|--------------------------------------------------------------------------
*/

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sumrize_json_error(
        'method_not_allowed',
        'Gunakan POST.',
        405
    );
}

/*
|--------------------------------------------------------------------------
| Read Request Body
|--------------------------------------------------------------------------
*/

$body = sumrize_read_json_body();

$email = strtolower(
    trim($body['email'] ?? '')
);

$password = $body['password'] ?? '';

/*
|--------------------------------------------------------------------------
| Validation
|--------------------------------------------------------------------------
*/

if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sumrize_json_error(
        'invalid_credentials',
        'Email atau password salah.',
        401
    );
}

if ($password === '') {
    sumrize_json_error(
        'invalid_credentials',
        'Email atau password salah.',
        401
    );
}

/*
|--------------------------------------------------------------------------
| Database
|--------------------------------------------------------------------------
*/

try {
    $pdo = sumrize_db();

    /*
    |--------------------------------------------------------------------------
    | Find User
    |--------------------------------------------------------------------------
    */

    $stmt = $pdo->prepare(
        'SELECT
            id,
            name,
            email,
            password
         FROM users
         WHERE email = :email
         LIMIT 1'
    );

    $stmt->execute([
        'email' => $email
    ]);

    $user = $stmt->fetch();

    /*
    |--------------------------------------------------------------------------
    | User Not Found
    |--------------------------------------------------------------------------
    */

    if (!$user) {
        sumrize_json_error(
            'invalid_credentials',
            'Email atau password salah.',
            401
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Verify Password
    |--------------------------------------------------------------------------
    */

    if (!password_verify($password, $user['password'])) {
        sumrize_json_error(
            'invalid_credentials',
            'Email atau password salah.',
            401
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Generate Personal Access Token
    |--------------------------------------------------------------------------
    */

    $plainToken = bin2hex(
        random_bytes(32)
    );

    $tokenHash = hash(
        'sha256',
        $plainToken
    );

    /*
    |--------------------------------------------------------------------------
    | Token Expiration
    |--------------------------------------------------------------------------
    | Token berlaku selama 30 hari.
    |--------------------------------------------------------------------------
    */

    $expiresAt = date(
        'Y-m-d H:i:s',
        strtotime('+30 days')
    );

    /*
    |--------------------------------------------------------------------------
    | Save Token
    |--------------------------------------------------------------------------
    */

    $stmt = $pdo->prepare(
        'INSERT INTO personal_access_tokens
        (
            user_id,
            token_hash,
            expires_at,
            created_at
        )
        VALUES
        (
            :user_id,
            :token_hash,
            :expires_at,
            NOW()
        )'
    );

    $stmt->execute([
        'user_id' => (int) $user['id'],
        'token_hash' => $tokenHash,
        'expires_at' => $expiresAt
    ]);

    /*
    |--------------------------------------------------------------------------
    | Start PHP Session
    |--------------------------------------------------------------------------
    */

    sumrize_start_auth_session();

    session_regenerate_id(true);

    $_SESSION['sumrize_user_id'] = (int) $user['id'];

    /*
    |--------------------------------------------------------------------------
    | Response
    |--------------------------------------------------------------------------
    */

    sumrize_json_success([
        'token' => $plainToken,

        'token_type' => 'Bearer',

        'expires_at' => $expiresAt,

        'user' => [
            'id' => (int) $user['id'],
            'name' => $user['name'],
            'email' => $user['email']
        ]
    ]);

} catch (PDOException $e) {

    /*
    |--------------------------------------------------------------------------
    | Database Error
    |--------------------------------------------------------------------------
    */

    sumrize_json_error(
        'database_error',
        'Gagal melakukan login.',
        500
    );
}