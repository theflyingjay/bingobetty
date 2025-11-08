/* ===== DOM refs ===== */
const viewWelcome     = document.getElementById('view_welcome');
const viewSetup       = document.getElementById('view_setup');
const viewProgramPick = document.getElementById('view_program_pick');  // optional (new)
const viewOverview    = document.getElementById('view_overview');
const viewFocus       = document.getElementById('view_focus');

const btnStart   = document.getElementById('btn_start');
const numgrid    = document.getElementById('numgrid');
const confirmBox = document.getElementById('confirm');
const confirmText= document.getElementById('confirmText');
const btnYes     = document.getElementById('btn_yes');
const btnNo      = document.getElementById('btn_no');

const programGrid     = document.getElementById('programGrid');        // optional (new)
const programPickSub  = document.getElementById('programPickSub');     // optional (new)
const btnStartSession = document.getElementById('btn_start_session');  // optional (new)

const cardsEl    = document.getElementById('cards');
const focusGrid  = document.getElementById('focusGrid');
const focusTitle = document.getElementById('focusTitle');

const statusEl         = document.getElementById('status');
const statusElFocus    = document.getElementById('status_focus');
const statusElDrawer   = document.getElementById('status_drawer');

const modeBtn          = document.getElementById('modeBtn');
const modeBtnDrawer    = document.getElementById('modeBtn_drawer');

const heardOverlay = document.getElementById('heardOverlay');
const heardText    = document.getElementById('heardText');

const globalBackBtn = document.getElementById('btn_global_back');      // may not exist in new UI

const drawer   = document.getElementById('drawer');
const backdrop = document.getElementById('drawerBackdrop');
const gearBtn  = document.getElementById('gearBtn');

const gainSlider    = document.getElementById('gainSlider');
const gainVal       = document.getElementById('gainVal');
const speakerSlider = document.getElementById('speakerSlider');
const speakerVal    = document.getElementById('speakerVal');

const btnNextGame   = document.getElementById('btn_next_game');        // optional (new)
const programNameEl = document.getElementById('program_name');         // optional (new)

/* ===== App state ===== */
let state = null;
let pendingGames = null;
let drawerOpen = false;

/* Program pick cache (optional) */
let programsCache = [];
let lineup = []; // local lineup we build and POST to /api/session/lineup

/* ===== Drawer controls ===== */
function openDrawer(){
  if(!drawer || !backdrop) return;
  drawer.classList.add('open');
  backdrop.classList.add('show');
  drawer.setAttribute('aria-hidden','false');
  drawerOpen = true;
}
function closeDrawer(){
  if(!drawer || !backdrop) return;
  drawer.classList.remove('open');
  backdrop.classList.remove('show');
  drawer.setAttribute('aria-hidden','true');
  drawerOpen = false;
}
if (gearBtn) gearBtn.addEventListener('click', openDrawer);
if (backdrop) backdrop.addEventListener('click', closeDrawer);

/* ===== View switching ===== */
function setView(name){
  [viewWelcome, viewSetup, viewProgramPick, viewOverview, viewFocus]
    .filter(Boolean).forEach(el=> el.classList.remove('active'));
  if(name==='WELCOME'      && viewWelcome)     viewWelcome.classList.add('active');
  if(name==='SETUP_GAMES'  && viewSetup)       viewSetup.classList.add('active');
  if(name==='PROGRAM_PICK' && viewProgramPick) viewProgramPick.classList.add('active');
  if(name==='OVERVIEW'     && viewOverview)    viewOverview.classList.add('active');
  if(name==='FOCUS'        && viewFocus)       viewFocus.classList.add('active');

  // Legacy global back (if present)
  if (globalBackBtn){
    if (name === 'WELCOME') globalBackBtn.classList.add('hidden');
    else globalBackBtn.classList.remove('hidden');

    globalBackBtn.onclick = () => {
      if (name === 'SETUP_GAMES') {
        setView('WELCOME');
      } else if (name === 'OVERVIEW') {
        fetch('/api/start', {method:'POST'}); // restart setup
      } else if (name === 'FOCUS') {
        focusNone();
      }
    };
  }
}

/* ===== Toolbar buttons (Overview) ===== */
const btnNewSheet = document.getElementById('btn_new_sheet');
const btnThree    = document.getElementById('btn_three');
const btnSix      = document.getElementById('btn_six');
const btnSim      = document.getElementById('btn_sim');
const btnRepeat   = document.getElementById('btn_repeat');
const btnBack     = document.getElementById('btn_back');

if (btnNewSheet) btnNewSheet.onclick = ()=> newSheet();
if (btnThree)    btnThree.onclick    = ()=> setSheetN(3);
if (btnSix)      btnSix.onclick      = ()=> setSheetN(6);
if (btnSim)      btnSim.onclick      = ()=> simulate();
if (btnRepeat)   btnRepeat.onclick   = ()=> repeatLast();
if (btnBack)     btnBack.onclick     = ()=> focusNone();

if (modeBtn)       modeBtn.onclick       = ()=> toggleMode();
if (modeBtnDrawer) modeBtnDrawer.onclick = ()=> toggleMode();

/* ===== Start flow ===== */
if (btnStart) btnStart.onclick = async ()=>{ await fetch('/api/start', {method:'POST'}); };

/* Build 1..20 number buttons */
(function buildNumGrid(){
  if (!numgrid) return;
  for(let i=1;i<=20;i++){
    const b = document.createElement('button');
    b.textContent = String(i);
    b.onclick = ()=> chooseGames(i);
    numgrid.appendChild(b);
  }
})();
function chooseGames(n){
  pendingGames = n;
  if (confirmText) confirmText.textContent = `You picked ${n} game${n>1?'s':''}. Is that right?`;
  if (confirmBox)  confirmBox.style.display = '';
  say(`You picked ${n} games. Is that right?`);
}
if (btnYes) btnYes.onclick = async ()=>{
  if(pendingGames==null) return;
  await fetch('/api/set_session_games', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({count: pendingGames})
  });
  pendingGames = null;
  if (confirmBox) confirmBox.style.display = 'none';
};
if (btnNo) btnNo.onclick = ()=>{
  pendingGames = null;
  if (confirmBox) confirmBox.style.display = 'none';
  say('Okay, how many games will you be playing?');
};

/* ===== Program pick (optional UI) ===== */
async function fetchPrograms(){
  if(!programGrid) return; // if UI not present, skip
  const r = await fetch('/api/programs');
  const data = await r.json();
  programsCache = data.programs || [];
  const total = (state?.session_total_games)||0;
  if (programPickSub) programPickSub.textContent = `Select up to ${total} games • chosen ${lineup.length}`;
  renderProgramGrid();
}
function previewDots(cells){
  const frag = document.createDocumentFragment();
  for(let r=0;r<5;r++){
    for(let c=0;c<5;c++){
      const d=document.createElement('div'); d.className='dot';
      if(cells?.some(([rr,cc])=> rr===r && cc===c)) d.classList.add('sel');
      frag.appendChild(d);
    }
  }
  return frag;
}
function renderProgramGrid(){
  if(!programGrid) return;
  programGrid.innerHTML = '';
  programsCache.forEach(p=>{
    const card = document.createElement('div'); card.className='program-card';

    const name = document.createElement('div'); name.className='name'; name.textContent=p.name;
    const desc = document.createElement('div'); desc.className='desc'; desc.textContent=p.desc;

    const prev = document.createElement('div'); prev.className='preview';
    prev.appendChild(previewDots(p.preview_cells || []));

    const choose = document.createElement('button'); choose.className='btn choose'; choose.textContent='Add';
    choose.onclick = async ()=>{
      const total = state?.session_total_games || 0;
      if(lineup.length >= total) return;
      lineup.push(p.key);
      await fetch('/api/session/lineup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lineup})});
      if (programPickSub) programPickSub.textContent = `Select up to ${total} games • chosen ${lineup.length}`;
      if(lineup.length === total && btnStartSession){ btnStartSession.focus(); }
    };

    card.appendChild(name); card.appendChild(desc); card.appendChild(prev); card.appendChild(choose);
    programGrid.appendChild(card);
  });
}
if (btnStartSession){
  btnStartSession.onclick = async ()=>{
    await fetch('/api/session/start',{method:'POST'});
  };
}

/* ===== Next game button (optional) ===== */
async function nextGame(){
  try{
    const r = await fetch('/api/winner/stop',{method:'POST'});
    const d = await r.json();
    if(d && d.ok === false){
      await fetch('/api/game/next',{method:'POST'});
    }
  }catch(e){
    await fetch('/api/game/next',{method:'POST'});
  }
}
if (btnNextGame) btnNextGame.onclick = nextGame;

/* ===== Gain (mic input) ===== */
function gainLive(v){ if(gainVal) gainVal.textContent = Number(v).toFixed(1); }
async function gainSet(v){
  try{
    const r = await fetch('/api/gain', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({gain: Number(v)})
    });
    const data = await r.json();
    if(data && typeof data.gain === 'number' && gainSlider && gainVal){
      gainSlider.value = data.gain.toFixed(1);
      gainVal.textContent = data.gain.toFixed(1);
    }
  }catch(e){}
}
function bumpGain(delta){
  if(!gainSlider) return;
  const cur = Number(gainSlider.value || 3.0);
  const next = Math.min(6.0, Math.max(0.5, cur + delta));
  gainSlider.value = next.toFixed(1);
  gainLive(next);
  gainSet(next);
}
window.gainLive = gainLive;
window.gainSet  = gainSet;
window.bumpGain = bumpGain;

/* ===== Speaker volume (hardware, amixer) ===== */
function speakerLive(v){ if(speakerVal) speakerVal.textContent = `${Math.round(Number(v))}%`; }
async function speakerSet(v){
  try{
    const r = await fetch('/api/volume/speaker', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({speaker: Math.round(Number(v))})
    });
    const data = await r.json();
    if (data && typeof data.speaker === 'number' && speakerSlider && speakerVal){
      speakerSlider.value = data.speaker;
      speakerVal.textContent = `${data.speaker}%`;
    }
  }catch(e){}
}
function bumpSpeaker(delta){
  if(!speakerSlider) return;
  const cur = Number(speakerSlider.value || 0);
  const next = Math.min(100, Math.max(0, cur + delta));
  speakerSlider.value = next;
  speakerLive(next);
  speakerSet(next);
}
window.speakerLive = speakerLive;
window.speakerSet  = speakerSet;
window.bumpSpeaker = bumpSpeaker;

/* ===== API helpers used in buttons ===== */
async function newSheet(){ await fetch('/api/new_sheet', {method:'POST'}); }
async function setSheetN(n){
  await fetch('/api/set_sheet_n', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({n})
  });
}
async function toggleMode(){
  const next = (state?.mode || 'PLAY') === 'PLAY' ? 'DEBUG' : 'PLAY';
  await fetch('/api/mode', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({mode: next})
  });
}
function simulate(){
  const letters = ['B','I','N','G','O'];
  const L = letters[Math.floor(Math.random()*5)];
  const ranges = {B:[1,15], I:[16,30], N:[31,45], G:[46,60], O:[61,75]};
  const a=ranges[L][0], b=ranges[L][1];
  const n = Math.floor(Math.random()*(b-a+1))+a;
  fetch('/api/sim_call', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({letter:L, number:n})});
}
function repeatLast(){ fetch('/api/repeat', {method:'POST'}); }
function say(t){
  fetch('/api/say', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text: String(t)})});
}
window.newSheet = newSheet;
window.simulate = simulate;
window.repeatLast = repeatLast;
window.toggleMode = toggleMode;
window.closeDrawer = closeDrawer;

/* ===== Focus helpers ===== */
async function focusCard(idx){
  await fetch('/api/focus', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({index: idx})});
}
async function focusNone(){
  await fetch('/api/focus', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({index: -1})});
}

/* ===== Renderers ===== */
function renderCardsOverview(){
  if(!cardsEl || !state) return;
  const n = (state?.cards || []).length;
  cardsEl.className = 'cards ' + 'cols-' + Math.min(n,6);
  cardsEl.innerHTML = '';
  (state.cards || []).forEach((card, idx)=>{
    const wrap = document.createElement('div');
    wrap.className = 'mini';

    const title = document.createElement('h4');
    title.textContent = `Card ${idx+1}`;
    wrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'grid';

    const letters = ['B','I','N','G','O'];
    for(let i=0;i<5;i++){
      const h = document.createElement('div');
      h.className='cell hdr';
      h.textContent = letters[i];
      grid.appendChild(h);
    }
    for(let r=0;r<5;r++){
      for(let c=0;c<5;c++){
        const L = letters[c];
        const num = card.cols[L][r];
        const el = document.createElement('div');
        el.className='cell';
        if(L==='N' && r===2){
          el.textContent='FREE';
          el.classList.add('free');
          if(card.marks['FREE']) el.classList.add('marked');
        }else{
          el.textContent=num;
          if(card.marks[L+num]) el.classList.add('marked');
        }
        grid.appendChild(el);
      }
    }
    const tap = document.createElement('div');
    tap.className='tap';
    tap.textContent = 'Tap to view full screen';

    wrap.appendChild(grid);
    wrap.appendChild(tap);
    wrap.onclick = ()=> focusCard(idx);

    cardsEl.appendChild(wrap);
  });
}

function renderFocus(){
  if(!focusGrid || !state) return;
  const idx = state.focus_idx ?? 0;
  const card = (state.cards || [])[idx];
  if(focusTitle) focusTitle.textContent = `Sheet · Card ${idx+1}`;
  focusGrid.innerHTML = '';

  const letters = ['B','I','N','G','O'];
  for(let i=0;i<5;i++){
    const h = document.createElement('div');
    h.className='cell hdr';
    h.textContent=letters[i];
    focusGrid.appendChild(h);
  }
  for(let r=0;r<5;r++){
    for(let c=0;c<5;c++){
      const L = letters[c];
      const num = card.cols[L][r];
      const el = document.createElement('div');
      el.className='cell';
      if(L==='N' && r===2){
        el.textContent='FREE';
        el.classList.add('free');
        if(card.marks['FREE']) el.classList.add('marked');
      }else{
        el.textContent=num;
        if(card.marks[L+num]) el.classList.add('marked');
      }
      focusGrid.appendChild(el);
    }
  }
}

function applyModeUI(){
  const mode = (state?.mode || 'PLAY').toUpperCase();
  const text = `Mode: ${mode==='PLAY'?'Play':'Debug'}`;
  if (modeBtn)       modeBtn.textContent = text;
  if (modeBtnDrawer) modeBtnDrawer.textContent = text;
  if (modeBtn)       modeBtn.setAttribute('aria-pressed', String(mode!=='PLAY'));
  if (modeBtnDrawer) modeBtnDrawer.setAttribute('aria-pressed', String(mode!=='PLAY'));
}

function applyOverviewHeader(){
  if(programNameEl && state?.program?.name){
    programNameEl.textContent = state.program.name;
  }
}

function render(){
  if(!state) return;

  // Status labels
  if (statusEl)       statusEl.textContent = state.status || 'LISTENING';
  if (statusElFocus)  statusElFocus.textContent = state.status || 'LISTENING';
  if (statusElDrawer) statusElDrawer.textContent = state.status || 'LISTENING';

  // Sliders
  if (gainSlider && gainVal){
    gainSlider.value = (state.gain ?? 3.0).toFixed(1);
    gainVal.textContent = Number(gainSlider.value).toFixed(1);
  }
  if (typeof state.speaker === 'number' && state.speaker >= 0 && speakerSlider && speakerVal) {
    speakerSlider.value = state.speaker;
    speakerVal.textContent = `${state.speaker}%`;
  }

  // Mode buttons
  applyModeUI();

  // View
  setView(state.view || 'WELCOME');

  if(state.view === 'PROGRAM_PICK'){
    // Only if that screen exists
    fetchPrograms();
  }else if(state.view === 'OVERVIEW'){
    renderCardsOverview();
    applyOverviewHeader();
  }else if(state.view === 'FOCUS'){
    renderFocus();
  }
}

/* ===== Heard overlay ===== */
function showHeardOverlay(text, ms=1100){
  if(!heardOverlay || !heardText) return;
  heardText.textContent = text || '—';
  heardOverlay.classList.add('show');
  clearTimeout(showHeardOverlay._t);
  showHeardOverlay._t = setTimeout(()=> heardOverlay.classList.remove('show'), ms);
}

/* ===== WebSocket ===== */
const ws = new WebSocket((location.protocol==='https:'?'wss://':'ws://') + location.host + '/ws');
ws.onmessage = (e)=>{
  const msg = JSON.parse(e.data);

  if(msg.type==='STATE'){
    state = msg.state;
    render();
  }

  if(msg.type==='CALL'){
    state = msg.state;
    render();
    if((state.mode||'PLAY')==='PLAY' && msg.call){
      showHeardOverlay(String(msg.call));
    }
  }

  if(msg.type==='STATUS'){
    if(state){ state.status = msg.status; render(); }
  }

  if(msg.type==='HEARD' && msg.raw){
    if((state?.mode||'PLAY')==='PLAY'){ showHeardOverlay(String(msg.raw)); }
  }

  if(msg.type==='CONFIG' && msg.key==='gain' && gainSlider && gainVal){
    gainSlider.value = Number(msg.value).toFixed(1);
    gainVal.textContent = Number(msg.value).toFixed(1);
  }

  if(msg.type==='CONFIG' && msg.key==='speaker' && speakerSlider && speakerVal){
    speakerSlider.value = Number(msg.value);
    speakerVal.textContent = `${Number(msg.value)}%`;
  }
};

/* ===== Initial load ===== */
(async function init(){
  try {
    const r = await fetch('/api/state');
    state = await r.json();
  } catch (e) {
    state = null;
  }
  render();
})();
