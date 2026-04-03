/**
 * A/B variant hook.
 *
 * Set EXPO_PUBLIC_AB_VARIANT=A or =B in your .env, then rebuild.
 * The bot in .maestro/bot_split_flow.yaml runs the full flow and screenshots
 * each key screen — run it once per variant to compare.
 *
 * Usage:
 *   const variant = useVariant();
 *   if (variant === 'B') { ... }
 */
export function useVariant(): 'A' | 'B' {
  const raw = process.env.EXPO_PUBLIC_AB_VARIANT;
  return raw === 'B' ? 'B' : 'A';
}
