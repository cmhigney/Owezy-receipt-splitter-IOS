import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { Friend } from '@/types';
import { generateId, getRandomColor } from '@/utils/splitting';
import Colors from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { trpcClient } from '@/lib/trpc';

const FRIENDS_KEY_PREFIX = 'owezy_friends';
const LEGACY_FRIENDS_KEY = 'owezy_friends';

type AddFriendInput = {
  id?: string;
  name: string;
  username?: string;
  venmoUsername?: string;
  cashAppUsername?: string;
  zelleUsername?: string;
  paypalUsername?: string;
  phone?: string;
  profilePicture?: string;
};

export const [FriendsProvider, useFriends] = createContextHook(() => {
  const { user, authChecked } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const storageKey = useMemo(
    () => `${FRIENDS_KEY_PREFIX}_${user?.id || 'guest'}`,
    [user?.id],
  );

  const refreshFriends = useCallback(async () => {
    if (!authChecked || !user?.id) return;

    const remote = await trpcClient.friends.list.query();
    setFriends(remote);
    await AsyncStorage.setItem(storageKey, JSON.stringify(remote));
  }, [authChecked, storageKey, user?.id]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setFriends([]);
        let stored = await AsyncStorage.getItem(storageKey);
        if (!stored && user?.id) {
          const legacy = await AsyncStorage.getItem(LEGACY_FRIENDS_KEY);
          if (legacy) {
            stored = legacy;
            await AsyncStorage.setItem(storageKey, legacy);
            await AsyncStorage.removeItem(LEGACY_FRIENDS_KEY);
          }
        }

        if (stored && active) {
          setFriends(JSON.parse(stored));
        }

        if (authChecked && user?.id) {
          const remote = await trpcClient.friends.list.query();
          if (active) {
            setFriends(remote);
            await AsyncStorage.setItem(storageKey, JSON.stringify(remote));
          }
        }
      } catch (e) {
        console.error('Failed to load friends:', e);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [authChecked, storageKey, user?.id]);

  const persist = useCallback(async (updated: Friend[]) => {
    await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
    if (user?.id) {
      try {
        await trpcClient.friends.save.mutate({ friends: updated });
      } catch (e) {
        if (__DEV__) console.warn('Failed to sync friends to backend:', e);
      }
    }
  }, [storageKey, user?.id]);

  const enqueuePersist = useCallback((updated: Friend[]) => {
    persistQueueRef.current = persistQueueRef.current
      .catch(() => undefined)
      .then(() => persist(updated));
    return persistQueueRef.current;
  }, [persist]);

  const applyFriendUpdate = useCallback((updater: (prev: Friend[]) => Friend[]) => {
    setFriends((prev) => {
      const updated = updater(prev);
      void enqueuePersist(updated);
      return updated;
    });
  }, [enqueuePersist]);

  const addFriend = useCallback((input: AddFriendInput) => {
    const normalizedUsername = input.username?.trim().toLowerCase() || undefined;
    const normalizedName = input.name.trim();
    if (!normalizedName) return null;

    // BUG-M1 fix: move duplicate check inside the updater so it reads from
    // `prev` (latest state) rather than the stale `friends` closure value.
    let result: Friend | null = null;
    applyFriendUpdate((prev) => {
      const existing = prev.find((friend) => {
        if (input.id && friend.id === input.id) return true;
        if (normalizedUsername && friend.username?.toLowerCase() === normalizedUsername) return true;
        return false;
      });
      if (existing) {
        result = existing;
        return prev;
      }
      const color = getRandomColor(prev.length, Colors.avatarColors);
      const newFriend: Friend = {
        id: input.id || generateId(),
        name: normalizedName,
        username: normalizedUsername,
        venmoUsername: input.venmoUsername,
        cashAppUsername: input.cashAppUsername,
        zelleUsername: input.zelleUsername,
        paypalUsername: input.paypalUsername,
        phone: input.phone,
        profilePicture: input.profilePicture,
        usageCount: 0,
        color,
      };
      result = newFriend;
      return [...prev, newFriend];
    });
    return result;
  }, [applyFriendUpdate]);

  const updateFriend = useCallback((id: string, updates: Partial<Friend>) => {
    applyFriendUpdate((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }, [applyFriendUpdate]);

  const deleteFriend = useCallback((id: string) => {
    applyFriendUpdate((prev) => prev.filter((f) => f.id !== id));
  }, [applyFriendUpdate]);

  const incrementUsage = useCallback((ids: string[]) => {
    applyFriendUpdate((prev) => prev.map((f) =>
      ids.includes(f.id) ? { ...f, usageCount: f.usageCount + 1 } : f,
    ));
  }, [applyFriendUpdate]);

  const sortedFriends = useMemo(
    () => [...friends].sort((a, b) => b.usageCount - a.usageCount),
    [friends],
  );

  return { friends, sortedFriends, addFriend, updateFriend, deleteFriend, incrementUsage, refreshFriends };
});
