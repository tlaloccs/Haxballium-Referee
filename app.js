/* =========================================================
   SILBATO — control de partido de HaxBall + Discord + Ligas
   ========================================================= */

const STORAGE_KEY = 'silbato_state_v1';

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function defaultState(){
  return {
    webhookUrl: '',
    settings: { halfMinutes: 5, updateIntervalSec: 5 },
    match: null,
    history: [],
    leagues: []
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultState(), parsed);
  }catch(e){
    console.error('No se pudo leer el estado guardado', e);
    return defaultState();
  }
}

function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){
    console.error('No se pudo guardar el estado', e);
  }
}

let state = loadState();
let currentMatch = state.match; // referencia directa al partido en curso (o null)
let tickHandle = null;
let discordLoopHandle = null;

/* ---------- utilidades de color / texto ---------- */

function readableTextColor(hex){
  if(!hex) return '#EAF2ED';
  const c = hex.replace('#','');
  const r = parseInt(c.substring(0,2),16), g = parseInt(c.substring(2,4),16), b = parseInt(c.substring(4,6),16);
  const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
  return luminance > 0.6 ? '#12181A' : '#F5FAF7';
}

function fmtClock(sec){
  const m = Math.floor(sec/60).toString().padStart(2,'0');
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

function halfLabel(match){
  if(match.status === 'finalizado') return 'FINAL';
  if(match.status === 'entretiempo') return 'ENTRETIEMPO';
  return match.half === 1 ? '1T' : '2T';
}

function minuteLabel(match){
  return Math.floor(match.elapsedSec/60) + 1;
}

function eventText(e){
  const who = e.team === 'A' ? currentMatch.teamA.name : currentMatch.teamB.name;
  const icons = { gol:'⚽ Gol', amarilla:'🟨 Amarilla', roja:'🟥 Roja', offside:'🚩 Offside' };
  return `${icons[e.t]} · ${who} · ${e.minute}' (${e.half}T)`;
}

/* =========================================================
   MOTOR DE PARTIDO
   ========================================================= */

function newMatchObject(teamAName, teamAColor, teamBName, teamBColor, leagueRef){
  return {
    id: uid(),
    createdAt: Date.now(),
    leagueRef: leagueRef || null,
    leagueLabel: leagueRef ? leagueRef.label : '',
    teamA: { name: teamAName || 'Rojo', color: teamAColor || '#E14B4B' },
    teamB: { name: teamBName || 'Azul', color: teamBColor || '#3B82C4' },
    scoreA: 0, scoreB: 0,
    cardsA: { y:0, r:0 }, cardsB: { y:0, r:0 },
    half: 1,
    status: 'espera', // espera | jugando | pausado | entretiempo | finalizado
    elapsedSec: 0,
    events: [],
    discordMessageId: null
  };
}

function crearPartido(teamAName, teamAColor, teamBName, teamBColor, leagueRef){
  currentMatch = newMatchObject(teamAName, teamAColor, teamBName, teamBColor, leagueRef);
  state.match = currentMatch;
  saveState();
  startTicker();
  startDiscordLoop();
  renderPartidoScreen();
  postToDiscord(); // primer envío, crea el mensaje
}

function iniciar(){
  if(!currentMatch) return;
  if(currentMatch.status === 'entretiempo'){
    currentMatch.half = 2;
    currentMatch.elapsedSec = 0;
  }
  if(currentMatch.status === 'espera' || currentMatch.status === 'pausado' || currentMatch.status === 'entretiempo'){
    currentMatch.status = 'jugando';
    saveState();
    renderPartidoScreen();
    postToDiscord();
  }
}

function pausar(){
  if(!currentMatch || currentMatch.status !== 'jugando') return;
  currentMatch.status = 'pausado';
  saveState();
  renderPartidoScreen();
  postToDiscord();
}

function medioTiempo(){
  if(!currentMatch) return;
  currentMatch.status = 'entretiempo';
  saveState();
  renderPartidoScreen();
  postToDiscord();
}

function terminarPartido(){
  if(!currentMatch) return;
  currentMatch.status = 'finalizado';
  postToDiscord();

  state.history.unshift(currentMatch);
  if(currentMatch.leagueRef){
    aplicarResultadoALiga(currentMatch.leagueRef, currentMatch.scoreA, currentMatch.scoreB);
  }

  currentMatch = null;
  state.match = null;
  stopTicker();
  stopDiscordLoop();
  saveState();
  renderPartidoScreen();
  renderHistorialScreen();
}

function registrarGol(team){
  if(!currentMatch) return;
  if(team === 'A') currentMatch.scoreA++; else currentMatch.scoreB++;
  currentMatch.events.push({ t:'gol', team, minute: minuteLabel(currentMatch), half: currentMatch.half });
  saveState();
  renderPartidoScreen();
  postToDiscord();
}

function registrarTarjeta(team, tipo){
  if(!currentMatch) return;
  const cards = team === 'A' ? currentMatch.cardsA : currentMatch.cardsB;
  cards[tipo === 'amarilla' ? 'y' : 'r']++;
  currentMatch.events.push({ t: tipo, team, minute: minuteLabel(currentMatch), half: currentMatch.half });
  saveState();
  renderPartidoScreen();
  postToDiscord();
}

function registrarOffside(team){
  if(!currentMatch) return;
  currentMatch.events.push({ t:'offside', team, minute: minuteLabel(currentMatch), half: currentMatch.half });
  saveState();
  renderPartidoScreen();
  postToDiscord();
}

function deshacerUltimoEvento(){
  if(!currentMatch || currentMatch.events.length === 0) return;
  const e = currentMatch.events.pop();
  if(e.t === 'gol'){
    if(e.team === 'A') currentMatch.scoreA = Math.max(0, currentMatch.scoreA-1);
    else currentMatch.scoreB = Math.max(0, currentMatch.scoreB-1);
  } else if(e.t === 'amarilla' || e.t === 'roja'){
    const cards = e.team === 'A' ? currentMatch.cardsA : currentMatch.cardsB;
    const key = e.t === 'amarilla' ? 'y' : 'r';
    cards[key] = Math.max(0, cards[key]-1);
  }
  saveState();
  renderPartidoScreen();
  postToDiscord();
}

/* ---------- timer ---------- */

function startTicker(){
  stopTicker();
  tickHandle = setInterval(() => {
    if(currentMatch && currentMatch.status === 'jugando'){
      currentMatch.elapsedSec++;
      saveState();
      updateClockDisplay();
      drawScoreboardToCanvas();
    }
  }, 1000);
}

function stopTicker(){
  if(tickHandle) clearInterval(tickHandle);
  tickHandle = null;
}

function startDiscordLoop(){
  stopDiscordLoop();
  const seconds = (state.settings.updateIntervalSec || 5);
  discordLoopHandle = setInterval(() => {
    if(currentMatch && currentMatch.status === 'jugando'){
      postToDiscord();
    }
  }, seconds * 1000);
}

function stopDiscordLoop(){
  if(discordLoopHandle) clearInterval(discordLoopHandle);
  discordLoopHandle = null;
}

/* =========================================================
   RENDER DEL MARCADOR (canvas -> imagen para Discord)
   ========================================================= */

function drawScoreboardToCanvas(){
  const canvas = document.getElementById('scoreboardCanvas');
  if(!canvas || !currentMatch) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const match = currentMatch;

  ctx.clearRect(0,0,W,H);

  // fondo
  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#0B1210');
  bg.addColorStop(1,'#0F1A15');
  ctx.fillStyle = bg;
  ctx.fillRect(0,0,W,H);

  // franja de estado arriba
  const statusColors = { espera:'#7E9389', jugando:'#2FBF71', pausado:'#E3A73B', entretiempo:'#E3A73B', finalizado:'#E14B4B' };
  ctx.fillStyle = statusColors[match.status] || '#7E9389';
  ctx.fillRect(0,0,W,10);

  // barras de equipo
  const barY = 70, barH = 92;
  ctx.fillStyle = match.teamA.color;
  ctx.fillRect(0, barY, W*0.42, barH);
  ctx.fillStyle = match.teamB.color;
  ctx.fillRect(W*0.58, barY, W*0.42, barH);

  // nombres de equipo
  ctx.font = '700 34px Oswald, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = readableTextColor(match.teamA.color);
  ctx.fillText(match.teamA.name.toUpperCase(), 26, barY + barH/2);
  ctx.textAlign = 'right';
  ctx.fillStyle = readableTextColor(match.teamB.color);
  ctx.fillText(match.teamB.name.toUpperCase(), W-26, barY + barH/2);

  // marcador central
  ctx.textAlign = 'center';
  ctx.fillStyle = '#EAF2ED';
  ctx.font = '800 92px Oswald, sans-serif';
  ctx.fillText(`${match.scoreA} - ${match.scoreB}`, W/2, barY + barH/2 + 4);

  // estado / reloj
  ctx.font = '600 24px Inter, sans-serif';
  ctx.fillStyle = '#B9C7BF';
  ctx.fillText(`${halfLabel(match)}  ·  ${fmtClock(match.elapsedSec)}`, W/2, barY + barH + 42);

  // tarjetas
  ctx.font = '600 20px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#B9C7BF';
  ctx.fillText(`🟨 ${match.cardsA.y}   🟥 ${match.cardsA.r}`, 26, barY + barH + 90);
  ctx.textAlign = 'right';
  ctx.fillText(`🟨 ${match.cardsB.y}   🟥 ${match.cardsB.r}`, W-26, barY + barH + 90);

  // liga (si aplica)
  if(match.leagueLabel){
    ctx.textAlign = 'left';
    ctx.font = '600 18px Inter, sans-serif';
    ctx.fillStyle = '#7E9389';
    ctx.fillText(match.leagueLabel, 26, H-22);
  }

  // últimos eventos
  const lastEvents = match.events.slice(-3).reverse();
  ctx.textAlign = 'center';
  ctx.font = '500 21px Inter, sans-serif';
  ctx.fillStyle = '#D7E4DD';
  lastEvents.forEach((e, i) => {
    ctx.fillText(eventText(e), W/2, H - 100 - i*30);
  });
}

/* =========================================================
   ENVÍO / EDICIÓN A DISCORD (webhook directo desde el navegador)
   ========================================================= */

let discordBusy = false;
let discordQueueRepeat = false;

function setDiscordStatus(status, text){
  const dot = document.getElementById('discordDot');
  const label = document.getElementById('discordStatusText');
  if(!dot || !label) return;
  dot.className = 'dot ' + status;
  label.textContent = text;
}

async function postToDiscord(){
  if(!currentMatch) return;
  if(!state.webhookUrl){
    setDiscordStatus('error', 'Falta configurar el webhook (pestaña Ajustes)');
    return;
  }
  if(discordBusy){
    discordQueueRepeat = true; // si ya hay un envío en curso, repetimos apenas termine
    return;
  }
  discordBusy = true;
  setDiscordStatus('sending', 'Enviando...');

  drawScoreboardToCanvas();
  const canvas = document.getElementById('scoreboardCanvas');

  try{
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ attachments: [] }));
    form.append('files[0]', blob, 'marcador.png');

    let res;
    if(currentMatch.discordMessageId){
      res = await fetch(`${state.webhookUrl}/messages/${currentMatch.discordMessageId}`, {
        method: 'PATCH', body: form
      });
    } else {
      res = await fetch(`${state.webhookUrl}?wait=true`, {
        method: 'POST', body: form
      });
    }

    if(!res.ok) throw new Error('Discord respondió ' + res.status);

    if(!currentMatch.discordMessageId){
      const data = await res.json();
      currentMatch.discordMessageId = data.id;
      saveState();
    }
    setDiscordStatus('ok', 'Actualizado en Discord');
  }catch(err){
    console.error(err);
    setDiscordStatus('error', 'Error al enviar: revisá el webhook o tu conexión');
  }finally{
    discordBusy = false;
    if(discordQueueRepeat){
      discordQueueRepeat = false;
      postToDiscord();
    }
  }
}

async function probarWebhook(){
  const hint = document.getElementById('webhookHint');
  if(!state.webhookUrl){
    hint.textContent = 'Pegá una URL de webhook primero.';
    return;
  }
  hint.textContent = 'Probando...';
  try{
    const res = await fetch(`${state.webhookUrl}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '✅ Silbato conectado correctamente.' })
    });
    if(!res.ok) throw new Error(res.status);
    hint.textContent = 'Conexión exitosa. Revisá tu canal de Discord.';
  }catch(err){
    console.error(err);
    hint.textContent = 'No se pudo conectar. Verificá que la URL sea correcta.';
  }
}

/* =========================================================
   LIGAS Y ELIMINATORIAS
   ========================================================= */

function newMatchSlot(teamAId, teamBId){
  return {
    id: uid(),
    teamA: teamAId || null,
    teamB: teamBId || null,
    scoreA: null, scoreB: null,
    played: false,
    winner: null // 'A' | 'B' | null
  };
}

function generarRoundRobin(teamIds){
  let ids = teamIds.slice();
  if(ids.length % 2 !== 0) ids.push(null); // bye
  const n = ids.length;
  const rounds = [];
  let arr = ids.slice();
  for(let r=0; r<n-1; r++){
    const roundMatches = [];
    for(let i=0; i<n/2; i++){
      const a = arr[i], b = arr[n-1-i];
      if(a !== null && b !== null){
        // alterna local/visitante según ronda para repartir partidos en casa
        roundMatches.push(r % 2 === 0 ? newMatchSlot(a,b) : newMatchSlot(b,a));
      }
    }
    rounds.push(roundMatches);
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr = [fixed, ...rest];
  }
  return rounds;
}

function generarBracket(teamIds){
  let size = 1;
  while(size < teamIds.length) size *= 2;
  const slots = teamIds.slice();
  // shuffle simple para sortear el bracket
  for(let i = slots.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  while(slots.length < size) slots.push(null); // bye

  const round1 = [];
  for(let i=0; i<size; i+=2){
    round1.push(newMatchSlot(slots[i], slots[i+1]));
  }
  const rounds = [round1];
  let count = size/2;
  while(count > 1){
    count = count/2;
    rounds.push(Array.from({length: count}, () => newMatchSlot(null,null)));
  }
  resolverByesBracket(rounds);
  return rounds;
}

// si un partido tiene un solo equipo (el otro es null/bye), avanza automático
function resolverByesBracket(rounds){
  for(let r=0; r<rounds.length; r++){
    rounds[r].forEach((m, idx) => {
      if(!m.played && (m.teamA === null) !== (m.teamB === null)){
        m.played = true;
        m.winner = m.teamA !== null ? 'A' : 'B';
        m.scoreA = m.teamA !== null ? 1 : 0;
        m.scoreB = m.teamB !== null ? 1 : 0;
        avanzarGanador(rounds, r, idx, m.winner === 'A' ? m.teamA : m.teamB);
      }
    });
  }
}

function avanzarGanador(rounds, roundIdx, matchIdx, teamId){
  if(roundIdx+1 >= rounds.length) return; // era la final
  const nextRound = rounds[roundIdx+1];
  const nextMatch = nextRound[Math.floor(matchIdx/2)];
  if(matchIdx % 2 === 0) nextMatch.teamA = teamId;
  else nextMatch.teamB = teamId;
  resolverByesBracket(rounds);
}

function crearLiga(nombre, formato, teams){
  const teamsWithId = teams.map(t => ({ id: uid(), name: t.name, color: t.color }));
  const ids = teamsWithId.map(t => t.id);
  const rounds = formato === 'liga' ? generarRoundRobin(ids) : generarBracket(ids);
  const liga = { id: uid(), name: nombre, format: formato, teams: teamsWithId, rounds };
  state.leagues.push(liga);
  saveState();
  return liga;
}

function getTeamById(liga, id){
  return liga.teams.find(t => t.id === id) || null;
}

function getStandings(liga){
  const table = {};
  liga.teams.forEach(t => { table[t.id] = { team: t, pj:0, pg:0, pe:0, pp:0, gf:0, gc:0, pts:0 }; });
  liga.rounds.flat().forEach(m => {
    if(!m.played || m.teamA === null || m.teamB === null) return;
    const a = table[m.teamA], b = table[m.teamB];
    if(!a || !b) return;
    a.pj++; b.pj++;
    a.gf += m.scoreA; a.gc += m.scoreB;
    b.gf += m.scoreB; b.gc += m.scoreA;
    if(m.scoreA > m.scoreB){ a.pg++; b.pp++; a.pts+=3; }
    else if(m.scoreA < m.scoreB){ b.pg++; a.pp++; b.pts+=3; }
    else { a.pe++; b.pe++; a.pts++; b.pts++; }
  });
  return Object.values(table).sort((x,y) => y.pts - x.pts || (y.gf-y.gc) - (x.gf-x.gc) || y.gf - x.gf);
}

function registrarResultadoLiga(ligaId, matchId, scoreA, scoreB){
  const liga = state.leagues.find(l => l.id === ligaId);
  if(!liga) return;
  let foundRoundIdx = -1, foundMatchIdx = -1, foundMatch = null;
  liga.rounds.forEach((round, rIdx) => {
    round.forEach((m, mIdx) => {
      if(m.id === matchId){ foundRoundIdx = rIdx; foundMatchIdx = mIdx; foundMatch = m; }
    });
  });
  if(!foundMatch) return;
  foundMatch.scoreA = scoreA;
  foundMatch.scoreB = scoreB;
  foundMatch.played = true;
  foundMatch.winner = scoreA === scoreB ? null : (scoreA > scoreB ? 'A' : 'B');

  if(liga.format === 'elim' && foundMatch.winner){
    const teamId = foundMatch.winner === 'A' ? foundMatch.teamA : foundMatch.teamB;
    avanzarGanador(liga.rounds, foundRoundIdx, foundMatchIdx, teamId);
  }
  saveState();
}

function aplicarResultadoALiga(leagueRef, scoreA, scoreB){
  registrarResultadoLiga(leagueRef.leagueId, leagueRef.matchId, scoreA, scoreB);
}

function jugarPartidoDeLiga(liga, match){
  const teamA = getTeamById(liga, match.teamA);
  const teamB = getTeamById(liga, match.teamB);
  if(!teamA || !teamB) return;
  const label = `${liga.name}`;
  crearPartido(teamA.name, teamA.color, teamB.name, teamB.color, { leagueId: liga.id, matchId: match.id, label });
  activarTab('partido');
}

/* =========================================================
   NAVEGACIÓN ENTRE PESTAÑAS
   ========================================================= */

function activarTab(tabName){
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.screen').forEach(scr => {
    scr.classList.toggle('active', scr.id === 'screen-' + tabName);
  });
}

/* =========================================================
   RENDER: PANTALLA PARTIDO
   ========================================================= */

function updateClockDisplay(){
  if(!currentMatch) return;
  document.getElementById('clockDisplay').textContent = fmtClock(currentMatch.elapsedSec);
  document.getElementById('halfBadge').textContent = halfLabel(currentMatch);
}

function renderPartidoScreen(){
  const setup = document.getElementById('setupMatch');
  const live = document.getElementById('liveMatch');

  if(!currentMatch){
    setup.classList.remove('hidden');
    live.classList.add('hidden');
    return;
  }

  setup.classList.add('hidden');
  live.classList.remove('hidden');

  updateClockDisplay();
  drawScoreboardToCanvas();

  const eventList = document.getElementById('eventList');
  eventList.innerHTML = '';
  currentMatch.events.slice().reverse().forEach(e => {
    const li = document.createElement('li');
    li.textContent = eventText(e);
    eventList.appendChild(li);
  });

  const disableStart = currentMatch.status === 'jugando' || currentMatch.status === 'finalizado';
  const disablePause = currentMatch.status !== 'jugando';
  const disableEnd = currentMatch.status === 'finalizado';

  document.getElementById('btnIniciar').disabled = disableStart;
  document.getElementById('btnPausar').disabled = disablePause;
  document.getElementById('btnMedioTiempo').disabled = currentMatch.status !== 'jugando' && currentMatch.status !== 'pausado';
  document.getElementById('btnTerminar').disabled = disableEnd;
}

/* =========================================================
   RENDER: PANTALLA HISTORIAL
   ========================================================= */

function renderHistorialScreen(){
  const cont = document.getElementById('historialList');
  cont.innerHTML = '';
  if(state.history.length === 0){
    cont.innerHTML = '<p class="hint">Todavía no hay partidos finalizados.</p>';
    return;
  }
  state.history.forEach(m => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const fecha = new Date(m.createdAt).toLocaleDateString();
    div.innerHTML = `
      <div>
        <div class="h-teams">${m.teamA.name} ${m.scoreA} - ${m.scoreB} ${m.teamB.name}</div>
        <div class="h-meta">${fecha}${m.leagueLabel ? ' · ' + m.leagueLabel : ''}</div>
      </div>
    `;
    cont.appendChild(div);
  });
}

/* =========================================================
   RENDER: PANTALLA LIGAS
   ========================================================= */

let ligaEquiposTemp = []; // equipos que se van agregando al crear una liga nueva
let ligaSeleccionadaId = null;
let ligaSubTab = 'fixture'; // 'fixture' | 'tabla'

function renderLigasScreen(){
  const listPanel = document.getElementById('ligasListPanel');
  const detallePanel = document.getElementById('ligaDetallePanel');
  const nuevaPanel = document.getElementById('nuevaLigaPanel');

  nuevaPanel.classList.add('hidden');

  if(ligaSeleccionadaId){
    listPanel.classList.add('hidden');
    detallePanel.classList.remove('hidden');
    renderLigaDetalle();
    return;
  }

  listPanel.classList.remove('hidden');
  detallePanel.classList.add('hidden');

  const cont = document.getElementById('ligasList');
  cont.innerHTML = '';
  if(state.leagues.length === 0){
    cont.innerHTML = '<p class="hint">Todavía no creaste ninguna liga. Tocá "+ Nueva liga" para empezar.</p>';
    return;
  }
  state.leagues.forEach(liga => {
    const div = document.createElement('div');
    div.className = 'liga-card';
    const totalMatches = liga.rounds.flat().length;
    const playedMatches = liga.rounds.flat().filter(m => m.played).length;
    div.innerHTML = `
      <div>
        <div class="liga-name">${liga.name}</div>
        <div class="liga-meta">${liga.format === 'liga' ? 'Liga' : 'Eliminatoria'} · ${liga.teams.length} equipos · ${playedMatches}/${totalMatches} partidos jugados</div>
      </div>
      <span>›</span>
    `;
    div.addEventListener('click', () => { ligaSeleccionadaId = liga.id; ligaSubTab = 'fixture'; renderLigasScreen(); });
    cont.appendChild(div);
  });
}

function renderLigaEquiposTemp(){
  const cont = document.getElementById('ligaEquiposList');
  cont.innerHTML = '';
  ligaEquiposTemp.forEach((t, idx) => {
    const row = document.createElement('div');
    row.className = 'liga-equipo-row';
    row.innerHTML = `
      <span class="swatch" style="background:${t.color}"></span>
      <span class="team-name">${t.name}</span>
      <button data-idx="${idx}">Quitar</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      ligaEquiposTemp.splice(idx,1);
      renderLigaEquiposTemp();
    });
    cont.appendChild(row);
  });
}

function renderLigaDetalle(){
  const liga = state.leagues.find(l => l.id === ligaSeleccionadaId);
  const panel = document.getElementById('ligaDetallePanel');
  if(!liga){ ligaSeleccionadaId = null; renderLigasScreen(); return; }

  let html = `
    <div class="panel-head">
      <h2>${liga.name}</h2>
      <button class="btn" id="btnVolverLigas">‹ Volver</button>
    </div>
  `;

  if(liga.format === 'liga'){
    html += `
      <div class="liga-tabs">
        <button class="liga-subtab ${ligaSubTab==='fixture'?'active':''}" data-sub="fixture">Fixture</button>
        <button class="liga-subtab ${ligaSubTab==='tabla'?'active':''}" data-sub="tabla">Tabla de posiciones</button>
      </div>
    `;
  }

  if(liga.format === 'liga' && ligaSubTab === 'tabla'){
    const standings = getStandings(liga);
    html += `
      <table class="standings">
        <thead><tr><th>Equipo</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th></tr></thead>
        <tbody>
          ${standings.map(s => `
            <tr>
              <td>${s.team.name}</td>
              <td>${s.pj}</td><td>${s.pg}</td><td>${s.pe}</td><td>${s.pp}</td>
              <td>${s.gf}</td><td>${s.gc}</td><td>${s.gf-s.gc}</td>
              <td><b>${s.pts}</b></td>
            </tr>`).join('')}
        </tbody>
      </table>
    `;
  } else if(liga.format === 'liga'){
    liga.rounds.forEach((round, rIdx) => {
      html += `<div class="fixture-round"><h4>Fecha ${rIdx+1}</h4>`;
      round.forEach(m => {
        html += renderFixtureMatchHtml(liga, m);
      });
      html += `</div>`;
    });
  } else {
    // eliminatoria: bracket
    html += `<div class="bracket">`;
    liga.rounds.forEach((round, rIdx) => {
      const title = rIdx === liga.rounds.length-1 ? 'Final'
        : rIdx === liga.rounds.length-2 ? 'Semifinal'
        : `Ronda ${rIdx+1}`;
      html += `<div class="bracket-round"><div class="bracket-round-title">${title}</div>`;
      round.forEach(m => {
        html += renderBracketMatchHtml(liga, m);
      });
      html += `</div>`;
    });
    html += `</div>`;
  }

  panel.innerHTML = html;

  panel.querySelector('#btnVolverLigas').addEventListener('click', () => { ligaSeleccionadaId = null; renderLigasScreen(); });
  panel.querySelectorAll('.liga-subtab').forEach(btn => {
    btn.addEventListener('click', () => { ligaSubTab = btn.dataset.sub; renderLigaDetalle(); });
  });

  wireFixtureAndBracketButtons(liga);
}

function renderFixtureMatchHtml(liga, m){
  const teamA = getTeamById(liga, m.teamA);
  const teamB = getTeamById(liga, m.teamB);
  if(!teamA || !teamB) return '';
  return `
    <div class="fixture-match" data-match="${m.id}">
      <span>${teamA.name} ${m.played ? `<b>${m.scoreA}</b>` : ''} vs ${m.played ? `<b>${m.scoreB}</b>` : ''} ${teamB.name}</span>
      <span class="f-actions">
        ${!m.played ? `
          <input type="number" class="f-score" data-side="A" min="0" value="0">
          <input type="number" class="f-score" data-side="B" min="0" value="0">
          <button class="btn btn-cargar-resultado" data-match="${m.id}">Cargar resultado</button>
          <button class="btn btn-primary btn-jugar-vivo" data-match="${m.id}">Jugar en vivo</button>
        ` : `<span class="hint" style="margin:0;">Jugado</span>`}
      </span>
    </div>
  `;
}

function renderBracketMatchHtml(liga, m){
  const teamA = m.teamA ? getTeamById(liga, m.teamA) : null;
  const teamB = m.teamB ? getTeamById(liga, m.teamB) : null;
  const nameA = teamA ? teamA.name : (m.teamA === null ? '—' : '?');
  const nameB = teamB ? teamB.name : (m.teamB === null ? '—' : '?');
  const canPlay = teamA && teamB && !m.played;
  return `
    <div class="bracket-match" data-match="${m.id}">
      <div class="b-team ${m.winner==='A' ? 'winner':''}">${nameA} ${m.played ? `<span>${m.scoreA}</span>` : ''}</div>
      <div class="b-team ${m.winner==='B' ? 'winner':''}">${nameB} ${m.played ? `<span>${m.scoreB}</span>` : ''}</div>
      ${canPlay ? `
        <div class="b-actions">
          <input type="number" class="f-score" data-side="A" min="0" value="0" style="width:36px;">
          <input type="number" class="f-score" data-side="B" min="0" value="0" style="width:36px;">
          <button class="btn btn-cargar-resultado" data-match="${m.id}">Cargar</button>
          <button class="btn btn-primary btn-jugar-vivo" data-match="${m.id}">En vivo</button>
        </div>
      ` : ''}
    </div>
  `;
}

function wireFixtureAndBracketButtons(liga){
  document.querySelectorAll('.btn-jugar-vivo').forEach(btn => {
    btn.addEventListener('click', () => {
      const matchId = btn.dataset.match;
      const match = liga.rounds.flat().find(m => m.id === matchId);
      if(match) jugarPartidoDeLiga(liga, match);
    });
  });
  document.querySelectorAll('.btn-cargar-resultado').forEach(btn => {
    btn.addEventListener('click', () => {
      const matchId = btn.dataset.match;
      const container = btn.closest('[data-match]');
      const inputA = container.querySelector('.f-score[data-side="A"]');
      const inputB = container.querySelector('.f-score[data-side="B"]');
      const scoreA = parseInt(inputA.value || '0', 10);
      const scoreB = parseInt(inputB.value || '0', 10);
      registrarResultadoLiga(liga.id, matchId, scoreA, scoreB);
      renderLigaDetalle();
      renderLigasScreen();
    });
  });
}

/* =========================================================
   EVENT LISTENERS / INIT
   ========================================================= */

function wireStaticListeners(){

  // Navegación
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => activarTab(btn.dataset.tab));
  });

  // Crear partido
  document.getElementById('btnCrearPartido').addEventListener('click', () => {
    const nameA = document.getElementById('teamAName').value.trim() || 'Rojo';
    const colorA = document.getElementById('teamAColor').value;
    const nameB = document.getElementById('teamBName').value.trim() || 'Azul';
    const colorB = document.getElementById('teamBColor').value;
    crearPartido(nameA, colorA, nameB, colorB, null);
  });

  // Controles de tiempo
  document.getElementById('btnIniciar').addEventListener('click', iniciar);
  document.getElementById('btnPausar').addEventListener('click', pausar);
  document.getElementById('btnMedioTiempo').addEventListener('click', medioTiempo);
  document.getElementById('btnTerminar').addEventListener('click', () => {
    if(confirm('¿Finalizar el partido? Esta acción no se puede deshacer.')) terminarPartido();
  });

  // Goles
  document.getElementById('btnGolA').addEventListener('click', () => registrarGol('A'));
  document.getElementById('btnGolB').addEventListener('click', () => registrarGol('B'));

  // Tarjetas / offside
  document.getElementById('btnAmarillaA').addEventListener('click', () => registrarTarjeta('A','amarilla'));
  document.getElementById('btnRojaA').addEventListener('click', () => registrarTarjeta('A','roja'));
  document.getElementById('btnOffsideA').addEventListener('click', () => registrarOffside('A'));
  document.getElementById('btnAmarillaB').addEventListener('click', () => registrarTarjeta('B','amarilla'));
  document.getElementById('btnRojaB').addEventListener('click', () => registrarTarjeta('B','roja'));
  document.getElementById('btnOffsideB').addEventListener('click', () => registrarOffside('B'));

  document.getElementById('btnDeshacer').addEventListener('click', deshacerUltimoEvento);

  // Ligas: crear nueva
  document.getElementById('btnNuevaLiga').addEventListener('click', () => {
    ligaEquiposTemp = [];
    document.getElementById('ligasListPanel').classList.add('hidden');
    document.getElementById('nuevaLigaPanel').classList.remove('hidden');
    document.getElementById('ligaNombre').value = '';
    renderLigaEquiposTemp();
  });

  document.getElementById('btnCancelarLiga').addEventListener('click', () => {
    document.getElementById('nuevaLigaPanel').classList.add('hidden');
    document.getElementById('ligasListPanel').classList.remove('hidden');
  });

  document.getElementById('btnAgregarEquipoLiga').addEventListener('click', () => {
    const nameInput = document.getElementById('ligaEquipoNombre');
    const colorInput = document.getElementById('ligaEquipoColor');
    const name = nameInput.value.trim();
    if(!name) return;
    ligaEquiposTemp.push({ name, color: colorInput.value });
    nameInput.value = '';
    renderLigaEquiposTemp();
  });

  document.getElementById('btnGenerarLiga').addEventListener('click', () => {
    const nombre = document.getElementById('ligaNombre').value.trim();
    const formato = document.querySelector('input[name="ligaFormato"]:checked').value;
    if(!nombre){ alert('Ponele un nombre a la liga.'); return; }
    if(ligaEquiposTemp.length < 2){ alert('Agregá al menos 2 equipos.'); return; }
    const liga = crearLiga(nombre, formato, ligaEquiposTemp);
    document.getElementById('nuevaLigaPanel').classList.add('hidden');
    ligaSeleccionadaId = liga.id;
    ligaSubTab = 'fixture';
    renderLigasScreen();
  });

  // Ajustes: webhook
  document.getElementById('btnGuardarWebhook').addEventListener('click', () => {
    state.webhookUrl = document.getElementById('webhookUrl').value.trim();
    saveState();
    document.getElementById('webhookHint').textContent = 'Guardado.';
  });
  document.getElementById('btnProbarWebhook').addEventListener('click', probarWebhook);

  // Ajustes: preferencias
  document.getElementById('btnGuardarAjustes').addEventListener('click', () => {
    state.settings.halfMinutes = parseInt(document.getElementById('halfMinutes').value, 10) || 5;
    state.settings.updateIntervalSec = parseInt(document.getElementById('updateIntervalSec').value, 10) || 5;
    saveState();
    startDiscordLoop(); // reinicia con el nuevo intervalo
    alert('Preferencias guardadas.');
  });
}

function initApp(){
  wireStaticListeners();

  // restaurar valores guardados en los inputs de Ajustes
  document.getElementById('webhookUrl').value = state.webhookUrl || '';
  document.getElementById('halfMinutes').value = state.settings.halfMinutes;
  document.getElementById('updateIntervalSec').value = state.settings.updateIntervalSec;

  renderPartidoScreen();
  renderHistorialScreen();
  renderLigasScreen();

  // si había un partido en curso al recargar la página, retomamos los loops
  if(currentMatch && currentMatch.status !== 'finalizado'){
    startTicker();
    startDiscordLoop();
  }
}

document.addEventListener('DOMContentLoaded', initApp);
