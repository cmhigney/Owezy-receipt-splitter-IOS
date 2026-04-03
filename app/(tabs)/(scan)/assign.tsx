import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronRight, AlertCircle, Check, Equal, Users, ChevronLeft } from 'lucide-react-native';
import { useSplitFlow } from '@/contexts/SplitFlowContext';
import { useTheme } from '@/contexts/ThemeContext';
import { ReceiptItem } from '@/types';
import { formatCurrency } from '@/utils/currency';

export default function AssignScreen() {
  const { items, people, tax, tip, updateItemAssignment, setItems, editingSplitId } = useSplitFlow();
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const isNarrow = screenWidth < 390;

  const meId = useMemo(() => {
    const me = people.find((p) => p.id.startsWith('me_'));
    return me?.id || '';
  }, [people]);

  const isEvenSplit = useMemo(() => {
    // BUG-L1 fix: when people.length === 0, items.every() is vacuously true,
    // making isEvenSplit appear true before anyone is added.
    if (people.length === 0) return false;
    const allIds = people.map((p) => p.id);
    return items.every((item) =>
      item.assignedTo.length === allIds.length &&
      allIds.every((id) => item.assignedTo.includes(id))
    );
  }, [items, people]);

  const totalBill = useMemo(() => {
    const itemsTotal = items.reduce((sum, item) => sum + item.price, 0);
    return Math.round((itemsTotal + tax + tip) * 100) / 100;
  }, [items, tax, tip]);

  const evenPerPerson = useMemo(() => {
    if (people.length === 0) return 0;
    return Math.round((totalBill / people.length) * 100) / 100;
  }, [totalBill, people]);

  const unassignedCount = useMemo(
    () => items.filter((item) => item.assignedTo.length === 0).length,
    [items],
  );
  const assignedCount = items.length - unassignedCount;

  const personTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    people.forEach((p) => { totals[p.id] = 0; });

    items.forEach((item) => {
      if (item.assignedTo.length > 0) {
        const share = item.price / item.assignedTo.length;
        item.assignedTo.forEach((pid) => {
          totals[pid] = (totals[pid] || 0) + share;
        });
      } else {
        totals[meId] = (totals[meId] || 0) + item.price;
      }
    });

    Object.keys(totals).forEach((pid) => {
      totals[pid] = Math.round(totals[pid] * 100) / 100;
    });

    return totals;
  }, [items, people, meId]);

  const handleAssign = useCallback((itemId: string, personId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateItemAssignment(itemId, personId);
  }, [updateItemAssignment]);

  const handleSplitItemEvenly = useCallback((itemId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // BUG-L2 fix: use functional update to avoid reading stale `items` closure.
    const allIds = people.map((p) => p.id);
    setItems((prev) => prev.map((item) =>
      item.id === itemId ? { ...item, assignedTo: allIds } : item
    ));
  }, [people, setItems]);

  const handleSplitBillEvenly = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // BUG-L2 fix: use functional update to avoid reading stale `items` closure.
    const allIds = people.map((p) => p.id);
    setItems((prev) => prev.map((item) => ({ ...item, assignedTo: allIds })));
  }, [people, setItems]);

  const handleClearEvenSplit = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setItems(items.map((item) => ({ ...item, assignedTo: [] })));
  }, [items, setItems]);

  const handleContinue = useCallback(() => {
    if (meId) {
      const updated = items.map((item) => {
        if (item.assignedTo.length === 0) {
          return { ...item, assignedTo: [meId] };
        }
        return item;
      });
      if (updated.some((item, i) => item !== items[i])) {
        setItems(updated);
      }
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(tabs)/(scan)/summary' as any);
  }, [items, meId, setItems]);

  const renderItem = useCallback(({ item }: { item: ReceiptItem }) => {
    const isUnassigned = item.assignedTo.length === 0;
    const isItemEven = people.length > 0 && item.assignedTo.length === people.length;
    return (
      <View style={[
        styles.itemCard,
        { backgroundColor: colors.card, borderColor: colors.border },
        isUnassigned && { borderColor: colors.textMuted + '60', borderWidth: 1.5, backgroundColor: colors.surface },
      ]}>
        <View style={styles.itemHeader}>
          <View style={styles.itemNameWrap}>
            {isUnassigned && <AlertCircle color={colors.textMuted} size={14} />}
            <Text style={[styles.itemName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
          </View>
          <Text style={[styles.itemPrice, { color: colors.text }]}>{formatCurrency(item.price)}</Text>
        </View>

        {item.assignedTo.length > 1 && (
          <Text style={[styles.splitLabel, { color: colors.textSecondary }]}>
            Split {item.assignedTo.length} ways - {formatCurrency(item.price / item.assignedTo.length)} each
          </Text>
        )}

        {isUnassigned && (
          <Text style={[styles.unassignedHint, { color: colors.textMuted }]}>
            Defaults to you if not assigned
          </Text>
        )}

        <View style={styles.avatarRow}>
          {people.map((person) => {
            const isAssigned = item.assignedTo.includes(person.id);
            return (
              <TouchableOpacity
                key={person.id}
                style={[
                  styles.avatarBtn,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                  isAssigned && { backgroundColor: person.color, borderColor: person.color },
                ]}
                onPress={() => handleAssign(item.id, person.id)}
              >
                <Text style={[styles.avatarInitial, { color: colors.textSecondary }, isAssigned && { color: '#FFFFFF' }]}>
                  {person.name.charAt(0).toUpperCase()}
                </Text>
                <Text
                  style={[styles.avatarName, { color: colors.textSecondary }, isAssigned && { color: '#FFFFFF' }]}
                  numberOfLines={1}
                >
                  {person.name}
                </Text>
                {isAssigned && <Check color="#FFFFFF" size={12} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {!isItemEven && (
          <TouchableOpacity
            style={[styles.splitItemBtn, { backgroundColor: colors.primaryLight }]}
            onPress={() => handleSplitItemEvenly(item.id)}
          >
            <Users color={colors.primary} size={13} />
            <Text style={[styles.splitItemBtnText, { color: colors.primary }]}>Split evenly with everyone</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }, [people, handleAssign, handleSplitItemEvenly, colors]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: editingSplitId ? 'Edit Assignments' : 'Assign Items',
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => editingSplitId ? router.replace('/(tabs)/history' as any) : router.back()}
              hitSlop={12}
              style={{ marginLeft: 4 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <ChevronLeft color={colors.text} size={22} strokeWidth={2.4} />
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>
                  {editingSplitId ? 'History' : 'Back'}
                </Text>
              </View>
            </Pressable>
          ),
        }}
      />
      <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.heroTitle, { color: colors.text }]}>Assign who had what</Text>
        <Text style={[styles.heroSubtext, { color: colors.textSecondary }]}>
          Tap names on each item. Unassigned items default to you, and you can still split anything evenly.
        </Text>
        <View style={styles.heroMetrics}>
          <View style={[styles.heroMetric, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.heroMetricValue, { color: colors.primary }]}>{assignedCount}</Text>
            <Text style={[styles.heroMetricLabel, { color: colors.textSecondary }]}>Assigned</Text>
          </View>
          <View style={[styles.heroMetric, { backgroundColor: colors.surface }]}>
            <Text style={[styles.heroMetricValue, { color: colors.text }]}>{unassignedCount}</Text>
            <Text style={[styles.heroMetricLabel, { color: colors.textSecondary }]}>Need review</Text>
          </View>
          <View style={[styles.heroMetric, { backgroundColor: colors.secondaryLight }]}>
            <Text style={[styles.heroMetricValue, { color: colors.secondary }]}>{people.length}</Text>
            <Text style={[styles.heroMetricLabel, { color: colors.textSecondary }]}>People</Text>
          </View>
        </View>
      </View>
      <TouchableOpacity
        style={[
          styles.splitEvenlyCard,
          { backgroundColor: isEvenSplit ? colors.primary : colors.card, borderColor: isEvenSplit ? colors.primary : colors.border },
        ]}
        onPress={isEvenSplit ? handleClearEvenSplit : handleSplitBillEvenly}
        activeOpacity={0.7}
      >
        <Equal color={isEvenSplit ? '#FFFFFF' : colors.primary} size={20} />
        <View style={styles.splitEvenlyInfo}>
          <Text style={[styles.splitEvenlyTitle, { color: isEvenSplit ? '#FFFFFF' : colors.text }]}>
            {isEvenSplit ? 'Splitting Evenly' : 'Split Bill Evenly'}
          </Text>
          <Text style={[styles.splitEvenlyAmount, { color: isEvenSplit ? 'rgba(255,255,255,0.8)' : colors.textSecondary }]}>
            {formatCurrency(evenPerPerson)} per person (incl. tax & tip)
          </Text>
        </View>
        {isEvenSplit ? (
          <Text style={styles.splitEvenlyAction}>{"\u2713"}</Text>
        ) : (
          <ChevronRight color={colors.textMuted} size={18} />
        )}
      </TouchableOpacity>

      {!isEvenSplit && unassignedCount > 0 && (
        <View style={[styles.infoBar, { backgroundColor: colors.surface }]}>
          <Text style={[styles.infoBarText, { color: colors.textSecondary }]}>
            {unassignedCount} item{unassignedCount !== 1 ? 's' : ''} unassigned - will default to you
          </Text>
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <Text style={[styles.listIntro, { color: colors.textMuted }]}>
            {isEvenSplit
              ? 'Everything is split evenly. Tap a name to customize any item.'
              : 'The clearest split wins. Review the items that still need a person.'}
          </Text>
        }
      />

      <View
        style={[
          styles.bottomBar,
          isNarrow && styles.bottomBarNarrow,
          { backgroundColor: colors.card, borderTopColor: colors.border },
        ]}
      >
        <View style={styles.personTotals}>
          {people.slice(0, 4).map((person) => (
            <View key={person.id} style={styles.personTotal}>
              <View style={[styles.dotAvatar, { backgroundColor: person.color }]}>
                <Text style={styles.dotText}>{person.name.charAt(0)}</Text>
              </View>
              <Text style={[styles.personTotalAmount, { color: colors.textSecondary }]}>
                {formatCurrency(personTotals[person.id] || 0)}
              </Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={[styles.continueBtn, { backgroundColor: colors.primary }]} onPress={handleContinue} testID="continue-assign">
          <Text style={[styles.continueBtnText, { color: '#FFFFFF' }]}>Review Split</Text>
          <ChevronRight color="#FFFFFF" size={18} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heroCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
  },
  heroSubtext: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  heroMetrics: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  heroMetric: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  heroMetricValue: {
    fontSize: 18,
    fontWeight: '800' as const,
  },
  heroMetricLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    marginTop: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  splitEvenlyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    gap: 12,
  },
  splitEvenlyInfo: {
    flex: 1,
  },
  splitEvenlyTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  splitEvenlyAmount: {
    fontSize: 13,
    marginTop: 2,
  },
  splitEvenlyAction: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  infoBar: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  infoBarText: {
    fontSize: 13,
    fontWeight: '500' as const,
  },
  listContent: {
    padding: 16,
    paddingBottom: 130,
  },
  listIntro: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
    marginHorizontal: 2,
  },
  itemCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: '600' as const,
    flex: 1,
  },
  itemPrice: {
    fontSize: 17,
    fontWeight: '700' as const,
    marginLeft: 8,
  },
  splitLabel: {
    fontSize: 12,
    marginBottom: 6,
  },
  unassignedHint: {
    fontSize: 12,
    fontStyle: 'italic' as const,
    marginBottom: 6,
  },
  avatarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  avatarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  avatarInitial: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  avatarName: {
    fontSize: 12,
    fontWeight: '600' as const,
    maxWidth: 60,
  },
  splitItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    paddingVertical: 7,
    borderRadius: 10,
    minHeight: 40,
  },
  splitItemBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    padding: 16,
    paddingBottom: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomBarNarrow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
  },
  personTotals: {
    flexDirection: 'row',
    gap: 10,
    flex: 1,
    flexWrap: 'wrap',
  },
  personTotal: {
    alignItems: 'center',
    gap: 3,
  },
  dotAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  personTotalAmount: {
    fontSize: 11,
    fontWeight: '600' as const,
  },
  continueBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 52,
    alignSelf: 'flex-end',
  },
  continueBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
});
