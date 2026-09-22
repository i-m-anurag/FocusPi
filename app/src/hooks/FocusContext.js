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

/**
 * Single source of truth for the app.
 *
 * The Raspberry Pi owns the session (it starts it, times it, records it and
 * drives the OLED). The phone mirrors it: it shows the countdown and keeps
 * Android DND in "calls only" mode until the session's end time. Native code
 * turns DND off on time even if this app is closed.
 */
export function FocusProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState(null);
  const [online, setOnline] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [session, setSession] = useState(null); // { id, label, endAtMs, totalSeconds }
  const [permissions, setPermissions] = useState(readPermissions);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const [now, setNow] = useState(Date.now());

  const sessionRef = useRef(null);
  const settingsRef = useRef(null);
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

  // ---- apply the Pi's view of the world --------------------------------------
  const applyServerFocus = useCallback((focus, lastSession) => {
    const prev = sessionRef.current;
    if (focus && focus.remaining_seconds > 0) {
      const endAtMs = Date.now() + focus.remaining_seconds * 1000;
      const pending = pendingStopRef.current;
      if (pending && (pending.id === focus.id || Math.abs(pending.endAtMs - endAtMs) < 10000)) {
        // Don't turn DND back on; finish the stop on the Pi instead.
        api?.stop().then(() => { pendingStopRef.current = null; }).catch(() => {});
        return;
      }
      const next = {
        id: focus.id,
        label: focus.label || '',
        endAtMs,
        totalSeconds: focus.total_seconds
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
      applyServerFocus(data.focus, data.last_session);
      return data;
    } catch (e) {
      setOnline(false);
      setLastError(e.message);
      // Keep counting locally; if the phone's own timer ran out, release DND.
      const cur = sessionRef.current;
      if (cur && cur.endAtMs <= Date.now()) {
        setSession(null);
        releaseNativeFocus();
      }
      return null;
    }
  }, [api, applyServerFocus, releaseNativeFocus]);

  // ---- boot ----------------------------------------------------------------------
  useEffect(() => {
    loadSettings().then(setSettings);
    // Show a running session immediately, even before the Pi answers.
    const st = getFocusState();
    if (st.active && st.endAtMs > Date.now()) {
      setSession({ id: null, label: st.label, endAtMs: st.endAtMs, totalSeconds: null });
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

  // When the local countdown hits zero, ask the Pi to confirm quickly.
  const remainingSeconds = session ? Math.max(0, (session.endAtMs - now) / 1000) : 0;
  const timerDone = Boolean(session) && remainingSeconds <= 0;
  useEffect(() => {
    if (!timerDone) return undefined;
    const t = setTimeout(refresh, 1500);
    return () => clearTimeout(t);
  }, [timerDone, refresh]);

  // ---- actions -----------------------------------------------------------------
  const start = useCallback(async (minutes, label) => {
    if (!api) return;
    setBusy(true);
    try {
      const res = await api.start(minutes, label);
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
      } else {
        notify(e.message);
      }
    } finally {
      setBusy(false);
    }
  }, [api, applyServerFocus, notify, refresh]);

  const stop = useCallback(async () => {
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
  }, [api, notify, refresh]);

  const updateSettings = useCallback(async (patch) => {
    const next = { ...settingsRef.current, ...patch };
    setSettings(next);
    await saveSettings(next);
    return next;
  }, []);

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
