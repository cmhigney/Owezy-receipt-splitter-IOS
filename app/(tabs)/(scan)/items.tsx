import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { Stack, router, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Plus, Trash2, ChevronRight, ShoppingBag, ChevronLeft } from 'lucide-react-native';
import { useSplitFlow } from '@/contexts/SplitFlowContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTheme } from '@/contexts/ThemeContext';
import { ReceiptItem } from '@/types';
import { generateId } from '@/utils/splitting';
import { formatCurrency, parseCurrency } from '@/utils/currency';

export default function ItemsScreen() {
  const {
    restaurantName,
    setRestaurantName,
    items,
    setItems,
    tax,
    hasFees,
    tip,
    pendingAutoTipAmount,
    autoGratuityInfo,
    setTip,
    setSubtotal,
    splitConfirmed,
    editingSplitId,
    reset,
  } = useSplitFlow();
  const { isPro, hasPaidAccess, remainingScans, freeScansPerMonth } = useSubscription();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const newItemNameRef = useRef<TextInput | null>(null);
  const [newItemName, setNewItemName] = useState<string>('');
  const [newItemPrice, setNewItemPrice] = useState<string>('');
  const [currentTotalInput, setCurrentTotalInput] = useState<string>('');

  const addItem = useCallback(() => {
    const name = newItemName.trim();
    const price = parseCurrency(newItemPrice);
    if (!name) {
      Alert.alert('Missing name', 'Please enter an item name.');
      return;
    }
    if (price <= 0) {
      Alert.alert('Invalid price', 'Please enter a valid price.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newItem: ReceiptItem = { id: generateId(), name, price, assignedTo: [] };
    setItems([...items, newItem]);
    setNewItemName('');
    setNewItemPrice('');
  }, [newItemName, newItemPrice, items, setItems]);

  const deleteItem = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setItems(items.filter((item) => item.id !== id));
  }, [items, setItems]);

  const updateItem = useCallback((id: string, field: 'name' | 'price', value: string) => {
    setItems(
      items.map((item) => {
        if (item.id !== id) return item;
        if (field === 'name') return { ...item, name: value };
        return { ...item, price: parseCurrency(value) };
      }),
    );
  }, [items, setItems]);

  const subtotalCalc = useMemo(() => items.reduce((sum, item) => sum + item.price, 0), [items]);
  const roundedSubtotal = useMemo(() => Math.round(subtotalCalc * 100) / 100, [subtotalCalc]);
  const baseWithoutTip = useMemo(() => Math.round((roundedSubtotal + tax) * 100) / 100, [roundedSubtotal, tax]);
  const calculatedCurrentTotal = useMemo(
    () => Math.round((roundedSubtotal + tax + tip) * 100) / 100,
    [roundedSubtotal, tax, tip],
  );
  const hasPendingAutoTip = useMemo(
    () =>
      typeof pendingAutoTipAmount === 'number' &&
      pendingAutoTipAmount > 0 &&
      Boolean(autoGratuityInfo?.detected),
    [pendingAutoTipAmount, autoGratuityInfo],
  );
  const hasImportedTotals = useMemo(
    () => tax > 0 || tip > 0 || parseCurrency(currentTotalInput) > 0,
    [currentTotalInput, tax, tip],
  );

  useEffect(() => {
    setCurrentTotalInput(calculatedCurrentTotal > 0 ? calculatedCurrentTotal.toFixed(2) : '');
  }, [calculatedCurrentTotal]);

  const scanLine = useMemo(() => {
    if (typeof remainingScans === 'number') {
      const remaining = remainingScans;
      const scanWord = remaining === 1 ? 'scan' : 'scans';
      if (hasPaidAccess) {
        return `\n\nThis scan has been used from your monthly plan. You have ${remaining} ${scanWord} remaining this month.`;
      }
      return `\n\nThis counted as 1 of your ${freeScansPerMonth} free scans this month. You have ${remaining} free ${scanWord} remaining.`;
    }
    if (isPro) return '\n\nThis scan has been used.';
    return '';
  }, [remainingScans, hasPaidAccess, isPro, freeScansPerMonth]);

  usePreventRemove(!splitConfirmed && !editingSplitId, ({ data }) => {
    Alert.alert(
      'Discard this receipt?',
      `Going back will discard all changes.${scanLine}`,
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Go Back',
          style: 'destructive',
          onPress: () => {
            reset();
            navigation.dispatch(data.action);
          },
        },
      ],
    );
  });

  const handleContinue = useCallback(() => {
    if (items.length === 0) {
      Alert.alert('No items', 'Please add at least one item.');
      return;
    }

    const enteredTotal = parseCurrency(currentTotalInput);
    const finalTotal = enteredTotal > 0 ? enteredTotal : calculatedCurrentTotal;
    const nextTip = Math.max(0, Math.round((finalTotal - baseWithoutTip) * 100) / 100);

    setSubtotal(roundedSubtotal);
    setTip(nextTip);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(tabs)/(scan)/tip' as any);
  }, [items.length, currentTotalInput, calculatedCurrentTotal, baseWithoutTip, roundedSubtotal, setSubtotal, setTip]);

  const renderItem = useCallback(({ item, index }: { item: ReceiptItem; index: number }) => (
    <View style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.borderLight }]}>
      <View style={[styles.itemIndex, { backgroundColor: colors.surface }]}>
        <Text style={[styles.itemIndexText, { color: colors.textMuted }]}>{index + 1}</Text>
      </View>
      <View style={styles.itemContent}>
        <TextInput
          style={[styles.itemName, { color: colors.text }]}
          value={item.name}
          onChangeText={(v) => updateItem(item.id, 'name', v)}
          placeholderTextColor={colors.textMuted}
        />
        <TextInput
          style={[styles.itemPrice, { color: colors.text }]}
          value={item.price.toFixed(2)}
          onChangeText={(v) => updateItem(item.id, 'price', v)}
          keyboardType="decimal-pad"
          placeholderTextColor={colors.textMuted}
        />
      </View>
      <TouchableOpacity onPress={() => deleteItem(item.id)} style={styles.deleteBtn}>
        <Trash2 color={colors.danger} size={16} />
      </TouchableOpacity>
    </View>
  ), [deleteItem, updateItem, colors]);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={100}
    >
      <Stack.Screen
        options={{
          title: editingSplitId ? 'Edit Items & Totals' : 'Edit Items',
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
      <View style={styles.restaurantSection}>
        <TextInput
          style={[styles.restaurantInput, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
          placeholder="Restaurant or store name"
          placeholderTextColor={colors.textMuted}
          value={restaurantName}
          onChangeText={setRestaurantName}
          testID="restaurant-name"
        />
      </View>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Items</Text>
        <View style={[styles.countBadge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.countText, { color: colors.white }]}>{items.length}</Text>
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <ShoppingBag color={colors.textMuted} size={40} />
            <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>No items yet</Text>
            <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
              {hasImportedTotals
                ? 'We found totals, but not the itemized lines. Add the items below to finish the split.'
                : 'Add items from your receipt below.'}
            </Text>
            <TouchableOpacity
              style={[styles.emptyActionBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary + '30' }]}
              onPress={() => newItemNameRef.current?.focus()}
              activeOpacity={0.8}
            >
              <Text style={[styles.emptyActionText, { color: colors.primary }]}>Add First Item</Text>
            </TouchableOpacity>
          </View>
        }
      />

      <View style={[styles.bottomArea, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <View style={styles.addItemRow}>
          <TextInput
            ref={newItemNameRef}
            style={[styles.addInput, { flex: 2, backgroundColor: colors.surface, color: colors.text }]}
            placeholder="Item name"
            placeholderTextColor={colors.textMuted}
            value={newItemName}
            onChangeText={setNewItemName}
            testID="new-item-name"
          />
          <TextInput
            style={[styles.addInput, { flex: 1, backgroundColor: colors.surface, color: colors.text }]}
            placeholder="$0.00"
            placeholderTextColor={colors.textMuted}
            keyboardType="decimal-pad"
            value={newItemPrice}
            onChangeText={setNewItemPrice}
            testID="new-item-price"
          />
          <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]} onPress={addItem} testID="add-item-button">
            <Plus color="#FFFFFF" size={20} />
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>Subtotal</Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>{formatCurrency(subtotalCalc)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{hasFees ? 'Tax & Fees' : 'Tax'}</Text>
            <Text style={[styles.rowValue, { color: colors.text }]}>{formatCurrency(tax)}</Text>
          </View>
          <View style={styles.row}>
            <View>
              <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>Tip</Text>
              {hasPendingAutoTip ? (
                <Text style={[styles.pendingTipText, { color: colors.textMuted }]}>
                  Detected, confirm on next step
                </Text>
              ) : null}
            </View>
            <Text
              style={[
                styles.rowValue,
                { color: hasPendingAutoTip ? colors.textSecondary : colors.text },
              ]}
            >
              {formatCurrency(hasPendingAutoTip ? (pendingAutoTipAmount || 0) : tip)}
            </Text>
          </View>
          <View style={styles.totalEditRow}>
            <Text style={[styles.totalEditLabel, { color: colors.textSecondary }]}>Current Total</Text>
            <TextInput
              style={[styles.totalEditInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              placeholder="$0.00"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={currentTotalInput}
              onChangeText={setCurrentTotalInput}
              testID="total-input"
            />
          </View>
          <TouchableOpacity style={[styles.continueBtn, { backgroundColor: colors.primary }]} onPress={handleContinue} testID="continue-items">
            <Text style={[styles.continueBtnText, { color: colors.white }]}>Continue</Text>
            <ChevronRight color={colors.white} size={20} />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  restaurantSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  restaurantInput: {
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 17,
    fontWeight: '600' as const,
    borderWidth: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
  countBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
  },
  countText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  itemCard: {
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    borderWidth: 1,
  },
  itemIndex: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  itemIndexText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  itemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  itemName: {
    flex: 2,
    fontSize: 15,
    fontWeight: '500' as const,
  },
  itemPrice: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600' as const,
    textAlign: 'right' as const,
  },
  deleteBtn: {
    padding: 8,
    marginLeft: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    marginTop: 4,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  emptyActionBtn: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  emptyActionText: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  bottomArea: {
    borderTopWidth: 1,
    paddingTop: 12,
  },
  addItemRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    alignItems: 'center',
  },
  addInput: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '500' as const,
  },
  rowValue: {
    fontSize: 18,
    fontWeight: '700' as const,
  },
  pendingTipText: {
    fontSize: 12,
    marginTop: 2,
  },
  totalEditRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 14,
  },
  totalEditLabel: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  totalEditInput: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 18,
    width: 150,
    textAlign: 'right' as const,
    borderWidth: 1,
    fontWeight: '700' as const,
  },
  continueBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 54,
  },
  continueBtnText: {
    fontSize: 17,
    fontWeight: '700' as const,
  },
});
