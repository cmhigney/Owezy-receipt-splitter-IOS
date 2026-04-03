import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
  Linking,
} from 'react-native';
import { router, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/contexts/ThemeContext';

export const ONBOARDING_COMPLETE_KEY = 'owezy_onboarding_complete';
const { width: W } = Dimensions.get('window');
const NUM_SLIDES = 5;
type GroupSize = 'two' | 'small' | 'large' | null;

// ─── Illustration: Hero (animated receipt mockup) ───────────────────────────

function HeroIllustration({
  heroCardAnim,
  item1Anim,
  item2Anim,
  item3Anim,
  scanLineAnim,
  colors,
}: any) {
  const cardTY = heroCardAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  const scanTY = scanLineAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 168] });

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
      {/* Camera viewfinder frame */}
      <View style={hero.frame}>
        {/* Corner brackets */}
        {[
          { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
          { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
          { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
          { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
        ].map((corner, i) => (
          <View key={i} style={[hero.corner, corner as any, { borderColor: colors.primary }]} />
        ))}

        {/* Receipt card */}
        <Animated.View
          style={[
            hero.receiptCard,
            { backgroundColor: colors.card, opacity: heroCardAnim, transform: [{ translateY: cardTY }] },
          ]}
        >
          {/* Receipt header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, flex: 1 }}>
              🍕 Slice & Dice
            </Text>
            <Text style={{ fontSize: 10, color: colors.textMuted }}>Table 4</Text>
          </View>

          {/* Items */}
          <Animated.View style={{ opacity: item1Anim }}>
            <View style={hero.row}>
              <Text style={[hero.rowLabel, { color: colors.textSecondary }]}>Margherita Pizza</Text>
              <Text style={[hero.rowPrice, { color: colors.text }]}>$18.00</Text>
            </View>
          </Animated.View>
          <Animated.View style={{ opacity: item2Anim }}>
            <View style={hero.row}>
              <Text style={[hero.rowLabel, { color: colors.textSecondary }]}>Caesar Salad</Text>
              <Text style={[hero.rowPrice, { color: colors.text }]}>$14.00</Text>
            </View>
          </Animated.View>
          <Animated.View style={{ opacity: item3Anim }}>
            <View style={hero.row}>
              <Text style={[hero.rowLabel, { color: colors.textSecondary }]}>Craft Beers ×3</Text>
              <Text style={[hero.rowPrice, { color: colors.text }]}>$22.50</Text>
            </View>
          </Animated.View>

          {/* Total */}
          <Animated.View style={{ opacity: item3Anim }}>
            <View style={[hero.row, { marginTop: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }]}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>Total</Text>
              <Text style={{ fontSize: 13, fontWeight: '800', color: colors.primary }}>$54.50</Text>
            </View>
          </Animated.View>
        </Animated.View>

        {/* Scan line */}
        <Animated.View
          style={[
            hero.scanLine,
            { backgroundColor: colors.primary + '70', transform: [{ translateY: scanTY }] },
          ]}
        />
      </View>

      {/* Split avatars below */}
      <Animated.View style={[hero.avatarRow, { opacity: item3Anim }]}>
        {['👨', '👩', '🧑'].map((emoji, i) => (
          <View key={i} style={[hero.avatar, { backgroundColor: colors.primaryLight }]}>
            <Text style={{ fontSize: 18 }}>{emoji}</Text>
          </View>
        ))}
        <View style={[hero.splitBadge, { backgroundColor: colors.primary }]}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFF' }}>÷ 3</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const hero = StyleSheet.create({
  frame: {
    width: 210,
    height: 210,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 2,
  },
  receiptCard: {
    width: 178,
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  rowLabel: {
    fontSize: 11,
    flex: 1,
  },
  rowPrice: {
    fontSize: 11,
    fontWeight: '700',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    top: 20,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    marginLeft: 4,
  },
});

// ─── Illustration: Problem slide ─────────────────────────────────────────────

function ProblemIllustration({ item1Anim, item2Anim, item3Anim }: any) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-end' }}>
        {[
          { emoji: '🍽️', anim: item1Anim },
          { emoji: '🧾', anim: item2Anim },
          { emoji: '😬', anim: item3Anim },
        ].map(({ emoji, anim }, i) => (
          <Animated.Text
            key={i}
            style={{
              fontSize: 58,
              opacity: anim,
              transform: [
                { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) },
              ],
            }}
          >
            {emoji}
          </Animated.Text>
        ))}
      </View>
      <Animated.Text
        style={{
          fontSize: 14,
          color: '#9CA3AF',
          fontStyle: 'italic',
          textAlign: 'center',
          opacity: item3Anim,
          marginTop: 4,
        }}
      >
        {'"Who had the extra drinks?"'}
      </Animated.Text>
    </View>
  );
}

// ─── Illustration: Personalize slide ─────────────────────────────────────────

function PersonalizeIllustration({ item1Anim }: any) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.Text
        style={{
          fontSize: 72,
          opacity: item1Anim,
          transform: [
            { scale: item1Anim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
          ],
        }}
      >
        🤝
      </Animated.Text>
    </View>
  );
}

// ─── Illustration: Review slide ───────────────────────────────────────────────

function ReviewIllustration({
  starScales,
  starsSelected,
  reviewComplete,
  reviewCheckAnim,
  onStarPress,
  colors,
}: any) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
      <Text style={{ fontSize: 52 }}>🌟</Text>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <TouchableOpacity
            key={star}
            onPress={() => onStarPress(star)}
            disabled={reviewComplete}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Animated.Text
              style={{
                fontSize: 44,
                transform: [{ scale: starScales[star - 1] }],
              }}
            >
              {star <= starsSelected ? '⭐' : '☆'}
            </Animated.Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center' }}>
        Tap to rate before you start
      </Text>

      {reviewComplete && (
        <Animated.View
          style={{
            opacity: reviewCheckAnim,
            transform: [
              { scale: reviewCheckAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
            ],
          }}
        >
          <View style={[rev.badge, { backgroundColor: colors.primaryLight }]}>
            <Text style={[rev.badgeText, { color: colors.primary }]}>✓ Thank you so much!</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const rev = StyleSheet.create({
  badge: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  badgeText: { fontSize: 15, fontWeight: '700' },
});

// ─── Illustration: CTA slide ──────────────────────────────────────────────────

function CtaIllustration({ ctoBounce, item1Anim }: any) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.Text
        style={{
          fontSize: 80,
          opacity: item1Anim,
          transform: [
            { translateY: ctoBounce },
            { scale: item1Anim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
          ],
        }}
      >
        🎉
      </Animated.Text>
    </View>
  );
}

// ─── Slide copy ───────────────────────────────────────────────────────────────

const SLIDE_COPY = [
  {
    title: 'Split bills\nin seconds.',
    subtitle: 'Owezy reads your receipt and splits it item by item — instantly.',
  },
  {
    title: "We've all\nbeen there.",
    subtitle:
      'Bill arrives. Everyone goes quiet. Someone always ends up shortchanged.',
  },
  {
    title: 'Quick question...',
    subtitle: 'How many people do you usually split with?',
  },
  {
    title: "You're going to\nlove Owezy.",
    subtitle: 'Mind rating us before you start? It really helps us grow 🙏',
  },
  {
    title: "You're all set.",
    subtitle: 'Split smarter, collect faster, stress less.',
  },
];

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [slideIdx, setSlideIdx] = useState(0);
  const [groupSize, setGroupSize] = useState<GroupSize>(null);
  const [starsSelected, setStarsSelected] = useState(0);
  const [reviewComplete, setReviewComplete] = useState(false);

  // Slide transition
  const transitionOpacity = useRef(new Animated.Value(1)).current;
  const transitionTranslate = useRef(new Animated.Value(0)).current;

  // Per-slide content animations
  const heroCardAnim = useRef(new Animated.Value(0)).current;
  const item1Anim = useRef(new Animated.Value(0)).current;
  const item2Anim = useRef(new Animated.Value(0)).current;
  const item3Anim = useRef(new Animated.Value(0)).current;
  const titleAnim = useRef(new Animated.Value(0)).current;
  const subtitleAnim = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const reviewCheckAnim = useRef(new Animated.Value(0)).current;
  const ctoBounce = useRef(new Animated.Value(0)).current;
  const ctoBounceLoop = useRef<Animated.CompositeAnimation | null>(null);

  const starScales = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(1))).current;

  const animateIn = useCallback(
    (idx: number) => {
      // Stop any loops
      ctoBounceLoop.current?.stop();

      // Reset
      [heroCardAnim, item1Anim, item2Anim, item3Anim, titleAnim, subtitleAnim, scanLineAnim].forEach(
        (a) => a.setValue(0),
      );

      if (idx === 0) {
        // Hero: receipt card rises, items stagger in, scan line sweeps
        Animated.sequence([
          Animated.timing(heroCardAnim, {
            toValue: 1,
            duration: 480,
            easing: Easing.bezier(0.2, 0.84, 0.24, 1),
            useNativeDriver: true,
          }),
          Animated.stagger(100, [
            Animated.timing(item1Anim, { toValue: 1, duration: 280, useNativeDriver: true }),
            Animated.timing(item2Anim, { toValue: 1, duration: 280, useNativeDriver: true }),
            Animated.timing(item3Anim, { toValue: 1, duration: 280, useNativeDriver: true }),
          ]),
          Animated.timing(scanLineAnim, { toValue: 1, duration: 650, useNativeDriver: true }),
        ]).start();

        Animated.sequence([
          Animated.delay(280),
          Animated.parallel([
            Animated.timing(titleAnim, { toValue: 1, duration: 380, useNativeDriver: true }),
            Animated.timing(subtitleAnim, { toValue: 1, duration: 380, delay: 100, useNativeDriver: true }),
          ]),
        ]).start();
      } else {
        Animated.stagger(70, [
          Animated.spring(item1Anim, { toValue: 1, damping: 16, stiffness: 200, useNativeDriver: true }),
          Animated.spring(item2Anim, { toValue: 1, damping: 14, stiffness: 180, useNativeDriver: true }),
          Animated.spring(item3Anim, { toValue: 1, damping: 14, stiffness: 160, useNativeDriver: true }),
          Animated.timing(titleAnim, { toValue: 1, duration: 340, useNativeDriver: true }),
          Animated.timing(subtitleAnim, { toValue: 1, duration: 340, useNativeDriver: true }),
        ]).start();
      }

      if (idx === 4) {
        ctoBounce.setValue(0);
        const loop = Animated.loop(
          Animated.sequence([
            Animated.timing(ctoBounce, {
              toValue: -14,
              duration: 580,
              easing: Easing.bezier(0.4, 0, 0.6, 1),
              useNativeDriver: true,
            }),
            Animated.timing(ctoBounce, {
              toValue: 0,
              duration: 580,
              easing: Easing.bezier(0.4, 0, 0.6, 1),
              useNativeDriver: true,
            }),
          ]),
        );
        ctoBounceLoop.current = loop;
        loop.start();
      }
    },
    [heroCardAnim, item1Anim, item2Anim, item3Anim, titleAnim, subtitleAnim, scanLineAnim, ctoBounce],
  );

  useEffect(() => {
    animateIn(slideIdx);
    return () => { ctoBounceLoop.current?.stop(); };
  }, [slideIdx, animateIn]);

  const markComplete = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
  }, []);

  const goNext = useCallback(() => {
    if (slideIdx >= NUM_SLIDES - 1) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Animated.parallel([
      Animated.timing(transitionOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(transitionTranslate, { toValue: -22, duration: 150, useNativeDriver: true }),
    ]).start(() => {
      transitionTranslate.setValue(22);
      setSlideIdx((s) => s + 1);
      Animated.parallel([
        Animated.timing(transitionOpacity, { toValue: 1, duration: 210, useNativeDriver: true }),
        Animated.timing(transitionTranslate, {
          toValue: 0,
          duration: 210,
          easing: Easing.bezier(0.2, 0.84, 0.24, 1),
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [slideIdx, transitionOpacity, transitionTranslate]);

  const finish = useCallback(async (mode: 'signup' | 'login' = 'signup') => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await markComplete();
    router.replace({ pathname: '/auth', params: { mode } } as any);
  }, [markComplete]);

  const skip = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await markComplete();
    router.replace('/auth' as any);
  }, [markComplete]);

  const handleStarPress = useCallback(
    (star: number) => {
      if (reviewComplete) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setStarsSelected(star);

      for (let i = 0; i < star; i++) {
        Animated.sequence([
          Animated.timing(starScales[i], { toValue: 1.5, duration: 90, delay: i * 45, useNativeDriver: true }),
          Animated.spring(starScales[i], { toValue: 1, damping: 8, stiffness: 300, useNativeDriver: true }),
        ]).start();
      }

      // 4–5 stars → open App Store review (replace id with your actual App Store ID)
      if (star >= 4) {
        setTimeout(() => {
          const url = 'itms-apps://itunes.apple.com/app/id6760238769?action=write-review';
          Linking.canOpenURL(url).then((ok) => { if (ok) Linking.openURL(url); });
        }, 450);
      }

      setTimeout(() => {
        Animated.spring(reviewCheckAnim, { toValue: 1, damping: 12, stiffness: 200, useNativeDriver: true }).start();
        setReviewComplete(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(goNext, 900);
      }, 700);
    },
    [reviewComplete, starScales, reviewCheckAnim, goNext],
  );

  const canContinue = slideIdx !== 2 || groupSize !== null;
  const isReviewSlide = slideIdx === 3;
  const isCtaSlide = slideIdx === 4;
  const { title, subtitle } = SLIDE_COPY[slideIdx];

  const renderIllustration = () => {
    switch (slideIdx) {
      case 0:
        return (
          <HeroIllustration
            heroCardAnim={heroCardAnim}
            item1Anim={item1Anim}
            item2Anim={item2Anim}
            item3Anim={item3Anim}
            scanLineAnim={scanLineAnim}
            colors={colors}
          />
        );
      case 1:
        return <ProblemIllustration item1Anim={item1Anim} item2Anim={item2Anim} item3Anim={item3Anim} />;
      case 2:
        return <PersonalizeIllustration item1Anim={item1Anim} />;
      case 3:
        return (
          <ReviewIllustration
            starScales={starScales}
            starsSelected={starsSelected}
            reviewComplete={reviewComplete}
            reviewCheckAnim={reviewCheckAnim}
            onStarPress={handleStarPress}
            colors={colors}
          />
        );
      case 4:
        return <CtaIllustration ctoBounce={ctoBounce} item1Anim={item1Anim} />;
      default:
        return null;
    }
  };

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Skip */}
      {!isCtaSlide && (
        <TouchableOpacity
          style={[s.skipBtn, { top: insets.top + 14 }]}
          onPress={skip}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[s.skipText, { color: colors.textMuted }]}>Skip</Text>
        </TouchableOpacity>
      )}

      {/* Progress dots */}
      <View style={[s.dotsRow, { top: insets.top + 20 }]}>
        {Array.from({ length: NUM_SLIDES }).map((_, i) => (
          <View
            key={i}
            style={[
              s.dot,
              {
                backgroundColor: i <= slideIdx ? colors.primary : colors.border,
                width: i === slideIdx ? 24 : 6,
              },
            ]}
          />
        ))}
      </View>

      {/* Slide content */}
      <Animated.View
        style={[
          s.slideWrap,
          { opacity: transitionOpacity, transform: [{ translateX: transitionTranslate }] },
        ]}
      >
        {/* Illustration */}
        <View style={[s.illustrationArea, { minHeight: isReviewSlide ? 280 : 240 }]}>
          {renderIllustration()}
        </View>

        {/* Text */}
        <Animated.View
          style={[
            s.textArea,
            {
              opacity: titleAnim,
              transform: [
                { translateY: titleAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
              ],
            },
          ]}
        >
          <Text style={[s.slideTitle, { color: colors.text }]}>{title}</Text>
          <Animated.Text style={[s.slideSubtitle, { color: colors.textSecondary, opacity: subtitleAnim }]}>
            {subtitle}
          </Animated.Text>
        </Animated.View>

        {/* Personalize options (slide 2 only) */}
        {slideIdx === 2 && (
          <View style={s.optionsArea}>
            {[
              { id: 'two', label: 'Just the two of us', emoji: '👫' },
              { id: 'small', label: '3–5 friends', emoji: '👥' },
              { id: 'large', label: '6+ people', emoji: '🎉' },
            ].map((opt) => {
              const selected = groupSize === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[
                    s.optionCard,
                    {
                      backgroundColor: selected ? colors.primaryLight : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setGroupSize(opt.id as GroupSize);
                  }}
                  activeOpacity={0.75}
                >
                  <Text style={s.optionEmoji}>{opt.emoji}</Text>
                  <Text style={[s.optionLabel, { color: selected ? colors.primary : colors.text }]}>
                    {opt.label}
                  </Text>
                  {selected && <Text style={{ fontSize: 16, color: colors.primary }}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </Animated.View>

      {/* Footer CTA */}
      {!isReviewSlide && (
        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 28) }]}>
          {isCtaSlide ? (
            <>
              <TouchableOpacity
                style={[s.primaryBtn, { backgroundColor: colors.primary }]}
                onPress={() => void finish('signup')}
                activeOpacity={0.85}
              >
                <Text style={s.primaryBtnText}>Create Free Account</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.signInRow}
                onPress={() => void finish('login')}
                activeOpacity={0.7}
              >
                <Text style={[s.signInText, { color: colors.textSecondary }]}>
                  Already have an account?{' '}
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>Sign in</Text>
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={[
                s.primaryBtn,
                { backgroundColor: canContinue ? colors.primary : colors.surface },
              ]}
              onPress={goNext}
              disabled={!canContinue}
              activeOpacity={0.85}
            >
              <Text
                style={[s.primaryBtnText, { color: canContinue ? '#FFF' : colors.textMuted }]}
              >
                {slideIdx === 0 ? "Let's go" : 'Continue'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  skipBtn: { position: 'absolute', right: 22, zIndex: 10 },
  skipText: { fontSize: 15, fontWeight: '600' },
  dotsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    zIndex: 10,
  },
  dot: { height: 6, borderRadius: 3 },
  slideWrap: { flex: 1, paddingTop: 56 },
  illustrationArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  textArea: { paddingHorizontal: 28, paddingTop: 24, paddingBottom: 8 },
  slideTitle: {
    fontSize: W < 360 ? 30 : 36,
    fontWeight: '800',
    letterSpacing: -0.8,
    lineHeight: W < 360 ? 36 : 43,
    marginBottom: 10,
  },
  slideSubtitle: { fontSize: 17, lineHeight: 25, fontWeight: '500' },
  optionsArea: { paddingHorizontal: 24, gap: 10, marginTop: 12 },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  optionEmoji: { fontSize: 24 },
  optionLabel: { flex: 1, fontSize: 16, fontWeight: '600' },
  footer: { paddingHorizontal: 24, paddingTop: 8 },
  primaryBtn: {
    borderRadius: 16,
    paddingVertical: 18,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryBtnText: { fontSize: 17, fontWeight: '800', color: '#FFF' },
  signInRow: { alignItems: 'center', paddingVertical: 8 },
  signInText: { fontSize: 15, fontWeight: '500', textAlign: 'center' },
});
