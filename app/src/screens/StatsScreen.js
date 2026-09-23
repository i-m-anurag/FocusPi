import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { List, SegmentedButtons, Surface, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ContributionGraph } from '../components/ContributionGraph';
import { InfoTile } from '../components/InfoTile';
import { useFocus } from '../hooks/FocusContext';
import { formatLongDate, formatMinutes, formatSessionTime } from '../utils/format';

const STATUS_ICON = {
  completed: 'check-circle',
  cancelled: 'close-circle-outline',
  active: 'timer-sand'
};

export function StatsScreen() {
  const theme = useTheme();
  const { api, online, status, todayMinutes, goalMinutes, goalReached, pending } = useFocus();
  const [days, setDays] = useState('182');
  const [selectedDay, setSelectedDay] = useState(null);
  const [stats, setStats] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const [s, h] = await Promise.all([api.stats(Number(days)), api.history(30)]);
      setStats(s);
      setSessions(h.sessions);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [api, days]);

  // Reload when the tab opens, the range changes, or a session starts/ends.
  const focusId = status?.focus?.id ?? null;
  const lastId = status?.last_session?.id ?? null;
  useEffect(() => {
    load();
  }, [load, focusId, lastId]);

  const streak = stats?.streak;
  const totals = stats?.totals;
  const periodMinutes = (stats?.daily || []).reduce((sum, d) => sum + d.minutes, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <Text variant="headlineMedium" style={styles.bold}>Progress</Text>
        {error && !stats ? (
          <Text style={{ color: theme.colors.error }}>{online === false ? 'Pi offline. ' : ''}{error}</Text>
        ) : null}

        <Surface elevation={1} style={[styles.hero, { backgroundColor: theme.colors.primaryContainer }]}>
          <MaterialCommunityIcons name="fire" size={48} color={theme.colors.streak} />
          <View style={{ flex: 1 }}>
            <Text variant="displaySmall" style={[styles.bold, { color: theme.colors.onPrimaryContainer }]}>
              {streak?.current ?? 0} day{streak?.current === 1 ? '' : 's'}
            </Text>
            <Text variant="bodyMedium" style={{ color: theme.colors.onPrimaryContainer }}>
              {goalReached
                ? 'Today counted. Keep it going!'
                : `${formatMinutes(todayMinutes)} of ${formatMinutes(goalMinutes)} done today`}
            </Text>
            {pending.length > 0 ? (
              <Text variant="bodySmall" style={{ color: theme.colors.onPrimaryContainer }}>
                Includes {pending.length} session{pending.length === 1 ? '' : 's'} waiting to sync
              </Text>
            ) : null}
          </View>
        </Surface>

        <View style={styles.row}>
          <InfoTile icon="trophy-outline" value={`${streak?.best ?? 0} days`} label="Best streak" />
          <InfoTile icon="calendar-check" value={`${streak?.total_days ?? 0}`} label="Learning days" />
        </View>
        <View style={styles.row}>
          <InfoTile icon="clock-outline" value={formatMinutes(totals?.focused_minutes ?? 0)} label="Total focus" />
          <InfoTile icon="check-all" value={`${totals?.completed_sessions ?? 0}`} label="Sessions done" />
        </View>

        <Surface elevation={1} style={styles.card}>
          <View style={styles.cardHeader}>
            <Text variant="titleMedium">{formatMinutes(periodMinutes)} focused</Text>
          </View>
          <SegmentedButtons
            density="small"
            value={days}
            onValueChange={(v) => {
              setDays(v);
              setSelectedDay(null);
            }}
            style={{ marginBottom: 14 }}
            buttons={[
              { value: '182', label: '6 months' },
              { value: '365', label: '1 year' }
            ]}
          />
          {stats ? (
            <ContributionGraph
              daily={stats.daily}
              goal={streak?.goal_minutes ?? 60}
              selected={selectedDay}
              onSelect={(day) => setSelectedDay((cur) => (cur?.date === day.date ? null : day))}
            />
          ) : null}
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 8 }}>
            {selectedDay
              ? `${formatLongDate(new Date(`${selectedDay.date}T00:00:00`))} · ${
                  selectedDay.minutes ? formatMinutes(selectedDay.minutes) : 'no focus'
                }${selectedDay.counts_for_streak ? ' · goal reached' : ''}`
              : `Tap a day to see its minutes. A full square means the ${formatMinutes(
                  streak?.goal_minutes ?? 60
                )} goal was reached.`}
          </Text>
        </Surface>

        <Surface elevation={1} style={styles.card}>
          <Text variant="titleMedium" style={{ marginBottom: 8 }}>By topic</Text>
          {(stats?.topics || []).length === 0 ? (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              Nothing in this period yet.
            </Text>
          ) : (
            stats.topics.map((t) => {
              const top = stats.topics[0].minutes || 1;
              return (
                <View key={t.name} style={styles.topicRow}>
                  <Text variant="bodyMedium" numberOfLines={1} style={styles.topicName}>{t.name}</Text>
                  <View style={styles.topicTrack}>
                    <View
                      style={{
                        width: `${Math.max(3, (t.minutes / top) * 100)}%`,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: theme.colors.primary
                      }}
                    />
                  </View>
                  <Text variant="bodySmall" style={styles.topicValue}>{formatMinutes(t.minutes)}</Text>
                </View>
              );
            })
          )}
        </Surface>

        <Surface elevation={1} style={styles.card}>
          <Text variant="titleMedium" style={{ marginBottom: 4 }}>Recent sessions</Text>
          {sessions.length === 0 ? (
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
              No sessions yet. Start your first focus!
            </Text>
          ) : (
            sessions.map((s) => (
              <List.Item
                key={s.id}
                title={s.label || 'Focus session'}
                description={`${formatSessionTime(s.started_at)} · ${formatMinutes(Math.floor(s.elapsed_seconds / 60))} of ${s.planned_minutes}m`}
                left={(props) => (
                  <List.Icon
                    {...props}
                    icon={STATUS_ICON[s.status]}
                    color={s.status === 'completed' ? theme.colors.success : theme.colors.onSurfaceVariant}
                  />
                )}
                style={styles.listItem}
              />
            ))
          )}
        </Surface>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32, gap: 12 },
  bold: { fontWeight: '700' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20, borderRadius: 24 },
  row: { flexDirection: 'row', gap: 12 },
  card: { padding: 16, borderRadius: 20 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  topicName: { width: 96 },
  topicTrack: { flex: 1 },
  topicValue: { width: 52, textAlign: 'right', fontVariant: ['tabular-nums'] },
  listItem: { paddingHorizontal: 0 }
});
