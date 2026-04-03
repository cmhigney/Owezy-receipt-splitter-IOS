import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Share,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { Check, Send, Copy, MessageCircle } from 'lucide-react-native';
import { useHistory } from '@/contexts/HistoryContext';
import { useSplitFlow } from '@/contexts/SplitFlowContext';
import { useTheme } from '@/contexts/ThemeContext';
import { formatCurrency } from '@/utils/currency';

export default function SplitDetailScreen() {
  const { splitId } = useLocalSearchParams<{ splitId: string }>();
  const { splits, updateSplitPayment } = useHistory();
  const {
    reset,
    setRestaurantName,
    setItems,
    setSubtotal,
    setTax,
    setHasFees,
    setTip,
    setTipSplitMode,
    setTipDetectedFromReceipt,
    setAutoGratuityInfo,
    setPeople,
    setEditingSplitId,
  } = useSplitFlow();
  const { colors } = useTheme();

  const split = useMemo(() => splits.find((s) => s.id === splitId), [splits, splitId]);

  const togglePaid = useCallback((personId: string, currentPaid: boolean) => {
    if (!splitId) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    updateSplitPayment(splitId, personId, !currentPaid);
  }, [splitId, updateSplitPayment]);

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

  const openVenmo = useCallback((personId: string, amount: number) => {
    const person = split?.people.find((p) => p.id === personId);
    const venmoUser = person?.venmoUsername?.replace('@', '') || '';
    const note = `Owezy: ${split?.restaurantName || 'Split bill'}`;

    const primaryUrl = venmoUser
      ? `venmo://paycharge?txn=charge&recipients=${encodeURIComponent(venmoUser)}&amount=${amount.toFixed(2)}&note=${encodeURIComponent(note)}`
      : `venmo://paycharge?txn=charge&amount=${amount.toFixed(2)}&note=${encodeURIComponent(note)}`;

    void openPaymentLink(primaryUrl, 'https://venmo.com/');
  }, [split, openPaymentLink]);

  const openCashApp = useCallback((personId: string, amount: number) => {
    const person = split?.people.find((p) => p.id === personId);
    const cashTag = (person?.cashAppUsername?.replace(/^\$+/, '') || '').replace(/[^a-zA-Z0-9._-]/g, '');
    const note = `Owezy: ${split?.restaurantName || 'Split bill'}`;

    const primaryUrl = cashTag
      ? `cashapp://cash.app/$${encodeURIComponent(cashTag)}?amount=${amount.toFixed(2)}&note=${encodeURIComponent(note)}`
      : `cashapp://cash.app/pay?amount=${amount.toFixed(2)}&note=${encodeURIComponent(note)}`;

    void openPaymentLink(primaryUrl, 'https://cash.app/');
  }, [split, openPaymentLink]);

  const openPayPal = useCallback((personId: string, amount: number) => {
    const person = split?.people.find((p) => p.id === personId);
    const paypalUser = person?.paypalUsername?.replace(/^[@/]+/, '') || '';
    const url = paypalUser
      ? `https://www.paypal.com/paypalme/${encodeURIComponent(paypalUser)}/${amount.toFixed(2)}`
      : 'https://www.paypal.com/';
    void openPaymentLink(url, 'https://www.paypal.com/');
  }, [split, openPaymentLink]);

  const copyForZelle = useCallback(async (personId: string, personName: string, amount: number) => {
    const person = split?.people.find((p) => p.id === personId);
    const zelleTarget = person?.zelleUsername ? `Send to ${person.zelleUsername}. ` : '';
    const text = `${zelleTarget}${personName} owes ${formatCurrency(amount)} for ${split?.restaurantName || 'the bill'}`;
    await Clipboard.setStringAsync(text);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Copied!', 'Amount and note copied. Open your bank app to send via Zelle.');
  }, [split]);

  const sendText = useCallback((personId: string, personName: string, amount: number) => {
    const person = split?.people.find((p) => p.id === personId);
    const phoneNumber = person?.phone?.replace(/[^0-9+]/g, '') || '';
    const message = `Hey ${personName}! You owe ${formatCurrency(amount)} for ${split?.restaurantName || 'our meal'}.`;

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
      void Share.share({ message });
      return;
    }

    Linking.openURL(smsUrl).catch(() => {
      void Share.share({ message });
    });
  }, [split]);

  const shareRequest = useCallback(async (personName: string, amount: number) => {
    const message = `Hey ${personName}! You owe ${formatCurrency(amount)} for ${split?.restaurantName || 'our meal'}. Pay via Venmo, Cash App, or Zelle.`;
    try {
      await Share.share({ message });
    } catch (e) {
      if (__DEV__) console.warn('Share failed:', e);
    }
  }, [split]);

  const loadSplitForEditing = useCallback((targetRoute: '/(tabs)/(scan)/items' | '/(tabs)/(scan)/assign') => {
    if (!split) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    reset();
    setEditingSplitId(split.id);
    setRestaurantName(split.restaurantName);
    setItems(split.items);
    setSubtotal(split.subtotal);
    setTax(split.tax);
    setHasFees(split.hasFees ?? false);
    setTip(split.tip);
    setTipSplitMode(split.tipSplitMode ?? 'proportional');
    setTipDetectedFromReceipt(split.tip > 0);
    setAutoGratuityInfo({
      detected: false,
      partySizeMin: null,
      policyText: null,
      includedInTotal: false,
    });
    setPeople(split.people);
    router.push(targetRoute as any);
  }, [
    split,
    reset,
    setRestaurantName,
    setItems,
    setSubtotal,
    setTax,
    setHasFees,
    setTip,
    setTipSplitMode,
    setTipDetectedFromReceipt,
    setAutoGratuityInfo,
    setPeople,
    setEditingSplitId,
  ]);

  if (!split) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.notFound, { color: colors.textMuted }]}>Split not found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.content}>
      <Text style={[styles.restaurantName, { color: colors.text }]}>{split.restaurantName}</Text>
      <Text style={[styles.date, { color: colors.textSecondary }]}>
        {new Date(split.date).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        })}
      </Text>

      <View style={[styles.totalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>Total</Text>
          <Text style={[styles.totalValue, { color: colors.text }]}>{formatCurrency(split.total)}</Text>
        </View>
        <View style={styles.breakdownRow}>
          <Text style={[styles.breakdownText, { color: colors.textMuted }]}>Subtotal {formatCurrency(split.subtotal)}</Text>
          <Text style={[styles.breakdownDot, { color: colors.textMuted }]}>-</Text>
          <Text style={[styles.breakdownText, { color: colors.textMuted }]}>{split.hasFees ? 'Tax & Fees' : 'Tax'} {formatCurrency(split.tax)}</Text>
          <Text style={[styles.breakdownDot, { color: colors.textMuted }]}>-</Text>
          <Text style={[styles.breakdownText, { color: colors.textMuted }]}>Tip {formatCurrency(split.tip)}</Text>
        </View>
      </View>

      <View style={styles.editRow}>
        <TouchableOpacity
          style={[styles.editSplitBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary + '30' }]}
          onPress={() => loadSplitForEditing('/(tabs)/(scan)/items')}
        >
          <Text style={[styles.editSplitBtnText, { color: colors.primary }]}>Edit Items & Totals</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.editSplitBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => loadSplitForEditing('/(tabs)/(scan)/assign')}
        >
          <Text style={[styles.editSplitBtnText, { color: colors.textSecondary }]}>Edit Assignments</Text>
        </TouchableOpacity>
      </View>

      {split.summaries
        .filter((s) => !s.personId.startsWith('me_'))
        .map((summary) => {
          const person = split.people.find((p) => p.id === summary.personId);
          return (
            <View key={summary.personId} style={[styles.personCard, { backgroundColor: colors.card, borderColor: colors.border }, summary.paid && styles.personCardPaid]}>
              <View style={styles.personHeader}>
                <View style={[styles.avatar, { backgroundColor: person?.color || colors.primary }]}>
                  <Text style={styles.avatarText}>
                    {summary.personName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.personInfo}>
                  <Text style={[styles.personName, { color: colors.text }]}>{summary.personName}</Text>
                  <Text style={[styles.personAmount, { color: colors.text }]}>{formatCurrency(summary.total)}</Text>
                </View>
                <TouchableOpacity
                  style={[styles.paidBtn, { backgroundColor: colors.surface }, summary.paid && { backgroundColor: colors.primary }]}
                  onPress={() => togglePaid(summary.personId, summary.paid)}
                >
                  {summary.paid ? (
                    <Check color="#FFFFFF" size={16} />
                  ) : (
                    <Text style={[styles.markPaidText, { color: colors.textMuted }]}>Mark Paid</Text>
                  )}
                </TouchableOpacity>
              </View>
              {!summary.paid && (() => {
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
                return (
                  <View style={styles.paymentSection}>
                    <View style={styles.paymentButtons}>
                      {showVenmo && (
                        <TouchableOpacity
                          style={[
                            styles.payBtn,
                            friendPreferred === 'venmo'
                              ? { backgroundColor: colors.venmo }
                              : { backgroundColor: colors.venmo + '18' },
                          ]}
                          onPress={() => openVenmo(summary.personId, summary.total)}
                        >
                          <Text style={[styles.payBtnIcon, { color: friendPreferred === 'venmo' ? '#FFF' : colors.venmo }]}>V</Text>
                          <Text style={[styles.payBtnText, { color: friendPreferred === 'venmo' ? '#FFF' : colors.venmo }]}>Venmo</Text>
                        </TouchableOpacity>
                      )}
                      {showCashApp && (
                        <TouchableOpacity
                          style={[
                            styles.payBtn,
                            friendPreferred === 'cashapp'
                              ? { backgroundColor: colors.cashApp }
                              : { backgroundColor: colors.cashApp + '18' },
                          ]}
                          onPress={() => openCashApp(summary.personId, summary.total)}
                        >
                          <Text style={[styles.payBtnIcon, { color: friendPreferred === 'cashapp' ? '#FFF' : colors.cashApp }]}>$</Text>
                          <Text style={[styles.payBtnText, { color: friendPreferred === 'cashapp' ? '#FFF' : colors.cashApp }]}>Cash App</Text>
                        </TouchableOpacity>
                      )}
                      {showZelle && (
                        <TouchableOpacity
                          style={[
                            styles.payBtn,
                            friendPreferred === 'zelle'
                              ? { backgroundColor: colors.zelle }
                              : { backgroundColor: colors.zelle + '18' },
                          ]}
                          onPress={() => copyForZelle(summary.personId, summary.personName, summary.total)}
                        >
                          <Copy color={friendPreferred === 'zelle' ? '#FFF' : colors.zelle} size={13} />
                          <Text style={[styles.payBtnText, { color: friendPreferred === 'zelle' ? '#FFF' : colors.zelle }]}>Zelle</Text>
                        </TouchableOpacity>
                      )}
                      {showPayPal && (
                        <TouchableOpacity
                          style={[
                            styles.payBtn,
                            friendPreferred === 'paypal'
                              ? { backgroundColor: colors.paypal }
                              : { backgroundColor: colors.paypal + '18' },
                          ]}
                          onPress={() => openPayPal(summary.personId, summary.total)}
                        >
                          <Text style={[styles.payBtnIcon, { color: friendPreferred === 'paypal' ? '#FFF' : colors.paypal }]}>P</Text>
                          <Text style={[styles.payBtnText, { color: friendPreferred === 'paypal' ? '#FFF' : colors.paypal }]}>PayPal</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={[styles.textBtn, { backgroundColor: colors.secondaryLight }]}
                        onPress={() => sendText(summary.personId, summary.personName, summary.total)}
                      >
                        <MessageCircle color={colors.secondary} size={14} />
                        <Text style={[styles.textBtnText, { color: colors.secondary }]}>Text</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.resendBtn, { backgroundColor: colors.surface }]}
                        onPress={() => shareRequest(summary.personName, summary.total)}
                      >
                        <Send color={colors.textSecondary} size={14} />
                        <Text style={[styles.resendText, { color: colors.textSecondary }]}>Share Request</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })()}
            </View>
          );
        })}
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
  notFound: {
    fontSize: 16,
    textAlign: 'center' as const,
    marginTop: 40,
  },
  restaurantName: {
    fontSize: 28,
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  date: {
    fontSize: 14,
    marginTop: 4,
    marginBottom: 20,
  },
  totalCard: {
    borderRadius: 18,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  totalLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  totalValue: {
    fontSize: 32,
    fontWeight: '800' as const,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  breakdownText: {
    fontSize: 13,
  },
  breakdownDot: {
    fontSize: 13,
  },
  editRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 18,
  },
  editSplitBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  editSplitBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  personCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
  },
  personCardPaid: {
    opacity: 0.6,
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
  personAmount: {
    fontSize: 19,
    fontWeight: '700' as const,
    marginTop: 1,
  },
  paidBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    minHeight: 38,
    justifyContent: 'center',
  },
  markPaidText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  resendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
  },
  resendText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
  paymentSection: {
    marginTop: 12,
  },
  paymentButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  payBtn: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: 12,
    minHeight: 48,
  },
  payBtnIcon: {
    fontSize: 15,
    fontWeight: '800' as const,
  },
  payBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  textBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    minHeight: 42,
  },
  textBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
});

