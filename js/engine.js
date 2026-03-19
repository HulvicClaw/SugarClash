let seed = Date.now();

export function setSeed(s) { seed = s; }

// Animation gate: used to keep data in sync with visuals
export let isAnimating = false;
export function setIsAnimating(v) { isAnimating = !!v; }

function mulberry32() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

/**
 * generateSeededGrid
 * Creates a board with NO starting matches.
 */
export function generateSeededGrid(rows = 8, cols = 8) {
    const grid = [];
    for (let r = 0; r < rows; r++) {
        grid[r] = [];
        for (let c = 0; c < cols; c++) {
            let type;
            do {
                type = Math.floor(mulberry32() * 5);
            } while (
                (c > 1 && grid[r][c - 1]?.type === type && grid[r][c - 2]?.type === type) ||
                (r > 1 && grid[r - 1][c]?.type === type && grid[r - 2][c]?.type === type)
            );
            grid[r][c] = { type, id: `init-${r}-${c}-${seed}` };
        }
    }
    return grid;
}

export function isAdjacent(p1, p2) {
    const dr = Math.abs(p1.r - p2.r);
    const dc = Math.abs(p1.c - p2.c);
    return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

/**
 * validateBotMove
 * Checks if a proposed swap results in at least one match.
 */
export function validateBotMove(grid, origin, target) {
    if (!origin || !target) return false;
    let cleanGrid = Array.isArray(grid) ? grid : Object.values(grid);
    cleanGrid = cleanGrid.map(row => Array.isArray(row) ? row : Object.values(row));

    const gridCopy = JSON.parse(JSON.stringify(cleanGrid));
    const candy1 = gridCopy[origin.r][origin.c];
    const candy2 = gridCopy[target.r][target.c];
    gridCopy[origin.r][origin.c] = candy2;
    gridCopy[target.r][target.c] = candy1;

    const { coords } = findMatches(gridCopy);
    return coords && coords.length > 0;
}

/**
 * getExplosionCoords
 * Returns array of {r, c} based on item type and center.
 * Bomb: 3x3 square
 * Dynamite: 5x5 square
 */
export function getExplosionCoords(type, r, c) {
    const coords = [];
    const radius = type === 'dynamite' ? 2 : 1; // 5x5 is radius 2, 3x3 is radius 1

    for (let i = r - radius; i <= r + radius; i++) {
        for (let j = c - radius; j <= c + radius; j++) {
            // Boundary checks for 8x8 grid
            if (i >= 0 && i < 8 && j >= 0 && j < 8) {
                coords.push({ r: i, c: j });
            }
        }
    }
    return coords;
}


/**
 * processExplosion
 * Phase 1: Just clears the tiles and calculates the immediate score.
 * Does NOT refill yet, allowing the UI to show the "holes" during animation.
 */
export function processExplosion(grid, coords) {
    isAnimating = true;
    let tilesDestroyed = 0;
    
    // Create a deep copy to avoid mutating state directly
    const workingGrid = JSON.parse(JSON.stringify(grid));

    // 1. Clear tiles at provided coordinates
    coords.forEach(pos => {
        // Double check bounds to prevent crashes
        if (workingGrid[pos.r] && workingGrid[pos.r][pos.c] !== null) {
            workingGrid[pos.r][pos.c] = null;
            tilesDestroyed++;
        }
    });

    // 2. Immediate score: 20 points per tile vaporized
    const explosionScore = tilesDestroyed * 20;

    return {
        grid: workingGrid, 
        explosionScore: explosionScore
    };
}


/**
 * calculateMaxLineLength
 * Helper for AI to evaluate move quality.
 */
function calculateMaxLineLength(grid, r1, c1, r2, c2) {
    let max = 0;
    const checkPositions = [{ r: r1, c: c1 }, { r: r2, c: c2 }];

    checkPositions.forEach(pos => {
        const type = (typeof grid[pos.r][pos.c] === 'object') ? grid[pos.r][pos.c]?.type : grid[pos.r][pos.c];
        if (type === null || type === undefined) return;

        let hCount = 1;
        for (let i = pos.c - 1; i >= 0 && ((typeof grid[pos.r][i] === 'object' ? grid[pos.r][i]?.type : grid[pos.r][i]) === type); i--) hCount++;
        for (let i = pos.c + 1; i < 8 && ((typeof grid[pos.r][i] === 'object' ? grid[pos.r][i]?.type : grid[pos.r][i]) === type); i++) hCount++;

        let vCount = 1;
        for (let i = pos.r - 1; i >= 0 && ((typeof grid[i][pos.c] === 'object' ? grid[i][pos.c]?.type : grid[i][pos.c]) === type); i--) vCount++;
        for (let i = pos.r + 1; i < 8 && ((typeof grid[i][pos.c] === 'object' ? grid[i][pos.c]?.type : grid[i][pos.c]) === type); i++) vCount++;

        max = Math.max(max, hCount, vCount);
    });
    return max;
}

export function findAllPossibleMoves(grid) {
    const moves = [];
    const rows = grid.length;
    const cols = grid[0].length;

    const checkSwap = (r1, c1, r2, c2) => {
        if (r2 < 0 || r2 >= rows || c2 < 0 || c2 >= cols) return;
        const tempGrid = JSON.parse(JSON.stringify(grid));
        const t1 = tempGrid[r1][c1];
        const t2 = tempGrid[r2][c2];
        if (!t1 || !t2) return;

        tempGrid[r1][c1] = t2;
        tempGrid[r2][c2] = t1;

        const { coords } = findMatches(tempGrid);
        if (coords.length > 0) {
            const bestLine = calculateMaxLineLength(tempGrid, r1, c1, r2, c2);
            moves.push({
                origin: { r: r1, c: c1 },
                target: { r: r2, c: c2 },
                matchLength: bestLine,
                totalCells: coords.length
            });
        }
    };

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            checkSwap(r, c, r, c + 1);
            checkSwap(r, c, r + 1, c);
        }
    }
    return moves;
}

export function pickBestMove(moves) {
    if (!moves || moves.length === 0) return null;
    const sorted = [...moves].sort((a, b) => {
        if (b.matchLength !== a.matchLength) return b.matchLength - a.matchLength;
        return b.totalCells - a.totalCells;
    });
    const highestMatchAvailable = sorted[0].matchLength;
    const topTierMoves = sorted.filter(m => m.matchLength === highestMatchAvailable);
    const randomIndex = Math.floor(Math.random() * topTierMoves.length);
    return topTierMoves[randomIndex];
}

export function processGridMatches(grid) {
    const rows = 8;
    const cols = 8;

    if (!Array.isArray(grid)) grid = Object.values(grid);
    grid.forEach((row, i) => {
        if (!Array.isArray(row)) grid[i] = Object.values(row);
    });

    let totalScore = 0;
    let bombRewards = 0;
    let dynamiteRewards = 0;
    
    const { coords, pendingRewards } = findMatches(grid);
    
    let hasHoles = false;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (grid[r][c] === null) {
                hasHoles = true;
                break;
            }
        }
    }

    if (coords.length === 0 && !hasHoles) {
        return { grid, totalScore: 0, rewards: { bomb: 0, dynamite: 0 } };
    }

    totalScore += coords.length;
    pendingRewards.forEach(type => {
        if (type === 'bomb') bombRewards++;
        if (type === 'dynamite') dynamiteRewards++;
    });

    coords.forEach(m => { grid[m.r][m.c] = null; });

    // Gravity and Refill
    for (let c = 0; c < cols; c++) {
        let writeIdx = rows - 1;
        for (let r = rows - 1; r >= 0; r--) {
            if (grid[r][c] !== null) {
                const temp = grid[r][c];
                grid[r][c] = null;
                grid[writeIdx][c] = temp;
                writeIdx--;
            }
        }
        for (let r = writeIdx; r >= 0; r--) {
            grid[r][c] = { 
                type: Math.floor(mulberry32() * 5), 
                id: `refill-${Math.random().toString(36).substr(2, 9)}`
            };
        }
    }

    const cascade = processGridMatches(grid);
    return {
        grid: cascade.grid,
        totalScore: totalScore + cascade.totalScore,
        rewards: {
            bomb: bombRewards + cascade.rewards.bomb,
            dynamite: dynamiteRewards + cascade.rewards.dynamite
        }
    };
}

export function findMatches(grid) {
    let coords = [];
    let pendingRewards = [];

    const getType = (tile) => {
        if (tile === null || tile === undefined) return null;
        return (typeof tile === 'object') ? tile.type : tile;
    };

    // Horizontal
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            let type = getType(grid[r][c]);
            if (type === null) continue;
            let matchRun = 1;
            while (c + matchRun < 8 && getType(grid[r][c + matchRun]) === type) matchRun++;
            if (matchRun >= 3) {
                if (matchRun === 4) pendingRewards.push('bomb');
                if (matchRun >= 5) pendingRewards.push('dynamite');
                for (let i = 0; i < matchRun; i++) coords.push({ r, c: c + i });
                c += matchRun - 1; 
            }
        }
    }

    // Vertical
    for (let c = 0; c < 8; c++) {
        for (let r = 0; r < 8; r++) {
            let type = getType(grid[r][c]);
            if (type === null) continue;
            let matchRun = 1;
            while (r + matchRun < 8 && getType(grid[r + matchRun][c]) === type) matchRun++;
            if (matchRun >= 3) {
                if (matchRun === 4) pendingRewards.push('bomb');
                if (matchRun >= 5) pendingRewards.push('dynamite');
                for (let i = 0; i < matchRun; i++) coords.push({ r: r + i, c });
                r += matchRun - 1; 
            }
        }
    }

    const uniqueCoords = coords.filter((v, i, a) => 
        a.findIndex(t => (t.r === v.r && t.c === v.c)) === i
    );
    return { coords: uniqueCoords, pendingRewards };
}


