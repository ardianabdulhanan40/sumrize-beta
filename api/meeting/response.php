<?php

ini_set('display_errors', '0');
ini_set('log_errors', '1');

$sumrizeAllowedOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';

if (!empty($sumrizeAllowedOrigin)) {
    if (
        str_starts_with($sumrizeAllowedOrigin, 'chrome-extension://') ||
        str_starts_with($sumrizeAllowedOrigin, 'http://localhost') ||
        str_starts_with($sumrizeAllowedOrigin, 'http://127.0.0.1')
    ) {
        header('Access-Control-Allow-Origin: ' . $sumrizeAllowedOrigin);
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    }
} else {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function sumrize_read_json_body(): array
{
    $rawBody = file_get_contents('php://input');

    if ($rawBody === false || trim($rawBody) === '') {
        return [];
    }

    $body = json_decode($rawBody, true);

    if (!is_array($body)) {
        sumrize_json_error(
            'invalid_json',
            'Body request harus berupa JSON yang valid.',
            400
        );
    }

    return $body;
}

function sumrize_json(array $data, int $status = 200): never
{
    http_response_code($status);

    header('Content-Type: application/json; charset=utf-8');

    echo json_encode(
        $data,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );

    exit;
}

function sumrize_success(array $data = [], int $status = 200): never
{
    sumrize_json([
        'ok' => true,
        'data' => $data
    ], $status);
}

function sumrize_error(
    string $code,
    string $message,
    int $status = 400
): never {
    sumrize_json([
        'ok' => false,
        'error' => [
            'code' => $code,
            'message' => $message
        ]
    ], $status);
}

function sumrize_json_success(array $data = [], int $status = 200): never
{
    sumrize_success($data, $status);
}

function sumrize_json_error(
    string $code,
    string $message,
    int $status = 400
): never {
    sumrize_error($code, $message, $status);
}