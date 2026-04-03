import React, { useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronRight, ChevronLeft, Edit3, CheckCircle } from 'lucide-react-native';
import { useSplitFlow } from '@/contexts/SplitFlowContext';
import { useHistory } from '@/contexts/HistoryContext';
import { useFriends } from '@/contexts/FriendsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { calculateSummaries, generateId } from '@/utils/splitting';
import { formatCurrency } from '@/utils/currency';
import { Split, PersonSummary } from '@/types';

export default function SummaryScreen() {
  const { restaurantName, items, people, tax, tip, subtotal, tipSplitMode, editingSplitId, hasFees, setSplitConfirmed, reset } = useSplitFlow();
  const { addSplit, upsertSplit } = useHistory();
  const savedRef = useRef(false);
  const { incrementUsage } = useFriends();
  const { incrementStats } = useAuth();
  const { colors } = useTheme();

  const isEditing = Boolean(editingSplitId);

  const summaries = useMemo(
    () => calculateSummaries(items, people, tax, tip, tipSplitMode),
    [items, people, tax, tip, tipSplitMode],
  );

  const total = useMemo(() => subtotal + tax + tip, [subtotal, tax, tip]);

  const handleConfirm = useCallback(() => {
    if (savedRef.current) return;
    savedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const splitId = editingSplitId || generateId();
    const split: Split = {
      id: splitId,
      restaurantName: restaurantName || 'Unnamed Split',
      date: new Date().toISOString(),
      items,
      subtotal,
      tax,
      tip,
      tipSplitMode,
      total,
      people,
      summaries,
      hasFees,
    };

    if (editingSplitId) {
      upsertSplit(split);
      // Don't re-increment stats when editing an existing split
      reset();
      router.replace({
        pathname: '/(tabs)/history/[splitId]' as any,
        params: { splitId },
      } as any);
    } else {
      addSplit(split);
      const friendIds = people.filter((p) => !p.id.startsWith('me_')).map((p) => p.id);
      incrementUsage(friendIds);
      incrementStats(total, friendIds.length);
      setSplitConfirmed(true);
      router.push({
        pathname: '/(tabs)/(scan)/pay' as any,
        params: { splitId: split.id },
      } as any);
    }
  }, [
    restaurantName,
    items,
    subtotal,
    tax,
    tip,
    tipSplitMode,
    total,
    people,
    summaries,
    editingSplitId,
    hasFees,
    addSplit,
    upsertSplit,
    incrementUsage,
    incrementStats,
    setSplitConfirmed,
    reset,
  ]);

  const handleEdit = useCallback(() => {
    router.back();
  }, []);

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: isEditing ? 'Review Changes' : 'Summary',
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginLeft: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <ChevronLeft color={colors.text} size={22} strokeWidth={2.4} />
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>Back</Text>
              </View>
            </Pressable>
          ),
        }}
      />
      <View style={styles.receiptHeader}>
        <Text style={[styles.restaurantName, { color: colors.text }]}>
          {restaurantName || 'Your Receipt'}
        </Text>
        <View style={[styles.totalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.totalTop}>
            <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>Total</Text>
            <Text style={[styles.totalValue, { color: colors.text }]}>{formatCurrency(total)}</Text>
          </View>
          <View style={styles.totalBreakdown}>
            <View style={styles.breakdownItem}>
              <Text style={[styles.breakdownLabel, { color: colors.textSecondary }]}>Subtotal</Text>
              <Text style={[styles.breakdownValue, { color: colors.text }]}>{formatCurrency(subtotal)}</Text>
            </View>
            <View style={styles.breakdownItem}>
              <Text style={[styles.breakdownLabel, { color: colors.textSecondary }]}>{hasFees ? 'Tax & Fees' : 'Tax'}</Text>
              <Text style={[styles.breakdownValue, { color: colors.text }]}>{formatCurrency(tax)}</Text>
            </View>
            <View style={styles.breakdownItem}>
              <Text style={[styles.breakdownLabel, { color: colors.textSecondary }]}>Tip</Text>
              <Text style={[styles.breakdownValue, { color: colors.text }]}>{formatCurrency(tip)}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={[styles.confirmBanner, { backgroundColor: isEditing ? colors.successLight : colors.primaryLight }]}>
        <CheckCircle color={isEditing ? colors.success : colors.primary} size={18} />
        <Text style={[styles.confirmBannerText, { color: isEditing ? colors.success : colors.primaryDark }]}>
          {isEditing ? 'Saving will update your history' : 'Does this look right?'}
        </Text>
        {!isEditing && (
          <TouchableOpacity onPress={handleEdit} style={[styles.editBtn, { backgroundColor: colors.white }]}>
            <Edit3 color={colors.textSecondary} size={14} />
            <Text style={[styles.editText, { color: colors.textSecondary }]}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Per Person</Text>

      {summaries.map((summary: PersonSummary) => {
        const person = people.find((p) => p.id === summary.personId);
        return (
          <View key={summary.personId} style={[styles.personCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.personHeader}>
              <View style={[styles.avatar, { backgroundColor: person?.color || colors.primary }]}>
                <Text style={styles.avatarText}>
                  {summary.personName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.personName, { color: colors.text }]}>{summary.personName}</Text>
              <Text style={[styles.personTotal, { color: colors.text }]}>{formatCurrency(summary.total)}</Text>
            </View>

            <View style={styles.personItems}>
              {summary.items.map((item, idx) => (
                <View key={`${item.name}-${idx}`} style={styles.summaryItemRow}>
                  <Text style={[styles.summaryItemName, { color: colors.text }]}>
                    {item.name}
                    {item.splitCount && item.splitCount > 1 ? ` (split) (${item.splitCount} ways)` : ''}
                  </Text>
                  <View style={[styles.itemSpacer, { backgroundColor: colors.border }]} />
                  <Text style={[styles.summaryItemCost, { color: colors.text }]}>{formatCurrency(item.cost)}</Text>
                </View>
              ))}
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.feeRow}>
                <Text style={[styles.feeLabel, { color: colors.textMuted }]}>{hasFees ? 'Tax & Fees' : 'Tax'}</Text>
                <Text style={[styles.feeValue, { color: colors.textMuted }]}>{formatCurrency(summary.taxShare)}</Text>
              </View>
              <View style={styles.feeRow}>
                <Text style={[styles.feeLabel, { color: colors.textMuted }]}>Tip</Text>
                <Text style={[styles.feeValue, { color: colors.textMuted }]}>{formatCurrency(summary.tipShare)}</Text>
              </View>
            </View>
          </View>
        );
      })}

      <TouchableOpacity style={[styles.confirmBtn, { backgroundColor: colors.primary }]} onPress={handleConfirm} testID="confirm-split">
        <Text style={[styles.confirmBtnText, { color: colors.white }]}>
          {isEditing ? 'Save Changes' : 'Split Receipt'}
        </Text>
        <ChevronRight color={colors.white} size={20} />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  receiptHeader: {
    marginBottom: 16,
  },
  restaurantName: {
    fontSize: 26,
    fontWeight: '800' as const,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  totalCard: {
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
  },
  totalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 16,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  totalValue: {
    fontSize: 34,
    fontWeight: '800' as const,
  },
  totalBreakdown: {
    gap: 6,
  },
  breakdownItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownLabel: {
    fontSize: 14,
  },
  breakdownValue: {
    fontSize: 14,
    fontWeight: '500' as const,
  },
  confirmBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
  },
  confirmBannerText: {
    fontSize: 14,
    fontWeight: '600' as const,
    flex: 1,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  editText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    marginBottom: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  personCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
  },
  personHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  personName: {
    fontSize: 16,
    fontWeight: '600' as const,
    flex: 1,
  },
  personTotal: {
    fontSize: 20,
    fontWeight: '800' as const,
  },
  personItems: {
    gap: 6,
  },
  summaryItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  summaryItemName: {
    fontSize: 14,
  },
  itemSpacer: {
    flex: 1,
    height: 1,
    marginHorizontal: 8,
    opacity: 0.75,
  },
  summaryItemCost: {
    fontSize: 14,
    fontWeight: '500' as const,
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  feeLabel: {
    fontSize: 13,
  },
  feeValue: {
    fontSize: 13,
    fontWeight: '500' as const,
  },
  confirmBtn: {
    borderRadius: 14,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 54,
    marginTop: 12,
  },
  confirmBtnText: {
    fontSize: 17,
    fontWeight: '700' as const,
  },
});
