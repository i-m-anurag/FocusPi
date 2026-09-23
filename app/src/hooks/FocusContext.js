import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import {
  canScheduleExactAlarms,
  getFocusState,
  hasPolicyAccess,
  isDndSupported,
  startFocus as nativeStart,
  stopFocus as nativeStop
} from '../../modules/focus-dnd';
import { createApi } from '../api/client';
import {
  cacheStatus,
  cacheTopics,
  clearLocalSession,
  clearPhoneData,
  finishedSession,
  loadCachedStatus,
  loadCachedTopics,
  loadLocalSession,
  loadQueue,
  newClientId,
  pendingMinutesFor,
  queueSession,
  removeFromQueue,
  saveLocalSession
} from '../storage/offline';
import { loadSettings, saveSettings } from '../storage/settings';

const POLL_MS = 5000;
const FocusContext = createContext(null);

export function useFocus() {
  return useContext(FocusContext);
}

function readPermissions() {
  return {
    dndSupported: isDndSupported,
    dnd: hasPolicyAccess(),
    exactAlarms: canScheduleExactAlarms()
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Single source of truth for the app.
 *
 * Normally the Raspberry Pi owns the session: it times it, records it and
 * drives the OLED, while the phone mirrors it and switches DND to calls only.
 *
 * Away from the Pi the phone takes over: it runs the session itself, stores it
 * on the phone, and uploads it the next time the Pi is reachable, so the streak
 * still counts. Android ends DND on time either way, even if the app is killed.
 */
export function FocusProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState(null);
  const [online, setOnline] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [session, setSession] = useState(null); // { id, label, endAtMs, totalSeconds, offline }
  const [topics, setTopics] = useState([]);
  const [pending, setPending] = useState([]); // sessions waiting to reach the Pi
  const [permissions, setPermissions] = useState(readPermissions);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const [now, setNow] = useState(Date.now());

  const sessionRef = useRef(null);
  const settingsRef = useRef(null);
  const localRef = useRef(null); // the offline session record, when we own the timer
  // Session the user stopped on the phone while the Pi was unreachable.
  const pendingStopRef = useRef(null);
  sessionRef.current = session;
  settingsRef.current = settings;

  const api = useMemo(
    () => (settings ? createApi({ serverUrl: settings.serverUrl, apiKey: settings.apiKey }) : null),
    [settings?.serverUrl, settings?.apiKey]
  );

  const notify = useCallback((message) => setToast({ message, key: Date.now() }), []);

  // ---- phone DND mirroring ---------------------------------------------------
  const ensureNativeFocus = useCallback((endAtMs, label) => {
    if (!isDndSupported || !hasPolicyAccess()) return;
    const s = settingsRef.current || {};
    const st = getFocusState();
    if (st.active && Math.abs(st.endAtMs - endAtMs) < 5000) return;
    try {
      nativeStart(endAtMs, {
        callers: s.callers,
        repeatCallers: s.repeatCallers,
        allowAlarms: s.allowAlarms,
        label
      });
    } catch (e) {
      notify(e.message || 'Could not enable Do Not Disturb');
    }
  }, [notify]);

  const releaseNativeFocus = useCallback(() => {
    if (!isDndSupported) return;
    const st = getFocusState();
    if (st.active) nativeStop(st.endAtMs <= Date.now() + 2000);
  }, []);

  // ---- offline bookkeeping -----------------------------------------------------
  const finishLocalSession = useCallback(async (statusName, focusedSeconds) => {
    const local = localRef.current;
    if (!local) return;
    localRef.current = null;
    await clearLocalSession();
    const record = finishedSession(local, {
      status: statusName,
      focusedSeconds,
      endedAt: nowSeconds()
    });
    setPending(await queueSession(record));
    setSession(null);
    if (statusName === 'completed') {
      setCelebration({ planned_minutes: local.planned_minutes, offline: true });
    }
  }, []);

  const syncPending = useCallback(async () => {
    if (!api) return;
    const queue = await loadQueue();
    if (queue.length === 0) return;
    try {
      const res = await api.sync(queue);
      setPending(await removeFromQueue(queue.map((s) => s.client_id)));
      if (res.imported > 0) {
        notify(`Synced ${res.imported} offline session${res.imported === 1 ? '' : 's'} to the Pi`);
      }
    } catch {
      // Still offline: the queue stays on the phone for the next attempt.
    }
  }, [api, notify]);

  // ---- apply the Pi's view of the world --------------------------------------
  const applyServerFocus = useCallback((focus, lastSession) => {
    // While the phone owns an offline session, the Pi's view does not apply.
    if (localRef.current) return;

    const prev = sessionRef.current;
    if (focus && focus.remaining_seconds > 0) {
      const endAtMs = Date.now() + focus.remaining_seconds * 1000;
      const pendingStop = pendingStopRef.current;
      if (pendingStop && (pendingStop.id === focus.id || Math.abs(pendingStop.endAtMs - endAtMs) < 10000)) {
        // Don't turn DND back on; finish the stop on the Pi instead.
        api?.stop().then(() => { pendingStopRef.current = null; }).catch(() => {});
        return;
      }
      const next = {
        id: focus.id,
        label: focus.label || '',
        endAtMs,
        totalSeconds: focus.total_seconds,
        offline: false
      };
      // Only re-set when something meaningful changed, to avoid jitter.
      if (!prev || prev.id !== next.id || Math.abs(prev.endAtMs - endAtMs) > 2000 || !prev.totalSeconds) {
        setSession(next);
      }
      ensureNativeFocus(endAtMs, next.label);
      return;
    }
    if (prev && lastSession && lastSession.id === prev.id && lastSession.status === 'completed') {
      setCelebration(lastSession);
    }
    if (prev) setSession(null);
    pendingStopRef.current = null;
    releaseNativeFocus();
  }, [api, ensureNativeFocus, releaseNativeFocus]);

  const refresh = useCallback(async () => {
    if (!api) return null;
    try {
      const data = await api.status();
      setStatus(data);
      setOnline(true);
      setLastError(null);
      if (data.topics) {
        setTopics(data.topics);
        cacheTopics(data.topics);
      }
      cacheStatus(data);
      applyServerFocus(data.focus, data.last_session);
      syncPending();
      return data;
    } catch (e) {
      setOnline(false);
      setLastError(e.message);
      // Keep counting locally; if the phone's own timer ran out, wrap it up.
      const cur = sessionRef.current;
      if (cur && cur.endAtMs <= Date.now() && !localRef.current) {
        setSession(null);
        releaseNativeFocus();
      }
      return null;
    }
  }, [api, applyServerFocus, releaseNativeFocus, syncPending]);

  // ---- boot ----------------------------------------------------------------------
  useEffect(() => {
    loadSettings().then(setSettings);
    loadCachedTopics().then(setTopics);
    loadQueue().then(setPending);
    loadCachedStatus().then((cached) => {
      if (cached) setStatus((current) => current ?? cached);
    });

    // Restore a session that was running when the app was last closed.
    loadLocalSession().then((local) => {
      if (!local) return;
      localRef.current = local;
      setSession({
        id: null,
        label: local.label,
        endAtMs: local.ends_at * 1000,
        totalSeconds: local.planned_minutes * 60,
        offline: true
      });
    });

    const st = getFocusState();
    if (st.active && st.endAtMs > Date.now()) {
      setSession((cur) => cur ?? { id: null, label: st.label, endAtMs: st.endAtMs, totalSeconds: null });
    }
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS').catch(() => {});
    }
  }, []);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setPermissions(readPermissions());
        refresh();
      }
    });
    return () => {
      clearInterval(poll);
      sub.remove();
    };
  }, [refresh]);

  // 1s tick for countdowns and the clock.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remainingSeconds = session ? Math.max(0, (session.endAtMs - now) / 1000) : 0;
  const timerDone = Boolean(session) && remainingSeconds <= 0;

  useEffect(() => {
    if (!timerDone) return undefined;
    if (localRef.current) {
      // We own this one: record it and queue it for the Pi.
      finishLocalSession('completed', localRef.current.planned_minutes * 60);
      return undefined;
    }
    const t = setTimeout(refresh, 1500);
    return () => clearTimeout(t);
  }, [timerDone, refresh, finishLocalSession]);

  // ---- actions -----------------------------------------------------------------
  const startOffline = useCallback(async (minutes, label, topicId) => {
    const local = {
      client_id: newClientId(),
      label: label || '',
      topic_id: topicId ?? null,
      planned_minutes: minutes,
      started_at: nowSeconds(),
      ends_at: nowSeconds() + minutes * 60
    };
    localRef.current = local;
    await saveLocalSession(local);
    const endAtMs = local.ends_at * 1000;
    setSession({ id: null, label: local.label, endAtMs, totalSeconds: minutes * 60, offline: true });
    ensureNativeFocus(endAtMs, local.label);
  }, [ensureNativeFocus]);

  const start = useCallback(async (minutes, { label = '', topicId = null } = {}) => {
    if (!api) return;
    setBusy(true);
    try {
      const res = await api.start({ minutes, label, topic_id: topicId, client_id: newClientId() });
      setCelebration(null);
      applyServerFocus(res.focus);
      if (isDndSupported && !hasPolicyAccess()) {
        notify('Timer started, but DND is off: allow Do Not Disturb access first');
      }
      refresh();
    } catch (e) {
      if (e.status === 409 && e.payload?.focus) {
        applyServerFocus(e.payload.focus);
        notify('A focus session is already running');
      } else if (e.status === 0) {
        // Pi unreachable: run the session on the phone and sync it later.
        setCelebration(null);
        await startOffline(minutes, label, topicId);
        notify('Pi offline: this session is saved on your phone and will sync later');
      } else {
        notify(e.message);
      }
    } finally {
      setBusy(false);
    }
  }, [api, applyServerFocus, notify, refresh, startOffline]);

  const stop = useCallback(async () => {
    const local = localRef.current;
    if (local) {
      if (isDndSupported) nativeStop(false);
      await finishLocalSession('cancelled', nowSeconds() - local.started_at);
      syncPending();
      return;
    }
    if (!api) return;
    setBusy(true);
    const stopping = sessionRef.current;
    try {
      await api.stop();
      pendingStopRef.current = null;
      setSession(null);
      if (isDndSupported) nativeStop(false);
      refresh();
    } catch (e) {
      // Always give the phone back, even if the Pi is unreachable.
      pendingStopRef.current = stopping;
      setSession(null);
      if (isDndSupported) nativeStop(false);
      notify(`Stopped on phone only: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }, [api, finishLocalSession, notify, refresh, syncPending]);

  const updateSettings = useCallback(async (patch) => {
    const next = { ...settingsRef.current, ...patch };
    setSettings(next);
    await saveSettings(next);
    return next;
  }, []);

  // ---- learning list + Pi settings ----------------------------------------------
  const withTopics = useCallback(async (action, failureMessage) => {
    if (!api) return null;
    try {
      const res = await action();
      if (res?.topics) {
        setTopics(res.topics);
        cacheTopics(res.topics);
      }
      return res ?? {};
    } catch (e) {
      notify(e.status === 0 ? `${failureMessage}: the Pi is offline` : e.message);
      return null;
    }
  }, [api, notify]);

  /** Returns the new topic's id, or null if it could not be added. */
  const addTopic = useCallback(
    async (name) => {
      const res = await withTopics(() => api.addTopic(name), 'Could not add');
      return res?.id ?? null;
    },
    [api, withTopics]
  );
  const renameTopic = useCallback(
    async (id, name) => Boolean(await withTopics(() => api.updateTopic(id, { name }), 'Could not rename')),
    [api, withTopics]
  );
  const deleteTopic = useCallback(
    async (id) => Boolean(await withTopics(() => api.deleteTopic(id), 'Could not remove')),
    [api, withTopics]
  );

  const savePiSettings = useCallback(async (patch) => {
    if (!api) return false;
    // Show the change straight away, then confirm with the Pi.
    setStatus((cur) => (cur ? { ...cur, settings: { ...cur.settings, ...patch } } : cur));
    try {
      const res = await api.saveSettings(patch);
      setStatus((cur) => (cur ? { ...cur, settings: res.settings } : cur));
      return true;
    } catch (e) {
      notify(e.status === 0 ? 'The Pi is offline, setting not saved' : e.message);
      refresh();
      return false;
    }
  }, [api, notify, refresh]);

  /** Fresh start: wipe the history on the Pi and everything held on the phone. */
  const resetAllData = useCallback(async (includeTopics = false) => {
    if (!api) return false;
    setBusy(true);
    try {
      const res = await api.resetData(includeTopics);
      if (isDndSupported) nativeStop(false);
      localRef.current = null;
      pendingStopRef.current = null;
      await clearPhoneData();
      setPending([]);
      setSession(null);
      setCelebration(null);
      if (res.topics) {
        setTopics(res.topics);
        cacheTopics(res.topics);
      }
      await refresh();
      notify(
        `Fresh start: ${res.deleted_sessions} session${res.deleted_sessions === 1 ? '' : 's'} deleted`
      );
      return true;
    } catch (e) {
      notify(e.status === 0 ? 'The Pi is offline, nothing was deleted' : e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [api, notify, refresh]);

  // Today's minutes including anything still waiting to sync.
  const pendingMinutes = pendingMinutesFor(pending);
  const streak = status?.streak;
  const todayMinutes = (streak?.today_minutes ?? 0) + pendingMinutes;
  const goalMinutes = streak?.goal_minutes ?? 60;

  const value = {
    api,
    settings,
    updateSettings,
    status,
    online,
    lastError,
    session,
    remainingSeconds,
    now,
    busy,
    start,
    stop,
    refresh,
    topics,
    addTopic,
    renameTopic,
    deleteTopic,
    piSettings: status?.settings,
    savePiSettings,
    resetAllData,
    pending,
    pendingMinutes,
    syncPending,
    todayMinutes,
    goalMinutes,
    goalReached: todayMinutes >= goalMinutes,
    permissions,
    refreshPermissions: () => setPermissions(readPermissions()),
    toast,
    clearToast: () => setToast(null),
    notify,
    celebration,
    clearCelebration: () => setCelebration(null)
  };

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}
