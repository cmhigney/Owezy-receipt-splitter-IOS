// One-off script: reset a user's scan count for a given month.
// Run with:
//   EMAIL=<user@example.com> node scripts/reset-user-scans.js
// Optional:
//   MONTH_KEY=2026-03 node scripts/reset-user-scans.js

const { admin, ensureAdminApp } = require("./firebase-admin-init");

ensureAdminApp();

const db = admin.firestore();
const EMAIL = (process.env.EMAIL || "").trim().toLowerCase();
const MONTH_KEY = (process.env.MONTH_KEY || getCurrentMonthKey()).trim();

function getCurrentMonthKey() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
}

async function main() {
  if (!EMAIL) {
    console.error("Missing EMAIL.");
    process.exit(1);
  }

  const emailDoc = await db.collection("userEmailIndex").doc(EMAIL).get();
  if (!emailDoc.exists) {
    console.error("User not found in userEmailIndex for", EMAIL);
    process.exit(1);
  }

  const { userId } = emailDoc.data();
  if (typeof userId !== "string" || !userId.trim()) {
    console.error("userEmailIndex entry did not contain a valid userId for", EMAIL);
    process.exit(1);
  }

  console.log("Found userId:", userId);

  const usageDocId = `${userId}_${MONTH_KEY}`;
  await db.collection("scan_usage").doc(usageDocId).delete();
  console.log("Deleted scan_usage doc:", usageDocId);

  console.log(`Done. ${EMAIL} now has a reset scan counter for ${MONTH_KEY}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
