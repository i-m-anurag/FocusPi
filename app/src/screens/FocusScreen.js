import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Banner,
  Button,
  Chip,
  Dialog,
  Divider,
  IconButton,
  Menu,
  Portal,
  ProgressBar,
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
    topics,
    addTopic,
    pending,
    syncPending,
    todayMinutes,
    goalMinutes,
    goalReached,
    permissions,
    celebration,
    clearCelebration
  } = useFocus();

  const [minutes, setMinutes] = useState(30);
  const [topicId, setTopicId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [newTopic, setNewTopic] = useState(null); // null = dialog closed
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => {
    if (settings) {
      setMinutes(settings.defaultMinutes);
      setTopicId((cur) => cur ?? settings.lastTopicId ?? null);
    }
  }, [settings?.defaultMinutes]); // eslint-disable-line react-hooks/exhaustive-deps

  const topic = useMemo(() => topics.find((t) => t.id === topicId) || null, [topics, topicId]);
  const running = Boolean(session) && remainingSeconds > 0;
  const total = session?.totalSeconds || remainingSeconds || 1;
  const progress = running ? 1 - remainingSeconds / total : 0;
  const clock = new Date(now);
  const weather = status?.weather;
  const streak = status?.streak;

  const chooseTopic = (id) => {
    setTopicId(id);
    setMenuOpen(false);
    updateSettings({ lastTopicId: id });
  };

  const createTopic = async () => {
    const name = (newTopic || '').trim();
    setNewTopic(null);
    if (!name) return;
    const id = await addTopic(name);
    if (id) chooseTopic(id);
  };

  const onStart = () => start(minutes, { topicId: topic?.id ?? null, label: topic?.name ?? '' });

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
          <View style={styles.headerChips}>
            {pending.length > 0 ? (
              <Chip compact icon="cloud-upload-outline" onPress={syncPending}>
                {pending.length}
              </Chip>
            ) : null}
            <Chip
              compact
              icon={online ? 'raspberry-pi' : 'cellphone-cog'}
              style={{ backgroundColor: online ? theme.colors.primaryContainer : theme.colors.secondaryContainer }}
              textStyle={{ color: online ? theme.colors.onPrimaryContainer : theme.colors.onSecondaryContainer }}
            >
              {online == null ? 'Connecting' : online ? 'Pi online' : 'On phone'}
            </Chip>
          </View>
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

        {/* Weather + streak */}
        <View style={styles.row}>
          <InfoTile
            icon={weather ? weatherIcon(weather.icon) : 'weather-cloudy-alert'}
            value={weather ? `${weather.temperature}°C` : '--'}
            label={weather ? `${weather.text} · ${weather.city}` : 'No weather yet'}
          />
          <InfoTile
            icon="fire"
            iconColor={goalReached ? theme.colors.streak : theme.colors.onSurfaceVariant}
            value={`${streak?.current ?? 0} day${streak?.current === 1 ? '' : 's'}`}
            label={goalReached ? 'Goal reached today' : 'Streak'}
          />
        </View>

        {/* Daily goal */}
        <Surface elevation={1} style={styles.goalCard}>
          <View style={styles.goalHeader}>
            <Text variant="titleSmall">Today's goal</Text>
            <Text variant="titleSmall" style={styles.tabular}>
              {formatMinutes(todayMinutes)} / {formatMinutes(goalMinutes)}
            </Text>
          </View>
          <ProgressBar
            progress={Math.min(1, goalMinutes ? todayMinutes / goalMinutes : 0)}
            color={goalReached ? theme.colors.success : theme.colors.primary}
            style={styles.goalBar}
          />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {goalReached
              ? 'Streak secured for today. Anything more is a bonus.'
              : `${formatMinutes(Math.max(0, goalMinutes - todayMinutes))} more to keep your streak`}
          </Text>
        </Surface>

        {celebration && !running ? (
          <Surface elevation={0} style={[styles.celebrate, { backgroundColor: theme.colors.tertiaryContainer }]}>
            <Text variant="titleMedium" style={{ color: theme.colors.onTertiaryContainer, flex: 1 }}>
              Session complete: +{celebration.planned_minutes} min.
              {celebration.offline ? ' Saved on your phone.' : ''} Take a break.
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
            subtitle={running ? (session.label || 'Focusing, calls only') : (topic?.name ?? 'Ready to focus')}
          />
        </View>

        {running ? (
          <>
            <Text variant="bodyMedium" style={[styles.center, { color: theme.colors.onSurfaceVariant }]}>
              {session.offline
                ? 'Running on your phone. It will sync to the Pi later.'
                : 'Notifications are silenced. Calls still ring.'}
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
            {/* Learning topic */}
            <Menu
              visible={menuOpen}
              onDismiss={() => setMenuOpen(false)}
              anchorPosition="bottom"
              anchor={
                <Button
                  mode="outlined"
                  icon="book-open-variant"
                  contentStyle={styles.topicButton}
                  onPress={() => setMenuOpen(true)}
                >
                  {topic ? topic.name : 'Choose what you are learning'}
                </Button>
              }
            >
              {topics.map((t) => (
                <Menu.Item
                  key={t.id}
                  title={t.name}
                  onPress={() => chooseTopic(t.id)}
                  trailingIcon={t.id === topicId ? 'check' : undefined}
                />
              ))}
              {topics.length === 0 ? <Menu.Item title="No topics yet" disabled /> : null}
              <Divider />
              {topic ? <Menu.Item title="No topic" onPress={() => chooseTopic(null)} /> : null}
              <Menu.Item
                title="Add new topic"
                leadingIcon="plus"
                onPress={() => {
                  setMenuOpen(false);
                  setNewTopic('');
                }}
              />
            </Menu>

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
            <Button
              mode="contained"
              icon="play"
              onPress={onStart}
              loading={busy}
              disabled={busy}
              style={styles.mainButton}
              contentStyle={styles.mainButtonContent}
            >
              Start focus
            </Button>
            {online === false ? (
              <Text variant="bodySmall" style={[styles.center, { color: theme.colors.onSurfaceVariant }]}>
                The Pi is not reachable. Your session runs on the phone and syncs later.
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>

      <Portal>
        <Dialog visible={newTopic !== null} onDismiss={() => setNewTopic(null)}>
          <Dialog.Title>New learning topic</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label="Name"
              placeholder="e.g. System design"
              value={newTopic ?? ''}
              onChangeText={setNewTopic}
              maxLength={60}
              autoFocus
            />
            {online === false ? (
              <Text variant="bodySmall" style={{ marginTop: 8, color: theme.colors.error }}>
                Topics are stored on the Pi, so you need to be connected to add one.
              </Text>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setNewTopic(null)}>Cancel</Button>
            <Button onPress={createTopic}>Add</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={confirmStop} onDismiss={() => setConfirmStop(false)}>
          <Dialog.Title>Stop early?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              You have focused {formatMinutes(Math.floor((total - remainingSeconds) / 60))} so far.
              Sessions stopped early still count towards today's goal if they reach 10 minutes.
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
  headerChips: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  bold: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  tabular: { fontVariant: ['tabular-nums'] },
  banner: { borderRadius: 16, overflow: 'hidden' },
  row: { flexDirection: 'row', gap: 12 },
  goalCard: { padding: 14, borderRadius: 16, gap: 8 },
  goalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalBar: { height: 8, borderRadius: 4 },
  celebrate: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingLeft: 16 },
  ringWrap: { alignItems: 'center', marginVertical: 4 },
  center: { textAlign: 'center' },
  topicButton: { height: 48 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepperText: { minWidth: 90, textAlign: 'center', fontVariant: ['tabular-nums'] },
  mainButton: { borderRadius: 28, marginTop: 4 },
  mainButtonContent: { height: 56 }
});
