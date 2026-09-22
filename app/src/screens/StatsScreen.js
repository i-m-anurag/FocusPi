import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { List, SegmentedButtons, Surface, Text, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InfoTile } from '../components/InfoTile';
import { useFocus } from '../hooks/FocusContext';
import { formatMinutes, formatSessionTime, weekdayOf } from '../utils/format';

const STATUS_ICON = {
  completed: 'check-circle',
  cancelled: 'close-circle-outline',
  active: 'timer-sand'
};

function BarChart({ daily }) {
  const theme = useTheme();
  const max = Math.max(30, ...daily.map((d) => d.minutes));
  const compact = daily.length > 14;
  return (
    <View style={styles.chart}>
      {daily.map((d) => (
        <View key={d.date} style={styles.barCol}>
          <View style={styles.barTrack}>
            <View
              style={{
                height: `${Math.max(d.minutes ? 4 : 0, (d.minutes / max) * 100)}%`,
                backgroundColor: d.counts_for_streak ? theme.colors.primary : theme.colors.outlineVariant,
                borderRadius: compact ? 2 : 6
              }}
            />
          </View>
          {!compact ? (
            <>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {d.minutes ? formatMinutes(d.minutes) : ''}
              </Text>
              <Text variant="labelSmall">{weekdayOf(d.date)}</Text>
            </>
          ) : null}
        </View>
      ))}
    </View>
  );
}

export function StatsScreen() {
  const theme = useTheme();
  const { api, online, status } = useFocus();
  const [days, setDays] = useState('7');
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
              {streak?.today_done ? 'Today counted. Keep it going!' : 'Focus today to keep your streak'}
            </Text>
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
            <SegmentedButtons
              density="small"
              value={days}
              onValueChange={setDays}
              style={{ width: 160 }}
              buttons={[
                { value: '7', label: 'Week' },
                { value: '30', label: 'Month' }
              ]}
            />
          </View>
          {stats ? <BarChart daily={stats.daily} /> : null}
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
  chart: { flexDirection: 'row', height: 160, gap: 4, alignItems: 'flex-end' },
  barCol: { flex: 1, alignItems: 'center', height: '100%', gap: 2 },
  barTrack: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  listItem: { paddingHorizontal: 0 }
});
