import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { User, LogOut, ChevronRight, Receipt, DollarSign, Users, Calendar, Pencil, Moon, Sun, Shield, Trash2, Crown, BadgeCheck } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useHistory } from '@/contexts/HistoryContext';
import { useFriends } from '@/contexts/FriendsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { formatCurrency } from '@/utils/currency';

export default function ProfileScreen() {
  const { user, logOut, deleteAccount } = useAuth();
  const { splits } = useHistory();
  const { friends } = useFriends();
  const { isPro, displayRemainingScans } = useSubscription();
  const { colors, isDark, toggleTheme } = useTheme();
  const [deletingAccount, setDeletingAccount] = useState<boolean>(false);
  const appVersion = Constants.expoConfig?.version || '1.0.0';

  const totalAmountFromHistory = splits.reduce((sum, s) => sum + s.total, 0);
  const totalReceipts = user?.totalReceiptsScanned || splits.length;
  const totalAmount = user?.totalAmountSplit || totalAmountFromHistory;
  const totalFriends = friends.length;
  const memberSince = user?.createdAt ? new Date(user.createdAt) : new Date();

  const avgPerSplit = splits.length > 0 ? totalAmountFromHistory / splits.length : 0;

  const handleEditProfile = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(tabs)/profile/edit' as any);
  }, []);

  const handleLogOut = useCallback(() => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await logOut();
        },
      },
    ]);
  }, [logOut]);

  const handleToggleTheme = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleTheme();
  }, [toggleTheme]);

  const handleOpenPrivacyPolicy = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/privacy-policy' as any);
  }, []);

  const handleOpenTermsOfUse = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/terms-of-use' as any);
  }, []);

  const handleOpenPro = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(tabs)/profile/pro' as any);
  }, []);

  const handleDeleteAccount = useCallback(() => {
    if (deletingAccount) return;
    Alert.alert(
      'Delete Account?',
      'This permanently deletes your account, split history, friends list, and profile data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            setDeletingAccount(true);
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await deleteAccount();
            } catch (e: any) {
              Alert.alert('Delete Failed', e?.message || 'Could not delete account');
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ],
    );
  }, [deleteAccount, deletingAccount]);

  const initials = user?.displayName
    ? user.displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const formatMemberDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={styles.scrollContent}>
      <View style={styles.profileHeader}>
        <View style={styles.avatarSection}>
          {user?.profilePicture ? (
            <Image source={{ uri: user.profilePicture }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
          <TouchableOpacity style={[styles.editAvatarBtn, { backgroundColor: colors.text, borderColor: colors.background }]} onPress={handleEditProfile}>
            <Pencil color={colors.white} size={12} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.displayName, { color: colors.text }]}>{user?.displayName || 'User'}</Text>
        <View style={styles.identityRow}>
          <Text style={[styles.username, { color: colors.primary }]}>@{user?.username || 'username'}</Text>
          {user?.emailVerified ? (
            <View style={[styles.verifiedBadge, { backgroundColor: colors.successLight, borderColor: colors.success + '55' }]}>
              <BadgeCheck color={colors.success} size={12} />
              <Text style={[styles.verifiedBadgeText, { color: colors.success }]}>VERIFIED</Text>
            </View>
          ) : null}
          {isPro ? (
            <View style={[styles.proBadge, { backgroundColor: colors.warningLight, borderColor: colors.warning + '55' }]}>
              <Crown color={colors.warning} size={12} />
              <Text style={[styles.proBadgeText, { color: colors.warning }]}>PRO</Text>
            </View>
          ) : null}
        </View>
        {user?.phone ? (
          <Text style={[styles.phone, { color: colors.textSecondary }]}>{user.phone}</Text>
        ) : null}
        <View style={[styles.memberSince, { backgroundColor: colors.surface }]}>
          <Calendar color={colors.textMuted} size={13} />
          <Text style={[styles.memberText, { color: colors.textMuted }]}>Member since {formatMemberDate(memberSince)}</Text>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.statIcon, { backgroundColor: colors.primaryLight }]}>
            <Receipt color={colors.primary} size={18} />
          </View>
          <Text style={[styles.statValue, { color: colors.text }]}>{totalReceipts}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Receipts Scanned</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.statIcon, { backgroundColor: colors.secondaryLight }]}>
            <DollarSign color={colors.secondary} size={18} />
          </View>
          <Text style={[styles.statValue, { color: colors.text }]}>{formatCurrency(totalAmount)}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Total Split</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.statIcon, { backgroundColor: colors.accentLight }]}>
            <Users color={colors.accent} size={18} />
          </View>
          <Text style={[styles.statValue, { color: colors.text }]}>{totalFriends}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Friends</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.statIcon, { backgroundColor: colors.secondaryLight }]}>
            <DollarSign color={colors.secondary} size={18} />
          </View>
          <Text style={[styles.statValue, { color: colors.text }]}>{formatCurrency(avgPerSplit)}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Avg per Split</Text>
        </View>
      </View>

      <View style={styles.menuSection}>
        <TouchableOpacity style={[styles.menuItem, styles.proMenuItem, { backgroundColor: colors.card, borderColor: colors.warning + '50' }]} onPress={handleOpenPro} activeOpacity={0.7}>
          <View style={[styles.menuIcon, { backgroundColor: colors.warningLight }]}>
            <Crown color={colors.warning} size={18} />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={[styles.menuTitle, { color: colors.text }]}>Owezy Pro</Text>
            <Text style={[styles.menuDesc, { color: colors.textMuted }]}>
              {`${displayRemainingScans} scan${displayRemainingScans === 1 ? '' : 's'} remaining this month`}
            </Text>
          </View>
          <ChevronRight color={colors.textMuted} size={18} />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={handleEditProfile} activeOpacity={0.7} testID="profile-edit-button">
          <View style={[styles.menuIcon, { backgroundColor: colors.primaryLight }]}>
            <User color={colors.primary} size={18} />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={[styles.menuTitle, { color: colors.text }]}>Edit Profile</Text>
            <Text style={[styles.menuDesc, { color: colors.textMuted }]}>Name, username, photo</Text>
          </View>
          <ChevronRight color={colors.textMuted} size={18} />
        </TouchableOpacity>

        <View style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.menuIcon, { backgroundColor: isDark ? colors.warningLight : '#FFF8E1' }]}>
            {isDark ? <Moon color="#F59E0B" size={18} /> : <Sun color="#F59E0B" size={18} />}
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={[styles.menuTitle, { color: colors.text }]}>Dark Mode</Text>
            <Text style={[styles.menuDesc, { color: colors.textMuted }]}>{isDark ? 'On' : 'Off'}</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={handleToggleTheme}
            trackColor={{ false: colors.surfaceDark, true: colors.primary }}
            thumbColor={colors.white}
          />
        </View>

        <TouchableOpacity style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={handleOpenPrivacyPolicy} activeOpacity={0.7}>
          <View style={[styles.menuIcon, { backgroundColor: colors.accentLight }]}>
            <Shield color={colors.accent} size={18} />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={[styles.menuTitle, { color: colors.text }]}>Privacy Policy</Text>
            <Text style={[styles.menuDesc, { color: colors.textMuted }]}>How Owezy handles your data</Text>
          </View>
          <ChevronRight color={colors.textMuted} size={18} />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.menuItem, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={handleOpenTermsOfUse} activeOpacity={0.7}>
          <View style={[styles.menuIcon, { backgroundColor: colors.surface }]}>
            <Shield color={colors.textSecondary} size={18} />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={[styles.menuTitle, { color: colors.text }]}>Terms of Use</Text>
            <Text style={[styles.menuDesc, { color: colors.textMuted }]}>Subscription and license terms</Text>
          </View>
          <ChevronRight color={colors.textMuted} size={18} />
        </TouchableOpacity>

        <TouchableOpacity style={[styles.menuItem, styles.menuItemDanger, { backgroundColor: colors.card, borderColor: colors.dangerLight }]} onPress={handleLogOut} activeOpacity={0.7} testID="profile-logout-button">
          <View style={[styles.menuIcon, { backgroundColor: colors.dangerLight }]}>
            <LogOut color={colors.danger} size={18} />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={[styles.menuTitle, { color: colors.danger }]}>Log Out</Text>
            <Text style={[styles.menuDesc, { color: colors.textMuted }]}>Sign out of your account</Text>
          </View>
          <ChevronRight color={colors.textMuted} size={18} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.menuItem,
            styles.menuItemDanger,
            { backgroundColor: colors.card, borderColor: colors.dangerLight },
            deletingAccount && styles.menuItemDisabled,
          ]}
          onPress={handleDeleteAccount}
          activeOpacity={0.7}
          disabled={deletingAccount}
        >
          <View style={[styles.menuIcon, { backgroundColor: colors.dangerLight }]}>
            <Trash2 color={colors.danger} size={18} />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={[styles.menuTitle, { color: colors.danger }]}>
              {deletingAccount ? 'Deleting Account...' : 'Delete Account'}
            </Text>
            <Text style={[styles.menuDesc, { color: colors.textMuted }]}>
              Permanently remove your account and data
            </Text>
          </View>
          {deletingAccount ? <ActivityIndicator color={colors.danger} /> : <ChevronRight color={colors.textMuted} size={18} />}
        </TouchableOpacity>
      </View>

      <Text style={[styles.versionText, { color: colors.textMuted }]}>{`Owezy v${appVersion}`}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  profileHeader: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 24,
  },
  avatarSection: {
    position: 'relative',
    marginBottom: 14,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: '#FFFFFF',
  },
  editAvatarBtn: {
    position: 'absolute',
    bottom: 0,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
  },
  displayName: {
    fontSize: 24,
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  username: {
    fontSize: 15,
    fontWeight: '600' as const,
    marginTop: 2,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  proBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  proBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.4,
  },
  verifiedBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verifiedBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.4,
  },
  phone: {
    fontSize: 14,
    marginTop: 4,
  },
  memberSince: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 10,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  memberText: {
    fontSize: 12,
    fontWeight: '500' as const,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 20,
  },
  statCard: {
    width: '48%',
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800' as const,
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500' as const,
  },
  menuSection: {
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 20,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 14,
  },
  proMenuItem: {
    borderWidth: 1.2,
  },
  menuItemDanger: {},
  menuItemDisabled: {
    opacity: 0.6,
  },
  menuIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTextWrap: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
  menuDesc: {
    fontSize: 13,
    marginTop: 1,
  },
  versionText: {
    textAlign: 'center' as const,
    fontSize: 12,
    marginTop: 8,
  },
});
