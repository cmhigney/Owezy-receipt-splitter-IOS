import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { Asset } from 'expo-asset';
import { CameraView, useCameraPermissions, type FlashMode } from 'expo-camera';
import { router, Stack, useNavigation } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Image as ImageIcon, PenLine, Sparkles, ArrowRight, ChevronRight, Crown, Zap, ZapOff } from 'lucide-react-native';
import { useSplitFlow } from '@/contexts/SplitFlowContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { E2E_ENABLE_TEST_RECEIPTS } from '@/lib/e2e';
import { parseReceiptImage, type OCRScanRegion } from '@/utils/ocr';

const DEBUG_LOGS = __DEV__;
const SHOW_E2E_TEST_RECEIPTS = __DEV__ || E2E_ENABLE_TEST_RECEIPTS;
const SCAN_RECEIPT_WIDTH = 160;
const SCAN_RECEIPT_HEIGHT = 200;
const SCAN_BEAM_HEIGHT = 3;
const CAMERA_SCAN_FRAME_ASPECT = 1.45; // Slightly shorter than a real receipt so the guide fits smaller iPhones.

type LayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function debugLog(...args: unknown[]) {
  if (DEBUG_LOGS) {
    console.log(...args);
  }
}

function createTraceId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clampCameraZoom(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(0.7, Math.max(0, value));
}

function layoutsEqual(current: LayoutRect | null, next: LayoutRect): boolean {
  return !!current &&
    current.x === next.x &&
    current.y === next.y &&
    current.width === next.width &&
    current.height === next.height;
}

function mapPreviewFrameToImageRegion(params: {
  previewWidth: number;
  previewHeight: number;
  imageWidth: number;
  imageHeight: number;
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
}): OCRScanRegion | null {
  const {
    previewWidth,
    previewHeight,
    imageWidth,
    imageHeight,
    frameX,
    frameY,
    frameWidth,
    frameHeight,
  } = params;

  if (
    ![previewWidth, previewHeight, imageWidth, imageHeight, frameWidth, frameHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    return null;
  }

  const previewAspect = previewWidth / previewHeight;
  const imageAspect = imageWidth / imageHeight;

  let displayedWidth = previewWidth;
  let displayedHeight = previewHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (imageAspect > previewAspect) {
    displayedHeight = previewHeight;
    displayedWidth = displayedHeight * imageAspect;
    offsetX = (displayedWidth - previewWidth) / 2;
  } else {
    displayedWidth = previewWidth;
    displayedHeight = displayedWidth / imageAspect;
    offsetY = (displayedHeight - previewHeight) / 2;
  }

  return {
    x: clampUnit((frameX + offsetX) / displayedWidth),
    y: clampUnit((frameY + offsetY) / displayedHeight),
    width: clampUnit(frameWidth / displayedWidth),
    height: clampUnit(frameHeight / displayedHeight),
  };
}

function CameraHelperCard({
  zoomLabel,
}: {
  zoomLabel: string;
}) {
  return (
    <View style={styles.cameraHelperCard}>
      <Text style={styles.cameraHelperTitle}>Fit the full receipt in the guide</Text>
      <Text style={styles.cameraHelperSubtitle}>Include the item lines and totals. Pinch to zoom if needed.</Text>
      <View style={styles.cameraZoomBadge}>
        <Text style={styles.cameraZoomBadgeText}>{zoomLabel}</Text>
      </View>
    </View>
  );
}

function CameraFlashControls({
  cameraFlash,
  colors,
  disabled,
  onChange,
  showLabel = true,
}: {
  cameraFlash: FlashMode;
  colors: {
    warning: string;
    warningLight: string;
  };
  disabled: boolean;
  onChange: (mode: FlashMode) => void;
  showLabel?: boolean;
}) {
  return (
    <View style={styles.cameraFlashGroup}>
      {showLabel ? <Text style={styles.cameraControlsLabel}>Flash</Text> : null}
      <View style={styles.cameraFlashRow}>
        {(['off', 'on'] as FlashMode[]).map((mode) => {
          const selected = cameraFlash === mode;
          const label = mode === 'on' ? 'On' : 'Off';
          const Icon = mode === 'off' ? ZapOff : Zap;

          return (
            <TouchableOpacity
              key={mode}
              style={[
                styles.flashChip,
                {
                  backgroundColor: selected ? colors.warningLight : 'rgba(0,0,0,0.45)',
                  borderColor: selected ? colors.warning : 'rgba(255,255,255,0.12)',
                },
              ]}
              onPress={() => onChange(mode)}
              activeOpacity={0.85}
              disabled={disabled}
            >
              <Icon color={selected ? colors.warning : '#FFFFFF'} size={12} />
              <Text style={[styles.flashChipText, { color: selected ? colors.warning : '#FFFFFF' }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function ScanScreen() {
  const {
    reset,
    setItems,
    setRestaurantName,
    setTax,
    setHasFees,
    setTip,
    setPendingAutoTipAmount,
    setTipDetectedFromReceipt,
    setAutoGratuityInfo,
  } = useSplitFlow();
  const { user, logOut } = useAuth();
  const {
    isPro,
    hasPaidAccess,
    canUseScan,
    remainingScans,
    displayRemainingScans,
    displayAllowanceScans,
    currentPlanKind,
    freeScansPerMonth,
    recordSuccessfulScan,
  } = useSubscription();
  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const [processing, setProcessing] = useState<boolean>(false);
  const [showCamera, setShowCamera] = useState<boolean>(false);
  const [capturingPhoto, setCapturingPhoto] = useState<boolean>(false);
  const [cameraFlash, setCameraFlash] = useState<FlashMode>('off');
  const [cameraZoom, setCameraZoom] = useState<number>(0);
  const scanAnim = useRef(new Animated.Value(0)).current;
  const btnScale = useRef(new Animated.Value(1)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scanRequestIdRef = useRef(0);
  const activeScanIdRef = useRef<number | null>(null);
  const cameraRef = useRef<CameraView | null>(null);
  const zoomStartRef = useRef(0);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [cameraViewportLayout, setCameraViewportLayout] = useState<LayoutRect | null>(null);
  const [cameraFrameStageLayout, setCameraFrameStageLayout] = useState<LayoutRect | null>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const defaultTabBarStyle = useMemo(
    () => ({
      backgroundColor: colors.tabBar,
      borderTopColor: colors.tabBarBorder,
      borderTopWidth: 1,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.04,
      shadowRadius: 12,
      elevation: 8,
    }),
    [colors.tabBar, colors.tabBarBorder],
  );

  const isTablet = screenWidth >= 768;
  const isSmallPhone = screenHeight < 700;
  const cameraHorizontalPadding = isTablet ? 28 : 20;
  const cameraTopPadding = insets.top + (isSmallPhone ? 10 : 14);
  const cameraBottomPadding = Math.max(insets.bottom, 12) + (isSmallPhone ? 10 : 14);
  const cameraSectionGap = isSmallPhone ? 12 : 16;
  const cameraFrameStageMinHeight = isSmallPhone ? 240 : 360;
  const cameraFrameHorizontalInset = isSmallPhone ? 8 : 12;
  // tabBarHeight already includes insets.bottom — don't double-add it
  const cameraFrameVerticalInset = isSmallPhone ? 12 : 18;
  const frameStageWidth = Math.max(
    cameraFrameStageLayout?.width ?? screenWidth - cameraHorizontalPadding * 2,
    0,
  );
  const frameStageHeight = Math.max(
    cameraFrameStageLayout?.height ?? screenHeight * (isSmallPhone ? 0.44 : 0.54),
    0,
  );
  const cameraFrameMaxWidth = Math.max(
    0,
    Math.min(
      frameStageWidth - cameraFrameHorizontalInset * 2,
      isTablet ? 440 : screenWidth - cameraHorizontalPadding * 2,
    ),
  );
  const cameraFrameWidthFromHeight = Math.max(
    0,
    (frameStageHeight - cameraFrameVerticalInset * 2) / CAMERA_SCAN_FRAME_ASPECT,
  );
  const cameraFrameWidth = Math.max(0, Math.min(cameraFrameMaxWidth, cameraFrameWidthFromHeight));
  const cameraFrameHeight = cameraFrameWidth * CAMERA_SCAN_FRAME_ASPECT;
  const cameraFrameLeft = Math.max(0, (frameStageWidth - cameraFrameWidth) / 2);
  const cameraFrameTop = Math.max(0, (frameStageHeight - cameraFrameHeight) / 2);
  const cameraFrameRect = useMemo(
    () => (cameraFrameStageLayout
      ? {
          x: cameraFrameStageLayout.x + cameraFrameLeft,
          y: cameraFrameStageLayout.y + cameraFrameTop,
          width: cameraFrameWidth,
          height: cameraFrameHeight,
        }
      : null),
    [cameraFrameHeight, cameraFrameLeft, cameraFrameStageLayout, cameraFrameTop, cameraFrameWidth],
  );

  useEffect(() => {
    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: 1, duration: 3000, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 3000, useNativeDriver: true }),
      ]),
    );
    float.start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 2000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ]),
    );
    pulse.start();

    return () => {
      float.stop();
      pulse.stop();
    };
  }, [floatAnim, pulseAnim]);

  useEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;

    parent.setOptions({
      tabBarStyle: showCamera ? { display: 'none' } : defaultTabBarStyle,
    });

    return () => {
      parent.setOptions({ tabBarStyle: defaultTabBarStyle });
    };
  }, [defaultTabBarStyle, navigation, showCamera]);

  useEffect(() => {
    if (processing) {
      const scan = Animated.loop(
        Animated.sequence([
          Animated.timing(scanAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(scanAnim, { toValue: 0, duration: 1200, useNativeDriver: true }),
        ]),
      );
      scan.start();
      return () => scan.stop();
    }
  }, [processing, scanAnim]);

  const animatePress = useCallback(() => {
    Animated.sequence([
      Animated.timing(btnScale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(btnScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();
  }, [btnScale]);

  const cancelProcessing = useCallback(() => {
    if (!processing) return;
    activeScanIdRef.current = null;
    setProcessing(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [processing]);

  const handleCloseCamera = useCallback(() => {
    if (capturingPhoto) return;
    setShowCamera(false);
    setCameraZoom(0);
    setCameraViewportLayout(null);
    setCameraFrameStageLayout(null);
  }, [capturingPhoto]);

  const showManualRecoveryAlert = useCallback((title: string, message: string) => {
    Alert.alert(title, message, [
      { text: 'Try Again', style: 'cancel' },
      {
        text: 'Enter Manually',
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          reset();
          router.push('/(tabs)/(scan)/items' as any);
        },
      },
    ]);
  }, [reset]);

  const processImage = useCallback(async (imageUri: string, scanRegion?: OCRScanRegion | null) => {
    const scanId = scanRequestIdRef.current + 1;
    scanRequestIdRef.current = scanId;
    activeScanIdRef.current = scanId;
    const traceId = createTraceId('scan');
    const startedAtMs = Date.now();
    const isCurrentScan = () => activeScanIdRef.current === scanId;
    setProcessing(true);
    debugLog(`[ScanScreen][${traceId}] Processing image`, {
      imageUri,
      isPro,
      hasPaidAccess,
      canUseScan,
      remainingScans,
    });

    try {
      const ocrResult = await parseReceiptImage(imageUri, scanRegion ? { scanRegion } : undefined);
      if (!isCurrentScan()) {
        debugLog(`[ScanScreen][${traceId}] Scan result ignored because request is no longer active`);
        return;
      }
      debugLog(`[ScanScreen][${traceId}] OCR parsed`, {
        restaurantName: ocrResult.restaurantName,
        itemCount: ocrResult.items.length,
        tax: ocrResult.tax,
        tip: ocrResult.tip,
        total: ocrResult.total,
        autoGratuityDetected: Boolean(ocrResult.autoGratuity?.detected),
        autoGratuityPartySizeMin:
          typeof ocrResult.autoGratuity?.partySizeMin === 'number' ? ocrResult.autoGratuity.partySizeMin : null,
      });

      reset();
      setRestaurantName(ocrResult.restaurantName);
      setItems(ocrResult.items);
      setTax(ocrResult.tax);
      setHasFees(ocrResult.hasFees ?? false);
      setAutoGratuityInfo(ocrResult.autoGratuity);
      if (ocrResult.tip > 0) {
        const requiresPartySizeConfirmation =
          Boolean(ocrResult.autoGratuity?.detected) &&
          typeof ocrResult.autoGratuity?.partySizeMin === 'number' &&
          ocrResult.autoGratuity.partySizeMin > 0;

        if (requiresPartySizeConfirmation) {
          debugLog(`[ScanScreen][${traceId}] Tip routing: pending auto gratuity confirmation`, {
            pendingAutoTipAmount: ocrResult.tip,
            partySizeMin: ocrResult.autoGratuity.partySizeMin,
          });
          setPendingAutoTipAmount(ocrResult.tip);
          setTip(0);
          setTipDetectedFromReceipt(false);
        } else {
          debugLog(`[ScanScreen][${traceId}] Tip routing: apply detected receipt tip`, {
            tip: ocrResult.tip,
            tipDetectedFromReceipt: true,
          });
          setPendingAutoTipAmount(null);
          setTip(ocrResult.tip);
          setTipDetectedFromReceipt(true);
        }
      } else {
        debugLog(`[ScanScreen][${traceId}] Tip routing: no tip detected`);
        setPendingAutoTipAmount(null);
        setTip(0);
        setTipDetectedFromReceipt(false);
      }
      setProcessing(false);
      const hasPricedItems = ocrResult.items.some((item) => item.price > 0);
      const hasMeaningfulTotals = ocrResult.total > 0 || ocrResult.tax > 0 || ocrResult.tip > 0;
      debugLog(`[ScanScreen][${traceId}] Parsed totals validation`, {
        hasPricedItems,
        hasMeaningfulTotals,
        elapsedMs: Date.now() - startedAtMs,
      });
      if (!hasPricedItems && !hasMeaningfulTotals) {
        throw new Error('NO_ITEMS_OR_TOTAL');
      }

      try {
        await recordSuccessfulScan();
        if (!isCurrentScan()) {
          debugLog(`[ScanScreen][${traceId}] Scan usage result ignored because request is no longer active`);
          return;
        }
      } catch (usageError) {
        debugLog(`[ScanScreen][${traceId}] Failed to store local scan usage`, usageError);
        // BUG-H2: must guard here too — if recordSuccessfulScan throws and the scan
        // was cancelled, we must not navigate.
        if (!isCurrentScan()) {
          debugLog(`[ScanScreen][${traceId}] Scan cancelled during usage error; aborting navigation`);
          return;
        }
      }

      debugLog(`[ScanScreen][${traceId}] Navigation -> items`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.push('/(tabs)/(scan)/items' as any);
    } catch (error: any) {
      if (!isCurrentScan()) {
        debugLog(`[ScanScreen][${traceId}] Scan error ignored because request is no longer active`, {
          message: String(error?.message || ''),
        });
        return;
      }
      debugLog(`[ScanScreen][${traceId}] OCR flow failed`, {
        message: String(error?.message || ''),
        elapsedMs: Date.now() - startedAtMs,
      });
      setProcessing(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (error?.message === 'FREE_SCAN_LIMIT_REACHED') {
        debugLog(`[ScanScreen][${traceId}] Error branch: FREE_SCAN_LIMIT_REACHED`);
        Alert.alert(
          'Free Scans Used',
          `You used all ${freeScansPerMonth} free scans this month. Upgrade to Pro to keep scanning.`,
          [
            { text: 'Not Now', style: 'cancel' },
            {
              text: 'Enter Manually',
              onPress: () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                reset();
                router.push('/(tabs)/(scan)/items' as any);
              },
            },
            {
              text: 'View Plans',
              onPress: () => router.push('/(tabs)/profile/pro' as any),
            },
          ],
        );
      } else if (error?.message === 'SCAN_CREDIT_LIMIT_REACHED') {
        debugLog(`[ScanScreen][${traceId}] Error branch: SCAN_CREDIT_LIMIT_REACHED`);
        Alert.alert(
          'Scan Limit Reached',
          'You reached the scan allowance included with your current plan for this month.',
          [
            { text: 'Not Now', style: 'cancel' },
            {
              text: 'Enter Manually',
              onPress: () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                reset();
                router.push('/(tabs)/(scan)/items' as any);
              },
            },
            {
              text: 'View Plans',
              onPress: () => router.push('/(tabs)/profile/pro' as any),
            },
          ],
        );
      } else if (error?.message === 'NO_ITEMS_OR_TOTAL') {
        debugLog(`[ScanScreen][${traceId}] Error branch: NO_ITEMS_OR_TOTAL`);
        showManualRecoveryAlert(
          'No Receipt Detected',
          'We couldn\'t find any items or totals on this image. Try a clearer photo, or switch to manual entry so you can keep the split moving.',
        );
      } else if (error?.message === 'NOT_A_RECEIPT') {
        debugLog(`[ScanScreen][${traceId}] Error branch: NOT_A_RECEIPT`);
        showManualRecoveryAlert(
          'Not a Receipt',
          'This photo does not look like a readable receipt. Try a receipt photo, or enter items manually instead.',
        );
      } else if (error?.message === 'SCAN_TIMEOUT') {
        debugLog(`[ScanScreen][${traceId}] Error branch: SCAN_TIMEOUT`);
        showManualRecoveryAlert(
          'Scan Taking Too Long',
          'This scan took too long. Try a clearer receipt photo, or enter the bill manually to keep going.',
        );
      } else if (error?.message === 'AUTH_REQUIRED') {
        debugLog(`[ScanScreen][${traceId}] Error branch: AUTH_REQUIRED`);
        Alert.alert(
          'Session Expired',
          'Your login session expired while scanning. Please sign in again.',
          [
            {
              text: 'Sign In',
              onPress: () => {
                void logOut();
              },
            },
          ],
        );
      } else if (error?.message === 'BACKEND_UNREACHABLE') {
        debugLog(`[ScanScreen][${traceId}] Error branch: BACKEND_UNREACHABLE`);
        showManualRecoveryAlert(
          'Cannot Reach Backend',
          'We could not reach the scan service. Check your connection and try again, or use manual entry for now.',
        );
      } else {
        debugLog(`[ScanScreen][${traceId}] Error branch: OCR_SCAN_FAILED_UNKNOWN`);
        showManualRecoveryAlert(
          'Scan Failed',
          'Could not read the receipt. Please try again with a clearer photo, or use manual entry.',
        );
      }
    } finally {
      if (activeScanIdRef.current === scanId) {
        activeScanIdRef.current = null;
      }
    }
  }, [
    reset,
    setItems,
    setRestaurantName,
    setTax,
    setHasFees,
    setTip,
    setPendingAutoTipAmount,
    setTipDetectedFromReceipt,
    setAutoGratuityInfo,
    recordSuccessfulScan,
    freeScansPerMonth,
    logOut,
    isPro,
    hasPaidAccess,
    canUseScan,
    remainingScans,
    showManualRecoveryAlert,
  ]);

  const handleTakePhoto = useCallback(async () => {
    if (!cameraRef.current || capturingPhoto) return;

    setCapturingPhoto(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 1,
        skipProcessing: false,
        shutterSound: false,
      });

      if (!photo?.uri) {
        throw new Error('CAPTURE_FAILED');
      }

      const scanRegion =
        cameraViewportLayout && cameraFrameRect
          ? mapPreviewFrameToImageRegion({
              previewWidth: cameraViewportLayout.width,
              previewHeight: cameraViewportLayout.height,
              imageWidth: Number(photo.width) || 0,
              imageHeight: Number(photo.height) || 0,
              frameX: cameraFrameRect.x,
              frameY: cameraFrameRect.y,
              frameWidth: cameraFrameRect.width,
              frameHeight: cameraFrameRect.height,
            })
          : null;

      setShowCamera(false);
      debugLog('[ScanScreen] Captured receipt image URI:', photo.uri);
      processImage(photo.uri, scanRegion);
    } catch (error) {
      debugLog('[ScanScreen] Camera capture error:', error);
      Alert.alert('Camera Error', 'Could not capture the receipt photo. Please try again.');
    } finally {
      setCapturingPhoto(false);
    }
  }, [
    cameraFrameRect,
    cameraViewportLayout,
    capturingPhoto,
    processImage,
  ]);

  const showUpgradePrompt = useCallback(() => {
    debugLog('[ScanScreen] Showing Pro upgrade prompt', {
      freeScansPerMonth,
      remainingScans,
    });
    Alert.alert(
      hasPaidAccess ? 'Scan Limit Reached' : 'Free Scans Used',
      hasPaidAccess
        ? 'You reached the scan allowance included with your current plan for this month.'
        : `You used all ${freeScansPerMonth} free scans this month. Upgrade to Pro to keep scanning.`,
      [
        { text: 'Not Now', style: 'cancel' },
        {
          text: 'View Plans',
          onPress: () => router.push('/(tabs)/profile/pro' as any),
        },
      ],
    );
  }, [freeScansPerMonth, hasPaidAccess, remainingScans]);

  const handleCamera = useCallback(async () => {
    if (!canUseScan) {
      showUpgradePrompt();
      return;
    }

    animatePress();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      if (Platform.OS !== 'web') {
        const existingStatus = cameraPermission?.status;
        const permission =
          existingStatus === 'granted'
            ? cameraPermission
            : await requestCameraPermission();

        const status = permission?.status;
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Camera permission is required to scan receipts.');
          return;
        }
      }
      setCameraViewportLayout(null);
      setCameraFrameStageLayout(null);
      setCameraFlash('off');
      setCameraZoom(0);
      setShowCamera(true);
    } catch (error) {
      debugLog('[ScanScreen] Camera error:', error);
      Alert.alert('Error', 'Failed to open camera. Please try again.');
    }
  }, [animatePress, cameraPermission, canUseScan, requestCameraPermission, showUpgradePrompt]);

  const handleGallery = useCallback(async () => {
    if (!canUseScan) {
      showUpgradePrompt();
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
      });
      debugLog('[ScanScreen] Gallery result:', result.canceled ? 'canceled' : 'selected');
      if (!result.canceled && result.assets?.length > 0) {
        const uri = result.assets[0].uri;
        debugLog('[ScanScreen] Gallery image URI:', uri);
        processImage(uri);
      }
    } catch (error) {
      debugLog('[ScanScreen] Gallery error:', error);
      Alert.alert('Error', 'Failed to open gallery. Please try again.');
    }
  }, [canUseScan, processImage, showUpgradePrompt]);

  const handleManualEntry = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    reset();
    router.push('/(tabs)/(scan)/items' as any);
  }, [reset]);

  // ── DEV ONLY: bot-friendly test receipt loader ───────────────────────────
  const DEV_RECEIPTS = useMemo(() => (
    SHOW_E2E_TEST_RECEIPTS ? {
      basic: require('../../../assets/test-receipts/receipt_basic.png'),
      handwritten: require('../../../assets/test-receipts/receipt_handwritten.png'),
      autograt: require('../../../assets/test-receipts/receipt_autograt.png'),
    } : null
  ), []);

  const handleTestReceipt = useCallback(async (key: 'basic' | 'handwritten' | 'autograt') => {
    if (!DEV_RECEIPTS) return;
    const asset = Asset.fromModule(DEV_RECEIPTS[key]);
    await asset.downloadAsync();
    if (asset.localUri) processImage(asset.localUri);
  }, [processImage, DEV_RECEIPTS]);
  // ────────────────────────────────────────────────────────────────────────

  const scanLineY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCAN_RECEIPT_HEIGHT - SCAN_BEAM_HEIGHT],
  });
  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onBegin(() => {
          zoomStartRef.current = cameraZoom;
        })
        .onUpdate((event) => {
          const nextZoom = clampCameraZoom(zoomStartRef.current + (event.scale - 1) * 0.22);
          setCameraZoom(nextZoom);
        }),
    [cameraZoom],
  );
  const zoomLabel = `${(1 + cameraZoom * 2).toFixed(1)}x`;
  const floatY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-4, 4],
  });

  const firstName = user?.displayName?.split(' ')[0] || 'there';
  const planLabel = currentPlanKind === 'pro_yearly'
    ? 'Pro Annual'
    : currentPlanKind === 'pro_monthly'
      ? 'Pro Monthly'
      : 'Free plan';
  const scanBannerTitle = `${displayRemainingScans} scan${displayRemainingScans === 1 ? '' : 's'} left this month`;
  const scanBannerSubtitle = hasPaidAccess
    ? `${planLabel} includes ${displayAllowanceScans} scans per month and no ads.`
    : `Free plan includes ${freeScansPerMonth} scan${freeScansPerMonth === 1 ? '' : 's'} each month.`;

  if (showCamera) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false, title: 'Owezy' }} />
        <View
          style={[styles.cameraScreen, { backgroundColor: '#050505' }]}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            const nextLayout = { x: 0, y: 0, width, height };
            setCameraViewportLayout((current) => (layoutsEqual(current, nextLayout) ? current : nextLayout));
          }}
        >
          <GestureDetector gesture={pinchGesture}>
            <View style={StyleSheet.absoluteFill}>
              <CameraView
                ref={cameraRef}
                style={styles.cameraView}
                facing="back"
                flash={cameraFlash}
                zoom={cameraZoom}
              />
            </View>
          </GestureDetector>

          {cameraFrameRect ? (
            <View pointerEvents="none" style={styles.cameraGuideOverlay}>
              {/* 4 rectangular masks covering everything outside the frame window */}
              <View style={[styles.cameraMask, { top: 0, left: 0, right: 0, height: cameraFrameRect.y }]} />
              <View
                style={[
                  styles.cameraMask,
                  {
                    top: cameraFrameRect.y,
                    left: 0,
                    width: cameraFrameRect.x,
                    height: cameraFrameRect.height,
                  },
                ]}
              />
              <View
                style={[
                  styles.cameraMask,
                  {
                    top: cameraFrameRect.y,
                    right: 0,
                    left: cameraFrameRect.x + cameraFrameRect.width,
                    height: cameraFrameRect.height,
                  },
                ]}
              />
              <View
                style={[
                  styles.cameraMask,
                  {
                    top: cameraFrameRect.y + cameraFrameRect.height,
                    left: 0,
                    right: 0,
                    bottom: 0,
                  },
                ]}
              />
              {/* Corner patches: fill the gap between the rectangular mask window
                  and the rounded frame border. Each patch is a 30×30 square with
                  one inner rounded corner that exactly follows the frame's borderRadius,
                  cutting out the area the camera feed should show through. */}
              <View
                style={[
                  styles.cameraMask,
                  {
                    top: cameraFrameRect.y,
                    left: cameraFrameRect.x,
                    width: 30,
                    height: 30,
                    borderBottomRightRadius: 30,
                  },
                ]}
              />
              <View
                style={[
                  styles.cameraMask,
                  {
                    top: cameraFrameRect.y,
                    left: cameraFrameRect.x + cameraFrameRect.width - 30,
                    width: 30,
                    height: 30,
                    borderBottomLeftRadius: 30,
                  },
                ]}
              />
              <View
                style={[
                  styles.cameraMask,
                  {
                    top: cameraFrameRect.y + cameraFrameRect.height - 30,
                    left: cameraFrameRect.x,
                    width: 30,
                    height: 30,
                    borderTopRightRadius: 30,
                  },
                ]}
              />
              <View
                style={[
                  styles.cameraMask,
                  {
                    top: cameraFrameRect.y + cameraFrameRect.height - 30,
                    left: cameraFrameRect.x + cameraFrameRect.width - 30,
                    width: 30,
                    height: 30,
                    borderTopLeftRadius: 30,
                  },
                ]}
              />
            </View>
          ) : null}

          <View style={styles.cameraOverlay}>
            <View
              style={[
                styles.cameraTopBar,
                {
                  paddingTop: cameraTopPadding,
                  paddingHorizontal: cameraHorizontalPadding,
                },
              ]}
            >
              <TouchableOpacity
                style={styles.cameraGhostBtn}
                onPress={handleCloseCamera}
                disabled={capturingPhoto}
                activeOpacity={0.8}
              >
                <Text style={styles.cameraGhostBtnText}>Close</Text>
              </TouchableOpacity>

              <CameraFlashControls
                cameraFlash={cameraFlash}
                colors={{
                  warning: colors.warning,
                  warningLight: colors.warningLight,
                }}
                disabled={capturingPhoto}
                onChange={setCameraFlash}
                showLabel={false}
              />
            </View>

            <View
              style={[
                styles.cameraFrameStage,
                {
                  marginTop: cameraSectionGap,
                  paddingHorizontal: cameraHorizontalPadding,
                  minHeight: cameraFrameStageMinHeight,
                },
              ]}
              onLayout={(event) => {
                const { x, y, width, height } = event.nativeEvent.layout;
                const nextLayout = { x, y, width, height };
                setCameraFrameStageLayout((current) => (layoutsEqual(current, nextLayout) ? current : nextLayout));
              }}
            >
              <View
                pointerEvents="none"
                style={[
                  styles.cameraFrame,
                  {
                    width: cameraFrameWidth,
                    height: cameraFrameHeight,
                    borderColor: colors.primary,
                  },
                ]}
              />
            </View>

            <View
              style={[
                styles.cameraFooter,
                {
                  paddingHorizontal: cameraHorizontalPadding,
                  paddingBottom: cameraBottomPadding,
                },
              ]}
            >
              <CameraHelperCard zoomLabel={zoomLabel} />
              <View style={styles.captureButtonWrap}>
                <TouchableOpacity
                  style={[
                    styles.captureButtonOuter,
                    { borderColor: capturingPhoto ? 'rgba(151,184,126,0.45)' : colors.primary },
                  ]}
                  onPress={handleTakePhoto}
                  activeOpacity={0.9}
                  disabled={capturingPhoto}
                  testID="camera-capture-button"
                >
                  <View
                    style={[
                      styles.captureButtonInner,
                      { backgroundColor: capturingPhoto ? 'rgba(151,184,126,0.2)' : 'rgba(151,184,126,0.22)' },
                    ]}
                  >
                    {capturingPhoto ? (
                      <ActivityIndicator color={colors.primary} size="small" />
                    ) : (
                      <Camera color={colors.primary} size={22} />
                    )}
                  </View>
                </TouchableOpacity>
                <Text style={styles.captureButtonLabel}>Capture receipt</Text>
              </View>
            </View>
          </View>
        </View>
      </>
    );
  }

  if (processing) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Owezy' }} />
        <View style={[styles.processingContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.processingCard, { backgroundColor: colors.card }]}>
          <View style={styles.receiptScanGraphic}>
            <View style={[styles.scanReceiptPaper, { backgroundColor: colors.surface }]}>
              <View style={[styles.scanLineBar, { backgroundColor: colors.surfaceDark }]} />
              <View style={[styles.scanLineBar, { width: '65%', backgroundColor: colors.surfaceDark }]} />
              <View style={[styles.scanDivider, { backgroundColor: colors.border }]} />
              <View style={[styles.scanLineBar, { backgroundColor: colors.surfaceDark }]} />
              <View style={[styles.scanLineBar, { width: '45%', backgroundColor: colors.surfaceDark }]} />
              <View style={[styles.scanLineBar, { backgroundColor: colors.surfaceDark }]} />
              <View style={[styles.scanDivider, { backgroundColor: colors.border }]} />
              <View style={[styles.scanLineBar, { width: '55%', backgroundColor: colors.surfaceDark }]} />
            </View>
            <Animated.View
              style={[
                styles.scanBeam,
                { backgroundColor: colors.primary, transform: [{ translateY: scanLineY }] },
              ]}
            />
          </View>
          <Text style={[styles.processingTitle, { color: colors.text }]}>Scanning Receipt</Text>
          <Text style={[styles.processingSubtitle, { color: colors.textSecondary }]}>
            Extracting items and prices...
          </Text>
          <View style={styles.processingDots}>
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
          <TouchableOpacity
            style={[styles.processingCancelBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
            onPress={cancelProcessing}
            activeOpacity={0.8}
            testID="cancel-scan-button"
          >
            <Text style={[styles.processingCancelText, { color: colors.textSecondary }]}>Cancel Scan</Text>
          </TouchableOpacity>
          </View>
        </View>
      </>
    );
  }

  const scanBtnPaddingV = isSmallPhone ? 24 : isTablet ? 40 : 32;
  const cameraIconSize = isSmallPhone ? 28 : isTablet ? 40 : 34;
  const cameraWrapSize = isSmallPhone ? 56 : isTablet ? 80 : 68;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Owezy' }} />
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.scrollContent}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.bgPattern}>
        <Animated.View style={[styles.bgReceipt, styles.bgReceipt1, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', borderColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', transform: [{ translateY: floatY }, { rotate: '-12deg' }] }]}>
          <View style={[styles.bgReceiptLine, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }]} />
          <View style={[styles.bgReceiptLine, { width: '60%', backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }]} />
          <View style={[styles.bgReceiptLineThin, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }]} />
          <View style={[styles.bgReceiptLine, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }]} />
        </Animated.View>
        <Animated.View style={[styles.bgReceipt, styles.bgReceipt2, { backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', borderColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', transform: [{ translateY: Animated.multiply(floatY, -1) }, { rotate: '8deg' }] }]}>
          <View style={[styles.bgReceiptLine, { backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }]} />
          <View style={[styles.bgReceiptLine, { width: '55%', backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }]} />
        </Animated.View>
        <Animated.View style={[styles.bgReceipt, styles.bgReceipt3, { backgroundColor: isDark ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.015)', borderColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)', transform: [{ translateY: floatY }, { rotate: '18deg' }] }]}>
          <View style={[styles.bgReceiptLine, { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }]} />
          <View style={[styles.bgReceiptLine, { width: '50%', backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)' }]} />
        </Animated.View>
      </View>

      <View style={[styles.content, isTablet && styles.contentTablet]}>
        <View style={[styles.topSection, isSmallPhone && styles.topSectionSmall]}>
          <Text style={[styles.greeting, { color: colors.text }, isTablet && styles.greetingTablet]}>Hey, {firstName}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Ready to split a bill?</Text>
        </View>

        {SHOW_E2E_TEST_RECEIPTS && (
          <TouchableOpacity
            style={[styles.e2eSmokeCard, { backgroundColor: colors.card, borderColor: colors.primary }]}
            activeOpacity={0.85}
            onPress={() => handleTestReceipt('basic')}
            testID="e2e-basic-receipt-button"
          >
            <View style={[styles.e2eSmokeBadge, { backgroundColor: colors.primaryLight }]}>
              <Sparkles color={colors.primary} size={16} />
            </View>
            <View style={styles.e2eSmokeTextWrap}>
              <Text style={[styles.e2eSmokeTitle, { color: colors.text }]}>Run CI Smoke Receipt</Text>
              <Text style={[styles.e2eSmokeSubtitle, { color: colors.textSecondary }]}>
                Loads a fixed receipt fixture for the end-to-end smoke test
              </Text>
            </View>
            <ChevronRight color={colors.textMuted} size={16} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.proBanner, { backgroundColor: colors.warningLight, borderColor: colors.warning + '40' }]}
          activeOpacity={0.85}
          onPress={() => router.push('/(tabs)/profile/pro' as any)}
        >
          <View style={[styles.proIconWrap, { backgroundColor: colors.warning }]}>
            <Crown color={colors.white} size={14} />
          </View>
          <View style={styles.proBannerTextWrap}>
            <Text style={[styles.proBannerTitle, { color: colors.text }]}>
              {scanBannerTitle}
            </Text>
            <Text style={[styles.proBannerSub, { color: colors.textSecondary }]}>
              {scanBannerSubtitle}
            </Text>
          </View>
          <ChevronRight color={colors.textMuted} size={16} />
        </TouchableOpacity>

        <Animated.View style={[styles.scanButtonWrap, { transform: [{ scale: btnScale }] }]}>
          <TouchableOpacity
            style={[styles.scanButton, { shadowColor: colors.primary }]}
            onPress={handleCamera}
            activeOpacity={0.85}
            testID="camera-button"
          >
            <View style={[styles.scanButtonBg, { backgroundColor: colors.primary }]}>
              <View style={[styles.scanButtonContent, { paddingVertical: scanBtnPaddingV }]}>
                <Animated.View style={[styles.cameraIconWrap, { width: cameraWrapSize, height: cameraWrapSize, borderRadius: cameraWrapSize * 0.3, transform: [{ scale: pulseAnim }] }]}>
                  <Camera color="#FFFFFF" size={cameraIconSize} />
                </Animated.View>
                <View style={styles.scanTextWrap}>
                  <Text style={[styles.scanButtonTitle, isTablet && { fontSize: 26 }]}>Scan Receipt</Text>
                  <Text style={styles.scanButtonDesc}>Point camera at your receipt</Text>
                </View>
                <ArrowRight color="rgba(255,255,255,0.6)" size={24} />
              </View>
            </View>
          </TouchableOpacity>
        </Animated.View>

        <View style={styles.secondaryActions}>
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleGallery}
            activeOpacity={0.7}
            testID="gallery-button"
          >
            <View style={[styles.actionIconWrap, { backgroundColor: colors.secondaryLight }]}>
              <ImageIcon color={colors.secondary} size={20} />
            </View>
            <View style={styles.actionTextWrap}>
              <Text style={[styles.actionTitle, { color: colors.text }]}>Upload Photo</Text>
              <Text style={[styles.actionDesc, { color: colors.textMuted }]}>From gallery</Text>
            </View>
            <ChevronRight color={colors.textMuted} size={16} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={handleManualEntry}
            activeOpacity={0.7}
            testID="manual-button"
          >
            <View style={[styles.actionIconWrap, { backgroundColor: colors.accentLight }]}>
              <PenLine color={colors.accent} size={20} />
            </View>
            <View style={styles.actionTextWrap}>
              <Text style={[styles.actionTitle, { color: colors.text }]}>Manual Entry</Text>
              <Text style={[styles.actionDesc, { color: colors.textMuted }]}>Type items in</Text>
            </View>
            <ChevronRight color={colors.textMuted} size={16} />
          </TouchableOpacity>
        </View>

        <View style={[styles.tipCard, { backgroundColor: colors.primaryLight }]}>
          <Sparkles color={colors.primary} size={16} />
          <Text style={[styles.tipText, { color: colors.textSecondary }]}>
            Tip: Keep the receipt flat, bright, and fully in frame. You can always edit anything before you split.
          </Text>
        </View>

        <View
          style={[
            styles.howItWorks,
            styles.howItWorksCompact,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.howTitle, { color: colors.text }]}>How it works</Text>
          <View style={styles.stepsRow}>
            <View style={styles.step}>
              <View style={[styles.stepDot, styles.stepDotCompact, { backgroundColor: colors.primary }]}>
                <Text style={styles.stepNum}>1</Text>
              </View>
              <Text style={[styles.stepLabel, { color: colors.textSecondary }]}>Scan</Text>
            </View>
            <View style={[styles.stepLine, styles.stepLineCompact, { backgroundColor: colors.border }]} />
            <View style={styles.step}>
              <View style={[styles.stepDot, styles.stepDotCompact, { backgroundColor: colors.secondary }]}>
                <Text style={styles.stepNum}>2</Text>
              </View>
              <Text style={[styles.stepLabel, { color: colors.textSecondary }]}>Assign</Text>
            </View>
            <View style={[styles.stepLine, styles.stepLineCompact, { backgroundColor: colors.border }]} />
            <View style={styles.step}>
              <View style={[styles.stepDot, styles.stepDotCompact, { backgroundColor: '#D9B253' }]}>
                <Text style={styles.stepNum}>3</Text>
              </View>
              <Text style={[styles.stepLabel, { color: colors.textSecondary }]}>Split</Text>
            </View>
            <View style={[styles.stepLine, styles.stepLineCompact, { backgroundColor: colors.border }]} />
            <View style={styles.step}>
              <View style={[styles.stepDot, styles.stepDotCompact, { backgroundColor: '#5BA4CF' }]}>
                <Text style={styles.stepNum}>4</Text>
              </View>
              <Text style={[styles.stepLabel, { color: colors.textSecondary }]}>Pay</Text>
            </View>
          </View>
        </View>

        {SHOW_E2E_TEST_RECEIPTS && (
          <View style={[styles.devPanel, { borderColor: colors.border }]}>
            <Text style={[styles.devLabel, { color: colors.textMuted }]}>DEV — Test Receipt</Text>
            <View style={styles.devRow}>
              <TouchableOpacity
                style={[styles.devBtn, { backgroundColor: colors.surface }]}
                onPress={() => handleTestReceipt('basic')}
                testID="dev-receipt-basic"
              >
                <Text style={[styles.devBtnText, { color: colors.text }]}>Basic</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.devBtn, { backgroundColor: colors.surface }]}
                onPress={() => handleTestReceipt('handwritten')}
                testID="dev-receipt-handwritten"
              >
                <Text style={[styles.devBtnText, { color: colors.text }]}>Handwritten</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.devBtn, { backgroundColor: colors.surface }]}
                onPress={() => handleTestReceipt('autograt')}
                testID="dev-receipt-autograt"
              >
                <Text style={[styles.devBtnText, { color: colors.text }]}>Auto-grat</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  cameraScreen: {
    flex: 1,
  },
  cameraView: {
    flex: 1,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  cameraTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    zIndex: 2,
  },
  cameraGhostBtn: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  cameraGhostBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600' as const,
  },
  cameraGuideOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  cameraFrameStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraMask: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  cameraFrame: {
    borderRadius: 30,
    borderWidth: 2,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  cameraFooter: {
    alignItems: 'center',
    gap: 10,
    zIndex: 2,
  },
  cameraHelperCard: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.46)',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cameraHelperTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700' as const,
    textAlign: 'center',
  },
  cameraHelperSubtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '500' as const,
    textAlign: 'center',
    lineHeight: 15,
    marginTop: 4,
  },
  cameraZoomBadge: {
    marginTop: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  cameraZoomBadgeText: {
    color: 'rgba(255,255,255,0.86)',
    fontSize: 11,
    fontWeight: '700' as const,
  },
  cameraControlsLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  cameraFlashGroup: {
    alignItems: 'flex-end',
    gap: 8,
  },
  cameraFlashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  flashChip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  flashChipText: {
    fontSize: 12,
    fontWeight: '700' as const,
  },
  captureButtonWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  captureButtonOuter: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  captureButtonInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonLabel: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 13,
    fontWeight: '700' as const,
    textAlign: 'center',
  },
  scrollContent: {
    flexGrow: 1,
  },
  bgPattern: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  bgReceipt: {
    position: 'absolute',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
  },
  bgReceipt1: {
    top: 40,
    right: -30,
    width: 120,
    height: 160,
  },
  bgReceipt2: {
    top: 180,
    left: -40,
    width: 110,
    height: 140,
  },
  bgReceipt3: {
    bottom: 80,
    right: -20,
    width: 100,
    height: 130,
  },
  bgReceiptLine: {
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
    width: '80%',
  },
  bgReceiptLineThin: {
    height: 1,
    marginVertical: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  contentTablet: {
    paddingHorizontal: 40,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  topSection: {
    paddingTop: 20,
    paddingBottom: 8,
  },
  topSectionSmall: {
    paddingTop: 12,
    paddingBottom: 4,
  },
  greeting: {
    fontSize: 30,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
  },
  greetingTablet: {
    fontSize: 36,
  },
  subtitle: {
    fontSize: 16,
    marginTop: 4,
  },
  e2eSmokeCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  e2eSmokeBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  e2eSmokeTextWrap: {
    flex: 1,
  },
  e2eSmokeTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  e2eSmokeSubtitle: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  proBanner: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  proIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proBannerTextWrap: {
    flex: 1,
  },
  proBannerTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
  },
  proBannerSub: {
    fontSize: 12,
    marginTop: 1,
  },
  scanButtonWrap: {
    marginTop: 24,
  },
  scanButton: {
    borderRadius: 28,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 8,
  },
  scanButtonBg: {
    borderRadius: 28,
    overflow: 'hidden',
  },
  scanButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 18,
  },
  cameraIconWrap: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanTextWrap: {
    flex: 1,
  },
  scanButtonTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  scanButtonDesc: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  secondaryActions: {
    gap: 10,
    marginTop: 16,
  },
  actionCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionTextWrap: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
  actionDesc: {
    fontSize: 13,
    marginTop: 2,
  },
  howItWorks: {
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
  },
  howItWorksCompact: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginTop: 16,
    marginBottom: 20,
  },
  howTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    marginBottom: 10,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  stepsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  step: {
    alignItems: 'center',
    gap: 6,
  },
  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotCompact: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  stepNum: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  stepLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
  },
  stepLine: {
    width: 24,
    height: 2,
    marginHorizontal: 4,
    marginBottom: 20,
  },
  stepLineCompact: {
    width: 16,
    marginHorizontal: 2,
    marginBottom: 18,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 16,
    marginBottom: 0,
  },
  tipText: {
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  devPanel: {
    borderWidth: 1,
    borderStyle: 'dashed' as const,
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    marginBottom: 20,
    gap: 8,
  },
  devLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  devRow: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  devBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center' as const,
  },
  devBtnText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  processingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
  },
  processingCard: {
    borderRadius: 28,
    paddingHorizontal: 28,
    paddingVertical: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  receiptScanGraphic: {
    width: SCAN_RECEIPT_WIDTH,
    height: SCAN_RECEIPT_HEIGHT,
    marginBottom: 28,
    overflow: 'hidden',
    position: 'relative',
  },
  scanReceiptPaper: {
    width: SCAN_RECEIPT_WIDTH,
    height: SCAN_RECEIPT_HEIGHT,
    borderRadius: 14,
    padding: 18,
    justifyContent: 'center',
  },
  scanLineBar: {
    height: 6,
    borderRadius: 3,
    marginBottom: 10,
    width: '80%',
  },
  scanDivider: {
    height: 1,
    marginVertical: 6,
  },
  scanBeam: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SCAN_BEAM_HEIGHT,
    borderRadius: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  processingTitle: {
    fontSize: 22,
    fontWeight: '700' as const,
    marginBottom: 6,
  },
  processingSubtitle: {
    fontSize: 15,
  },
  processingDots: {
    marginTop: 20,
  },
  processingCancelBtn: {
    marginTop: 18,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  processingCancelText: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
});
