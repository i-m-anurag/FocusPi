import React, { useState } from 'react';
import { useColorScheme } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { BottomNavigation, PaperProvider, Snackbar } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { FocusProvider, useFocus } from './src/hooks/FocusContext';
import { FocusScreen } from './src/screens/FocusScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { darkTheme, lightTheme } from './src/theme/theme';

const paperSettings = {
  icon: (props) => <MaterialCommunityIcons {...props} />
};

const ROUTES = [
  { key: 'focus', title: 'Focus', focusedIcon: 'timer', unfocusedIcon: 'timer-outline' },
  { key: 'stats', title: 'Progress', focusedIcon: 'chart-box', unfocusedIcon: 'chart-box-outline' },
  { key: 'settings', title: 'Settings', focusedIcon: 'cog', unfocusedIcon: 'cog-outline' }
];

const renderScene = BottomNavigation.SceneMap({
  focus: FocusScreen,
  stats: StatsScreen,
  settings: SettingsScreen
});

function Shell() {
  const [index, setIndex] = useState(0);
  const { toast, clearToast } = useFocus();
  return (
    <>
      <BottomNavigation
        navigationState={{ index, routes: ROUTES }}
        onIndexChange={setIndex}
        renderScene={renderScene}
        sceneAnimationEnabled
        sceneAnimationType="shifting"
      />
      <Snackbar key={toast?.key} visible={Boolean(toast)} onDismiss={clearToast} duration={3500} style={{ marginBottom: 88 }}>
        {toast?.message}
      </Snackbar>
    </>
  );
}

export default function App() {
  const isDark = useColorScheme() === 'dark';
  const theme = isDark ? darkTheme : lightTheme;
  return (
    <SafeAreaProvider>
      <PaperProvider settings={paperSettings} theme={theme}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <FocusProvider>
          <Shell />
        </FocusProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
