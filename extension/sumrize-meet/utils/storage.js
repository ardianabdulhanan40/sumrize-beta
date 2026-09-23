/**
 * utils/storage.js
 *
 * Wrapper chrome.storage.local.
 *
 * Dipakai oleh:
 * - Content Script
 * - Service Worker
 * - Popup
 */

const DEFAULTS = {
    authToken: null,

    apiBaseUrl:
        "http://localhost:8000/api/meeting",

    captureState: "idle",

    meetingSessionId: null,

    meetCode: null,

    lastError: null,

    privacyConsentGiven: false,

    lastMeeting: null,

    userInfo: null,

    connectorInfo: null,

    detectedMeetEmail: null,

    authMethod: null,

    theme: "auto"
};


/*
|--------------------------------------------------------------------------
| BASIC STORAGE
|--------------------------------------------------------------------------
*/

async function get(keys = null) {

    return await chrome.storage.local.get(
        keys || DEFAULTS
    );
}


async function getAll() {

    return await chrome.storage.local.get(
        null
    );
}


async function set(values) {

    await chrome.storage.local.set(
        values
    );
}


async function remove(keys) {

    await chrome.storage.local.remove(
        keys
    );
}


/*
|--------------------------------------------------------------------------
| AUTH
|--------------------------------------------------------------------------
*/

async function getAuthToken() {

    const {
        authToken
    } = await get([
        "authToken"
    ]);

    return authToken || null;
}


async function setAuthToken(token) {

    if (!token) {

        throw new Error(
            "Auth token tidak boleh kosong."
        );
    }

    await set({
        authToken: token
    });
}


async function clearAuthToken() {

    await set({
        authToken: null
    });
}


async function hasAuthToken() {

    const token =
        await getAuthToken();

    return Boolean(token);
}


/*
|--------------------------------------------------------------------------
| API
|--------------------------------------------------------------------------
*/

async function getApiBaseUrl() {

    const {
        apiBaseUrl
    } = await get([
        "apiBaseUrl"
    ]);

    return (
        apiBaseUrl ||
        DEFAULTS.apiBaseUrl
    );
}


/*
|--------------------------------------------------------------------------
| CAPTURE
|--------------------------------------------------------------------------
*/

async function getCaptureState() {

    const {
        captureState
    } = await get([
        "captureState"
    ]);

    return (
        captureState ||
        "idle"
    );
}


async function setCaptureState(state) {

    await set({
        captureState: state
    });
}


/*
|--------------------------------------------------------------------------
| MEETING SESSION
|--------------------------------------------------------------------------
*/

async function getMeetingSessionId() {

    const {
        meetingSessionId
    } = await get([
        "meetingSessionId"
    ]);

    return (
        meetingSessionId ||
        null
    );
}


async function setMeetingSessionId(id) {

    await set({
        meetingSessionId: id
    });
}


async function getMeetCode() {

    const {
        meetCode
    } = await get([
        "meetCode"
    ]);

    return (
        meetCode ||
        null
    );
}


async function setMeetCode(code) {

    await set({
        meetCode: code
    });
}


/*
|--------------------------------------------------------------------------
| ERROR
|--------------------------------------------------------------------------
*/

async function getLastError() {

    const {
        lastError
    } = await get([
        "lastError"
    ]);

    return (
        lastError ||
        null
    );
}


async function setLastError(message) {

    await set({
        lastError: message
    });
}


/*
|--------------------------------------------------------------------------
| PRIVACY & USER
|--------------------------------------------------------------------------
*/

async function getPrivacyConsent() {
    const { privacyConsentGiven } = await get(["privacyConsentGiven"]);
    return Boolean(privacyConsentGiven);
}

async function setPrivacyConsent(granted) {
    await set({ privacyConsentGiven: Boolean(granted) });
}

async function getLastMeeting() {
    const { lastMeeting } = await get(["lastMeeting"]);
    return lastMeeting || null;
}

async function setLastMeeting(meetingData) {
    await set({ lastMeeting: meetingData });
}

async function getUserInfo() {
    const { userInfo } = await get(["userInfo"]);
    return userInfo || null;
}

async function setUserInfo(info) {
    await set({ userInfo: info });
}

async function getConnectorInfo() {
    const { connectorInfo } = await get(["connectorInfo"]);
    return connectorInfo || null;
}

async function setConnectorInfo(info) {
    await set({ connectorInfo: info });
}

async function getDetectedMeetEmail() {
    const { detectedMeetEmail } = await get(["detectedMeetEmail"]);
    return detectedMeetEmail || null;
}

async function setDetectedMeetEmail(email) {
    await set({ detectedMeetEmail: email ? String(email).trim().toLowerCase() : null });
}

async function isAutoConnected() {
    const { connectorInfo, authToken } = await get(["connectorInfo", "authToken"]);
    return Boolean(connectorInfo && connectorInfo.status === "connected" && authToken);
}

/*
|--------------------------------------------------------------------------
| THEME
|--------------------------------------------------------------------------
*/

async function getTheme() {
    const { theme } = await get(["theme"]);
    return theme || "auto";
}

async function setTheme(theme) {
    await set({ theme });
}

async function isDarkMode() {
    const theme = await getTheme();
    if (theme === "dark") return true;
    if (theme === "light") return false;

    // Check system preference
    if (typeof window !== "undefined" && window.matchMedia) {
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return true;
}


/*
|--------------------------------------------------------------------------
| RESET
|--------------------------------------------------------------------------
*/

async function reset() {

    await set({

        captureState: "idle",

        meetingSessionId: null,

        meetCode: null,

        lastError: null,

        connectorInfo: null,

        detectedMeetEmail: null,

        authMethod: null
    });
}


/*
|--------------------------------------------------------------------------
| GLOBAL EXPORT
|--------------------------------------------------------------------------
*/

globalThis.SumrizeStorage = {

    get,

    getAll,

    set,

    remove,

    getAuthToken,

    setAuthToken,

    clearAuthToken,

    hasAuthToken,

    getApiBaseUrl,

    getCaptureState,

    setCaptureState,

    getMeetingSessionId,

    setMeetingSessionId,

    getMeetCode,

    setMeetCode,

    getLastError,

    setLastError,

    getPrivacyConsent,

    setPrivacyConsent,

    getLastMeeting,

    setLastMeeting,

    getUserInfo,

    setUserInfo,

    getConnectorInfo,

    setConnectorInfo,

    getDetectedMeetEmail,

    setDetectedMeetEmail,

    isAutoConnected,

    getTheme,

    setTheme,

    isDarkMode,

    reset
};