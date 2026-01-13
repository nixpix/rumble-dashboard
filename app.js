// const SUPABASE_URL = CONFIG.SUPABASE_URL;
// const SUPABASE_KEY = CONFIG.SUPABASE_KEY;

// --- STATE MANAGEMENT ---
// Stores the data for every card so we can re-sort it later
// Format: { "PlayerName": { "Spikes": {used:5, goals:1}, ... } }
let GLOBAL_PLAYER_STATS = {};
let GLOBAL_TEAM_STATS = {};

// Stores the current sort state for every card
// Format: { "PlayerName": { column: "used", direction: "desc" } }
let CARD_SORT_STATE = {};

// FIX: We rename this variable to 'db' to avoid conflict with the library name 'supabase'
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- MAIN FUNCTION ---
async function initDashboard() {
    console.log("Fetching data...");
    
    // 1. Fetch ALL data using 'db' instead of 'supabase'
    const [eventsReq, matchesReq] = await Promise.all([
        db.from('powerup_events').select('*'),
        db.from('match_results').select('*')
    ]);

    if (eventsReq.error || matchesReq.error) {
        console.error("Error fetching data:", eventsReq.error || matchesReq.error);
        alert("Error loading data! Check the console.");
        return;
    }

    const events = eventsReq.data;
    const matches = matchesReq.data;
    
    console.log("Data loaded:", { events, matches }); // Debug log to verify data

    // 2. Process & Display Data
    renderTopCards(events, matches);
    renderDuoTable(matches);
    renderCharts(events, matches);
}

// --- LOGIC: KPI CARDS ---
function renderTopCards(events, matches) {
    document.getElementById('total-matches').innerText = matches.length;
    document.getElementById('total-powerups').innerText = events.filter(e => e.event_type === 'Activation').length;
    
    const rumbleGoals = events.filter(e => e.event_type === 'Goal' && e.powerup_name !== 'None');
    document.getElementById('total-rumble-goals').innerText = rumbleGoals.length;

    // Calculate Average Delay
    const totalDelay = rumbleGoals.reduce((sum, e) => sum + (e.delay || 0), 0);
    const avgDelay = rumbleGoals.length ? (totalDelay / rumbleGoals.length).toFixed(2) : "0.00";
    document.getElementById('avg-delay').innerText = avgDelay + "s";
}

// --- LOGIC: DYNAMIC DUOS ---
function renderDuoTable(matches) {
    const teamsMap = {}; // Key: "PlayerA + PlayerB", Value: {wins, losses}

    matches.forEach(match => {
        // Helper to process a team
        const processTeam = (players, isWinner) => {
            if (!players || players.length === 0) return;
            
            // Sort names alphabetically so "Nix & Partner" is same as "Partner & Nix"
            const teamId = [...players].sort().join(" & ");
            
            if (!teamsMap[teamId]) teamsMap[teamId] = { wins: 0, losses: 0, games: 0 };
            
            teamsMap[teamId].games++;
            if (isWinner) teamsMap[teamId].wins++;
            else teamsMap[teamId].losses++;
        };

        // Process Blue (Team 0)
        processTeam(match.team0_players, match.winning_team === 0);
        // Process Orange (Team 1)
        processTeam(match.team1_players, match.winning_team === 1);
    });

    // Convert to Array & Sort by Games Played
    const sortedTeams = Object.entries(teamsMap)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.games - a.games);

    // Render HTML
    const tbody = document.getElementById('duo-table-body');
    if(sortedTeams.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">No match results yet</td></tr>`;
    } else {
        tbody.innerHTML = sortedTeams.map(t => {
            const winRate = ((t.wins / t.games) * 100).toFixed(0);
            const colorClass = winRate >= 50 ? 'text-green-400' : 'text-slate-400';
            
            return `
            <tr class="border-b border-slate-700/50 hover:bg-slate-700/30 transition">
                <td class="p-3 font-semibold text-white">${t.name}</td>
                <td class="p-3 text-center text-slate-300">${t.games}</td>
                <td class="p-3 text-center text-green-500">${t.wins}</td>
                <td class="p-3 text-center text-red-500">${t.losses}</td>
                <td class="p-3 text-right font-bold ${colorClass}">${winRate}%</td>
            </tr>`;
        }).join('');
    }
}

// --- LOGIC: CHARTS ---
// --- CONSTANTS ---
// Assign specific colors to powerups so they look the same in all charts
const POWERUP_COLORS = {
    "Kaktus": "#ef4444",      // Red
    "Nogica": "#f59e0b",    // Orange
    "Magnet": "#3b82f6",      // Blue
    "Saka": "#8b5cf6",    // Purple
    "Ventilator": "#10b981",     // Green
    "Plunger": "#ec4899",     // Pink
    "Betman": "#6366f1", // Indigo
    "Teleport": "#64748b",    // Slate
    "Freeze": "#06b6d4",     // Cyan
    "Sakica": "#8b5cf6",
    "Boost": "#f43f5e"
};
const DEFAULT_COLOR = "#94a3b8";

// --- LOGIC: CHARTS & VISUALS ---
// --- CONSTANTS ---

function renderCharts(events, matches) {
    // 1. Calculate Totals & Player Stats (Existing Logic)
    const totalUsage = {};
    const playerStats = {}; 

    events.forEach(e => {
        const pName = e.player_name;
        const pItem = e.powerup_name;

        if (!playerStats[pName]) playerStats[pName] = {};
        if (!playerStats[pName][pItem]) playerStats[pName][pItem] = { used: 0, goals: 0 };

        if (e.event_type === 'Activation') {
            totalUsage[pItem] = (totalUsage[pItem] || 0) + 1;
            playerStats[pName][pItem].used++;
        } 
        else if (e.event_type === 'Goal' && pItem !== 'None') {
            playerStats[pName][pItem].goals++;
        }
    });

    renderPowerupLeaderboard(totalUsage);
    renderPlayerCards(playerStats);
    renderFairnessChart(playerStats);
    renderTeamAnalytics(events, matches);
    renderTopScorers(events);
    renderRivalries(matches);
    
    renderTeamAnalytics(events, matches);
}

function renderPowerupLeaderboard(totals) {
    const container = document.getElementById('powerup-leaderboard');
    container.innerHTML = "";
    
    // Sort by usage
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const maxVal = sorted[0] ? sorted[0][1] : 1; 

    sorted.forEach(([name, count]) => {
        const color = POWERUP_COLORS[name] || DEFAULT_COLOR;
        const widthPct = (count / maxVal) * 100;
        const filename = name.toLowerCase().replace(/[^a-z0-9]/g, "") + ".webp"; // Strict filename cleaner

        const html = `
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 flex-shrink-0 bg-slate-700/50 rounded-lg p-1 border border-slate-600">
                <img src="assets/${filename}" alt="${name}" 
                     class="w-full h-full object-contain"
                     onerror="this.src='https://placehold.co/40?text=?'">
            </div>
            <div class="flex-1">
                <div class="flex justify-between text-sm mb-1">
                    <span class="font-bold text-slate-200">${name}</span>
                    <span class="font-mono text-slate-400">${count}</span>
                </div>
                <div class="w-full bg-slate-700/50 rounded-full h-2.5 overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-1000" 
                         style="width: ${widthPct}%; background-color: ${color}"></div>
                </div>
            </div>
        </div>`;
        container.innerHTML += html;
    });
}

function renderPlayerCards(stats) {
    const container = document.getElementById('player-grids');
    container.innerHTML = ""; 
    
    // 1. Save to Global State
    GLOBAL_PLAYER_STATS = stats;

    Object.keys(stats).sort().forEach((player, index) => {
        const safeName = player.replace(/[^a-zA-Z0-9]/g, '');
        const cardId = `player-${safeName}`;
        
        // Initialize Default Sort State (Used Descending)
        CARD_SORT_STATE[cardId] = { column: 'used', direction: 'desc' };

        // Calculate Totals for Header
        const items = stats[player];
        const totalU = Object.values(items).reduce((a,b)=>a+b.used,0);
        const totalG = Object.values(items).reduce((a,b)=>a+b.goals,0);

        // Generate Base HTML (Table Body is empty initially)
        const cardHtml = `
        <div class="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg flex flex-col h-full" id="${cardId}">
            <div class="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                <h3 class="text-xl font-bold text-white">${player}</h3>
                <div class="flex gap-4 text-sm">
                    <span class="text-rblue font-mono font-bold">Used: ${totalU}</span>
                    <span class="text-rorange font-mono font-bold">Goals: ${totalG}</span>
                </div>
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                <div>
                    <h4 class="text-xs uppercase tracking-widest text-slate-400 mb-2 text-center">Activations</h4>
                    <div class="h-48"><canvas id="chart-usage-${safeName}-${index}"></canvas></div>
                </div>
                <div>
                    <h4 class="text-xs uppercase tracking-widest text-slate-400 mb-2 text-center">Goals Scored</h4>
                    <div class="h-48"><canvas id="chart-goals-${safeName}-${index}"></canvas></div>
                </div>
            </div>

            <div class="mt-auto border-t border-slate-700 pt-4">
                <h4 class="text-xs uppercase tracking-widest text-slate-500 mb-3">Detailed Stats</h4>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="text-xs text-slate-500 uppercase cursor-pointer select-none">
                                <th class="pb-2 pl-2 font-normal hover:text-white transition" onclick="handleSort('${cardId}', 'name', 'player')">Powerup ↕</th>
                                <th class="pb-2 text-center font-normal hover:text-white transition" onclick="handleSort('${cardId}', 'used', 'player')">Used ↕</th>
                                <th class="pb-2 text-center font-normal hover:text-white transition" onclick="handleSort('${cardId}', 'goals', 'player')">Goals ↕</th>
                                <th class="pb-2 text-center font-normal hover:text-white transition" onclick="handleSort('${cardId}', 'conv', 'player')">Conv. ↕</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-${cardId}">
                            </tbody>
                    </table>
                </div>
            </div>
        </div>`;
        
        container.insertAdjacentHTML('beforeend', cardHtml);

        // Render Charts (Standard logic)
        const labels = Object.keys(items).sort((a,b) => items[b].used - items[a].used); // Default sort for charts
        const usageData = labels.map(i => items[i].used);
        const goalsData = labels.map(i => items[i].goals);
        const colors = labels.map(i => POWERUP_COLORS[i] || DEFAULT_COLOR);

        createMiniChart(`chart-usage-${safeName}-${index}`, labels, usageData, colors);
        createMiniChart(`chart-goals-${safeName}-${index}`, labels, goalsData, colors);

        // Initial Table Render
        renderTableBody(cardId, player, 'player');
    });
}

function createMiniChart(canvasId, labels, data, colors) {
    const ctx = document.getElementById(canvasId);
    if(!ctx) return;

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderRadius: 4,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }, 
            scales: {
                y: { 
                    beginAtZero: true, 
                    ticks: { color: '#64748b', precision: 0 }, 
                    grid: { color: '#334155' } 
                },
                x: { 
                    // UPDATED: Now set to true to show labels
                    ticks: { 
                        display: true, 
                        color: '#94a3b8', 
                        font: { size: 10 }, // Smaller font to fit
                        autoSkip: false,    // Don't hide labels if crowded
                        maxRotation: 90,    // Rotate vertically if needed
                        minRotation: 0
                    }, 
                    grid: { display: false } 
                }
            }
        }
    });
}

function renderFairnessChart(stats) {
    const ctx = document.getElementById('chart-fairness');
    if(!ctx) return;

    const players = Object.keys(stats).sort();
    const allPowerups = Object.keys(POWERUP_COLORS); // Get list of all known powerups

    // Prepare datasets (One per powerup, stacked)
    const datasets = allPowerups.map(pName => {
        return {
            label: pName,
            data: players.map(player => {
                const pStats = stats[player][pName];
                // Calculate percentage manually if you want, but Chart.js stacked handles raw numbers visually.
                // However, for true "fairness" comparison regardless of games played, 
                // we should normalize to 100%.
                
                const totalItems = Object.values(stats[player]).reduce((a, b) => a + b.used, 0);
                const count = pStats ? pStats.used : 0;
                
                // Return Percentage (0-100)
                return totalItems > 0 ? (count / totalItems) * 100 : 0;
            }),
            backgroundColor: POWERUP_COLORS[pName] || DEFAULT_COLOR,
            barPercentage: 0.6,
        };
    });

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: players,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { 
                    stacked: true, 
                    ticks: { color: '#cbd5e1' }, 
                    grid: { display: false } 
                },
                y: { 
                    stacked: true, 
                    max: 100, // Force 0-100% scale
                    ticks: { color: '#64748b', callback: (val) => val + '%' }, 
                    grid: { color: '#334155' },
                    title: { display: true, text: 'Distribution %', color: '#64748b' }
                }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.raw.toFixed(1) + '%';
                        }
                    }
                },
                legend: { display: false } // Legend is too big, better to rely on colors/tooltips
            }
        }
    });
}

// --- TEAM ANALYTICS LOGIC ---

function renderTeamAnalytics(events, matches) {
    // 1. Create a Lookup Map: GameID -> { 0: "PlayerA & PlayerB", 1: "PlayerC & PlayerD" }
    const gameToTeams = {};

    matches.forEach(m => {
        // Sort names to ensure consistency
        const team0 = (m.team0_players || []).sort().join(" & ") || "Unknown";
        const team1 = (m.team1_players || []).sort().join(" & ") || "Unknown";
        
        gameToTeams[m.game_id] = {
            0: team0,
            1: team1
        };
    });

    // 2. Aggregate Data by Dynamic Team Name
    const teamStats = {};

    events.forEach(e => {
        // Resolve the Team Name for this specific game event
        const gameMap = gameToTeams[e.game_id];
        
        // Skip if we can't find the match (orphaned event)
        if (!gameMap) return;

        const teamName = gameMap[e.team_num];
        const pItem = e.powerup_name;

        // Init stats object
        if (!teamStats[teamName]) teamStats[teamName] = {};
        if (!teamStats[teamName][pItem]) teamStats[teamName][pItem] = { used: 0, goals: 0 };

        if (e.event_type === 'Activation') {
            teamStats[teamName][pItem].used++;
        } 
        else if (e.event_type === 'Goal' && pItem !== 'None') {
            teamStats[teamName][pItem].goals++;
        }
    });

    // 3. Render Charts
    renderTeamFairnessChart(teamStats);
    renderTeamCards(teamStats);
}

function renderTeamFairnessChart(stats) {
    const ctx = document.getElementById('chart-team-fairness');
    if(!ctx) return;

    // Get all unique team names sorted
    const teams = Object.keys(stats).sort();
    const allPowerups = Object.keys(POWERUP_COLORS);

    const datasets = allPowerups.map(pName => {
        return {
            label: pName,
            data: teams.map(t => {
                const tStats = stats[t][pName];
                const totalItems = Object.values(stats[t]).reduce((a, b) => a + b.used, 0);
                const count = tStats ? tStats.used : 0;
                return totalItems > 0 ? (count / totalItems) * 100 : 0;
            }),
            backgroundColor: POWERUP_COLORS[pName] || DEFAULT_COLOR,
            barPercentage: 0.6,
        };
    });

    new Chart(ctx, {
        type: 'bar',
        data: { labels: teams, datasets: datasets },
        options: {
            indexAxis: 'y', 
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, max: 100, ticks: { color: '#64748b' }, grid: { color: '#334155' } },
                y: { stacked: true, ticks: { color: '#cbd5e1', font: { size: 11 } }, grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function renderTeamCards(stats) {
    const container = document.getElementById('team-grids');
    container.className = "grid grid-cols-1 gap-8"; 
    container.innerHTML = ""; 

    // 1. Save to Global State
    GLOBAL_TEAM_STATS = stats;

    Object.keys(stats).sort().forEach((teamName) => {
        const safeName = teamName.replace(/[^a-zA-Z0-9]/g, '');
        const cardId = `team-${safeName}`;

        // Initialize Default Sort State
        CARD_SORT_STATE[cardId] = { column: 'used', direction: 'desc' };

        const items = stats[teamName];
        const themeColor = "text-indigo-400";
        const borderColor = "border-indigo-500/30";
        
        const totalU = Object.values(items).reduce((a,b)=>a+b.used,0);
        const totalG = Object.values(items).reduce((a,b)=>a+b.goals,0);

        const cardHtml = `
        <div class="bg-slate-800 p-6 rounded-xl border ${borderColor} shadow-lg flex flex-col h-full" id="${cardId}">
            <div class="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                <h3 class="text-xl font-bold ${themeColor} flex items-center gap-2">
                    <span class="text-2xl">👥</span> ${teamName}
                </h3>
                <div class="flex gap-4 text-sm">
                    <span class="text-rblue font-mono font-bold">Used: ${totalU}</span>
                    <span class="text-rorange font-mono font-bold">Goals: ${totalG}</span>
                </div>
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
                <div class="h-48"><canvas id="chart-team-usage-${safeName}"></canvas></div>
                <div class="h-48"><canvas id="chart-team-goals-${safeName}"></canvas></div>
            </div>

            <div class="mt-auto border-t border-slate-700 pt-4">
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="text-xs text-slate-500 uppercase cursor-pointer select-none">
                                <th class="pb-2 pl-2 font-normal hover:text-white transition" onclick="handleSort('${cardId}', 'name', 'team')">Powerup ↕</th>
                                <th class="pb-2 text-center font-normal hover:text-white transition" onclick="handleSort('${cardId}', 'used', 'team')">Used ↕</th>
                                <th class="pb-2 text-center font-normal hover:text-white transition" onclick="handleSort('${cardId}', 'goals', 'team')">Goals ↕</th>
                                <th class="pb-2 text-center font-normal hover:text-white transition" onclick="handleSort('${cardId}', 'conv', 'team')">Conv. ↕</th>
                            </tr>
                        </thead>
                        <tbody id="tbody-${cardId}">
                            </tbody>
                    </table>
                </div>
            </div>
        </div>`;
        
        container.insertAdjacentHTML('beforeend', cardHtml);

        const labels = Object.keys(items).sort((a,b) => items[b].used - items[a].used);
        const usageData = labels.map(i => items[i].used);
        const goalsData = labels.map(i => items[i].goals);
        const colors = labels.map(i => POWERUP_COLORS[i] || DEFAULT_COLOR);

        createMiniChart(`chart-team-usage-${safeName}`, labels, usageData, colors);
        createMiniChart(`chart-team-goals-${safeName}`, labels, goalsData, colors);

        // Initial Table Render
        renderTableBody(cardId, teamName, 'team');
    });
}

// --- SORTING LOGIC ---

function handleSort(cardId, column, type) {
    // 1. Toggle Direction
    const currentState = CARD_SORT_STATE[cardId];
    if (currentState.column === column) {
        // Toggle asc/desc
        currentState.direction = currentState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        // New column, default to desc for numbers, asc for names
        currentState.column = column;
        currentState.direction = column === 'name' ? 'asc' : 'desc';
    }

    // 2. Identify the Entity Name from the ID (reverse engineering safeName is hard, so we loop)
    // A cleaner way is to look up the entity name in our state keys
    let entityName = "";
    
    if (type === 'player') {
        // Find which player matches this safe ID
        entityName = Object.keys(GLOBAL_PLAYER_STATS).find(name => 
            `player-${name.replace(/[^a-zA-Z0-9]/g, '')}` === cardId
        );
    } else {
        entityName = Object.keys(GLOBAL_TEAM_STATS).find(name => 
            `team-${name.replace(/[^a-zA-Z0-9]/g, '')}` === cardId
        );
    }

    if (entityName) {
        renderTableBody(cardId, entityName, type);
        updateSortIcons(cardId, column, currentState.direction);
    }
}

function renderTableBody(cardId, entityName, type) {
    const stats = type === 'player' ? GLOBAL_PLAYER_STATS[entityName] : GLOBAL_TEAM_STATS[entityName];
    const sortState = CARD_SORT_STATE[cardId];
    const tbody = document.getElementById(`tbody-${cardId}`);
    
    if (!tbody || !stats) return;

    // Convert to Array for sorting
    const rows = Object.entries(stats).map(([name, data]) => ({
        name: name,
        used: data.used,
        goals: data.goals,
        conv: data.used > 0 ? (data.goals / data.used) * 100 : 0
    }));

    // Sort
    rows.sort((a, b) => {
        let valA = a[sortState.column];
        let valB = b[sortState.column];
        
        // String comparison for names
        if (sortState.column === 'name') {
            return sortState.direction === 'asc' 
                ? valA.localeCompare(valB) 
                : valB.localeCompare(valA);
        }
        
        // Numeric comparison
        return sortState.direction === 'asc' ? valA - valB : valB - valA;
    });

    // Generate HTML
    tbody.innerHTML = rows.map(row => {
        const filename = row.name.toLowerCase().replace(/[^a-z0-9]/g, "") + ".webp";
        
        return `
        <tr class="border-b border-slate-700/50 hover:bg-slate-700/30 text-sm transition">
            <td class="py-2 pl-2 flex items-center gap-2">
                <img src="assets/${filename}" class="w-5 h-5 opacity-75" onerror="this.style.display='none'">
                <span class="text-slate-300">${row.name}</span>
            </td>
            <td class="text-center font-mono text-rblue">${row.used}</td>
            <td class="text-center font-mono text-rorange">${row.goals}</td>
            <td class="text-center font-mono text-slate-500 text-xs">${row.conv.toFixed(0)}%</td>
        </tr>`;
    }).join('');
}

function updateSortIcons(cardId, activeColumn, direction) {
    // Optional: Update the arrow icons in headers to show which is active
    // This is a nice-to-have visual polish
    const headers = document.querySelectorAll(`#${cardId} thead th`);
    headers.forEach((th, index) => {
        // Reset text
        const text = th.innerText.replace(/ ↑| ↓| ↕/g, ''); 
        
        // Map index to column key (Hardcoded order matches HTML)
        const keys = ['name', 'used', 'goals', 'conv'];
        
        if (keys[index] === activeColumn) {
            th.innerText = text + (direction === 'asc' ? ' ↑' : ' ↓');
            th.classList.add('text-white', 'font-bold'); // Highlight active
        } else {
            th.innerText = text + ' ↕';
            th.classList.remove('text-white', 'font-bold');
        }
    });
}

// --- NEW: TOP SCORERS LOGIC ---
function renderTopScorers(events) {
    const playerGoals = {};

    events.forEach(e => {
        if (e.event_type === 'Goal') {
            const pName = e.player_name;
            if (!playerGoals[pName]) playerGoals[pName] = { total: 0, rumble: 0 };
            
            playerGoals[pName].total++;
            if (e.powerup_name !== 'None') {
                playerGoals[pName].rumble++;
            }
        }
    });

    const sorted = Object.entries(playerGoals).sort((a, b) => b[1].total - a[1].total);

    document.getElementById('scorers-table-body').innerHTML = sorted.map(([name, stats]) => {
        const rumblePct = stats.total > 0 ? ((stats.rumble / stats.total) * 100).toFixed(0) : 0;
        
        return `
        <tr class="border-b border-slate-700/50 hover:bg-slate-700/30 transition">
            <td class="p-3 font-semibold text-white">${name}</td>
            <td class="p-3 text-center text-rorange font-mono text-lg">${stats.total}</td>
            <td class="p-3 text-right text-slate-400 font-mono">${rumblePct}%</td>
        </tr>`;
    }).join('');
}

// --- NEW: RIVALRY LOGIC ---
function renderRivalries(matches) {
    const rivalries = {};

    matches.forEach(m => {
        // 1. Get Team Names (Sorted alphabetically to ensure consistency)
        const t0Name = (m.team0_players || []).sort().join(" & ");
        const t1Name = (m.team1_players || []).sort().join(" & ");

        if (!t0Name || !t1Name) return;

        // 2. Create a unique Matchup ID that is consistent regardless of who is Team0/Team1
        // We sort the two team names: "A vs B" is the same as "B vs A"
        const [teamA, teamB] = [t0Name, t1Name].sort();
        const rivalryKey = `${teamA} vs ${teamB}`;

        if (!rivalries[rivalryKey]) {
            rivalries[rivalryKey] = { 
                teamA: teamA, 
                teamB: teamB, 
                winsA: 0, 
                winsB: 0, 
                games: 0 
            };
        }

        // 3. Update Stats
        rivalries[rivalryKey].games++;
        
        // Determine who won this specific match
        const winnerName = m.winning_team === 0 ? t0Name : t1Name;

        if (winnerName === teamA) rivalries[rivalryKey].winsA++;
        else rivalries[rivalryKey].winsB++;
    });

    // 4. Sort by Total Games Played
    const sorted = Object.values(rivalries).sort((a, b) => b.games - a.games);

    document.getElementById('rivalry-table-body').innerHTML = sorted.map(r => {
        // Highlight the leader
        const colorA = r.winsA > r.winsB ? "text-green-400 font-bold" : "text-slate-400";
        const colorB = r.winsB > r.winsA ? "text-green-400 font-bold" : "text-slate-400";

        return `
        <tr class="border-b border-slate-700/50 hover:bg-slate-700/30 transition">
            <td class="p-3 text-right ${colorA}">${r.teamA}</td>
            <td class="p-3 text-center">
                <span class="bg-slate-900 px-2 py-1 rounded text-white font-mono">
                    ${r.winsA} - ${r.winsB}
                </span>
            </td>
            <td class="p-3 text-left ${colorB}">${r.teamB}</td>
        </tr>`;
    }).join('');
}

// Start the app
initDashboard();