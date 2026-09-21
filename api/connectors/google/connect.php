<?php

require_once __DIR__ . '/common.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    sumrize_error('method_not_allowed', 'Method GET diperlukan.', 405);
}

$config = sumrize_google_config_or_fail();
sumrize_google_start_session();

$user = function_exists('sumrize_get_session_user')
    ? call_user_func('sumrize_get_session_user')
    : null;

if (!$user && sumrize_get_bearer_token()) {
    $user = sumrize_authenticate();
}

if (!$user) {
    sumrize_google_redirect($config, '?google_oauth=error&code=login_required');
}

$state = bin2hex(random_bytes(32));

$_SESSION['sumrize_google_oauth'] = [
    'state' => $state,
    'user_id' => (int) $user['user_id'],
    'expires_at' => time() + 600
];

$params = [
    'client_id' => $config['client_id'],
    'redirect_uri' => $config['redirect_uri'],
    'response_type' => 'code',
    'scope' => implode(' ', $config['scopes']),
    'access_type' => 'offline',
    'prompt' => 'consent',
    'state' => $state
];

$authorizationUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' .
    http_build_query($params, '', '&', PHP_QUERY_RFC3986);

header('Location: ' . $authorizationUrl, true, 302);
exit;
