import React, { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import { Clock, ChevronRight, Trash2, Search, X } from 'lucide-react-native';
import { useHistory } from '@/contexts/HistoryContext';
import { useTheme } from '@/contexts/ThemeContext';
import { formatCurrency } from '@/utils/currency';
import { Split } from '@/types';
import InlineAdBanner from '@/components/ads/InlineAdBanner';

type FilterTab = 'all' | 'unpaid' | 'settled';

export default function HistoryScreen() {
  const { splits, deleteSplit } = useHistory();
  const { colors } = useTheme();
  const tabBarHeight = useBottomTabBarHeight();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterTab>('all');

  const filteredSplits = useMemo(() => {
    let result = splits;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter((s) => s.restaurantName.toLowerCase().includes(q));
    }
    if (filter === 'unpaid') {
      result = result.filter((s) =>
        s.summaries.some((p) => !p.paid && !p.personId.startsWith('me_')),
      );
    } else if (filter === 'settled') {
      result = result.filter((s) =>
        s.summaries.every((p) => p.paid || p.personId.startsWith('me_')),
      );
    }
    return result;
  }, [splits, query, filter]);

  const isFiltering = query.trim().length > 0 || filter !== 'all';

  const handleDelete = useCallback((id: string) => {
    Alert.alert('Delete Split', 'Are you sure you want to delete this split?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          deleteSplit(id);
        },
      },
    ]);
  }, [deleteSplit]);

  const handleOpenSplit = useCallback((splitId: string) => {
    router.push(`/(tabs)/history/${splitId}` as any);
  }, []);

  const formatDate = useCallback((dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, []);

  const renderSplit = useCallback(({ item }: { item: Split }) => {
    const unpaidCount = item.summaries.filter((s) => !s.paid && !s.personId.startsWith('me_')).length;
    const totalPeople = item.people.length;

    return (
      <TouchableOpacity
        style={[styles.splitCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => handleOpenSplit(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.cardTop}>
          <View style={styles.restaurantRow}>
            <Text style={[styles.restaurantName, { color: colors.text }]} numberOfLines={1}>
              {item.restaurantName}
            </Text>
            <Text style={[styles.splitDate, { color: colors.textMuted }]}>{formatDate(item.date)}</Text>
          </View>
          <View style={styles.cardMiddle}>
            <View style={styles.peopleRow}>
              {item.people.slice(0, 5).map((person, idx) => (
                <View
                  key={person.id}
                  style={[
                    styles.miniAvatar,
                    { backgroundColor: person.color, marginLeft: idx > 0 ? -6 : 0, borderColor: colors.card },
                  ]}
                >
                  <Text style={styles.miniAvatarText}>{person.name.charAt(0)}</Text>
                </View>
              ))}
              {totalPeople > 5 && (
                <View style={[styles.miniAvatar, { backgroundColor: colors.surface, marginLeft: -6, borderColor: colors.card }]}>
                  <Text style={[styles.miniAvatarOverflow, { color: colors.textMuted }]}>+{totalPeople - 5}</Text>
                </View>
              )}
              <Text style={[styles.peopleCount, { color: colors.textMuted }]}>{totalPeople} people</Text>
            </View>
            <Text style={[styles.splitTotal, { color: colors.text }]}>{formatCurrency(item.total)}</Text>
          </View>
        </View>
        <View style={[styles.cardBottom, { borderTopColor: colors.borderLight, backgroundColor: colors.cardLight }]}>
          <View style={styles.statusRow}>
            {unpaidCount > 0 ? (
              <View style={[styles.unpaidBadge, { backgroundColor: colors.warningLight }]}>
                <Text style={[styles.unpaidText, { color: colors.warning }]}>{unpaidCount} unpaid</Text>
              </View>
            ) : (
              <View style={[styles.settledBadge, { backgroundColor: colors.successLight }]}>
                <Text style={[styles.settledText, { color: colors.success }]}>All settled</Text>
              </View>
            )}
          </View>
          <View style={styles.cardActions}>
            <TouchableOpacity
              onPress={() => handleDelete(item.id)}
              style={styles.deleteHit}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Trash2 color={colors.textMuted} size={15} />
            </TouchableOpacity>
            <ChevronRight color={colors.textMuted} size={18} />
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [handleOpenSplit, handleDelete, formatDate, colors]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.searchHeader, { backgroundColor: colors.background }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Search color={colors.textMuted} size={16} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search receipts..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <X color={colors.textMuted} size={15} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.filterRow}>
          {(['all', 'unpaid', 'settled'] as FilterTab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[
                styles.filterChip,
                { backgroundColor: filter === tab ? colors.primary : colors.surface },
              ]}
              onPress={() => setFilter(tab)}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.filterChipText,
                { color: filter === tab ? colors.white : colors.textSecondary },
              ]}>
                {tab === 'all' ? 'All' : tab === 'unpaid' ? 'Unpaid' : 'Settled'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <FlatList
        data={filteredSplits}
        keyExtractor={(item) => item.id}
        renderItem={renderSplit}
        contentContainerStyle={[styles.listContent, { paddingBottom: tabBarHeight + 120 }]}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          isFiltering ? (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Search color={colors.textMuted} size={44} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No matching splits</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Try a different search or filter.
              </Text>
              <TouchableOpacity
                style={[styles.emptyCta, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => { setQuery(''); setFilter('all'); }}
              >
                <Text style={[styles.emptyCtaText, { color: colors.text }]}>Clear Filters</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Clock color={colors.textMuted} size={44} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No splits yet</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
                Your receipt history will appear here after your first split.
              </Text>
              <TouchableOpacity
                style={[styles.emptyCta, { backgroundColor: colors.primary }]}
                onPress={() => router.push('/(tabs)/(scan)' as any)}
              >
                <Text style={[styles.emptyCtaText, { color: colors.white }]}>Start Your First Split</Text>
              </TouchableOpacity>
            </View>
          )
        }
      />
      <View style={[styles.adWrapper, { bottom: tabBarHeight }]}>
        <InlineAdBanner placement="history" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderWidth: 1,
    gap: 10,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  listContent: {
    padding: 16,
    paddingBottom: 24,
    flexGrow: 1,
  },
  splitCard: {
    borderRadius: 18,
    marginBottom: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardTop: {
    padding: 16,
    paddingBottom: 12,
  },
  restaurantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  restaurantName: {
    fontSize: 17,
    fontWeight: '700' as const,
    flex: 1,
    marginRight: 8,
  },
  splitDate: {
    fontSize: 12,
    fontWeight: '500' as const,
  },
  cardMiddle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  peopleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  miniAvatarText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  miniAvatarOverflow: {
    fontSize: 9,
    fontWeight: '600' as const,
  },
  peopleCount: {
    fontSize: 12,
    marginLeft: 8,
  },
  splitTotal: {
    fontSize: 20,
    fontWeight: '800' as const,
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  unpaidBadge: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  unpaidText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  settledBadge: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  settledText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  deleteHit: {
    padding: 4,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingTop: 40,
  },
  adWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: 24,
  },
  emptyCta: {
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCtaText: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
});
