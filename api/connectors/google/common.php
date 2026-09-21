<?php

require_once __DIR__ . '/../../../config/google.php';
require_once __DIR__ . '/../../meeting/db.php';
require_once __DIR__ . '/../../meeting/auth.php';
require_once __DIR__ . '/../../meeting/response.php';

function sumrize_google_config_or_fail(): array
{
    $config = sumrize_google_config();

    if ($config['client_id'] === '' || $config['client_secret'] === '') {
        sumrize_error(
            'google_config_missing',
            'Konfigurasi Google OAuth belum lengkap.',
            500
        );
    }

    return $config;
}

function sumrize_google_start_session(): void
{
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
}

function sumrize_google_require_encryption_key(array $config): string
{
    if ($config['encryption_key'] === '') {
        sumrize_error(
            'token_encryption_key_missing',
            'Kunci enkripsi token belum dikonfigurasi.',
            500
        );
    }

    return hash('sha256', $config['encryption_key'], true);
}

function sumrize_google_encrypt(string $value, string $key): string
{
    $iv = random_bytes(12);
    $tag = '';
    $ciphertext = openssl_encrypt(
        $value,
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $iv,
        $tag
    );

    if ($ciphertext === false) {
        throw new RuntimeException('Token encryption failed.');
    }

    return base64_encode($iv . $tag . $ciphertext);
}

function sumrize_google_decrypt(?string $encoded, string $key): ?string
{
    if (!$encoded) {
        return null;
    }

    $decoded = base64_decode($encoded, true);

    if ($decoded === false || strlen($decoded) < 28) {
        return null;
    }

    $iv = substr($decoded, 0, 12);
    $tag = substr($decoded, 12, 16);
    $ciphertext = substr($decoded, 28);

    $value = openssl_decrypt(
        $ciphertext,
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $iv,
        $tag
    );

    return $value === false ? null : $value;
}

function sumrize_google_http_json(
    string $url,
    string $method = 'GET',
    ?array $body = null,
    ?string $authorization = null
): array {
    $headers = ['Accept: application/json'];

    if ($body !== null) {
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
    }

    if ($authorization !== null) {
        $headers[] = 'Authorization: ' . $authorization;
    }

    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 30
    ]);

    if ($body !== null) {
        curl_setopt($curl, CURLOPT_POSTFIELDS, http_build_query($body));
    }

    $raw = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error = curl_error($curl);
    curl_close($curl);

    if ($raw === false || $error !== '') {
        throw new RuntimeException('Google API request failed.');
    }

    $data = json_decode($raw, true);

    if (!is_array($data)) {
        throw new RuntimeException('Google API returned invalid JSON.');
    }

    if ($status < 200 || $status >= 300) {
        throw new RuntimeException(
            $data['error_description'] ??
            $data['error'] ??
            'Google API request failed.'
        );
    }

    return $data;
}

function sumrize_google_connector(PDO $pdo): array
{
    $stmt = $pdo->query("\n        SELECT id, slug, name, type, status\n        FROM connectors\n        WHERE slug = 'google_meet'\n        LIMIT 1\n    ");

    $connector = $stmt->fetch();

    if (!$connector) {
        sumrize_error(
            'connector_not_found',
            'Connector Google Meet belum tersedia di database.',
            404
        );
    }

    return $connector;
}

function sumrize_google_redirect(array $config, string $query): never
{
    header('Location: ' . $config['onboarding_uri'] . $query, true, 302);
    exit;
}
