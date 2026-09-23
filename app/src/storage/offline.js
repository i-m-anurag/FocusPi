import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Phone-side storage for working away from the Raspberry Pi.
 *
 * - `localSession`: a focus session started while the Pi was unreachable.
 * - `queue`: finished sessions waiting to be pushed to the Pi. Each carries a
 *   `client_id`, so re-sending after a failed sync never double-counts.
 * - `topics` / `status`: last known values, so the app still shows your list
 *   and streak while offline.
 */
const LOCAL_SESSION_KEY = 'focuspi.localSession';
const QUEUE_KEY = 'focuspi.pendingSessions';
const TOPICS_KEY = 'focuspi.topics';
const STATUS_KEY = 'focuspi.lastStatus';

export function newClientId() {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand()}${rand()}`;
}

async function readJson(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the app keeps working with what's in memory.
  }
}

// --- session started while offline ------------------------------------------
export function loadLocalSession() {
  return readJson(LOCAL_SESSION_KEY, null);
}

export function saveLocalSession(session) {
  return writeJson(LOCAL_SESSION_KEY, session);
}

export async function clearLocalSession() {
  try {
    await AsyncStorage.removeItem(LOCAL_SESSION_KEY);
  } catch {
    // ignore
  }
}

// --- queue of finished sessions ----------------------------------------------
export function loadQueue() {
  return readJson(QUEUE_KEY, []);
}

export async function queueSession(session) {
  const queue = await loadQueue();
  if (queue.some((s) => s.client_id === session.client_id)) return queue;
  const next = [...queue, session].slice(-500);
  await writeJson(QUEUE_KEY, next);
  return next;
}

export async function removeFromQueue(clientIds) {
  const ids = new Set(clientIds);
  const next = (await loadQueue()).filter((s) => !ids.has(s.client_id));
  await writeJson(QUEUE_KEY, next);
  return next;
}

/** Minutes waiting to be synced, counted for one local calendar day. */
export function pendingMinutesFor(queue, date = new Date()) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const from = Math.floor(dayStart.getTime() / 1000);
  const to = from + 24 * 3600;
  const seconds = queue
    .filter((s) => s.started_at >= from && s.started_at < to)
    .reduce((sum, s) => sum + (s.focused_seconds || 0), 0);
  return Math.floor(seconds / 60);
}

/** Build the record the Pi expects from a finished session. */
export function finishedSession(local, { status, focusedSeconds, endedAt }) {
  return {
    client_id: local.client_id,
    label: local.label || '',
    topic_id: local.topic_id ?? null,
    planned_minutes: local.planned_minutes,
    started_at: local.started_at,
    ended_at: endedAt,
    focused_seconds: Math.max(0, Math.min(focusedSeconds, local.planned_minutes * 60)),
    status
  };
}

// --- cached Pi data -----------------------------------------------------------
export function loadCachedTopics() {
  return readJson(TOPICS_KEY, []);
}

export function cacheTopics(topics) {
  return writeJson(TOPICS_KEY, topics);
}

export function loadCachedStatus() {
  return readJson(STATUS_KEY, null);
}

export function cacheStatus(status) {
  return writeJson(STATUS_KEY, {
    streak: status.streak,
    today: status.today,
    settings: status.settings,
    weather: status.weather,
    cached_at: Math.floor(Date.now() / 1000)
  });
}
