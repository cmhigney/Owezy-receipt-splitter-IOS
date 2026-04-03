import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, View, TouchableOpacity, Linking, Pressable } from 'react-native';
import { Stack, router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';

const APPLE_STANDARD_EULA_URL = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

export default function TermsOfUseScreen() {
  const { colors } = useTheme();

  const openAppleEula = useCallback(() => {
    void Linking.openURL(APPLE_STANDARD_EULA_URL);
  }, []);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Terms of Use',
          headerTintColor: colors.text,
          headerStyle: { backgroundColor: colors.headerBg },
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerBackBtn}>
              <View style={styles.headerBackRow}>
                <ChevronLeft color={colors.text} size={22} strokeWidth={2.4} />
                <Text style={[styles.headerBackText, { color: colors.text }]}>Back</Text>
              </View>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
      >
        <View style={styles.hero}>
          <Text style={[styles.title, { color: colors.text }]}>Owezy Terms of Use</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Last updated: March 2026
          </Text>
        </View>

        <Section title="Subscription Terms">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            Owezy Pro is an auto-renewing subscription that increases your monthly scan allowance and removes ads.
            Pricing and billing periods shown in the app are provided by the App Store at purchase time.
          </Text>
        </Section>

        <Section title="Billing and Renewal">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            Payment is charged to your Apple ID account at confirmation of purchase. Subscriptions renew automatically
            unless canceled at least 24 hours before the end of the current billing period. You can manage or cancel
            your subscription at any time in your Apple account settings.
          </Text>
        </Section>

        <Section title="Restores and Access">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            If you previously purchased Owezy Pro, use Restore Purchases in the app to sync your entitlement on a new
            device or after reinstalling. Pro access depends on a valid active subscription associated with your App
            Store account.
          </Text>
        </Section>

        <Section title="License">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            Owezy is licensed to you under the Apple Standard End User License Agreement unless a separate custom
            license is provided.
          </Text>
          <TouchableOpacity
            style={[styles.linkButton, { backgroundColor: colors.primaryLight }]}
            onPress={openAppleEula}
          >
            <Text style={[styles.linkButtonText, { color: colors.primary }]}>Open Apple Standard EULA</Text>
          </TouchableOpacity>
        </Section>

        <Section title="Contact">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            For billing or legal questions, contact support@owezy.app.
          </Text>
        </Section>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  headerBackBtn: {
    marginLeft: 4,
  },
  headerBackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  headerBackText: {
    fontSize: 17,
    fontWeight: '600' as const,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 10,
  },
  hero: {
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  section: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionBody: {
    gap: 6,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 21,
  },
  linkButton: {
    marginTop: 8,
    borderRadius: 10,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  linkButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
