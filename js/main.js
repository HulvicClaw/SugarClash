import * as Engine from './engine.js';
import * as UI from './ui.js';
import * as Multi from './multiplayer.js';

// Anonymous auth bootstrapping (Firebase v8 namespaced)
const auth = Multi.auth;
const db_fs = Multi.db_fs;
auth
    .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
    .catch((err) => console.error('Auth persistence error:', err));

async function ensureUserWallet(user) {
    try {
        if (!user?.uid) return;
        const userRef = db_fs.collection('users').doc(user.uid);
        const snap = await userRef.get();

        if (!snap.exists) {
            await userRef.set({
                balance: 1000,
                authLevel: 'guest',
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (err) {
        console.error('Wallet init error:', err);
    }
}

let currentBalance = null;
let userWalletUnsub = null;

function updateHostButtonState() {
    const wagerEl = document.getElementById('wager-input');
    const hostBtn = document.getElementById('btn-host');
    if (!wagerEl || !hostBtn) return;

    const wager = parseInt(wagerEl.value, 10);
    const wagerAmount = Number.isFinite(wager) ? wager : 0;
    const balance = Number.isFinite(currentBalance) ? currentBalance : 0;
    hostBtn.disabled = balance < wagerAmount;
}

function triggerInsufficientFundsAlert() {
    const wagerEl = document.getElementById('wager-input');
    if (!wagerEl) return;

    wagerEl.classList.remove('error-shake');
    // Force reflow so the animation restarts
    void wagerEl.offsetWidth;
    wagerEl.classList.add('error-shake');
    setTimeout(() => wagerEl.classList.remove('error-shake'), 1000);
}

function listenToWallet(uid) {
    if (userWalletUnsub) {
        userWalletUnsub();
        userWalletUnsub = null;
    }

    userWalletUnsub = db_fs
        .collection('users')
        .doc(uid)
        .onSnapshot(
            (snap) => {
                const data = snap.exists ? snap.data() : null;
                const balance = data?.balance;
                currentBalance = typeof balance === 'number' ? balance : 0;
                UI.updateBalanceUI(currentBalance);
                updateHostButtonState();
            },
            (err) => console.error('Wallet listener error:', err)
        );
}

auth.onAuthStateChanged(async (user) => {
    if (!user) {
        try {
            await auth.signInAnonymously();
        } catch (err) {
            console.error('Anonymous sign-in error:', err);
        }
        return;
    }

    console.log('Signed in uid:', user.uid);
    await ensureUserWallet(user);
    listenToWallet(user.uid);
});

let state = {
    room: null,
    role: null,
    selected: null,
    activeItem: null,
    active: false,
    isBoardLocked: false,
    lastData: null,
    timerId: null,
    botInterval: null,
    isBotGame: false
};

let botIsThinking = false;

/**
 * runBotTurn
 * Logic for the AI opponent (Harder than Normal + Strategic Items).
 */
async function runBotTurn() {
    if (!state.active || state.role !== 'p1' || !state.lastData || botIsThinking) return;
    if (state.lastData.status !== 'playing') return;
    if (!state.lastData.players?.p2?.isBot) return;
    if (state.isBoardLocked || Engine.isAnimating) return;

    if (Math.random() > 0.95) return;

    botIsThinking = true;

    try {
        const thinkingTime = 400 + Math.random() * 400;
        await new Promise(resolve => setTimeout(resolve, thinkingTime));

        if (!state.active || state.lastData.status !== 'playing' || state.isBoardLocked || Engine.isAnimating) {
            botIsThinking = false;
            return;
        }

        const p2Inventory = state.lastData.players.p2.inventory || { bomb: 0, dynamite: 0 };
        const hasBomb = (p2Inventory.bomb || 0) > 0;
        const hasDynamite = (p2Inventory.dynamite || 0) > 0;

        // 1. STRATEGIC ITEM USAGE (50% chance if items available)
        if ((hasBomb || hasDynamite) && Math.random() < 0.5) {
            const itemToUse = hasDynamite ? 'dynamite' : 'bomb';
            const target = {
                r: Math.floor(2 + Math.random() * 4),
                c: Math.floor(2 + Math.random() * 4)
            };

            // BOT LINGER FOR ITEMS: 
            // Show the red glow on the target cell before it explodes
            await Multi.updatePointer(state.room, 'p2', target.r, target.c);
            await new Promise(resolve => setTimeout(resolve, 600));

            // executeItemDropForPlayer now handles visuals and the 400ms pause
            await executeItemDropForPlayer('p2', itemToUse, target);

            // Clear pointer
            await Multi.updatePointer(state.room, 'p2', null, null);
            botIsThinking = false;
            return; 
        }

        // 2. NORMAL SWIPE LOGIC
        const moves = Engine.findAllPossibleMoves(state.lastData.grid);
        const bestMove = Engine.pickBestMove(moves);

        if (bestMove) {

           // Trigger .p2-cursor (bright red glow)
            await Multi.updatePointer(state.room, 'p2', bestMove.origin.r, bestMove.origin.c);
            // Wait 500ms
            await new Promise(resolve => setTimeout(resolve, 500));

            if (state.active && state.lastData.status === 'playing') {
                const isValid = Engine.validateBotMove(state.lastData.grid, bestMove.origin, bestMove.target);
                if (isValid) {
                    await executeMoveForPlayer('p2', bestMove.origin, bestMove.target);
                }
            }
            // STEP 2B: CLEANUP
            // Briefly show the destination tile before hiding the red cursor
            await Multi.updatePointer(state.room, 'p2', bestMove.target.r, bestMove.target.c);
            setTimeout(() => Multi.updatePointer(state.room, 'p2', null, null), 200);
        }
    } catch (err) {
        console.error("Bot AI Error:", err);
    } finally {
        botIsThinking = false;
    }
}

/**
 * executeItemDropForPlayer
 * Processes Bomb/Dynamite logic with a multi-stage cinematic flow.
 */
async function executeItemDropForPlayer(role, type, target) {
    if (!state.room || !state.lastData) return;
    if (state.isBoardLocked) return;

    const playerState = state.lastData.players[role];
    const inventory = playerState?.inventory || { bomb: 0, dynamite: 0 };
    const itemCount = inventory[type] || 0;

    if (itemCount <= 0) {
        if (role === state.role) UI.showToast(`No ${type}s left!`);
        return;
    }

    try {
        state.isBoardLocked = true;
        // --- PHASE 1: PREPARATION ---
        const coords = Engine.getExplosionCoords(type, target.r, target.c);

        // --- PHASE 2: VISUAL DESTRUCTION ---
        // Trigger the CSS animations and screen shake
        UI.triggerExplosionVFX(coords);
        UI.triggerImpact(target.r, target.c);

        // --- PHASE 3: DATA DESTRUCTION (Immediate) ---
        // We clear the data but don't refill yet
        const explosionResult = Engine.processExplosion(state.lastData.grid, coords);

        // --- PHASE 4: SYNC VOID GRID + IMMEDIATE SCORE ---
        const updatedInventory = { ...inventory };
        updatedInventory[type]--;

        await Multi.updateGameState(state.room, {
            grid: explosionResult.grid,
            [`players/${role}/score`]: (playerState.score || 0) + explosionResult.explosionScore,
            [`players/${role}/inventory`]: updatedInventory
        });

        // --- PHASE 5: 400ms VOID WINDOW BEFORE REFILL ---
        await new Promise(resolve => setTimeout(resolve, 400));

        // --- PHASE 6: REFILL & CASCADE (DELAYED SERVER UPDATE) ---
        const finalCascade = Engine.processGridMatches(JSON.parse(JSON.stringify(explosionResult.grid)));

        if (finalCascade.rewards) {
            updatedInventory.bomb = Math.min((updatedInventory.bomb || 0) + finalCascade.rewards.bomb, 3);
            updatedInventory.dynamite = Math.min((updatedInventory.dynamite || 0) + finalCascade.rewards.dynamite, 2);
        }

        await Multi.updateGameState(state.room, {
            grid: finalCascade.grid,
            [`players/${role}/score`]: (playerState.score || 0) + explosionResult.explosionScore + (finalCascade.totalScore * 10),
            [`players/${role}/inventory`]: updatedInventory
        });

    } catch (error) {
        console.error("Execute Item Error:", error);
    } finally {
        Engine.setIsAnimating(false);
        state.isBoardLocked = false;
    }
}

/**
 * executeMoveForPlayer
 * Refactored with Adjacency Guard and Match Simulation (Gatekeeper Logic).
 */
async function executeMoveForPlayer(role, origin, target) {
    if (!state.room || !state.lastData || !origin || !target) return;
    if (state.isBoardLocked) return;

    let didLock = false;
    try {
        // 1. Adjacency Guard: Check Manhattan Distance
        const distance = Math.abs(origin.r - target.r) + Math.abs(origin.c - target.c);
        if (distance !== 1) {
            if (role === state.role) {
                UI.triggerShake(origin, target);
            }
            return;
        }

        // 2. Match Simulation: Create gridCopy and swap tiles
        let gridCopy = JSON.parse(JSON.stringify(state.lastData.grid));
        const temp = gridCopy[origin.r][origin.c];
        gridCopy[origin.r][origin.c] = gridCopy[target.r][target.c];
        gridCopy[target.r][target.c] = temp;

        // 3. Logic Gate: Find matches on the simulated swap
        const { coords } = Engine.findMatches(gridCopy);

        if (coords && coords.length > 0) {
            const playerState = state.lastData.players[role];
            const currentScore = playerState.score || 0;
            const currentInv = playerState.inventory || { bomb: 0, dynamite: 0 };

            // Lock until refill finishes (prevents swapping during void/refill)
            state.isBoardLocked = true;
            didLock = true;

            // PHASE 1: Explosion -> create "void" and update score immediately
            coords.forEach(m => { gridCopy[m.r][m.c] = null; });
            Engine.setIsAnimating(true);
            const immediateMatchPoints = coords.length * 10;
            await Multi.updateGameState(state.room, {
                grid: gridCopy,
                [`players/${role}/score`]: currentScore + immediateMatchPoints
            });

            // PHASE 2: Delay before gravity/refill (400ms void window)
            await new Promise(resolve => setTimeout(resolve, 400));

            // PHASE 3: Refill/cascades; apply remaining score + rewards
            const cascade = Engine.processGridMatches(JSON.parse(JSON.stringify(gridCopy)));
            const newBombCount = Math.min((currentInv.bomb || 0) + (cascade.rewards?.bomb || 0), 3);
            const newDynamiteCount = Math.min((currentInv.dynamite || 0) + (cascade.rewards?.dynamite || 0), 2);

            await Multi.updateGameState(state.room, {
                grid: cascade.grid,
                [`players/${role}/score`]: currentScore + immediateMatchPoints + (cascade.totalScore * 10),
                [`players/${role}/inventory/bomb`]: newBombCount,
                [`players/${role}/inventory/dynamite`]: newDynamiteCount
            });
        } else {
            // 4. Revert Logic: No match found, don't update DB, just shake locally
            if (role === state.role) {
                UI.triggerShake(origin, target);
            }
        }
    } catch (err) {
        console.error("Execution Error:", err);
    } finally {
        if (didLock) Engine.setIsAnimating(false);
        state.isBoardLocked = false;
    }
}


/**
 * initSync
 */
function initSync() {
    if (!state.room) return;
    
    let lastGridJson = "";

    Multi.listenToRoom(state.room, (data) => {
        if (!data) return;
        
            const currentGridJson = JSON.stringify(data.grid);
        if (lastGridJson !== "" && currentGridJson !== lastGridJson) {
            // If it was an explosion (lots of nulls), trigger a shake for BOTH players
            if (currentGridJson.includes('null')) {
                UI.triggerImpact(3, 3); // Shake the whole board
            }
        }

        lastGridJson = currentGridJson;

        state.lastData = data;

        requestAnimationFrame(() => {
            UI.renderSharedBoard(data, state.role, state.selected, state.activeItem);
            
            if (data.timeLeft !== undefined && UI.elements.timer) {
                UI.elements.timer.innerText = data.timeLeft;
            }
            if (data.players?.p1 && UI.elements.score1) {
                UI.elements.score1.innerText = (data.players.p1.score || 0).toString().padStart(4, '0');
            }
            if (data.players?.p2 && UI.elements.score2) {
                UI.elements.score2.innerText = (data.players.p2.score || 0).toString().padStart(4, '0');
            }
        });

        if (data.status === 'playing' && !state.active) {
            state.active = true;
            UI.elements.overlay.classList.add('hidden');
            if (state.role === 'p1') {
                startTimer();
                if (data.players?.p2?.isBot) {
                    runBotTurn();
                    state.botInterval = setInterval(runBotTurn, 3000);
                }
            }
        }

        if (data.status === 'finished' && state.active) {
            state.active = false;
            clearInterval(state.timerId);
            clearInterval(state.botInterval);
            UI.showResultScreen(data, state.role);
        }
    });
}

/**
 * startTimer
 */
function startTimer() {
    if (state.role !== 'p1' || state.timerId) return;

    let timeLeft = 90;
    state.timerId = setInterval(async () => {
        timeLeft--;
        if (timeLeft <= 0) {
            clearInterval(state.timerId);
            state.timerId = null;
            
            const p1s = state.lastData?.players?.p1?.score || 0;
            const p2s = state.lastData?.players?.p2?.score || 0;
            const winner = p1s > p2s ? 'p1' : (p2s > p1s ? 'p2' : 'draw');

            await Multi.updateGameState(state.room, { 
                status: 'finished', 
                timeLeft: 0,
                winner: winner
            });
        } else {
            await Multi.updateGameState(state.room, { timeLeft });
        }
    }, 1000);
}

/**
 * startBotGame
 */
window.addEventListener('startBotGame', async () => {
    const id = 'BOT-' + Math.floor(1000 + Math.random() * 9000).toString();
    const seed = Date.now();

    state.role = 'p1';
    state.room = id;
    state.isBotGame = true;

    Engine.setSeed(seed);
    const grid = Engine.generateSeededGrid();

    await Multi.createRoom(id, seed, 100, grid);

    await Multi.updateGameState(id, {
        status: 'playing',
        'players/p2': {
            name: 'AI-Hard',
            score: 0,
            isBot: true,
            inventory: { bomb: 0, dynamite: 0 }
        }
    });

    initSync();
});

window.addEventListener('tileSwipe', async (e) => {
    const { origin, target } = e.detail;
    if (!state.active || !state.room || !state.lastData || state.isBoardLocked) return;
    await executeMoveForPlayer(state.role, origin, target);
});


window.addEventListener('itemDrop', async (e) => {
    const { type, target } = e.detail;
    if (!state.room || !state.role || !state.lastData || state.isBoardLocked) return;

     // Unified call to handle Human drops
    await executeItemDropForPlayer(state.role, type, target);
});




document.addEventListener('DOMContentLoaded', () => {
    const wagerEl = document.getElementById('wager-input');
    if (wagerEl) {
        wagerEl.addEventListener('input', updateHostButtonState);
        wagerEl.addEventListener('change', updateHostButtonState);
    }

    document.getElementById('btn-host').onclick = async () => {
        const id = Math.floor(1000 + Math.random() * 9000).toString();
        const wager = parseInt(document.getElementById('wager-input').value) || 100;
        const balance = Number.isFinite(currentBalance) ? currentBalance : 0;
        if (balance < wager) {
            triggerInsufficientFundsAlert();
            return;
        }

        const seed = Date.now();
        state.role = 'p1';
        state.room = id;
        Engine.setSeed(seed);
        const grid = Engine.generateSeededGrid();
        await Multi.createRoom(id, seed, wager, grid);
        try {
            await navigator.clipboard.writeText(id);
        } catch {}
        UI.showToast(`Game Hosted! Room ID ${id} copied to clipboard.`);
        UI.showLobbyWaiting(id);
        initSync();
    };

    document.getElementById('btn-join').onclick = async () => {
        const id = document.getElementById('room-id-input').value.trim();
        if (!id) return;
        const data = await Multi.joinRoom(id);
        if (!data) return UI.showToast("Room Not Found");
        state.role = 'p2';
        state.room = id;
        Engine.setSeed(data.seed);
        initSync();
    };
});

window.addEventListener('broadcastPointer', (e) => {
    if (state.room && state.role) {
        // Throttled update to the database
        Multi.updatePointer(state.room, state.role, e.detail.r, e.detail.c);
    }
});