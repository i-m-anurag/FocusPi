import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import {
  Button,
  Chip,
  Dialog,
  HelperText,
  IconButton,
  List,
  Portal,
  SegmentedButtons,
  Surface,
  Switch,
  Text,
  TextInput,
  useTheme
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openExactAlarmSettings, openPolicyAccessSettings } from '../../modules/focus-dnd';
import { createApi } from '../api/client';
import { useFocus } from '../hooks/FocusContext';
import { formatMinutes } from '../utils/format';

const GOAL_PRESETS = [30, 45, 60, 90, 120];
const ALARM_SECONDS = [5, 15, 30, 60];

export function SettingsScreen() {
  const theme = useTheme();
  const {
    settings,
    updateSettings,
    permissions,
    refresh,
    notify,
    online,
    topics,
    addTopic,
    renameTopic,
    deleteTopic,
    piSettings,
    savePiSettings,
    resetAllData,
    pending,
    syncPending,
    busy,
    alarmPlaying,
    stopAlarm,
    previewAlarm
  } = useFocus();

  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [defaultMinutes, setDefaultMinutes] = useState('30');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [brightness, setBrightness] = useState(255);
  const [topicDialog, setTopicDialog] = useState(null); // {id?, name}
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTopics, setResetTopics] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setServerUrl(settings.serverUrl);
    setApiKey(settings.apiKey);
    setDefaultMinutes(String(settings.defaultMinutes));
  }, [settings]);

  useEffect(() => {
    if (piSettings?.oled_brightness != null) setBrightness(piSettings.oled_brightness);
  }, [piSettings?.oled_brightness]);

  if (!settings) return null;

  const goal = piSettings?.daily_goal_minutes ?? 60;

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
      const data = await createApi({ serverUrl, apiKey }).status();
      const drift = Math.round(data.server_time - Date.now() / 1000);
      setTestResult({ ok: true, text: `Connected. Pi clock is ${Math.abs(drift) <= 2 ? 'in sync' : `${drift}s off`}.` });
    } catch (e) {
      setTestResult({ ok: false, text: e.status === 401 ? 'Wrong API key' : e.message });
    } finally {
      setTesting(false);
    }
  };

  const submitTopic = async () => {
    const dialog = topicDialog;
    setTopicDialog(null);
    const name = (dialog?.name || '').trim();
    if (!name) return;
    if (dialog.id) await renameTopic(dialog.id, name);
    else await addTopic(name);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="headlineMedium" style={styles.bold}>Settings</Text>

        {/* --- Learning list ------------------------------------------------- */}
        <Surface elevation={1} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text variant="titleMedium">What I'm learning</Text>
            <Button icon="plus" onPress={() => setTopicDialog({ name: '' })} disabled={online === false}>
              Add
            </Button>
          </View>
          {topics.length === 0 ? (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              No topics yet. Add the subjects you are learning and pick one when you start a session.
            </Text>
          ) : (
            topics.map((t) => (
              <List.Item
                key={t.id}
                title={t.name}
                description={t.focused_minutes ? `${formatMinutes(t.focused_minutes)} focused · ${t.completed_sessions} sessions` : 'Not started yet'}
                left={(props) => <List.Icon {...props} icon="book-open-variant" />}
                right={() => (
                  <View style={styles.rowRight}>
                    <IconButton icon="pencil" size={18} onPress={() => setTopicDialog({ id: t.id, name: t.name })} />
                    <IconButton icon="delete-outline" size={18} onPress={() => setConfirmDelete(t)} />
                  </View>
                )}
                style={styles.item}
              />
            ))
          )}
          {online === false ? (
            <HelperText type="info" visible>
              Your list is stored on the Pi. Connect to it to make changes.
            </HelperText>
          ) : null}
        </Surface>

        {/* --- Daily goal ----------------------------------------------------- */}
        <Surface elevation={1} style={styles.card}>
          <Text variant="titleMedium">Daily goal</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Focus this many minutes in a day and the day counts towards your streak. Sessions add
            up across the day.
          </Text>
          <View style={styles.chips}>
            {GOAL_PRESETS.map((m) => (
              <Chip
                key={m}
                selected={goal === m}
                showSelectedOverlay
                disabled={online === false}
                onPress={() => savePiSettings({ daily_goal_minutes: m })}
              >
                {formatMinutes(m)}
              </Chip>
            ))}
          </View>
        </Surface>

        {/* --- OLED ------------------------------------------------------------ */}
        <Surface elevation={1} style={styles.card}>
          <Text variant="titleMedium">OLED screen</Text>
          <View style={styles.brightnessRow}>
            <IconButton icon="brightness-5" size={18} disabled />
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={255}
              step={1}
              value={brightness}
              disabled={online === false}
              onValueChange={setBrightness}
              onSlidingComplete={(v) => savePiSettings({ oled_brightness: Math.round(v) })}
              minimumTrackTintColor={theme.colors.primary}
              maximumTrackTintColor={theme.colors.surfaceVariant}
              thumbTintColor={theme.colors.primary}
            />
            <IconButton icon="brightness-7" size={22} disabled />
          </View>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, textAlign: 'center' }}>
            Brightness {Math.round((brightness / 255) * 100)}%
          </Text>
          <List.Item
            title="Dim at night"
            description="Lower the brightness between 23:00 and 06:00"
            right={() => (
              <Switch
                value={Boolean(piSettings?.oled_night_dim)}
                disabled={online === false}
                onValueChange={(v) => savePiSettings({ oled_night_dim: v })}
              />
            )}
            style={styles.item}
          />
        </Surface>

        {/* --- End-of-session alarm --------------------------------------------- */}
        <Surface elevation={1} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text variant="titleMedium">Alarm when a session ends</Text>
            <Switch
              value={settings.alarmEnabled}
              onValueChange={(v) => updateSettings({ alarmEnabled: v })}
            />
          </View>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Rings even if the app is closed, and stays audible during Do Not Disturb as long as
            alarms are allowed.
          </Text>
          {settings.alarmEnabled ? (
            <>
              <SegmentedButtons
                value={settings.alarmSound}
                onValueChange={(alarmSound) => updateSettings({ alarmSound })}
                buttons={[
                  { value: 'alarm', label: 'Alarm' },
                  { value: 'ringtone', label: 'Ringtone' },
                  { value: 'notification', label: 'Chime' }
                ]}
              />
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                Rings for
              </Text>
              <View style={styles.chips}>
                {ALARM_SECONDS.map((sec) => (
                  <Chip
                    key={sec}
                    selected={settings.alarmSeconds === sec}
                    showSelectedOverlay
                    onPress={() => updateSettings({ alarmSeconds: sec })}
                  >
                    {sec}s
                  </Chip>
                ))}
              </View>
              <List.Item
                title="Vibrate"
                description="Buzz along with the alarm"
                right={() => (
                  <Switch
                    value={settings.alarmVibrate}
                    onValueChange={(v) => updateSettings({ alarmVibrate: v })}
                  />
                )}
                style={styles.item}
              />
              <Button
                mode="outlined"
                icon={alarmPlaying ? 'bell-off' : 'bell-ring-outline'}
                onPress={alarmPlaying ? stopAlarm : previewAlarm}
                disabled={!permissions.dndSupported}
              >
                {alarmPlaying ? 'Stop' : 'Test alarm'}
              </Button>
              {settings.alarmSound === 'alarm' ? (
                <HelperText type="info" visible>
                  Uses your phone's alarm volume, so check it is turned up.
                </HelperText>
              ) : null}
            </>
          ) : null}
        </Surface>

        {/* --- Raspberry Pi ----------------------------------------------------- */}
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
          {pending.length > 0 ? (
            <List.Item
              title={`${pending.length} session${pending.length === 1 ? '' : 's'} waiting to sync`}
              description="Recorded on your phone while the Pi was unreachable"
              left={(p) => <List.Icon {...p} icon="cloud-upload-outline" />}
              right={() => <Button onPress={syncPending}>Sync now</Button>}
              style={styles.item}
            />
          ) : null}
        </Surface>

        {/* --- DND -------------------------------------------------------------- */}
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

        {/* --- Permissions ------------------------------------------------------- */}
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
        {/* --- Fresh start -------------------------------------------------- */}
        <Surface elevation={1} style={styles.card}>
          <Text variant="titleMedium">Fresh start</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            Deletes every focus session on the Pi and anything stored on this phone, so your
            streak, history and totals start from zero. Your goal, brightness and connection
            settings are kept. This cannot be undone.
          </Text>
          <Button
            mode="outlined"
            icon="delete-sweep-outline"
            textColor={theme.colors.error}
            disabled={online !== true || busy}
            onPress={() => {
              setResetTopics(false);
              setResetOpen(true);
            }}
          >
            {online === true ? 'Fresh start' : 'Connect to the Pi first'}
          </Button>
        </Surface>
      </ScrollView>

      <Portal>
        <Dialog visible={topicDialog !== null} onDismiss={() => setTopicDialog(null)}>
          <Dialog.Title>{topicDialog?.id ? 'Rename topic' : 'New learning topic'}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Name"
              placeholder="e.g. System design"
              value={topicDialog?.name ?? ''}
              onChangeText={(name) => setTopicDialog((d) => ({ ...d, name }))}
              maxLength={60}
              autoFocus
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setTopicDialog(null)}>Cancel</Button>
            <Button onPress={submitTopic}>{topicDialog?.id ? 'Rename' : 'Add'}</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={resetOpen} onDismiss={() => setResetOpen(false)}>
          <Dialog.Icon icon="alert" color={theme.colors.error} />
          <Dialog.Title style={{ textAlign: 'center' }}>Delete all your data?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Every session, your streak and all totals will be deleted from the Pi and this
              phone. There is no way to get them back.
            </Text>
            <List.Item
              title="Also delete my topic list"
              description={resetTopics ? 'The learning list will be emptied too' : 'Your topics are kept'}
              right={() => <Switch value={resetTopics} onValueChange={setResetTopics} />}
              style={styles.item}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setResetOpen(false)}>Cancel</Button>
            <Button
              textColor={theme.colors.error}
              loading={busy}
              onPress={() => {
                setResetOpen(false);
                resetAllData(resetTopics);
              }}
            >
              Delete everything
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={confirmDelete !== null} onDismiss={() => setConfirmDelete(null)}>
          <Dialog.Title>Remove "{confirmDelete?.name}"?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              It disappears from the list you pick from. Past sessions keep the name, and your
              streak and totals are unchanged.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              textColor={theme.colors.error}
              onPress={() => {
                const t = confirmDelete;
                setConfirmDelete(null);
                deleteTopic(t.id);
              }}
            >
              Remove
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  bold: { fontWeight: '700' },
  card: { padding: 16, borderRadius: 20, gap: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { paddingHorizontal: 0 },
  rowRight: { flexDirection: 'row', alignItems: 'center' },
  brightnessRow: { flexDirection: 'row', alignItems: 'center' },
  slider: { flex: 1, height: 40 }
});
