
(function(){
  const STORAGE_KEYS = {
    WORDS: 'spellingGame.words',
    SETTINGS: 'spellingGame.settings',
    LOCK: 'spellingGame.lock'
  };

  const DEFAULT_WORDS = [
    "because","friend","beautiful","animal","different",
    "through","enough","favorite","thought","laugh",
    "country","family","instead","usually","Wednesday",
    "again","early","second","separate","caught"
  ];

  const DEFAULT_SETTINGS = {
    caseInsensitive: true,
    trimSpaces: true,
    autoSpeak: true,
    repeatMissesSooner: true,
    voiceURI: null
  };

  function hashPIN(pin){
    pin = String(pin);
    let h = 5381;
    for(let i=0;i<pin.length;i++){
      h = ((h << 5) + h) + pin.charCodeAt(i);
      h = h & 0xffffffff;
    }
    return String(h >>> 0);
  }

  function loadLock(){
    try{
      const raw = localStorage.getItem(STORAGE_KEYS.LOCK);
      if(!raw) return {enabled:false, pinHash:null};
      const obj = JSON.parse(raw);
      return {enabled: !!obj.enabled, pinHash: obj.pinHash || null};
    }catch(e){
      return {enabled:false, pinHash:null};
    }
  }
  function saveLock(lock){ localStorage.setItem(STORAGE_KEYS.LOCK, JSON.stringify(lock)); }
  function setLockedUI(enabled){
    document.body.classList.toggle('locked', !!enabled);
    lockBtn.textContent = enabled ? '🔒' : '🔓';
    if(enabled){ activateTab('test'); }
  }

  const tabs = document.querySelectorAll('.tab');
  const tabpanels = document.querySelectorAll('.tabpanel');
  const startBtn = document.getElementById('startBtn');
  const restartBtn = document.getElementById('restartBtn');
  const preTest = document.getElementById('preTest');
  const inTest = document.getElementById('inTest');
  const postTest = document.getElementById('postTest');
  const speakBtn = document.getElementById('speakBtn');
  const voiceSelect = document.getElementById('voiceSelect');
  const answerForm = document.getElementById('answerForm');
  const answerInput = document.getElementById('answerInput');
  const dontKnowBtn = document.getElementById('dontKnowBtn');
  const feedback = document.getElementById('feedback');
  const progressText = document.getElementById('progressText');
  const progressBar = document.getElementById('progressBar');

  const wordsTextarea = document.getElementById('wordsTextarea');
  const saveWordsBtn = document.getElementById('saveWordsBtn');
  const resetWordsBtn = document.getElementById('resetWordsBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importInput = document.getElementById('importInput');

  const caseInsensitive = document.getElementById('caseInsensitive');
  const trimSpaces = document.getElementById('trimSpaces');
  const autoSpeak = document.getElementById('autoSpeak');
  const repeatMissesSooner = document.getElementById('repeatMissesSooner');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');

  const lockBtn = document.getElementById('lockBtn');
  const enableLockBtn = document.getElementById('enableLockBtn');
  const disableLockBtn = document.getElementById('disableLockBtn');

  let settings = loadSettings();
  applySettingsUI(settings);

  let words = loadWords();
  renderWordsTextarea(words);

  let attemptStats = { total: 0, firstTryCorrect: 0 };
  let queue = [];
  let mastered = new Set();
  let current = null;
  let firstTryMap = new Map();

  let lock = loadLock();
  setLockedUI(lock.enabled);

  function activateTab(name){
    tabs.forEach(b => {
      const active = (b.dataset.tab === name);
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    tabpanels.forEach(p => {
      const show = (p.id === `tab-${name}`);
      p.classList.toggle('is-active', show);
    });
  }

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if(lock.enabled && btn.classList.contains('teacher-only')){
        alert('Locked. Click 🔒 and enter the teacher PIN to unlock.');
        return;
      }
      activateTab(tab);
    });
  });

  let voices = [];
  function loadVoices(){
    voices = speechSynthesis.getVoices();
    voiceSelect.innerHTML = '';
    const relevant = voices.filter(v => v.lang.toLowerCase().startsWith('en'));
    (relevant.length ? relevant : voices).forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})${v.default ? ' — default' : ''}`;
      voiceSelect.appendChild(opt);
    });
    if(settings.voiceURI){ voiceSelect.value = settings.voiceURI; }
  }
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();

  function cleanWord(s){
    return String(s||'').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
  }
  function cmpKey(s){
    return cleanWord(s).toLowerCase();
  }
  function normalizeForCompare(s){
    let out = cleanWord(s);
    if(settings.caseInsensitive) out = out.toLowerCase();
    return out;
  }
  function shuffle(arr){
    for(let i=arr.length-1;i>0;i++){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function speak(text){
    const utter = new SpeechSynthesisUtterance(text);
    const chosen = voices.find(v => v.voiceURI === (voiceSelect.value || settings.voiceURI));
    if(chosen) utter.voice = chosen;
    utter.rate = 0.95; utter.pitch = 1.0;
    speechSynthesis.cancel(); speechSynthesis.speak(utter);
  }
  function updateProgress(){
    const total = words.length;
    const done = mastered.size;
    progressText.textContent = `${done} / ${total}`;
    const pct = total ? Math.round((done/total)*100) : 0;
    progressBar.style.width = pct + '%';
  }
  function setFeedback(msg, ok=false){
    feedback.classList.remove('feedback--ok','feedback--err');
    if(!msg){ feedback.textContent=''; return; }
    feedback.textContent = msg;
    feedback.classList.add(ok ? 'feedback--ok' : 'feedback--err');
  }

  function loadWords(){
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.WORDS);
      let list = raw ? JSON.parse(raw) : DEFAULT_WORDS.slice();
      if(!Array.isArray(list)) list = DEFAULT_WORDS.slice();
      const seen = new Set();
      const cleaned = [];
      for(const w of list){
        const cw = cleanWord(w);
        if(!cw) continue;
        const key = cw.toLowerCase();
        if(!seen.has(key)){ seen.add(key); cleaned.push(cw); }
      }
      return cleaned;
    } catch(e){
      return DEFAULT_WORDS.slice();
    }
  }
  function saveWords(list){
    localStorage.setItem(STORAGE_KEYS.WORDS, JSON.stringify(list));
  }
  function renderWordsTextarea(list){
    if(wordsTextarea) wordsTextarea.value = list.join('\n');
  }

  function loadSettings(){
    try{
      const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
      if(!raw) return {...DEFAULT_SETTINGS};
      const obj = JSON.parse(raw);
      return {...DEFAULT_SETTINGS, ...obj};
    }catch(e){
      return {...DEFAULT_SETTINGS};
    }
  }
  function saveSettings(s){
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(s));
  }
  function applySettingsUI(s){
    if(caseInsensitive) caseInsensitive.checked = !!s.caseInsensitive;
    if(trimSpaces) trimSpaces.checked = !!s.trimSpaces;
    if(autoSpeak) autoSpeak.checked = !!s.autoSpeak;
    if(repeatMissesSooner) repeatMissesSooner.checked = !!s.repeatMissesSooner;
  }

  function startTest(){
    attemptStats = { total: 0, firstTryCorrect: 0 };
    mastered = new Set();
    firstTryMap = new Map();
    const cleaned = words.map(w => cleanWord(w)).filter(Boolean);
    queue = shuffle(cleaned.slice());
    preTest.classList.add('is-hidden');
    postTest.classList.add('is-hidden');
    inTest.classList.remove('is-hidden');
    nextWord();
  }

  function finishTest(){
    inTest.classList.add('is-hidden');
    postTest.classList.remove('is-hidden');
    document.getElementById('sumTotal').textContent = words.length.toString();
    document.getElementById('sumAttempts').textContent = attemptStats.total.toString();
    document.getElementById('sumFirstTry').textContent = attemptStats.firstTryCorrect.toString();
  }

  function nextWord(){
    updateProgress();
    setFeedback('');
    if(mastered.size >= words.length){ finishTest(); return; }
    if(queue.length === 0){
      const remaining = words.filter(w => !mastered.has(cmpKey(w)));
      queue = shuffle(remaining.slice());
    }
    current = queue.shift();
    if(!firstTryMap.has(current)) firstTryMap.set(current, true);
    answerForm.reset(); answerInput.focus();
    if(settings.autoSpeak){ speak(current); }
  }

  startBtn.addEventListener('click', startTest);
  restartBtn.addEventListener('click', startTest);

  speakBtn.addEventListener('click', () => { if(current) speak(current); });

  voiceSelect.addEventListener('change', () => {
    settings.voiceURI = voiceSelect.value || null;
    saveSettings(settings);
  });

  answerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if(!current) return;
    const nGuess = normalizeForCompare(answerInput.value);
    const nTarget = normalizeForCompare(current);

    attemptStats.total += 1;
    const correct = (nGuess === nTarget);

    if(correct){
      if(firstTryMap.get(current) === true){ attemptStats.firstTryCorrect += 1; }
      mastered.add(cmpKey(current));
      // Remove any residual copies of this word from the queue
      queue = queue.filter(w => cmpKey(w) != cmpKey(current));
      setFeedback('Correct!', true);
      setTimeout(nextWord, 300);
    } else {
      firstTryMap.set(current, false);
      setFeedback('Try again ⟲');
      if(settings.repeatMissesSooner){
        const pos = Math.min(queue.length, Math.floor(Math.random()*3)+1);
        queue.splice(pos, 0, current);
      } else {
        queue.push(current);
      }
      answerInput.select();
    }
    updateProgress();
  });

  dontKnowBtn.addEventListener('click', () => {
    if(!current) return;
    firstTryMap.set(current, false);
    setFeedback('No problem — it will come back later.');
    if(settings.repeatMissesSooner){
      const pos = Math.min(queue.length, Math.floor(Math.random()*3)+1);
      queue.splice(pos, 0, current);
    } else {
      queue.push(current);
    }
    nextWord();
  });

  saveWordsBtn?.addEventListener('click', () => {
    const raw = wordsTextarea.value.split(/\r?\n/);
    const seen = new Set();
    const lines = [];
    for(const r of raw){
      const cw = cleanWord(r);
      if(!cw) continue;
      const key = cw.toLowerCase();
      if(!seen.has(key)){ seen.add(key); lines.push(cw); }
    }
    if(lines.length === 0){
      alert('Please enter at least one word.');
      return;
    }
    words = lines;
    saveWords(words);
    alert('Saved! Your test will use this list.');
  });

  resetWordsBtn?.addEventListener('click', () => {
    words = DEFAULT_WORDS.slice();
    saveWords(words);
    renderWordsTextarea(words);
  });

  exportBtn?.addEventListener('click', () => {
    const blob = new Blob([words.join('\n')], {type:'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'spelling_words.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  importInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const text = await file.text();
    const raw = text.split(/\r?\n/);
    const seen = new Set();
    const lines = [];
    for(const r of raw){
      const cw = cleanWord(r);
      if(!cw) continue;
      const key = cw.toLowerCase();
      if(!seen.has(key)){ seen.add(key); lines.push(cw); }
    }
    if(lines.length === 0){
      alert('The file appears to be empty.');
      return;
    }
    words = lines;
    saveWords(words);
    renderWordsTextarea(words);
    alert('Imported!');
    e.target.value = '';
  });

  saveSettingsBtn?.addEventListener('click', () => {
    settings = {
      caseInsensitive: caseInsensitive.checked,
      trimSpaces: trimSpaces.checked,
      autoSpeak: autoSpeak.checked,
      repeatMissesSooner: repeatMissesSooner.checked,
      voiceURI: voiceSelect.value || null
    };
    saveSettings(settings);
    alert('Settings saved.');
  });

  resetSettingsBtn?.addEventListener('click', () => {
    settings = {...DEFAULT_SETTINGS};
    applySettingsUI(settings);
    saveSettings(settings);
    alert('Settings reset.');
  });

  lockBtn.addEventListener('click', () => {
    if(lock.enabled){
      const pin = prompt('Enter teacher PIN to unlock:');
      if(pin === null) return;
      if(hashPIN(pin) === lock.pinHash){
        lock = {enabled:false, pinHash: lock.pinHash};
        saveLock(lock);
        setLockedUI(false);
        alert('Unlocked.');
      } else {
        alert('Incorrect PIN.');
      }
    } else {
      alert('To enable teacher lock, go to Settings ▸ Teacher Lock.');
    }
  });

  enableLockBtn?.addEventListener('click', () => {
    if(lock.enabled){ alert('Already locked.'); return; }
    const pin1 = prompt('Set a 4+ digit PIN:');
    if(!pin1) return;
    if(!/^\d{4,}$/.test(pin1)){ alert('Please use at least 4 digits.'); return; }
    const pin2 = prompt('Confirm PIN:');
    if(pin2 !== pin1){ alert('PINs do not match.'); return; }
    lock = {enabled:true, pinHash: hashPIN(pin1)};
    saveLock(lock);
    setLockedUI(true);
    alert('Lock enabled. Keep your PIN safe.');
  });

  disableLockBtn?.addEventListener('click', () => {
    if(!lock.enabled){ alert('Already unlocked.'); return; }
    const pin = prompt('Enter PIN to disable lock:');
    if(pin === null) return;
    if(hashPIN(pin) === lock.pinHash){
      lock = {enabled:false, pinHash: lock.pinHash};
      saveLock(lock);
      setLockedUI(false);
      alert('Lock disabled.');
    } else {
      alert('Incorrect PIN.');
    }
  });

  updateProgress();
})();
