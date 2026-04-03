import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';

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

export default function PrivacyPolicyScreen() {
  const { colors } = useTheme();

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Privacy Policy',
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
          <Text style={[styles.title, { color: colors.text }]}>Owezy Privacy Policy</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Last updated: March 2026
          </Text>
        </View>

        <Section title="Information We Collect">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            Owezy stores information you provide to make bill splitting work, including account email,
            display name, username, optional phone number, optional payment usernames, profile photo,
            receipt data you scan, split history, and your friends list.
          </Text>
        </Section>

        <Section title="How We Use Information">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            We use this information to create your account, process receipt scans, calculate split amounts,
            save your history, manage your friend list, and open payment links for settlements. For free-tier
            users, we use Google AdMob to show non-personalized ads. We also use RevenueCat to manage
            subscriptions and restore purchases.
          </Text>
        </Section>

        <Section title="Receipt Scanning and OCR">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            On iOS, Owezy first attempts on-device receipt text recognition using Apple Vision. When the app
            needs additional parsing help or the on-device result is not sufficient, receipt text or the receipt
            image may be sent securely to Owezy&apos;s backend and Google Cloud OCR services to complete the scan.
            Receipt images are used only for scan processing and are not stored as long-term account content.
          </Text>
        </Section>

        <Section title="Third-Party Services">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            <Text style={{ fontWeight: '600' as const }}>Firebase (Google)</Text>
            {' - '} Authentication, cloud database, and backend services. Data processed per Google&apos;s privacy policy.{'\n\n'}
            <Text style={{ fontWeight: '600' as const }}>Google AdMob</Text>
            {' - '} Non-personalized ad serving for free-tier users. Subject to Google&apos;s privacy policy.{'\n\n'}
            <Text style={{ fontWeight: '600' as const }}>RevenueCat</Text>
            {' - '} Subscription and in-app purchase management. Subject to RevenueCat&apos;s privacy policy.{'\n\n'}
            <Text style={{ fontWeight: '600' as const }}>Apple Vision</Text>
            {' - '} On-device OCR used on iOS before backend fallback when available.{'\n\n'}
            <Text style={{ fontWeight: '600' as const }}>Google Cloud Vision / Document AI</Text>
            {' - '} Backend OCR processing used when receipt parsing requires cloud assistance.
          </Text>
        </Section>

        <Section title="Advertising">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            Owezy shows non-personalized ads to free-tier users using Google AdMob. The app does not require
            App Tracking Transparency permission to use the current ad flow.
          </Text>
        </Section>

        <Section title="Storage and Processing">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            Account and app data are stored in Firebase services used by Owezy. Some temporary app data,
            including cached profile, friends, history, and scan state, may be stored locally on your device
            to improve performance and offline resilience.
          </Text>
        </Section>

        <Section title="Data Sharing">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            Owezy does not sell your personal information. Data is shared only as needed to run core app
            features, such as syncing your account, processing receipt scans, managing subscriptions,
            showing ads, or helping you connect with friends by username and payment handle.
          </Text>
        </Section>

        <Section title="Your Choices">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            You can update your profile and payment usernames at any time in app settings. You can also
            delete your account from Profile settings, which removes your account and associated app data
            within 30 days.
          </Text>
        </Section>

        <Section title="Children&apos;s Privacy">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            Owezy is not directed at children under 13. We do not knowingly collect personal information
            from children under 13. If you believe a child has provided us data, contact us and we will
            delete it promptly.
          </Text>
        </Section>

        <Section title="Data Retention">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            We keep your data while your account is active. If you delete your account, we remove account
            records from active systems within 30 days, subject to limited retention in security or
            operational backups.
          </Text>
        </Section>

        <Section title="Contact">
          <Text style={[styles.paragraph, { color: colors.textSecondary }]}>
            For privacy questions or data deletion requests, contact us at{' '}
            <Text style={{ fontWeight: '600' as const, color: colors.primary }}>support@owezy.app</Text>.
          </Text>
        </Section>

        <Text style={[styles.footer, { color: colors.textMuted }]}>
          By using Owezy, you agree to this policy.
        </Text>
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
  footer: {
    textAlign: 'center',
    fontSize: 12,
    marginTop: 10,
  },
});
