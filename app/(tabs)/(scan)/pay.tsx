import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Linking,
  Alert,
  Animated,
  Share,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { Check, Send, Copy, PartyPopper, MessageCircle } from 'lucide-react-native';
import { useSplitFlow } from '@/contexts/SplitFlowContext';
import { useHistory } from '@/contexts/HistoryContext';
import { useTheme } from '@/contexts/ThemeContext';
import { calculateSummaries } from '@/utils/splitting';
import { formatCurrency } from '@/utils/currency';
import { PersonSummary } from '@/types';

export default function PayScreen() {
  const params = useLocalSearchParams<{ splitId?: string }>();
  const { restaurantName, items, people, tax, tip, tipSplitMode, reset } = useSplitFlow();
  const { splits, updateSplitPayment } = useHistory();
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const isNarrow = screenWidth < 390;
  const [paidMap, setPaidMap] = useState<Record<string, boolean>>({});
  const checkAnims = useRef<Record<string, Animated.Value>>({});

  const latestSplitId = useMemo(() => (splits.length > 0 ? splits[0].id : ''), [splits]);
  const targetSplitId = useMemo(() => {
    const routeSplitId = typeof params.splitId === 'string' ? params.splitId : '';
    return routeSplitId || latestSplitId;
  }, [params.splitId, latestSplitId]);
  const selectedSplit = useMemo(
    () => splits.find((split) => split.id === targetSplitId),
    [splits, targetSplitId],
  );
  const activePeople = useMemo(() => selectedSplit?.people || people, [selectedSplit, people]);
  const activeRestaurantName = useMemo(
    () => selectedSplit?.restaurantName || restaurantName,
    [selectedSplit, restaurantName],
  );
  const summaries = useMemo(() => {
    if (selectedSplit) {
      return selectedSplit.summaries.filter((s) => !s.personId.startsWith('me_'));
    }
    return calculateSummaries(items, people, tax, tip, tipSplitMode).filter((s) => !s.personId.startsWith('me_'));
  }, [selectedSplit, items, people, tax, tip, tipSplitMode]);
  const totalOwed = useMemo(
    () => summaries.reduce((sum, s) => sum + s.total, 0),
    [summaries],
  );

  const getCheckAnim = useCallback((personId: string) => {
    if (!checkAnims.current[personId]) {
      checkAnims.current[personId] = new Animated.Value(0);
    }
    return checkAnims.current[personId];
  }, []);

  useEffect(() => {
    setPaidMap({});
  }, [targetSplitId]);

  const togglePaid = useCallback((personId: string, currentPaid: boolean) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const newPaid = !currentPaid;
    setPaidMap((prev) => ({ ...prev, [personId]: newPaid }));

    Animated.spring(getCheckAnim(personId), {
      toValue: newPaid ? 1 : 0,
      useNativeDriver: true,
    }).start();

    if (targetSplitId) {
      updateSplitPayment(targetSplitId, personId, newPaid);
    }
  }, [targetSplitId, updateSplitPayment, getCheckAnim]);

  const openPaymentLink = useCallback(async (primaryUrl: string, fallbackUrl: string) => {
    try {
      await Linking.openURL(primaryUrl);
      return;
    } catch {}

    try {
      await Linking.openURL(fallbackUrl);
    } catch {
      Alert.alert(
        'Unable to Open Payment App',
        'Could not open the payment app or fallback website on this device.',
      );
    }
  }, []);

  const openVenmo = useCallback((personId: string, amount: number, note: string) => {
    const person = activePeople.find((p) => p.id === personId);
    const venmoUser = person?.venmoUsername?.replace('@', '') || '';

    let url: string;
    if (venmoUser) {
      url = `venmo://paycharge?txn=charge&recipients=${encodeURIComponent(venmoUser)}&amount=${amount.toFixed(2)}&note=${encodeURIComponent(note)}`;
    } else {
      url = `venmo://paycharge?txn=charge&amount=${amount.toFixed(2)}&note=${encodeURIComponent(note)}`;
    }

    void openPaymentLink(url, 'https://venmo.com/');
  }, [activePeople, openPaymentLink]);

  const openCashApp = useCallback((personId: string, amount: number, note: string) => {
    const person = activePeople.find((p) => p.id === personId);
    const cashTag = (person?.cashAppUsername?.replace(/^\$+/, '') || '').replace(/[^a-zA-Z0-9._-]/g, '');

    let url: string;
    if (cashTag) {
      url = `cashapp://cash.app/$${encodeURIComponent(cashTag)}?amount=${amount.toFixed(2)}&note=${encodeURIComponent(note)}`;
    } else {
      url = `cashapp://cash.app/pay?amount=${amount.toFixed(2)}&note=${encodeURIComponent(note)}`;
    }

    void openPaymentLink(url, 'https://cash.app/');
  }, [activePeople, openPaymentLink]);

  const copyForZelle = useCallback(async (personName: string, amount: number) => {
    const text = `${personName} owes ${formatCurrency(amount)} for ${activeRestaurantName || 'the bill'}`;
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied!', 'Amount and note copied. Open your bank app to send via Zelle.');
  }, [activeRestaurantName]);

  const openPayPal = useCallback((personId: string, amount: number) => {
    const person = activePeople.find((p) => p.id === personId);
    const paypalUser = person?.paypalUsername?.replace(/^[@/]+/, '') || '';
    const url = paypalUser
      ? `https://www.paypal.com/paypalme/${encodeURIComponent(paypalUser)}/${amount.toFixed(2)}`
      : 'https://www.paypal.com/';
    void openPaymentLink(url, 'https://www.paypal.com/');
  }, [activePeople, openPaymentLink]);

  const sendText = useCallback((personId: string, personName: string, amount: number) => {
    const person = activePeople.find((p) => p.id === personId);
    const phoneNumber = person?.phone?.replace(/[^0-9+]/g, '') || '';
    const message = `Hey ${personName}! You owe ${formatCurrency(amount)} for ${activeRestaurantName || 'our meal'}. You can pay me via Venmo, Cash App, Zelle, or PayPal!`;

    let smsUrl: string;
    if (Platform.OS === 'ios') {
      smsUrl = phoneNumber
        ? `sms:${phoneNumber}&body=${encodeURIComponent(message)}`
        : `sms:&body=${encodeURIComponent(message)}`;
    } else if (Platform.OS === 'android') {
      smsUrl = phoneNumber
        ? `sms:${phoneNumber}?body=${encodeURIComponent(message)}`
        : `sms:?body=${encodeURIComponent(message)}`;
    } else {
      Share.share({ message });
      return;
    }

    Linking.openURL(smsUrl).catch(() => {
      Share.share({ message });
    });
  }, [activePeople, activeRestaurantName]);

  const shareRequest = useCallback(async (personName: string, amount: number) => {
    const message = `Hey ${personName}! You owe ${formatCurrency(amount)} for ${activeRestaurantName || 'our meal'}. Pay via Venmo, Cash App, Zelle, or PayPal!`;
    try {
      await Share.share({ message });
    } catch (e) {
      if (__DEV__) console.warn('Share failed:', e);
    }
  }, [activeRestaurantName]);

  const sendAllRequests = useCallback(async () => {
    const lines = summaries.map(
      (s) => `${s.personName}: ${formatCurrency(s.total)}`,
    );
    const message = `Split for ${activeRestaurantName || 'our meal'}:\n\n${lines.join('\n')}\n\nPay via Venmo, Cash App, Zelle, or PayPal!`;
    try {
      await Share.share({ message });
    } catch (e) {
      if (__DEV__) console.warn('Share all failed:', e);
    }
  }, [summaries, activeRestaurantName]);

  const handleDone = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace('/(tabs)/history' as any);
    reset();
  }, [reset]);

  const note = `Owezy: ${activeRestaurantName || 'Split bill'}`;

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <PartyPopper color={colors.primary} size={24} />
        <View style={styles.headerInfo}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Receipt Split!</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>{activeRestaurantName || 'Your split'}</Text>
        </View>
        <View style={styles.headerTotal}>
          <Text style={[styles.headerTotalLabel, { color: colors.textMuted }]}>Total</Text>
          <Text style={[styles.headerTotalValue, { color: colors.text }]}>{formatCurrency(totalOwed)}</Text>
        </View>
      </View>

      <Text style={[styles.sectionLabel, { color: colors.textMuted }]}>Send Payment Requests</Text>

      {summaries.map((summary: PersonSummary) => {
        const person = activePeople.find((p) => p.id === summary.personId);
        const isPaid = paidMap[summary.personId] ?? summary.paid;
        const checkScale = getCheckAnim(summary.personId).interpolate({
          inputRange: [0, 1],
          outputRange: [0, 1],
        });

        const hasPhone = !!person?.phone;
        const hasVenmo = !!person?.venmoUsername;
        const hasCashApp = !!person?.cashAppUsername;
        const hasZelle = !!person?.zelleUsername;
        const hasPayPal = !!person?.paypalUsername;
        const hasAny = hasVenmo || hasCashApp || hasZelle || hasPayPal;
        const showVenmo = !hasAny || hasVenmo;
        const showCashApp = !hasAny || hasCashApp;
        const showZelle = !hasAny || hasZelle;
        const showPayPal = !hasAny || hasPayPal;
        const friendPreferred = person?.preferredPayment;
        const paymentOptions = [
          showVenmo ? {
            key: 'venmo',
            label: 'Venmo',
            accent: colors.venmo,
            highlighted: friendPreferred === 'venmo',
            icon: 'V',
            onPress: () => openVenmo(summary.personId, summary.total, note),
          } : null,
          showCashApp ? {
            key: 'cashapp',
            label: 'Cash App',
            accent: colors.cashApp,
            highlighted: friendPreferred === 'cashapp',
            icon: '$',
            onPress: () => openCashApp(summary.personId, summary.total, note),
          } : null,
          showZelle ? {
            key: 'zelle',
            label: 'Zelle',
            accent: colors.zelle,
            highlighted: friendPreferred === 'zelle',
            icon: 'Copy',
            onPress: () => copyForZelle(summary.personName, summary.total),
          } : null,
          showPayPal ? {
            key: 'paypal',
            label: 'PayPal',
            accent: colors.paypal,
            highlighted: friendPreferred === 'paypal',
            icon: 'P',
            onPress: () => openPayPal(summary.personId, summary.total),
          } : null,
        ].filter(Boolean) as {
          key: string;
          label: string;
          accent: string;
          highlighted: boolean;
          icon: string;
          onPress: () => void;
        }[];
        const primaryOption =
          paymentOptions.find((option) => option.highlighted)
          ?? paymentOptions[0]
          ?? null;
        const secondaryOptions = paymentOptions.filter((option) => option.key !== primaryOption?.key);
        const primaryCopy = primaryOption
          ? hasAny
            ? `Request with ${primaryOption.label}`
            : `Open ${primaryOption.label}`
          : 'Share request';

        return (
          <View key={summary.personId} style={[styles.personCard, { backgroundColor: colors.card, borderColor: colors.border }, isPaid && styles.personCardPaid]}>
            <View style={styles.personHeader}>
              <View style={[styles.avatar, { backgroundColor: person?.color || colors.primary }]}>
                <Text style={styles.avatarText}>
                  {summary.personName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.personInfo}>
                <Text style={[styles.personName, { color: colors.text }]}>{summary.personName}</Text>
                <Text style={[styles.personItemCount, { color: colors.textMuted }]}>
                  {summary.items.length} item{summary.items.length !== 1 ? 's' : ''}
                </Text>
              </View>
              <Text style={[styles.personAmount, { color: colors.text }]}>{formatCurrency(summary.total)}</Text>
            </View>

            {!isPaid ? (
              <View style={styles.paymentSection}>
                {primaryOption ? (
                  <TouchableOpacity
                    style={[styles.primaryPayBtn, { backgroundColor: primaryOption.accent }]}
                    onPress={primaryOption.onPress}
                  >
                    <View style={styles.primaryPayBtnTextWrap}>
                      <Text style={styles.primaryPayBtnLabel}>{primaryCopy}</Text>
                      <Text style={styles.primaryPayBtnMethod}>
                        {primaryOption.label}
                        {primaryOption.highlighted ? ' preferred' : ''}
                      </Text>
                    </View>
                    <Text style={styles.primaryPayBtnIcon}>{primaryOption.icon}</Text>
                  </TouchableOpacity>
                ) : null}
                {secondaryOptions.length > 0 ? (
                  <View style={styles.secondaryMethods}>
                    {secondaryOptions.map((option) => (
                      <TouchableOpacity
                        key={option.key}
                        style={[styles.secondaryMethodBtn, { backgroundColor: option.accent + '18' }]}
                        onPress={option.onPress}
                      >
                        {option.key === 'zelle' ? (
                          <Copy color={option.accent} size={13} />
                        ) : (
                          <Text style={[styles.secondaryMethodIcon, { color: option.accent }]}>{option.icon}</Text>
                        )}
                        <Text style={[styles.secondaryMethodText, { color: option.accent }]}>{option.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
                {!hasAny ? (
                  <Text style={[styles.noHandleHint, { color: colors.textMuted }]}>
                    No saved payment handle for this friend yet. You can still send a message or open an app manually.
                  </Text>
                ) : null}
                <View style={[styles.actionRow, isNarrow && styles.actionRowNarrow]}>
                  <TouchableOpacity
                    style={[styles.textBtn, { backgroundColor: colors.secondaryLight }]}
                    onPress={() => sendText(summary.personId, summary.personName, summary.total)}
                  >
                    <MessageCircle color={colors.secondary} size={14} />
                    <Text style={[styles.textBtnText, { color: colors.secondary }]}>
                      {hasPhone ? 'Text' : 'Share Message'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.shareBtn, { backgroundColor: colors.surface }]}
                    onPress={() => shareRequest(summary.personName, summary.total)}
                  >
                    <Send color={colors.textSecondary} size={14} />
                    <Text style={[styles.shareBtnText, { color: colors.textSecondary }]}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.paidToggle, { backgroundColor: colors.primaryLight }]}
                    onPress={() => togglePaid(summary.personId, isPaid)}
                  >
                    <Check color={colors.primary} size={14} />
                    <Text style={[styles.paidToggleText, { color: colors.primary }]}>Paid</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.paidBadge, { backgroundColor: colors.primary }]}
                onPress={() => togglePaid(summary.personId, isPaid)}
              >
                <Animated.View style={{ transform: [{ scale: checkScale }] }}>
                  <Check color="#FFFFFF" size={16} />
                </Animated.View>
                <Text style={styles.paidBadgeText}>Paid</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}

      {summaries.length > 1 && (
        <TouchableOpacity style={[styles.sendAllBtn, { backgroundColor: colors.primary }]} onPress={sendAllRequests}>
          <Send color={colors.white} size={18} />
          <Text style={[styles.sendAllText, { color: colors.white }]}>Send All Requests</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={[styles.doneBtn, { borderColor: colors.border, backgroundColor: colors.card }]} onPress={handleDone} testID="done-button">
        <Check color={colors.text} size={18} />
        <Text style={[styles.doneBtnText, { color: colors.text }]}>Done</Text>
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
  headerCard: {
    borderRadius: 18,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 24,
    borderWidth: 1,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  headerTotal: {
    alignItems: 'flex-end',
  },
  headerTotalLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
  },
  headerTotalValue: {
    fontSize: 22,
    fontWeight: '800' as const,
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
  personCardPaid: {
    opacity: 0.65,
  },
  personHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  personInfo: {
    flex: 1,
  },
  personName: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
  personItemCount: {
    fontSize: 12,
    marginTop: 1,
  },
  personAmount: {
    fontSize: 22,
    fontWeight: '800' as const,
  },
  paymentSection: {
    marginTop: 14,
  },
  primaryPayBtn: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 58,
  },
  primaryPayBtnTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  primaryPayBtnLabel: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800' as const,
  },
  primaryPayBtnMethod: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '600' as const,
    marginTop: 2,
  },
  primaryPayBtnIcon: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800' as const,
  },
  secondaryMethods: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  secondaryMethodBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  secondaryMethodIcon: {
    fontSize: 15,
    fontWeight: '800' as const,
  },
  secondaryMethodText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  noHandleHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  actionRowNarrow: {
    justifyContent: 'space-between',
  },
  textBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    minHeight: 42,
  },
  textBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    minHeight: 42,
  },
  shareBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  paidToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
  },
  paidToggleText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    paddingVertical: 9,
    marginTop: 12,
    minHeight: 42,
  },
  paidBadgeText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  sendAllBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    marginTop: 8,
    marginBottom: 10,
  },
  sendAllText: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  doneBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    minHeight: 52,
  },
  doneBtnText: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
});
