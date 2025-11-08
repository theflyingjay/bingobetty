/* ===== DOM refs ===== */
const viewWelcome     = document.getElementById('view_welcome');
const viewSetup       = document.getElementById('view_setup');
const viewProgramPick = document.getElementById('view_program_pick');
const viewOverview    = document.getElementById('view_overview');
const viewFocus       = document.getElementById('view_focus');

const btnStart   = document.getElementById('btn_start');
const numgrid    = document.getElementById('numgrid');
const confirmBox = document.getElementById('confirm');
const confirmText= document.getElementById('confirmText');
const btnYes     = document.getElementById('btn_yes');
const btnNo      = document.getElementById('btn_no');
const btnBack = document.getElementById('btn_back');


/* Clean pick UI */
const programPickSub  = document.getElementById('programPickSub');
const programPrompt   = document.getElementById('programPrompt');
const programList     = document.getElementById('programList');

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

const drawer   = document.getElementById('drawer');
const backdrop = document.getElementById('drawerBackdrop');
const gearBtn  = document.getElementById('gearBtn');
const gearBtnWelcome = document.getElementById('gearBtn_welcome');
const gearBtnSetup = document.getElementById('gearBtn_setup');
const gearBtnProgram = document.getElementById('gearBtn_program');
const gearBtnFocus = document.getElementById('gearBtn_focus');

const gainSlider    = document.getElementById('gainSlider');
const gainVal       = document.getElementById('gainVal');
const speakerSlider = document.getElementById('speakerSlider');
const speakerVal    = document.getElementById('speakerVal');

const btnNextGame   = document.getElementById('btn_next_game');
const programNameEl = document.getElementById('program_name');

/* Preview modal */
const previewModal   = document.getElementById('previewModal');
const previewBackdrop= document.getElementById('previewBackdrop');
const previewGrid    = document.getElementById('previewGrid');
const previewDesc    = document.getElementById('previewDesc');
const btnCancelPrev  = document.getElementById('btn_cancel_preview');
const btnSavePrev    = document.getElementById('btn_save_preview');

/* ===== BINGO overlay + action bar (dynamic) ===== */
let bingoOverlay = null;    // container created in ensureBingoOverlay()
let bingoText = null;
let audioLoopTimer = null;  // fallback loop (if server loop absent)
let flashingTimer = null;   // one-shot step timer
let flashingLoop = null;    // continuous loop timer
let bingoShown = false;
let winningInfo = null;     // { cardIdx, cells: [[r,c]...] }
let winnerActionBar = null; // floating "Next Game" / "Play Again" button

/* ===== App state ===== */
let state = null;
let pendingGames = null;
let drawerOpen = false;

let programsCache = [];
let lineup = [];
let tempSelectedProgram = null;
let previewTimer = null;

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
// Wire up all gear buttons to open the drawer
if (gearBtn)         gearBtn.addEventListener('click', openDrawer);
if (gearBtnWelcome)  gearBtnWelcome.addEventListener('click', openDrawer);
if (gearBtnSetup)    gearBtnSetup.addEventListener('click', openDrawer);
if (gearBtnProgram)  gearBtnProgram.addEventListener('click', openDrawer);
if (gearBtnFocus)    gearBtnFocus.addEventListener('click', openDrawer);
if (backdrop)        backdrop.addEventListener('click', closeDrawer);

/* ===== View switching ===== */
function setView(name){
  [viewWelcome, viewSetup, viewProgramPick, viewOverview, viewFocus]
    .filter(Boolean).forEach(el=> el.classList.remove('active'));

  if(name==='WELCOME'      && viewWelcome)     viewWelcome.classList.add('active');
  if(name==='SETUP_GAMES'  && viewSetup)       viewSetup.classList.add('active');
  if(name==='PROGRAM_PICK' && viewProgramPick){ 
    viewProgramPick.classList.add('active');
    viewProgramPick.style.display = '';
  }
  if(name==='OVERVIEW'     && viewOverview)    viewOverview.classList.add('active');
  if(name==='FOCUS'        && viewFocus)       viewFocus.classList.add('active');
}

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

/* ===== Program pick ===== */
async function fetchPrograms(){
  const r = await fetch('/api/programs');
  const data = await r.json();
  programsCache = data.programs || [];
  if (data.session && Array.isArray(data.session.lineup)) {
    lineup = [...data.session.lineup];
  } else if (state && Array.isArray(state.session_lineup)) {
    lineup = [...state.session_lineup];
  }
  updateProgramPickUI();
}
function updateProgramPickUI(){
  if(!viewProgramPick) return;
  if (state && Array.isArray(state.session_lineup) && state.session_lineup.length >= lineup.length) {
    lineup = [...state.session_lineup];
  }
  const total  = (state?.session_total_games) || 0;
  const chosen = lineup.length;
  if (programPickSub) programPickSub.textContent = `Choose ${total} total • chosen ${chosen}`;
  const nextNum = Math.min(chosen + 1, Math.max(total, 1));
  if (programPrompt) programPrompt.textContent = `What type is Game ${nextNum}?`;

  if (programList){
    programList.innerHTML = '';
    programsCache.forEach(p=>{
      const btn = document.createElement('button');
      btn.className = 'program-btn';
      btn.textContent = p.name;
      btn.onclick = ()=> openProgramPreview(p);
      programList.appendChild(btn);
    });
  }
}

/* ===== Preview Modal + Animation ===== */
function openProgramPreview(program){
  tempSelectedProgram = program;
  stopPreviewAnim();

  if (previewDesc) previewDesc.textContent = program.desc || '';
  if (previewGrid){
    previewGrid.innerHTML = '';
    buildPreviewGrid(previewGrid);
    runPreviewAnimation(program);
  }

  previewModal?.classList.add('open');
  previewBackdrop?.classList.add('show');
  previewModal?.setAttribute('aria-hidden','false');
}
function closeProgramPreview(){
  stopPreviewAnim();
  previewModal?.classList.remove('open');
  previewBackdrop?.classList.remove('show');
  previewModal?.setAttribute('aria-hidden','true');
  tempSelectedProgram = null;
}
if (btnCancelPrev) btnCancelPrev.onclick = closeProgramPreview;
if (previewBackdrop) previewBackdrop.onclick = closeProgramPreview;

/* Save: auto-advance & auto-start when lineup complete */
if (btnSavePrev){
  btnSavePrev.onclick = async ()=>{
    if(!tempSelectedProgram) return;

    lineup.push(tempSelectedProgram.key);
    try {
      await fetch('/api/session/lineup',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({lineup})
      });
    } catch(e){}

    const chosenNum = lineup.length;
    say(`${tempSelectedProgram.name} saved for game ${chosenNum}.`);
    closeProgramPreview();

    const total = state?.session_total_games || 0;
    if (total > 0 && chosenNum >= total){
      try { await fetch('/api/session/start',{method:'POST'}); } catch(e){}
      return;
    }
    updateProgramPickUI();
  };
}

/* Preview grid */
function buildPreviewGrid(container){
  const letters = ['B','I','N','G','O'];
  for (let i=0;i<5;i++){
    const hdr = document.createElement('div');
    hdr.className = 'p-cell hdr';
    hdr.textContent = letters[i];
    container.appendChild(hdr);
  }
  for (let r=0;r<5;r++){
    for (let c=0;c<5;c++){
      const cell = document.createElement('div');
      cell.className = 'p-cell';
      cell.dataset.r = r;
      cell.dataset.c = c;
      container.appendChild(cell);
    }
  }
}
function previewCellAt(container, r, c){
  const idx = 5 + r*5 + c;
  return container.children[idx];
}
function setCells(container, coords, on=true, blink=false){
  coords.forEach(([r,c])=>{
    const el = previewCellAt(container, r, c);
    if (!el) return;
    if (on) el.classList.add('on'); else el.classList.remove('on');
    if (blink){
      el.classList.remove('blink');
      el.offsetHeight;
      el.classList.add('blink');
    }
  });
}
function animateClassic(container){
  const seq = [
    {cells: [[0,0],[1,0],[2,0],[3,0],[4,0]]},
    {cells: [[0,0],[0,1],[0,2],[0,3],[0,4]]},
    {cells: [[0,0],[1,1],[2,2],[3,3],[4,4]]},
  ];
  let step = 0;
  const run = ()=>{
    for(let r=0;r<5;r++) for(let c=0;c<5;c++) setCells(container, [[r,c]], false, false);
    const {cells} = seq[step];
    setCells(container, cells, true, true);
    step = (step+1) % seq.length;
  };
  run();
  previewTimer = setInterval(run, 650);
}
function animateFixedShape(container, cells){
  let on = false;
  const run = ()=>{
    for(let r=0;r<5;r++) for(let c=0;c<5;c++) setCells(container, [[r,c]], false, false);
    on = !on;
    setCells(container, cells || [], on, true);
  };
  run();
  previewTimer = setInterval(run, 550);
}
function runPreviewAnimation(program){
  if (!previewGrid) return;
  const key = String(program.key || '').toUpperCase();
  
  // Check if this is a custom game with patterns
  if (program.patterns && Array.isArray(program.patterns) && program.patterns.length > 0){
    // Use the same pattern animation as the game editor
    animateCustomPatterns(previewGrid, program.patterns);
  } else if (key === 'CLASSIC' || key === 'HARD_WAYS'){
    animateClassic(previewGrid);
  } else {
    animateFixedShape(previewGrid, program.preview_cells || []);
  }
}

function animateCustomPatterns(container, patterns){
  if (!patterns || patterns.length === 0) return;
  
  let currentPatternIdx = 0;
  
  const renderPattern = (pattern) => {
    // Clear all cells first
    for (let r = 0; r < 5; r++){
      for (let c = 0; c < 5; c++){
        const idx = 5 + r * 5 + c; // Skip header row
        const cell = container.children[idx];
        if (cell){
          cell.classList.remove('marked', 'blink');
          cell.classList.remove('included', 'excluded');
          cell.innerHTML = '';
          // Reset FREE cell
          if (r === 2 && c === 2){
            cell.textContent = 'FREE';
            cell.classList.add('free');
          }
        }
      }
    }
    
    // Mark included cells (excluding excluded positions)
    const patternCells = pattern.cells || [];
    const excluded = pattern.excluded || [];
    
    for (const [r, c] of patternCells){
      // Skip if position is in excluded list
      if (excluded.some(([er, ec]) => er === r && ec === c)) continue;
      
      const idx = 5 + r * 5 + c; // Skip header row
      const cell = container.children[idx];
      if (cell){
        cell.classList.add('marked', 'blink');
        // Add included class for green styling (if CSS supports it)
        if (!cell.classList.contains('included')){
          cell.classList.add('included');
        }
        // Don't overwrite FREE text
        if (!(r === 2 && c === 2)){
          cell.textContent = '';
        }
      }
    }
    
    // Mark excluded cells with X
    for (const [r, c] of excluded){
      const idx = 5 + r * 5 + c; // Skip header row
      const cell = container.children[idx];
      if (cell){
        cell.classList.add('excluded');
        cell.innerHTML = '<span class="excluded-x">✕</span>';
      }
    }
  };
  
  const animate = () => {
    if (currentPatternIdx >= patterns.length) currentPatternIdx = 0;
    renderPattern(patterns[currentPatternIdx]);
    currentPatternIdx++;
  };
  
  // Initial render
  animate();
  
  // Animate every 1.5 seconds (same as game editor)
  previewTimer = setInterval(animate, 1500);
}
function stopPreviewAnim(){
  if (previewTimer){ clearInterval(previewTimer); previewTimer = null; }
}

/* ===== Pattern-based win detection ===== */
const LETTERS = ['B','I','N','G','O'];

function cellIsMarked(card, r, c){
  if (r===2 && c===2) return !!card.marks['FREE'];
  const L = LETTERS[c];
  const n = card.cols[L][r];
  return !!card.marks[L+String(n)];
}
function classicWinCells(card){
  for (let r=0;r<5;r++){
    let ok=true; for (let c=0;c<5;c++){ if(!cellIsMarked(card,r,c)) {ok=false; break;} }
    if (ok) return Array.from({length:5},(_,i)=>[r,i]);
  }
  for (let c=0;c<5;c++){
    let ok=true; for (let r=0;r<5;r++){ if(!cellIsMarked(card,r,c)) {ok=false; break;} }
    if (ok) return Array.from({length:5},(_,i)=>[i,c]);
  }
  let okDiag=true; for (let i=0;i<5;i++){ if(!cellIsMarked(card,i,i)) {okDiag=false; break;} }
  if (okDiag) return Array.from({length:5},(_,i)=>[i,i]);
  let okDiag2=true; for (let i=0;i<5;i++){ if(!cellIsMarked(card,i,4-i)) {okDiag2=false; break;} }
  if (okDiag2) return Array.from({length:5},(_,i)=>[i,4-i]);
  return null;
}
function fixedShapeWinCells(card, shapeCells){
  if (!Array.isArray(shapeCells) || !shapeCells.length) return null;
  for (const [r,c] of shapeCells){
    if(!cellIsMarked(card,r,c)) return null;
  }
  return shapeCells.slice();
}
function coverallWinCells(card){
  for (let r=0;r<5;r++){
    for (let c=0;c<5;c++){
      if(!cellIsMarked(card,r,c)) return null;
    }
  }
  return Array.from({length:25}, (_,k)=>[Math.floor(k/5), k%5]);
}
function customPatternWinCells(card, patterns, allowedPositions, disallowedPositions){
  if (!Array.isArray(patterns) || !patterns.length) return null;
  
  // Check each pattern - return as soon as ONE pattern matches (only 1 pattern needs to win)
  for (const pattern of patterns){
    const patternCells = pattern.cells || [];
    const excluded = pattern.excluded || [];
    
    // Check if all pattern cells are marked (excluding excluded positions)
    let allMarked = true;
    const matchedCells = [];
    
    for (const [r, c] of patternCells){
      // Skip if position is in excluded list
      if (excluded.some(([er, ec]) => er === r && ec === c)) continue;
      
      // Check if position is disallowed globally
      if (disallowedPositions && disallowedPositions.length > 0){
        if (disallowedPositions.some(([dr, dc]) => dr === r && dc === c)) continue;
      }
      
      // Check if position is allowed (if allowed list exists and is not empty)
      if (allowedPositions && allowedPositions.length > 0){
        if (!allowedPositions.some(([ar, ac]) => ar === r && ac === c)) continue;
      }
      
      // Check if this cell is marked
      const isMarked = cellIsMarked(card, r, c);
      if (!isMarked){
        console.log(`[DEBUG] Cell [${r},${c}] not marked`);
        allMarked = false;
        break;
      }
      matchedCells.push([r, c]);
    }
    
    // If all required cells in this pattern are marked, return immediately (only 1 pattern needs to match)
    if (allMarked && matchedCells.length > 0){
      return matchedCells;
    }
  }
  return null;
}

function detectWinOnState(st){
  if (!st || !st.cards || !st.program) return null;
  const kind = (st.program.kind||'').toLowerCase();
  const preview = st.program.preview_cells || [];
  
  // For custom games, check allowed numbers first
  if (kind === 'custom'){
    const allowedNumbers = st.program.allowed_numbers || [];
    const disallowedNumbers = st.program.disallowed_numbers || [];
    
    // Get all numbers that have been called
    const calledNumbers = new Set();
    for (const card of st.cards){
      for (const call of (card.calls || [])){
        // Parse call like "B12" -> 12
        const match = call.match(/^[BINGO](\d+)$/);
        if (match){
          const num = parseInt(match[1]);
          if (num > 0 && num <= 75){
            calledNumbers.add(num);
          }
        }
      }
    }
    
    // Check if any disallowed numbers were called
    if (disallowedNumbers.length > 0){
      for (const num of calledNumbers){
        if (disallowedNumbers.includes(num)){
          return null; // Disallowed number was called, no win
        }
      }
    }
    
    // Check if all called numbers are in allowed list (if allowed list exists and is not empty)
    if (allowedNumbers.length > 0){
      for (const num of calledNumbers){
        if (!allowedNumbers.includes(num)){
          return null; // A called number is not in allowed list, no win
        }
      }
    }
  }
  
  // Check each card - return as soon as ONE card wins (only 1 card needs to win)
  for (let idx=0; idx<st.cards.length; idx++){
    const card = st.cards[idx];
    let cells = null;
    if (kind === 'classic'){
      cells = classicWinCells(card);
    } else if (kind === 'fixed_shape'){
      cells = fixedShapeWinCells(card, preview);
    } else if (kind === 'special_number' || kind === 'odd_even'){
      cells = coverallWinCells(card);
    } else if (kind === 'custom'){
      // Custom pattern matching - only 1 pattern needs to match on this card
      const patterns = st.program.patterns || [];
      const allowedPositions = st.program.allowed_positions || [];
      const disallowedPositions = st.program.disallowed_positions || [];
      
      // Debug logging
      console.log('[DEBUG] Checking custom pattern win:', {
        patternsCount: patterns.length,
        patterns: patterns.map(p => ({cells: p.cells?.length || 0, excluded: p.excluded?.length || 0})),
        allowedPositions: allowedPositions.length,
        disallowedPositions: disallowedPositions.length,
        cardMarks: Object.keys(card.marks || {}).length
      });
      
      cells = customPatternWinCells(card, patterns, allowedPositions, disallowedPositions);
      
      if (cells) {
        console.log('[DEBUG] Win detected! Matched cells:', cells);
      }
    }
    // Return immediately when a win is found on any card (only 1 card needs to win)
    if (cells && cells.length){
      return {cardIdx: idx, cells};
    }
  }
  return null;
}

/* ===== BINGO overlay, audio, flashing, and actions ===== */
function ensureBingoOverlay(){
  if (bingoOverlay) return;
  bingoOverlay = document.createElement('div');
  bingoOverlay.className = 'bingo-overlay';
  Object.assign(bingoOverlay.style, {
    position:'fixed', inset:'0', background:'rgba(0,0,0,0.75)', display:'none',
    zIndex:'80', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:'20px'
  });

  bingoText = document.createElement('div');
  bingoText.className = 'bingo-text';
  Object.assign(bingoText.style, {
    fontWeight:'900', letterSpacing:'6px', fontSize:'min(15vw, 120px)',
    color:'#9acbff', textShadow:'0 0 16px rgba(154,203,255,.6)'
  });
  bingoText.textContent = 'B I N G O !';

  const hint = document.createElement('div');
  hint.textContent = 'Tap anywhere to confirm';
  Object.assign(hint.style, {color:'#eaf2ff', opacity:'.9', fontSize:'18px'});

  bingoOverlay.appendChild(bingoText);
  bingoOverlay.appendChild(hint);
  document.body.appendChild(bingoOverlay);

  // Tap: stop audio, hide big BINGO immediately, start continuous flashing loop
  bingoOverlay.addEventListener('click', async ()=>{
    await stopWinnerAudioFallback();
    hideBingoOverlay();              // hide BIG BINGO right away
    if (winningInfo) startFlashingLoop(winningInfo.cardIdx, winningInfo.cells);
    showWinnerActionBar();           // show Next Game / Play Again
  });

  // subtle bounce
  setInterval(()=>{
    if (bingoOverlay.style.display==='none') return;
    bingoText.style.transform = 'scale(1.05)';
    setTimeout(()=>{ bingoText.style.transform = 'scale(1)'; }, 180);
  }, 420);
}
function showBingoOverlay(){
  ensureBingoOverlay();
  bingoOverlay.classList.add('show');      // <- use class instead of style
  bingoOverlay.style.display = 'flex';      // (optional: keep for older css)
  bingoShown = true;
}
function hideBingoOverlay(){
  if (!bingoOverlay) return;
  bingoOverlay.classList.remove('show');   // <- remove class
  bingoOverlay.style.display = 'none';
}

async function startWinnerAudioFallback(){
  try{
    const r = await fetch('/api/winner/start', {method:'POST'});
    const j = await r.json();
    if (j && j.ok) return; // server loop engaged
  }catch(e){}
  try { await fetch('/api/audio/jingle', {method:'POST'}); } catch(e){}
  clearInterval(audioLoopTimer);
  audioLoopTimer = setInterval(async ()=>{
    try { await fetch('/api/audio/jingle', {method:'POST'}); } catch(e){}
  }, 3500);
}
async function stopWinnerAudioFallback(){
  clearInterval(audioLoopTimer);
  audioLoopTimer = null;
  // Stop the backend winner.wav loop
  try {
    await fetch('/api/winner/stop_audio', {method:'POST'});
  } catch(e){}
}

/* One-time step flash used previously (kept for internal calls) */
function slowFlashWinningCells(cardIdx, cells, done){
  if (viewOverview && viewOverview.classList.contains('active')) focusCard(cardIdx);
  let i = 0;
  const applyOne = ()=>{
    const container = (viewFocus && viewFocus.classList.contains('active')) ? focusGrid : null;
    if (!container){ if (done) done(); return; }
    const lettersHeaderCount = 5;
    if (i < cells.length){
      const [r,c] = cells[i];
      const idx = lettersHeaderCount + r*5 + c;
      const el = container.children[idx];
      if (el){
        el.classList.remove('win');
        el.offsetHeight;
        el.classList.add('win');
      }
      i++;
      flashingTimer = setTimeout(applyOne, 260);
    } else {
      if (done) done();
    }
  };
  setTimeout(applyOne, 180);
}

/* NEW: continuous loop flashing until a button is pressed */
function startFlashingLoop(cardIdx, cells){
  stopFlashingLoop(); // clear any previous
  if (viewOverview && viewOverview.classList.contains('active')) focusCard(cardIdx);

  // After focus render, start a looping sequence
  setTimeout(()=>{
    const stepDuration = 300;
    let i = 0;
    flashingLoop = setInterval(()=>{
      const container = (viewFocus && viewFocus.classList.contains('active')) ? focusGrid : null;
      if (!container){ stopFlashingLoop(); return; }
      const [r,c] = cells[i % cells.length];
      const idx = 5 + r*5 + c;
      const el = container.children[idx];
      if (el){
        el.classList.remove('win');
        el.offsetHeight;
        el.classList.add('win');
      }
      i++;
    }, stepDuration);
  }, 180);
}
function stopFlashingLoop(){
  clearInterval(flashingLoop);
  flashingLoop = null;
  clearTimeout(flashingTimer);
  flashingTimer = null;
}

/* Floating action bar: Next Game / Play Again */
function showWinnerActionBar(){
  removeWinnerActionBar();
  winnerActionBar = document.createElement('div');
  Object.assign(winnerActionBar.style, {
    position:'fixed', left:'50%', bottom:'14px', transform:'translateX(-50%)',
    zIndex:'81', display:'flex', gap:'10px'
  });

  const total = Number(state?.session_total_games || 0);
  const idx   = Number(state?.current_game_idx || 0);
  const moreGames = total > 0 && (idx + 1) < total;

  const btn = document.createElement('button');
  btn.className = 'btn next big';
  btn.textContent = moreGames ? 'Next Game' : 'Play Again';
  btn.onclick = async ()=>{
    stopFlashingLoop();
    if (moreGames){
      await nextGame(); // server advances + resets state
    } else {
      // restart back to "How many games?" flow - clear all win state
      bingoShown = false;
      winningInfo = null;
      stopFlashingLoop();
      clearInterval(audioLoopTimer);
      audioLoopTimer = null;
      hideBingoOverlay();
      lineup = []; // Clear lineup so new games can be selected
      await fetch('/api/start', {method:'POST'});
    }
    removeWinnerActionBar();
  };

  winnerActionBar.appendChild(btn);
  document.body.appendChild(winnerActionBar);
}
function removeWinnerActionBar(){
  if (winnerActionBar && winnerActionBar.parentNode){
    winnerActionBar.parentNode.removeChild(winnerActionBar);
  }
  winnerActionBar = null;
}

/* ===== Next game button (toolbar) ===== */
async function nextGame(){
  try{
    await fetch('/api/winner/stop',{method:'POST'}); // on your server this advances
  }catch(e){
    await fetch('/api/game/next',{method:'POST'});
  }finally{
    // Clear all win state
    bingoShown = false;
    winningInfo = null;
    stopFlashingLoop();
    clearInterval(audioLoopTimer);
    audioLoopTimer = null;
    hideBingoOverlay();
    removeWinnerActionBar();
  }
}
if (btnNextGame) btnNextGame.onclick = nextGame;

/* ===== Gain & Speaker ===== */
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

/* ===== API helpers ===== */
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
if (btnBack) btnBack.onclick = () => focusNone();


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
    tap.className = 'tap';
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
function maybeTriggerBingo(){
  if (bingoShown) return;
  winningInfo = detectWinOnState(state);
  if (!winningInfo) return;
  showBingoOverlay();
  startWinnerAudioFallback();
}
function render(){
  if(!state) return;

  if (statusEl)       statusEl.textContent = state.status || 'LISTENING';
  if (statusElFocus)  statusElFocus.textContent = state.status || 'LISTENING';
  if (statusElDrawer) statusElDrawer.textContent = state.status || 'LISTENING';

  if (gainSlider && gainVal){
    gainSlider.value = (state.gain ?? 3.0).toFixed(1);
    gainVal.textContent = Number(gainSlider.value).toFixed(1);
  }
  if (typeof state.speaker === 'number' && state.speaker >= 0 && speakerSlider && speakerVal) {
    speakerSlider.value = state.speaker;
    speakerVal.textContent = `${state.speaker}%`;
  }

  applyModeUI();

  if (Array.isArray(state.session_lineup)) {
    lineup = [...state.session_lineup];
  }

  setView(state.view || 'WELCOME');

  if(state.view === 'PROGRAM_PICK'){
    fetchPrograms();
  }else if(state.view === 'OVERVIEW'){
    renderCardsOverview();
    applyOverviewHeader();
    ensureBingoOverlay();
    maybeTriggerBingo();
  }else if(state.view === 'FOCUS'){
    renderFocus();
    ensureBingoOverlay();
    maybeTriggerBingo();
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

/* ===== Game Editor ===== */
let gameEditorState = {
  currentGame: null,
  editingPattern: null,
  games: []
};

const gameEditorModal = document.getElementById('gameEditorModal');
const gameEditorBackdrop = document.getElementById('gameEditorBackdrop');
const gameList = document.getElementById('gameList');
const patternsList = document.getElementById('patterns_list');

function openGameEditor(){
  if (!gameEditorModal || !gameEditorBackdrop) return;
  gameEditorModal.classList.add('open');
  gameEditorBackdrop.classList.add('show');
  gameEditorModal.setAttribute('aria-hidden', 'false');
  loadGamesList();
  switchTab('list');
}

function closeGameEditor(){
  if (!gameEditorModal || !gameEditorBackdrop) return;
  gameEditorModal.classList.remove('open');
  gameEditorBackdrop.classList.remove('show');
  gameEditorModal.setAttribute('aria-hidden', 'true');
  gameEditorState.currentGame = null;
  gameEditorState.editingPattern = null;
  stopPatternsPreview();
}

if (gameEditorBackdrop) gameEditorBackdrop.addEventListener('click', closeGameEditor);

function switchTab(tabName){
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

async function loadGamesList(){
  try {
    const r = await fetch('/api/games/editor');
    const data = await r.json();
    gameEditorState.games = data.games || [];
    renderGamesList();
  } catch(e){
    console.error('Failed to load games:', e);
  }
}

function renderGamesList(){
  if (!gameList) return;
  gameList.innerHTML = '';
  gameEditorState.games.forEach(game => {
    const item = document.createElement('div');
    item.className = 'game-item';
    const isCustom = game.is_custom;
    item.innerHTML = `
      <div class="game-item-info">
        <div class="game-item-name">${game.name || game.key}</div>
        <div class="game-item-desc">${game.desc || ''}</div>
      </div>
      <div class="game-item-actions">
        <button class="btn small" onclick="editGame('${game.key}')">Edit</button>
        <button class="btn small danger" onclick="confirmDeleteGame('${game.key}')">Delete</button>
      </div>
    `;
    gameList.appendChild(item);
  });
}

async function editGame(key){
  try {
    const r = await fetch(`/api/games/editor/${key}`);
    const data = await r.json();
    if (!data.ok) {
      alert('Failed to load game: ' + (data.error || 'Unknown error'));
      return;
    }
    gameEditorState.currentGame = data.game;
    stopPatternsPreview();
    loadGameIntoEditor(data.game);
    switchTab('edit');
  } catch(e){
    alert('Failed to load game: ' + e.message);
  }
}

function viewGame(key){
  editGame(key);

  const keyEl  = document.getElementById('editor_key');
  if (keyEl) keyEl.disabled = true;

  const delBtn = document.getElementById('btn_delete_game');
  if (delBtn) delBtn.style.display = 'none';
  const saveBtn = document.querySelector('#tab-edit .editor-actions .btn.primary');
  if (saveBtn) saveBtn.style.display = 'none';
}

function createNewGame(){
  gameEditorState.currentGame = null;
  stopPatternsPreview();
  loadGameIntoEditor({
    key: '',
    name: '',
    desc: '',
    allowed_numbers: [],
    disallowed_numbers: [],
    allowed_positions: [],
    disallowed_positions: [],
    patterns: [],
    free_enabled: true
  });
  document.getElementById('editor_key').disabled = false;
  document.getElementById('btn_delete_game').style.display = 'none';
  switchTab('edit');
}

function loadGameIntoEditor(game){
  document.getElementById('editor_key').value = game.key || '';
  document.getElementById('editor_name').value = game.name || '';
  document.getElementById('editor_desc').value = game.desc || '';
  document.getElementById('editor_allowed_numbers').value = (game.allowed_numbers || []).join(',');
  document.getElementById('editor_disallowed_numbers').value = (game.disallowed_numbers || []).join(',');
  
  // Set free space toggle
  const freeEnabled = game.free_enabled !== undefined ? game.free_enabled : (game.params?.free_enabled !== undefined ? game.params.free_enabled : true);
  if (!gameEditorState.currentGame) gameEditorState.currentGame = {};
  gameEditorState.currentGame.free_enabled = freeEnabled;
  gameEditorState.currentGame.is_custom = game.is_custom;
  updateFreeSpaceToggle(freeEnabled);
  
  // Convert preview_cells to patterns if needed
  let patterns = game.patterns || [];
  if (!patterns.length && game.preview_cells && game.preview_cells.length > 0){
    patterns = [{"cells": game.preview_cells, "excluded": []}];
  }
  renderPatterns(patterns);
  
  // Show delete button only for custom games
  document.getElementById('btn_delete_game').style.display = game.is_custom ? 'inline-block' : 'none';
  // Enable key editing for new games, disable for existing ones
  document.getElementById('editor_key').disabled = !!game.key;
}

function toggleFreeSpace(){
  if (!gameEditorState.currentGame) gameEditorState.currentGame = {};
  gameEditorState.currentGame.free_enabled = !gameEditorState.currentGame.free_enabled;
  updateFreeSpaceToggle(gameEditorState.currentGame.free_enabled);
}

function updateFreeSpaceToggle(enabled){
  const btn = document.getElementById('editor_free_enabled');
  const status = document.getElementById('free_space_status');
  if (btn && status){
    btn.classList.toggle('active', enabled);
    status.textContent = enabled ? 'Enabled' : 'Disabled';
    btn.style.background = enabled ? 'var(--green)' : '#4d1a1a';
  }
}

let patternsPreviewTimer = null;

function renderPatterns(patterns){
  if (!patternsList) return;
  patternsList.innerHTML = '';
  patterns.forEach((pattern, idx) => {
    const patternDiv = document.createElement('div');
    patternDiv.className = 'pattern-item';
    patternDiv.innerHTML = `
      <div class="pattern-header">
        <span>Pattern ${idx + 1}</span>
        <button class="btn small" onclick="editPattern(${idx})">Edit</button>
        <button class="btn small danger" onclick="deletePattern(${idx})">Delete</button>
      </div>
      <div class="pattern-preview-grid" id="pattern-preview-${idx}"></div>
    `;
    patternsList.appendChild(patternDiv);
    renderPatternGrid(`pattern-preview-${idx}`, pattern);
  });
  
  // Update animated preview
  startPatternsPreview(patterns);
}

function startPatternsPreview(patterns){
  stopPatternsPreview();
  if (!patterns || patterns.length === 0){
    clearPatternsPreview();
    return;
  }
  
  let currentPatternIdx = 0;
  const previewGrid = document.getElementById('patternsPreviewGrid');
  if (!previewGrid) return;
  
  const animate = () => {
    if (currentPatternIdx >= patterns.length) currentPatternIdx = 0;
    renderPatternsPreviewGrid(patterns[currentPatternIdx]);
    currentPatternIdx++;
  };
  
  // Initial render
  animate();
  
  // Animate every 1.5 seconds
  patternsPreviewTimer = setInterval(animate, 1500);
}

function stopPatternsPreview(){
  if (patternsPreviewTimer){
    clearInterval(patternsPreviewTimer);
    patternsPreviewTimer = null;
  }
}

function clearPatternsPreview(){
  const previewGrid = document.getElementById('patternsPreviewGrid');
  if (!previewGrid) return;
  previewGrid.innerHTML = '';
  const letters = ['B','I','N','G','O'];
  // Add headers
  for (let i = 0; i < 5; i++){
    const hdr = document.createElement('div');
    hdr.className = 'p-cell hdr';
    hdr.textContent = letters[i];
    previewGrid.appendChild(hdr);
  }
  // Add empty cells
  for (let r = 0; r < 5; r++){
    for (let c = 0; c < 5; c++){
      const cell = document.createElement('div');
      cell.className = 'p-cell';
      if (r === 2 && c === 2){
        cell.textContent = 'FREE';
        cell.classList.add('free');
      }
      previewGrid.appendChild(cell);
    }
  }
}

function renderPatternsPreviewGrid(pattern){
  const previewGrid = document.getElementById('patternsPreviewGrid');
  if (!previewGrid) return;
  previewGrid.innerHTML = '';
  
  const letters = ['B','I','N','G','O'];
  
  // Add column headers
  for (let i = 0; i < 5; i++){
    const hdr = document.createElement('div');
    hdr.className = 'p-cell hdr';
    hdr.textContent = letters[i];
    previewGrid.appendChild(hdr);
  }
  
  // Add cells
  for (let r = 0; r < 5; r++){
    for (let c = 0; c < 5; c++){
      const cell = document.createElement('div');
      cell.className = 'p-cell preview-cell';
      
      const isIncluded = pattern.cells?.some(([pr, pc]) => pr === r && pc === c);
      const isExcluded = pattern.excluded?.some(([er, ec]) => er === r && ec === c);
      
      // Mark center as FREE
      if (r === 2 && c === 2){
        cell.textContent = 'FREE';
        cell.classList.add('free');
      }
      
      if (isIncluded) {
        cell.classList.add('included');
      }
      if (isExcluded) {
        cell.classList.add('excluded');
        cell.innerHTML = '<span class="excluded-x">✕</span>';
      }
      
      previewGrid.appendChild(cell);
    }
  }
}

function renderPatternGrid(containerId, pattern){
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const letters = ['B','I','N','G','O'];
  
  // Add column headers
  for (let i = 0; i < 5; i++){
    const hdr = document.createElement('div');
    hdr.className = 'p-cell hdr';
    hdr.textContent = letters[i];
    container.appendChild(hdr);
  }
  
  // Add cells
  for (let r = 0; r < 5; r++){
    for (let c = 0; c < 5; c++){
      const cell = document.createElement('div');
      cell.className = 'p-cell preview-cell';
      
      const isIncluded = pattern.cells?.some(([pr, pc]) => pr === r && pc === c);
      const isExcluded = pattern.excluded?.some(([er, ec]) => er === r && ec === c);
      
      // Mark center as FREE
      if (r === 2 && c === 2){
        cell.textContent = 'FREE';
        cell.classList.add('free');
      }
      
      if (isIncluded) {
        cell.classList.add('included');
      }
      if (isExcluded) {
        cell.classList.add('excluded');
        cell.innerHTML = '<span class="excluded-x">✕</span>';
      }
      
      cell.dataset.r = r;
      cell.dataset.c = c;
      container.appendChild(cell);
    }
  }
}

function addPattern(){
  if (!gameEditorState.currentGame) gameEditorState.currentGame = {patterns: []};
  if (!gameEditorState.currentGame.patterns) gameEditorState.currentGame.patterns = [];
  gameEditorState.currentGame.patterns.push({cells: [], excluded: []});
  renderPatterns(gameEditorState.currentGame.patterns);
  editPattern(gameEditorState.currentGame.patterns.length - 1);
}

function editPattern(idx){
  if (!gameEditorState.currentGame || !gameEditorState.currentGame.patterns) return;
  gameEditorState.editingPattern = idx;
  openPatternEditor(gameEditorState.currentGame.patterns[idx]);
}

function deletePattern(idx){
  if (!gameEditorState.currentGame || !gameEditorState.currentGame.patterns) return;
  if (confirm('Delete this pattern?')){
    gameEditorState.currentGame.patterns.splice(idx, 1);
    renderPatterns(gameEditorState.currentGame.patterns);
  }
}

function openPatternEditor(pattern){
  // Create pattern editor modal
  const editor = document.createElement('div');
  editor.className = 'pattern-editor-modal';
  editor.innerHTML = `
    <div class="pattern-editor-content">
      <h3>Edit Pattern</h3>
      <div class="pattern-editor-hint">Left-click to include cells, Right-click to exclude cells</div>
      <div class="pattern-editor-grid" id="patternEditorGrid"></div>
      <div class="pattern-editor-controls">
        <button class="btn" onclick="closePatternEditor()">Cancel</button>
        <button class="btn primary" onclick="savePattern()">Save Pattern</button>
      </div>
    </div>
  `;
  document.body.appendChild(editor);
  renderPatternEditorGrid(pattern);
}

function renderPatternEditorGrid(pattern){
  const grid = document.getElementById('patternEditorGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const letters = ['B','I','N','G','O'];
  
  // Add empty corner cell
  const corner = document.createElement('div');
  corner.className = 'p-cell hdr';
  grid.appendChild(corner);
  
  // Add column headers
  for (let i = 0; i < 5; i++){
    const hdr = document.createElement('div');
    hdr.className = 'p-cell hdr';
    hdr.textContent = letters[i];
    grid.appendChild(hdr);
  }
  
  // Add rows with row numbers and cells
  for (let r = 0; r < 5; r++){
    // Row number header
    const rowHdr = document.createElement('div');
    rowHdr.className = 'p-cell hdr';
    rowHdr.textContent = r + 1;
    grid.appendChild(rowHdr);
    
    // Cells for this row
    for (let c = 0; c < 5; c++){
      const cell = document.createElement('div');
      cell.className = 'p-cell pattern-cell';
      const isIncluded = pattern.cells?.some(([pr, pc]) => pr === r && pc === c);
      const isExcluded = pattern.excluded?.some(([er, ec]) => er === r && ec === c);
      
      // Mark center as FREE
      if (r === 2 && c === 2){
        cell.textContent = 'FREE';
        cell.classList.add('free-cell');
      }
      
      if (isIncluded) {
        cell.classList.add('included');
      }
      if (isExcluded) {
        cell.classList.add('excluded');
        cell.innerHTML = '<span class="excluded-x">✕</span>';
      }
      
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.onclick = (e) => {
        e.preventDefault();
        togglePatternCell(r, c, pattern, false);
      };
      cell.oncontextmenu = (e) => {
        e.preventDefault();
        togglePatternCell(r, c, pattern, true);
        return false;
      };
      grid.appendChild(cell);
    }
  }
}

function togglePatternCell(r, c, pattern, isRightClick = false){
  if (!pattern.cells) pattern.cells = [];
  if (!pattern.excluded) pattern.excluded = [];
  
  const cellIdx = pattern.cells.findIndex(([pr, pc]) => pr === r && pc === c);
  const exclIdx = pattern.excluded.findIndex(([er, ec]) => er === r && ec === c);
  
  if (isRightClick){
    // Right-click toggles excluded state
    if (exclIdx >= 0){
      pattern.excluded.splice(exclIdx, 1);
    } else {
      // Remove from included if present
      if (cellIdx >= 0) pattern.cells.splice(cellIdx, 1);
      pattern.excluded.push([r, c]);
    }
  } else {
    // Left-click toggles included state
    if (cellIdx >= 0){
      // Remove from included
      pattern.cells.splice(cellIdx, 1);
    } else {
      // Remove from excluded if present
      if (exclIdx >= 0) pattern.excluded.splice(exclIdx, 1);
      pattern.cells.push([r, c]);
    }
  }
  renderPatternEditorGrid(pattern);
}

function savePattern(){
  if (gameEditorState.editingPattern !== null && gameEditorState.currentGame){
    renderPatterns(gameEditorState.currentGame.patterns);
  }
  closePatternEditor();
}

function closePatternEditor(){
  const editor = document.querySelector('.pattern-editor-modal');
  if (editor) editor.remove();
  gameEditorState.editingPattern = null;
}

async function saveGame(){
  const key = document.getElementById('editor_key').value.trim().toUpperCase();
  const name = document.getElementById('editor_name').value.trim();
  const desc = document.getElementById('editor_desc').value.trim();
  // Parse allowed numbers - support both comma-separated and range notation (e.g., "1-75")
  const parseNumbers = (value) => {
    const numbers = [];
    const parts = value.split(',').map(s => s.trim()).filter(s => s);
    for (const part of parts) {
      if (part.includes('-')) {
        // Range notation like "1-75"
        const [start, end] = part.split('-').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        if (start && end && start >= 1 && end <= 75 && start <= end) {
          for (let i = start; i <= end; i++) {
            numbers.push(i);
          }
        }
      } else {
        // Single number
        const num = parseInt(part);
        if (!isNaN(num) && num >= 1 && num <= 75) {
          numbers.push(num);
        }
      }
    }
    // Remove duplicates and sort
    return [...new Set(numbers)].sort((a, b) => a - b);
  };
  
  const allowedNumbers = parseNumbers(document.getElementById('editor_allowed_numbers').value);
  const disallowedNumbers = parseNumbers(document.getElementById('editor_disallowed_numbers').value);
  
  if (!key && !gameEditorState.currentGame?.key){
    alert('Game key is required');
    return;
  }
  if (!name){
    alert('Game name is required');
    return;
  }
  
  // Get free_enabled from toggle button or gameEditorState
  const freeEnabledBtn = document.getElementById('editor_free_enabled');
  const freeEnabled = freeEnabledBtn?.classList.contains('active') || gameEditorState.currentGame?.free_enabled !== false;
  
  const gameData = {
    key: key || gameEditorState.currentGame?.key,
    name,
    desc,
    allowed_numbers: allowedNumbers,
    disallowed_numbers: disallowedNumbers,
    allowed_positions: gameEditorState.currentGame?.allowed_positions || [],
    disallowed_positions: gameEditorState.currentGame?.disallowed_positions || [],
    patterns: gameEditorState.currentGame?.patterns || [],
    free_enabled: freeEnabled,
    params: { free_enabled: freeEnabled }
  };
  
  console.log('[DEBUG] Saving game:', gameData.key, 'with', gameData.patterns.length, 'patterns');
  
  try {
    const finalKey = key || gameEditorState.currentGame?.key;
    const isNewGame = !gameEditorState.currentGame?.key || !gameEditorState.currentGame?.is_custom;
    
    let r;
    if (isNewGame) {
      // New game - use POST to create
      console.log('[DEBUG] Creating new game with POST');
      r = await fetch('/api/games/editor', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(gameData)
      });
    } else {
      // Existing game - use PUT to update
      console.log('[DEBUG] Updating existing game with PUT');
      r = await fetch(`/api/games/editor/${finalKey}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(gameData)
      });
    }
    
    const data = await r.json();
    if (!data.ok){
      alert('Failed to save game: ' + (data.error || 'Unknown error'));
      return;
    }
    await loadGamesList();
    switchTab('list');
  } catch(e){
    alert('Failed to save game: ' + e.message);
  }
}

function cancelEdit(){
  gameEditorState.currentGame = null;
  stopPatternsPreview();
  switchTab('list');
}

async function confirmDeleteGame(key){
  if (!confirm('Are you sure you want to delete this game?')) return;
  try {
    const r = await fetch(`/api/games/editor/${key}`, {method: 'DELETE'});
    const data = await r.json();
    if (!data.ok){
      alert('Failed to delete game: ' + (data.error || 'Unknown error'));
      return;
    }
    await loadGamesList();
  } catch(e){
    alert('Failed to delete game: ' + e.message);
  }
}

function deleteGame(){
  if (!gameEditorState.currentGame?.key) return;
  confirmDeleteGame(gameEditorState.currentGame.key);
}

async function saveAllGames(){
  try {
    const r = await fetch('/api/games/editor/save', {method: 'POST'});
    const data = await r.json();
    if (data.ok){
      alert('All games saved successfully!');
    } else {
      alert('Failed to save games: ' + (data.error || 'Unknown error'));
    }
  } catch(e){
    alert('Failed to save games: ' + e.message);
  }
}

window.openGameEditor = openGameEditor;
window.createNewGame = createNewGame;
window.editGame = editGame;
window.viewGame = viewGame;
window.addPattern = addPattern;
window.editPattern = editPattern;
window.deletePattern = deletePattern;
window.saveGame = saveGame;
window.cancelEdit = cancelEdit;
window.deleteGame = deleteGame;
window.confirmDeleteGame = confirmDeleteGame;
window.closePatternEditor = closePatternEditor;
window.savePattern = savePattern;
window.togglePatternCell = togglePatternCell;
window.toggleFreeSpace = toggleFreeSpace;
window.saveAllGames = saveAllGames;

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
