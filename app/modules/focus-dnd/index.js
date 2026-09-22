import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

/**
 * JS wrapper around the local Android module that controls Do Not Disturb.
 * `null` native module means: iOS, Expo Go, or a build made before this
 * module was added — the app then runs the timer without controlling DND.
 */
const Native = Platform.OS === 'android' ? requireOptionalNativeModule('FocusDnd') : null;

export const isDndSupported = Native != null;

export function hasPolicyAccess() {
  return Native ? Native.hasPolicyAccess() : false;
}

export function openPolicyAccessSettings() {
  Native?.openPolicyAccessSettings();
}

export function canScheduleExactAlarms() {
  return Native ? Native.canScheduleExactAlarms() : true;
}

export function openExactAlarmSettings() {
  Native?.openExactAlarmSettings();
}

/**
 * Turn on "calls only" DND until `endAtMs` (epoch ms). Android turns it back
 * off by itself at that time, even if the app is closed.
 */
export function startFocus(endAtMs, { callers = 'any', repeatCallers = true, allowAlarms = true, label = '' } = {}) {
  if (!Native) return false;
  return Native.startFocus(endAtMs, callers, repeatCallers, allowAlarms, label || '');
}

export function stopFocus(completed = false) {
  if (!Native) return false;
  return Native.stopFocus(completed);
}

export function getFocusState() {
  if (!Native) {
    return { active: false, endAtMs: 0, label: '', hasPolicyAccess: false, canScheduleExactAlarms: true };
  }
  return Native.getState();
}
