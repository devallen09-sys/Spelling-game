
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

  // --- Simple hash for PIN (djb2) ---
  function hashPIN(pin){
    pin = String(pin);
    let h = 5381;
    for(let i=0;i<pin.length;i++){
      h = ((h << 5) + h) + pin.charCodeAt(i);
      h = h & 0xffffffff;
    }
    return String(h >>> 0);
  }

  // --- Lock state ---
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
    // if locking, force to Test tab
    if(enabled){
      activateTab('test');
    }
  }

  // --- DOM ---
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

  // Edit tab
  const wordsTextarea = document.getElementById('wordsTextarea');
  const saveWordsBtn = document.getElementById('saveWordsBtn');
  const resetWordsBtn = document.getElementById('resetWordsBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importInput = document.getElementById('importInput');

  // Settings tab
  const caseInsensitive = document.getElementById('caseInsensitive');
  const trimSpaces = document.getElementById('trimSpaces');
  const autoSpeak = document.getElementById('autoSpeak');
  const repeatMissesSooner = document.getElementById('repeatMissesSooner');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');

  // Lock controls
  const lockBtn = document.getElementById('lockBtn');
  const enableLockBtn = document.getElementById('enableLockBtn');
  const disableLockBtn = document.getElementById('disableLockBtn');

  // --- State ---
  let settings = loadSettings();
  applySettingsUI(settings);

  let words = loadWords();
  renderWordsTextarea(words);

  let attemptStats = {
    total: 0,
    firstTryCorrect: 0
  };

  let queue = [];
  let mastered = new Set();
  let current = null;
  let firstTryMap = new Map(); // word -> true until first wrong

  let lock = loadLock();
  setLockedUI(lock.enabled);

  // --- Tabs ---
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
      // if locked, block entering teacher-only tabs
      if(lock.enabled && btn.classList.contains('teacher-only')){
        alert('Locked. Click 🔒 and enter the teacher PIN to unlock.');
        return;
      }
      activateTab(tab);
    });
  });

  // --- Voices ---
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
    // restore choice
    if(settings.voiceURI){
      voiceSelect.value = settings.voiceURI;
    }
  }
  window.speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();

  // --- Helpers ---
  function normalize(s){
    if(settings.trimSpaces) s = s.trim();
    if(settings.caseInsensitive) s = s.toLowerCase();
    return s;
  }

  function shuffle(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function speak(text){
    const utter = new SpeechSynthesisUtterance(text);
    const chosen = voices.find(v => v.voiceURI === (voiceSelect.value || settings.voiceURI));
    if(chosen) utter.voice = chosen;
    utter.rate = 0.95;
    utter.pitch = 1.0;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
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
      if(!raw) return DEFAULT_WORDS.slice();
      const list = JSON.parse(raw);
      if(Array.isArray(list) && list.every(w => typeof w === 'string')){
        return list.filter(w => w.trim() !== '');
      }
    } catch(e){}
    return DEFAULT_WORDS.slice();
  }

  function saveWords(list){
    localStorage.setItem(STORAGE_KEYS.WORDS, JSON.stringify(list));
  }

  function renderWordsTextarea(list){
    wordsTextarea.value = list.join('\n');
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
    caseInsensitive.checked = !!s.caseInsensitive;
    trimSpaces.checked = !!s.trimSpaces;
    autoSpeak.checked = !!s.autoSpeak;
    repeatMissesSooner.checked = !!s.repeatMissesSooner;
  }

  function startTest(){
    // reset state
    attemptStats = { total: 0, firstTryCorrect: 0 };
    mastered = new Set();
    firstTryMap = new Map();
    const cleaned = words.map(w => w.trim()).filter(Boolean);
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
    if(mastered.size >= words.length){
      finishTest();
      return;
    }
    if(queue.length === 0){
      // refill with remaining non-mastered
      const remaining = words.filter(w => !mastered.has(w));
      queue = shuffle(remaining.slice());
    }
    // pick next
    current = queue.shift();
    if(!firstTryMap.has(current)) firstTryMap.set(current, true);

    answerForm.reset();
    answerInput.focus();

    if(settings.autoSpeak){
      speak(current);
    }
  }

  // --- Events ---
  startBtn.addEventListener('click', startTest);
  restartBtn.addEventListener('click', startTest);

  speakBtn.addEventListener('click', () => {
    if(!current) return;
    speak(current);
  });

  voiceSelect.addEventListener('change', () => {
    settings.voiceURI = voiceSelect.value || null;
    saveSettings(settings);
  });

  answerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if(!current) return;
    let guess = answerInput.value;
    let target = current;

    const nGuess = normalize(guess);
    const nTarget = normalize(target);

    attemptStats.total += 1;
    const correct = (nGuess === nTarget);

    if(correct){
      if(firstTryMap.get(current) === true){
        attemptStats.firstTryCorrect += 1;
      }
      mastered.add(current);
      setFeedback('Correct!', true);
      setTimeout(nextWord, 400);
    } else {
      firstTryMap.set(current, false);
      setFeedback('Try again ⟲');
      // requeue policy
      if(settings.repeatMissesSooner){
        // reinsert within the next 2-4 positions
        const pos = Math.min(queue.length, Math.floor(Math.random()*3)+1);
        queue.splice(pos, 0, current);
      } else {
        queue.push(current);
      }
      // keep the same current visible for user to retry (don't advance)
      answerInput.select();
    }
    updateProgress();
  });

  dontKnowBtn.addEventListener('click', () => {
    if(!current) return;
    firstTryMap.set(current, false);
    // We DO NOT reveal the word; only requeue
    setFeedback('No problem — it will come back later.');
    if(settings.repeatMissesSooner){
      const pos = Math.min(queue.length, Math.floor(Math.random()*3)+1);
      queue.splice(pos, 0, current);
    }else{
      queue.push(current);
    }
    nextWord();
  });

  // Edit Words
  saveWordsBtn?.addEventListener('click', () => {
    const lines = wordsTextarea.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
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
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
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

  // Settings
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

  // --- Lock / Unlock ---
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
    if(lock.enabled){
      alert('Already locked.');
      return;
    }
    const pin1 = prompt('Set a 4+ digit PIN:');
    if(!pin1) return;
    if(pin1.length < 4 || !/^\d{4,}$/.test(pin1)){
      alert('Please use at least 4 digits.');
      return;
    }
    const pin2 = prompt('Confirm PIN:');
    if(pin2 !== pin1){
      alert('PINs do not match.');
      return;
    }
    lock = {enabled:true, pinHash: hashPIN(pin1)};
    saveLock(lock);
    setLockedUI(true);
    alert('Lock enabled. Keep your PIN safe.');
  });

  disableLockBtn?.addEventListener('click', () => {
    if(!lock.enabled){
      alert('Already unlocked.');
      return;
    }
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

  // Init progress text
  updateProgress();
})();
