<?php

/**
 * POST /api/auth/register.php
 *
 * Body:
 * {
 *   "name": "Test User",
 *   "email": "test@example.com",
 *   "password": "password123"
 * }
 */

require_once __DIR__ . '/../meeting/db.php';
require_once __DIR__ . '/../meeting/response.php';


if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sumrize_json_error(
        'method_not_allowed',
        'Gunakan POST.',
        405
    );
}


$body = sumrize_read_json_body();

$name = trim($body['name'] ?? '');
$email = strtolower(trim($body['email'] ?? ''));
$password = $body['password'] ?? '';


if ($name === '') {
    sumrize_json_error(
        'missing_name',
        'Nama wajib diisi.',
        422
    );
}


if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    sumrize_json_error(
        'invalid_email',
        'Format email tidak valid.',
        422
    );
}


if (strlen($password) < 6) {
    sumrize_json_error(
        'weak_password',
        'Password minimal 6 karakter.',
        422
    );
}


try {

    $pdo = sumrize_db();


    // Cek email sudah digunakan
    $stmt = $pdo->prepare(
        'SELECT id
         FROM users
         WHERE email = :email
         LIMIT 1'
    );

    $stmt->execute([
        'email' => $email
    ]);

    if ($stmt->fetch()) {
        sumrize_json_error(
            'email_already_exists',
            'Email sudah terdaftar.',
            409
        );
    }


    // Hash password
    $passwordHash = password_hash(
        $password,
        PASSWORD_DEFAULT
    );


    // Insert user
    $stmt = $pdo->prepare(
        'INSERT INTO users
        (
            name,
            email,
            password,
            created_at,
            updated_at
        )
        VALUES
        (
            :name,
            :email,
            :password,
            NOW(),
            NOW()
        )'
    );


    $stmt->execute([
        'name' => $name,
        'email' => $email,
        'password' => $passwordHash
    ]);


    $userId = (int) $pdo->lastInsertId();


    sumrize_json_success([
        'user' => [
            'id' => $userId,
            'name' => $name,
            'email' => $email
        ]
    ], 201);


} catch (PDOException $e) {

    sumrize_json_error(
        'database_error',
        'Gagal membuat user.',
        500
    );
}