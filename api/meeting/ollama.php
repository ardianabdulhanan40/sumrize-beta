<?php

function sumrize_ollama_request(string $transcript): array
{
    // Jangan biarkan PHP menghentikan proses AI setelah 120 detik
    set_time_limit(0);

    if (trim($transcript) === '') {
        throw new Exception('Transcript kosong.');
    }

    $payload = [
        'model' => 'qwen3:4b',

        // Matikan thinking agar proses lebih cepat
        'think' => false,

        // Minta Ollama menghasilkan JSON
        'format' => 'json',

        'stream' => false,

        'messages' => [
            [
                'role' => 'system',
                'content' => <<<'PROMPT'
Kamu adalah Meeting Assistant untuk aplikasi Sumrize.

Analisis transcript meeting dan hasilkan:

1. Summary
2. Action Items
3. Decisions
4. Follow-ups

ATURAN:

- Gunakan HANYA informasi yang terdapat di transcript.
- Jangan mengarang informasi.
- Jangan membuat keputusan yang tidak disebutkan.
- Jangan membuat action item yang tidak disebutkan atau disepakati.
- Jika PIC tidak disebutkan, gunakan string kosong.
- Jika deadline tidak disebutkan, gunakan string kosong.
- Jika tidak ada decision, gunakan array kosong.
- Jika tidak ada follow-up, gunakan array kosong.
- Summary harus menggunakan bahasa Indonesia.
- Jangan menggunakan markdown.
- Jangan memberikan penjelasan di luar JSON.
- Jawab langsung dengan JSON valid.

Gunakan struktur berikut:

{
  "summary": "ringkasan meeting",
  "action_items": [
    {
      "task": "tugas",
      "assignee": "PIC",
      "deadline": "deadline"
    }
  ],
  "decisions": [
    {
      "decision": "keputusan"
    }
  ],
  "follow_ups": [
    {
      "description": "hal yang perlu ditindaklanjuti"
    }
  ]
}
PROMPT
            ],
            [
                'role' => 'user',
                'content' =>
                    "Berikut adalah transcript meeting yang harus dianalisis:\n\n"
                    . $transcript
            ]
        ]
    ];

    $jsonPayload = json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );

    if ($jsonPayload === false) {
        throw new Exception(
            'Gagal membuat payload JSON untuk Ollama.'
        );
    }

    /*
     * Ollama berjalan secara lokal.
     */
    $ollamaUrl = 'http://127.0.0.1:11434/api/chat';

    $ch = curl_init($ollamaUrl);

    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,

        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'Accept: application/json'
        ],

        CURLOPT_POSTFIELDS => $jsonPayload,

        // Waktu koneksi maksimal 10 detik
        CURLOPT_CONNECTTIMEOUT => 10,

        // Berikan Ollama waktu sampai 10 menit
        CURLOPT_TIMEOUT => 600
    ]);

    $response = curl_exec($ch);

    /*
     * Cek error koneksi cURL.
     */
    if ($response === false) {
        $error = curl_error($ch);

        curl_close($ch);

        throw new Exception(
            'Gagal terhubung ke Ollama: ' . $error
        );
    }

    $httpCode = curl_getinfo(
        $ch,
        CURLINFO_HTTP_CODE
    );

    curl_close($ch);

    /*
     * Decode response Ollama.
     */
    $data = json_decode(
        $response,
        true
    );

    /*
     * Cek HTTP error.
     */
    if ($httpCode < 200 || $httpCode >= 300) {

        $message = 'Ollama API request gagal.';

        if (
            is_array($data) &&
            isset($data['error'])
        ) {
            $message = $data['error'];
        }

        throw new Exception(
            'Ollama API Error (' .
            $httpCode .
            '): ' .
            $message
        );
    }

    /*
     * Pastikan response berupa JSON.
     */
    if (!is_array($data)) {
        throw new Exception(
            'Response dari Ollama bukan JSON yang valid.'
        );
    }

    /*
     * Ambil hasil AI.
     */
    $outputText =
        $data['message']['content']
        ?? '';

    if (trim($outputText) === '') {
        throw new Exception(
            'Ollama tidak mengembalikan hasil AI.'
        );
    }

    $outputText = trim($outputText);

    /*
     * Jika model masih membungkus JSON dengan
     * ```json ... ```
     * kita bersihkan.
     */
    if (
        preg_match(
            '/```(?:json)?\s*(.*?)\s*```/is',
            $outputText,
            $matches
        )
    ) {
        $outputText = trim($matches[1]);
    }

    /*
     * Decode JSON hasil AI.
     */
    $result = json_decode(
        $outputText,
        true
    );

    if (
        json_last_error() !== JSON_ERROR_NONE ||
        !is_array($result)
    ) {
        throw new Exception(
            'Output AI bukan JSON yang valid. ' .
            'Output: ' .
            $outputText
        );
    }

    /*
     * Normalisasi hasil.
     */
    $summary = '';

    if (isset($result['summary'])) {
        $summary = (string) $result['summary'];
    }

    $actionItems = [];

    if (
        isset($result['action_items']) &&
        is_array($result['action_items'])
    ) {
        $actionItems = $result['action_items'];
    }

    $decisions = [];

    if (
        isset($result['decisions']) &&
        is_array($result['decisions'])
    ) {
        $decisions = $result['decisions'];
    }

    $followUps = [];

    if (
        isset($result['follow_ups']) &&
        is_array($result['follow_ups'])
    ) {
        $followUps = $result['follow_ups'];
    }

    /*
     * Pastikan struktur Action Items aman.
     */
    foreach ($actionItems as &$item) {

        if (!is_array($item)) {
            $item = [
                'task' => (string) $item,
                'assignee' => '',
                'deadline' => ''
            ];

            continue;
        }

        $item = [
            'task' =>
                isset($item['task'])
                    ? (string) $item['task']
                    : '',

            'assignee' =>
                isset($item['assignee'])
                    ? (string) $item['assignee']
                    : '',

            'deadline' =>
                isset($item['deadline'])
                    ? (string) $item['deadline']
                    : ''
        ];
    }

    unset($item);

    /*
     * Pastikan struktur Decisions aman.
     */
    foreach ($decisions as &$item) {

        if (!is_array($item)) {
            $item = [
                'decision' => (string) $item
            ];

            continue;
        }

        $item = [
            'decision' =>
                isset($item['decision'])
                    ? (string) $item['decision']
                    : ''
        ];
    }

    unset($item);

    /*
     * Pastikan struktur Follow-ups aman.
     */
    foreach ($followUps as &$item) {

        if (!is_array($item)) {
            $item = [
                'description' => (string) $item
            ];

            continue;
        }

        $item = [
            'description' =>
                isset($item['description'])
                    ? (string) $item['description']
                    : ''
        ];
    }

    unset($item);

    /*
     * Return hasil akhir.
     */
    return [
        'summary' => $summary,
        'action_items' => $actionItems,
        'decisions' => $decisions,
        'follow_ups' => $followUps
    ];
}