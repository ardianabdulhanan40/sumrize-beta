<?php

require_once __DIR__ . '/env.php';

sumrize_load_env(dirname(__DIR__) . '/.env');

/**
 * Google OAuth configuration for Sumrize.
 */
function sumrize_google_config(): array
{
    $clientId = getenv('SUMRIZE_GOOGLE_CLIENT_ID') ?: '';
    $clientSecret = getenv('SUMRIZE_GOOGLE_CLIENT_SECRET') ?: '';

    $redirectUri = getenv('SUMRIZE_GOOGLE_REDIRECT_URI')
        ?: 'http://localhost/sumrize-beta/api/connectors/google/callback.php';

    $onboardingUri = getenv('SUMRIZE_GOOGLE_ONBOARDING_URI')
        ?: 'http://localhost:3000/dashboard/onboard-gmeet.html';

    $successUri = getenv('SUMRIZE_GOOGLE_SUCCESS_URI')
        ?: 'http://localhost:3000/dashboard/index_local.html';

    $encryptionKey = getenv('SUMRIZE_TOKEN_ENCRYPTION_KEY') ?: '';

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