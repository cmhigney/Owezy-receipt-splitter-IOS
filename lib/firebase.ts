import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, initializeAuth, type Auth, type Persistence } from "firebase/auth";
import { Platform } from "react-native";

import { getOptionalRuntimeValue } from "@/lib/runtimeConfig";

// The Firebase package only exposes React Native persistence through the RN build.
// TypeScript in this repo resolves the web typings, so load the RN helper directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getReactNativePersistence } = require("@firebase/auth/dist/rn/index.js") as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

type FirebaseConfig = {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
};

function requireFirebaseValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required Firebase config: ${name}`);
  }
  return trimmed;
}

function optionalFirebaseValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getFirebaseConfig(): FirebaseConfig {
  const apiKey = getOptionalRuntimeValue("EXPO_PUBLIC_FIREBASE_API_KEY", "firebaseApiKey");
  const authDomain = getOptionalRuntimeValue("EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN", "firebaseAuthDomain");
  const projectId = getOptionalRuntimeValue("EXPO_PUBLIC_FIREBASE_PROJECT_ID", "firebaseProjectId");
  const storageBucket = getOptionalRuntimeValue("EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET", "firebaseStorageBucket");
  const messagingSenderId = getOptionalRuntimeValue(
    "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "firebaseMessagingSenderId",
  );
  const appId = getOptionalRuntimeValue("EXPO_PUBLIC_FIREBASE_APP_ID", "firebaseAppId");

  return {
    apiKey: requireFirebaseValue(apiKey, "EXPO_PUBLIC_FIREBASE_API_KEY"),
    authDomain: optionalFirebaseValue(authDomain),
    projectId: requireFirebaseValue(projectId, "EXPO_PUBLIC_FIREBASE_PROJECT_ID"),
    storageBucket: optionalFirebaseValue(storageBucket),
    messagingSenderId: optionalFirebaseValue(messagingSenderId),
    appId: requireFirebaseValue(appId, "EXPO_PUBLIC_FIREBASE_APP_ID"),
  };
}

export const firebaseApp: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(getFirebaseConfig());

function createFirebaseAuth(): Auth {
  if (Platform.OS === "web") {
    return getAuth(firebaseApp);
  }

  try {
    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(firebaseApp);
  }
}

export const firebaseAuth: Auth = createFirebaseAuth();
