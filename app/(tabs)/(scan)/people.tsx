import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { Stack, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Plus, X, ChevronRight, ChevronLeft, UserPlus, Users, Search, ExternalLink, Phone } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSplitFlow } from '@/contexts/SplitFlowContext';
import { useFriends } from '@/contexts/FriendsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Friend } from '@/types';
import { generateId } from '@/utils/splitting';
import { formatUsPhoneInput } from '@/utils/phone';

export default function PeopleScreen() {
  const { people, setPeople } = useSplitFlow();
  const { sortedFriends } = useFriends();
  const { user } = useAuth();
  const { colors } = useTheme();
  const [showFriendsModal, setShowFriendsModal] = useState<boolean>(false);
  const [showManualModal, setShowManualModal] = useState<boolean>(false);
  const [friendSearch, setFriendSearch] = useState<string>('');
  const [manualName, setManualName] = useState<string>('');
  const [manualVenmo, setManualVenmo] = useState<string>('');
  const [manualCashApp, setManualCashApp] = useState<string>('');
  const [manualZelle, setManualZelle] = useState<string>('');
  const [manualPaypal, setManualPaypal] = useState<string>('');
  const [manualPhone, setManualPhone] = useState<string>('');

  const meId = useMemo(() => {
    const existing = people.find((p) => p.id.startsWith('me_'));
    if (existing) return existing.id;
    return 'me_' + (user?.id || 'guest');
  }, [people, user?.id]);

  const ensureMe = useCallback(() => {
    if (!people.find((p) => p.id === meId)) {
      const me: Friend = {
        id: meId,
        name: 'Me',
        usageCount: 0,
        color: colors.primary,
      };
      const withoutLegacyMe = people.filter((p) => !p.id.startsWith('me_'));
      setPeople([me, ...withoutLegacyMe]);
    }
  }, [people, meId, setPeople, colors.primary]);

  React.useEffect(() => {
    ensureMe();
  }, [ensureMe]);

  const addFromFriends = useCallback((friend: Friend) => {
    if (people.find((p) => p.id === friend.id)) {
      Alert.alert('Already added', `${friend.name} is already in this split.`);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPeople([...people, friend]);
  }, [people, setPeople]);

  const removePerson = useCallback((id: string) => {
    if (id === meId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPeople(people.filter((p) => p.id !== id));
  }, [people, meId, setPeople]);

  const handleContinue = useCallback(() => {
    if (people.length < 2) {
      Alert.alert('Need more people', 'Add at least one friend from your friends list.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(tabs)/(scan)/assign' as any);
  }, [people]);

  const availableFriends = useMemo(
    () => sortedFriends.filter((f) => !people.find((p) => p.id === f.id)),
    [sortedFriends, people],
  );

  const filteredFriends = useMemo(() => {
    if (!friendSearch.trim()) return availableFriends;
    const q = friendSearch.toLowerCase();
    return availableFriends.filter((f) => f.name.toLowerCase().includes(q));
  }, [availableFriends, friendSearch]);

  const allFriendsInSplit = useMemo(
    () => sortedFriends.filter((f) => people.find((p) => p.id === f.id)),
    [sortedFriends, people],
  );

  const handleOpenFriendsModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFriendSearch('');
    setShowFriendsModal(true);
  }, []);

  const handleOpenManualModal = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setManualName('');
    setManualVenmo('');
    setManualCashApp('');
    setManualZelle('');
    setManualPaypal('');
    setManualPhone('');
    setShowManualModal(true);
  }, []);

  const handleAddManualPerson = useCallback(() => {
    const trimmedName = manualName.trim();
    if (!trimmedName) {
      Alert.alert('Missing name', 'Please enter a name for this person.');
      return;
    }
    if (people.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())) {
      Alert.alert('Already added', `${trimmedName} is already in this split.`);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const manualFriend: Friend = {
      id: `manual_${generateId()}`,
      name: trimmedName,
      venmoUsername: manualVenmo.trim().replace(/^@+/, '') || undefined,
      cashAppUsername: manualCashApp.trim().replace(/^\$+/, '') || undefined,
      zelleUsername: manualZelle.trim() || undefined,
      paypalUsername: manualPaypal.trim() || undefined,
      phone: manualPhone.trim() || undefined,
      usageCount: 0,
      color: colors.accent,
    };
    setPeople([...people, manualFriend]);
    setShowManualModal(false);
  }, [manualName, manualVenmo, manualCashApp, manualZelle, manualPaypal, manualPhone, people, setPeople, colors.accent]);

  const handleGoToFriends = useCallback(() => {
    setShowFriendsModal(false);
    router.push('/(tabs)/friends' as any);
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginLeft: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <ChevronLeft color={colors.text} size={22} strokeWidth={2.4} />
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '600' }}>Back</Text>
              </View>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Users color={colors.textSecondary} size={18} />
          <Text style={[styles.headerTitle, { color: colors.textSecondary }]}>{people.length} people in this split</Text>
        </View>

        <View style={styles.peopleGrid}>
          {people.map((person) => (
            <View key={person.id} style={[styles.personChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.avatar, { backgroundColor: person.color }]}>
                <Text style={styles.avatarText}>
                  {person.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.personName, { color: colors.text }]} numberOfLines={1}>{person.name}</Text>
              {person.id !== meId && (
                <TouchableOpacity onPress={() => removePerson(person.id)} style={styles.removeBtn}>
                  <X color={colors.textMuted} size={12} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.addFriendBtn, { backgroundColor: colors.primaryLight, borderColor: colors.primary + '30' }]}
          onPress={handleOpenFriendsModal}
          testID="add-friend-button"
        >
          <UserPlus color={colors.primary} size={18} />
          <Text style={[styles.addFriendBtnText, { color: colors.primary }]}>Add from Friends List</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickAddBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={handleOpenManualModal}
          testID="quick-add-bill-button"
        >
          <Plus color={colors.textSecondary} size={15} />
          <Text style={[styles.quickAddBtnText, { color: colors.textSecondary }]}>Quick Add to Bill</Text>
        </TouchableOpacity>

        {availableFriends.length > 0 && (
          <View style={styles.friendsSection}>
            <Text style={[styles.friendsLabel, { color: colors.textMuted }]}>Quick Add</Text>
            <FlatList
              data={availableFriends.slice(0, 6)}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.friendsList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.friendCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => addFromFriends(item)}
                >
                  <View style={[styles.friendAvatar, { backgroundColor: item.color }]}>
                    <Text style={styles.friendAvatarText}>
                      {item.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={[styles.friendName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                  <UserPlus color={colors.primary} size={12} />
                </TouchableOpacity>
              )}
            />
          </View>
        )}
      </ScrollView>

      <View style={[styles.continueWrapper, { backgroundColor: colors.background }]}>
        <TouchableOpacity style={[styles.continueBtn, { backgroundColor: colors.primary }]} onPress={handleContinue} testID="continue-people">
          <Text style={[styles.continueBtnText, { color: colors.white }]}>Assign Items</Text>
          <ChevronRight color={colors.white} size={22} />
        </TouchableOpacity>
      </View>

      <Modal
        visible={showFriendsModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFriendsModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Friends List</Text>
            <TouchableOpacity onPress={() => setShowFriendsModal(false)} style={styles.modalCloseBtn}>
              <X color={colors.text} size={22} />
            </TouchableOpacity>
          </View>

          <View style={styles.modalSearchRow}>
            <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Search color={colors.textMuted} size={16} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Search friends..."
                placeholderTextColor={colors.textMuted}
                value={friendSearch}
                onChangeText={setFriendSearch}
              />
            </View>
          </View>

          <ScrollView style={styles.modalContent} contentContainerStyle={styles.modalContentInner}>
            {filteredFriends.length > 0 ? (
              filteredFriends.map((friend) => (
                <TouchableOpacity
                  key={friend.id}
                  style={[styles.modalFriendRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => {
                    addFromFriends(friend);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <View style={[styles.modalFriendAvatar, { backgroundColor: friend.color }]}>
                    <Text style={styles.modalFriendAvatarText}>{friend.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.modalFriendInfo}>
                    <Text style={[styles.modalFriendName, { color: colors.text }]}>{friend.name}</Text>
                    {friend.venmoUsername ? (
                      <Text style={[styles.modalFriendSub, { color: colors.textMuted }]}>@{friend.venmoUsername}</Text>
                    ) : friend.phone ? (
                      <Text style={[styles.modalFriendSub, { color: colors.textMuted }]}>{friend.phone}</Text>
                    ) : null}
                  </View>
                  <View style={[styles.modalAddBtn, { backgroundColor: colors.primaryLight }]}>
                    <Plus color={colors.primary} size={16} />
                  </View>
                </TouchableOpacity>
              ))
            ) : (
              <View style={styles.emptyFriends}>
                <Users color={colors.textMuted} size={40} />
                <Text style={[styles.emptyFriendsTitle, { color: colors.textSecondary }]}>
                  {sortedFriends.length === 0 ? 'No friends yet' : 'All friends added'}
                </Text>
                <Text style={[styles.emptyFriendsSub, { color: colors.textMuted }]}>
                  {sortedFriends.length === 0
                    ? 'Add friends from the Friends tab to quickly add them to splits'
                    : 'All your friends are already in this split'}
                </Text>
              </View>
            )}

            {allFriendsInSplit.length > 0 && (
              <View style={styles.alreadyAddedSection}>
                <Text style={[styles.alreadyAddedLabel, { color: colors.textMuted }]}>Already in split</Text>
                {allFriendsInSplit.map((f) => (
                  <View key={f.id} style={[styles.alreadyAddedRow, { backgroundColor: colors.surface }]}>
                    <View style={[styles.modalFriendAvatar, { backgroundColor: f.color, opacity: 0.6 }]}>
                      <Text style={styles.modalFriendAvatarText}>{f.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={[styles.alreadyAddedName, { color: colors.textMuted }]}>{f.name}</Text>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          <View style={[styles.modalFooter, { borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[styles.goToFriendsBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={handleGoToFriends}
            >
              <ExternalLink color={colors.primary} size={16} />
              <Text style={[styles.goToFriendsBtnText, { color: colors.primary }]}>Manage Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalDoneBtn, { backgroundColor: colors.primary }]}
              onPress={() => setShowFriendsModal(false)}
            >
              <Text style={[styles.modalDoneBtnText, { color: colors.white }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showManualModal} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={24}
            style={styles.centeredModalWrap}
          >
            <View style={[styles.quickAddModalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.quickAddHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Quick Add to Bill</Text>
                <TouchableOpacity onPress={() => setShowManualModal(false)} style={[styles.modalCloseBtn, { backgroundColor: colors.surface }]}>
                  <X color={colors.text} size={20} />
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.quickAddScroll}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.quickAddField}>
                  <Text style={[styles.quickAddLabel, { color: colors.textSecondary }]}>Name</Text>
                  <TextInput
                    style={[styles.quickAddInput, { backgroundColor: colors.surface, color: colors.text }]}
                    placeholder="Friend name"
                    placeholderTextColor={colors.textMuted}
                    value={manualName}
                    onChangeText={setManualName}
                  />
                </View>

                <View style={styles.quickAddField}>
                  <Text style={[styles.quickAddLabel, { color: colors.textSecondary }]}>Payment Usernames (optional)</Text>
                  <View style={[styles.quickAddInputRow, { backgroundColor: colors.surface }]}>
                    <View style={[styles.quickAddInputIconWrap, { backgroundColor: colors.venmo + '20' }]}>
                      <Ionicons name="logo-venmo" color={colors.venmo} size={15} />
                    </View>
                    <TextInput
                      style={[styles.quickAddInputInline, { color: colors.text }]}
                      placeholder="Venmo username"
                      placeholderTextColor={colors.textMuted}
                      value={manualVenmo}
                      onChangeText={setManualVenmo}
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={[styles.quickAddInputRow, { backgroundColor: colors.surface }]}>
                    <View style={[styles.quickAddInputIconWrap, { backgroundColor: colors.cashApp + '20' }]}>
                      <Ionicons name="logo-usd" color={colors.cashApp} size={15} />
                    </View>
                    <TextInput
                      style={[styles.quickAddInputInline, { color: colors.text }]}
                      placeholder="Cash App cashtag"
                      placeholderTextColor={colors.textMuted}
                      value={manualCashApp}
                      onChangeText={setManualCashApp}
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={[styles.quickAddInputRow, { backgroundColor: colors.surface }]}>
                    <View style={[styles.quickAddInputIconWrap, { backgroundColor: colors.zelle + '20' }]}>
                      <Text style={[styles.zelleIconText, { color: colors.zelle }]}>Z</Text>
                    </View>
                    <TextInput
                      style={[styles.quickAddInputInline, { color: colors.text }]}
                      placeholder="Zelle email or phone"
                      placeholderTextColor={colors.textMuted}
                      value={manualZelle}
                      onChangeText={setManualZelle}
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={[styles.quickAddInputRow, { backgroundColor: colors.surface }]}>
                    <View style={[styles.quickAddInputIconWrap, { backgroundColor: colors.paypal + '20' }]}>
                      <Ionicons name="logo-paypal" color={colors.paypal} size={15} />
                    </View>
                    <TextInput
                      style={[styles.quickAddInputInline, { color: colors.text }]}
                      placeholder="PayPal username"
                      placeholderTextColor={colors.textMuted}
                      value={manualPaypal}
                      onChangeText={setManualPaypal}
                      autoCapitalize="none"
                    />
                  </View>
                </View>

                <View style={styles.quickAddField}>
                  <Text style={[styles.quickAddLabel, { color: colors.textSecondary }]}>Phone (optional)</Text>
                  <View style={[styles.quickAddInputRow, { backgroundColor: colors.surface }]}>
                    <View style={[styles.quickAddInputIconWrap, { backgroundColor: colors.secondaryLight }]}>
                      <Phone color={colors.secondary} size={14} />
                    </View>
                    <TextInput
                      style={[styles.quickAddInputInline, { color: colors.text }]}
                      placeholder="(555) 123-4567"
                      placeholderTextColor={colors.textMuted}
                      value={manualPhone}
                      onChangeText={(value) => setManualPhone(formatUsPhoneInput(value))}
                      keyboardType="phone-pad"
                    />
                  </View>
                </View>

                <TouchableOpacity style={[styles.quickAddSaveBtn, { backgroundColor: colors.primary }]} onPress={handleAddManualPerson}>
                  <Text style={[styles.quickAddSaveBtnText, { color: colors.white }]}>Add to This Split</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 12,
  },
  continueWrapper: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  peopleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  personChip: {
    borderRadius: 30,
    paddingVertical: 6,
    paddingLeft: 7,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  personName: {
    fontSize: 13,
    fontWeight: '600' as const,
    maxWidth: 90,
  },
  removeBtn: {
    padding: 2,
  },
  addFriendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 12,
    minHeight: 58,
  },
  addFriendBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  quickAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 18,
    minHeight: 58,
  },
  quickAddBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  friendsSection: {
    marginBottom: 24,
  },
  friendsLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    marginBottom: 12,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  friendsList: {
    gap: 8,
  },
  friendCard: {
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    width: 112,
  },
  friendAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendAvatarText: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  friendName: {
    fontSize: 14,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
  },
  continueBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 58,
  },
  continueBtnText: {
    fontSize: 18,
    fontWeight: '700' as const,
  },
  modalContainer: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  centeredModalWrap: {
    width: '100%',
    alignItems: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSearchRow: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
  },
  modalContent: {
    flex: 1,
  },
  modalContentInner: {
    padding: 20,
    gap: 8,
  },
  modalFriendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  modalFriendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalFriendAvatarText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  modalFriendInfo: {
    flex: 1,
  },
  modalFriendName: {
    fontSize: 16,
    fontWeight: '600' as const,
  },
  modalFriendSub: {
    fontSize: 12,
    marginTop: 2,
  },
  modalAddBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyFriends: {
    alignItems: 'center',
    paddingVertical: 68,
    gap: 8,
  },
  emptyFriendsTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    marginTop: 4,
  },
  emptyFriendsSub: {
    fontSize: 14,
    textAlign: 'center' as const,
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  alreadyAddedSection: {
    marginTop: 16,
    gap: 6,
  },
  alreadyAddedLabel: {
    fontSize: 12,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  alreadyAddedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
  },
  alreadyAddedName: {
    fontSize: 14,
    fontWeight: '500' as const,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
  },
  goToFriendsBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 48,
  },
  goToFriendsBtnText: {
    fontSize: 15,
    fontWeight: '600' as const,
  },
  modalDoneBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    minHeight: 48,
  },
  modalDoneBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  quickAddModalContent: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 22,
    width: '100%',
    maxWidth: 500,
    maxHeight: '86%',
  },
  quickAddHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  quickAddField: {
    marginBottom: 10,
  },
  quickAddScroll: {
    maxHeight: 520,
  },
  quickAddLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    marginBottom: 6,
  },
  quickAddInput: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  quickAddInputRow: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  quickAddInputIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zelleIconText: {
    fontSize: 14,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  quickAddInputInline: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 3,
  },
  quickAddSaveBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginTop: 4,
  },
  quickAddSaveBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
});
