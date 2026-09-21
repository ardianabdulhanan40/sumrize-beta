<?php
/**
 * uuid.php
 * Generator UUID v4 sederhana tanpa dependency eksternal, dipakai sebagai
 * id meeting_sessions (format "ms_<uuid>") agar mudah dibedakan dari id
 * entity lain saat debugging.
 */

function sumrize_uuid_v4(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function sumrize_new_meeting_session_id(): string
{
    return 'ms_' . bin2hex(
        random_bytes(16)
    );
}
