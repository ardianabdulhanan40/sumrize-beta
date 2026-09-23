<?php

require_once __DIR__ . '/env.php';

sumrize_load_env(dirname(__DIR__) . '/.env');

/**
 * Google OAuth configuration for Sumrize.
 */
function sumrize_google_config(): array
{
    // Kredensial rahasia (wajib diisi di file .env)
    $clientId = getenv('SUMRIZE_GOOGLE_CLIENT_ID') ?: '';
    $clientSecret = getenv('SUMRIZE_GOOGLE_CLIENT_SECRET') ?: '';
    $encryptionKey = getenv('SUMRIZE_TOKEN_ENCRYPTION_KEY') ?: '';

    // Deteksi skema & host saat ini sebagai fallback dinamis
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost:8000';
    $baseUrl = "{$scheme}://{$host}";

    $redirectUri = getenv('SUMRIZE_GOOGLE_REDIRECT_URI')
        ?: "{$baseUrl}/api/connectors/google/callback.php";

    $onboardingUri = getenv('SUMRIZE_GOOGLE_ONBOARDING_URI')
        ?: "{$baseUrl}/dashboard/onboard-gmeet.html";

    $successUri = getenv('SUMRIZE_GOOGLE_SUCCESS_URI')
        ?: "{$baseUrl}/dashboard/index_local.html";

    return [
        'client_id' => $clientId,
        'client_secret' => $clientSecret,
        'redirect_uri' => $redirectUri,

        'scopes' => [
            'https://www.googleapis.com/auth/meetings.space.readonly',
            'openid',
            'email',
        ],

        'onboarding_uri' => $onboardingUri,
        'success_uri' => $successUri,
        'encryption_key' => $encryptionKey,
    ];
}