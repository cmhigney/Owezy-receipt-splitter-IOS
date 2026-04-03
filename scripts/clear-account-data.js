// Clears split history and stats for a user while keeping friends intact.
// Run with:
//   USER_ID=<firebase-user-id> node scripts/clear-account-data.js
// or
//   EMAIL=<user@example.com> node scripts/clear-account-data.js

const { admin, ensureAdminApp } = require("./firebase-admin-init");

ensureAdminApp();

const db = admin.firestore();
const USER_ID = (process.env.USER_ID || "").trim();
const EMAIL = (process.env.EMAIL || "").trim().toLowerCase();

async function resolveUserId() {
  if (USER_ID) {
    return USER_ID;
  }

  if (!EMAIL) {
    console.error("Missing USER_ID or EMAIL.");
    process.exit(1);
  }

  const emailDoc = await db.collection("userEmailIndex").doc(EMAIL).get();
  if (!emailDoc.exists) {
    console.error("User not found in userEmailIndex for", EMAIL);
    process.exit(1);
  }

  const userId = emailDoc.get("userId");
  if (typeof userId !== "string" || !userId.trim()) {
    console.error("userEmailIndex entry did not contain a valid userId for", EMAIL);
    process.exit(1);
  }

  return userId;
}

async function main() {
  const userId = await resolveUserId();

  await db.collection("splits_by_user").doc(userId).set({ splits: [] });
  console.log("Split history cleared");

  await db.collection("users").doc(userId).update({
    totalReceiptsScanned: 0,
    totalAmountSplit: 0,
    totalFriendsSplitWith: 0,
  });
  console.log("Stats reset to 0");

  console.log(`Done. Friends are untouched for user ${userId}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
