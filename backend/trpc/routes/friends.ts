import { TRPCError } from "@trpc/server";
import { z } from "zod";

import Colors from "../../../constants/colors";
import type { Friend, FriendRequest } from "../../../types";
import { getRandomColor } from "../../../utils/splitting";
import {
  type FriendRequestRecord,
  store,
  type StoredUser,
} from "../../store";
import { createTRPCRouter, protectedProcedure } from "../create-context";
import { friendSchema } from "../schemas";

const friendsListSchema = z.array(friendSchema).max(400);
const requestActionSchema = z.enum(["accept", "decline"]);
const REQUEST_ID_MAX_LENGTH = 257;

function buildFriendRequestId(fromUserId: string, toUserId: string): string {
  return `${fromUserId}:${toUserId}`;
}

function buildFriendFromUser(user: StoredUser, existing?: Friend): Friend {
  return {
    id: user.id,
    name: user.displayName,
    username: user.username,
    venmoUsername: user.venmoUsername,
    cashAppUsername: user.cashAppUsername,
    zelleUsername: user.zelleUsername,
    paypalUsername: user.paypalUsername,
    phone: user.phone,
    profilePicture: user.profilePicture,
    preferredPayment: existing?.preferredPayment,
    usageCount: existing?.usageCount ?? 0,
    color: existing?.color ?? getRandomColor(user.id.length, Colors.avatarColors),
  };
}

function upsertFriend(friends: Friend[], user: StoredUser): Friend[] {
  const existing = friends.find(
    (friend) =>
      friend.id === user.id ||
      friend.username?.toLowerCase() === user.username.toLowerCase(),
  );
  const nextFriend = buildFriendFromUser(user, existing);

  if (!existing) {
    const colorizedFriend = {
      ...nextFriend,
      color: getRandomColor(friends.length, Colors.avatarColors),
    };
    return [...friends, colorizedFriend];
  }

  return friends.map((friend) =>
    friend.id === existing.id ? { ...existing, ...nextFriend } : friend,
  );
}

function toRequestSummary(
  direction: "incoming" | "outgoing",
  request: FriendRequestRecord,
  user: StoredUser,
): FriendRequest {
  return {
    id: request.id,
    direction,
    userId: user.id,
    displayName: user.displayName,
    username: user.username,
    profilePicture: user.profilePicture,
    createdAt: request.createdAt,
  };
}

async function getUserOrThrow(userId: string): Promise<StoredUser> {
  const user = await store.getUserById(userId);
  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }
  return user;
}

export const friendsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    return store.getFriends(ctx.userId);
  }),

  save: protectedProcedure
    .input(z.object({ friends: friendsListSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      return store.saveFriends(ctx.userId, input.friends);
    }),

  requests: protectedProcedure.query(async ({ ctx }) => {
    const [incoming, outgoing] = await Promise.all([
      store.listIncomingFriendRequests(ctx.userId),
      store.listOutgoingFriendRequests(ctx.userId),
    ]);

    const [incomingUsers, outgoingUsers] = await Promise.all([
      Promise.all(incoming.map((request) => store.getUserById(request.fromUserId))),
      Promise.all(outgoing.map((request) => store.getUserById(request.toUserId))),
    ]);

    return {
      incoming: incoming
        .map((request, index) => {
          const user = incomingUsers[index];
          return user ? toRequestSummary("incoming", request, user) : null;
        })
        .filter((request): request is FriendRequest => Boolean(request)),
      outgoing: outgoing
        .map((request, index) => {
          const user = outgoingUsers[index];
          return user ? toRequestSummary("outgoing", request, user) : null;
        })
        .filter((request): request is FriendRequest => Boolean(request)),
    };
  }),

  sendRequest: protectedProcedure
    .input(
      z.object({
        targetUserId: z.string().trim().min(1).max(128),
      }).strict(),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.targetUserId === ctx.userId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot send a friend request to yourself." });
      }

      const [sender, recipient, senderFriends, existingRequest, reverseRequest] = await Promise.all([
        getUserOrThrow(ctx.userId),
        store.getUserById(input.targetUserId),
        store.getFriends(ctx.userId),
        store.getFriendRequestByUsers(ctx.userId, input.targetUserId),
        store.getFriendRequestByUsers(input.targetUserId, ctx.userId),
      ]);

      if (!recipient) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const alreadyFriends = senderFriends.some(
        (friend) =>
          friend.id === recipient.id ||
          friend.username?.toLowerCase() === recipient.username.toLowerCase(),
      );
      if (alreadyFriends) {
        throw new TRPCError({ code: "CONFLICT", message: "You are already friends." });
      }

      if (existingRequest?.status === "accepted" || reverseRequest?.status === "accepted") {
        throw new TRPCError({ code: "CONFLICT", message: "You are already friends." });
      }

      if (reverseRequest?.status === "pending") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This user already sent you a request. Accept it from your requests section.",
        });
      }

      if (existingRequest?.status === "pending") {
        return { success: true, alreadyPending: true };
      }

      const requestRecord: FriendRequestRecord = {
        id: buildFriendRequestId(ctx.userId, input.targetUserId),
        fromUserId: ctx.userId,
        toUserId: input.targetUserId,
        status: "pending",
        createdAt: new Date().toISOString(),
      };

      await store.saveFriendRequest(requestRecord);

      return {
        success: true,
        alreadyPending: false,
        request: toRequestSummary("outgoing", requestRecord, recipient),
        senderName: sender.displayName,
      };
    }),

  respondToRequest: protectedProcedure
    .input(
      z.object({
        requestId: z.string().trim().min(3).max(REQUEST_ID_MAX_LENGTH),
        action: requestActionSchema,
      }).strict(),
    )
    .mutation(async ({ ctx, input }) => {
      const request = await store.getFriendRequestById(input.requestId);
      if (!request || request.toUserId !== ctx.userId || request.status !== "pending") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Friend request not found." });
      }

      const respondedAt = new Date().toISOString();

      if (input.action === "decline") {
        await store.updateFriendRequest(request.id, {
          status: "declined",
          respondedAt,
        });
        return { success: true };
      }

      const [sender, recipient, senderFriends, recipientFriends] = await Promise.all([
        getUserOrThrow(request.fromUserId),
        getUserOrThrow(request.toUserId),
        store.getFriends(request.fromUserId),
        store.getFriends(request.toUserId),
      ]);

      const nextSenderFriends = upsertFriend(senderFriends, recipient);
      const nextRecipientFriends = upsertFriend(recipientFriends, sender);

      try {
        await store.acceptFriendRequest({
          requestId: request.id,
          actingUserId: ctx.userId,
          senderFriend: buildFriendFromUser(
            sender,
            nextRecipientFriends.find((friend) => friend.id === sender.id),
          ),
          recipientFriend: buildFriendFromUser(
            recipient,
            nextSenderFriends.find((friend) => friend.id === recipient.id),
          ),
          respondedAt,
        });
      } catch (error) {
        if ((error as Error)?.message === "FRIEND_REQUEST_NOT_FOUND") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Friend request not found." });
        }
        throw error;
      }

      return {
        success: true,
        friend: buildFriendFromUser(sender, nextRecipientFriends.find((friend) => friend.id === sender.id)),
      };
    }),
});
