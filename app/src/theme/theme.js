import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

// Indigo seed: calm, "deep work" colour. Extra tokens live under colors too.
export const lightTheme = {
  ...MD3LightTheme,
  roundness: 4,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#4338ca',
    onPrimary: '#ffffff',
    primaryContainer: '#e0e0ff',
    onPrimaryContainer: '#110d63',
    secondary: '#5b5d72',
    secondaryContainer: '#e0e1f9',
    onSecondaryContainer: '#181a2c',
    tertiary: '#b45309',
    tertiaryContainer: '#ffdcc2',
    onTertiaryContainer: '#2e1500',
    background: '#f8f8ff',
    surface: '#f8f8ff',
    surfaceVariant: '#e3e1ec',
    onSurfaceVariant: '#46464f',
    outlineVariant: '#c7c5d0',
    elevation: {
      ...MD3LightTheme.colors.elevation,
      level1: '#f0effb',
      level2: '#ebe9f8',
      level3: '#e5e3f6'
    },
    success: '#1f7a4d',
    streak: '#ea580c',
    ringTrack: '#e3e1ec',
    // Focus heatmap ramp: empty day -> daily goal reached
    heat0: '#e7e5f0',
    heat1: '#d3cffa',
    heat2: '#a7a1f0',
    heat3: '#6f68dd',
    heat4: '#4338ca'
  }
};

export const darkTheme = {
  ...MD3DarkTheme,
  roundness: 4,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#c0c1ff',
    onPrimary: '#1f1a8a',
    primaryContainer: '#3730a3',
    onPrimaryContainer: '#e0e0ff',
    secondary: '#c4c5dd',
    secondaryContainer: '#434659',
    onSecondaryContainer: '#e0e1f9',
    tertiary: '#ffb77c',
    tertiaryContainer: '#6d3a00',
    onTertiaryContainer: '#ffdcc2',
    background: '#121318',
    surface: '#121318',
    surfaceVariant: '#46464f',
    onSurfaceVariant: '#c7c5d0',
    outlineVariant: '#46464f',
    elevation: {
      ...MD3DarkTheme.colors.elevation,
      level1: '#1b1b24',
      level2: '#20202b',
      level3: '#252532'
    },
    success: '#6ddba0',
    streak: '#fb923c',
    ringTrack: '#2a2a36',
    heat0: '#26262f',
    heat1: '#3a3676',
    heat2: '#524cb0',
    heat3: '#7b74e4',
    heat4: '#c0c1ff'
  }
};
