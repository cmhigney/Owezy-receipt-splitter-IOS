import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronRight, Percent, DollarSign, Pencil, CircleCheck as CheckCircle, ChevronLeft } from 'lucide-react-native';
import { useSplitFlow } from '@/contexts/SplitFlowContext';
import { useTheme } from '@/contexts/ThemeContext';
import { formatCurrency, parseCurrency } from '@/utils/currency';

const TIP_PRESETS = [15, 18, 20, 25];
const DEBUG_LOGS = __DEV__;

function debugLog(...args: unknown[]) {
  if (DEBUG_LOGS) {
    console.log(...args);
  }
}

export default function TipScreen() {
  const {
    subtotal,
    tax,
    tip,
    setTip,
    pendingAutoTipAmount,
    setPendingAutoTipAmount,
    tipSplitMode,
    setTipSplitMode,
    tipDetectedFromReceipt,
    setTipDetectedFromReceipt,
    autoGratuityInfo,
    setAutoGratuityInfo,
    people,
  } = useSplitFlow();
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const isNarrow = screenWidth < 390;
  const [showTipEntry, setShowTipEntry] = useState<boolean>(tip > 0 || tipDetectedFromReceipt);
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [customPercent, setCustomPercent] = useState<string>('');
  const [customDollar, setCustomDollar] = useState<string>('');
  const [finalTotalInput, setFinalTotalInput] = useState<string>('');
  const [finalTotalDraft, setFinalTotalDraft] = useState<string>('');
  const [isEditingFinalTotal, setIsEditingFinalTotal] = useState<boolean>(false);
  const [inputMode, setInputMode] = useState<'preset' | 'percent' | 'dollar'>('preset');
  const partySizePromptShownRef = useRef(false);

  const tipAmount = useMemo(() => tip, [tip]);
  const autoGratuityAmount = useMemo(
    () => (typeof autoGratuityInfo?.autoGratuityAmount === 'number' ? autoGratuityInfo.autoGratuityAmount : null),
    [autoGratuityInfo],
  );
  const additionalTipAmount = useMemo(
    () => (typeof autoGratuityInfo?.additionalTipAmount === 'number' ? autoGratuityInfo.additionalTipAmount : null),
    [autoGratuityInfo],
  );
  const hasDetectedAutoAndAddedTip = useMemo(
    () => Boolean((autoGratuityAmount || 0) > 0 && (additionalTipAmount || 0) > 0),
    [autoGratuityAmount, additionalTipAmount],
  );
  const autoGratuityDetected = useMemo(
    () => Boolean(autoGratuityInfo?.detected && tipDetectedFromReceipt && tipAmount > 0),
    [autoGratuityInfo, tipDetectedFromReceipt, tipAmount],
  );
  const calculatedTotalWithTip = useMemo(
    () => Math.round((subtotal + tax + tipAmount) * 100) / 100,
    [subtotal, tax, tipAmount],
  );
  const displayedFinalTotal = useMemo(
    () => parseCurrency(finalTotalInput) || calculatedTotalWithTip,
    [finalTotalInput, calculatedTotalWithTip],
  );

  useEffect(() => {
    if (isEditingFinalTotal) return;
    setFinalTotalInput(calculatedTotalWithTip > 0 ? calculatedTotalWithTip.toFixed(2) : '');
  }, [calculatedTotalWithTip, isEditingFinalTotal]);

  useEffect(() => {
    const partySizeMin = autoGratuityInfo?.partySizeMin;
    const shouldPrompt =
      !partySizePromptShownRef.current &&
      Boolean(autoGratuityInfo?.detected) &&
      typeof partySizeMin === 'number' &&
      partySizeMin > 0 &&
      typeof pendingAutoTipAmount === 'number' &&
      pendingAutoTipAmount > 0;

    if (!shouldPrompt) return;

    debugLog('[TipScreen] Showing party-size auto gratuity prompt', {
      pendingAutoTipAmount,
      partySizeMin,
      policyText: autoGratuityInfo?.policyText || null,
    });

    partySizePromptShownRef.current = true;
    Alert.alert(
      'Automatic gratuity found',
      `We detected ${formatCurrency(pendingAutoTipAmount)} gratuity for parties of ${partySizeMin}+ on this receipt. Do you have ${partySizeMin} or more people in your group?`,
      [
        {
          text: 'No',
          style: 'cancel',
          onPress: () => {
            debugLog('[TipScreen] Party-size prompt selection: NO', {
              clearedTipAmount: pendingAutoTipAmount,
            });
            setTip(0);
            setTipDetectedFromReceipt(false);
            setPendingAutoTipAmount(null);
            setAutoGratuityInfo({ ...autoGratuityInfo, detected: false });
            setShowTipEntry(false);
          },
        },
        {
          text: 'Yes',
          onPress: () => {
            debugLog('[TipScreen] Party-size prompt selection: YES', {
              appliedTipAmount: pendingAutoTipAmount,
            });
            setTip(pendingAutoTipAmount);
            setTipDetectedFromReceipt(true);
            setPendingAutoTipAmount(null);
            setShowTipEntry(true);
          },
        },
      ],
      { cancelable: false },
    );
  }, [
    autoGratuityInfo,
    setAutoGratuityInfo,
    pendingAutoTipAmount,
    setPendingAutoTipAmount,
    setTip,
    setTipDetectedFromReceipt,
  ]);

  const handlePreset = useCallback((percent: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedPreset(percent);
    setInputMode('preset');
    setCustomPercent('');
    setCustomDollar('');
    const amount = Math.round(subtotal * (percent / 100) * 100) / 100;
    debugLog('[TipScreen] Preset tip selected', { percent, amount });
    setTip(amount);
  }, [subtotal, setTip]);

  const handleCustomPercent = useCallback((value: string) => {
    setCustomPercent(value);
    setSelectedPreset(null);
    setInputMode('percent');
    setCustomDollar('');
    const pct = parseFloat(value) || 0;
    const amount = Math.round(subtotal * (pct / 100) * 100) / 100;
    debugLog('[TipScreen] Custom percent changed', { rawValue: value, percent: pct, amount });
    setTip(amount);
  }, [subtotal, setTip]);

  const handleCustomDollar = useCallback((value: string) => {
    setCustomDollar(value);
    setSelectedPreset(null);
    setInputMode('dollar');
    setCustomPercent('');
    const amount = parseFloat(value.replace(/[^0-9.]/g, '')) || 0;
    const rounded = Math.round(amount * 100) / 100;
    debugLog('[TipScreen] Custom dollar tip changed', { rawValue: value, amount: rounded });
    setTip(rounded);
  }, [setTip]);

  const handleAddTip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    debugLog('[TipScreen] Add tip selected');
    setTipDetectedFromReceipt(false);
    setShowTipEntry(true);
  }, [setTipDetectedFromReceipt]);

  const handleRemoveTip = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    debugLog('[TipScreen] Tip removed and reset to defaults');
    setShowTipEntry(false);
    setTip(0);
    setPendingAutoTipAmount(null);
    setTipDetectedFromReceipt(false);
    setTipSplitMode('proportional');
    setSelectedPreset(null);
    setCustomPercent('');
    setCustomDollar('');
  }, [setTip, setPendingAutoTipAmount, setTipDetectedFromReceipt, setTipSplitMode]);

  const handleTipSplitMode = useCallback((mode: 'proportional' | 'even') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    debugLog('[TipScreen] Tip split mode changed', { mode });
    setTipSplitMode(mode);
  }, [setTipSplitMode]);

  const handleContinue = useCallback(() => {
    const enteredTotal = parseCurrency(finalTotalInput);
    const finalTotal = enteredTotal > 0 ? enteredTotal : calculatedTotalWithTip;
    const nextTip = Math.max(0, Math.round((finalTotal - subtotal - tax) * 100) / 100);
    if (Math.abs(nextTip - tipAmount) > 0.009) {
      setTip(nextTip);
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    debugLog('[TipScreen] Continue pressed', {
      subtotal,
      tax,
      tipAmount,
      enteredTotal,
      finalTotal,
      adjustedTipAmount: nextTip,
      tipSplitMode,
      tipDetectedFromReceipt,
      autoGratuityDetected,
      autoGratuityAmount,
      additionalTipAmount,
    });
    router.push('/(tabs)/(scan)/people' as any);
  }, [
    subtotal,
    tax,
    finalTotalInput,
    calculatedTotalWithTip,
    tipAmount,
    setTip,
    tipSplitMode,
    tipDetectedFromReceipt,
    autoGratuityDetected,
    autoGratuityAmount,
    additionalTipAmount,
  ]);

  const handleStartFinalTotalEdit = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFinalTotalDraft(displayedFinalTotal > 0 ? displayedFinalTotal.toFixed(2) : '');
    setIsEditingFinalTotal(true);
  }, [displayedFinalTotal]);

  const handleCancelFinalTotalEdit = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFinalTotalDraft('');
    setIsEditingFinalTotal(false);
  }, []);

  const handleSaveFinalTotalEdit = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const enteredTotal = parseCurrency(finalTotalDraft);
    const nextTotal = enteredTotal > 0 ? enteredTotal : calculatedTotalWithTip;
    setFinalTotalInput(nextTotal > 0 ? nextTotal.toFixed(2) : '');
    setFinalTotalDraft('');
    setIsEditingFinalTotal(false);
  }, [finalTotalDraft, calculatedTotalWithTip]);

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          title: 'Tip',
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
      <View style={[styles.totalSummaryRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.totalSummaryCopy}>
          <Text style={[styles.totalSummaryLabel, { color: colors.textSecondary }]}>Current total</Text>
          <Text style={[styles.totalSummaryHint, { color: colors.textMuted }]}>Adjust tip or final total below</Text>
        </View>
        <Text style={[styles.totalSummaryValue, { color: colors.text }]}>{formatCurrency(displayedFinalTotal)}</Text>
      </View>
      {autoGratuityDetected && showTipEntry ? (
        <View style={[styles.autoGratuityCard, { backgroundColor: colors.successLight, borderColor: colors.success + '45' }]}>
          <View style={styles.detectedBadge}>
            <CheckCircle color={colors.success} size={18} />
            <Text style={[styles.autoGratuityTitle, { color: colors.success }]}>Automatic gratuity detected</Text>
          </View>
          {hasDetectedAutoAndAddedTip ? (
            <View style={styles.dualTipRow}>
              <View style={[styles.tipAmountBox, { backgroundColor: colors.card, borderColor: colors.success + '40' }]}>
                <Text style={[styles.tipAmountBoxLabel, { color: colors.textSecondary }]}>Auto gratuity</Text>
                <Text style={[styles.tipAmountBoxValue, { color: colors.success }]}>
                  {formatCurrency(autoGratuityAmount || 0)}
                </Text>
              </View>
              <View style={[styles.tipAmountBox, { backgroundColor: colors.card, borderColor: colors.success + '40' }]}>
                <Text style={[styles.tipAmountBoxLabel, { color: colors.textSecondary }]}>Added tip</Text>
                <Text style={[styles.tipAmountBoxValue, { color: colors.success }]}>
                  {formatCurrency(additionalTipAmount || 0)}
                </Text>
              </View>
            </View>
          ) : (
            <Text style={[styles.autoGratuityAmount, { color: colors.success }]}>{formatCurrency(tipAmount)}</Text>
          )}
          <Text style={[styles.autoGratuityHint, { color: colors.textSecondary }]}>
            Included in receipt total. No extra tip math needed.
          </Text>
          {autoGratuityInfo.partySizeMin ? (
            <Text style={[styles.autoGratuitySubHint, { color: colors.textSecondary }]}>
              Applies for parties of {autoGratuityInfo.partySizeMin}+.
            </Text>
          ) : autoGratuityInfo.policyText ? (
            <Text style={[styles.autoGratuitySubHint, { color: colors.textSecondary }]}>
              {autoGratuityInfo.policyText}
            </Text>
          ) : null}
        </View>
      ) : tipDetectedFromReceipt && tip > 0 && showTipEntry ? (
        <View style={[styles.detectedCard, { backgroundColor: colors.primaryLight, borderColor: colors.primary + '30' }]}>
          <View style={styles.detectedBadge}>
            <CheckCircle color={colors.primary} size={18} />
            <Text style={[styles.detectedBadgeText, { color: colors.primary }]}>Tip found on receipt</Text>
          </View>
          <Text style={[styles.detectedAmount, { color: colors.primaryDark }]}>{formatCurrency(tip)}</Text>
          <Text style={[styles.detectedHint, { color: colors.textSecondary }]}>You can adjust this or remove it below</Text>
        </View>
      ) : null}

      {showTipEntry && tipAmount > 0 ? (
        <View style={[styles.tipSplitModeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.tipSplitModeTitle, { color: colors.text }]}>How should tip be split?</Text>
          <Text style={[styles.tipSplitModeHint, { color: colors.textSecondary }]}>
            {people.length > 0
              ? `Choose item-based split or even split across ${people.length} people.`
              : 'Choose item-based split or even split. You can finalize people next.'}
          </Text>
          <View style={[styles.tipSplitModeRow, isNarrow && styles.tipSplitModeRowNarrow]}>
            <TouchableOpacity
              style={[
                styles.tipSplitModeBtn,
                { backgroundColor: colors.surface, borderColor: colors.border },
                tipSplitMode === 'proportional' && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
              ]}
              onPress={() => handleTipSplitMode('proportional')}
            >
              <Text style={[styles.tipSplitModeBtnTitle, { color: colors.text }, tipSplitMode === 'proportional' && { color: colors.primary }]}>
                By Items
              </Text>
              <Text style={[styles.tipSplitModeBtnSub, { color: colors.textMuted }]}>Based on each person&apos;s items</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.tipSplitModeBtn,
                { backgroundColor: colors.surface, borderColor: colors.border },
                tipSplitMode === 'even' && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
              ]}
              onPress={() => handleTipSplitMode('even')}
            >
              <Text style={[styles.tipSplitModeBtnTitle, { color: colors.text }, tipSplitMode === 'even' && { color: colors.primary }]}>
                Evenly
              </Text>
              <Text style={[styles.tipSplitModeBtnSub, { color: colors.textMuted }]}>Same tip amount for everyone</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {!showTipEntry ? (
        <View style={[styles.promptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={styles.promptEmoji}>$</Text>
          <Text style={[styles.promptTitle, { color: colors.text }]}>Add a tip?</Text>
          <Text style={[styles.promptSubtitle, { color: colors.textSecondary }]}>No tip was found on the receipt</Text>
          <TouchableOpacity style={[styles.addTipBtn, { backgroundColor: colors.primary }]} onPress={handleAddTip} testID="tip-yes">
            <Text style={[styles.addTipBtnText, { color: colors.white }]}>Add Tip</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View>
          <View style={[styles.presetRow, isNarrow && styles.presetRowNarrow]}>
            {TIP_PRESETS.map((pct) => {
              const isActive = selectedPreset === pct && inputMode === 'preset';
              return (
                <TouchableOpacity
                  key={pct}
                  style={[
                    styles.presetBtn,
                    isNarrow && styles.presetBtnNarrow,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    isActive && { borderColor: colors.primary, backgroundColor: colors.primaryLight },
                  ]}
                  onPress={() => handlePreset(pct)}
                >
                  <Text style={[styles.presetText, { color: colors.textSecondary }, isActive && { color: colors.primary }]}>
                    {pct}%
                  </Text>
                  <Text style={[styles.presetAmount, { color: colors.textMuted }, isActive && { color: colors.primaryDark }]}>
                    {formatCurrency(Math.round(subtotal * (pct / 100) * 100) / 100)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[styles.customRow, isNarrow && styles.customRowNarrow]}>
            <View style={[styles.customInputWrap, { backgroundColor: colors.card, borderColor: colors.border }, inputMode === 'percent' && { borderColor: colors.primary }]}>
              <Percent color={inputMode === 'percent' ? colors.primary : colors.textMuted} size={16} />
              <TextInput
                style={[styles.customInput, { color: colors.text }]}
                placeholder="Percent"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={customPercent}
                onChangeText={handleCustomPercent}
              />
            </View>
            <View style={[styles.customInputWrap, { backgroundColor: colors.card, borderColor: colors.border }, inputMode === 'dollar' && { borderColor: colors.primary }]}>
              <DollarSign color={inputMode === 'dollar' ? colors.primary : colors.textMuted} size={16} />
              <TextInput
                style={[styles.customInput, { color: colors.text }]}
                placeholder="Amount"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                value={customDollar}
                onChangeText={handleCustomDollar}
              />
            </View>
          </View>

          <View style={[styles.tipPreview, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.tipPreviewLabel, { color: colors.primaryDark }]}>Tip amount</Text>
            <Text style={[styles.tipPreviewValue, { color: colors.primary }]}>{formatCurrency(tipAmount)}</Text>
          </View>

          <TouchableOpacity style={styles.removeTipLink} onPress={handleRemoveTip}>
            <Text style={[styles.removeTipText, { color: colors.textMuted }]}>Remove tip</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.totalSection}>
        <View style={[styles.totalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>Total with tip</Text>
          {!isEditingFinalTotal ? (
            <View style={styles.totalValueWrap}>
              <Text style={[styles.totalValue, { color: colors.text }]}>
                {formatCurrency(displayedFinalTotal)}
              </Text>
              <TouchableOpacity
                style={[styles.editTotalIconBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={handleStartFinalTotalEdit}
                testID="tip-final-total-edit"
              >
                <Pencil size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : (
            <TextInput
              style={[styles.totalEditInlineInput, { backgroundColor: colors.surface, color: colors.text, borderColor: colors.border }]}
              placeholder="$0.00"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={finalTotalDraft}
              onChangeText={setFinalTotalDraft}
              testID="tip-final-total-input"
            />
          )}
        </View>
        <Text style={[styles.totalEditHint, { color: colors.textMuted }]}>
          Edit if card fees or final bill adjustments were added.
        </Text>
        {isEditingFinalTotal ? (
          <View style={styles.totalEditActions}>
            <TouchableOpacity
              style={[styles.totalActionBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
              onPress={handleCancelFinalTotalEdit}
              testID="tip-final-total-cancel"
            >
              <Text style={[styles.totalActionBtnText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.totalActionBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
              onPress={handleSaveFinalTotalEdit}
              testID="tip-final-total-save"
            >
              <Text style={[styles.totalActionBtnText, { color: colors.white }]}>Save</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <TouchableOpacity style={[styles.continueBtn, { backgroundColor: colors.primary }]} onPress={handleContinue} testID="continue-tip">
          <Text style={[styles.continueBtnText, { color: colors.white }]}>Choose People</Text>
          <ChevronRight color={colors.white} size={20} />
        </TouchableOpacity>
        </View>
      </View>
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
  totalSummaryRow: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  totalSummaryCopy: {
    flex: 1,
  },
  totalSummaryLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  totalSummaryHint: {
    fontSize: 12,
    marginTop: 3,
  },
  totalSummaryValue: {
    fontSize: 24,
    fontWeight: '800' as const,
  },
  promptCard: {
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
  },
  promptEmoji: {
    fontSize: 36,
    marginBottom: 12,
  },
  promptTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    marginBottom: 6,
  },
  promptSubtitle: {
    fontSize: 14,
    marginBottom: 24,
  },
  addTipBtn: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
  },
  addTipBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetRowNarrow: {
    justifyContent: 'space-between',
  },
  presetBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 2,
    minWidth: 72,
  },
  presetBtnNarrow: {
    flexBasis: '48%',
  },
  presetText: {
    fontSize: 17,
    fontWeight: '700' as const,
  },
  presetAmount: {
    fontSize: 11,
    marginTop: 2,
  },
  customRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  customRowNarrow: {
    flexDirection: 'column',
  },
  customInputWrap: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
  },
  customInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500' as const,
  },
  tipPreview: {
    borderRadius: 14,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
  },
  tipPreviewLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  tipPreviewValue: {
    fontSize: 24,
    fontWeight: '800' as const,
  },
  removeTipLink: {
    alignItems: 'center',
    marginTop: 16,
  },
  removeTipText: {
    fontSize: 14,
    textDecorationLine: 'underline' as const,
  },
  detectedCard: {
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1.5,
  },
  detectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  detectedBadgeText: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  detectedAmount: {
    fontSize: 32,
    fontWeight: '800' as const,
    marginBottom: 4,
  },
  detectedHint: {
    fontSize: 13,
  },
  autoGratuityCard: {
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1.5,
  },
  autoGratuityTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  autoGratuityAmount: {
    fontSize: 32,
    fontWeight: '800' as const,
    marginBottom: 4,
  },
  autoGratuityHint: {
    fontSize: 13,
  },
  autoGratuitySubHint: {
    fontSize: 12,
    marginTop: 4,
  },
  dualTipRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginBottom: 4,
  },
  tipAmountBox: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  tipAmountBoxLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  tipAmountBoxValue: {
    marginTop: 2,
    fontSize: 18,
    fontWeight: '800' as const,
  },
  tipSplitModeCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
  },
  tipSplitModeTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  tipSplitModeHint: {
    fontSize: 12,
    marginTop: 3,
    marginBottom: 10,
  },
  tipSplitModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  tipSplitModeRowNarrow: {
    flexDirection: 'column',
  },
  tipSplitModeBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 9,
    paddingHorizontal: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  tipSplitModeBtnTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  tipSplitModeBtnSub: {
    fontSize: 11,
    marginTop: 2,
  },
  totalSection: {
    marginTop: 32,
  },
  totalCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
  },
  totalValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editTotalIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  totalEditInlineInput: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 18,
    width: 150,
    textAlign: 'right' as const,
    borderWidth: 1,
    fontWeight: '700' as const,
  },
  totalEditActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 12,
  },
  totalActionBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalActionBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  totalEditHint: {
    fontSize: 12,
    marginBottom: 10,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  totalLabel: {
    fontSize: 17,
    fontWeight: '600' as const,
  },
  totalValue: {
    fontSize: 26,
    fontWeight: '800' as const,
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
