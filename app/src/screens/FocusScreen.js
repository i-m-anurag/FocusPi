import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Banner,
  Button,
  Chip,
  Dialog,
  IconButton,
  Portal,
  Surface,
  Text,
  TextInput,
  useTheme
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { openPolicyAccessSettings } from '../../modules/focus-dnd';
import { InfoTile } from '../components/InfoTile';
import { TimerRing } from '../components/TimerRing';
import { useFocus } from '../hooks/FocusContext';
import { formatClock, formatCountdown, formatLongDate, formatMinutes } from '../utils/format';
import { weatherIcon } from '../utils/weather';

const PRESETS = [15, 25, 30, 45, 60, 90];

export function FocusScreen() {
  const theme = useTheme();
  const {
    settings,
    updateSettings,
    status,
    online,
    session,
    remainingSeconds,
    now,
    busy,
    start,
    stop,
    permissions,
    celebration,
    clearCelebration
  } = useFocus();

  const [minutes, setMinutes] = useState(30);
  const [label, setLabel] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => {
    if (settings) {
      setMinutes(settings.defaultMinutes);
      setLabel(settings.lastLabel || '');
    }
  }, [settings?.defaultMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = Boolean(session) && remainingSeconds > 0;
  const total = session?.totalSeconds || remainingSeconds || 1;
  const progress = running ? 1 - remainingSeconds / total : 0;
  const clock = new Date(now);
  const weather = status?.weather;
  const streak = status?.streak;
  const today = status?.today;

  const onStart = () => {
    updateSettings({ lastLabel: label.trim() });
    start(minutes, label.trim());
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header: phone clock + Pi connection */}
        <View style={styles.header}>
          <View>
            <Text variant="headlineMedium" style={styles.bold}>{formatClock(clock)}</Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              {formatLongDate(clock)}
            </Text>
          </View>
          <Chip
            compact
            icon={online ? 'raspberry-pi' : 'lan-disconnect'}
            style={{ backgroundColor: online ? theme.colors.primaryContainer : theme.colors.errorContainer }}
            textStyle={{ color: online ? theme.colors.onPrimaryContainer : theme.colors.onErrorContainer }}
          >
            {online == null ? 'Connecting' : online ? 'Pi online' : 'Pi offline'}
          </Chip>
        </View>

        {permissions.dndSupported && !permissions.dnd ? (
          <Banner
            visible
            icon="bell-off-outline"
            actions={[{ label: 'Allow access', onPress: openPolicyAccessSettings }]}
            style={styles.banner}
          >
            FocusPi needs Do Not Disturb access to silence notifications and let only calls through.
          </Banner>
        ) : null}
        {!permissions.dndSupported ? (
          <Banner visible icon="information-outline" style={styles.banner}>
            DND control needs the Android build of this app (not Expo Go / iOS). The timer, OLED and
            streak still work.
          </Banner>
        ) : null}

        {/* Weather + streak */}
        <View style={styles.row}>
          <InfoTile
            icon={weather ? weatherIcon(weather.icon) : 'weather-cloudy-alert'}
            value={weather ? `${weather.temperature}°C` : '--'}
            label={weather ? `${weather.text} · ${weather.city}` : 'No weather yet'}
          />
          <InfoTile
            icon="fire"
            iconColor={streak?.today_done ? theme.colors.streak : theme.colors.onSurfaceVariant}
            value={`${streak?.current ?? 0} day${streak?.current === 1 ? '' : 's'}`}
            label={streak?.today_done ? 'Today counted' : `${formatMinutes(today?.minutes ?? 0)} today`}
          />
        </View>

        {celebration && !running ? (
          <Surface elevation={0} style={[styles.celebrate, { backgroundColor: theme.colors.tertiaryContainer }]}>
            <Text variant="titleMedium" style={{ color: theme.colors.onTertiaryContainer, flex: 1 }}>
              Session complete: +{celebration.planned_minutes} min. Take a 5 minute break.
            </Text>
            <IconButton icon="close" size={18} onPress={clearCelebration} iconColor={theme.colors.onTertiaryContainer} />
          </Surface>
        ) : null}

        {/* Timer */}
        <View style={styles.ringWrap}>
          <TimerRing
            active={running}
            progress={progress}
            title={formatCountdown(running ? remainingSeconds : minutes * 60)}
            subtitle={running ? (session.label || 'Focusing, calls only') : 'Ready to focus'}
          />
        </View>

        {running ? (
          <>
            <Text variant="bodyMedium" style={[styles.center, { color: theme.colors.onSurfaceVariant }]}>
              Notifications are silenced. Calls still ring.
            </Text>
            <Button
              mode="contained-tonal"
              icon="stop"
              onPress={() => setConfirmStop(true)}
              loading={busy}
              disabled={busy}
              style={styles.mainButton}
              contentStyle={styles.mainButtonContent}
            >
              Stop focus
            </Button>
          </>
        ) : (
          <>
            <View style={styles.chips}>
              {PRESETS.map((m) => (
                <Chip key={m} selected={minutes === m} showSelectedOverlay onPress={() => setMinutes(m)}>
                  {m} min
                </Chip>
              ))}
            </View>
            <View style={styles.stepper}>
              <IconButton icon="minus" mode="outlined" onPress={() => setMinutes((m) => Math.max(1, m - 5))} />
              <Text variant="titleLarge" style={styles.stepperText}>{minutes} min</Text>
              <IconButton icon="plus" mode="outlined" onPress={() => setMinutes((m) => Math.min(240, m + 5))} />
            </View>
            <TextInput
              mode="outlined"
              label="What are you learning? (optional)"
              value={label}
              onChangeText={setLabel}
              maxLength={60}
              left={<TextInput.Icon icon="book-open-variant" />}
              style={styles.input}
            />
            <Button
              mode="contained"
              icon="play"
              onPress={onStart}
              loading={busy}
              disabled={busy || online === false}
              style={styles.mainButton}
              contentStyle={styles.mainButtonContent}
            >
              {online === false ? 'Pi offline' : 'Start focus'}
            </Button>
          </>
        )}
      </ScrollView>

      <Portal>
        <Dialog visible={confirmStop} onDismiss={() => setConfirmStop(false)}>
          <Dialog.Title>Stop early?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Only {formatMinutes(Math.floor((total - remainingSeconds) / 60))} will be saved.
              Sessions stopped early count toward your streak only if they reach the minimum set on the Pi.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmStop(false)}>Keep going</Button>
            <Button
              onPress={() => {
                setConfirmStop(false);
                stop();
              }}
            >
              Stop
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bold: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  banner: { borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 12 },
  celebrate: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingLeft: 16 },
  ringWrap: { alignItems: 'center', marginVertical: 8 },
  center: { textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepperText: { minWidth: 90, textAlign: 'center', fontVariant: ['tabular-nums'] },
  input: { marginTop: 4 },
  mainButton: { borderRadius: 28, marginTop: 4 },
  mainButtonContent: { height: 56 }
});
