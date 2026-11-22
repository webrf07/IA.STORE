// IA STORE — Firebase initialisation (modern modular SDK, loaded from Google's CDN).
//
// 1) Firebase Console → Project settings → Your apps → Web app → copy the config.
// 2) Paste the values below, replacing every "YOUR_..." placeholder.
//
// Note: these web-app identifiers are NOT secrets. Your data is protected by the
// Security Rules in firestore.rules / storage.rules, never by hiding this config.
// No passwords or private keys belong in this project.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app", // older projects: YOUR_PROJECT_ID.appspot.com
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};

/** false until the placeholders above have been replaced. */
export const isConfigured = !Object.values(firebaseConfig).some((v) => String(v).includes("YOUR_"));

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

export const COLLECTIONS = {
  products: "products",
  orders: "orders",
  admins: "admins",
};