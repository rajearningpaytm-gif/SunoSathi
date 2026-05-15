import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  type Auth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCC3q-9fXcx7v4MbnW4ZkAWQE_nLMxeWrw",
  authDomain: "sunosathi-8e335.firebaseapp.com",
  projectId: "sunosathi-8e335",
  storageBucket: "sunosathi-8e335.firebasestorage.app",
  messagingSenderId: "784619483930",
  appId: "1:784619483930:web:643f55042c8901a3e3b2a3",
  measurementId: "G-R1K9ZFYYJN",
};

let app: FirebaseApp;
let auth: Auth;

if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
  // IndexedDB persists through WebView redirects; sessionStorage gets wiped
  // when the WebView navigates away — causing "missing initial state" errors.
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  });
} else {
  app = getApp();
  auth = getAuth(app);
}

export const firebaseAuth: Auth = auth;
export { GoogleAuthProvider };
export default app;
