/* =========================================================
   HAXBALLIUM REFEREE — control de partido + Discord + Ligas
   v1.1
   ========================================================= */

const STORAGE_KEY = 'silbato_state_v1'; // se mantiene igual para no perder datos ya guardados

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

function defaultState(){
  return {
    webhooks: [],        // [{id, name, url}]
    settings: { halfMinutes: 5, updateIntervalSec: 5 },
    match: null,
    history: [],
    leagues: []
  };
}

function loadState(){
  let s;
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    s = raw ? Object.assign(defaultState(), JSON.parse(raw)) : defaultState();
  }catch(e){
    console.error('No se pudo leer el estado guardado', e);
    s = defaultState();
  }
  return migrarEstado(s);
}

// Compatibilidad con versiones viejas (v1.0) que tenian un solo webhookUrl suelto.
function migrarEstado(s){
  if(!Array.isArray(s.webhooks)) s.webhooks = [];
  if(s.webhookUrl && s.webhooks.length === 0){
    s.webhooks.push({ id: uid(), name: 'Principal', url: s.webhookUrl });
  }
  delete s.webhookUrl;
  return s;
}

function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){
    console.error('No se pudo guardar el estado', e);
  }
}

let state = loadState();
let currentMatch = state.match;
let tickHandle = null;
let discordLoopHandle = null;

/* ---------- utilidades ---------- */

function readableTextColor(hex){
  if(!hex) return '#EEF4F0';
  const c = hex.replace('#','');
  const r = parseInt(c.substring(0,2),16), g = parseInt(c.substring(2,4),16), b = parseInt(c.substring(4,6),16);
  const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
  return luminance > 0.6 ? '#0C1210' : '#F5FAF7';
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
  let label = icons[e.t] || e.t;
  if(e.doble) label = '🟨🟥 Doble amarilla';
  const jugador = e.player ? ` — ${e.player}` : '';
  return `${label}${jugador} · ${who} · ${e.minute}' (${e.half}T)`;
}

// Redimensiona una imagen subida por el usuario a un cuadrado chico (para no
// inflar el localStorage) y devuelve un dataURL en base64.
function resizeImageFile(file, maxSize){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize; canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side)/2, sy = (img.height - side)/2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function drawLogoCircle(ctx, dataUrl, cx, cy, r, onDone){
  if(!dataUrl) return;
  const img = imageCache[dataUrl] || (imageCache[dataUrl] = new Image());
  const draw = () => {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, cx-r, cy-r, r*2, r*2);
    ctx.restore();
    if(onDone) onDone();
  };
  if(img.complete && img.naturalWidth){ draw(); }
  else { img.onload = draw; img.src = dataUrl; }
}
const imageCache = {};

/* =========================================================
   WEBHOOKS (varios, uno por canal)
   ========================================================= */

function agregarWebhook(name, url){
  if(!name || !url) return;
  state.webhooks.push({ id: uid(), name, url });
  saveState();
}

function eliminarWebhook(id){
  state.webhooks = state.webhooks.filter(w => w.id !== id);
  saveState();
}

function getWebhookById(id){
  return state.webhooks.find(w => w.id === id) || null;
}

function poblarSelectWebhooks(selectEl, selectedId){
  selectEl.innerHTML = '';
  if(state.webhooks.length === 0){
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = 'No hay webhooks guardados (configuralos en Ajustes)';
    selectEl.appendChild(opt);
    return;
  }
  state.webhooks.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id; opt.textContent = w.name;
    if(w.id === selectedId) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

function renderWebhooksList(){
  const cont = document.getElementById('webhooksListContainer');
  if(!cont) return;
  cont.innerHTML = '';
  if(state.webhooks.length === 0){
    cont.innerHTML = '<p class="hint">Todavía no agregaste ningún webhook.</p>';
    return;
  }
  state.webhooks.forEach(w => {
    const row = document.createElement('div');
    row.className = 'liga-equipo-row';
    row.innerHTML = `
      <span class="team-name"><b>${w.name}</b> — ${w.url.slice(0,42)}...</span>
      <button class="btn" data-test="${w.id}" style="color:var(--turf-bright);border-color:var(--turf-dim);">Probar</button>
      <button data-del="${w.id}">Eliminar</button>
    `;
    row.querySelector('[data-test]').addEventListener('click', () => probarWebhook(w.id));
    row.querySelector('[data-del]').addEventListener('click', () => {
      if(confirm(`¿Eliminar el webhook "${w.name}"?`)){
        eliminarWebhook(w.id);
        renderWebhooksList();
        refrescarSelectsDeWebhook();
      }
    });
    cont.appendChild(row);
  });
}

function refrescarSelectsDeWebhook(){
  const matchSelect = document.getElementById('matchWebhookSelect');
  if(matchSelect) poblarSelectWebhooks(matchSelect, state.webhooks[0] ? state.webhooks[0].id : null);
  const ligaSelect = document.getElementById('ligaWebhookSelect');
  if(ligaSelect) poblarSelectWebhooks(ligaSelect, state.webhooks[0] ? state.webhooks[0].id : null);
}

/* =========================================================
   MOTOR DE PARTIDO
   ========================================================= */

function newMatchObject(teamA, teamB, leagueRef, webhookId){
  return {
    id: uid(),
    createdAt: Date.now(),
    leagueRef: leagueRef || null,
    leagueLabel: leagueRef ? leagueRef.label : '',
    webhookId: webhookId || null,
    teamA: { name: teamA.name || 'Rojo', color: teamA.color || '#E14B4B', logo: teamA.logo || null },
    teamB: { name: teamB.name || 'Azul', color: teamB.color || '#3B82C4', logo: teamB.logo || null },
    scoreA: 0, scoreB: 0,
    cardsA: { y:0, r:0 }, cardsB: { y:0, r:0 },
    half: 1,
    status: 'espera', // espera | jugando | pausado | entretiempo | finalizado
    elapsedSec: 0,
    events: [],
    discordMessageId: null
  };
}

function crearPartido(teamA, teamB, leagueRef, webhookId){
  currentMatch = newMatchObject(teamA, teamB, leagueRef, webhookId);
  state.match = currentMatch;
  saveState();
  startTicker();
  startDiscordLoop();
  renderPartidoScreen();
  postToDiscord();
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

function registrarGol(team, player){
  if(!currentMatch) return;
  if(team === 'A') currentMatch.scoreA++; else currentMatch.scoreB++;
  currentMatch.events.push({ t:'gol', team, minute: minuteLabel(currentMatch), half: currentMatch.half, player: player || null });
  saveState();
  renderPartidoScreen();
  postToDiscord();
}

function registrarTarjeta(team, tipo, player){
  if(!currentMatch) return;
  const cards = team === 'A' ? currentMatch.cardsA : currentMatch.cardsB;
  cards[tipo === 'amarilla' ? 'y' : 'r']++;
  const evento = { t: tipo, team, minute: minuteLabel(currentMatch), half: currentMatch.half, player: player || null };
  currentMatch.events.push(evento);

  // doble amarilla = roja automatica, solo se puede detectar si se cargo el nombre del jugador
  if(tipo === 'amarilla' && player){
    const amarillasDeEsteJugador = currentMatch.events.filter(e => e.t === 'amarilla' && e.team === team && e.player === player).length;
    if(amarillasDeEsteJugador >= 2){
      evento.doble = true;
      cards.r++;
      currentMatch.events.push({ t:'roja', team, minute: minuteLabel(currentMatch), half: currentMatch.half, player, porDobleAmarilla: true });
    }
  }

  saveState();
  renderPartidoScreen();
  postToDiscord();
}

function registrarOffside(team, player){
  if(!currentMatch) return;
  currentMatch.events.push({ t:'offside', team, minute: minuteLabel(currentMatch), half: currentMatch.half, player: player || null });
  saveState();
  renderPartidoScreen();
  postToDiscord();
}

function deshacerUltimoEvento(){
  if(!currentMatch || currentMatch.events.length === 0) return;
  let e = currentMatch.events.pop();
  // si el ultimo evento era una roja automatica por doble amarilla, deshacemos las dos juntas
  if(e.porDobleAmarilla){
    const cardsR = e.team === 'A' ? currentMatch.cardsA : currentMatch.cardsB;
    cardsR.r = Math.max(0, cardsR.r-1);
    e = currentMatch.events.pop(); // la amarilla que la disparó
    if(e) e.doble = false;
  }
  if(e){
    if(e.t === 'gol'){
      if(e.team === 'A') currentMatch.scoreA = Math.max(0, currentMatch.scoreA-1);
      else currentMatch.scoreB = Math.max(0, currentMatch.scoreB-1);
    } else if(e.t === 'amarilla' || e.t === 'roja'){
      const cards = e.team === 'A' ? currentMatch.cardsA : currentMatch.cardsB;
      const key = e.t === 'amarilla' ? 'y' : 'r';
      cards[key] = Math.max(0, cards[key]-1);
    }
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

  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#0A0F0D');
  bg.addColorStop(1,'#0E1613');
  ctx.fillStyle = bg;
  ctx.fillRect(0,0,W,H);

  const statusColors = { espera:'#83988A', jugando:'#2FBF71', pausado:'#E3A73B', entretiempo:'#E3A73B', finalizado:'#E14B4B' };
  ctx.fillStyle = statusColors[match.status] || '#83988A';
  ctx.fillRect(0,0,W,10);

  const barY = 70, barH = 92;
  ctx.fillStyle = match.teamA.color;
  ctx.fillRect(0, barY, W*0.42, barH);
  ctx.fillStyle = match.teamB.color;
  ctx.fillRect(W*0.58, barY, W*0.42, barH);

  const hasLogoA = !!match.teamA.logo, hasLogoB = !!match.teamB.logo;
  const textOffsetA = hasLogoA ? 84 : 26;
  const textOffsetB = hasLogoB ? 84 : 26;

  ctx.font = '700 34px Oswald, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = readableTextColor(match.teamA.color);
  ctx.fillText(match.teamA.name.toUpperCase(), textOffsetA, barY + barH/2);
  ctx.textAlign = 'right';
  ctx.fillStyle = readableTextColor(match.teamB.color);
  ctx.fillText(match.teamB.name.toUpperCase(), W-textOffsetB, barY + barH/2);

  if(hasLogoA) drawLogoCircle(ctx, match.teamA.logo, 52, barY+barH/2, 30, drawScoreboardToCanvas);
  if(hasLogoB) drawLogoCircle(ctx, match.teamB.logo, W-52, barY+barH/2, 30, drawScoreboardToCanvas);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#EEF4F0';
  ctx.font = '800 92px Oswald, sans-serif';
  ctx.fillText(`${match.scoreA} - ${match.scoreB}`, W/2, barY + barH/2 + 4);

  ctx.font = '600 24px Inter, sans-serif';
  ctx.fillStyle = '#B9C7BF';
  ctx.fillText(`${halfLabel(match)}  ·  ${fmtClock(match.elapsedSec)}`, W/2, barY + barH + 42);

  ctx.font = '600 20px Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#B9C7BF';
  ctx.fillText(`🟨 ${match.cardsA.y}   🟥 ${match.cardsA.r}`, 26, barY + barH + 90);
  ctx.textAlign = 'right';
  ctx.fillText(`🟨 ${match.cardsB.y}   🟥 ${match.cardsB.r}`, W-26, barY + barH + 90);

  if(match.leagueLabel){
    ctx.textAlign = 'left';
    ctx.font = '600 18px Inter, sans-serif';
    ctx.fillStyle = '#83988A';
    ctx.fillText(match.leagueLabel, 26, H-22);
  }

  const lastEvents = match.events.slice(-3).reverse();
  ctx.textAlign = 'center';
  ctx.font = '500 21px Inter, sans-serif';
  ctx.fillStyle = '#D7E4DD';
  lastEvents.forEach((e, i) => {
    ctx.fillText(eventText(e), W/2, H - 100 - i*30);
  });
}

/* =========================================================
   ENVÍO / EDICIÓN A DISCORD
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
  const webhook = getWebhookById(currentMatch.webhookId);
  if(!webhook){
    setDiscordStatus('error', 'Este partido no tiene un webhook asignado (Ajustes)');
    return;
  }
  if(discordBusy){
    discordQueueRepeat = true;
    return;
  }
  discordBusy = true;
  setDiscordStatus('sending', `Enviando a "${webhook.name}"...`);

  drawScoreboardToCanvas();
  const canvas = document.getElementById('scoreboardCanvas');

  try{
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ attachments: [] }));
    form.append('files[0]', blob, 'marcador.png');

    let res;
    if(currentMatch.discordMessageId){
      res = await fetch(`${webhook.url}/messages/${currentMatch.discordMessageId}`, { method:'PATCH', body: form });
    } else {
      res = await fetch(`${webhook.url}?wait=true`, { method:'POST', body: form });
    }
    if(!res.ok) throw new Error('Discord respondió ' + res.status);

    if(!currentMatch.discordMessageId){
      const data = await res.json();
      currentMatch.discordMessageId = data.id;
      saveState();
    }
    setDiscordStatus('ok', `Actualizado en "${webhook.name}"`);
  }catch(err){
    console.error(err);
    setDiscordStatus('error', 'Error al enviar: revisá el webhook o tu conexión');
  }finally{
    discordBusy = false;
    if(discordQueueRepeat){ discordQueueRepeat = false; postToDiscord(); }
  }
}

async function probarWebhook(webhookId){
  const hint = document.getElementById('webhookHint');
  const webhook = getWebhookById(webhookId);
  if(!webhook){ hint.textContent = 'Webhook no encontrado.'; return; }
  hint.textContent = `Probando "${webhook.name}"...`;
  try{
    const res = await fetch(`${webhook.url}?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `✅ Haxballium Referee conectado (${webhook.name}).` })
    });
    if(!res.ok) throw new Error(res.status);
    hint.textContent = `Conexión exitosa con "${webhook.name}". Revisá tu canal de Discord.`;
  }catch(err){
    console.error(err);
    hint.textContent = `No se pudo conectar "${webhook.name}". Verificá la URL.`;
  }
}

/* =========================================================
   LIGAS: equipos, planteles, grupos, etiquetas
   ========================================================= */

function newMatchSlot(teamAId, teamBId){
  return { id: uid(), teamA: teamAId || null, teamB: teamBId || null, scoreA: null, scoreB: null, played:false, winner:null };
}

function nuevoJugador(name){
  return { id: uid(), name, goals:0, assists:0, yellow:0, red:0 };
}

function getTeamById(liga, id){
  return liga.teams.find(t => t.id === id) || null;
}

// Rellena campos que puedan faltar en ligas creadas con versiones viejas de la app,
// para que nunca rompa al leer datos guardados anteriormente.
function asegurarDefaultsLiga(liga){
  if(!Array.isArray(liga.teams)) liga.teams = [];
  liga.teams.forEach(t => {
    if(!('logo' in t)) t.logo = null;
    if(!Array.isArray(t.players)) t.players = [];
  });
  if(liga.format === 'liga'){
    if(!Array.isArray(liga.groups)){
      // liga vieja: tenia liga.rounds plano -> lo envolvemos en un unico grupo
      liga.groups = [{ id: uid(), name:'Grupo 1', teamIds: liga.teams.map(t=>t.id), rounds: liga.rounds || [], tags:[], positionTags:{} }];
      delete liga.rounds;
    }
    liga.groups.forEach(g => {
      if(!Array.isArray(g.tags)) g.tags = [];
      if(!g.positionTags || typeof g.positionTags !== 'object') g.positionTags = {};
    });
    if(!liga.groupCount) liga.groupCount = liga.groups.length;
  }
  if(liga.format === 'doble_elim'){
    if(!liga.lbRounds) liga.lbRounds = [];
    if(!liga.lbMeta) liga.lbMeta = [];
    if(!liga.grandFinal) liga.grandFinal = [newMatchSlot(null,null)];
  }
  return liga;
}

/* ---------- round robin (liga, por grupo) ---------- */

function generarRoundRobin(teamIds){
  let ids = teamIds.slice();
  if(ids.length % 2 !== 0) ids.push(null);
  const n = ids.length;
  const rounds = [];
  let arr = ids.slice();
  for(let r=0; r<n-1; r++){
    const roundMatches = [];
    for(let i=0; i<n/2; i++){
      const a = arr[i], b = arr[n-1-i];
      if(a !== null && b !== null){
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

function getGroupStandings(liga, group){
  const table = {};
  group.teamIds.forEach(id => {
    const t = getTeamById(liga, id);
    if(t) table[id] = { team:t, pj:0, pg:0, pe:0, pp:0, gf:0, gc:0, pts:0 };
  });
  group.rounds.flat().forEach(m => {
    if(!m.played || m.teamA===null || m.teamB===null) return;
    const a = table[m.teamA], b = table[m.teamB];
    if(!a || !b) return;
    a.pj++; b.pj++;
    a.gf += m.scoreA; a.gc += m.scoreB;
    b.gf += m.scoreB; b.gc += m.scoreA;
    if(m.scoreA > m.scoreB){ a.pg++; b.pp++; a.pts+=3; }
    else if(m.scoreA < m.scoreB){ b.pg++; a.pp++; b.pts+=3; }
    else{ a.pe++; b.pe++; a.pts++; b.pts++; }
  });
  return Object.values(table).sort((x,y) => y.pts-x.pts || (y.gf-y.gc)-(x.gf-x.gc) || y.gf-x.gf);
}

/* ---------- eliminacion simple (con manejo de byes) ---------- */

function generarBracket(teamIds){
  let size = 1;
  while(size < teamIds.length) size *= 2;
  const slots = teamIds.slice();
  for(let i=slots.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [slots[i],slots[j]]=[slots[j],slots[i]]; }
  while(slots.length < size) slots.push(null);

  const round1 = [];
  for(let i=0;i<size;i+=2) round1.push(newMatchSlot(slots[i], slots[i+1]));
  const rounds = [round1];
  let count = size/2;
  while(count > 1){ count/=2; rounds.push(Array.from({length:count}, () => newMatchSlot(null,null))); }
  return rounds;
}

function avanzarGanadorSimple(rounds, roundIdx, matchIdx, teamId){
  if(roundIdx+1 >= rounds.length) return;
  const nextMatch = rounds[roundIdx+1][Math.floor(matchIdx/2)];
  if(matchIdx % 2 === 0) nextMatch.teamA = teamId; else nextMatch.teamB = teamId;
}

// Recorre todo el cuadro y resuelve automaticamente cualquier partido que haya quedado
// con un solo equipo real (bye), hasta que no queden mas para resolver.
function resolverByesSimple(rounds){
  let changed = true;
  while(changed){
    changed = false;
    rounds.forEach((round, rIdx) => {
      round.forEach((m, mIdx) => {
        if(!m.played && (m.teamA===null) !== (m.teamB===null)){
          m.played = true;
          m.winner = m.teamA!==null ? 'A' : 'B';
          m.scoreA = m.teamA!==null ? 1 : 0;
          m.scoreB = m.teamB!==null ? 1 : 0;
          avanzarGanadorSimple(rounds, rIdx, mIdx, m.winner==='A' ? m.teamA : m.teamB);
          changed = true;
        }
      });
    });
  }
}

/* ---------- doble eliminacion ---------- */

function generarDobleElim(teamIds){
  let size = 1;
  while(size < teamIds.length) size *= 2;
  const slots = teamIds.slice();
  for(let i=slots.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [slots[i],slots[j]]=[slots[j],slots[i]]; }
  while(slots.length < size) slots.push(null);

  const wbRounds = [];
  const round0 = [];
  for(let i=0;i<size;i+=2) round0.push(newMatchSlot(slots[i], slots[i+1]));
  wbRounds.push(round0);
  let c = size/2;
  while(c > 1){ c/=2; wbRounds.push(Array.from({length:c}, () => newMatchSlot(null,null))); }
  const r = wbRounds.length;

  const lbRounds = [];
  const lbMeta = [];

  if(r >= 2){
    const consume0Count = Math.max(wbRounds[0].length/2, 1);
    lbRounds.push(Array.from({length: consume0Count}, () => newMatchSlot(null,null)));
    lbMeta.push({ kind:'consume0', wbRoundIdx:0 });

    let prevIdx = 0;
    for(let i=1;i<r;i++){
      const majorCount = wbRounds[i].length;
      lbRounds.push(Array.from({length: majorCount}, () => newMatchSlot(null,null)));
      lbMeta.push({ kind:'major', wbRoundIdx:i, prevRoundIdx: prevIdx });
      const majorIdx = lbRounds.length-1;
      prevIdx = majorIdx;
      if(i !== r-1){
        const pureCount = majorCount/2;
        lbRounds.push(Array.from({length: pureCount}, () => newMatchSlot(null,null)));
        lbMeta.push({ kind:'pure', prevRoundIdx: majorIdx });
        prevIdx = lbRounds.length-1;
      }
    }
  }

  const liga = { wbRounds, lbRounds, lbMeta, grandFinal: [newMatchSlot(null,null)] };
  resolverByesDobleElim(liga);
  return liga;
}

function avanzarGanadorWB(liga, roundIdx, matchIdx, winnerId, loserId){
  const { wbRounds, lbRounds, lbMeta, grandFinal } = liga;
  if(roundIdx+1 < wbRounds.length){
    const next = wbRounds[roundIdx+1][Math.floor(matchIdx/2)];
    if(matchIdx % 2 === 0) next.teamA = winnerId; else next.teamB = winnerId;
  } else {
    grandFinal[0].teamA = winnerId; // campeon de winners
  }
  if(loserId === null) return; // era un bye, no hay perdedor real
  const metaIdx = lbMeta.findIndex(m => (m.kind==='consume0'||m.kind==='major') && m.wbRoundIdx === roundIdx);
  if(metaIdx === -1) return;
  const meta = lbMeta[metaIdx];
  if(meta.kind === 'consume0'){
    const targetIdx = Math.floor(matchIdx/2);
    const side = matchIdx % 2 === 0 ? 'teamA' : 'teamB';
    lbRounds[metaIdx][targetIdx][side] = loserId;
  } else {
    lbRounds[metaIdx][matchIdx].teamB = loserId;
  }
}

function avanzarGanadorLB(liga, roundIdx, matchIdx, winnerId){
  const { lbRounds, lbMeta, grandFinal } = liga;
  const nextIdx = lbMeta.findIndex(m => m.prevRoundIdx === roundIdx);
  if(nextIdx === -1){
    grandFinal[0].teamB = winnerId; // campeon de losers
    return;
  }
  const meta = lbMeta[nextIdx];
  if(meta.kind === 'pure'){
    const targetIdx = Math.floor(matchIdx/2);
    const side = matchIdx % 2 === 0 ? 'teamA' : 'teamB';
    lbRounds[nextIdx][targetIdx][side] = winnerId;
  } else { // major
    lbRounds[nextIdx][matchIdx].teamA = winnerId;
  }
}

function resolverByesDobleElim(liga){
  let changed = true;
  while(changed){
    changed = false;
    liga.wbRounds.forEach((round, rIdx) => {
      round.forEach((m, mIdx) => {
        if(!m.played && (m.teamA===null) !== (m.teamB===null)){
          m.played = true;
          m.winner = m.teamA!==null ? 'A':'B';
          const winnerId = m.winner==='A' ? m.teamA : m.teamB;
          avanzarGanadorWB(liga, rIdx, mIdx, winnerId, null);
          changed = true;
        }
      });
    });
    liga.lbRounds.forEach((round, rIdx) => {
      round.forEach((m, mIdx) => {
        if(!m.played && (m.teamA===null) !== (m.teamB===null)){
          m.played = true;
          m.winner = m.teamA!==null ? 'A':'B';
          const winnerId = m.winner==='A' ? m.teamA : m.teamB;
          avanzarGanadorLB(liga, rIdx, mIdx, winnerId);
          changed = true;
        }
      });
    });
  }
}

function registrarResultadoDobleElim(liga, matchId, scoreA, scoreB){
  let m, ubicacion; // ubicacion: 'wb' | 'lb' | 'gf'
  liga.wbRounds.forEach((round, rIdx) => round.forEach((mm, mIdx) => { if(mm.id===matchId){ m=mm; ubicacion={tipo:'wb', rIdx, mIdx}; } }));
  if(!m) liga.lbRounds.forEach((round, rIdx) => round.forEach((mm, mIdx) => { if(mm.id===matchId){ m=mm; ubicacion={tipo:'lb', rIdx, mIdx}; } }));
  if(!m) liga.grandFinal.forEach((mm, idx) => { if(mm.id===matchId){ m=mm; ubicacion={tipo:'gf', idx}; } });
  if(!m) return;

  m.scoreA = scoreA; m.scoreB = scoreB; m.played = true;
  m.winner = scoreA === scoreB ? null : (scoreA > scoreB ? 'A':'B');
  if(!m.winner) return; // en eliminatoria no puede quedar empate, se ignora hasta que carguen un resultado valido

  const winnerId = m.winner==='A' ? m.teamA : m.teamB;
  const loserId = m.winner==='A' ? m.teamB : m.teamA;

  if(ubicacion.tipo === 'wb') avanzarGanadorWB(liga, ubicacion.rIdx, ubicacion.mIdx, winnerId, loserId);
  else if(ubicacion.tipo === 'lb') avanzarGanadorLB(liga, ubicacion.rIdx, ubicacion.mIdx, winnerId);
  else if(ubicacion.tipo === 'gf' && ubicacion.idx === 0){
    // si gana el lado de winners (teamA), termina el torneo. Si gana el de losers (teamB), hay partido de vuelta.
    if(m.winner === 'B' && liga.grandFinal.length === 1){
      liga.grandFinal.push(newMatchSlot(m.teamA, m.teamB));
    }
  }
  resolverByesDobleElim(liga);
}

/* =========================================================
   LIGAS: creacion, etiquetas, aplicar resultados
   ========================================================= */

function crearLiga(nombre, formato, equiposTemp, groupCount, webhookId){
  const teams = equiposTemp.map(e => ({ id: uid(), name: e.name, color: e.color, logo: e.logo || null, players: [] }));

  const liga = { id: uid(), name: nombre, format: formato, teams, webhookId: webhookId || null };

  if(formato === 'liga'){
    const n = Math.max(1, groupCount||1);
    liga.groupCount = n;
    liga.groups = [];
    for(let g=1; g<=n; g++){
      const idsDeEsteGrupo = equiposTemp
        .map((e, idx) => ({ ...e, teamId: teams[idx].id }))
        .filter(e => (e.group || 1) === g)
        .map(e => e.teamId);
      liga.groups.push({
        id: uid(), name: `Grupo ${g}`, teamIds: idsDeEsteGrupo,
        rounds: generarRoundRobin(idsDeEsteGrupo),
        tags: [], positionTags: {}
      });
    }
  } else if(formato === 'elim'){
    liga.rounds = generarBracket(teams.map(t=>t.id));
    resolverByesSimple(liga.rounds);
  } else if(formato === 'doble_elim'){
    Object.assign(liga, generarDobleElim(teams.map(t=>t.id)));
  }

  state.leagues.push(liga);
  saveState();
  return liga;
}

function registrarResultadoLiga(ligaId, matchId, scoreA, scoreB){
  const liga = state.leagues.find(l => l.id === ligaId);
  if(!liga) return;
  asegurarDefaultsLiga(liga);

  if(liga.format === 'liga'){
    let found;
    liga.groups.forEach(g => g.rounds.flat().forEach(m => { if(m.id===matchId) found=m; }));
    if(!found) return;
    found.scoreA = scoreA; found.scoreB = scoreB; found.played = true;
    found.winner = scoreA===scoreB ? null : (scoreA>scoreB?'A':'B');
  } else if(liga.format === 'elim'){
    let found, rIdx, mIdx;
    liga.rounds.forEach((round, ri) => round.forEach((m, mi) => { if(m.id===matchId){ found=m; rIdx=ri; mIdx=mi; } }));
    if(!found) return;
    found.scoreA = scoreA; found.scoreB = scoreB; found.played = true;
    found.winner = scoreA===scoreB ? null : (scoreA>scoreB?'A':'B');
    if(found.winner){
      const winnerId = found.winner==='A' ? found.teamA : found.teamB;
      avanzarGanadorSimple(liga.rounds, rIdx, mIdx, winnerId);
      resolverByesSimple(liga.rounds);
    }
  } else if(liga.format === 'doble_elim'){
    registrarResultadoDobleElim(liga, matchId, scoreA, scoreB);
  }
  saveState();
}

function aplicarResultadoALiga(leagueRef, scoreA, scoreB){
  registrarResultadoLiga(leagueRef.leagueId, leagueRef.matchId, scoreA, scoreB);
}

function jugarPartidoDeLiga(liga, teamAId, teamBId, matchId, webhookId){
  const teamA = getTeamById(liga, teamAId);
  const teamB = getTeamById(liga, teamBId);
  if(!teamA || !teamB) return;
  crearPartido(teamA, teamB, { leagueId: liga.id, matchId, label: liga.name }, webhookId);
  activarTab('partido');
}

/* ---------- planteles (jugadores por equipo) ---------- */

function agregarJugador(liga, teamId, name){
  const team = getTeamById(liga, teamId);
  if(!team || !name) return;
  team.players.push(nuevoJugador(name));
  saveState();
}

function eliminarJugador(liga, teamId, playerId){
  const team = getTeamById(liga, teamId);
  if(!team) return;
  team.players = team.players.filter(p => p.id !== playerId);
  saveState();
}

function actualizarStatJugador(liga, teamId, playerId, stat, value){
  const team = getTeamById(liga, teamId);
  if(!team) return;
  const player = team.players.find(p => p.id === playerId);
  if(!player) return;
  player[stat] = Math.max(0, parseInt(value,10) || 0);
  saveState();
}

/* ---------- etiquetas de posicion ---------- */

function agregarTag(group, name, color){
  if(!name) return;
  group.tags.push({ id: uid(), name, color });
  saveState();
}

function eliminarTag(group, tagId){
  group.tags = group.tags.filter(t => t.id !== tagId);
  Object.keys(group.positionTags).forEach(pos => {
    if(group.positionTags[pos] === tagId) delete group.positionTags[pos];
  });
  saveState();
}

function asignarTagAPosicion(group, posicion, tagId){
  if(tagId){ group.positionTags[posicion] = tagId; }
  else{ delete group.positionTags[posicion]; }
  saveState();
}

/* =========================================================
   EXPORTAR / IMPORTAR
   ========================================================= */

function exportarTodo(){
  const data = { exportedAt: Date.now(), app:'haxballium-referee', version:'1.1',
    leagues: state.leagues, history: state.history };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `haxballium-referee-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importarArchivo(file){
  const hint = document.getElementById('importExportHint');
  const reader = new FileReader();
  reader.onload = (ev) => {
    try{
      const data = JSON.parse(ev.target.result);
      if(!data || (!Array.isArray(data.leagues) && !Array.isArray(data.history))){
        throw new Error('Formato de archivo no reconocido');
      }
      const nuevasLigas = (data.leagues||[]).length;
      const nuevosPartidos = (data.history||[]).length;
      if(!confirm(`Se importarán ${nuevasLigas} ligas y ${nuevosPartidos} partidos del historial, sumándose a lo que ya tenés. ¿Continuar?`)) return;
      (data.leagues||[]).forEach(l => { asegurarDefaultsLiga(l); state.leagues.push(l); });
      (data.history||[]).forEach(m => state.history.push(m));
      saveState();
      renderLigasScreen();
      renderHistorialScreen();
      hint.textContent = `Importado: ${nuevasLigas} ligas, ${nuevosPartidos} partidos.`;
    }catch(err){
      console.error(err);
      hint.textContent = 'No se pudo leer el archivo. ¿Es un backup exportado desde esta misma app?';
    }
  };
  reader.readAsText(file);
}

/* =========================================================
   MODAL GENERICO: pedir nombre de jugador para un evento
   ========================================================= */

let eventModalCallback = null;

function abrirModalEvento(titulo, jugadoresSugeridos, callback){
  const modal = document.getElementById('eventModal');
  document.getElementById('eventModalTitle').textContent = titulo;
  const input = document.getElementById('eventModalPlayerInput');
  input.value = '';
  const datalist = document.getElementById('eventModalPlayerList');
  datalist.innerHTML = '';
  (jugadoresSugeridos||[]).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    datalist.appendChild(opt);
  });
  eventModalCallback = callback;
  modal.classList.remove('hidden');
  setTimeout(() => input.focus(), 50);
}

function cerrarModalEvento(){
  document.getElementById('eventModal').classList.add('hidden');
  eventModalCallback = null;
}

function jugadoresDelEquipoEnPartidoActual(team){
  if(!currentMatch || !currentMatch.leagueRef) return [];
  const liga = state.leagues.find(l => l.id === currentMatch.leagueRef.leagueId);
  if(!liga) return [];
  const teamName = team === 'A' ? currentMatch.teamA.name : currentMatch.teamB.name;
  const equipoLiga = liga.teams.find(t => t.name === teamName);
  return equipoLiga ? equipoLiga.players.map(p=>p.name) : [];
}

/* ---------- modal: elegir webhook antes de jugar partido de liga ---------- */

let webhookPickCallback = null;

function abrirModalElegirWebhook(callback){
  const modal = document.getElementById('webhookPickModal');
  const select = document.getElementById('webhookPickSelect');
  poblarSelectWebhooks(select, state.webhooks[0] ? state.webhooks[0].id : null);
  webhookPickCallback = callback;
  modal.classList.remove('hidden');
}

function cerrarModalElegirWebhook(){
  document.getElementById('webhookPickModal').classList.add('hidden');
  webhookPickCallback = null;
}

/* =========================================================
   NAVEGACIÓN
   ========================================================= */

function activarTab(tabName){
  document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  document.querySelectorAll('.screen').forEach(scr => scr.classList.toggle('active', scr.id === 'screen-' + tabName));
}

/* =========================================================
   RENDER: PARTIDO
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
    refrescarSelectsDeWebhook();
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
    li.innerHTML = eventText(e).replace(/(⚽ Gol|🟨 Amarilla|🟥 Roja|🚩 Offside|🟨🟥 Doble amarilla)/, '<b>$1</b>');
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
   RENDER: HISTORIAL
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
   RENDER: LIGAS — lista y creacion
   ========================================================= */

let ligaEquiposTemp = [];
let ligaSeleccionadaId = null;
let ligaSubTab = 'fixture'; // fixture | tabla | planteles
let grupoActivoIdx = 0; // que grupo se esta mirando en Fixture/Tabla/Etiquetas
let rosterModalCtx = null; // { ligaId, teamId }
let tagsModalCtx = null; // { ligaId, groupId }

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
  const nombresFormato = { liga:'Liga', elim:'Eliminatoria simple', doble_elim:'Doble eliminación' };
  state.leagues.forEach(liga => {
    asegurarDefaultsLiga(liga);
    const div = document.createElement('div');
    div.className = 'liga-card';
    let totalMatches, playedMatches;
    if(liga.format === 'liga'){
      const all = liga.groups.flatMap(g => g.rounds.flat());
      totalMatches = all.length; playedMatches = all.filter(m=>m.played).length;
    } else if(liga.format === 'elim'){
      totalMatches = liga.rounds.flat().length; playedMatches = liga.rounds.flat().filter(m=>m.played).length;
    } else {
      const all = [...liga.wbRounds.flat(), ...liga.lbRounds.flat(), ...liga.grandFinal];
      totalMatches = all.length; playedMatches = all.filter(m=>m.played).length;
    }
    div.innerHTML = `
      <div>
        <div class="liga-name">${liga.name}</div>
        <div class="liga-meta">${nombresFormato[liga.format]} · ${liga.teams.length} equipos · ${playedMatches}/${totalMatches} partidos jugados</div>
      </div>
      <span class="chevron">›</span>
    `;
    div.addEventListener('click', () => { ligaSeleccionadaId = liga.id; ligaSubTab='fixture'; grupoActivoIdx=0; renderLigasScreen(); });
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
      ${t.logo ? `<img src="${t.logo}" class="logo-thumb">` : `<span class="swatch" style="background:${t.color}"></span>`}
      <span class="team-name">${t.name}</span>
      <span class="group-pill">Grupo ${t.group||1}</span>
      <button data-idx="${idx}">Quitar</button>
    `;
    row.querySelector('button').addEventListener('click', () => { ligaEquiposTemp.splice(idx,1); renderLigaEquiposTemp(); });
    cont.appendChild(row);
  });
}

function actualizarSelectGrupoEnAlta(){
  const formato = document.querySelector('input[name="ligaFormato"]:checked').value;
  document.getElementById('grupoCountRow').classList.toggle('hidden', formato !== 'liga');
  const count = Math.max(1, parseInt(document.getElementById('ligaGroupCount').value,10) || 1);
  const select = document.getElementById('ligaEquipoGrupo');
  const prevVal = select.value;
  select.innerHTML = '';
  for(let g=1; g<=count; g++){
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = `Grupo ${g}`;
    select.appendChild(opt);
  }
  if(prevVal && parseInt(prevVal,10) <= count) select.value = prevVal;
  select.parentElement.classList.toggle('hidden', formato !== 'liga');
}

/* =========================================================
   RENDER: DETALLE DE LIGA
   ========================================================= */

function renderLigaDetalle(){
  const liga = state.leagues.find(l => l.id === ligaSeleccionadaId);
  const panel = document.getElementById('ligaDetallePanel');
  if(!liga){ ligaSeleccionadaId = null; renderLigasScreen(); return; }
  asegurarDefaultsLiga(liga);

  let html = `
    <div class="panel-head">
      <h2>${liga.name}</h2>
      <button class="btn" id="btnVolverLigas">‹ Volver</button>
    </div>
    <div class="liga-tabs">
      <button class="liga-subtab ${ligaSubTab==='fixture'?'active':''}" data-sub="fixture">Fixture${liga.format==='liga'?' / Bracket':''}</button>
      ${liga.format==='liga' ? `<button class="liga-subtab ${ligaSubTab==='tabla'?'active':''}" data-sub="tabla">Tabla de posiciones</button>` : ''}
      <button class="liga-subtab ${ligaSubTab==='planteles'?'active':''}" data-sub="planteles">Planteles</button>
    </div>
  `;

  if(liga.format === 'liga' && liga.groups.length > 1){
    html += `<div class="format-choice" style="margin-bottom:16px;">`;
    liga.groups.forEach((g, idx) => {
      html += `<label class="radio-card" style="flex:0 0 auto;"><input type="radio" name="grupoActivo" value="${idx}" ${idx===grupoActivoIdx?'checked':''}><span>${g.name}</span></label>`;
    });
    html += `</div>`;
  }

  if(liga.format === 'liga'){
    const group = liga.groups[grupoActivoIdx] || liga.groups[0];
    if(ligaSubTab === 'tabla'){
      html += renderTablaHtml(liga, group);
    } else if(ligaSubTab === 'planteles'){
      html += renderPlantelesHtml(liga);
    } else {
      html += renderFixtureGrupoHtml(liga, group);
    }
  } else if(liga.format === 'elim'){
    if(ligaSubTab === 'planteles') html += renderPlantelesHtml(liga);
    else html += renderBracketSimpleHtml(liga);
  } else if(liga.format === 'doble_elim'){
    if(ligaSubTab === 'planteles') html += renderPlantelesHtml(liga);
    else html += renderBracketDobleElimHtml(liga);
  }

  panel.innerHTML = html;

  panel.querySelector('#btnVolverLigas').addEventListener('click', () => { ligaSeleccionadaId = null; renderLigasScreen(); });
  panel.querySelectorAll('.liga-subtab').forEach(btn => btn.addEventListener('click', () => { ligaSubTab = btn.dataset.sub; renderLigaDetalle(); }));
  panel.querySelectorAll('input[name="grupoActivo"]').forEach(r => r.addEventListener('change', () => { grupoActivoIdx = parseInt(r.value,10); renderLigaDetalle(); }));

  wireLigaDetalleBotones(liga);
}

function renderTablaHtml(liga, group){
  const standings = getGroupStandings(liga, group);
  let html = `
    <div class="panel-head">
      <h3 style="margin:0;">${liga.groups.length>1?group.name:'Tabla de posiciones'}</h3>
      <button class="btn" id="btnGestionarTags" data-group="${group.id}">🏷 Etiquetas</button>
    </div>
    <table class="standings">
      <thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>PG</th><th>PE</th><th>PP</th><th>GF</th><th>GC</th><th>DG</th><th>Pts</th></tr></thead>
      <tbody>
  `;
  standings.forEach((s, idx) => {
    const pos = idx+1;
    const tagId = group.positionTags[pos];
    const tag = group.tags.find(t=>t.id===tagId);
    html += `
      <tr class="${tag?'tagged':''}" style="${tag?`border-left:3px solid ${tag.color}`:''}">
        <td>
          <select class="pos-tag-select" data-pos="${pos}">
            <option value="">${pos}</option>
            ${group.tags.map(t=>`<option value="${t.id}" ${t.id===tagId?'selected':''}>${pos} · ${t.name}</option>`).join('')}
          </select>
        </td>
        <td>${s.team.name}</td>
        <td>${s.pj}</td><td>${s.pg}</td><td>${s.pe}</td><td>${s.pp}</td>
        <td>${s.gf}</td><td>${s.gc}</td><td>${s.gf-s.gc}</td><td><b>${s.pts}</b></td>
      </tr>`;
  });
  html += `</tbody></table>`;
  if(group.tags.length > 0){
    html += `<div class="tags-legend">${group.tags.map(t=>`<div class="tags-legend-item"><span class="tags-legend-swatch" style="background:${t.color}"></span>${t.name}</div>`).join('')}</div>`;
  }
  return html;
}

function renderFixtureGrupoHtml(liga, group){
  let html = '';
  if(group.teamIds.length < 2){
    return '<p class="hint">Este grupo todavía no tiene al menos 2 equipos.</p>';
  }
  group.rounds.forEach((round, rIdx) => {
    html += `<div class="fixture-round"><h4>Fecha ${rIdx+1}</h4>`;
    round.forEach(m => { html += renderFixtureMatchHtml(liga, m); });
    html += `</div>`;
  });
  return html;
}

function renderFixtureMatchHtml(liga, m){
  const teamA = getTeamById(liga, m.teamA);
  const teamB = getTeamById(liga, m.teamB);
  if(!teamA || !teamB) return '';
  return `
    <div class="fixture-match" data-match="${m.id}">
      <span>${teamA.name} ${m.played?`<b>${m.scoreA}</b>`:''} vs ${m.played?`<b>${m.scoreB}</b>`:''} ${teamB.name}</span>
      <span class="f-actions">
        ${!m.played ? `
          <input type="number" class="f-score" data-side="A" min="0" value="0">
          <input type="number" class="f-score" data-side="B" min="0" value="0">
          <button class="btn btn-cargar-resultado" data-match="${m.id}">Cargar</button>
          <button class="btn btn-primary btn-jugar-vivo" data-match="${m.id}" data-teama="${m.teamA}" data-teamb="${m.teamB}">Jugar en vivo</button>
        ` : `<span class="hint" style="margin:0;">Jugado</span>`}
      </span>
    </div>
  `;
}

function renderBracketSimpleHtml(liga){
  let html = `<div class="bracket-scroll"><div class="bracket">`;
  liga.rounds.forEach((round, rIdx) => {
    const title = rIdx===liga.rounds.length-1 ? 'Final' : rIdx===liga.rounds.length-2 ? 'Semifinal' : `Ronda ${rIdx+1}`;
    html += `<div class="bracket-round"><div class="bracket-round-title">${title}</div>`;
    round.forEach(m => { html += renderBracketMatchHtml(liga, m); });
    html += `</div>`;
  });
  html += `</div></div>`;
  return html;
}

function renderBracketMatchHtml(liga, m){
  const teamA = m.teamA ? getTeamById(liga, m.teamA) : null;
  const teamB = m.teamB ? getTeamById(liga, m.teamB) : null;
  const nameA = teamA ? teamA.name : (m.teamA===null ? '—' : '?');
  const nameB = teamB ? teamB.name : (m.teamB===null ? '—' : '?');
  const canPlay = teamA && teamB && !m.played;
  return `
    <div class="bracket-match" data-match="${m.id}">
      <div class="b-team ${m.winner==='A'?'winner':''}">${nameA} ${m.played?`<span>${m.scoreA}</span>`:''}</div>
      <div class="b-team ${m.winner==='B'?'winner':''}">${nameB} ${m.played?`<span>${m.scoreB}</span>`:''}</div>
      ${canPlay ? `
        <div class="b-actions">
          <input type="number" class="b-score-input f-score" data-side="A" min="0" value="0">
          <input type="number" class="b-score-input f-score" data-side="B" min="0" value="0">
          <button class="btn btn-cargar-resultado" data-match="${m.id}">Cargar</button>
          <button class="btn btn-primary btn-jugar-vivo" data-match="${m.id}" data-teama="${m.teamA}" data-teamb="${m.teamB}">En vivo</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderBracketDobleElimHtml(liga){
  let html = `<div class="bracket-section-title">Cuadro de ganadores</div><div class="bracket-scroll"><div class="bracket">`;
  liga.wbRounds.forEach((round, rIdx) => {
    html += `<div class="bracket-round"><div class="bracket-round-title">Ronda ${rIdx+1}</div>`;
    round.forEach(m => { html += renderBracketMatchHtml(liga, m); });
    html += `</div>`;
  });
  html += `</div></div>`;

  if(liga.lbRounds.length){
    html += `<div class="bracket-section-title">Cuadro de perdedores</div><div class="bracket-scroll"><div class="bracket">`;
    liga.lbRounds.forEach((round, rIdx) => {
      html += `<div class="bracket-round"><div class="bracket-round-title">Ronda ${rIdx+1}</div>`;
      round.forEach(m => { html += renderBracketMatchHtml(liga, m); });
      html += `</div>`;
    });
    html += `</div></div>`;
  }

  html += `<div class="bracket-section-title">Gran final</div><div class="bracket-scroll"><div class="bracket">`;
  liga.grandFinal.forEach((m, idx) => {
    html += `<div class="bracket-round"><div class="bracket-round-title">${idx===0?'Final':'Revancha (resultado 1-1)'}</div>${renderBracketMatchHtml(liga, m)}</div>`;
  });
  html += `</div></div>`;
  html += `<p class="hint">El equipo del cuadro de ganadores necesita ganar una sola vez la final. Si gana el equipo que viene del cuadro de perdedores, se juega una revancha para definir al campeón.</p>`;
  return html;
}

function renderPlantelesHtml(liga){
  let html = `<div class="ligas-list">`;
  liga.teams.forEach(t => {
    html += `
      <div class="liga-card" data-roster-team="${t.id}">
        <div style="display:flex;align-items:center;gap:12px;">
          ${t.logo?`<img src="${t.logo}" class="logo-thumb" style="width:32px;height:32px;">`:`<span class="swatch" style="background:${t.color};width:20px;height:20px;"></span>`}
          <div>
            <div class="liga-name">${t.name}</div>
            <div class="liga-meta">${t.players.length} jugador${t.players.length===1?'':'es'}</div>
          </div>
        </div>
        <span class="chevron">›</span>
      </div>
    `;
  });
  html += `</div>`;
  return html;
}

/* =========================================================
   WIRING: botones dentro del detalle de liga
   ========================================================= */

function wireLigaDetalleBotones(liga){
  document.querySelectorAll('.btn-jugar-vivo').forEach(btn => {
    btn.addEventListener('click', () => {
      const matchId = btn.dataset.match;
      const teamAId = btn.dataset.teama;
      const teamBId = btn.dataset.teamb;
      abrirModalElegirWebhook((webhookId) => {
        jugarPartidoDeLiga(liga, teamAId, teamBId, matchId, webhookId);
      });
    });
  });

  document.querySelectorAll('.btn-cargar-resultado').forEach(btn => {
    btn.addEventListener('click', () => {
      const matchId = btn.dataset.match;
      const container = btn.closest('[data-match]');
      const scoreA = parseInt(container.querySelector('.f-score[data-side="A"]').value || '0', 10);
      const scoreB = parseInt(container.querySelector('.f-score[data-side="B"]').value || '0', 10);
      registrarResultadoLiga(liga.id, matchId, scoreA, scoreB);
      renderLigaDetalle();
      renderLigasScreen();
    });
  });

  const btnTags = document.getElementById('btnGestionarTags');
  if(btnTags){
    btnTags.addEventListener('click', () => {
      const groupId = btnTags.dataset.group;
      const group = liga.groups.find(g => g.id === groupId);
      abrirModalTags(liga, group);
    });
  }

  document.querySelectorAll('.pos-tag-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const group = liga.format==='liga' ? liga.groups[grupoActivoIdx] : null;
      if(!group) return;
      asignarTagAPosicion(group, parseInt(sel.dataset.pos,10), sel.value || null);
      renderLigaDetalle();
    });
  });

  document.querySelectorAll('[data-roster-team]').forEach(row => {
    row.addEventListener('click', () => {
      const teamId = row.dataset.rosterTeam;
      abrirModalPlantel(liga, teamId);
    });
  });
}

/* =========================================================
   MODAL: PLANTEL DE UN EQUIPO
   ========================================================= */

function abrirModalPlantel(liga, teamId){
  rosterModalCtx = { ligaId: liga.id, teamId };
  const team = getTeamById(liga, teamId);
  document.getElementById('rosterModalTitle').textContent = `Plantel — ${team.name}`;
  document.getElementById('rosterPlayerName').value = '';
  renderRosterTable();
  document.getElementById('rosterModal').classList.remove('hidden');
}

function cerrarModalPlantel(){
  document.getElementById('rosterModal').classList.add('hidden');
  rosterModalCtx = null;
  renderLigaDetalle();
}

function renderRosterTable(){
  if(!rosterModalCtx) return;
  const liga = state.leagues.find(l => l.id === rosterModalCtx.ligaId);
  const team = getTeamById(liga, rosterModalCtx.teamId);
  const tbody = document.getElementById('rosterTableBody');
  tbody.innerHTML = '';
  if(team.players.length === 0){
    tbody.innerHTML = '<tr><td colspan="6" class="hint" style="padding:14px 0;">Todavía no agregaste jugadores.</td></tr>';
    return;
  }
  team.players.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.name}</td>
      <td><input type="number" min="0" value="${p.goals}" data-stat="goals"></td>
      <td><input type="number" min="0" value="${p.assists}" data-stat="assists"></td>
      <td><input type="number" min="0" value="${p.yellow}" data-stat="yellow"></td>
      <td><input type="number" min="0" value="${p.red}" data-stat="red"></td>
      <td><button data-del-player="${p.id}">✕</button></td>
    `;
    tr.querySelectorAll('input[data-stat]').forEach(inp => {
      inp.addEventListener('change', () => actualizarStatJugador(liga, team.id, p.id, inp.dataset.stat, inp.value));
    });
    tr.querySelector('[data-del-player]').addEventListener('click', () => {
      eliminarJugador(liga, team.id, p.id);
      renderRosterTable();
    });
    tbody.appendChild(tr);
  });
}

/* =========================================================
   MODAL: ETIQUETAS DE UN GRUPO
   ========================================================= */

function abrirModalTags(liga, group){
  tagsModalCtx = { ligaId: liga.id, groupId: group.id };
  document.getElementById('newTagName').value = '';
  renderTagsList();
  document.getElementById('tagsModal').classList.remove('hidden');
}

function cerrarModalTags(){
  document.getElementById('tagsModal').classList.add('hidden');
  tagsModalCtx = null;
  renderLigaDetalle();
}

function renderTagsList(){
  if(!tagsModalCtx) return;
  const liga = state.leagues.find(l => l.id === tagsModalCtx.ligaId);
  const group = liga.groups.find(g => g.id === tagsModalCtx.groupId);
  const cont = document.getElementById('tagsListContainer');
  cont.innerHTML = '';
  if(group.tags.length === 0){
    cont.innerHTML = '<p class="hint">Todavía no hay etiquetas en este grupo.</p>';
    return;
  }
  group.tags.forEach(t => {
    const row = document.createElement('div');
    row.className = 'liga-equipo-row';
    row.innerHTML = `
      <span class="swatch" style="background:${t.color}"></span>
      <input type="text" value="${t.name}" data-rename="${t.id}" style="flex:1;background:transparent;border:none;color:var(--text);padding:2px;">
      <input type="color" value="${t.color}" data-recolor="${t.id}" style="width:32px;height:28px;margin:0;">
      <button data-del-tag="${t.id}">Eliminar</button>
    `;
    row.querySelector('[data-rename]').addEventListener('change', (e) => { t.name = e.target.value; saveState(); });
    row.querySelector('[data-recolor]').addEventListener('input', (e) => { t.color = e.target.value; saveState(); renderTagsList(); });
    row.querySelector('[data-del-tag]').addEventListener('click', () => { eliminarTag(group, t.id); renderTagsList(); });
    cont.appendChild(row);
  });
}

/* =========================================================
   EVENT LISTENERS / INIT
   ========================================================= */

let pendingLogos = { teamA: null, teamB: null, ligaEquipo: null };

function wireLogoInput(inputId, labelId, targetKey){
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  input.addEventListener('change', async () => {
    if(!input.files[0]) return;
    try{
      const dataUrl = await resizeImageFile(input.files[0], 128);
      pendingLogos[targetKey] = dataUrl;
      label.textContent = '✓ Escudo cargado';
    }catch(e){
      console.error(e);
      alert('No se pudo cargar la imagen.');
    }
  });
}

function wireStaticListeners(){

  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => activarTab(btn.dataset.tab)));

  wireLogoInput('teamALogoInput','teamALogoLabel','teamA');
  wireLogoInput('teamBLogoInput','teamBLogoLabel','teamB');
  wireLogoInput('ligaEquipoLogoInput','ligaEquipoLogoLabel','ligaEquipo');

  document.getElementById('btnCrearPartido').addEventListener('click', () => {
    const webhookId = document.getElementById('matchWebhookSelect').value;
    if(!webhookId){ alert('Agregá al menos un webhook en Ajustes antes de crear un partido.'); return; }
    const teamA = {
      name: document.getElementById('teamAName').value.trim() || 'Rojo',
      color: document.getElementById('teamAColor').value,
      logo: pendingLogos.teamA
    };
    const teamB = {
      name: document.getElementById('teamBName').value.trim() || 'Azul',
      color: document.getElementById('teamBColor').value,
      logo: pendingLogos.teamB
    };
    crearPartido(teamA, teamB, null, webhookId);
    pendingLogos.teamA = null; pendingLogos.teamB = null;
    document.getElementById('teamALogoLabel').textContent = '+ Escudo';
    document.getElementById('teamBLogoLabel').textContent = '+ Escudo';
  });

  document.getElementById('btnIniciar').addEventListener('click', iniciar);
  document.getElementById('btnPausar').addEventListener('click', pausar);
  document.getElementById('btnMedioTiempo').addEventListener('click', medioTiempo);
  document.getElementById('btnTerminar').addEventListener('click', () => {
    if(confirm('¿Finalizar el partido? Esta acción no se puede deshacer.')) terminarPartido();
  });

  document.getElementById('btnGolA').addEventListener('click', () => {
    abrirModalEvento(`Gol de ${currentMatch.teamA.name}`, jugadoresDelEquipoEnPartidoActual('A'), (player) => registrarGol('A', player));
  });
  document.getElementById('btnGolB').addEventListener('click', () => {
    abrirModalEvento(`Gol de ${currentMatch.teamB.name}`, jugadoresDelEquipoEnPartidoActual('B'), (player) => registrarGol('B', player));
  });
  document.getElementById('btnAmarillaA').addEventListener('click', () => {
    abrirModalEvento(`Tarjeta amarilla — ${currentMatch.teamA.name}`, jugadoresDelEquipoEnPartidoActual('A'), (player) => registrarTarjeta('A','amarilla',player));
  });
  document.getElementById('btnRojaA').addEventListener('click', () => {
    abrirModalEvento(`Tarjeta roja — ${currentMatch.teamA.name}`, jugadoresDelEquipoEnPartidoActual('A'), (player) => registrarTarjeta('A','roja',player));
  });
  document.getElementById('btnOffsideA').addEventListener('click', () => {
    abrirModalEvento(`Offside — ${currentMatch.teamA.name}`, jugadoresDelEquipoEnPartidoActual('A'), (player) => registrarOffside('A',player));
  });
  document.getElementById('btnAmarillaB').addEventListener('click', () => {
    abrirModalEvento(`Tarjeta amarilla — ${currentMatch.teamB.name}`, jugadoresDelEquipoEnPartidoActual('B'), (player) => registrarTarjeta('B','amarilla',player));
  });
  document.getElementById('btnRojaB').addEventListener('click', () => {
    abrirModalEvento(`Tarjeta roja — ${currentMatch.teamB.name}`, jugadoresDelEquipoEnPartidoActual('B'), (player) => registrarTarjeta('B','roja',player));
  });
  document.getElementById('btnOffsideB').addEventListener('click', () => {
    abrirModalEvento(`Offside — ${currentMatch.teamB.name}`, jugadoresDelEquipoEnPartidoActual('B'), (player) => registrarOffside('B',player));
  });
  document.getElementById('btnDeshacer').addEventListener('click', deshacerUltimoEvento);

  document.getElementById('eventModalConfirm').addEventListener('click', () => {
    const player = document.getElementById('eventModalPlayerInput').value.trim() || null;
    const cb = eventModalCallback;
    cerrarModalEvento();
    if(cb) cb(player);
  });
  document.getElementById('eventModalCancel').addEventListener('click', cerrarModalEvento);

  document.getElementById('webhookPickConfirm').addEventListener('click', () => {
    const select = document.getElementById('webhookPickSelect');
    const webhookId = select.value;
    const cb = webhookPickCallback;
    cerrarModalElegirWebhook();
    if(cb && webhookId) cb(webhookId);
    else if(cb && !webhookId) alert('Agregá un webhook en Ajustes primero.');
  });
  document.getElementById('webhookPickCancel').addEventListener('click', cerrarModalElegirWebhook);

  document.getElementById('rosterModalClose').addEventListener('click', cerrarModalPlantel);
  document.getElementById('btnAgregarJugador').addEventListener('click', () => {
    const input = document.getElementById('rosterPlayerName');
    const name = input.value.trim();
    if(!name || !rosterModalCtx) return;
    const liga = state.leagues.find(l => l.id === rosterModalCtx.ligaId);
    agregarJugador(liga, rosterModalCtx.teamId, name);
    input.value = '';
    renderRosterTable();
  });

  document.getElementById('tagsModalClose').addEventListener('click', cerrarModalTags);
  document.getElementById('btnAgregarTag').addEventListener('click', () => {
    if(!tagsModalCtx) return;
    const liga = state.leagues.find(l => l.id === tagsModalCtx.ligaId);
    const group = liga.groups.find(g => g.id === tagsModalCtx.groupId);
    const name = document.getElementById('newTagName').value.trim();
    const color = document.getElementById('newTagColor').value;
    agregarTag(group, name, color);
    document.getElementById('newTagName').value = '';
    renderTagsList();
  });

  document.getElementById('btnNuevaLiga').addEventListener('click', () => {
    ligaEquiposTemp = [];
    pendingLogos.ligaEquipo = null;
    document.getElementById('ligaEquipoLogoLabel').textContent = 'Escudo';
    document.getElementById('ligasListPanel').classList.add('hidden');
    document.getElementById('nuevaLigaPanel').classList.remove('hidden');
    document.getElementById('ligaNombre').value = '';
    document.getElementById('ligaGroupCount').value = 1;
    refrescarSelectsDeWebhook();
    actualizarSelectGrupoEnAlta();
    renderLigaEquiposTemp();
  });

  document.getElementById('btnCancelarLiga').addEventListener('click', () => {
    document.getElementById('nuevaLigaPanel').classList.add('hidden');
    document.getElementById('ligasListPanel').classList.remove('hidden');
  });

  document.querySelectorAll('input[name="ligaFormato"]').forEach(r => r.addEventListener('change', actualizarSelectGrupoEnAlta));
  document.getElementById('ligaGroupCount').addEventListener('input', actualizarSelectGrupoEnAlta);

  document.getElementById('btnAgregarEquipoLiga').addEventListener('click', () => {
    const nameInput = document.getElementById('ligaEquipoNombre');
    const colorInput = document.getElementById('ligaEquipoColor');
    const grupoSelect = document.getElementById('ligaEquipoGrupo');
    const name = nameInput.value.trim();
    if(!name) return;
    ligaEquiposTemp.push({ name, color: colorInput.value, logo: pendingLogos.ligaEquipo, group: parseInt(grupoSelect.value,10) || 1 });
    nameInput.value = '';
    pendingLogos.ligaEquipo = null;
    document.getElementById('ligaEquipoLogoLabel').textContent = 'Escudo';
    renderLigaEquiposTemp();
  });

  document.getElementById('btnGenerarLiga').addEventListener('click', () => {
    const nombre = document.getElementById('ligaNombre').value.trim();
    const formato = document.querySelector('input[name="ligaFormato"]:checked').value;
    const groupCount = parseInt(document.getElementById('ligaGroupCount').value,10) || 1;
    const webhookId = document.getElementById('ligaWebhookSelect').value;
    if(!nombre){ alert('Ponele un nombre a la liga.'); return; }
    if(ligaEquiposTemp.length < 2){ alert('Agregá al menos 2 equipos.'); return; }
    if(!webhookId){ alert('Agregá al menos un webhook en Ajustes antes de crear una liga.'); return; }
    const liga = crearLiga(nombre, formato, ligaEquiposTemp, groupCount, webhookId);
    document.getElementById('nuevaLigaPanel').classList.add('hidden');
    ligaSeleccionadaId = liga.id;
    ligaSubTab = 'fixture'; grupoActivoIdx = 0;
    renderLigasScreen();
  });

  document.getElementById('btnAgregarWebhook').addEventListener('click', () => {
    const name = document.getElementById('newWebhookName').value.trim();
    const url = document.getElementById('newWebhookUrl').value.trim();
    if(!name || !url){ document.getElementById('webhookHint').textContent = 'Completá nombre y URL.'; return; }
    agregarWebhook(name, url);
    document.getElementById('newWebhookName').value = '';
    document.getElementById('newWebhookUrl').value = '';
    renderWebhooksList();
    refrescarSelectsDeWebhook();
    document.getElementById('webhookHint').textContent = 'Webhook guardado.';
  });

  document.getElementById('btnGuardarAjustes').addEventListener('click', () => {
    state.settings.halfMinutes = parseInt(document.getElementById('halfMinutes').value,10) || 5;
    state.settings.updateIntervalSec = parseInt(document.getElementById('updateIntervalSec').value,10) || 5;
    saveState();
    startDiscordLoop();
    alert('Preferencias guardadas.');
  });

  document.getElementById('btnExportar').addEventListener('click', exportarTodo);
  document.getElementById('importarInput').addEventListener('change', (e) => {
    if(e.target.files[0]) importarArchivo(e.target.files[0]);
  });
}

function initApp(){
  wireStaticListeners();

  document.getElementById('halfMinutes').value = state.settings.halfMinutes;
  document.getElementById('updateIntervalSec').value = state.settings.updateIntervalSec;

  renderWebhooksList();
  refrescarSelectsDeWebhook();
  renderPartidoScreen();
  renderHistorialScreen();
  renderLigasScreen();

  if(currentMatch && currentMatch.status !== 'finalizado'){
    startTicker();
    startDiscordLoop();
  }
}

document.addEventListener('DOMContentLoaded', initApp);
