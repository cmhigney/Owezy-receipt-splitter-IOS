import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useCallback } from 'react';
import Colors from '@/constants/colors';

export type PreferredPayment = 'venmo' | 'cashapp' | 'zelle' | 'paypal';

export const PREFERRED_OPTIONS: { value: PreferredPayment; label: string; icon: string; color: string }[] = [
  { value: 'venmo', label: 'Venmo', icon: 'V', color: Colors.venmo },
  { value: 'cashapp', label: 'Cash App', icon: '$', color: Colors.cashApp },
  { value: 'zelle', label: 'Zelle', icon: 'Z', color: Colors.zelle },
  { value: 'paypal', label: 'PayPal', icon: 'P', color: Colors.paypal },
];

const KEY = '@owezy_preferred_payment';

export function usePreferredPayment() {
  const [preferred, setPreferred] = useState<PreferredPayment | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((val) => {
      if (val) setPreferred(val as PreferredPayment);
    });
  }, []);

  const update = useCallback(async (value: PreferredPayment | null) => {
    setPreferred(value);
    if (value) {
      await AsyncStorage.setItem(KEY, value);
    } else {
      await AsyncStorage.removeItem(KEY);
    }
  }, []);

  return { preferred, setPreferredPayment: update };
}
