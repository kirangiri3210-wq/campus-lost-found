import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyB9GTfq9JbEEH3f-UXZRtd6zhyDjevCad8",
  authDomain: "lost-and-found-smsu.firebaseapp.com",
  projectId: "lost-and-found-smsu",
  storageBucket: "lost-and-found-smsu.firebasestorage.app",
  messagingSenderId: "947873684973",
  appId: "1:947873684973:web:bf752fe08e923b05899be4",
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Auth with persistence
let auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (error: any) {
  // If auth was already initialized, get the existing instance
  if (error.code === "auth/already-initialized") {
    const { getAuth } = require("firebase/auth");
    auth = getAuth(app);
  } else {
    console.error("Firebase Auth initialization error:", error);
    throw error;
  }
}

// Initialize Firestore
const db = getFirestore(app);

// Initialize Storage
const storage = getStorage(app);

export { auth, db, storage };