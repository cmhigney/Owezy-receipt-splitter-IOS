const fs = require("node:fs");

const admin = require("../functions/node_modules/firebase-admin");

function parseServiceAccountJson(raw, sourceLabel) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid service account JSON in ${sourceLabel}: ${error.message}`);
  }
}

function loadServiceAccount() {
  const jsonEnv =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (jsonEnv) {
    return parseServiceAccountJson(jsonEnv, "FIREBASE_SERVICE_ACCOUNT_JSON");
  }

  const pathEnv =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!pathEnv) {
    return null;
  }

  if (!fs.existsSync(pathEnv)) {
    throw new Error(`Service account file not found: ${pathEnv}`);
  }

  return parseServiceAccountJson(fs.readFileSync(pathEnv, "utf8"), pathEnv);
}

function ensureAdminApp() {
  if (admin.apps.length) {
    return admin.app();
  }

  const serviceAccount = loadServiceAccount();
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      ...(typeof serviceAccount.project_id === "string"
        ? { projectId: serviceAccount.project_id }
        : {}),
    });
    return admin.app();
  }

  admin.initializeApp();
  return admin.app();
}

module.exports = {
  admin,
  ensureAdminApp,
};
