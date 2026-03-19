/**
 * Firebase v8 (Namespaced) Configuration
 * Updated with the specific regional Database URL to resolve connection warnings.
 */
const firebaseConfig = {
    apiKey: "AIzaSyDZA2RGixp2ppKxhJynQp4IB4_ZudDZeqg",
    authDomain: "candy-jar-pvp.firebaseapp.com",
    // Corrected to the asia-southeast1 regional endpoint
    databaseURL: "https://candy-jar-pvp-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "candy-jar-pvp",
    storageBucket: "candy-jar-pvp.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef123456"
};

// Initialize Firebase using the global 'firebase' object (v8 compatibility mode)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Export the database instance
export const db = firebase.database();

// Export the auth service (Firebase v8 namespaced)
export const auth = firebase.auth();

// Export Firestore (Firebase v8 namespaced)
export const firestore = firebase.firestore();
// Alias requested name to avoid conflicts with RTDB `db`
export const db_fs = firestore;

// Application scoping for the database path
const appId = 'candy-jar-live';

/**
 * Path Helper
 * Returns a reference to: artifacts/candy-jar-live/public/data/rooms/{id}
 */
const getRoomRef = (id) => db.ref(`artifacts/${appId}/public/data/rooms/${id}`);

export async function createRoom(id, seed, wager, grid) {
    console.log("Creating room in Firebase:", id);
    await getRoomRef(id).set({
        seed,
        wager,
        pot: wager * 2,
        grid,
        status: 'waiting',
        timeLeft: 120,
        players: {
            p1: { score: 0, inventory: { bomb: 0, dynamite: 0 } },
            p2: { score: 0, inventory: { bomb: 0, dynamite: 0 } }
        }
    });
}

export async function joinRoom(id) {
    const r = getRoomRef(id);
    const snap = await r.once('value');
    if (!snap.exists()) return null;
    
    // Update status to active once P2 joins - this triggers the UI shift in main.js
    await r.update({ status: 'playing' });

    return snap.val();
}

export function listenToRoom(id, callback) {
    const r = getRoomRef(id);
    r.on('value', (snap) => {
        const data = snap.val();
        if (data) {
            callback(data);
        }
    }, (error) => {
        console.error("Firebase Sync Error:", error);
    });
}

export function stopListening(id) {
    getRoomRef(id).off();
}

export async function updateGameState(id, updates) {
    if (!id) return;
    await getRoomRef(id).update(updates);
}

export async function updatePointer(id, role, r, c) {
    if (!id) return;
    // Real-time synchronization of cursor/pointer positions
    await getRoomRef(id).child(`pointers/${role}`).update({ r, c });
}