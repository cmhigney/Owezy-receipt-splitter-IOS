import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

type OwezyLogoMarkProps = {
  size?: number;
  splitProgress?: number;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
  showTile?: boolean;
  cornerRadius?: number;
};

const PRIMARY_GREEN = '#97B87E';
const FOREGROUND = '#FFFFFF';

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function ReceiptLeft({ offsetX, fill, lineColor }: { offsetX: number; fill: string; lineColor: string }) {
  return (
    <>
      <Path
        d="M31 27L33.1 24.9L35.6 27L38.1 24.7L40.8 27L43.5 24.8L46.1 27L48.3 24.9L49.4 27L50 36.5L47.5 44L49.8 52L47.2 60L48.7 69.5L46.2 77L43.6 74.9L40.8 77L38.1 74.7L35.4 77L33 74.8L31 77L31 27Z"
        fill={fill}
        transform={`translate(${offsetX} 0)`}
      />
      <Path d="M36 35H44.5" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" transform={`translate(${offsetX} 0)`} />
      <Path d="M35.7 42H45.2" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" transform={`translate(${offsetX} 0)`} />
      <Path d="M36.2 49H44.2" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" transform={`translate(${offsetX} 0)`} />
      <Path d="M35.8 58H44.8" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" transform={`translate(${offsetX} 0)`} />
      <Path d="M35.3 67H43.9" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" transform={`translate(${offsetX} 0)`} />
    </>
  );
}

function ReceiptRight({ offsetX, fill, lineColor }: { offsetX: number; fill: string; lineColor: string }) {
  return (
    <>
      <Path
        d="M50 27L51.4 24.9L53.7 27L56.4 24.8L59.2 27L61.9 24.7L64.5 27L66.9 24.9L69 27L69 77L67 74.8L64.5 77L61.8 74.8L59.1 77L56.4 74.7L53.7 77L51.3 74.9L49 69.5L50.8 60L48.2 52L50.5 44L48 36.5L50 27Z"
        fill={fill}
        transform={`translate(${offsetX} 0)`}
      />
      <Path d="M55.5 35H64" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" transform={`translate(${offsetX} 0)`} />
      <Path d="M54.8 42H64.2" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" transform={`translate(${offsetX} 0)`} />
      <Path d="M55.7 49H63.7" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" transform={`translate(${offsetX} 0)`} />
      <Path d="M54.9 58H63.9" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" transform={`translate(${offsetX} 0)`} />
      <Path d="M56 67H64.6" stroke={lineColor} strokeWidth="1.6" strokeLinecap="round" transform={`translate(${offsetX} 0)`} />
    </>
  );
}

function FriendLeft({ offsetX, scale, fill }: { offsetX: number; scale: number; fill: string }) {
  return (
    <>
      <Circle cx={24 + offsetX} cy="45.5" r={5.8 * scale} fill={fill} />
      <Path
        d={`
          M ${16.2 + offsetX} 58.5
          C ${16.2 + offsetX} 53.2 ${20 + offsetX} 49.7 ${24.2 + offsetX} 49.7
          C ${28.5 + offsetX} 49.7 ${32.2 + offsetX} 53.1 ${32.2 + offsetX} 58.4
          L ${32.2 + offsetX} 60.8
          C ${32.2 + offsetX} 61.8 ${31.4 + offsetX} 62.6 ${30.4 + offsetX} 62.6
          L ${18 + offsetX} 62.6
          C ${17 + offsetX} 62.6 ${16.2 + offsetX} 61.8 ${16.2 + offsetX} 60.8
          Z
        `}
        fill={fill}
      />
    </>
  );
}

function FriendRight({ offsetX, scale, fill }: { offsetX: number; scale: number; fill: string }) {
  return (
    <>
      <Circle cx={76 + offsetX} cy="45.5" r={5.8 * scale} fill={fill} />
      <Path
        d={`
          M ${67.8 + offsetX} 58.5
          C ${67.8 + offsetX} 53.1 ${71.5 + offsetX} 49.7 ${75.8 + offsetX} 49.7
          C ${80 + offsetX} 49.7 ${83.8 + offsetX} 53.2 ${83.8 + offsetX} 58.5
          L ${83.8 + offsetX} 60.8
          C ${83.8 + offsetX} 61.8 ${83 + offsetX} 62.6 ${82 + offsetX} 62.6
          L ${69.6 + offsetX} 62.6
          C ${68.6 + offsetX} 62.6 ${67.8 + offsetX} 61.8 ${67.8 + offsetX} 60.8
          Z
        `}
        fill={fill}
      />
    </>
  );
}

export default function OwezyLogoMark({
  size = 88,
  splitProgress = 1,
  style,
  elevated = false,
  showTile = true,
  cornerRadius = 22,
}: OwezyLogoMarkProps) {
  const progress = clamp01(splitProgress);
  const receiptOffset = 4.3 * progress;
  const friendOffset = 0.8 * progress;
  const friendScale = 0.95 + (progress * 0.05);
  const tileRadius = (cornerRadius / 100) * size;
  const joinOpacity = 1 - progress;

  const iconFill = showTile ? FOREGROUND : PRIMARY_GREEN;
  const lineStroke = showTile ? PRIMARY_GREEN : 'rgba(255,255,255,0.45)';
  const bracketStroke = showTile ? FOREGROUND : PRIMARY_GREEN;

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: tileRadius,
          backgroundColor: showTile ? PRIMARY_GREEN : 'transparent',
        },
        elevated && styles.elevated,
        style,
      ]}
    >
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        {showTile ? <Rect x="0" y="0" width="100" height="100" fill={PRIMARY_GREEN} /> : null}

        <Path d="M18 28V18C18 16.9 18.9 16 20 16H31" fill="none" stroke={bracketStroke} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M82 28V18C82 16.9 81.1 16 80 16H69" fill="none" stroke={bracketStroke} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M18 72V82C18 83.1 18.9 84 20 84H31" fill="none" stroke={bracketStroke} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M82 72V82C82 83.1 81.1 84 80 84H69" fill="none" stroke={bracketStroke} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />

        <FriendLeft offsetX={-friendOffset} scale={friendScale} fill={iconFill} />
        <FriendRight offsetX={friendOffset} scale={friendScale} fill={iconFill} />
        <ReceiptLeft offsetX={-receiptOffset} fill={iconFill} lineColor={lineStroke} />
        <ReceiptRight offsetX={receiptOffset} fill={iconFill} lineColor={lineStroke} />
        <Path
          d="M48.4 27H51.5L52.1 36.5L50.2 44L51.6 52L49.5 60L51 69.5L49.9 77H46.9L47.7 69.5L46.2 60L48.4 52L46.6 44L48.4 36.5Z"
          fill={iconFill}
          opacity={joinOpacity}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  elevated: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 8,
  },
});
