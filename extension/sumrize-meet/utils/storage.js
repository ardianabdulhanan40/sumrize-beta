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
        "http://localhost/sumrize-beta/api/meeting",

    captureState: "idle",

    meetingSessionId: null,

    meetCode: null,

    lastError: null
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
| RESET
|--------------------------------------------------------------------------
*/

async function reset() {

    await set({

        captureState: "idle",

        meetingSessionId: null,

        meetCode: null,

        lastError: null
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

    reset
};