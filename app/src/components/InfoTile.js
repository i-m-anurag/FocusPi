import React from 'react';
import { StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Surface, Text, useTheme } from 'react-native-paper';

export function InfoTile({ icon, iconColor, value, label, style }) {
  const theme = useTheme();
  return (
    <Surface elevation={1} style={[styles.tile, { borderRadius: 16 }, style]}>
      <MaterialCommunityIcons name={icon} size={22} color={iconColor || theme.colors.primary} />
      <View style={styles.text}>
        <Text variant="titleMedium" numberOfLines={1}>{value}</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 },
  text: { flex: 1 }
});
