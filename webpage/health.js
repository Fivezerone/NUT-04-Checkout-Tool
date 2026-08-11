// demo/health.js
// Persist a full health profile (age, gender, allergies, conditions, dietary
// preferences, goals, notes) to Firestore, tied to a signed-in Google account.
//
// Sign Up and Sign In are now separate actions:
//   - Sign Up: creates a new account. If the chosen email already has an
//     account, the user is told to use Sign In instead.
//   - Sign In: logs into an existing account. If the chosen email has no
//     account yet, the user is told to use Sign Up instead.
// Both always show Google's account picker (prompt: 'select_account') so
// the user explicitly chooses which email to use each time.
//
// AUTH_SYNC: after a successful sign-in/sign-up (or sign-out), the current
// user is also pushed to the NutriScore browser extension (if installed),
// via chrome.runtime.sendMessage — see onMessageExternal in the extension's
// background.js. This keeps the website and extension showing the same
// signed-in account instead of two independent identities.

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  getAdditionalUserInfo,
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from 'firebase/firestore';

// --- Firebase project configuration ---
// Get these values from Firebase Console > Project Settings > General
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

// --- NutriScore extension identity sync ---
// Replace with your extension's actual ID from chrome://extensions if it
// changes (e.g. once published to the Chrome Web Store).
const EXTENSION_ID = "cbdkgpcpbgadjfohhfccphbcblbkhmmk";

/**
 * Pushes the current auth state to the extension so its popup shows the
 * same signed-in user as the website. Silently does nothing if the
 * extension isn't installed, isn't reachable, or chrome.runtime isn't
 * available (e.g. non-Chrome browsers) — this must never block sign-in.
 */
function syncAccountToExtension(user) {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    return;
  }
  try {
    const payload = user
      ? { id: user.uid, email: user.email || '', picture: user.photoURL || '' }
      : null;
    chrome.runtime.sendMessage(EXTENSION_ID, { type: 'AUTH_SYNC', user: payload }, () => {
      // Swallow "Could not establish connection" — expected when the
      // extension isn't installed. chrome.runtime.lastError must still be
      // read (even unused) or Chrome logs an unchecked error to console.
      void chrome.runtime.lastError;
    });
  } catch (e) {
    // Extension messaging can throw synchronously in some browsers/contexts;
    // never let that break the website's own sign-in flow.
    console.warn('Could not sync account to extension:', e);
  }
}

/**
 * Pushes the saved health profile to the extension, same pattern as
 * syncAccountToExtension — so the popup's "View Health Details" button
 * can display it without the extension needing its own Firestore access.
 * Pass null to clear it (e.g. on sign-out).
 *
 * Also caches the same data in localStorage under 'nutriscoreHealthProfile'.
 * This is the more reliable path: the extension can read it directly from
 * the page (via chrome.scripting) whenever its popup opens, rather than
 * depending on this push message having fired and been received at the
 * exact right moment.
 */
function syncHealthToExtension(health) {
  try {
    if (health) {
      localStorage.setItem('nutriscoreHealthProfile', JSON.stringify(health));
    } else {
      localStorage.removeItem('nutriscoreHealthProfile');
    }
  } catch (e) {
    console.warn('Failed to cache health profile in localStorage:', e);
  }

  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
    return;
  }
  try {
    chrome.runtime.sendMessage(EXTENSION_ID, { type: 'HEALTH_SYNC', health }, () => {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    console.warn('Could not sync health profile to extension:', e);
  }
}

// Initialize Firebase app, Auth, and Firestore once for this page
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Session-only persistence: don't silently restore a previous login across
// browser restarts — combined with the forced account picker below, this
// keeps sign-in/sign-up a deliberate, explicit action each time.
setPersistence(auth, browserSessionPersistence).catch((error) => {
  console.error('Failed to set auth persistence:', error);
});

// Track the currently signed-in user's UID (null when signed out)
let currentUserId = null;
// Also keep the current Firebase `User` object when signed in
let currentUser = null;

// The original signed-out prompt, kept so we can restore it verbatim on
// sign-out rather than hardcoding the text a second time.
let defaultHeaderSubtitle = null;

/**
 * Shared popup logic for both Sign Up and Sign In. Always shows Google's
 * account chooser, then reports back whether the chosen email was already
 * a registered account (`isNewUser: false`) or brand new (`isNewUser: true`).
 * Does not decide what to do with that information — the calling function
 * (signUpWithGoogle / signInWithGoogle) handles that.
 */
async function runGooglePopup() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const result = await signInWithPopup(auth, provider);
  const additionalInfo = getAdditionalUserInfo(result);
  return { user: result.user, isNewUser: Boolean(additionalInfo && additionalInfo.isNewUser) };
}

/**
 * Finalizes a successful sign-in/sign-up: stores the user in memory and
 * localStorage, updates the UI, syncs identity to the extension, and loads
 * any saved health profile.
 */
async function completeSignIn(user) {
  currentUserId = user.uid;
  currentUser = user;

  try {
    const snapshot = {
      uid: user.uid,
      displayName: user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || ''
    };
    localStorage.setItem('nutriscoreUser', JSON.stringify(snapshot));
  } catch (e) {
    console.warn('Failed to persist user snapshot:', e);
  }

  updateAccountUI(true);
  syncAccountToExtension(user);
  await loadHealthPreferencesFromFirestore(currentUserId);
}

/**
 * Signs the current Firebase session out without disturbing the UI message
 * that's about to be shown (used when we deliberately reject a Sign Up/Sign
 * In attempt, e.g. wrong button for that email).
 */
async function silentlySignOut() {
  try {
    await auth.signOut();
  } catch (e) {
    console.warn('Silent sign-out failed:', e);
  }
  currentUserId = null;
  currentUser = null;
  try { localStorage.removeItem('nutriscoreUser'); } catch (e) {}
  updateAccountUI(false);
  syncAccountToExtension(null);
  syncHealthToExtension(null);
}

/**
 * "Sign Up" — creates a new account. Shows the Google account picker so the
 * user can choose which email to register with. If that email already has
 * an account, the sign-up is rejected and the user is told to sign in instead.
 */
async function signUpWithGoogle() {
  try {
    const { user, isNewUser } = await runGooglePopup();

    if (!isNewUser) {
      await silentlySignOut();
      showStatus(`An account already exists for ${user.email}. Please use Sign In instead.`, true);
      return;
    }

    showStatus(`Account created for ${user.email}.`);
    await completeSignIn(user);
  } catch (error) {
    console.error('Firebase sign-up failed:', error);
    showStatus('Sign-up failed. Please try again.', true);
  }
}

/**
 * "Sign In" — logs into an existing account. Shows the Google account picker
 * so the user can choose which email to use. If that email has no account
 * yet, the sign-in is rejected and the user is told to sign up instead.
 */
async function signInWithGoogle() {
  try {
    const { user, isNewUser } = await runGooglePopup();

    if (isNewUser) {
      await silentlySignOut();
      showStatus(`No account found for ${user.email}. Please use Sign Up first.`, true);
      return;
    }

    showStatus(`Signed in as ${user.email}`);
    await completeSignIn(user);
  } catch (error) {
    console.error('Firebase sign-in failed:', error);
    showStatus('Sign-in failed. Please try again.', true);
  }
}

/**
 * Signs the user out of Firebase Auth and clears local UI state.
 */
function signOutUser() {
  auth.signOut().then(() => {
    currentUserId = null;
    currentUser = null;
    try { localStorage.removeItem('nutriscoreUser'); } catch (e) {}
    applyStoredPreferences({ conditions: [], dietaryPreferences: [] });
    updateAccountUI(false);
    syncAccountToExtension(null);
    syncHealthToExtension(null);
    showStatus('Signed out.');
  });
}

/**
 * Reads which checkboxes are currently checked for a given field name.
 * Returns an array of string values, e.g. ['diabetes', 'vegan'].
 */
function readCheckboxSelections(fieldName) {
  const checkboxes = Array.from(document.querySelectorAll(`input[name="${fieldName}"]`));
  return checkboxes
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => checkbox.value);
}

function getInputValue(id) {
  const input = document.getElementById(id);
  return input ? input.value.trim() : '';
}

function getNumberValue(id) {
  const input = document.getElementById(id);
  if (!input) return null;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : null;
}

function setInputValue(id, value) {
  const input = document.getElementById(id);
  if (!input) return;
  input.value = value !== undefined && value !== null ? value : '';
}

/**
 * Applies a saved preferences object back onto the form —
 * checks the right boxes and fills the form fields.
 */
function applyStoredPreferences(preferences) {
  if (!preferences) return;

  setInputValue('age', preferences.age);
  setInputValue('gender', preferences.gender);
  setInputValue('weight', preferences.weight);
  setInputValue('height', preferences.height);
  setInputValue('allergies', preferences.allergies);

  const conditionCheckboxes = Array.from(document.querySelectorAll('input[name="condition"]'));
  conditionCheckboxes.forEach((checkbox) => {
    checkbox.checked =
      Array.isArray(preferences.conditions) && preferences.conditions.includes(checkbox.value);
  });

  const dietaryCheckboxes = Array.from(document.querySelectorAll('input[name="diet"]'));
  dietaryCheckboxes.forEach((checkbox) => {
    checkbox.checked =
      Array.isArray(preferences.dietaryPreferences) && preferences.dietaryPreferences.includes(checkbox.value);
  });
}

/**
 * Saves the current form's selections to Firestore, under a document
 * scoped to the signed-in user's UID. Firestore security rules (configured
 * separately in the Firebase console) ensure only that user can read/write it.
 */
async function saveHealthPreferencesToFirestore() {
  if (!currentUserId) {
    showStatus('Please sign in before saving.', true);
    return;
  }

  const preferences = {
    age: getNumberValue('age'),
    gender: getInputValue('gender'),
    weight: getNumberValue('weight'),
    height: getNumberValue('height'),
    allergies: getInputValue('allergies'),
    conditions: readCheckboxSelections('condition'),
    dietaryPreferences: readCheckboxSelections('diet'),
    updatedAt: new Date().toISOString()
  };

  try {
    // Path: users/{uid}/settings/health — one health doc per user
    await setDoc(doc(db, 'users', currentUserId, 'settings', 'health'), preferences);
    showStatus('Health profile saved to your account.');
    syncHealthToExtension(preferences);
  } catch (error) {
    console.error('Failed to save health preferences to Firestore:', error);
    showStatus('Unable to save health profile. Please try again.', true);
  }
}

/**
 * Loads the signed-in user's saved preferences from Firestore
 * and applies them to the form.
 */
async function loadHealthPreferencesFromFirestore(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'settings', 'health'));
    if (snap.exists()) {
      applyStoredPreferences(snap.data());
      syncHealthToExtension(snap.data());
    }
  } catch (error) {
    console.error('Failed to load health preferences from Firestore:', error);
    showStatus('Unable to load saved details.', true);
  }
}

/**
 * Displays a status message under the save button (success or error styling).
 */
function showStatus(message, isError = false) {
  const status = document.getElementById('saveStatus');
  if (!status) return;
  status.textContent = message;
  status.style.color = isError ? '#b91c1c' : '#0f766e';
}

/**
 * Updates the header subtitle in place — rather than a separate welcome
 * card below the account buttons, the same line that says "Sign up or
 * sign in..." switches to a personal welcome message once signed in.
 */
function updateHeaderSubtitle() {
  const subtitleEl = document.getElementById('headerSubtitle');
  if (!subtitleEl) return;

  // Remember the original signed-out copy the first time this runs, so
  // signing out can restore it exactly rather than duplicating the string.
  if (defaultHeaderSubtitle === null) {
    defaultHeaderSubtitle = subtitleEl.textContent;
  }

  if (currentUser && currentUserId) {
    const friendlyName = (currentUser.displayName || currentUser.email || 'there').trim();
    const displayName = friendlyName.includes('@') ? friendlyName.split('@')[0] : friendlyName;
    subtitleEl.textContent = `Welcome${displayName ? `, ${displayName}` : ''}! Save your details below so the extension can use them while you shop.`;
  } else {
    subtitleEl.textContent = defaultHeaderSubtitle;
  }
}

/**
 * Shows the right combination of Sign Up / Sign In / Sign Out controls
 * (plus save button state) depending on whether someone is signed in.
 */
function updateAccountUI(isSignedIn) {
  const signInButton = document.getElementById('signInWithGoogle');
  const signUpButton = document.getElementById('signUpWithGoogle');
  const signOutButton = document.getElementById('signOutButton');
  const saveButton = document.getElementById('saveHealthDetails');
  const navSignButton = document.getElementById('navSignButton');

  if (signInButton) signInButton.style.display = isSignedIn ? 'none' : 'inline-block';
  if (signUpButton) signUpButton.style.display = isSignedIn ? 'none' : 'inline-block';
  if (signOutButton) signOutButton.style.display = isSignedIn ? 'inline-block' : 'none';
  if (saveButton) saveButton.disabled = !isSignedIn;

  if (navSignButton) {
    if (isSignedIn && currentUser && currentUser.photoURL) {
      navSignButton.innerHTML = '';
      const img = document.createElement('img');
      img.className = 'nav-avatar';
      img.src = currentUser.photoURL;
      img.alt = currentUser.displayName || currentUser.email || 'Account';
      navSignButton.appendChild(img);
    } else {
      navSignButton.textContent = isSignedIn ? 'Sign out' : 'Sign in';
    }
  }

  updateHeaderSubtitle();
}

/**
 * Wires up button clicks and restores an active session on page load/
 * navigation (see onAuthStateChanged below). Persistence is session-only
 * (browserSessionPersistence), so the session survives moving between pages
 * in the same tab, but is cleared when the tab/browser is closed — the
 * account picker itself is only forced on an explicit Sign Up/Sign In click.
 */
function init() {
  const saveButton = document.getElementById('saveHealthDetails');
  const signInButton = document.getElementById('signInWithGoogle');
  const signUpButton = document.getElementById('signUpWithGoogle');
  const signOutButton = document.getElementById('signOutButton');

  if (saveButton) {
    saveButton.addEventListener('click', saveHealthPreferencesToFirestore);
  }
  if (signInButton) {
    signInButton.addEventListener('click', signInWithGoogle);
  }
  if (signUpButton) {
    signUpButton.addEventListener('click', signUpWithGoogle);
  }

  // The extension popup can no longer sign in on its own (see background.js
  // openSignInTab) — it opens this page with ?prompt=signin instead, so the
  // website's own Firebase sign-in flow runs and pushes the result back to
  // the extension via syncAccountToExtension()/AUTH_SYNC once it completes.
  const params = new URLSearchParams(window.location.search);
  if (params.get('prompt') === 'signin') {
    signInWithGoogle();
  }
  if (signOutButton) {
    signOutButton.addEventListener('click', signOutUser);
  }

  const navSignButton = document.getElementById('navSignButton');
  if (navSignButton) {
    navSignButton.addEventListener('click', () => {
      if (currentUserId) {
        signOutUser();
      } else {
        signInWithGoogle();
      }
    });
  }

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // A session already exists (e.g. the user navigated to a different
      // page and came back within the same tab/browser session) — restore
      // it silently, without forcing the account picker again. The picker
      // is only forced inside runGooglePopup(), which this path never calls.
      if (currentUserId !== user.uid) {
        showStatus(`Signed in as ${user.email}`);
        await completeSignIn(user);
      }
    } else {
      currentUser = null;
      currentUserId = null;
      updateAccountUI(false);
    }
  });
}

window.addEventListener('DOMContentLoaded', init);