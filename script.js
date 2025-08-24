
(function(){
  'use strict';

  const STORAGE_KEYS = {
    WORDS: 'spellingGame.words.v2',
    SETTINGS: 'spellingGame.settings.v2',
    LOCK: 'spellingGame.lock'
  };

  const DEFAULT_ENTRIES = [
    {word: "because"},
    {word: "friend"},
    {word: "beautiful"},
    {word: "animal"},
    {word: "different"},
    {word: "through"},
    {word: "enough"},
    {word: "favorite"},
    {word: "thought"},
    {word: "laugh"}
  ];

  const DEFAULT_SETTINGS = {
    caseInsensitive: true,
    trimSpaces: true,
    autoSpeak: true,
    autoSpeakSentence: true,
    showSentenceText: false,
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

  const errorToast = document.getElementById('errorToast');
  function showErrorToast(msg){
    try{
      errorToast.textContent = msg;
      errorToast.classList.remove('is-hidden');
      setTimeout(()=> errorToast.classList.add('is-hidden'), 3500);
    }catch(e){/* noop */}
  }

  window.addEventListener('error', (e) => {
    showErrorToast('Something went wrong. Try reload.');
    console.error(e.error || e.message);
  });

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
    if(enabled){
      activateTab('test');
    }
  }

  const tabs = document.querySelectorAll('.tab');
  const tabpanels = document.querySelectorAll('.tabpanel');
  const startBtn = document.getElementById('startBtn');
  const restartBtn = document.getElementById('restartBtn');
  const preTest = document.getElementById('preTest');
  const inTest = document.getElementById('inTest');
  const postTest = document.getElementById('postTest');
  const speakBtn = document.getElementById('speakBtn');
  const speakSentenceBtn = document.getElementById('speakSentenceBtn');
  const voiceSelect = document.getElementById('voiceSelect');
  const answerForm = document.getElementById('answerForm');
  const answerInput = document.getElementById('answerInput');
  const dontKnowBtn = document.getElementById('dontKnowBtn');
  const feedback = document.getElementById('feedback');
  const sentenceText = document.getElementById('sentenceText');
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
  const autoSpeakSentence = document.getElementById('autoSpeakSentence');
  const showSentenceText = document.getElementById('showSentenceText');
  const repeatMissesSooner = document.getElementById('repeatMissesSooner');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');
  const resetSettingsBtn = document.getElementById('resetSettingsBtn');

  const lockBtn = document.getElementById('lockBtn');
  const enableLockBtn = document.getElementById('enableLockBtn');
  const disableLockBtn = document.getElementById('disableLockBtn');

  // --- State ---
  let settings = loadSettings();
  applySettingsUI(settings);

  let entries = loadEntries();
  renderWordsTextarea(entries);

  let attemptStats = { total: 0, firstTryCorrect: 0 };
  let queue = [];
  let mastered = new Set(); // words mastered
  let current = null;      // current entry
  let firstTryMap = new Map(); // word -> true until first wrong

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
    try{
      voices = speechSynthesis.getVoices();
      voiceSelect.innerHTML = '';
      const relevant = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('en'));
      (relevant.length ? relevant : voices).forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name} (${v.lang})${v.default ? ' — default' : ''}`;
        voiceSelect.appendChild(opt);
      });
      if(settings.voiceURI){
        voiceSelect.value = settings.voiceURI;
      }
    }catch(e){
      console.warn('Voice load failed', e);
    }
  }
  if('speechSynthesis' in window){
    window.speechSynthesis.onvoiceschanged = loadVoices;
    setTimeout(loadVoices, 500);
  }

  function safeSpeak(text){
    if(!('speechSynthesis' in window) || !text) return;
    try{
      const utter = new SpeechSynthesisUtterance(text);
      const chosen = voices.find(v => v.voiceURI === (voiceSelect.value || settings.voiceURI));
      if(chosen) utter.voice = chosen;
      utter.rate = 0.95;
      utter.pitch = 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    }catch(e){
      console.warn('speak failed', e);
      showErrorToast('Speaker unavailable on this device. You can still type your answer.');
    }
  }

  function normalize(s){
    if(typeof s !== 'string') return '';
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
    if(settings.trimSpaces) s = s.trim();
    if(settings.caseInsensitive) s = s.toLowerCase();
    return s;
  }

  function parseLine(line){
    let raw = (line || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
    let parts = raw.split('|');
    if(parts.length === 1) parts = raw.split('\t');
    const word = (parts[0] || '').trim();
    const sentence = (parts.slice(1).join('|') || '').trim();
    return { word, sentence: sentence || undefined };
  }

  function sanitizeEntries(list){
    const seen = new Set();
    const out = [];
    for(const item of list){
      const word = (item?.word || '').trim();
      const sentence = (item?.sentence || '').trim();
      if(!word) continue;
      const key = word.toLowerCase();
      if(seen.has(key)) continue;
      seen.add(key);
      out.push({word, sentence: sentence || undefined});
    }
    return out;
  }

  function shuffle(arr){
    for(let i=arr.length-1;i>0;i--){
      const j = Math.floor(Math.random()*(i+1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function updateProgress(){
    const total = entries.length;
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

  function loadEntries(){
    try{
      const v2 = localStorage.getItem(STORAGE_KEYS.WORDS);
      if(v2){
        const arr = JSON.parse(v2);
        if(Array.isArray(arr)){
          return sanitizeEntries(arr);
        }
      }
      const v1 = localStorage.getItem('spellingGame.words');
      if(v1){
        const list = JSON.parse(v1);
        if(Array.isArray(list)){
          const migrated = list.map(w => ({word: String(w)}));
          saveEntries(migrated);
          return sanitizeEntries(migrated);
        }
      }
    }catch(e){}
    return DEFAULT_ENTRIES.slice();
  }

  function saveEntries(arr){
    localStorage.setItem(STORAGE_KEYS.WORDS, JSON.stringify(sanitizeEntries(arr)));
  }

  function renderWordsTextarea(arr){
    if(!wordsTextarea) return;
    const lines = arr.map(e => e.sentence ? `${e.word} | ${e.sentence}` : e.word);
    wordsTextarea.value = lines.join('\n');
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
    if(autoSpeakSentence) autoSpeakSentence.checked = !!s.autoSpeakSentence;
    if(showSentenceText) showSentenceText.checked = !!s.showSentenceText;
    if(repeatMissesSooner) repeatMissesSooner.checked = !!s.repeatMissesSooner;
  }

  function startTest(){
    entries = sanitizeEntries(entries);
    if(!Array.isArray(entries) || entries.length === 0){
      setFeedback('No words found. Add words in Edit tab.', false);
      if(!document.body.classList.contains('locked')) activateTab('edit');
      return;
    }
    attemptStats = { total: 0, firstTryCorrect: 0 };
    mastered = new Set();
    firstTryMap = new Map();
    queue = shuffle(entries.slice());

    preTest.classList.add('is-hidden');
    postTest.classList.add('is-hidden');
    inTest.classList.remove('is-hidden');

    nextWord();
  }

  function finishTest(){
    inTest.classList.add('is-hidden');
    postTest.classList.remove('is-hidden');
    document.getElementById('sumTotal').textContent = String(entries.length);
    document.getElementById('sumAttempts').textContent = String(attemptStats.total);
    document.getElementById('sumFirstTry').textContent = String(attemptStats.firstTryCorrect);
  }

  function showSentenceUI(entry){
    if(!sentenceText) return;
    if(showSentenceText && showSentenceText.checked && entry?.sentence){
      sentenceText.textContent = entry.sentence;
      sentenceText.classList.remove('is-hidden');
    } else {
      sentenceText.textContent = '';
      sentenceText.classList.add('is-hidden');
    }
  }

  function nextWord(){
    updateProgress();
    setFeedback('');
    showSentenceUI({});
    if(mastered.size >= entries.length){
      finishTest();
      return;
    }
    if(queue.length === 0){
      const remaining = entries.filter(e => !mastered.has(e.word));
      queue = shuffle(remaining.slice());
      if(queue.length === 0){
        finishTest();
        return;
      }
    }
    current = queue.shift();
    if(!firstTryMap.has(current.word)) firstTryMap.set(current.word, true);

    answerForm.reset();
    answerInput.focus();

    if(autoSpeak?.checked){
      safeSpeak(current.word);
    }
    if(autoSpeakSentence?.checked && current.sentence){
      setTimeout(() => safeSpeak(current.sentence), 450);
    }
    showSentenceUI(current);
  }

  startBtn.addEventListener('click', startTest);
  restartBtn.addEventListener('click', startTest);

  speakBtn.addEventListener('click', () => {
    if(!current) return;
    safeSpeak(current.word);
  });

  speakSentenceBtn.addEventListener('click', () => {
    if(!current || !current.sentence) return;
    safeSpeak(current.sentence);
  });

  voiceSelect.addEventListener('change', () => {
    settings.voiceURI = voiceSelect.value || null;
    saveSettings(settings);
  });

  answerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if(!current) return;
    const nGuess = normalize(answerInput.value);
    const nTarget = normalize(current.word);

    attemptStats.total += 1;
    const correct = (nGuess === nTarget);

    if(correct){
      if(firstTryMap.get(current.word) === true){
        attemptStats.firstTryCorrect += 1;
      }
      mastered.add(current.word);
      queue = queue.filter(e => normalize(e.word) !== nTarget);
      setFeedback('Correct!', true);
      setTimeout(nextWord, 250);
    } else {
      firstTryMap.set(current.word, false);
      setFeedback('Try again ⟲');
      if(repeatMissesSooner?.checked){
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
    firstTryMap.set(current.word, false);
    setFeedback('No problem — it will come back later.');
    if(repeatMissesSooner?.checked){
      const pos = Math.min(queue.length, Math.floor(Math.random()*3)+1);
      queue.splice(pos, 0, current);
    }else{
      queue.push(current);
    }
    nextWord();
  });

  saveWordsBtn?.addEventListener('click', () => {
    const lines = wordsTextarea.value.split(/\r?\n/);
    const parsed = lines.map(parseLine).filter(o => o.word);
    const cleaned = sanitizeEntries(parsed);
    if(cleaned.length === 0){
      alert('Please enter at least one word.');
      return;
    }
    entries = cleaned;
    saveEntries(entries);
    renderWordsTextarea(entries);
    alert('Saved! Your test will use this list.');
  });

  resetWordsBtn?.addEventListener('click', () => {
    entries = DEFAULT_ENTRIES.slice();
    saveEntries(entries);
    renderWordsTextarea(entries);
    alert('Reset to sample list.');
  });

  exportBtn?.addEventListener('click', () => {
    const lines = entries.map(e => e.sentence ? `${e.word} | ${e.sentence}` : e.word);
    const blob = new Blob([lines.join('\n')], {type:'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'spelling_words_with_sentences.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  importInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    const parsed = lines.map(parseLine).filter(o => o.word);
    const cleaned = sanitizeEntries(parsed);
    if(cleaned.length === 0){
      alert('The file appears to be empty.');
      return;
    }
    entries = cleaned;
    saveEntries(entries);
    renderWordsTextarea(entries);
    alert('Imported!');
    e.target.value = '';
  });

  lockBtn.addEventListener('click', () => {
    const lock = loadLock();
    if(lock.enabled){
      const pin = prompt('Enter teacher PIN to unlock:');
      if(pin === null) return;
      if(hashPIN(pin) === lock.pinHash){
        const next = {enabled:false, pinHash: lock.pinHash};
        saveLock(next);
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
    const lock = loadLock();
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
    const next = {enabled:true, pinHash: hashPIN(pin1)};
    saveLock(next);
    setLockedUI(true);
    alert('Lock enabled. Keep your PIN safe.');
  });

  disableLockBtn?.addEventListener('click', () => {
    const lock = loadLock();
    if(!lock.enabled){
      alert('Already unlocked.');
      return;
    }
    const pin = prompt('Enter PIN to disable lock:');
    if(pin === null) return;
    if(hashPIN(pin) === lock.pinHash){
      const next = {enabled:false, pinHash: lock.pinHash};
      saveLock(next);
      setLockedUI(false);
      alert('Lock disabled.');
    } else {
      alert('Incorrect PIN.');
    }
  });

  updateProgress();
})();
