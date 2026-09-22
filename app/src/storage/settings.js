import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'focuspi.settings';

export const DEFAULT_SETTINGS = {
  serverUrl: 'http://192.168.1.50:5050',
  apiKey: '',
  defaultMinutes: 30,
  // Who can still call you during focus: 'any' | 'contacts' | 'starred'
  callers: 'any',
  repeatCallers: true,
  allowAlarms: true,
  lastLabel: ''
};

export async function loadSettings() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings) {
  await AsyncStorage.setItem(KEY, JSON.stringify(settings));
}
