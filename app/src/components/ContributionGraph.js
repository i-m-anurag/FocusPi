import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';

const CELL = 13;
const GAP = 3;
const STEP = CELL + GAP;
const ROWS = 7; // Mon .. Sun
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Monday = 0 ... Sunday = 6, from an ISO date string. */
function rowOf(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

function monthOf(isoDate) {
  return Number(isoDate.slice(5, 7)) - 1;
}

/**
 * GitHub-style heatmap of your focus days: one square per day, one column per
 * week, darker when you focused longer. A full square means the daily goal
 * was reached.
 */
export function ContributionGraph({ daily, goal, selected, onSelect }) {
  const theme = useTheme();
  const scrollRef = useRef(null);

  const weeks = useMemo(() => {
    const out = [];
    let current = null;
    daily.forEach((day) => {
      const row = rowOf(day.date);
      if (current === null || row === 0) {
        current = new Array(ROWS).fill(null);
        out.push(current);
      }
      current[row] = day;
    });
    return out;
  }, [daily]);

  // Start at the most recent week.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 50);
    return () => clearTimeout(t);
  }, [weeks.length]);

  const levels = [
    theme.colors.heat0,
    theme.colors.heat1,
    theme.colors.heat2,
    theme.colors.heat3,
    theme.colors.heat4
  ];

  const levelFor = (day) => {
    if (!day || !day.minutes) return 0;
    const share = goal ? day.minutes / goal : 0;
    if (share >= 1) return 4;
    if (share >= 0.66) return 3;
    if (share >= 0.33) return 2;
    return 1;
  };

  // A month label above the first week that starts a new month.
  const monthLabels = weeks.map((week, i) => {
    const first = week.find(Boolean);
    if (!first) return null;
    const prev = weeks[i - 1]?.find(Boolean);
    if (i === 0 || (prev && monthOf(prev.date) !== monthOf(first.date))) {
      return MONTHS[monthOf(first.date)];
    }
    return null;
  });

  return (
    <View>
      <View style={styles.row}>
        <View style={styles.dayLabels}>
          <View style={{ height: 14 }} />
          {DAY_LABELS.map((label, i) => (
            <View key={i} style={styles.dayLabel}>
              <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, fontSize: 9 }}>
                {label}
              </Text>
            </View>
          ))}
        </View>

        <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false}>
          <View>
            {/* Labels sit above the week they belong to, free to overflow it */}
            <View style={[styles.monthRow, { width: weeks.length * STEP }]}>
              {monthLabels.map((label, i) =>
                label ? (
                  <Text
                    key={i}
                    variant="labelSmall"
                    style={[styles.monthLabel, { left: i * STEP, color: theme.colors.onSurfaceVariant }]}
                  >
                    {label}
                  </Text>
                ) : null
              )}
            </View>
            <View style={styles.grid}>
              {weeks.map((week, wi) => (
                <View key={wi}>
                  {week.map((day, di) => {
                    const isSelected = day && selected?.date === day.date;
                    return (
                      <Pressable
                        key={di}
                        disabled={!day}
                        onPress={() => onSelect?.(day)}
                        style={{
                          width: CELL,
                          height: CELL,
                          marginRight: GAP,
                          marginBottom: GAP,
                          borderRadius: 3,
                          backgroundColor: day ? levels[levelFor(day)] : 'transparent',
                          borderWidth: isSelected ? 1.5 : 0,
                          borderColor: theme.colors.onSurface
                        }}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>

      <View style={styles.legend}>
        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>Less</Text>
        {levels.map((color, i) => (
          <View key={i} style={[styles.legendCell, { backgroundColor: color }]} />
        ))}
        <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>More</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  dayLabels: { width: 26 },
  dayLabel: { height: CELL + GAP, justifyContent: 'center' },
  monthRow: { height: 14 },
  monthLabel: { position: 'absolute', top: 0, fontSize: 9 },
  grid: { flexDirection: 'row' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, justifyContent: 'flex-end' },
  legendCell: { width: 11, height: 11, borderRadius: 3 }
});
