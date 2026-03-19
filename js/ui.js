export const elements = {
    gameContainer: document.getElementById('app'), 
    grid1: document.getElementById('grid1'),
    score1: document.getElementById('score1'),
    score2: document.getElementById('score2'),
    timer: document.getElementById('timer'),
    overlay: document.getElementById('overlay'),
    resultOverlay: document.getElementById('result-overlay'),
    inventory: document.getElementById('inventory-container'),
    toast: document.getElementById('toast')
};

export function updateBalanceUI(balance) {
    const el = document.getElementById('practice-balance');
    if (!el) return;
    const b = Number.isFinite(balance) ? balance : 0;
    const prev = el.getAttribute('data-balance');
    el.setAttribute('data-balance', String(b));
    el.innerHTML = `Practice Balance: <span id="practice-balance-amount">${b}</span>`;

    if (prev !== null && prev !== String(b)) {
        const amt = document.getElementById('practice-balance-amount');
        if (amt) {
            amt.classList.remove('balance-spin');
            // Force reflow so the animation can restart
            void amt.offsetWidth;
            amt.classList.add('balance-spin');
        }
    }
}

// Pointer State Tracking
let pointerStart = {
    x: 0,
    y: 0,
    element: null,
    data: null, // Stores {r, c} for tiles or {type} for items
    ghost: null // Reference to the ghost follower element
};

// Trail Throttling
let lastTrailTime = 0;
const TRAIL_THROTTLE_MS = 20;

/**
 * Global Pointer Listeners
 */
function initInputSystem() {
    const handleStart = (e) => {
        const x = e.clientX || (e.touches ? e.touches[0].clientX : 0);
        const y = e.clientY || (e.touches ? e.touches[0].clientY : 0);
        const target = document.elementFromPoint(x, y);
        
        if (!target) return;

        const tile = target.closest('.tile');
        if (tile) {
            const r = parseInt(tile.getAttribute('data-r'));
            const c = parseInt(tile.getAttribute('data-c'));

            // BROADCAST: Initial touch
            window.dispatchEvent(new CustomEvent('broadcastPointer', { 
                detail: { r, c, active: true } 
            }));

            tile.classList.add('tile-selected');
            
            pointerStart = {
                x, y,
                element: tile,
                data: { r, c },
                ghost: null
            };
            return;
        }

        const slot = target.closest('.item-slot');
        if (slot) {
            const itemType = slot.getAttribute('data-item');
            const ghost = document.createElement('div');
            ghost.className = 'ghost-follower';
            ghost.innerText = itemType === 'bomb' ? '💣' : '🧨';
            
            // Fix: Ensure pointerEvents: 'none' so we can drop ON tiles through the ghost
            Object.assign(ghost.style, {
                position: 'fixed',
                pointerEvents: 'none',
                zIndex: '9999',
                fontSize: '2.5rem',
                opacity: '0.6',
                left: `${x}px`,
                top: `${y}px`,
                transform: 'translate(-50%, -50%)'
            });

            document.body.appendChild(ghost);

            pointerStart = {
                x, y,
                element: slot,
                data: { type: itemType },
                ghost: ghost
            };
            return;
        }
    };

    const handleMove = (e) => {
// 1. Calculate x and y at the very top to fix initialization order
        const x = e.clientX || (e.touches ? e.touches[0].clientX : 0);
        const y = e.clientY || (e.touches ? e.touches[0].clientY : 0);

         if (!pointerStart.element) return;
         
       // Ghost Logic for items
        if (pointerStart.ghost) {
            pointerStart.ghost.style.left = `${x}px`;
            pointerStart.ghost.style.top = `${y}px`;
        }

    const tile = document.elementFromPoint(x, y)?.closest('.tile');
        if (tile) {
            const r = parseInt(tile.getAttribute('data-r'));
            const c = parseInt(tile.getAttribute('data-c'));
            
            // 3. Enhanced Detail: Broadcast with active status
            window.dispatchEvent(new CustomEvent('broadcastPointer', { 
                detail: { r, c, active: !!pointerStart.element } 
            }));
        }

        if (pointerStart.element) {
            const now = Date.now();
            if (now - lastTrailTime > TRAIL_THROTTLE_MS) {
                lastTrailTime = now;
                const trail = document.createElement('div');
                trail.className = 'pointer-trail';
                trail.style.left = `${x}px`;
                trail.style.top = `${y}px`;
                document.body.appendChild(trail);
                setTimeout(() => trail.remove(), 400);
            }
        }
    };


    const handleEnd = (e) => {
        let x, y;

        // Safe Coordinates: check changedTouches for touchend/touchcancel
        if (e.changedTouches && e.changedTouches.length > 0) {
            x = e.changedTouches[0].clientX;
            y = e.changedTouches[0].clientY;
        } else {
            x = e.clientX;
            y = e.clientY;
        }

        if (pointerStart.ghost) {
            pointerStart.ghost.remove();
            pointerStart.ghost = null;
        }

        if (!pointerStart.element) return;
        
        // Visual Polish: Remove selection class from original element
        pointerStart.element.classList.remove('tile-selected');
        
        // 1. Logic Separation: Tiles use Vector Math, Items use elementFromPoint
        if (pointerStart.element.classList.contains('tile')) {
            const deltaX = x - pointerStart.x;
            const deltaY = y - pointerStart.y;
            const threshold = 30;

            // Check if movement exceeds threshold
            if (Math.abs(deltaX) > threshold || Math.abs(deltaY) > threshold) {
                const origin = pointerStart.data;
                let targetR = origin.r;
                let targetC = origin.c;

                // 2. Directional Lock (Vector-Based)
                if (Math.abs(deltaX) > Math.abs(deltaY)) {
                    // Horizontal Swipe
                    targetC = origin.c + (deltaX > 0 ? 1 : -1);
                } else {
                    // Vertical Swipe
                    targetR = origin.r + (deltaY > 0 ? 1 : -1);
                }

                // 3. Boundary & Dispatch
                if (targetR >= 0 && targetR < 8 && targetC >= 0 && targetC < 8) {
                    window.dispatchEvent(new CustomEvent('tileSwipe', {
                        detail: { origin, target: { r: targetR, c: targetC } }
                    }));
                }
            }
        }

        // Logic for Item Slots (Bombs/Dynamite) - Keeps elementFromPoint for precision
        if (pointerStart.element.classList.contains('item-slot')) {
            const endElement = document.elementFromPoint(x, y);
            if (endElement) {
                const gridTarget = endElement.closest('.tile');
                if (gridTarget) {
                    window.dispatchEvent(new CustomEvent('itemDrop', {
                        detail: { 
                            type: pointerStart.data.type, 
                            target: { 
                                r: parseInt(gridTarget.getAttribute('data-r')), 
                                c: parseInt(gridTarget.getAttribute('data-c'))
                             } 
                        }
                    }));
                }
            }
        }

         window.dispatchEvent(new CustomEvent('broadcastPointer', { 
            detail: { r: null, c: null, active: false } 
        }));

        pointerStart.element = null;
    };

    window.addEventListener('mousedown', handleStart);
    window.addEventListener('touchstart', handleStart, { passive: false });
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchend', handleEnd);
}

/**
 * Add Practice Styles and Button to Lobby
 */
function initLobbyPracticeMode() {
    // 1. Add Styles
    const style = document.createElement('style');
    style.innerHTML = `

        /* Reverting/Shake Animation for Invalid Moves */
        .reverting { animation: revert-shake 0.4s ease-in-out; }
        @keyframes revert-shake {
            0%, 100% { transform: translateX(0); }
            20%, 60% { transform: translateX(-6px); }
            40%, 80% { transform: translateX(6px); }
        }

         .tile-selected {
            filter: brightness(1.3) contrast(1.1);
            z-index: 10;
            box-shadow: 0 0 15px rgba(255,255,255,0.5);
        }
        .tile-explode {
            transform: scale(0.2) rotate(30deg) !important;
            opacity: 0 !important;
            filter: brightness(5) saturate(2) blur(2px) !important;
            transition: all 0.5s ease-out !important;
            z-index: 100; 
        }


        @keyframes spark-fly {
            0% { transform: translate(0, 0) scale(1); opacity: 1; }
            100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
            }   


        .explosion-spark {
            position: absolute;
            width: 6px;
            height: 6px;
            background: #ffffff; /* White glowing sparks */
            border-radius: 50%;
            pointer-events: none;
            z-index: 200;
            box-shadow: 0 0 10px #ffffff;
            animation: spark-fly 0.6s ease-out forwards;
        }

        .shake-heavy {
            animation: shake-extreme 0.4s cubic-bezier(.36,.07,.19,.97) both;
        }
         @keyframes shake-extreme {
            10%, 90% { transform: translate3d(-4px, -2px, 0); }
            20%, 80% { transform: translate3d(8px, 4px, 0); }
            30%, 50%, 70% { transform: translate3d(-12px, -6px, 0); }
            40%, 60% { transform: translate3d(12px, 6px, 0); }
        }
        .btn-practice {
            background: #008080;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 8px;
            font-weight: bold;
            cursor: pointer;
            width: 100%;
            margin: 10px 0;
            font-family: inherit;
            transition: transform 0.1s ease, background 0.2s ease, opacity 0.2s ease;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 0 #005a5a;
        }
        .btn-practice:hover {
            background: #009696;
            transform: translateY(-1px);
        }
        .btn-practice:active {
            transform: translateY(2px);
            box-shadow: 0 1px 0 #005a5a;
        }
        .btn-practice:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        .difficulty-hint {
            font-size: 0.7rem;
            opacity: 0.8;
            margin-top: 4px;
            font-weight: normal;
        }

        .p2-cursor {
            position: relative;
            background-color: rgba(255, 0, 0, 0.4) !important; /* Semi-transparent red base */
            outline: 3px solid #ff0000 !important; /* Solid bright red border */
            box-shadow: 0 0 20px #ff0000, inset 0 0 15px #ff0000 !important; /* Intense red glow */
            transform: scale(0.95); /* Slight shrink to look like a "press" */
            transition: transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
            z-index: 5;

        
s
            
            /* This makes it 50% brighter than standard red */
            filter: brightness(1.5) saturate(1.5); 
            
            /* Add a pulsing animation to make the Bot's presence felt */
            animation: bot-pulse 1s infinite alternate;
        }
                    
        .p1-cursor {
            position: relative;
            background-color: rgba(0, 149, 255, 0.33) !important;
            outline: 3px solid #0096ff !important;
            box-shadow: 0 0 20px rgba(0, 150, 255, 0.8), inset 0 0 15px rgba(0, 150, 255, 0.4) !important;
            transform: scale(0.95);
            transition: all 0.1s ease-out, box-shadow 0.2s ease-in-out; /* Smooths out the "jump" between tiles */
            z-index: 5; 
        }

        /* Make the highlight slightly larger so it's visible even under a thumb */
        .p1-cursor::after, .p2-cursor::after {
            content: '';
            position: absolute;
            top: -4px; left: -4px; right: -4px; bottom: -4px;
            border: 1px solid white;
            border-radius: 4px;
            opacity: 0.5;
        }

        @keyframes bot-pulse {
            from { filter: brightness(1.2) saturate(1.2); }
            to { filter: brightness(2.0) saturate(2.0); box-shadow: 0 0 30px #ff0000; }
        }

        .pointer-trail {
            /* If the bot is moving, make the trail red and glowing */
            background: #ff0000;
            box-shadow: 0 0 10px #ff0000;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            position: fixed;
            pointer-events: none;
            z-index: 1000;
    }

    `;
    document.head.appendChild(style);

   
    

    // Link the existing Button
    const btnBot = document.getElementById('btn-bot');

    if (btnBot) {
        // If the button exists, give it the class for styling and the click event
        btnBot.classList.add('btn-practice'); 
        btnBot.onclick = () => {
            console.log("Bot Mode Started");
            window.dispatchEvent(new CustomEvent('startBotGame'));
        };
    } else {
        console.warn("Notice: #btn-bot not found in HTML. Check index.html.");
    }
}

initInputSystem();
// Ensure the DOM is ready before injecting the lobby elements
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLobbyPracticeMode);
} else {
    initLobbyPracticeMode();
}

/**
 * renderSharedBoard
 */
export function renderSharedBoard(data, myRole, selected, activeItem) {
    if (!data?.grid || !elements.grid1) return;

    const gridData = Array.isArray(data.grid) ? data.grid : Object.values(data.grid);
    const currentTiles = elements.grid1.children;

    if (currentTiles.length !== 64) {
        elements.grid1.innerHTML = '';
        for (let i = 0; i < 64; i++) {
            const div = document.createElement('div');
            div.className = 'tile';
            elements.grid1.appendChild(div);
        }
    }

    gridData.forEach((rowData, r) => {
        const row = Array.isArray(rowData) ? rowData : Object.values(rowData);
        row.forEach((tileData, c) => {
            const index = r * 8 + c;
            const tileEl = currentTiles[index];
            if (!tileEl) return;

            tileEl.setAttribute('data-r', r);
            tileEl.setAttribute('data-c', c);

            const type = (typeof tileData === 'object' && tileData !== null) ? tileData.type : tileData;

            if (type === null || type === undefined) {
                tileEl.className = 'tile empty'; 
            } else {
                tileEl.className = `tile t-${type}`;
                 // Keep the refill logic untouched for visual consistency
                if (tileData.id && String(tileData.id).includes('refill')) {
                    tileEl.classList.add('tile-new');
                }
            }

            const p1 = data.pointers?.p1;
            const p2 = data.pointers?.p2;
            tileEl.classList.toggle('p1-cursor', p1?.r === r && p1?.c === c);
            tileEl.classList.toggle('p2-cursor', p2?.r === r && p2?.c === c);
        });
    });

    // Handle CPU Label next to P2 Score
    const p2PanelLabel = document.querySelector('.panel:last-child small');
    if (p2PanelLabel) {
        p2PanelLabel.innerText = data.isBot ? 'PLAYER 2 (CPU)' : 'PLAYER 2';
    }

    renderInventory(data.players[myRole]?.inventory || {});
}

function renderInventory(inv) {
    if (!elements.inventory) return;
    const bombCount = inv.bomb || 0;
    const dynCount = inv.dynamite || 0;
    const bEl = document.getElementById('count-bomb');
    if (bEl) bEl.innerText = `x${bombCount}`;
    const dEl = document.getElementById('count-dynamite');
    if (dEl) dEl.innerText = `x${dynCount}`;
    document.getElementById('slot-bomb')?.classList.toggle('ready', bombCount > 0);
    document.getElementById('slot-dynamite')?.classList.toggle('ready', dynCount > 0);
}

export function showResultScreen(data, myRole) {
    elements.gameContainer.classList.add('blur-active');
    const winner = data.winner;
    const isWinner = winner === myRole;
    const isDraw = winner === 'draw';

    elements.resultOverlay.innerHTML = `
        <div class="result-card">
            <h1 class="bounce-in">${isDraw ? 'DRAW' : (isWinner ? 'VICTORY' : 'DEFEAT')}</h1>
            <p>${isDraw ? 'The Jar is split.' : (isWinner ? 'The Gold is yours!' : 'The Opponent took the Jar.')}</p>
            <div class="result-stats">
                <div class="stat">P1 Score: ${data.players.p1.score}</div>
                <div class="stat">P2 Score: ${data.players.p2.score}</div>
            </div>
            <button class="btn-primary" onclick="location.reload()">PLAY AGAIN</button>
        </div>
    `;
    elements.resultOverlay.classList.remove('hidden');
}

export function showLobbyWaiting(id) {
    const overlay = document.getElementById('overlay');
    if (overlay) {
        overlay.innerHTML = `
            <div class="lobby-card">
                <h2>ROOM ID: ${id}</h2>
                <div class="loader"></div>
                <p>Waiting for Player 2...</p>
                <small>Share this ID with your opponent</small>
            </div>
        `;
    }
}



/**
 * triggerShake
 * Provides visual feedback for invalid moves.
 * Applies the .reverting class to both origin and target tiles.
 */
export function triggerShake(origin, target) {
    const tiles = elements.grid1.children;
    const idx1 = origin.r * 8 + origin.c;
    const idx2 = target.r * 8 + target.c;
    const el1 = tiles[idx1];
    const el2 = tiles[idx2];

    if (el1) el1.classList.add('reverting');
    if (el2) el2.classList.add('reverting');

    setTimeout(() => {
        if (el1) el1.classList.remove('reverting');
        if (el2) el2.classList.remove('reverting');
    }, 400);
}

export function createParticles(tileElement) {
    const rect = tileElement.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    for (let i = 0; i < 6; i++) {
        const spark = document.createElement('div');
        spark.className = 'explosion-spark';
        
        // Random direction for the spark to fly
        const angle = Math.random() * Math.PI * 2;
        const distance = 40 + Math.random() * 60;
        const dx = Math.cos(angle) * distance + 'px';
        const dy = Math.sin(angle) * distance + 'px';

        spark.style.left = centerX + 'px';
        spark.style.top = centerY + 'px';
        spark.style.setProperty('--dx', dx);
        spark.style.setProperty('--dy', dy);

        document.body.appendChild(spark);

        // Remove the spark from the DOM after the animation finishes
        setTimeout(() => spark.remove(), 600);
    }
}


// Visual explosion Effect
export function triggerExplosionVFX(coords) {

    coords.forEach(({ r, c }) => {
        const tile = document.querySelector(`.tile[data-r="${r}"][data-c="${c}"]`);
        if (tile) {
            tile.classList.add('tile-explode');
            createParticles(tile); // <--- Add the "Juice" here!
        }
    });

}


//Screen Shake
export function triggerImpact(r, c) {
    if (elements.grid1) {
        elements.grid1.classList.add('shake-heavy');
        setTimeout(() => elements.grid1.classList.remove('shake-heavy'), 400);
    }

    const tile = document.querySelector(`.tile[data-r="${r}"][data-c="${c}"]`);
    if (tile) {
        const rect = tile.getBoundingClientRect();
        const glow = document.createElement('div');
        glow.className = 'explosion-glow';
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        Object.assign(glow.style, {
            position: 'fixed', left: `${centerX}px`, top: `${centerY}px`,
            transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: '1000'
        });
        document.body.appendChild(glow);
        setTimeout(() => glow.remove(), 500);
    }
}

export function showToast(msg) {
    if (!elements.toast) return;
    elements.toast.innerText = msg;
    elements.toast.classList.remove('hidden');
    elements.toast.classList.add('toast-show');

    clearTimeout(elements.toast._hideTimer);
    elements.toast._hideTimer = setTimeout(() => {
        elements.toast.classList.remove('toast-show');
        setTimeout(() => elements.toast.classList.add('hidden'), 220);
    }, 2000);
}


