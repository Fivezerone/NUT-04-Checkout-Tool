import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, onSnapshot } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyB05umupSWPt96qNWaevFJnS4ovaj907Gc",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "nutriscore-check.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "nutriscore-check",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "nutriscore-check.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "923932588057",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:923932588057:web:8575308e753659b6a85288"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
export const auth = getAuth(app);

export async function getCloudLedger(userId: string): Promise<any[]> {
  try {
    const colRef = collection(db, "users", userId, "shopping_ledger");
    const snapshot = await getDocs(colRef);
    const items = snapshot.docs.map(doc => doc.data());
    return items.sort((a, b) => b.addedAt - a.addedAt);
  } catch (err) {
    console.error("Failed to fetch cloud ledger:", err);
    return [];
  }
}

export function subscribeToCloudLedger(userId: string, callback: (data: any[]) => void): () => void {
  const colRef = collection(db, "users", userId, "shopping_ledger");
  return onSnapshot(colRef, (snapshot) => {
    const items = snapshot.docs.map(doc => doc.data());
    callback(items.sort((a, b) => b.addedAt - a.addedAt));
  }, (error) => {
    console.error("Cloud ledger subscription error:", error);
  });
}
