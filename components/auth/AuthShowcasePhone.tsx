import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, View } from "react-native";

type Props = { accentColor: string; accentSoft: string; borderColor: string; cardColor: string; mutedColor: string; textColor: string };

const PHONE_WIDTH = 282;
const PHONE_HEIGHT = 588;
const INSET = 11;
const SCREEN_WIDTH = PHONE_WIDTH - INSET * 2;
const SCREEN_HEIGHT = PHONE_HEIGHT - INSET * 2;
const RECEIPT_FONT = Platform.OS === "ios" ? "Menlo" : "monospace";
const STEP_COUNT = 7;
const HOLD_MS = 2050;
const SLIDE_MS = 420;
const receiptRows = [["1 Kale Avocado", "$30.00"], ["1 Fever Tree Club Soda", "$6.00"], ["1 Nicoise Salad", "$25.00"], ["1 Mint Iced Tea", "$6.00"]];
const editRows = [["1", "Kale Avocado", "30.00"], ["2", "Fever Tree Club Soda", "6.00"], ["3", "Nicoise Salad", "25.00"], ["4", "Mint Iced Tea", "6.00"]];
const assignGroups = [{ name: "Me", accent: "#97B87E", amount: "$43.76", lines: ["Kale Avocado (1/2)", "Nicoise Salad (1/2)", "Mint Iced Tea", "Shared tax + tip"] }, { name: "Maddox", accent: "#D8B041", amount: "$43.76", lines: ["Kale Avocado (1/2)", "Nicoise Salad (1/2)", "Fever Tree Club Soda", "Shared tax + tip"] }];

const avatar = (label: string, color: string) => <View style={[styles.avatar, { backgroundColor: color }]}><Text style={styles.avatarText}>{label}</Text></View>;

export default function AuthShowcasePhone({ accentColor, accentSoft, borderColor, cardColor, mutedColor, textColor }: Props) {
  const step = useRef(new Animated.Value(0)).current;
  const scan = useRef(new Animated.Value(0)).current;
  const tap = useRef(new Animated.Value(0)).current;
  const totalPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const sequence = [];
    for (let i = 1; i < STEP_COUNT; i += 1) {
      sequence.push(Animated.delay(HOLD_MS), Animated.timing(step, { toValue: i, duration: SLIDE_MS, easing: Easing.bezier(0.2, 0.84, 0.24, 1), useNativeDriver: true }));
    }
    const timeline = Animated.loop(Animated.sequence([...sequence, Animated.delay(HOLD_MS), Animated.timing(step, { toValue: 0, duration: 0, useNativeDriver: true })]));
    const scanLoop = Animated.loop(Animated.sequence([Animated.timing(scan, { toValue: 1, duration: 1500, easing: Easing.linear, useNativeDriver: true }), Animated.delay(320), Animated.timing(scan, { toValue: 0, duration: 0, useNativeDriver: true }), Animated.delay(280)]));
    const tapLoop = Animated.loop(Animated.sequence([Animated.delay(880), Animated.timing(tap, { toValue: 1, duration: 280, useNativeDriver: true }), Animated.timing(tap, { toValue: 0, duration: 540, useNativeDriver: true }), Animated.delay(980)]));
    const totalLoop = Animated.loop(Animated.sequence([Animated.timing(totalPulse, { toValue: 1, duration: 1400, useNativeDriver: true }), Animated.timing(totalPulse, { toValue: 0, duration: 1400, useNativeDriver: true })]));
    timeline.start(); scanLoop.start(); tapLoop.start(); totalLoop.start();
    return () => { timeline.stop(); scanLoop.stop(); tapLoop.stop(); totalLoop.stop(); };
  }, [scan, step, tap, totalPulse]);

  const trackX = step.interpolate({ inputRange: [0, 1, 2, 3, 4, 5, 6], outputRange: [0, -SCREEN_WIDTH, -SCREEN_WIDTH * 2, -SCREEN_WIDTH * 3, -SCREEN_WIDTH * 4, -SCREEN_WIDTH * 5, -SCREEN_WIDTH * 6] });
  const scanY = scan.interpolate({ inputRange: [0, 1], outputRange: [26, SCREEN_HEIGHT - 138] });
  const tapScale = tap.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0.55, 1, 1.25] });
  const tapOpacity = tap.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.9, 0] });
  const totalScale = totalPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] });
  const ring = (bottom: number, left?: string, right?: number) => <Animated.View style={[styles.tapRing, { bottom, left: left as any, right, opacity: tapOpacity, transform: [{ scale: tapScale }] }]} />;

  const metrics = [["Subtotal", "$67.00"], ["Tax", "$5.93"], ["Tip", "$14.59"]];

  return (
    <View style={styles.wrap}>
      <View style={[styles.phone, { shadowColor: accentColor }]}>
        <View style={styles.hardwareGlow} />
        <View style={styles.buttonLeftTop} />
        <View style={styles.buttonLeftMid} />
        <View style={styles.buttonRight} />
        <View style={styles.bezel}>
          <View style={styles.island} />
          <Animated.View style={[styles.track, { width: SCREEN_WIDTH * STEP_COUNT, transform: [{ translateX: trackX }] }]}>
            <View style={[styles.screen, styles.cameraScreen]}>
              <View style={styles.receiptBackdrop}>
                <View style={styles.receiptShadow} />
                <View style={styles.receiptCard}>
                  <Text style={styles.receiptBrand}>FIVE ACRES</Text>
                  <Text style={styles.receiptMeta}>Five Acres</Text>
                  <Text style={styles.receiptMeta}>30 Rockefeller Plaza</Text>
                  <Text style={styles.receiptMeta}>Suite 8 | Rink Level</Text>
                  <Text style={styles.receiptMeta}>New York, NY 10012</Text>
                  <View style={styles.receiptGap} />
                  <Text style={styles.receiptMeta}>Server: AM Bar S</Text>
                  <Text style={styles.receiptMeta}>Guest Count: 2</Text>
                  <Text style={styles.receiptMeta}>10/24/23 12:52 PM</Text>
                  <View style={styles.receiptGap} />
                  {receiptRows.map(([name, price]) => <View key={name} style={styles.receiptRow}><Text style={styles.receiptLine}>{name}</Text><Text style={styles.receiptLine}>{price}</Text></View>)}
                  <View style={styles.receiptGap} />
                  {[["Subtotal", "$67.00"], ["Gratuity (20%)", "$14.59"], ["Tax", "$5.93"], ["Total", "$87.52"]].map(([name, price]) => <View key={name} style={styles.receiptRow}><Text style={name === "Total" ? styles.receiptTotal : styles.receiptLine}>{name}</Text><Text style={name === "Total" ? styles.receiptTotal : styles.receiptLine}>{price}</Text></View>)}
                </View>
                <View style={styles.receiptFold} />
              </View>
              <View style={styles.cameraOverlay}>
                <View style={[styles.scanFrame, { borderColor: "rgba(255,255,255,0.16)" }]}>
                  {[styles.cornerTL, styles.cornerTR, styles.cornerBL, styles.cornerBR].map((corner, index) => <View key={index} style={[styles.corner, corner, { borderColor: accentColor }]} />)}
                  <Animated.View style={[styles.scanLine, { backgroundColor: accentColor, transform: [{ translateY: scanY }] }]} />
                  <Animated.View style={[styles.scanGlow, { transform: [{ translateY: scanY }] }]} />
                </View>
              </View>
            </View>

            <View style={[styles.screen, styles.appScreen, { backgroundColor: "#F7F8FA" }]}>
              <Text style={[styles.navTitle, { color: textColor }]}>Edit Items</Text>
              <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
                <Text style={[styles.cardTitle, { color: textColor }]}>FIVE ACRES</Text>
                {editRows.map(([idx, name, price]) => <View key={idx} style={[styles.listRow, { borderColor }]}><View style={styles.indexPill}><Text style={[styles.indexText, { color: mutedColor }]}>{idx}</Text></View><Text style={[styles.rowLabel, { color: textColor }]}>{name}</Text><Text style={[styles.rowValue, { color: textColor }]}>{price}</Text></View>)}
                <View style={styles.metrics}>{metrics.map(([label, value]) => <View key={label} style={styles.metricRow}><Text style={[styles.metricLabel, { color: mutedColor }]}>{label}</Text><Text style={[styles.metricValue, { color: textColor }]}>{value}</Text></View>)}</View>
                <View style={styles.currentTotal}><Text style={[styles.currentTotalText, { color: textColor }]}>87.52</Text></View>
                <View style={[styles.primaryCta, { backgroundColor: accentColor }]}><Text style={styles.primaryCtaText}>Continue</Text></View>
                {ring(14, undefined, 28)}
              </View>
            </View>

            <View style={[styles.screen, styles.appScreen, { backgroundColor: "#F7F8FA" }]}>
              <Text style={[styles.navTitle, { color: textColor }]}>Tip</Text>
              <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
                <View style={[styles.tipHero, { backgroundColor: "#EEF6E8", borderColor: accentColor }]}>
                  <Text style={[styles.tipHeroLabel, { color: accentColor }]}>Automatic gratuity detected</Text>
                  <Text style={[styles.tipHeroValue, { color: accentColor }]}>$14.59</Text>
                  <Text style={[styles.tipHeroBody, { color: mutedColor }]}>Included in receipt total. No extra tip math needed.</Text>
                </View>
                <View style={[styles.tipPanel, { borderColor }]}>
                  <Text style={[styles.tipPanelTitle, { color: textColor }]}>How should tip be split?</Text>
                  <Text style={[styles.tipPanelCopy, { color: mutedColor }]}>Choose item-based split or even split. You can finalize people next.</Text>
                  <View style={styles.tipToggleRow}>
                    <View style={[styles.tipToggle, { backgroundColor: "#F3F8EE", borderColor: accentColor }]}><Text style={[styles.tipToggleLabel, { color: accentColor }]}>By Items</Text><Text style={[styles.tipToggleHint, { color: accentColor }]}>Based on each person&apos;s items</Text></View>
                    <View style={[styles.tipToggle, { backgroundColor: "#F5F6F8", borderColor }]}><Text style={[styles.tipToggleLabel, { color: textColor }]}>Evenly</Text><Text style={[styles.tipToggleHint, { color: mutedColor }]}>Same tip amount for everyone</Text></View>
                  </View>
                </View>
                <Text style={[styles.sectionSmall, { color: mutedColor }]}>QUICK SELECT</Text>
                <View style={styles.quickSelectRow}>{[["15%", "$10.05"], ["18%", "$12.06"], ["20%", "$13.40"], ["25%", "$16.75"]].map(([label, value]) => <View key={label} style={[styles.tipChip, { borderColor }]}><Text style={[styles.tipChipLabel, { color: textColor }]}>{label}</Text><Text style={[styles.tipChipValue, { color: mutedColor }]}>{value}</Text></View>)}</View>
                <Text style={[styles.sectionSmall, { color: mutedColor }]}>CUSTOM</Text>
                <View style={styles.customRow}><View style={[styles.customField, { borderColor }]}><Text style={[styles.customPlaceholder, { color: mutedColor }]}>% Percent</Text></View><View style={[styles.customField, { borderColor }]}><Text style={[styles.customPlaceholder, { color: mutedColor }]}>$ Amount</Text></View></View>
                <View style={styles.tipAmountBar}><Text style={[styles.tipAmountLabel, { color: accentColor }]}>Tip amount</Text><Text style={[styles.tipAmountValue, { color: accentColor }]}>$14.59</Text></View>
                {ring(250, "29%", undefined)}
              </View>
            </View>

            <View style={[styles.screen, styles.appScreen, { backgroundColor: "#F7F8FA" }]}>
              <Text style={[styles.navTitle, { color: textColor }]}>{`Who's Splitting?`}</Text>
              <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
                <Text style={[styles.countText, { color: mutedColor }]}>2 people in this split</Text>
                <View style={styles.chipsRow}><View style={[styles.chip, { borderColor }]}>{avatar("M", accentColor)}<Text style={[styles.chipText, { color: textColor }]}>Me</Text></View><View style={[styles.chip, { borderColor }]}>{avatar("M", "#D8B041")}<Text style={[styles.chipText, { color: textColor }]}>Maddox</Text></View></View>
                <View style={[styles.optionRow, { backgroundColor: accentSoft, borderColor: accentColor }]}><Text style={[styles.optionText, { color: accentColor }]}>Add from Friends List</Text></View>
                <View style={[styles.optionRow, { backgroundColor: cardColor, borderColor }]}><Text style={[styles.optionMuted, { color: mutedColor }]}>Quick Add to Bill</Text></View>
                <View style={styles.flex} />
                <View style={[styles.primaryCta, { backgroundColor: accentColor }]}><Text style={styles.primaryCtaText}>Assign Items</Text></View>
                {ring(14, undefined, 28)}
              </View>
            </View>

            <View style={[styles.screen, styles.appScreen, { backgroundColor: "#F7F8FA" }]}>
              <Text style={[styles.navTitle, { color: textColor }]}>Assign Items</Text>
              <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
                <Text style={[styles.assignTitle, { color: textColor }]}>Split looks balanced</Text>
                <Text style={[styles.assignCopy, { color: mutedColor }]}>Shared items and fees are keeping everyone close to half.</Text>
                {assignGroups.map((group) => <View key={group.name} style={[styles.personCard, { borderColor }]}><View style={styles.personHeader}>{avatar(group.name[0], group.accent)}<Text style={[styles.personName, { color: textColor }]}>{group.name}</Text><Text style={[styles.personAmount, { color: textColor }]}>{group.amount}</Text></View>{group.lines.map((line) => <Text key={line} style={[styles.personItem, { color: textColor }]}>{line}</Text>)}</View>)}
                <View style={[styles.primaryCta, { backgroundColor: accentColor }]}><Text style={styles.primaryCtaText}>Continue</Text></View>
                {ring(14, undefined, 28)}
              </View>
            </View>

            <View style={[styles.screen, styles.appScreen, { backgroundColor: "#F7F8FA" }]}>
              <Text style={[styles.navTitle, { color: textColor }]}>Summary</Text>
              <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
                <Text style={[styles.cardTitle, { color: textColor }]}>FIVE ACRES</Text>
                <View style={[styles.summaryPanel, { borderColor }]}><View style={styles.summaryTop}><Text style={[styles.summaryTiny, { color: mutedColor }]}>TOTAL</Text><Text style={[styles.summaryBig, { color: textColor }]}>$87.52</Text></View>{metrics.map(([label, value]) => <View key={label} style={styles.metricRow}><Text style={[styles.metricLabel, { color: mutedColor }]}>{label}</Text><Text style={[styles.metricValue, { color: textColor }]}>{value}</Text></View>)}</View>
                <View style={[styles.confirmBar, { backgroundColor: accentSoft }]}><Text style={[styles.confirmText, { color: accentColor }]}>Does this look right?</Text><View style={styles.editPill}><Text style={[styles.editText, { color: mutedColor }]}>Edit</Text></View></View>
                {assignGroups.map((group) => <View key={group.name} style={[styles.personCard, { borderColor }]}><View style={styles.personHeader}>{avatar(group.name[0], group.accent)}<Text style={[styles.personName, { color: textColor }]}>{group.name}</Text><Text style={[styles.personAmount, { color: textColor }]}>{group.amount}</Text></View>{group.lines.slice(0, 3).map((line) => <Text key={line} style={[styles.personItem, { color: textColor }]}>{line}</Text>)}</View>)}
              </View>
            </View>

            <View style={[styles.screen, styles.appScreen, { backgroundColor: "#F7F8FA" }]}>
              <Text style={[styles.navTitle, { color: textColor }]}>Payment</Text>
              <View style={[styles.card, { backgroundColor: cardColor, borderColor }]}>
                <View style={[styles.paymentHeader, { borderColor }]}><View><Text style={[styles.paymentTitle, { color: textColor }]}>Receipt Split!</Text><Text style={[styles.paymentSub, { color: mutedColor }]}>FIVE ACRES</Text></View><View><Text style={[styles.summaryTiny, { color: mutedColor, textAlign: "right" }]}>TOTAL</Text><Animated.Text style={[styles.paymentAmount, { color: textColor, transform: [{ scale: totalScale }] }]}>$43.76</Animated.Text></View></View>
                <Text style={[styles.sectionSmall, { color: mutedColor }]}>SEND PAYMENT REQUESTS</Text>
                <View style={[styles.personCard, { borderColor }]}><View style={styles.personHeader}>{avatar("M", "#D8B041")}<Text style={[styles.personName, { color: textColor }]}>Maddox</Text><Text style={[styles.personAmount, { color: textColor }]}>$43.76</Text></View><Text style={[styles.paymentSub, { color: mutedColor, marginBottom: 8 }]}>3 shared items</Text><View style={styles.venmoCta}><Text style={styles.venmoText}>V Venmo</Text></View><View style={styles.paymentActions}><View style={[styles.actionPill, styles.actionPillWide, { backgroundColor: "#F0EBFD" }]}><Text style={[styles.actionText, { color: "#8D7AEA" }]}>Share Message</Text></View><View style={[styles.actionPill, styles.actionPillShare, { backgroundColor: "#F5F6F8" }]}><Text style={[styles.actionText, { color: mutedColor }]}>Share</Text></View><View style={[styles.actionPill, styles.actionPillCompact, { backgroundColor: "#EEF6E8" }]}><Text style={[styles.actionText, { color: accentColor }]}>Paid</Text></View></View></View>
                <View style={[styles.doneButton, { borderColor }]}><Text style={[styles.doneText, { color: textColor }]}>Done</Text></View>
                {ring(106, "50%", undefined)}
              </View>
            </View>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  phone: { width: PHONE_WIDTH, height: PHONE_HEIGHT, borderRadius: 52, backgroundColor: "#0E0E0F", padding: INSET, shadowOffset: { width: 0, height: 24 }, shadowOpacity: 0.15, shadowRadius: 36, elevation: 16 },
  hardwareGlow: { ...StyleSheet.absoluteFillObject, borderRadius: 52, borderWidth: 1, borderColor: "rgba(255,255,255,0.16)" },
  buttonLeftTop: { position: "absolute", left: -3, top: 132, width: 4, height: 34, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, backgroundColor: "#2A2A2B" },
  buttonLeftMid: { position: "absolute", left: -3, top: 176, width: 4, height: 62, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, backgroundColor: "#2A2A2B" },
  buttonRight: { position: "absolute", right: -3, top: 170, width: 4, height: 88, borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: "#2A2A2B" },
  bezel: { flex: 1, borderRadius: 42, backgroundColor: "#000", overflow: "hidden" },
  island: { position: "absolute", top: 10, left: (SCREEN_WIDTH - 96) / 2, width: 96, height: 28, borderRadius: 16, backgroundColor: "#050505", zIndex: 2 },
  track: { flex: 1, flexDirection: "row" },
  screen: { width: SCREEN_WIDTH, height: SCREEN_HEIGHT },
  cameraScreen: { backgroundColor: "#1A1C1E" },
  appScreen: { paddingTop: 52, paddingHorizontal: 14, paddingBottom: 14 },
  receiptBackdrop: { flex: 1, backgroundColor: "#D7D4CC", paddingHorizontal: 28, paddingVertical: 66, justifyContent: "center" },
  receiptShadow: { position: "absolute", top: 106, left: 48, right: 40, bottom: 98, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.12)" },
  receiptCard: { backgroundColor: "#FFFDFC", borderRadius: 8, paddingHorizontal: 18, paddingVertical: 22 },
  receiptBrand: { fontFamily: RECEIPT_FONT, fontSize: 18, fontWeight: "700", textAlign: "center", letterSpacing: 1.3, marginBottom: 12, color: "#111" },
  receiptMeta: { fontFamily: RECEIPT_FONT, fontSize: 9, lineHeight: 13, textAlign: "center", color: "#1B1B1B" },
  receiptGap: { height: 12 },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  receiptLine: { fontFamily: RECEIPT_FONT, fontSize: 9, color: "#1B1B1B", marginRight: 8, flexShrink: 1 },
  receiptTotal: { fontFamily: RECEIPT_FONT, fontSize: 10, fontWeight: "700", color: "#111" },
  receiptFold: { position: "absolute", left: 26, right: 32, top: "51%", height: 1, backgroundColor: "rgba(0,0,0,0.08)" },
  cameraOverlay: { ...StyleSheet.absoluteFillObject, paddingHorizontal: 20, paddingVertical: 78 },
  scanFrame: { flex: 1, borderRadius: 26, borderWidth: 1, overflow: "hidden" },
  corner: { position: "absolute", width: 26, height: 26, borderWidth: 2.5 },
  cornerTL: { top: 14, left: 14, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 12 },
  cornerTR: { top: 14, right: 14, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 12 },
  cornerBL: { left: 14, bottom: 14, borderTopWidth: 0, borderRightWidth: 0, borderBottomLeftRadius: 12 },
  cornerBR: { right: 14, bottom: 14, borderTopWidth: 0, borderLeftWidth: 0, borderBottomRightRadius: 12 },
  scanLine: { position: "absolute", left: 14, right: 14, height: 3, borderRadius: 999 },
  scanGlow: { position: "absolute", left: 24, right: 24, height: 28, borderRadius: 999, backgroundColor: "rgba(151,184,126,0.18)" },
  navTitle: { fontSize: 16, fontWeight: "700", textAlign: "center", marginBottom: 12 },
  card: { flex: 1, borderRadius: 28, borderWidth: 1, padding: 14 },
  cardTitle: { fontSize: 16, fontWeight: "800", marginBottom: 10 },
  listRow: { minHeight: 46, borderRadius: 16, borderWidth: 1, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", marginBottom: 8 },
  indexPill: { width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", marginRight: 10, backgroundColor: "#F1F3F6" },
  indexText: { fontSize: 11, fontWeight: "700" },
  rowLabel: { flex: 1, fontSize: 13, fontWeight: "600" },
  rowValue: { fontSize: 14, fontWeight: "700" },
  metrics: { marginTop: 8, gap: 7 },
  metricRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metricLabel: { fontSize: 11 },
  metricValue: { fontSize: 13, fontWeight: "700" },
  currentTotal: { minWidth: 74, alignSelf: "flex-end", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginTop: 10, marginBottom: 10, backgroundColor: "#F1F3F6" },
  currentTotalText: { fontSize: 16, fontWeight: "700" },
  primaryCta: { height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center", marginTop: "auto" },
  primaryCtaText: { color: "#FFF", fontSize: 15, fontWeight: "800" },
  tapRing: { position: "absolute", width: 46, height: 46, marginLeft: -23, borderRadius: 23, borderWidth: 2, borderColor: "rgba(255,255,255,0.92)" },
  tipHero: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 16, alignItems: "center", marginBottom: 12 },
  tipHeroLabel: { fontSize: 12, fontWeight: "700" },
  tipHeroValue: { fontSize: 22, fontWeight: "800", marginTop: 6 },
  tipHeroBody: { fontSize: 11, lineHeight: 15, textAlign: "center", marginTop: 6 },
  tipPanel: { borderWidth: 1, borderRadius: 18, padding: 12, marginBottom: 12 },
  tipPanelTitle: { fontSize: 14, fontWeight: "700" },
  tipPanelCopy: { fontSize: 11, lineHeight: 15, marginTop: 4, marginBottom: 10 },
  tipToggleRow: { flexDirection: "row", gap: 8 },
  tipToggle: { flex: 1, minHeight: 72, borderRadius: 14, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 10, justifyContent: "center" },
  tipToggleLabel: { fontSize: 13, fontWeight: "800" },
  tipToggleHint: { fontSize: 10, lineHeight: 13, marginTop: 4 },
  sectionSmall: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8, marginBottom: 8 },
  quickSelectRow: { flexDirection: "row", gap: 6, marginBottom: 12 },
  tipChip: { flex: 1, minHeight: 52, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  tipChipLabel: { fontSize: 11, fontWeight: "800" },
  tipChipValue: { fontSize: 10, marginTop: 4 },
  customRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  customField: { flex: 1, minHeight: 42, borderRadius: 14, borderWidth: 1, justifyContent: "center", paddingHorizontal: 12 },
  customPlaceholder: { fontSize: 12, fontWeight: "600" },
  tipAmountBar: { height: 44, borderRadius: 15, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#EEF6E8" },
  tipAmountLabel: { fontSize: 12, fontWeight: "700" },
  tipAmountValue: { fontSize: 18, fontWeight: "800" },
  countText: { fontSize: 13, fontWeight: "600", marginBottom: 10 },
  chipsRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  chip: { flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: "700" },
  avatar: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFF", fontSize: 11, fontWeight: "800" },
  optionRow: { height: 46, borderRadius: 15, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  optionText: { fontSize: 13, fontWeight: "700" },
  optionMuted: { fontSize: 13, fontWeight: "600" },
  flex: { flex: 1 },
  assignTitle: { fontSize: 15, fontWeight: "800", marginBottom: 4 },
  assignCopy: { fontSize: 11, lineHeight: 15, marginBottom: 10 },
  summaryPanel: { borderWidth: 1, borderRadius: 18, padding: 14, marginBottom: 12 },
  summaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 },
  summaryTiny: { fontSize: 10, fontWeight: "700", letterSpacing: 0.8 },
  summaryBig: { fontSize: 18, fontWeight: "800" },
  confirmBar: { height: 42, borderRadius: 14, marginBottom: 12, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  confirmText: { fontSize: 12, fontWeight: "700" },
  editPill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#FFF" },
  editText: { fontSize: 11, fontWeight: "700" },
  personCard: { borderWidth: 1, borderRadius: 18, padding: 12, marginBottom: 10 },
  personHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  personName: { marginLeft: 8, fontSize: 13, fontWeight: "700" },
  personAmount: { marginLeft: "auto", fontSize: 14, fontWeight: "800" },
  personItem: { fontSize: 11, marginBottom: 4 },
  paymentHeader: { borderWidth: 1, borderRadius: 18, padding: 14, flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  paymentTitle: { fontSize: 18, fontWeight: "800" },
  paymentSub: { fontSize: 12, marginTop: 4 },
  paymentAmount: { fontSize: 18, fontWeight: "800", marginTop: 4, textAlign: "right" },
  venmoCta: { height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", marginBottom: 10, backgroundColor: "#DDECFB" },
  venmoText: { color: "#0B7BFF", fontSize: 14, fontWeight: "800" },
  paymentActions: { flexDirection: "row", gap: 7 },
  actionPill: { minHeight: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  actionPillWide: { flex: 1.34 },
  actionPillShare: { flex: 0.98 },
  actionPillCompact: { flex: 0.82 },
  actionText: { fontSize: 9, lineHeight: 11, fontWeight: "700", textAlign: "center" },
  doneButton: { height: 46, borderRadius: 15, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 2 },
  doneText: { fontSize: 15, fontWeight: "700" },
});
