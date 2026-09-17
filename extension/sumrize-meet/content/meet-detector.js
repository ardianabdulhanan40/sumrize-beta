/**
 * content/meet-detector.js
 * Memastikan content script hanya "aktif penuh" ketika berada di halaman
 * meeting Google Meet yang valid (bukan landing page / halaman lain).
 *
 * URL meeting Google Meet berbentuk: https://meet.google.com/xxx-xxxx-xxx
 */
(function (global) {
  const MEET_CODE_PATTERN = /^\/([a-z]{3}-[a-z]{4}-[a-z]{3})$/i;

  function getMeetCode() {
    const match = window.location.pathname.match(MEET_CODE_PATTERN);
    return match ? match[1] : null;
  }

  function isValidMeetingPage() {
    if (window.location.hostname !== "meet.google.com") return false;
    return Boolean(getMeetCode());
  }

  /**
   * Google Meet adalah SPA - transisi dari lobby ke "sudah join" tidak selalu
   * mengubah URL. Kita anggap user "in-call" jika ada tombol leave-call /
   * kontrol mic-cam yang biasanya hanya muncul saat sudah bergabung.
   * Selector ini sengaja dibungkus try/catch & fallback karena DOM Google
   * Meet sering berubah - lihat GoogleMeetAdapter di caption-observer.js.
   */
  function isInCall() {
    try {
      const leaveButton = document.querySelector('[aria-label*="Leave call" i], [aria-label*="Tinggalkan panggilan" i]');
      return Boolean(leaveButton);
    } catch (err) {
      global.SumrizeLogger?.warn("isInCall check failed", err);
      return false;
    }
  }

  global.SumrizeMeetDetector = {
    getMeetCode,
    isValidMeetingPage,
    isInCall,
  };
})(window);
