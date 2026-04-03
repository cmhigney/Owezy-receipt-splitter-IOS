import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActionSheetIOS,
} from 'react-native';
import { router, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { AtSign, Phone, User, Camera, Clock, BadgeCheck } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { usePreferredPayment, PREFERRED_OPTIONS } from '@/utils/preferredPayment';
import { USERNAME_MAX_LENGTH, validateUsername } from '@/utils/moderation';
import { formatUsPhoneInput } from '@/utils/phone';

const DISPLAY_NAME_MAX_LENGTH = 15;
const PROFILE_PICTURE_MAX_LENGTH = 800_000;

function inferImageMimeType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.heic')) return 'image/heic';
  return 'image/jpeg';
}

async function toPersistedProfilePicture(uri: string): Promise<string> {
  if (!uri) return '';
  if (uri.startsWith('data:image/')) return uri;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  const { File: ExpoFile } = await import('expo-file-system');
  const file = new ExpoFile(uri);
  const base64 = await file.base64();
  const mimeType = inferImageMimeType(uri);
  return `data:${mimeType};base64,${base64}`;
}

function assertProfilePictureWithinLimit(profilePicture: string): string {
  if (!profilePicture || profilePicture.length <= PROFILE_PICTURE_MAX_LENGTH) {
    return profilePicture;
  }
  throw new Error('PROFILE_PICTURE_TOO_LARGE');
}

export default function EditProfileScreen() {
  const { user, updateProfile, getUsernameChangeCooldown } = useAuth();
  const { colors } = useTheme();
  const { preferred, setPreferredPayment } = usePreferredPayment();
  const [displayName, setDisplayName] = useState<string>(user?.displayName || '');
  const [username, setUsername] = useState<string>(user?.username || '');
  const [phone, setPhone] = useState<string>(user?.phone || '');
  const [venmoUsername, setVenmoUsername] = useState<string>(user?.venmoUsername || '');
  const [cashAppUsername, setCashAppUsername] = useState<string>(user?.cashAppUsername || '');
  const [zelleUsername, setZelleUsername] = useState<string>(user?.zelleUsername || '');
  const [paypalUsername, setPaypalUsername] = useState<string>(user?.paypalUsername || '');
  const [profilePicture, setProfilePicture] = useState<string>(user?.profilePicture || '');
  const [saving, setSaving] = useState<boolean>(false);
  const [usernameError, setUsernameError] = useState<string>('');
  const [usernameCooldown, setUsernameCooldown] = useState(() => getUsernameChangeCooldown());

  useEffect(() => {
    const updateCooldown = () => setUsernameCooldown(getUsernameChangeCooldown());
    updateCooldown();
    const intervalId = setInterval(updateCooldown, 60_000);
    return () => clearInterval(intervalId);
  }, [getUsernameChangeCooldown]);
  const usernameChanged = username !== (user?.username || '');
  const usernameBlocked = usernameChanged && !usernameCooldown.canChange;

  const hasChanges = displayName !== (user?.displayName || '') ||
    username !== (user?.username || '') ||
    phone !== (user?.phone || '') ||
    venmoUsername !== (user?.venmoUsername || '') ||
    cashAppUsername !== (user?.cashAppUsername || '') ||
    zelleUsername !== (user?.zelleUsername || '') ||
    paypalUsername !== (user?.paypalUsername || '') ||
    profilePicture !== (user?.profilePicture || '');
  const saveDisabled = !hasChanges || saving;

  const handleValidateUsername = useCallback((value: string) => {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(cleaned);
    if (cleaned.length > 0) {
      const result = validateUsername(cleaned);
      if (!result.valid && result.error) {
        setUsernameError(result.error);
      } else {
        setUsernameError('');
      }
    } else {
      setUsernameError('');
    }
  }, []);

  const pickFromCamera = useCallback(async () => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Camera permission is required.');
          return;
        }
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });
      if (!result.canceled && result.assets?.length > 0) {
        const persisted = assertProfilePictureWithinLimit(await toPersistedProfilePicture(result.assets[0].uri));
        setProfilePicture(persisted);
      }
    } catch (e) {
      if ((e as { message?: string } | null)?.message === 'PROFILE_PICTURE_TOO_LARGE') {
        Alert.alert('Photo Too Large', 'Choose a smaller photo or crop tighter before saving.');
        return;
      }
      console.error('Camera error:', e);
    }
  }, []);

  const pickFromGallery = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });
      if (!result.canceled && result.assets?.length > 0) {
        const persisted = assertProfilePictureWithinLimit(await toPersistedProfilePicture(result.assets[0].uri));
        setProfilePicture(persisted);
      }
    } catch (e) {
      if ((e as { message?: string } | null)?.message === 'PROFILE_PICTURE_TOO_LARGE') {
        Alert.alert('Photo Too Large', 'Choose a smaller photo or crop tighter before saving.');
        return;
      }
      console.error('Gallery error:', e);
    }
  }, []);

  const handlePickProfilePicture = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo', 'Choose from Gallery', ...(profilePicture ? ['Remove Photo'] : [])],
          cancelButtonIndex: 0,
          destructiveButtonIndex: profilePicture ? 3 : undefined,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) pickFromCamera();
          else if (buttonIndex === 2) pickFromGallery();
          else if (buttonIndex === 3) setProfilePicture('');
        },
      );
    } else {
      Alert.alert('Profile Photo', 'Choose an option', [
        { text: 'Take Photo', onPress: pickFromCamera },
        { text: 'Choose from Gallery', onPress: pickFromGallery },
        ...(profilePicture ? [{ text: 'Remove Photo', onPress: () => setProfilePicture(''), style: 'destructive' as const }] : []),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, [profilePicture, pickFromCamera, pickFromGallery]);

  const handleSave = useCallback(async () => {
    if (!hasChanges) return;
    if (username.length > 0) {
      const result = validateUsername(username);
      if (!result.valid) {
        Alert.alert('Invalid Username', result.error || 'Username is not valid');
        return;
      }
    }
    if (usernameBlocked) {
      Alert.alert('Username Change Locked', `You can change your username again in ${usernameCooldown.daysRemaining} days.`);
      return;
    }
    if (!displayName.trim()) {
      Alert.alert('Invalid Name', 'Display name cannot be empty');
      return;
    }

    setSaving(true);
    try {
      await updateProfile({
        displayName: displayName.trim(),
        username: username || user?.username || '',
        phone: phone.trim() || undefined,
        venmoUsername: venmoUsername.trim().replace(/^@+/, '') || undefined,
        cashAppUsername: cashAppUsername.trim().replace(/^\$+/, '') || undefined,
        zelleUsername: zelleUsername.trim() || undefined,
        paypalUsername: paypalUsername.trim() || undefined,
        profilePicture: profilePicture || undefined,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e: any) {
      Alert.alert('Update Failed', e.message || 'Could not update profile');
    } finally {
      setSaving(false);
    }
  }, [hasChanges, displayName, username, phone, venmoUsername, cashAppUsername, zelleUsername, paypalUsername, profilePicture, updateProfile, user?.username, usernameBlocked, usernameCooldown.daysRemaining]);

  const initials = user?.displayName
    ? user.displayName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Edit Profile',
          headerRight: () => (
            <TouchableOpacity
              style={[
                styles.headerSaveButton,
                { backgroundColor: colors.primary },
                saveDisabled && styles.headerSaveButtonDisabled,
              ]}
              onPress={handleSave}
              disabled={saveDisabled}
              activeOpacity={0.8}
              testID="save-profile-top"
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.headerSaveText}>Save</Text>
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={[styles.container, { backgroundColor: colors.background }]}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
        <View style={styles.photoSection}>
          <TouchableOpacity onPress={handlePickProfilePicture} activeOpacity={0.7}>
            {profilePicture ? (
              <Image source={{ uri: profilePicture }} style={styles.profileImage} />
            ) : (
              <View style={[styles.profilePlaceholder, { backgroundColor: colors.primary }]}>
                <Text style={styles.profilePlaceholderText}>{initials}</Text>
              </View>
            )}
            <View style={[styles.cameraOverlay, { backgroundColor: colors.text }]}>
              <Camera color={colors.white} size={16} />
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Personal Info</Text>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Display Name</Text>
            <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <User color={colors.textMuted} size={18} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                placeholderTextColor={colors.textMuted}
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                testID="edit-name"
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Username</Text>
            {!usernameCooldown.canChange ? (
              <View style={styles.cooldownInlineRow}>
                <Clock color={colors.accent} size={13} />
                <Text style={[styles.cooldownInlineText, { color: colors.accent }]}>
                  Next change available in {usernameCooldown.daysRemaining} day{usernameCooldown.daysRemaining === 1 ? '' : 's'}
                </Text>
              </View>
            ) : null}
            <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: usernameError || usernameBlocked ? colors.danger : colors.border }]}>
              <AtSign color={usernameError || usernameBlocked ? colors.danger : colors.textMuted} size={18} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={username}
                onChangeText={handleValidateUsername}
                placeholder="username"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                maxLength={USERNAME_MAX_LENGTH}
                editable={usernameCooldown.canChange}
                testID="edit-username"
              />
            </View>
            {usernameError ? (
              <Text style={[styles.errorText, { color: colors.danger }]}>{usernameError}</Text>
            ) : (
              <Text style={[styles.hintText, { color: colors.textMuted }]}>Letters, numbers, and underscores only</Text>
            )}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Phone Number</Text>
            <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Phone color={colors.textMuted} size={18} />
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={phone}
                onChangeText={(value) => setPhone(formatUsPhoneInput(value))}
                placeholder="(optional)"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                testID="edit-phone"
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Payment Accounts</Text>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Venmo</Text>
            <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.paymentIcon, { color: colors.venmo }]}>V</Text>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={venmoUsername}
                onChangeText={setVenmoUsername}
                placeholder="Venmo username (optional)"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                testID="edit-venmo"
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Cash App</Text>
            <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.paymentIcon, { color: colors.cashApp }]}>$</Text>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={cashAppUsername}
                onChangeText={setCashAppUsername}
                placeholder="Cash App $cashtag (optional)"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                testID="edit-cashapp"
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Zelle</Text>
            <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.paymentIcon, { color: colors.zelle }]}>Z</Text>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={zelleUsername}
                onChangeText={setZelleUsername}
                placeholder="Email or phone (optional)"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                testID="edit-zelle"
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>PayPal</Text>
            <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.paymentIcon, { color: colors.paypal }]}>P</Text>
              <TextInput
                style={[styles.input, { color: colors.text }]}
                value={paypalUsername}
                onChangeText={setPaypalUsername}
                placeholder="PayPal.me username (optional)"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                testID="edit-paypal"
              />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Preferred Payment Method</Text>
          <Text style={[styles.hintText, { color: colors.textMuted, marginBottom: 12, marginLeft: 0 }]}>
            Highlighted on your payment screen for quick access. Tap to toggle.
          </Text>
          <View style={styles.preferredGrid}>
            {PREFERRED_OPTIONS.map((option) => {
              const isSelected = preferred === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.preferredPill,
                    { backgroundColor: isSelected ? option.color + '18' : colors.surface },
                    isSelected && { borderColor: option.color, borderWidth: 1.5 },
                  ]}
                  onPress={() => setPreferredPayment(isSelected ? null : option.value)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.preferredPillIcon, { color: option.color }]}>{option.icon}</Text>
                  <Text style={[styles.preferredPillLabel, { color: isSelected ? option.color : colors.textSecondary }]}>
                    {option.label}
                  </Text>
                  {isSelected && <Text style={[styles.preferredCheck, { color: option.color }]}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>Account</Text>
          <View style={[styles.infoRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Email</Text>
            <Text style={[styles.infoValue, { color: colors.text }]}>{user?.email}</Text>
          </View>
          <View style={[styles.infoRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Verification</Text>
            <View style={styles.verifyStatus}>
              <BadgeCheck color={user?.emailVerified ? colors.success : colors.textMuted} size={14} />
              <Text style={[styles.infoValue, { color: user?.emailVerified ? colors.success : colors.textMuted }]}>
                {user?.emailVerified ? 'Verified' : 'Not verified'}
              </Text>
            </View>
          </View>
          <View style={[styles.infoRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>User ID</Text>
            <Text style={[styles.infoValueMuted, { color: colors.textMuted }]}>{user?.id?.slice(0, 12)}...</Text>
          </View>
        </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  photoSection: {
    alignItems: 'center',
    marginBottom: 16,
  },
  profileImage: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  profilePlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profilePlaceholderText: {
    fontSize: 32,
    fontWeight: '800' as const,
    color: '#FFFFFF',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 12,
    marginLeft: 4,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    marginBottom: 8,
    marginLeft: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    gap: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
  },
  hintText: {
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  errorText: {
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  cooldownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
    marginLeft: 4,
  },
  cooldownText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  cooldownInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 8,
    marginLeft: 4,
  },
  cooldownInlineText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 15,
    fontWeight: '500' as const,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  infoValueMuted: {
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  verifyStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  paymentIcon: {
    fontSize: 17,
    fontWeight: '800' as const,
    width: 20,
    textAlign: 'center' as const,
  },
  headerSaveButton: {
    borderRadius: 999,
    minWidth: 82,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  headerSaveButtonDisabled: {
    opacity: 0.4,
  },
  headerSaveText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  preferredGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
  },
  preferredPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
    width: '47%' as any,
  },
  preferredPillIcon: {
    fontSize: 15,
    fontWeight: '800' as const,
  },
  preferredPillLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
    flex: 1,
  },
  preferredCheck: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
});
