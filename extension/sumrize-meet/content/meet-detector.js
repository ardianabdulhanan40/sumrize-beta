(function (global) {
  "use strict";

  const MEET_CODE_PATTERN = /([a-z]{3}-[a-z]{4}-[a-z]{3})/i;

  function getMeetCode() {
    const match = window.location.pathname.match(MEET_CODE_PATTERN);
    return match ? match[1].toLowerCase() : null;
  }

  function isValidMeetingPage() {
    if (window.location.hostname !== "meet.google.com") return false;
    return Boolean(getMeetCode());
  }

  function isInCall() {
    try {
      return Boolean(
        document.querySelector(
          '[aria-label*="Leave call" i], [aria-label*="Tinggalkan panggilan" i], [aria-label*="Keluar dari panggilan" i]'
        )
      );
    } catch {
      return false;
    }
  }

  global.SumrizeMeetDetector = {
    getMeetCode,
    isValidMeetingPage,
    isInCall
  };
})(window);