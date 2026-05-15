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
  apiKey: "AIzaSyBSJTAgAnWk76DOVCgMu8x_3ERQL_b2D4M",
  authDomain: "sunosathi-ef83d.firebaseapp.com",
  projectId: "sunosathi-ef83d",
  storageBucket: "sunosathi-ef83d.firebasestorage.app",
  messagingSenderId: "382664320977",
  appId: "1:382664320977:web:416f416a4c1a23dca2e2f0",
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
