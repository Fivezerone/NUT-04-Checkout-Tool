import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, writeBatch } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const FIRESTORE_BATCH_LIMIT = 500;

let currentUser = null;

self.FirebaseSync = {
  setUser(user) {
    currentUser = user;
    console.log("[FirebaseSync] User updated:", user ? user.email : "logged out");
    if (user) {
      this.syncLedger(); // sync on login
    }
  },
  
  async syncLedger() {
    if (!currentUser || !currentUser.id) return;
    try {
      if (typeof NutriScoreDB === 'undefined' || !NutriScoreDB.getAllShoppingLedger) {
        return;
      }
      const allItems = await NutriScoreDB.getAllShoppingLedger();
      if (!allItems || allItems.length === 0) return;
      
      for (let i = 0; i < allItems.length; i += FIRESTORE_BATCH_LIMIT) {
        const chunk = allItems.slice(i, i + FIRESTORE_BATCH_LIMIT);
        const batch = writeBatch(db);
        for (const item of chunk) {
          const itemRef = doc(db, 'users', currentUser.id, 'shopping_ledger', item.id);
          batch.set(itemRef, item);
        }
        await batch.commit();
      }
      console.log("[FirebaseSync] Synced", allItems.length, "items to Firestore");
    } catch (err) {
      console.error("[FirebaseSync] Sync failed:", err);
    }
  }
};
