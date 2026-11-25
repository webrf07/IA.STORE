
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";

// Firebase Configuration - IA STORE
const firebaseConfig = {
  apiKey: "AIzaSyBMwFH6VsN494DgAiIF0e21KmkcbB5H_s4",
  authDomain: "ia-store-dcb69.firebaseapp.com",
  projectId: "ia-store-dcb69",
  storageBucket: "ia-store-dcb69.firebasestorage.app",
  messagingSenderId: "794936773230",
  appId: "1:794936773230:web:63295bac11b1cbf4ebb47f",
  measurementId: "G-26VGV4T4GF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Firebase Configuration Status
export const isConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

// Export Firebase App
export default app;
