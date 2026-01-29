const SUPABASE_URL = CONFIG.SUPABASE_URL;
const SUPABASE_KEY = CONFIG.SUPABASE_KEY;

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
    renderLastDayStats(events, matches);
    renderDuoTable(matches);
    renderCharts(events, matches);
}

// --- LOGIC: LAST DAY STATS ---
function renderLastDayStats(events, matches) {
    const section = document.getElementById('last-playday-section');
    if (matches.length === 0) {
        section.style.display = 'none';
        return;
    }

    // 1. Find and filter by the most recent day
    const lastMatchDateStr = matches.reduce((max, m) => m.created_at > max ? m.created_at : max, matches[0].created_at);
    const lastDay = new Date(lastMatchDateStr).toISOString().split('T')[0];
    
    const displayDate = new Date(lastDay).toLocaleDateString('en-GB');
    document.getElementById('last-playday-date').innerText = `(${displayDate})`;

    const lastDayMatches = matches.filter(m => new Date(m.created_at).toISOString().startsWith(lastDay));
    const lastDayMatchIds = new Set(lastDayMatches.map(m => m.game_id));
    const lastDayEvents = events.filter(e => lastDayMatchIds.has(e.game_id));

    // 2. Calculate stats for the last day
    const { totalUsage, playerStats } = calculatePowerupStats(lastDayEvents);
    const teamStats = calculateTeamStatsByEvent(lastDayEvents, lastDayMatches);

    // 3. Render all components for the last day section
    renderTopScorers('last-day-scorers-table-body', lastDayEvents);
    renderPowerupLeaderboard('last-day-powerup-leaderboard', totalUsage);
    renderFairnessChart('last-day-chart-fairness', playerStats);
    renderTeamFairnessChart('last-day-chart-team-fairness', teamStats);
}

// --- DATA CALCULATION LOGIC ---
function calculatePowerupStats(events) {
    const totalUsage = {};
    const playerStats = {};
    const allPlayers = [...new Set(events.map(e => e.player_name))];
    
    // Initialize for all players to ensure they appear in charts
    allPlayers.forEach(pName => {
        playerStats[pName] = {};
    });

    events.forEach(e => {
        const pName = e.player_name;
        const pItem = e.powerup_name;

        if (!playerStats[pName][pItem]) playerStats[pName][pItem] = { used: 0, goals: 0 };

        if (e.event_type === 'Activation') {
            totalUsage[pItem] = (totalUsage[pItem] || 0) + 1;
            playerStats[pName][pItem].used++;
        } else if (e.event_type === 'Goal' && pItem !== 'None') {
            playerStats[pName][pItem].goals++;
        }
    });
    return { totalUsage, playerStats };
}

function calculateTeamStatsByEvent(events, matches) {
    const gameToTeams = {};
    matches.forEach(m => {
        const team0 = (m.team0_players || []).sort().join(" & ") || "Unknown";
        const team1 = (m.team1_players || []).sort().join(" & ") || "Unknown";
        gameToTeams[m.game_id] = { 0: team0, 1: team1 };
    });

    const teamStats = {};
    const allTeams = [...new Set(Object.values(gameToTeams).flatMap(g => Object.values(g)))];
    
    // Initialize for all teams to ensure they appear
    allTeams.forEach(teamName => {
        if(teamName !== "Unknown") teamStats[teamName] = {};
    });

    events.forEach(e => {
        const gameMap = gameToTeams[e.game_id];
        if (!gameMap) return;

        const teamName = gameMap[e.team_num];
        if (teamName === "Unknown") return;

        const pItem = e.powerup_name;

        if (!teamStats[teamName][pItem]) teamStats[teamName][pItem] = { used: 0, goals: 0 };

        if (e.event_type === 'Activation') {
            teamStats[teamName][pItem].used++;
        } else if (e.event_type === 'Goal' && pItem !== 'None') {
            teamStats[teamName][pItem].goals++;
        }
    });
    return teamStats;
}


// --- LOGIC: DYNAMIC DUOS ---
function renderDuoTable(matches) {
    const teamsMap = {}; // Key: "PlayerA + PlayerB", Value: {wins, losses}

    matches.forEach(match => {
        const processTeam = (players, isWinner) => {
            if (!players || players.length === 0) return;
            const teamId = [...players].sort().join(" & ");
            if (!teamsMap[teamId]) teamsMap[teamId] = { wins: 0, losses: 0, games: 0 };
            
            teamsMap[teamId].games++;
            if (isWinner) teamsMap[teamId].wins++;
            else teamsMap[teamId].losses++;
        };
        processTeam(match.team0_players, match.winning_team === 0);
        processTeam(match.team1_players, match.winning_team === 1);
    });

    const sortedTeams = Object.entries(teamsMap)
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.games - a.games);

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

// --- CONSTANTS ---
const POWERUP_COLORS = {
    "Kaktus": "#ef4444", "Nogica": "#f59e0b", "Magnet": "#3b82f6", "Saka": "#8b5cf6",
    "Ventilator": "#10b981", "Plunger": "#ec4899", "Betman": "#6366f1", "Teleport": "#64748b",
    "Freeze": "#06b6d4", "Sakica": "#8b5cf6", "Boost": "#f43f5e"
};
const DEFAULT_COLOR = "#94a3b8";

// --- REUSABLE RENDERING LOGIC ---

function renderCharts(events, matches) {
    const { totalUsage, playerStats } = calculatePowerupStats(events);
    const teamStats = calculateTeamStatsByEvent(events, matches);

    renderPowerupLeaderboard('powerup-leaderboard', totalUsage);
    renderFairnessChart('chart-fairness', playerStats);
    renderTopScorers('scorers-table-body', events);
    
    // The main team fairness chart for lifetime stats
    renderTeamFairnessChart('chart-team-fairness', teamStats);
}

function renderPowerupLeaderboard(containerId, totals) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    
    const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    const maxVal = sorted[0] ? sorted[0][1] : 1; 

    sorted.forEach(([name, count]) => {
        const color = POWERUP_COLORS[name] || DEFAULT_COLOR;
        const widthPct = (count / maxVal) * 100;
        const filename = name.toLowerCase().replace(/[^a-z0-9]/g, "") + ".webp";

        const html = `
        <div class="flex items-center gap-3">
            <div class="w-10 h-10 flex-shrink-0 bg-slate-700/50 rounded-lg p-1 border border-slate-600">
                <img src="assets/${filename}" alt="${name}" class="w-full h-full object-contain" onerror="this.src='https://placehold.co/40?text=?'">
            </div>
            <div class="flex-1">
                <div class="flex justify-between text-sm mb-1">
                    <span class="font-bold text-slate-200">${name}</span>
                    <span class="font-mono text-slate-400">${count}</span>
                </div>
                <div class="w-full bg-slate-700/50 rounded-full h-2.5 overflow-hidden">
                    <div class="h-full rounded-full transition-all duration-1000" style="width: ${widthPct}%; background-color: ${color}"></div>
                </div>
            </div>
        </div>`;
        container.innerHTML += html;
    });
}

function renderFairnessChart(canvasId, stats) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const players = Object.keys(stats).sort();
    const allPowerups = Object.keys(POWERUP_COLORS);

    const datasets = allPowerups.map(pName => ({
        label: pName,
        data: players.map(player => {
            const pStats = stats[player][pName];
            const totalItems = Object.values(stats[player]).reduce((a, b) => a + b.used, 0);
            const count = pStats ? pStats.used : 0;
            return totalItems > 0 ? (count / totalItems) * 100 : 0;
        }),
        backgroundColor: POWERUP_COLORS[pName] || DEFAULT_COLOR,
        barPercentage: 0.6,
    }));

    new Chart(ctx, {
        type: 'bar',
        data: { labels: players, datasets: datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { stacked: true, ticks: { color: '#cbd5e1' }, grid: { display: false } },
                y: { stacked: true, max: 100, ticks: { color: '#64748b', callback: (val) => val + '%' }, grid: { color: '#334155' }, title: { display: true, text: 'Distribution %', color: '#64748b' } }
            },
            plugins: {
                tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw.toFixed(1)}%` } },
                legend: { display: false }
            }
        }
    });
}

function renderTeamFairnessChart(canvasId, stats) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const teams = Object.keys(stats).sort();
    const allPowerups = Object.keys(POWERUP_COLORS);

    const datasets = allPowerups.map(pName => ({
        label: pName,
        data: teams.map(t => {
            const tStats = stats[t][pName];
            const totalItems = Object.values(stats[t] || {}).reduce((a, b) => a + b.used, 0);
            const count = tStats ? tStats.used : 0;
            return totalItems > 0 ? (count / totalItems) * 100 : 0;
        }),
        backgroundColor: POWERUP_COLORS[pName] || DEFAULT_COLOR,
        barPercentage: 0.6,
    }));

    new Chart(ctx, {
        type: 'bar',
        data: { labels: teams, datasets: datasets },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            scales: {
                x: { stacked: true, max: 100, ticks: { color: '#64748b' }, grid: { color: '#334155' } },
                y: { stacked: true, ticks: { color: '#cbd5e1', font: { size: 11 } }, grid: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function renderTopScorers(tbodyId, events) {
    const playerStats = {};
    [...new Set(events.map(e => e.player_name))].forEach(p => {
        playerStats[p] = { total: 0, rumble: 0 };
    });

    events.forEach(e => {
        if (e.event_type === 'Goal') {
            playerStats[e.player_name].total++;
            if (e.powerup_name !== 'None') playerStats[e.player_name].rumble++;
        }
    });

    const sorted = Object.entries(playerStats).sort((a, b) => b[1].total - a[1].total);
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    tbody.innerHTML = sorted.map(([name, stats]) => {
        const rumblePct = stats.total > 0 ? ((stats.rumble / stats.total) * 100).toFixed(0) : 0;
        const scoreClass = stats.total === 0 ? "text-slate-600" : "text-rorange";
        return `
        <tr class="border-b border-slate-700/50 hover:bg-slate-700/30 transition">
            <td class="p-3 font-semibold text-white">${name}</td>
            <td class="p-3 text-center font-mono text-lg ${scoreClass}">${stats.total}</td>
            <td class="p-3 text-right text-slate-400 font-mono">${rumblePct}%</td>
        </tr>`;
    }).join('');
}

function renderRivalries(matches) {
    const rivalries = {};
    matches.forEach(m => {
        const t0Name = (m.team0_players || []).sort().join(" & ");
        const t1Name = (m.team1_players || []).sort().join(" & ");
        if (!t0Name || !t1Name) return;

        const [teamA, teamB] = [t0Name, t1Name].sort();
        const rivalryKey = `${teamA} vs ${teamB}`;
        if (!rivalries[rivalryKey]) {
            rivalries[rivalryKey] = { teamA, teamB, winsA: 0, winsB: 0, games: 0 };
        }
        rivalries[rivalryKey].games++;
        const winnerName = m.winning_team === 0 ? t0Name : t1Name;
        if (winnerName === teamA) rivalries[rivalryKey].winsA++;
        else rivalries[rivalryKey].winsB++;
    });

    const sorted = Object.values(rivalries).sort((a, b) => b.games - a.games);
    document.getElementById('rivalry-table-body').innerHTML = sorted.map(r => {
        const colorA = r.winsA > r.winsB ? "text-green-400 font-bold" : "text-slate-400";
        const colorB = r.winsB > r.winsA ? "text-green-400 font-bold" : "text-slate-400";
        return `
        <tr class="border-b border-slate-700/50 hover:bg-slate-700/30 transition">
            <td class="p-3 text-right ${colorA}">${r.teamA}</td>
            <td class="p-3 text-center"><span class="bg-slate-900 px-2 py-1 rounded text-white font-mono">${r.winsA} - ${r.winsB}</span></td>
            <td class="p-3 text-left ${colorB}">${r.teamB}</td>
        </tr>`;
    }).join('');
}

// --- TEAM & PLAYER CARDS (LIFETIME) ---

function renderTeamAnalytics(events, matches) {
    const teamStats = calculateTeamStatsByEvent(events, matches);
    renderTeamCards(teamStats);
}

function renderPlayerCards(stats) {
    const container = document.getElementById('player-grids');
    container.innerHTML = ""; 
    GLOBAL_PLAYER_STATS = stats;

    Object.keys(stats).sort().forEach((player, index) => {
        const safeName = player.replace(/[^a-zA-Z0-9]/g, '');
        const cardId = `player-${safeName}`;
        CARD_SORT_STATE[cardId] = { column: 'used', direction: 'desc' };

        const items = stats[player];
        const totalU = Object.values(items).reduce((a,b)=>a+b.used,0);
        const totalG = Object.values(items).reduce((a,b)=>a+b.goals,0);

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
                        <tbody id="tbody-${cardId}"></tbody>
                    </table>
                </div>
            </div>
        </div>`;
        container.insertAdjacentHTML('beforeend', cardHtml);

        const labels = Object.keys(items).sort((a,b) => items[b].used - items[a].used);
        const usageData = labels.map(i => items[i].used);
        const goalsData = labels.map(i => items[i].goals);
        createMiniChart(`chart-usage-${safeName}-${index}`, labels, usageData, labels.map(i => POWERUP_COLORS[i] || DEFAULT_COLOR));
        createMiniChart(`chart-goals-${safeName}-${index}`, labels, goalsData, labels.map(i => POWERUP_COLORS[i] || DEFAULT_COLOR));
        renderTableBody(cardId, player, 'player');
    });
}

function renderTeamCards(stats) {
    const container = document.getElementById('team-grids');
    container.innerHTML = ""; 
    GLOBAL_TEAM_STATS = stats;

    Object.keys(stats).sort().forEach((teamName) => {
        const safeName = teamName.replace(/[^a-zA-Z0-9]/g, '');
        const cardId = `team-${safeName}`;
        CARD_SORT_STATE[cardId] = { column: 'used', direction: 'desc' };

        const items = stats[teamName];
        const totalU = Object.values(items).reduce((a,b)=>a+b.used,0);
        const totalG = Object.values(items).reduce((a,b)=>a+b.goals,0);

        const cardHtml = `
        <div class="bg-slate-800 p-6 rounded-xl border border-indigo-500/30 shadow-lg flex flex-col h-full" id="${cardId}">
            <div class="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                <h3 class="text-xl font-bold text-indigo-400 flex items-center gap-2">👥 ${teamName}</h3>
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
                        <tbody id="tbody-${cardId}"></tbody>
                    </table>
                </div>
            </div>
        </div>`;
        container.insertAdjacentHTML('beforeend', cardHtml);

        const labels = Object.keys(items).sort((a,b) => items[b].used - items[a].used);
        createMiniChart(`chart-team-usage-${safeName}`, labels, labels.map(i => items[i].used), labels.map(i => POWERUP_COLORS[i] || DEFAULT_COLOR));
        createMiniChart(`chart-team-goals-${safeName}`, labels, labels.map(i => items[i].goals), labels.map(i => POWERUP_COLORS[i] || DEFAULT_COLOR));
        renderTableBody(cardId, teamName, 'team');
    });
}

function createMiniChart(canvasId, labels, data, colors) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    new Chart(ctx, {
        type: 'bar',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderRadius: 4 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#64748b', precision: 0 }, grid: { color: '#334155' } },
                x: { ticks: { display: true, color: '#94a3b8', font: { size: 10 }, autoSkip: false, maxRotation: 90, minRotation: 0 }, grid: { display: false } }
            }
        }
    });
}

// --- SORTING LOGIC ---
function handleSort(cardId, column, type) {
    const currentState = CARD_SORT_STATE[cardId];
    if (currentState.column === column) {
        currentState.direction = currentState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentState.column = column;
        currentState.direction = column === 'name' ? 'asc' : 'desc';
    }

    const stats = type === 'player' ? GLOBAL_PLAYER_STATS : GLOBAL_TEAM_STATS;
    const entityName = Object.keys(stats).find(name => cardId.includes(name.replace(/[^a-zA-Z0-9]/g, '')));
    
    if (entityName) {
        renderTableBody(cardId, entityName, type);
        updateSortIcons(cardId, column, currentState.direction);
    }
}

function renderTableBody(cardId, entityName, type) {
    const stats = type === 'player' ? GLOBAL_PLAYER_STATS[entityName] : GLOBAL_TEAM_STATS[entityName];
    const { column, direction } = CARD_SORT_STATE[cardId];
    const tbody = document.getElementById(`tbody-${cardId}`);
    if (!tbody || !stats) return;

    const rows = Object.entries(stats).map(([name, data]) => ({
        name, ...data, conv: data.used > 0 ? (data.goals / data.used) * 100 : 0
    }));

    rows.sort((a, b) => {
        const valA = a[column], valB = b[column];
        if (column === 'name') {
            return direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return direction === 'asc' ? valA - valB : valB - valA;
    });

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
    const headers = document.querySelectorAll(`#${cardId} thead th`);
    headers.forEach((th, index) => {
        const text = th.innerText.replace(/ ↑| ↓| ↕/g, '');
        const keys = ['name', 'used', 'goals', 'conv'];
        if (keys[index] === activeColumn) {
            th.innerText = `${text} ${direction === 'asc' ? '↑' : '↓'}`;
            th.classList.add('text-white', 'font-bold');
        } else {
            th.innerText = `${text} ↕`;
            th.classList.remove('text-white', 'font-bold');
        }
    });
}

// Start the app
initDashboard();