import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';

const THEME_KEY = 'owezy_theme';

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  primary: string;
  primaryDark: string;
  primaryLight: string;
  secondary: string;
  secondaryLight: string;
  accent: string;
  accentLight: string;
  background: string;
  backgroundLight: string;
  card: string;
  cardLight: string;
  surface: string;
  surfaceDark: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderLight: string;
  danger: string;
  dangerLight: string;
  warning: string;
  warningLight: string;
  success: string;
  successLight: string;
  overlay: string;
  white: string;
  black: string;
  venmo: string;
  cashApp: string;
  zelle: string;
  paypal: string;
  avatarColors: string[];
  tabBar: string;
  tabBarBorder: string;
  headerBg: string;
}

const lightColors: ThemeColors = {
  primary: '#97B87E',
  primaryDark: '#7A9E63',
  primaryLight: '#EDF4E8',
  secondary: '#9583EF',
  secondaryLight: '#EEEAFD',
  accent: '#D9B253',
  accentLight: '#FBF4E0',
  background: '#F7F8FA',
  backgroundLight: '#FFFFFF',
  card: '#FFFFFF',
  cardLight: '#FAFBFC',
  surface: '#F0F1F4',
  surfaceDark: '#E4E6EB',
  text: '#1A1D26',
  textSecondary: '#5F6677',
  textMuted: '#9CA3AF',
  border: '#E5E7EB',
  borderLight: '#F3F4F6',
  danger: '#E57373',
  dangerLight: '#FDF0F0',
  warning: '#D9B253',
  warningLight: '#FBF4E0',
  success: '#97B87E',
  successLight: '#EDF4E8',
  overlay: 'rgba(0,0,0,0.5)',
  white: '#FFFFFF',
  black: '#1A1D26',
  venmo: '#008CFF',
  cashApp: '#00D632',
  zelle: '#6C1CD3',
  paypal: '#003087',
  avatarColors: [
    '#97B87E', '#D9B253', '#9583EF', '#B5D7E5',
    '#E57373', '#5BA4CF', '#F0A05E', '#6DC5B0',
    '#D4789C', '#7A9ACF', '#C4A6E8', '#8BCCA3',
  ],
  tabBar: '#FFFFFF',
  tabBarBorder: '#F3F4F6',
  headerBg: '#FFFFFF',
};

const darkColors: ThemeColors = {
  primary: '#97B87E',
  primaryDark: '#7A9E63',
  primaryLight: '#1A2E14',
  secondary: '#9583EF',
  secondaryLight: '#1E1A30',
  accent: '#D9B253',
  accentLight: '#2E2510',
  background: '#0F1117',
  backgroundLight: '#161922',
  card: '#1C1F2E',
  cardLight: '#222538',
  surface: '#252840',
  surfaceDark: '#2E3150',
  text: '#F1F3F7',
  textSecondary: '#9BA1B0',
  textMuted: '#6B7185',
  border: '#2E3150',
  borderLight: '#252840',
  danger: '#E57373',
  dangerLight: '#2E1515',
  warning: '#D9B253',
  warningLight: '#2E2510',
  success: '#97B87E',
  successLight: '#1A2E14',
  overlay: 'rgba(0,0,0,0.7)',
  white: '#FFFFFF',
  black: '#0F1117',
  venmo: '#008CFF',
  cashApp: '#00D632',
  zelle: '#6C1CD3',
  paypal: '#003087',
  avatarColors: [
    '#97B87E', '#D9B253', '#9583EF', '#B5D7E5',
    '#E57373', '#5BA4CF', '#F0A05E', '#6DC5B0',
    '#D4789C', '#7A9ACF', '#C4A6E8', '#8BCCA3',
  ],
  tabBar: '#161922',
  tabBarBorder: '#252840',
  headerBg: '#161922',
};

export const [ThemeProvider, useTheme] = createContextHook(() => {
  const [mode, setMode] = useState<ThemeMode>('light');
  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    const load = async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_KEY);
        if (stored === 'dark' || stored === 'light') {
          setMode(stored);
        }
      } catch (e) {
        if (__DEV__) console.warn('Failed to load theme:', e);
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, []);

  const toggleTheme = useCallback(async () => {
    const next: ThemeMode = mode === 'light' ? 'dark' : 'light';
    setMode(next);
    await AsyncStorage.setItem(THEME_KEY, next);
  }, [mode]);

  const setTheme = useCallback(async (newMode: ThemeMode) => {
    setMode(newMode);
    await AsyncStorage.setItem(THEME_KEY, newMode);
  }, []);

  const colors: ThemeColors = mode === 'dark' ? darkColors : lightColors;
  const isDark = mode === 'dark';

  return { mode, colors, isDark, toggleTheme, setTheme, loaded };
});
