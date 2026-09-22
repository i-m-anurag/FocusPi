import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, HelperText, List, SegmentedButtons, Surface, Switch, Text, TextInput, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openExactAlarmSettings, openPolicyAccessSettings } from '../../modules/focus-dnd';
import { createApi } from '../api/client';
import { useFocus } from '../hooks/FocusContext';

export function SettingsScreen() {
  const theme = useTheme();
  const { settings, updateSettings, permissions, refresh, notify } = useFocus();
  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultMinutes, setDefaultMinutes] = useState('30');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (!settings) return;
    setServerUrl(settings.serverUrl);
    setApiKey(settings.apiKey);
    setDefaultMinutes(String(settings.defaultMinutes));
  }, [settings]);

  if (!settings) return null;

  const saveServer = async () => {
    const mins = Math.min(240, Math.max(1, parseInt(defaultMinutes, 10) || 30));
    await updateSettings({ serverUrl: serverUrl.trim(), apiKey: apiKey.trim(), defaultMinutes: mins });
    notify('Saved');
    refresh();
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // /api/status needs the key, so this checks the URL and the key together.
      const data = await createApi({ serverUrl, apiKey }).status();
      const drift = Math.round(data.server_time - Date.now() / 1000);
      setTestResult({ ok: true, text: `Connected. Pi clock is ${Math.abs(drift) <= 2 ? 'in sync' : `${drift}s off`}.` });
    } catch (e) {
      setTestResult({ ok: false, text: e.status === 401 ? 'Wrong API key' : e.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="headlineMedium" style={styles.bold}>Settings</Text>

        <Surface elevation={1} style={styles.card}>
          <Text variant="titleMedium">Raspberry Pi</Text>
          <TextInput
            mode="outlined"
            label="Server URL"
            placeholder="http://192.168.1.50:5050"
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextInput
            mode="outlined"
            label="API key (from deploy.sh output)"
            value={apiKey}
            onChangeText={setApiKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <TextInput
            mode="outlined"
            label="Default focus length (minutes)"
            value={defaultMinutes}
            onChangeText={setDefaultMinutes}
            keyboardType="number-pad"
          />
          {testResult ? (
            <HelperText type={testResult.ok ? 'info' : 'error'} visible>
              {testResult.text}
            </HelperText>
          ) : null}
          <View style={styles.buttons}>
            <Button mode="outlined" onPress={testConnection} loading={testing}>Test</Button>
            <Button mode="contained" onPress={saveServer}>Save</Button>
          </View>
        </Surface>

        <Surface elevation={1} style={styles.card}>
          <Text variant="titleMedium">During focus, who can call?</Text>
          <SegmentedButtons
            value={settings.callers}
            onValueChange={(callers) => updateSettings({ callers })}
            buttons={[
              { value: 'any', label: 'Anyone' },
              { value: 'contacts', label: 'Contacts' },
              { value: 'starred', label: 'Starred' }
            ]}
          />
          <List.Item
            title="Repeat callers"
            description="Let a second call from the same person within 15 min ring"
            right={() => (
              <Switch value={settings.repeatCallers} onValueChange={(v) => updateSettings({ repeatCallers: v })} />
            )}
            style={styles.item}
          />
          <List.Item
            title="Allow alarms"
            description="Clock alarms still ring during focus"
            right={() => (
              <Switch value={settings.allowAlarms} onValueChange={(v) => updateSettings({ allowAlarms: v })} />
            )}
            style={styles.item}
          />
          <HelperText type="info" visible>
            Applies from the next focus session. All other notifications arrive silently.
          </HelperText>
        </Surface>

        <Surface elevation={1} style={styles.card}>
          <Text variant="titleMedium">Permissions</Text>
          {permissions.dndSupported ? (
            <>
              <List.Item
                title="Do Not Disturb access"
                description={permissions.dnd ? 'Granted' : 'Required to silence notifications'}
                left={(p) => <List.Icon {...p} icon={permissions.dnd ? 'check-circle' : 'alert-circle'} color={permissions.dnd ? theme.colors.success : theme.colors.error} />}
                right={() => (permissions.dnd ? null : <Button onPress={openPolicyAccessSettings}>Grant</Button>)}
                style={styles.item}
              />
              <List.Item
                title="Exact alarms"
                description={permissions.exactAlarms ? 'Granted: DND ends exactly on time' : 'Without it, DND may end a few minutes late'}
                left={(p) => <List.Icon {...p} icon={permissions.exactAlarms ? 'check-circle' : 'alert-circle-outline'} color={permissions.exactAlarms ? theme.colors.success : theme.colors.tertiary} />}
                right={() => (permissions.exactAlarms ? null : <Button onPress={openExactAlarmSettings}>Grant</Button>)}
                style={styles.item}
              />
            </>
          ) : (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Controlling Do Not Disturb is only possible in the Android build of this app. iOS does not
              allow apps to change Focus modes.
            </Text>
          )}
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  bold: { fontWeight: '700' },
  card: { padding: 16, borderRadius: 20, gap: 12 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  item: { paddingHorizontal: 0 }
});
