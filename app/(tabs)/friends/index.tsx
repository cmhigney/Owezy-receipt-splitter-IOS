import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Alert,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect } from '@react-navigation/native';
import {
  UserPlus,
  Trash2,
  Edit3,
  X,
  Users,
  AtSign,
  DollarSign,
  Phone,
  Search,
  Check,
} from 'lucide-react-native';
import { useFriends } from '@/contexts/FriendsContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Friend, FriendRequest } from '@/types';
import { trpcClient } from '@/lib/trpc';
import { formatUsPhoneInput } from '@/utils/phone';
import InlineAdBanner from '@/components/ads/InlineAdBanner';

type FoundUser = {
  id: string;
  displayName: string;
  username: string;
  profilePicture?: string;
};

type RequestsPayload = {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
};

function UserAvatar({
  profilePicture,
  label,
  size,
  radius,
  backgroundColor,
  textSize,
}: {
  profilePicture?: string;
  label: string;
  size: number;
  radius: number;
  backgroundColor: string;
  textSize: number;
}) {
  if (profilePicture) {
    return (
      <Image
        source={{ uri: profilePicture }}
        style={{ width: size, height: size, borderRadius: radius }}
      />
    );
  }

  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: textSize, fontWeight: '700', color: '#FFFFFF' }}>
        {label.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

export default function FriendsScreen() {
  const { sortedFriends, refreshFriends, updateFriend, deleteFriend } = useFriends();
  const { colors } = useTheme();
  const tabBarHeight = useBottomTabBarHeight();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [editingFriend, setEditingFriend] = useState<Friend | null>(null);
  const [name, setName] = useState<string>('');
  const [venmo, setVenmo] = useState<string>('');
  const [cashApp, setCashApp] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [lookupUsername, setLookupUsername] = useState<string>('');
  const [lookupLoading, setLookupLoading] = useState<boolean>(false);
  const [lookupError, setLookupError] = useState<string>('');
  const [sendRequestLoading, setSendRequestLoading] = useState<boolean>(false);
  const [requestActionId, setRequestActionId] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestsPayload>({ incoming: [], outgoing: [] });
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      const payload = await trpcClient.friends.requests.query();
      setRequests(payload);
    } catch (error) {
      console.error('Failed to load friend requests:', error);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadRequests();
  }, [loadRequests]));

  const openAddModal = useCallback(() => {
    setEditingFriend(null);
    setName('');
    setVenmo('');
    setCashApp('');
    setPhone('');
    setLookupUsername('');
    setLookupError('');
    setFoundUser(null);
    setShowModal(true);
  }, []);

  const openEditModal = useCallback((friend: Friend) => {
    setEditingFriend(friend);
    setName(friend.name);
    setVenmo(friend.venmoUsername || '');
    setCashApp(friend.cashAppUsername || '');
    setPhone(friend.phone || '');
    setLookupUsername('');
    setLookupError('');
    setFoundUser(null);
    setShowModal(true);
  }, []);

  const handleLookupUser = useCallback(async () => {
    const normalized = lookupUsername.trim().toLowerCase();
    if (!normalized) {
      setLookupError('Enter a username to search');
      return;
    }

    setLookupLoading(true);
    setLookupError('');
    setFoundUser(null);

    try {
      const result = await trpcClient.users.findByUsername.query({ username: normalized });
      setFoundUser(result);
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('not found')) {
        setLookupError('No Owezy user found with that username');
      } else {
        setLookupError('Could not find that username right now');
      }
    } finally {
      setLookupLoading(false);
    }
  }, [lookupUsername]);

  const handleSendRequest = useCallback(async () => {
    if (!foundUser) {
      Alert.alert('Find user first', 'Search by username before sending a request.');
      return;
    }

    if (sendRequestLoading) return;

    setSendRequestLoading(true);
    try {
      const response = await trpcClient.friends.sendRequest.mutate({ targetUserId: foundUser.id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await loadRequests();
      setShowModal(false);
      Alert.alert(
        response.alreadyPending ? 'Request Already Sent' : 'Request Sent',
        `${foundUser.displayName} can accept you from their requests section.`,
      );
    } catch (error: any) {
      const message = String(error?.message || '');
      Alert.alert('Request Failed', message || 'Could not send friend request right now.');
    } finally {
      setSendRequestLoading(false);
    }
  }, [foundUser, loadRequests, sendRequestLoading]);

  const handleSave = useCallback(() => {
    if (!editingFriend) {
      void handleSendRequest();
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Missing name', 'Please enter a name for this friend.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateFriend(editingFriend.id, {
      name: trimmedName,
      venmoUsername: venmo.trim() || undefined,
      cashAppUsername: cashApp.trim() || undefined,
      phone: phone.trim() || undefined,
    });
    setShowModal(false);
  }, [cashApp, editingFriend, handleSendRequest, name, phone, updateFriend, venmo]);

  const handleRespondToRequest = useCallback(async (request: FriendRequest, action: 'accept' | 'decline') => {
    if (requestActionId) return;

    setRequestActionId(request.id);
    try {
      const response = await trpcClient.friends.respondToRequest.mutate({
        requestId: request.id,
        action,
      });

      if (action === 'accept' && response.friend) {
        await refreshFriends();
      }

      await loadRequests();
      Haptics.notificationAsync(
        action === 'accept'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
    } catch (error: any) {
      Alert.alert('Request Failed', error?.message || 'Could not update that friend request.');
    } finally {
      setRequestActionId(null);
    }
  }, [loadRequests, refreshFriends, requestActionId]);

  const handleDelete = useCallback((friend: Friend) => {
    Alert.alert('Delete Friend', `Remove ${friend.name} from your friends?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          deleteFriend(friend.id);
        },
      },
    ]);
  }, [deleteFriend]);

  const requestCount = requests.incoming.length + requests.outgoing.length;
  const totalConnections = sortedFriends.length;

  const requestsHeader = useMemo(() => {
    if (!requestCount) return null;

    return (
      <View style={styles.requestsSection}>
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Requests</Text>
          <View style={[styles.sectionBadge, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.sectionBadgeText, { color: colors.primary }]}>{requestCount}</Text>
          </View>
        </View>

        {requests.incoming.map((request) => {
          const busy = requestActionId === request.id;
          return (
            <View
              key={request.id}
              style={[styles.requestsCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.requestRow}>
                <UserAvatar
                  profilePicture={request.profilePicture}
                  label={request.displayName}
                  size={42}
                  radius={12}
                  backgroundColor={colors.primary}
                  textSize={16}
                />
                <View style={styles.requestTextWrap}>
                  <Text style={[styles.requestName, { color: colors.text }]}>{request.displayName}</Text>
                  <Text style={[styles.requestMeta, { color: colors.textMuted }]}>@{request.username}</Text>
                  <Text style={[styles.requestHint, { color: colors.textSecondary }]}>
                    Wants to add you as a friend
                  </Text>
                </View>
              </View>

              <View style={styles.requestActions}>
                <TouchableOpacity
                  style={[styles.requestGhostBtn, { borderColor: colors.border, backgroundColor: colors.cardLight }]}
                  onPress={() => void handleRespondToRequest(request, 'decline')}
                  disabled={busy}
                  testID={`request-decline-${request.username}`}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.textMuted} size="small" />
                  ) : (
                    <Text style={[styles.requestGhostBtnText, { color: colors.textMuted }]}>Decline</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.requestPrimaryBtn, { backgroundColor: colors.primary }]}
                  onPress={() => void handleRespondToRequest(request, 'accept')}
                  disabled={busy}
                  testID={`request-accept-${request.username}`}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <>
                      <Check color={colors.white} size={14} />
                      <Text style={[styles.requestPrimaryBtnText, { color: colors.white }]}>Accept</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {requests.outgoing.map((request) => (
          <View
            key={request.id}
            style={[styles.requestsCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            testID={`request-outgoing-${request.username}`}
          >
            <View style={styles.requestRow}>
              <UserAvatar
                profilePicture={request.profilePicture}
                label={request.displayName}
                size={42}
                radius={12}
                backgroundColor={colors.secondary}
                textSize={16}
              />
              <View style={styles.requestTextWrap}>
                <Text style={[styles.requestName, { color: colors.text }]}>{request.displayName}</Text>
                <Text style={[styles.requestMeta, { color: colors.textMuted }]}>@{request.username}</Text>
                <Text style={[styles.requestHint, { color: colors.textSecondary }]}>
                  Pending their approval
                </Text>
              </View>
              <View style={[styles.pendingBadge, { backgroundColor: colors.warningLight }]}>
                <Text style={[styles.pendingBadgeText, { color: colors.warning }]}>PENDING</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    );
  }, [colors, handleRespondToRequest, requestActionId, requestCount, requests.incoming, requests.outgoing]);

  const getPreferredPaymentInfo = useCallback((friend: Friend): { label: string; handle: string; color: string } | null => {
    const order: { key: 'venmo' | 'cashapp' | 'zelle' | 'paypal'; label: string; handle: string | undefined; color: string }[] = [
      { key: 'venmo',   label: 'Venmo',    handle: friend.venmoUsername,   color: '#008CFF' },
      { key: 'cashapp', label: 'Cash App', handle: friend.cashAppUsername, color: '#00D632' },
      { key: 'zelle',   label: 'Zelle',    handle: friend.zelleUsername,   color: '#6C1CD3' },
      { key: 'paypal',  label: 'PayPal',   handle: friend.paypalUsername,  color: '#003087' },
    ];
    // If a preferred payment is set, show that first if it has a handle
    if (friend.preferredPayment) {
      const preferred = order.find((o) => o.key === friend.preferredPayment);
      if (preferred?.handle) return { label: preferred.label, handle: preferred.handle, color: preferred.color };
    }
    // Otherwise fall back to first available
    const first = order.find((o) => o.handle);
    if (!first) return null;
    return { label: first.label, handle: first.handle!, color: first.color };
  }, []);

  const renderFriend = useCallback(({ item }: { item: Friend }) => {
    const payment = getPreferredPaymentInfo(item);
    return (
      <View style={[styles.friendCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <UserAvatar
          profilePicture={item.profilePicture}
          label={item.name}
          size={44}
          radius={22}
          backgroundColor={item.color}
          textSize={18}
        />
        <View style={styles.friendInfo}>
          <View style={styles.friendNameRow}>
            <Text style={[styles.friendName, { color: colors.text }]}>{item.name}</Text>
            {payment && (
              <View style={[styles.paymentPill, { backgroundColor: payment.color + '18', borderColor: payment.color + '40' }]}>
                <Text style={[styles.paymentPillText, { color: payment.color }]}>{payment.label}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.friendMeta, { color: colors.textMuted }]} numberOfLines={1}>
            {item.username ? '@' + item.username : 'Manual friend'}
            {payment ? `  ·  ${payment.handle}` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={() => openEditModal(item)} style={styles.iconBtn}>
          <Edit3 color={colors.textMuted} size={16} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDelete(item)} style={styles.iconBtn}>
          <Trash2 color={colors.danger} size={16} />
        </TouchableOpacity>
      </View>
    );
  }, [openEditModal, handleDelete, colors, getPreferredPaymentInfo]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={sortedFriends}
        keyExtractor={(item) => item.id}
        renderItem={renderFriend}
        contentContainerStyle={[styles.listContent, { paddingBottom: tabBarHeight + 120 }]}
        ListHeaderComponent={
          <>
            <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.heroTitle, { color: colors.text }]}>Friends</Text>
              <Text style={[styles.heroSubtext, { color: colors.textSecondary }]}>
                Send requests with an Owezy username, then reuse saved payment details every time you split a bill.
              </Text>
              <View style={styles.heroStats}>
                <View style={[styles.heroStat, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.heroStatValue, { color: colors.primary }]}>{totalConnections}</Text>
                  <Text style={[styles.heroStatLabel, { color: colors.textSecondary }]}>Friends</Text>
                </View>
                <View style={[styles.heroStat, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.heroStatValue, { color: colors.text }]}>{requestCount}</Text>
                  <Text style={[styles.heroStatLabel, { color: colors.textSecondary }]}>Requests</Text>
                </View>
              </View>
            </View>
            {requestsHeader}
            <TouchableOpacity
              style={[styles.addCard, { backgroundColor: colors.card, borderColor: colors.primary + '40' }]}
              onPress={openAddModal}
              testID="add-friend-button"
            >
              <View style={[styles.addIcon, { backgroundColor: colors.primaryLight }]}>
                <UserPlus color={colors.primary} size={20} />
              </View>
              <View style={styles.addTextWrap}>
                <Text style={[styles.addText, { color: colors.primary }]}>Send Friend Request</Text>
                <Text style={[styles.addSubtext, { color: colors.textMuted }]}>Use their unique @username from Profile</Text>
              </View>
            </TouchableOpacity>
          </>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Users color={colors.textMuted} size={44} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No friends yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              Ask for their unique @username from Profile, then send a request here.
            </Text>
          </View>
        }
      />

      <View style={[styles.adWrapper, { bottom: tabBarHeight }]}>
        <InlineAdBanner placement="friends" />
      </View>

      <Modal visible={showModal} transparent animationType="fade">
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={24}
            style={styles.centeredModalWrap}
          >
            <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>
                  {editingFriend ? 'Edit Friend' : 'Send Friend Request'}
                </Text>
                <TouchableOpacity onPress={() => setShowModal(false)} style={[styles.closeBtn, { backgroundColor: colors.surface }]}>
                  <X color={colors.textSecondary} size={20} />
                </TouchableOpacity>
              </View>

              <View style={styles.modalBody}>
                {editingFriend ? (
                  <>
                    <View style={styles.modalField}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Name</Text>
                      <TextInput
                        style={[styles.fieldInput, { backgroundColor: colors.surface, color: colors.text }]}
                        placeholder="Friend's name"
                        placeholderTextColor={colors.textMuted}
                        value={name}
                        onChangeText={setName}
                        testID="friend-name-input"
                      />
                    </View>

                    <View style={styles.modalField}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Venmo (optional)</Text>
                      <View style={[styles.fieldInputRow, { backgroundColor: colors.surface }]}>
                        <View style={[styles.fieldInputIconWrap, { backgroundColor: colors.venmo + '20' }]}>
                          <AtSign color={colors.venmo} size={14} />
                        </View>
                        <TextInput
                          style={[styles.fieldInputInline, { color: colors.text }]}
                          placeholder="username"
                          placeholderTextColor={colors.textMuted}
                          value={venmo}
                          onChangeText={setVenmo}
                          autoCapitalize="none"
                        />
                      </View>
                    </View>

                    <View style={styles.modalField}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Cash App (optional)</Text>
                      <View style={[styles.fieldInputRow, { backgroundColor: colors.surface }]}>
                        <View style={[styles.fieldInputIconWrap, { backgroundColor: colors.cashApp + '20' }]}>
                          <DollarSign color={colors.cashApp} size={14} />
                        </View>
                        <TextInput
                          style={[styles.fieldInputInline, { color: colors.text }]}
                          placeholder="cashtag"
                          placeholderTextColor={colors.textMuted}
                          value={cashApp}
                          onChangeText={setCashApp}
                          autoCapitalize="none"
                        />
                      </View>
                    </View>

                    <View style={styles.modalField}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Phone Number (optional)</Text>
                      <View style={[styles.fieldInputRow, { backgroundColor: colors.surface }]}>
                        <View style={[styles.fieldInputIconWrap, { backgroundColor: colors.secondaryLight }]}>
                          <Phone color={colors.secondary} size={14} />
                        </View>
                        <TextInput
                          style={[styles.fieldInputInline, { color: colors.text }]}
                          placeholder="(555) 123-4567"
                          placeholderTextColor={colors.textMuted}
                          value={phone}
                          onChangeText={(value) => setPhone(formatUsPhoneInput(value))}
                          keyboardType="phone-pad"
                        />
                      </View>
                    </View>
                  </>
                ) : (
                  <>
                    <View style={styles.modalField}>
                      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>Username</Text>
                      <View style={[styles.fieldInputRow, { backgroundColor: colors.surface }]}>
                        <View style={[styles.fieldInputIconWrap, { backgroundColor: colors.primaryLight }]}>
                          <Search color={colors.primary} size={14} />
                        </View>
                        <TextInput
                          style={[styles.fieldInputInline, { color: colors.text }]}
                          placeholder="username"
                          placeholderTextColor={colors.textMuted}
                          value={lookupUsername}
                          onChangeText={(value) => {
                            setLookupUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                            setLookupError('');
                            setFoundUser(null);
                          }}
                          autoCapitalize="none"
                          testID="friend-username-input"
                        />
                      </View>
                      <Text style={[styles.fieldHelper, { color: colors.textMuted }]}>
                        Use the unique @username shown on their Profile screen.
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={[styles.lookupBtn, { backgroundColor: colors.primaryLight }]}
                      onPress={handleLookupUser}
                      disabled={lookupLoading}
                    >
                      {lookupLoading ? (
                        <ActivityIndicator color={colors.primary} size="small" />
                      ) : (
                        <Text style={[styles.lookupBtnText, { color: colors.primary }]}>Find User</Text>
                      )}
                    </TouchableOpacity>

                    {lookupError ? (
                      <Text style={[styles.lookupError, { color: colors.danger }]}>{lookupError}</Text>
                    ) : null}

                    {foundUser ? (
                      <View style={[styles.foundCard, { backgroundColor: colors.cardLight, borderColor: colors.border }]}>
                        <View style={styles.foundHeader}>
                          <UserAvatar
                            profilePicture={foundUser.profilePicture}
                            label={foundUser.displayName}
                            size={52}
                            radius={16}
                            backgroundColor={colors.primary}
                            textSize={20}
                          />
                          <View style={styles.foundHeaderText}>
                            <Text style={[styles.foundName, { color: colors.text }]}>{foundUser.displayName}</Text>
                            <Text style={[styles.foundUsername, { color: colors.textMuted }]}>@{foundUser.username}</Text>
                          </View>
                        </View>
                        <Text style={[styles.foundMeta, { color: colors.textSecondary }]}>
                          Payment handles and phone are shared after they accept your request.
                        </Text>
                      </View>
                    ) : null}
                  </>
                )}

                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: colors.primary }]}
                  onPress={handleSave}
                  disabled={sendRequestLoading}
                  testID="save-friend-button"
                >
                  {sendRequestLoading ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <Text style={[styles.saveBtnText, { color: colors.white }]}>
                      {editingFriend ? 'Save Changes' : 'Send Request'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
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
  listContent: {
    padding: 16,
    paddingBottom: 24,
    flexGrow: 1,
  },
  heroCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
  },
  heroSubtext: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  heroStats: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  heroStat: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  heroStatValue: {
    fontSize: 18,
    fontWeight: '800' as const,
  },
  heroStatLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    marginTop: 4,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  requestsSection: {
    marginBottom: 16,
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
  },
  sectionBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  sectionBadgeText: {
    fontSize: 12,
    fontWeight: '800' as const,
  },
  requestsCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  requestTextWrap: {
    flex: 1,
  },
  requestName: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  requestMeta: {
    fontSize: 13,
    marginTop: 1,
  },
  requestHint: {
    fontSize: 13,
    marginTop: 3,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 10,
  },
  requestGhostBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestGhostBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  requestPrimaryBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  requestPrimaryBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
  },
  pendingBadge: {
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  addCard: {
    borderRadius: 16,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    borderWidth: 1.5,
  },
  addIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTextWrap: {
    flex: 1,
  },
  addText: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  addSubtext: {
    fontSize: 12,
    marginTop: 2,
  },
  friendCard: {
    borderRadius: 14,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
    borderWidth: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  friendInfo: {
    flex: 1,
    minWidth: 0,
  },
  friendNameRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    flexWrap: 'nowrap' as const,
  },
  friendName: {
    fontSize: 16,
    fontWeight: '600' as const,
    flexShrink: 1,
  },
  paymentPill: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
  },
  paymentPillText: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  friendMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  adWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center' as const,
    lineHeight: 20,
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
  modalContent: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 20,
    width: '100%',
    maxWidth: 500,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalBody: {
    width: '100%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalField: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    marginBottom: 8,
  },
  fieldHelper: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8,
  },
  fieldInput: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  fieldInputRow: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fieldInputIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldInputInline: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 3,
  },
  lookupBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    marginBottom: 8,
  },
  lookupBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
  },
  lookupError: {
    fontSize: 12,
    marginBottom: 8,
  },
  foundCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
  },
  foundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  foundHeaderText: {
    flex: 1,
  },
  foundName: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  foundUsername: {
    fontSize: 13,
    marginTop: 2,
    marginBottom: 6,
  },
  foundMeta: {
    fontSize: 12,
  },
  saveBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginTop: 8,
  },
  saveBtnText: {
    fontSize: 17,
    fontWeight: '700' as const,
  },
});
