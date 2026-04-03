import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { Split } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { trpcClient } from '@/lib/trpc';

const HISTORY_KEY_PREFIX = 'owezy_history';
const LEGACY_HISTORY_KEY = 'owezy_history';
const MAX_HISTORY = 50;

export const [HistoryProvider, useHistory] = createContextHook(() => {
  const { user, authChecked } = useAuth();
  const [splits, setSplits] = useState<Split[]>([]);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  // BUG-L3 fix: memoize storageKey to avoid unnecessary re-renders on every
  // render cycle (matches the pattern used in FriendsContext).
  const storageKey = useMemo(
    () => `${HISTORY_KEY_PREFIX}_${user?.id || 'guest'}`,
    [user?.id],
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setSplits([]);
        let stored = await AsyncStorage.getItem(storageKey);
        if (!stored && user?.id) {
          const legacy = await AsyncStorage.getItem(LEGACY_HISTORY_KEY);
          if (legacy) {
            stored = legacy;
            await AsyncStorage.setItem(storageKey, legacy);
            await AsyncStorage.removeItem(LEGACY_HISTORY_KEY);
          }
        }

        if (stored && active) {
          setSplits(JSON.parse(stored));
        }

        if (authChecked && user?.id) {
          const remote = await trpcClient.splits.list.query();
          if (active) {
            setSplits(remote);
            await AsyncStorage.setItem(storageKey, JSON.stringify(remote));
          }
        }
      } catch (e) {
        console.error('Failed to load history:', e);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [authChecked, storageKey, user?.id]);

  const persist = useCallback(async (updated: Split[]) => {
    const normalized = [...updated].slice(0, MAX_HISTORY);
    await AsyncStorage.setItem(storageKey, JSON.stringify(normalized));
    if (user?.id) {
      try {
        await trpcClient.splits.save.mutate({ splits: normalized });
      } catch (e) {
        if (__DEV__) console.warn('Failed to sync history to backend:', e);
      }
    }
  }, [storageKey, user?.id]);

  const enqueuePersist = useCallback((updated: Split[]) => {
    persistQueueRef.current = persistQueueRef.current
      .catch(() => undefined)
      .then(() => persist(updated));
    return persistQueueRef.current;
  }, [persist]);

  const applyHistoryUpdate = useCallback((updater: (prev: Split[]) => Split[]) => {
    setSplits((prev) => {
      const updated = updater(prev).slice(0, MAX_HISTORY);
      void enqueuePersist(updated);
      return updated;
    });
  }, [enqueuePersist]);

  const addSplit = useCallback((split: Split) => {
    applyHistoryUpdate((prev) => [split, ...prev]);
  }, [applyHistoryUpdate]);

  const upsertSplit = useCallback((split: Split) => {
    applyHistoryUpdate((prev) => {
      const existingIndex = prev.findIndex((s) => s.id === split.id);
      if (existingIndex === -1) {
        return [split, ...prev];
      }
      // BUG-M3 fix: move the edited split to the top (most recent) position
      // rather than leaving it at its original index.
      return [split, ...prev.filter((s) => s.id !== split.id)];
    });
  }, [applyHistoryUpdate]);

  const deleteSplit = useCallback((id: string) => {
    applyHistoryUpdate((prev) => prev.filter((s) => s.id !== id));
  }, [applyHistoryUpdate]);

  const updateSplitPayment = useCallback((splitId: string, personId: string, paid: boolean) => {
    applyHistoryUpdate((prev) => prev.map((s) => {
      if (s.id !== splitId) return s;
      return {
        ...s,
        summaries: s.summaries.map((sum) =>
          sum.personId === personId ? { ...sum, paid } : sum,
        ),
      };
    }));
  }, [applyHistoryUpdate]);

  return { splits, addSplit, upsertSplit, deleteSplit, updateSplitPayment };
});
