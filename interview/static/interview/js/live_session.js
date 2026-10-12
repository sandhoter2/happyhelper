// Live session page. Server values (session id, language, icons) are set inline by live_session.html before this file loads.
// Phones and tablets. iPadOS reports itself as a Mac, so touch points tell it apart.
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_PHONE = IS_IOS || /Android/i.test(navigator.userAgent);

function getCookie(name) {
  const v = `; ${document.cookie}`;
  const p = v.split(`; ${name}=`);
  if (p.length === 2) return p.pop().split(';').shift();
  return '';
}

let mediaRecorder = null;
let audioChunks = [];
let micActive = false;
let micStream = null;
let rawRecorder = null;
let rawChunkSeq = 0;
let autoAI = true;
let isStreaming = false;
let sessionCost = 0;
let _sessionOutputChars = 0;
let chunkTimer = null;
let autoTriggerTimer = null;

// ── Transcribe mode: 'auto' (silence detection) or 'manual' (fixed interval) ─
let transcribeMode = localStorage.getItem('transcribeMode') || 'auto';
let transcribeIntervalSec = parseInt(localStorage.getItem('transcribeInterval') || '2');
let silenceTimer = null;
let silenceWatching = false;
const SILENCE_THRESHOLD = 0.015; // RMS below this = silence
const SILENCE_HOLD_MS   = 2000;  // silence for this long → cut chunk early
let transcriptCount = parseInt(document.getElementById('transcriptCount').textContent) || 0;
let lastQuestion = '';
let transcriptFontSize = 14;

// Wire click-to-input on pre-existing server-rendered transcript entries
document.querySelectorAll('#transcriptPanel .transcript-entry').forEach(div => {
  div.addEventListener('click', e => {
    if (e.target.closest('.text')) return;
    const t = div.querySelector('.text');
    if (e.ctrlKey || e.metaKey || document.body.classList.contains('tc-select-mode')) {
      toggleEntrySelection(div);
    } else if (t) {
      populateInputFromTranscript(t.textContent);
    }
  });
});
let aiFontSize = 14;
let audioCtx = null, analyser = null, waveDrawing = false;
let sessionStart = Date.now();
let timerInterval = null;
let bionicMode = false;
let transcriptMinimized = false;

// ── Bionic reading engine ─────────────────────────────────────────────────────
// Keywords that get full highlight (mark) instead of just bold-prefix
const KEYWORDS = new Set([
  'action','result','situation','task','impact','led','built','improved','increased',
  'reduced','solved','delivered','achieved','managed','designed','implemented',
  'critical','key','important','ensure','focus','goal','challenge','solution',
  'experience','skill','strength','team','project','success','failure','learned',
  'technical','leadership','communication','strategy','performance','scalable',
  'efficient','optimize','deploy','architecture','system','data','security',
  'revenue','cost','growth','metric','deadline','stakeholder','customer','user',
]);

function toBionicHTML(text) {
  // Preserve newlines, process word-by-word; escape non-alpha segments to prevent XSS
  return text.split('\n').map(line =>
    line.replace(/([a-zA-Z]{2,})|([^a-zA-Z]+|[a-zA-Z])/g, (match, word, other) => {
      if (other !== undefined) {
        return other.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }
      const lower = word.toLowerCase();
      if (KEYWORDS.has(lower)) return `<mark>${word}</mark>`;
      const bold = Math.ceil(word.length / 2);
      return `<b>${word.slice(0, bold)}</b>${word.slice(bold)}`;
    })
  ).join('\n');
}

// Bionic emphasis is laid over the formatted answer, so headings, lists and tables stay as they are.
// Code is left exactly as written.
function renderBionic(el, text) {
  if (!window.marked) { el.innerHTML = toBionicHTML(text); return; }
  renderMarkdown(el, text);
  const d = el.ownerDocument;
  const walker = d.createTreeWalker(el, 4 /* text nodes */);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue.trim() && !n.parentElement.closest('code, pre')) nodes.push(n);
  }
  nodes.forEach(n => {
    const holder = d.createElement('span');
    holder.innerHTML = toBionicHTML(n.nodeValue);
    n.replaceWith(...holder.childNodes);
  });
}

function applyBionicToEl(el) {
  if (!el.dataset.plain) el.dataset.plain = el.textContent;
  renderBionic(el, el.dataset.plain);
}

function removeBionicFromEl(el) {
  if (el.dataset.plain) renderMarkdown(el, el.dataset.plain);
}

function renderMarkdown(el, text) {
  if (window.marked) {
    el.innerHTML = marked.parse(text);
  } else {
    el.textContent = text;
  }
}

// Answers saved earlier arrive from the server as plain text. Format them the same way as live answers.
document.querySelectorAll('#aiHistory .ai-item-a').forEach(el => {
  el.dataset.plain = el.textContent;
  renderMarkdown(el, el.textContent);
});

function toggleBionic() {
  bionicMode = !bionicMode;
  const d = _doc();
  const btn = d.getElementById('bionicToggle');
  const aiPanelEl = d.getElementById('aiPanel');
  if (btn) { btn.classList.toggle('active', bionicMode); btn.setAttribute('aria-pressed', bionicMode ? 'true' : 'false'); }
  if (aiPanelEl) aiPanelEl.classList.toggle('bionic-on', bionicMode);
  const st = d.getElementById('bionicStatus');
  if (st) st.textContent = 'Bionic reading ' + (bionicMode ? 'on' : 'off');

  d.querySelectorAll('.ai-item-a, .ai-answer').forEach(el => {
    if (bionicMode) applyBionicToEl(el);
    else removeBionicFromEl(el);
  });
  toast('Bionic reading ' + (bionicMode ? 'on' : 'off'), 'info');
}

const ICON_MIC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V7a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v3"/></svg>';
const ICON_STOP = '<svg class="ic ic-fill" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
// Icons for buttons whose label is rewritten from script
const micBtn = document.getElementById('micBtn');
const recDot = document.getElementById('recDot');
const aiHelpBtn = document.getElementById('aiHelpBtn');
const aiPanel = document.getElementById('aiPanel');
const aiLive = document.getElementById('aiLive');
const aiAnswerText = document.getElementById('aiAnswerText');
const aiCursor = document.getElementById('aiCursor');
const aiTriggerText = document.getElementById('aiTriggerText');
const aiPlaceholder = document.getElementById('aiPlaceholder');
const transcriptPanel = document.getElementById('transcriptPanel');
const interimEntry = document.getElementById('interimEntry');
const interimText = document.getElementById('interimText');
const interimLabel = document.getElementById('interimLabel');
const transcriptPlaceholder = document.getElementById('transcriptPlaceholder');
const statusChip = document.getElementById('statusChip');
const questionInput = document.getElementById('questionInput');
const statusBadge = document.getElementById('statusBadge');
const autoToggle = document.getElementById('autoToggle');
const waveformWrap = document.getElementById('waveformWrap');
const waveformCanvas = document.getElementById('waveformCanvas');
const waveCtx = waveformCanvas.getContext('2d');

// Live word count on question input
function _updateQInputCount(inp) {
  const el = document.getElementById('qInputCount');
  if (!el) return;
  const val = inp.value.trim();
  if (!val) { el.style.opacity = '0'; return; }
  const wc = val.split(/\s+/).filter(Boolean).length;
  el.textContent = wc + 'w';
  el.style.opacity = '1';
}

// Smart paste: when user pastes 40+ chars into question input, nudge them to trigger AI
questionInput.addEventListener('paste', () => {
  setTimeout(() => {
    if (questionInput.value.trim().length >= 40) {
      toast('Tip: press ⌘ Enter for an answer', 'info', 3000);
    }
  }, 50);
});

// ── AI panel scroll-lock listener ────────────────────────────────────────────
aiPanel.addEventListener('scroll', () => {
  const atBottom = aiPanel.scrollHeight - aiPanel.scrollTop - aiPanel.clientHeight < 40;
  if (atBottom) {
    _aiScrollLocked = false;
    _aiNewCount = 0;
    const badge = document.getElementById('aiScrollBadge');
    if (badge) badge.style.display = 'none';
  } else {
    _aiScrollLocked = true;
  }
});

// ── Transcript scroll-lock listener ──────────────────────────────────────────
transcriptPanel.addEventListener('scroll', () => {
  const atBottom = transcriptPanel.scrollHeight - transcriptPanel.scrollTop - transcriptPanel.clientHeight < 40;
  if (atBottom) {
    _transcriptScrollLocked = false;
    _transcriptNewCount = 0;
    const badge = document.getElementById('transcriptScrollBadge');
    if (badge) badge.style.display = 'none';
  } else {
    _transcriptScrollLocked = true;
  }
});

// ── Elapsed Timer ─────────────────────────────────────────────────────────────

function startTimer() {
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - sessionStart) / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const pad = n => String(n).padStart(2,'0');
    document.getElementById('elapsedTimer').textContent =
      h > 0 ? `${pad(h)}:${pad(m%60)}:${pad(s%60)}` : `${pad(m)}:${pad(s%60)}`;
    // Update progress bar + milestone toasts
    const pct = Math.min(100, (s / SESSION_TARGET_SECS) * 100);
    const fill = document.getElementById('sessionProgressFill');
    if (fill) {
      fill.style.width = pct + '%';
      if (pct >= 90) fill.style.background = 'var(--red)';
      else if (pct >= 75) fill.style.background = 'var(--yellow)';
      else fill.style.background = 'var(--accent)';
    }
    // One-shot milestone warnings
    if (pct >= 90 && !_timer90Toasted) {
      _timer90Toasted = true;
      toast('⚠ 90% of session time elapsed', 'warn', 5000);
    } else if (pct >= 75 && !_timer75Toasted) {
      _timer75Toasted = true;
      toast('75% of the session time has passed', 'info', 4000);
    }
  }, 1000);
}
let _timer75Toasted = false;
let _timer90Toasted = false;
startTimer();

function toggleAuto() {
  autoAI = !autoAI;
  if (autoToggle) { autoToggle.classList.toggle('on', autoAI); autoToggle.setAttribute('aria-checked', String(autoAI)); }
}

// ── Network status ────────────────────────────────────────────────────────────
window.addEventListener('offline', () => {
  toast('⚠ No internet — AI and mic save features offline', 'error', 0);
  setStatus('Offline');
});
window.addEventListener('online', () => {
  toast('Back online', 'success', 3000);
  setStatus('');
});

// Activate session
fetch(`/api/session/${SESSION_ID}/activate/`, {
  method: 'POST', headers: {'X-CSRFToken': getCookie('csrftoken')}
}).then(() => {
  statusBadge.textContent = 'Live';
  statusBadge.className = 'badge badge-active';
});

// ── Font size controls ────────────────────────────────────────────────────────
function adjustFontSize(delta) {
  transcriptFontSize = Math.max(10, Math.min(20, transcriptFontSize + delta));
  document.querySelectorAll('#transcriptPanel .text').forEach(el => el.style.fontSize = transcriptFontSize + 'px');
}
function adjustAIFontSize(delta) {
  aiFontSize = Math.max(10, Math.min(20, aiFontSize + delta));
  _doc().querySelectorAll('.ai-answer, .ai-item-a').forEach(el => el.style.fontSize = aiFontSize + 'px');
}

// ── Waveform visualizer ───────────────────────────────────────────────────────
const bottomBar = document.querySelector('.bottom-bar');
function startWaveform(stream) {
  // Close any existing context first to avoid duplicates
  if (audioCtx) { try { audioCtx.close(); } catch(e){} audioCtx = null; analyser = null; }
  waveDrawing = false;
  audioCtx = new AudioContext();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  audioCtx.createMediaStreamSource(stream).connect(analyser);
  bottomBar.classList.add('recording');
  waveformWrap.classList.add('active');
  requestAnimationFrame(() => { waveformCanvas.width = waveformWrap.offsetWidth; });
  waveDrawing = true;
  drawWave();
}
function stopWaveform() {
  waveDrawing = false;
  bottomBar.classList.remove('recording');
  waveformWrap.classList.remove('active');
  if (audioCtx) { try { audioCtx.close(); } catch(e){} audioCtx = null; analyser = null; }
  waveCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
}
function drawWave() {
  if (!waveDrawing || !analyser) return;
  requestAnimationFrame(drawWave);
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data);
  const w = waveformCanvas.width, h = waveformCanvas.height;
  waveCtx.clearRect(0, 0, w, h);

  // Waveform colour: brand yellow while an answer is streaming, the secondary accent otherwise
  const _light = document.documentElement.getAttribute('data-theme') === 'light';
  const waveColor = isStreaming ? (_light ? '#A15C00' : '#FFC83D') : (_light ? '#4636C9' : '#A9A4FF');
  const waveGlow = isStreaming ? 'rgba(255,200,61,0.18)' : (_light ? 'rgba(70,54,201,0.14)' : 'rgba(169,164,255,0.18)');

  // Glow pass
  waveCtx.beginPath();
  waveCtx.strokeStyle = waveGlow;
  waveCtx.lineWidth = 5;
  const sliceW = w / data.length;
  let x = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128.0;
    const y = (v * h) / 2;
    i === 0 ? waveCtx.moveTo(x, y) : waveCtx.lineTo(x, y);
    x += sliceW;
  }
  waveCtx.stroke();

  // Sharp line pass
  waveCtx.beginPath();
  waveCtx.strokeStyle = waveColor;
  waveCtx.lineWidth = 1.5;
  x = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 128.0;
    const y = (v * h) / 2;
    i === 0 ? waveCtx.moveTo(x, y) : waveCtx.lineTo(x, y);
    x += sliceW;
  }
  waveCtx.stroke();
}

// ── MIC (MediaRecorder → Groq Whisper) ───────────────────────────────────────
async function toggleMic() {
  if (!micActive) await startMic();
  else stopMic();
}

// ── Silence detection helpers ─────────────────────────────────────────────────
function startSilenceWatch(onSilence, watchStream) {
  if (silenceWatching) return;
  silenceWatching = true;
  let silenceStart = null;

  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const silenceAnalyser = audioContext.createAnalyser();
  silenceAnalyser.fftSize = 2048;
  const buf = new Float32Array(silenceAnalyser.fftSize);

  const activeStream = watchStream || micStream;
  if (activeStream) {
    try { audioContext.createMediaStreamSource(activeStream).connect(silenceAnalyser); }
    catch(_) {}
  }

  function check() {
    if (!silenceWatching) { audioContext.close(); return; }
    silenceAnalyser.getFloatTimeDomainData(buf);
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
    const rms = Math.sqrt(sumSq / buf.length);
    if (rms < SILENCE_THRESHOLD) {
      if (!silenceStart) silenceStart = Date.now();
      else if (Date.now() - silenceStart >= SILENCE_HOLD_MS) {
        silenceWatching = false;
        audioContext.close();
        onSilence();
        return;
      }
    } else {
      silenceStart = null;
    }
    silenceTimer = requestAnimationFrame(check);
  }
  silenceTimer = requestAnimationFrame(check);
}

function clearSilenceWatch() {
  silenceWatching = false;
  if (silenceTimer) { cancelAnimationFrame(silenceTimer); silenceTimer = null; }
}

// ── Transcribe config panel ───────────────────────────────────────────────────
function toggleTCPanel() {
  // tcPanel lives inside #aiFloatPanel so it travels to PiP; use _doc() to find it
  const doc = _doc();
  const panel = doc.getElementById('tcPanel');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  if (!isOpen && doc === document) {
    // On a phone the answer panel is hidden while the Transcript tab is showing, which hid this
    // panel too. Show it as a sheet from the page itself, and put it back when it closes.
    const home = panel._home || panel.parentElement;
    if (!home.getClientRects().length) {
      panel._home = home;
      document.body.appendChild(panel);
      panel.classList.add('tc-sheet');
    }
  }
  if (isOpen) _returnTCPanel(panel);
  panel.classList.toggle('open', !isOpen);
  // Highlight whichever ⚙ button is in the active document
  const btn = doc.getElementById('fTcConfigBtn') || doc.getElementById('tcConfigBtn') || document.getElementById('tcConfigBtn');
  if (btn) btn.classList.toggle('open', !isOpen);
}

function _returnTCPanel(panel) {
  if (panel && panel._home && panel.classList.contains('tc-sheet')) {
    panel.classList.remove('tc-sheet');
    panel._home.appendChild(panel);
  }
}

// Returns true for numeric interval modes (e.g. '2', '5', '30', '120')
function isIntervalMode(mode) { return !isNaN(parseInt(mode)); }

// Heuristic: text looks like a complete question
function isQuestionEnding(text) {
  const t = text.trim();
  if (t.endsWith('?')) return true;
  return /(?:right|correct|okay|yeah)\s*[.!]?\s*$/i.test(t) && t.split(/\s+/).length > 4;
}

function setTranscribeMode(mode) {
  transcribeMode = mode;
  localStorage.setItem('transcribeMode', mode);

  // For interval modes, sync transcribeIntervalSec immediately
  const sec = parseInt(mode);
  if (!isNaN(sec)) {
    transcribeIntervalSec = sec;
    localStorage.setItem('transcribeInterval', String(sec));
  }

  // Cancel any pending auto-submit queued before the switch
  clearTimeout(autoTriggerTimer);
  autoTriggerTimer = null;

  // Sync the dropdown (tcPanel lives in float panel, use _doc() so PiP finds it)
  const _d = _doc();
  const sel = _d.getElementById('tcIntervalSel') || document.getElementById('tcIntervalSel');
  if (sel && sel.value !== mode) sel.value = mode;

  const manualInfo  = _d.getElementById('tcManualInfo')  || document.getElementById('tcManualInfo');
  const dynamicInfo = _d.getElementById('tcDynamicInfo') || document.getElementById('tcDynamicInfo');
  if (manualInfo)  manualInfo.style.display  = mode === 'manual'  ? 'flex' : 'none';
  if (dynamicInfo) dynamicInfo.style.display = mode === 'dynamic' ? 'flex' : 'none';

  // Update visible mic mode badge
  const modeLabels = { manual:'Manual', dynamic:'Dynamic', '2':'2s', '5':'5s', '10':'10s', '30':'30s', '60':'1 min', '120':'2 min' };
  const badge = document.getElementById('micModeBadge');
  if (badge) {
    badge.textContent = modeLabels[mode] || mode;
    badge.style.color = mode === 'manual' ? 'var(--yellow)' : 'var(--text3)';
    badge.style.borderColor = mode === 'manual' ? 'var(--yellow)' : 'var(--border)';
    badge.style.background = mode === 'manual' ? 'rgb(var(--yellow-rgb) / 0.08)' : 'var(--bg3)';
  }

  // Hide Auto AI toggle in manual mode — it has no effect there
  const autoToggleLabel = autoToggle && autoToggle.closest('label');
  if (autoToggleLabel) autoToggleLabel.style.display = mode === 'manual' ? 'none' : 'flex';
}


// PiP window reference — declared here (before any IIFE that calls _doc()) to avoid TDZ errors
let _pipDocWindow = null;

// Initialize TC panel UI from stored prefs
(function initTCPanel() {
  const VALID_MODES = ['manual', '2', '5', '10', '30', '60', '120', 'dynamic'];
  let mode = localStorage.getItem('transcribeMode') || '30';
  // Migrate old 'auto' → '30' (closest timed equivalent)
  if (mode === 'auto') mode = '30';
  // Snap interval-only values to nearest valid option
  if (isIntervalMode(mode)) {
    const validSec = [2, 5, 10, 30, 60, 120];
    const sec = parseInt(mode);
    const snapped = validSec.reduce((a, b) => Math.abs(b - sec) < Math.abs(a - sec) ? b : a, 30);
    mode = String(snapped);
  }
  if (!VALID_MODES.includes(mode)) mode = '30';
  setTranscribeMode(mode);
})();

// ── Meeting Helper ────────────────────────────────────────────────────────────
const MEETING_ROLES = {
  architect: { name: 'Architect', questions: [
    { q: 'What are the scalability requirements for this system?', tags: ['scale','traffic','load','user','growth','concurrent'] },
    { q: 'How does this integrate with existing services?', tags: ['integrat','service','api','connect','system','microservice'] },
    { q: 'What are the latency and throughput expectations?', tags: ['latency','performance','speed','response','throughput','SLA'] },
    { q: 'What database technology is used and why?', tags: ['database','db','postgres','mysql','mongo','redis','storage','SQL','NoSQL'] },
    { q: 'How is data consistency handled across services?', tags: ['consistent','eventual','transaction','ACID','sync','replicat'] },
    { q: 'What are the failure modes and recovery strategies?', tags: ['fail','recover','outage','disaster','resilient','fault','circuit'] },
    { q: 'How is authentication and authorization handled?', tags: ['auth','login','permission','role','JWT','OAuth','security','token'] },
    { q: 'What observability exists — logs, metrics, traces?', tags: ['log','monitor','metric','trace','observ','alert','dashboard','telemetry'] },
    { q: 'How is the deployment pipeline structured?', tags: ['deploy','pipeline','CI','CD','release','build','artifact'] },
    { q: 'What is the plan for horizontal scaling?', tags: ['horizontal','scaling','replica','shard','cluster','node','pod'] },
    { q: 'How is configuration managed across environments?', tags: ['config','environment','staging','production','env','setting'] },
    { q: 'What are the main security concerns to address?', tags: ['security','vulnerab','attack','encrypt','TLS','HTTPS','CVE'] },
  ]},
  developer: { name: 'Developer', questions: [
    { q: 'What tech stack and languages are being used?', tags: ['stack','framework','language','library','React','Node','Python','Java','Go','Rust'] },
    { q: 'How is the codebase structured and organized?', tags: ['folder','module','package','structure','organiz','monorepo'] },
    { q: 'What testing strategy is in place?', tags: ['test','unit','integration','e2e','coverage','TDD','BDD','jest','pytest'] },
    { q: 'How are code reviews and PRs handled?', tags: ['review','PR','pull request','merge','approve'] },
    { q: 'What are the main performance bottlenecks?', tags: ['slow','bottleneck','performance','profil','optim','N+1','query'] },
    { q: 'How is state management handled in the frontend?', tags: ['state','Redux','context','store','frontend','UI','Zustand'] },
    { q: 'What API patterns are used — REST, GraphQL, gRPC?', tags: ['API','REST','GraphQL','gRPC','endpoint','request','schema'] },
    { q: 'How is error handling and logging structured?', tags: ['error','exception','log','handle','catch','try','Sentry'] },
    { q: 'What branching strategy does the team use?', tags: ['branch','git','merge','trunk','feature','gitflow','rebase'] },
    { q: 'How is technical debt managed and prioritized?', tags: ['debt','refactor','legacy','rewrite','cleanup','TODO','FIXME'] },
    { q: 'What is the local development setup like?', tags: ['local','setup','docker','devcontainer','develop','seed'] },
    { q: 'How are dependencies managed and kept up to date?', tags: ['depend','version','package','update','npm','pip','upgrade'] },
  ]},
  pm: { name: 'Product', questions: [
    { q: 'What is the core problem this feature solves?', tags: ['problem','pain','need','why','purpose','solve','value'] },
    { q: 'Who are the target users for this?', tags: ['user','customer','persona','audience','who','segment','B2B','B2C'] },
    { q: 'What does success look like — what are the KPIs?', tags: ['success','goal','KPI','metric','target','measure','OKR'] },
    { q: 'What is the timeline and key milestones?', tags: ['timeline','milestone','deadline','when','schedule','date','sprint'] },
    { q: 'What are the main dependencies or blockers?', tags: ['block','depend','risk','obstacle','wait','need','gating'] },
    { q: 'How does this align with the product roadmap?', tags: ['roadmap','strategy','vision','quarter','priority','theme'] },
    { q: 'What user research or data supports this decision?', tags: ['research','data','survey','interview','feedback','NPS','CSAT'] },
    { q: 'What is the rollout and go-to-market strategy?', tags: ['rollout','launch','release','phased','beta','GTM','marketing'] },
    { q: 'How will we measure user adoption?', tags: ['adoption','usage','engagement','retention','DAU','MAU','churn'] },
    { q: 'What are the risks and mitigation plans?', tags: ['risk','mitigat','contingency','fallback','assumption'] },
  ]},
  qa: { name: 'QA', questions: [
    { q: 'What test coverage currently exists for this area?', tags: ['test','coverage','unit','integration','tested','percent'] },
    { q: 'What edge cases and boundary conditions need testing?', tags: ['edge','boundary','extreme','case','corner','null','empty'] },
    { q: 'How are regression tests maintained?', tags: ['regression','existing','break','backward','compatible','suite'] },
    { q: 'What automation framework is being used?', tags: ['automat','selenium','cypress','playwright','jest','pytest','robot'] },
    { q: 'How are bugs triaged and prioritized?', tags: ['bug','defect','issue','ticket','priority','severity','P0','P1'] },
    { q: 'What is the performance and load testing strategy?', tags: ['performance','load','stress','JMeter','k6','locust','spike'] },
    { q: 'What is the release acceptance criteria?', tags: ['accept','criteria','release','sign-off','ready','done','ship'] },
    { q: 'How is test data managed across environments?', tags: ['test data','fixture','seed','mock','stub','fake','factory'] },
    { q: 'How are security and penetration tests handled?', tags: ['security','pentest','OWASP','vulnerab','injection','XSS'] },
    { q: 'How are flaky tests identified and handled?', tags: ['flaky','intermittent','retry','stable','reliable'] },
  ]},
  devops: { name: 'DevOps', questions: [
    { q: 'What infrastructure is this deployed on?', tags: ['infra','cloud','AWS','GCP','Azure','kubernetes','k8s','ECS','EC2'] },
    { q: 'How is infrastructure provisioned — Terraform, CDK?', tags: ['terraform','IaC','provision','CDK','CloudFormation','pulumi','Ansible'] },
    { q: 'What is the deployment rollback strategy?', tags: ['rollback','revert','blue-green','canary','deploy','undo'] },
    { q: 'How are secrets and credentials managed?', tags: ['secret','credential','vault','env','key','token','password','SSM'] },
    { q: 'What monitoring and alerting is in place?', tags: ['monitor','alert','Datadog','Grafana','PagerDuty','metric','CloudWatch'] },
    { q: 'What is the incident response process?', tags: ['incident','outage','on-call','response','runbook','SRE','postmortem'] },
    { q: 'How is auto-scaling configured?', tags: ['autoscale','HPA','scale','load','replica','resource','CPU','memory'] },
    { q: 'What are the SLA/SLO/SLI targets?', tags: ['SLA','SLO','SLI','uptime','availability','reliability','nines'] },
    { q: 'How is network security managed — VPC, firewalls?', tags: ['network','firewall','VPC','security group','WAF','ingress','egress'] },
    { q: 'How are container images built and managed?', tags: ['docker','container','image','registry','ECR','GCR','helm','chart'] },
  ]},
};

let meetingRole = null;

function toggleMHPanel() {
  const panel = document.getElementById('mhPanel');
  const btn   = document.getElementById('mhBtn');
  if (!panel) return;
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  if (btn) btn.classList.toggle('active', !isOpen);
  if (!isOpen) refreshMHSuggestions();
}

function setMeetingRole(role) {
  meetingRole = role;
  localStorage.setItem('meetingRole', role);
  document.querySelectorAll('.mh-role-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.role === role);
  });
  refreshMHSuggestions();
}

function getMHContext() {
  const entries = transcriptPanel ? transcriptPanel.querySelectorAll('.transcript-entry .text') : [];
  return Array.from(entries).slice(-8).map(e => e.textContent).join(' ').toLowerCase();
}

function refreshMHSuggestions() {
  const container = document.getElementById('mhSuggestions');
  const badge = document.getElementById('mhBadge');
  if (!container) return;
  if (!meetingRole || !MEETING_ROLES[meetingRole]) {
    container.innerHTML = '<span style="font-size:12px;color:var(--text3)">Select a role above to see questions</span>';
    if (badge) badge.style.display = 'none';
    return;
  }
  const context = getMHContext();
  const hasContext = context.length > 30;
  const questions = MEETING_ROLES[meetingRole].questions;
  const scored = questions.map(q => ({
    ...q,
    score: q.tags.reduce((s, tag) => s + (context.includes(tag.toLowerCase()) ? 1 : 0), 0)
  }));
  scored.sort((a, b) => b.score - a.score);
  container.innerHTML = '';
  scored.forEach(item => {
    const btn = document.createElement('button');
    const isMatch = item.score > 0 && hasContext;
    btn.className = 'mh-suggestion-item' + (isMatch ? ' context-match' : '');
    btn.textContent = item.q;
    btn.title = isMatch ? 'Contextually relevant to your conversation' : 'Role template question';
    btn.onclick = () => {
      const qi = document.getElementById('questionInput');
      const fqi = (typeof _doc === 'function') ? _doc().getElementById('fQuestionInput') : null;
      if (qi) { qi.value = item.q; qi.focus(); }
      if (fqi) fqi.value = item.q;
      const panel = document.getElementById('mhPanel');
      const mhBtn = document.getElementById('mhBtn');
      if (panel) panel.classList.remove('open');
      if (mhBtn) mhBtn.classList.remove('active');
    };
    container.appendChild(btn);
  });
  const matchCount = scored.filter(q => q.score > 0 && hasContext).length;
  if (badge) {
    badge.textContent = matchCount || '';
    badge.style.display = matchCount > 0 ? 'inline' : 'none';
  }
}

(function initMeetingRole() {
  const saved = localStorage.getItem('meetingRole');
  if (saved && MEETING_ROLES[saved]) {
    meetingRole = saved;
    setTimeout(() => {
      document.querySelectorAll('.mh-role-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.role === saved);
      });
    }, 100);
  }
})();

let micRecognition = null;
let micLastCommitted = '';
let micManualAccum = '';   // tracks committed finals in manual mode (not interim)

function setMicInputText(text) {
  const qi = document.getElementById('questionInput');
  const fi = (typeof _doc === 'function') ? _doc().getElementById('fQuestionInput') : null;
  if (qi) qi.value = text;
  if (fi) fi.value = text;
}

function getMicInputText() {
  const qi = document.getElementById('questionInput');
  return qi ? qi.value : '';
}

function makeMicRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = LANGUAGE || 'en-US';
  rec.maxAlternatives = 1;
  rec.onsoundstart = () => { micHeardSound = true; };
  rec.onaudiostart = () => { micAudioStarted = true; };

  rec.onresult = (event) => {
    let interimStr = '';
    let finalStr   = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalStr += t;
      else interimStr += t;
    }

    // Show live interim speech in both the chat input AND the transcript panel (real-time)
    if (interimStr) {
      // In manual mode, prefix accumulated finals so user sees the whole utterance so far
      const displayText = transcribeMode === 'manual' && micManualAccum
        ? micManualAccum + ' ' + interimStr
        : interimStr;
      setMicInputText(displayText);
      interimText.textContent = displayText;
      interimEntry.style.display = 'flex';
      if (transcriptPlaceholder) transcriptPlaceholder.style.display = 'none';
      scrollTranscript();
    }

    if (finalStr.trim()) {
      const text = finalStr.trim();
      // Hide interim indicator now that we have a final result
      interimEntry.style.display = 'none';
      interimText.textContent = 'Transcribing…';
      if (transcriptPlaceholder && transcriptCount === 0) transcriptPlaceholder.style.display = 'flex';
      if (text === micLastCommitted) return;
      micLastCommitted = text;
      console.log('[onresult final] transcribeMode=' + transcribeMode + ' text=' + text.slice(0, 40));

      if (transcribeMode !== 'manual') {
        // Timed / dynamic: save text and optionally submit to AI
        setMicInputText(text);
        saveMicToServer(text);
        addTranscriptEntryUI(text, 'microphone');
        refreshMHSuggestions();
        if (autoAI && (transcribeMode !== 'dynamic' || isQuestionEnding(text))) triggerAI(text, true);
      } else {
        // Manual: accumulate finals — do NOT save or add to transcript until committed
        micManualAccum = (micManualAccum ? micManualAccum + ' ' : '') + text;
        setMicInputText(micManualAccum);
        interimText.textContent = micManualAccum;
        if (interimLabel) { interimLabel.textContent = 'ACCUMULATING'; interimLabel.style.color = 'var(--yellow)'; }
        interimEntry.style.display = 'flex';
        if (transcriptPlaceholder) transcriptPlaceholder.style.display = 'none';
        scrollTranscript();
      }
    }
  };

  rec.onerror = (e) => {
    if (e.error === 'no-speech') return;
    if (e.error === 'aborted')  return;
    // A phone stops listening while the page is in the background; pick up again on return
    if (document.hidden) { micResumeOnShow = true; return; }
    setStatus('Speech error: ' + e.error);
    const fatal = ['audio-capture', 'not-allowed', 'service-not-allowed', 'language-not-supported'].includes(e.error);
    if (fatal) {
      rec._fatal = true;
      // iOS refuses a restart that did not come from a tap; that is a pause, not a permission problem
      const msg = (rec._auto && e.error === 'not-allowed')
        ? 'Listening paused. Tap the microphone to continue.'
        : (MIC_ERROR_TEXT[e.error] || ('The microphone stopped: ' + e.error));
      micNotice(msg, 'error', 10000);
    } else {
      micNotice(MIC_ERROR_TEXT[e.error] || ('Speech error: ' + e.error), 'warn', 6000);
    }
  };

  // Fresh instance on each restart — prevents Chrome re-firing old final results
  rec.onend = () => {
    if (!micActive) return;
    if (rec._fatal) { stopMic(); return; }
    if (document.hidden) { micResumeOnShow = true; return; }
    micRecognition = makeMicRecognition();
    micRecognition._auto = true;
    try { micRecognition.start(); } catch (_) { micResumeOnShow = true; }
  };

  return rec;
}

const MIC_ERROR_TEXT = {
  'audio-capture': 'No sound is reaching the microphone. If a call or another app is using the microphone on this device, it cannot be shared: a phone lets one app listen at a time. Run the call on another device, or end it here.',
  'not-allowed': 'Microphone permission is off for this site. Allow it in the browser settings, then tap the microphone again.',
  'service-not-allowed': IS_IOS
    ? 'Speech recognition is off on this iPhone. Turn on Settings > General > Keyboard > Enable Dictation, then tap the microphone again.'
    : 'This browser blocked speech recognition for this site.',
  'network': 'The speech service could not be reached. Check the connection; listening will retry.',
  'language-not-supported': 'This browser cannot transcribe the language set for this session.',
};
let micHeardSound = false, micAudioStarted = false, micResumeOnShow = false, micWatchdog = null;
const _micNoticeShown = {};
// The status chip is hidden on phones, so microphone problems also show as a message, once per 30 s
function micNotice(msg, kind, ms) {
  setStatus(msg);
  const now = Date.now();
  if (_micNoticeShown[msg] && now - _micNoticeShown[msg] < 30000) return;
  _micNoticeShown[msg] = now;
  toast(msg, kind || 'warn', ms || 7000);
}

// Coming back to the page after switching apps: listen again
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !micActive || !micResumeOnShow) return;
  micResumeOnShow = false;
  try { if (micRecognition) { micRecognition.onend = null; micRecognition.stop(); } } catch (_) {}
  micRecognition = makeMicRecognition();
  micRecognition._auto = true;
  try { micRecognition.start(); } catch (_) { micNotice('Listening paused. Tap the microphone to continue.', 'warn', 8000); }
});

async function startMic() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast(IS_PHONE
      ? 'This browser cannot turn speech into text. On iPhone use Safari; on Android use Chrome.'
      : 'This browser cannot transcribe speech. Use Chrome or Edge.', 'error', 7000);
    return;
  }

  // On a phone the speech recogniser needs the microphone to itself: a second capture of the
  // same microphone (for the level meter and the saved audio copy) leaves it hearing nothing.
  // Phones therefore skip that second capture; computers keep it.
  if (!IS_PHONE) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch(err) {
      setStatus('Mic blocked');
      const busy = err && (err.name === 'NotReadableError' || err.name === 'TrackStartError');
      toast(busy
        ? 'The microphone is in use by another app or tab. Close it, then try again.'
        : 'Microphone blocked: ' + err.message + '. Allow it in the browser permissions.', 'error', 8000);
      return;
    }
  }
  micHeardSound = false; micAudioStarted = false; micResumeOnShow = false;

  micActive = true;
  micLastCommitted = '';
  micManualAccum = '';
  micBtn.classList.add('active');
  micBtn.innerHTML = ICON_STOP; micBtn.setAttribute('aria-pressed', 'true');
  const _fm = _doc().getElementById('fMicBtn');
  if (_fm) { _fm.classList.add('active'); _fm.innerHTML = ICON_STOP; }
  recDot.classList.add('active');
  document.title = '🔴 Recording — ' + (document.title.replace(/^[🔴✨]\s*/,''));
  setStatus('Listening… speak your question');
  if (micStream) startWaveform(micStream);

  micRecognition = makeMicRecognition();
  try {
    micRecognition.start();
  } catch (err) {
    micNotice('The microphone could not start: ' + err.message, 'error', 8000);
    stopMic();
    return;
  }
  if (micStream) startRawRecording(micStream);

  // Phones: say so if nothing has been heard after 12 seconds
  clearTimeout(micWatchdog);
  if (IS_PHONE) {
    micWatchdog = setTimeout(() => {
      if (micActive && !micHeardSound && !document.hidden) micNotice(MIC_ERROR_TEXT['audio-capture'], 'warn', 10000);
    }, 12000);
  }

  // Warn clearly if manual mode is active — words won't appear in transcript automatically
  if (transcribeMode === 'manual') {
    toast('Manual mode: speech is held back until you press Get answer or Save', 'warn', 6000);
  }
}

function saveMicToServer(text) {
  fetch(`/api/session/${SESSION_ID}/transcript/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
    body: JSON.stringify({ transcripts: [{ content: text, type: 'microphone' }] })
  }).catch(() => {});
}

// ── Raw audio recording — continuous 30-second chunks saved to server ─────────
function startRawRecording(stream) {
  if (!stream || (rawRecorder && rawRecorder.state !== 'inactive')) return;
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus' : 'audio/webm';
  try {
    rawRecorder = new MediaRecorder(stream, { mimeType });
    rawChunkSeq = 0;
    rawRecorder.ondataavailable = (e) => {
      if (!e.data || e.data.size < 100) return;
      const seq = rawChunkSeq++;
      const blob = e.data;
      // Use sendBeacon for reliability (works even during page unload)
      const url = `/api/session/${SESSION_ID}/audio-chunk/`;
      const ok = navigator.sendBeacon
        ? navigator.sendBeacon(url + `?seq=${seq}&csrf=${getCookie('csrftoken')}`, blob)
        : false;
      if (!ok) {
        // Fallback to fetch
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': blob.type || 'audio/webm', 'X-Chunk-Seq': String(seq), 'X-CSRFToken': getCookie('csrftoken') },
          body: blob,
        }).catch(() => {});
      }
    };
    rawRecorder.start(30000); // dataavailable every 30 seconds
  } catch (err) {
    console.warn('Raw audio recording unavailable:', err.message);
  }
}

function stopRawRecording() {
  if (rawRecorder && rawRecorder.state !== 'inactive') {
    try { rawRecorder.stop(); } catch (_) {}
  }
  rawRecorder = null;
}

window.addEventListener('beforeunload', () => {
  if (rawRecorder && rawRecorder.state === 'recording') {
    try { rawRecorder.requestData(); rawRecorder.stop(); } catch (_) {}
  }
  // Save any unsaved mic text on page close (keepalive:true works during unload)
  const _qiUnload = document.getElementById('questionInput');
  const _textUnload = (typeof micManualAccum !== 'undefined' ? micManualAccum.trim() : '') ||
                      (_qiUnload ? _qiUnload.value.trim() : '');
  if (_textUnload) {
    fetch(`/api/session/${SESSION_ID}/transcript/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcripts: [{ content: _textUnload, type: 'microphone' }] }),
      keepalive: true,
    }).catch(() => {});
  }
});

function stopMic() {
  micActive = false;
  clearTimeout(micWatchdog);
  micResumeOnShow = false;
  if (micStream) { try { micStream.getTracks().forEach(t => t.stop()); } catch (_) {} }
  micStream = null;
  if (micRecognition) { micRecognition.onend = null; micRecognition.stop(); micRecognition = null; }

  // Auto-save any unsaved spoken text before stopping (manual mode accumulates without saving)
  const qi = document.getElementById('questionInput');
  const fi = (typeof _doc === 'function') ? _doc().getElementById('fQuestionInput') : null;
  const inputVal = (qi ? qi.value : '').trim() || (fi ? fi.value : '').trim();
  const textToSave = micManualAccum.trim() || inputVal;
  if (textToSave) {
    saveMicToServer(textToSave);
    addTranscriptEntryUI(textToSave, 'microphone');
    if (qi) qi.value = '';
    if (fi) fi.value = '';
    micManualAccum = '';
    micLastCommitted = '';
  }

  interimEntry.style.display = 'none';
  interimText.textContent = 'Transcribing…';
  if (interimLabel) { interimLabel.textContent = 'You'; interimLabel.style.color = 'var(--accent2)'; }
  if (transcriptPlaceholder && transcriptCount === 0) transcriptPlaceholder.style.display = 'flex';
  micBtn.classList.remove('active');
  micBtn.innerHTML = ICON_MIC; micBtn.setAttribute('aria-pressed', 'false');
  const _fmOff = _doc().getElementById('fMicBtn');
  if (_fmOff) { _fmOff.classList.remove('active'); _fmOff.innerHTML = ICON_MIC; }
  recDot.classList.remove('active');
  document.title = document.title.replace(/^[🔴✨]\s*/,'');
  setStatus('Mic off');
  stopWaveform();
  stopRawRecording();
}


async function sendAudioChunk(blob, mimeType, speaker = 'microphone') {
  if (blob.size < 500) return;

  const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
  const formData = new FormData();
  formData.append('audio', blob, `audio.${ext}`);
  formData.append('speaker', speaker);
  let _resolvedSpeakerName = '';
  if (speaker === 'system') {
    // Teams active speaker takes priority; fall back to auto-speaker numbering
    const teamsName = typeof getActiveSpeakerName === 'function' ? getActiveSpeakerName() : '';
    if (teamsName) {
      _resolvedSpeakerName = teamsName;
      _lastSystemAudioTs = Date.now(); // keep gap tracking in sync
    } else {
      const autoSpk = _checkSpeakerChange(); // creates/advances auto-speaker as needed
      if (autoSpk) _resolvedSpeakerName = autoSpk.name;
    }
    if (_resolvedSpeakerName) formData.append('speaker_name', _resolvedSpeakerName);
  }

  try {
    const resp = await fetch(`/api/session/${SESSION_ID}/transcribe/`, {
      method: 'POST',
      headers: { 'X-CSRFToken': getCookie('csrftoken') },
      body: formData,
    });
    const data = await resp.json();

    if (data.error) { setStatus('Transcribe error: ' + data.error); return; }
    if (!data.text || !data.text.trim()) return;

    addTranscriptEntryUI(data.text.trim(), data.speaker || speaker, data.speaker_name || _resolvedSpeakerName);
    refreshMHSuggestions();
    setStatus('Transcribed ✓');

    if (autoAI && transcribeMode !== 'manual' && data.text.includes('?')) {
      clearTimeout(autoTriggerTimer);
      autoTriggerTimer = setTimeout(() => triggerAI(data.text.trim(), true), 1200);
    }
  } catch(err) {
    setStatus('Error: ' + err.message);
  }
}

function populateInputFromTranscript(text) {
  const qi = document.getElementById('questionInput');
  const fi = _doc().getElementById('fQuestionInput');
  if (qi) { qi.value = text; qi.focus(); }
  if (fi) fi.value = text;
}

// ── Speaker rename + tone system ─────────────────────────────────────────────
const _SPEAKER_NAMES_KEY = `speakerNames_${SESSION_ID}`;
const _SPEAKER_COLORS = { microphone: 'var(--accent)', system: 'var(--yellow)', note: 'var(--text3)' };
const _SPEAKER_DEFAULTS = { microphone: 'You', system: 'Interviewer', note: 'Note' };

function _loadSpeakerNames() {
  try { return JSON.parse(localStorage.getItem(_SPEAKER_NAMES_KEY) || '{}'); } catch(e) { return {}; }
}
function _saveSpeakerName(type, name) {
  const names = _loadSpeakerNames();
  names[type] = name;
  try { localStorage.setItem(_SPEAKER_NAMES_KEY, JSON.stringify(names)); } catch(e) {}
}

function speakerLabel(type, speakerName) {
  if (speakerName) return speakerName;
  const stored = _loadSpeakerNames();
  if (stored[type]) return stored[type];
  return _SPEAKER_DEFAULTS[type] || type;
}

// Detect tone emoji from text content
function _detectTone(text) {
  const t = text.toLowerCase();
  if (/\b(error|fail|broken|bug|crash|wrong|problem|issue|frustrat|angry|terrible|worst|hate)\b/.test(t)) return '😤';
  if (/\b(great|excellent|perfect|amazing|love|wonderful|fantastic|brilliant|awesome)\b/.test(t)) return '😊';
  if (/\b(maybe|perhaps|not sure|unsure|wonder|think|curious|interesting|confus)\b/.test(t)) return '🤔';
  if (/\b(todo|action|follow.?up|remind|deadline|assign|owner|task|must|need to|should)\b/.test(t)) return '📌';
  if (/^(yes|no|ok|okay|sure|agree|correct|right|exactly|absolutely|definitely)[\s.,!]/.test(t)) return '✓';
  return '';
}

// Rename a speaker type everywhere in the transcript
function renameSpeaker(type, newName) {
  const trimmed = newName.trim();
  if (!trimmed) return;
  _saveSpeakerName(type, trimmed);
  document.querySelectorAll(`.transcript-entry.${type} .speaker-name-editable`).forEach(el => {
    el.textContent = trimmed;
    el.title = 'Click to rename';
  });
  toast(`// ${_SPEAKER_DEFAULTS[type] || type} → "${trimmed}"`, 'success', 2500);
}

// Inline rename: clicking the speaker name shows an input
function _startSpeakerRename(span, type) {
  const current = span.textContent;
  const inp = document.createElement('input');
  inp.className = 'speaker-rename-input';
  inp.value = current;
  inp.title = 'Enter to rename all entries · Esc to cancel';
  span.replaceWith(inp);
  inp.focus(); inp.select();
  let _committed = false;
  const commit = () => {
    if (_committed) return; _committed = true;
    const val = inp.value.trim() || current;
    renameSpeaker(type, val);
    const newSpan = document.createElement('span');
    newSpan.className = 'speaker-name-editable';
    newSpan.title = 'Click to rename this speaker';
    newSpan.textContent = val;
    newSpan.addEventListener('click', e => { e.stopPropagation(); _startSpeakerRename(newSpan, type); });
    if (inp.parentNode) inp.replaceWith(newSpan);
  };
  const cancel = () => { if (_committed) return; _committed = true; if (inp.parentNode) inp.replaceWith(span); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { cancel(); } });
  inp.addEventListener('blur', commit);
}

// Word count, speaking rate and keyword tracking
let _totalWords = 0;
let _micWords = 0;    // words from microphone (you)
let _sysWords = 0;    // words from system/interviewer
const _speakEvents = []; // {ts, words}
const _kwFreq = {};
const _KW_STOP = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','is','are','was','were','be','been','it','this','that','have','had','do','did','not','i','you','we','they','he','she','so','as','if','by','from','up','about','can','will','what','how','when','where','just','also','all','its','my','your','our','their','any','some','more','out','there','then']);
function _updateWordStats(text, type) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  _totalWords += words;
  if (type === 'microphone') _micWords += words;
  else if (type === 'system') _sysWords += words;
  _speakEvents.push({ ts: Date.now(), words });
  // Update keyword frequency
  text.trim().toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).forEach(w => {
    if (w.length > 3 && !_KW_STOP.has(w)) _kwFreq[w] = (_kwFreq[w] || 0) + 1;
  });
  // Show top 3 keywords
  const top3 = Object.entries(_kwFreq).sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]);
  const kwEl = document.getElementById('tcTopKeywords');
  if (kwEl) kwEl.textContent = top3.length ? top3.join(' · ') : '';
  // Keep only events in last 60s
  const cutoff = Date.now() - 60000;
  while (_speakEvents.length && _speakEvents[0].ts < cutoff) _speakEvents.shift();
  const wpm = _speakEvents.reduce((s, e) => s + e.words, 0);
  const wcEl = document.getElementById('tcWordCount');
  const srEl = document.getElementById('tcSpeakRate');
  if (wcEl) wcEl.textContent = _totalWords >= 1000 ? (_totalWords / 1000).toFixed(1) + 'k words' : _totalWords + (_totalWords === 1 ? ' word' : ' words');
  if (srEl) {
    if (wpm > 0) {
      srEl.textContent = wpm + ' wpm';
      srEl.style.color = wpm > 180 ? 'var(--red)' : wpm > 120 ? 'var(--accent)' : 'var(--green)';
    } else {
      srEl.textContent = '—';
      srEl.style.color = '';
    }
  }
  // Speaker ratio badge
  const ratioEl = document.getElementById('tcSpeakerRatio');
  if (ratioEl && (_micWords + _sysWords) > 0) {
    const youPct = Math.round((_micWords / (_micWords + _sysWords)) * 100);
    ratioEl.textContent = `You ${youPct}%`;
    ratioEl.style.color = youPct > 70 ? 'var(--yellow)' : youPct < 30 ? 'var(--text3)' : 'var(--green)';
    ratioEl.title = `You: ${_micWords}w  Interviewer: ${_sysWords}w`;
  }
}

// ── Voice segregation ────────────────────────────────────────────────────────
// Global participants list for voice chips — populated by Teams panel on load
let _voiceParticipants = []; // [{id, name, color}, ...]
let _lastSystemAudioTs = 0;  // timestamp of last system audio chunk
const _SPEAKER_CHANGE_GAP_MS = 3000; // gap > 3s → likely new speaker
// Auto-speaker numbering (used when no Teams participants are loaded)
const _AUTO_COLORS = ['#4fc3f7','#81c784','#ffb74d','#f48fb1','#ce93d8','#80cbc4'];
let _autoSpeakers = [];        // [{id, name, color}] client-side only
let _autoSpeakerIdx = -1;      // index of current auto-speaker (-1 = none yet)

function _renderVoiceChips(entryDiv, assignedName) {
  const row = entryDiv.querySelector('.voice-assign-row');
  if (!row || !_voiceParticipants.length) return;
  row.innerHTML = '';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:12px;color:var(--text3);font-family:var(--sans);align-self:center';
  label.textContent = '👤';
  row.appendChild(label);
  _voiceParticipants.forEach(p => {
    const chip = document.createElement('button');
    chip.className = 'voice-chip' + (assignedName === p.name ? ' assigned' : '');
    chip.style.cssText = `color:${p.color};border-color:${p.color};background:${assignedName === p.name ? p.color + '22' : 'transparent'}`;
    chip.textContent = p.name;
    chip.title = `Assign this entry to ${p.name}`;
    chip.addEventListener('click', e => {
      e.stopPropagation();
      _assignVoiceToEntry(entryDiv, p);
    });
    row.appendChild(chip);
  });
}

function _assignVoiceToEntry(entryDiv, participant) {
  const nameSpan = entryDiv.querySelector('.speaker-name-editable');
  if (nameSpan) nameSpan.textContent = participant.name;
  entryDiv.style.borderLeftColor = participant.color;
  entryDiv.classList.remove('unassigned-system');
  // Update all chips in this entry
  entryDiv.querySelectorAll('.voice-chip').forEach(c => {
    const isThis = c.textContent === participant.name;
    c.classList.toggle('assigned', isThis);
    c.style.background = isThis ? participant.color + '22' : 'transparent';
  });
  // Persist to backend if entry has an id
  const entryId = entryDiv.dataset.entryId;
  if (entryId) {
    fetch(`/api/session/${SESSION_ID}/entry/${entryId}/speaker/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
      body: JSON.stringify({ speaker_name: participant.name }),
    }).catch(() => {});
  }
  toast(`// → ${participant.name}`, 'success', 1500);
}

// Called before sending system audio — manages auto-speaker numbering and gap detection
// Returns the current auto-speaker object (or null if Teams participants are active)
function _checkSpeakerChange() {
  const now = Date.now();
  const gap = _lastSystemAudioTs ? now - _lastSystemAudioTs : Infinity;
  _lastSystemAudioTs = now;

  // Teams participants present: pulse buttons on gap, don't auto-number
  if (_voiceParticipants.length && _voiceParticipants[0].id && !String(_voiceParticipants[0].id).startsWith('auto_')) {
    if (gap > _SPEAKER_CHANGE_GAP_MS && _voiceParticipants.length > 1) {
      const btns = document.querySelectorAll('#speakerBtnList button');
      btns.forEach(b => { b.classList.remove('speaker-btn-pulse'); void b.offsetWidth; b.classList.add('speaker-btn-pulse'); });
    }
    return null;
  }

  // Auto-speaker mode: create or advance speaker based on gap
  if (_autoSpeakerIdx < 0 || gap > _SPEAKER_CHANGE_GAP_MS) {
    // First chunk ever, or gap detected → advance to next auto-speaker
    _autoSpeakerIdx++;
    if (_autoSpeakerIdx >= _autoSpeakers.length) {
      const n = _autoSpeakers.length + 1;
      _autoSpeakers.push({ id: `auto_${n}`, name: `Speaker ${n}`, color: _AUTO_COLORS[(n - 1) % _AUTO_COLORS.length] });
    }
    _voiceParticipants = [..._autoSpeakers];
    _syncAutoSpeakerUI();
    _refreshAllVoiceChips();
  }
  return _autoSpeakers[_autoSpeakerIdx] || null;
}

// Render auto-speaker buttons in the Teams panel speaker section
function _syncAutoSpeakerUI() {
  const speakerBtns = document.getElementById('speakerBtnList');
  if (!speakerBtns || !_autoSpeakers.length) return;
  speakerBtns.innerHTML = '';
  const display = document.getElementById('activeSpeakerDisplay');
  _autoSpeakers.forEach((sp, idx) => {
    const isActive = idx === _autoSpeakerIdx;
    const btn = document.createElement('button');
    btn.style.cssText = `padding:4px 10px;border-radius:10px;border:2px solid ${isActive ? sp.color : 'var(--border)'};background:${isActive ? sp.color + '22' : 'transparent'};color:${isActive ? sp.color : 'var(--text2)'};font-size:12px;font-weight:${isActive ? '700' : '400'};cursor:pointer;transition:all 0.15s`;
    btn.textContent = sp.name;
    btn.title = `Set ${sp.name} as active speaker`;
    btn.addEventListener('click', () => {
      _autoSpeakerIdx = idx;
      _syncAutoSpeakerUI();
      if (display) display.innerHTML = `<span style="color:${sp.color};font-weight:700">${escHtml(sp.name)}</span>`;
    });
    speakerBtns.appendChild(btn);
    if (isActive && display) display.innerHTML = `<span style="color:${sp.color};font-weight:700">${escHtml(sp.name)}</span> <span style="font-size:12px;color:var(--text3)">(auto)</span>`;
  });
}

// Refresh voice chips on all unassigned system entries (called after participants load)
function _refreshAllVoiceChips() {
  document.querySelectorAll('.transcript-entry.system').forEach(div => {
    const nameSpan = div.querySelector('.speaker-name-editable');
    const assigned = nameSpan ? nameSpan.textContent.trim() : '';
    _renderVoiceChips(div, assigned);
    const _a = assigned.toUpperCase();
    if (!assigned || _a === 'INTERVIEWER' || _a === 'SYSTEM') {
      div.classList.add('unassigned-system');
    }
  });
}

function addTranscriptEntryUI(text, type, speakerName) {
  const ph = document.getElementById('transcriptPlaceholder');
  if (ph) ph.remove();
  const div = document.createElement('div');
  div.className = `transcript-entry ${type}`;
  div.tabIndex = 0;
  const label = speakerLabel(type, speakerName);
  const now = new Date();
  const ts = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const tone = _detectTone(text);
  const isSystem = type === 'system';
  div.innerHTML = `<div class="entry-select-cb" title="Select this line">✓</div><div class="speaker"><span class="speaker-name-editable" title="Click to rename this speaker">${escHtml(label)}</span>${tone ? `<span class="speaker-tone" title="Tone of this line">${tone}</span>` : ''}<span class="entry-ts">${ts}</span></div><div class="text" style="font-size:${transcriptFontSize}px">${escHtml(text)}</div><div class="voice-assign-row"></div><div class="entry-actions"><button class="entry-action-btn" onclick="event.stopPropagation();sendEntryToAI(this)" title="Get an answer about this line">${ICONS.sparkle} Ask</button><button class="entry-action-btn" onclick="event.stopPropagation();toggleEntrySelection(this.closest('.transcript-entry'))" title="Select this line to ask about several at once">${ICONS.select} Select</button><button class="entry-action-btn" onclick="event.stopPropagation();editTranscriptEntry(this)" title="Edit this line" aria-label="Edit this line">${ICONS.edit}</button><button class="entry-action-btn entry-action-danger" onclick="event.stopPropagation();deleteTranscriptEntry(this)" title="Delete this line" aria-label="Delete this line">${ICONS.trash}</button></div>`;
  // Populate voice-assign chips for system entries using current participants
  if (isSystem) {
    _renderVoiceChips(div, speakerName);
    if (!speakerName) div.classList.add('unassigned-system');
  }
  // Bind rename click on the speaker name span
  div.querySelector('.speaker-name-editable').addEventListener('click', e => { e.stopPropagation(); _startSpeakerRename(e.currentTarget, type); });
  div.querySelector('.entry-select-cb').addEventListener('click', e => { e.stopPropagation(); toggleEntrySelection(div); });
  div.addEventListener('click', e => {
    if (e.target.closest('.text')) return; // allow text selection without triggering action
    if (e.ctrlKey || e.metaKey || document.body.classList.contains('tc-select-mode')) {
      toggleEntrySelection(div);
    } else {
      populateInputFromTranscript(div.querySelector('.text').textContent);
    }
  });
  transcriptPanel.insertBefore(div, interimEntry);
  transcriptCount++;
  document.getElementById('transcriptCount').textContent = `${transcriptCount}`;
  if (type === 'microphone' || type === 'system') _updateWordStats(text, type);
  scrollTranscript();
  // Auto-type into question input when transcript is minimized
  if (transcriptMinimized) {
    const qi = document.getElementById('questionInput');
    if (qi) { qi.value = text; qi.dataset.autoTyped = '1'; }
    const fi = _doc().getElementById('fQuestionInput');
    if (fi) fi.value = text;
  }
}

function clearTranscript() {
  if (!confirm('Clear all transcript entries from view? (Saved entries remain in DB.)')) return;
  document.querySelectorAll('#transcriptPanel .transcript-entry').forEach(e => e.remove());
  transcriptCount = 0;
  document.getElementById('transcriptCount').textContent = '0';
  clearSelection();
  toast('Transcript view cleared', 'info');
}

// ── Multi-select transcript ───────────────────────────────────────────────────
const _tcSelected = new Set();
let _tcSelectMode = false;

function toggleSelectMode() {
  _tcSelectMode = !_tcSelectMode;
  document.body.classList.toggle('tc-select-mode', _tcSelectMode);
  const btn = document.getElementById('tcSelectBtn');
  if (btn) btn.innerHTML = ICONS.select + (_tcSelectMode ? ' Done' : ' Select');
  if (!_tcSelectMode) clearSelection();
}

function toggleEntrySelection(entry) {
  // On mobile the header button is hidden — auto-enter select mode on first tap
  if (!_tcSelectMode && !_tcSelected.has(entry)) {
    _tcSelectMode = true;
    document.body.classList.add('tc-select-mode');
    const btn = document.getElementById('tcSelectBtn');
    if (btn) btn.innerHTML = ICONS.select + ' Done';
  }
  if (_tcSelected.has(entry)) {
    _tcSelected.delete(entry);
    entry.classList.remove('selected');
  } else {
    _tcSelected.add(entry);
    entry.classList.add('selected');
  }
  _updateMultiBar();
}

function _updateMultiBar() {
  const bar = document.getElementById('tcMultiBar');
  const countEl = document.getElementById('tcMultiCount');
  if (!bar) return;
  if (_tcSelected.size === 0) {
    bar.classList.remove('visible');
  } else {
    bar.classList.add('visible');
    if (countEl) countEl.textContent = `${_tcSelected.size} selected`;
  }
}

function clearSelection() {
  _tcSelected.forEach(e => e.classList.remove('selected'));
  _tcSelected.clear();
  _updateMultiBar();
}

function sendSelectedToAI() {
  if (!_tcSelected.size) return;
  const ordered = Array.from(document.querySelectorAll('#transcriptPanel .transcript-entry'))
    .filter(e => _tcSelected.has(e));
  const context = ordered.map(e => {
    const spk = e.querySelector('.speaker-name-editable')?.textContent || 'SPEAKER';
    const txt = e.querySelector('.text')?.textContent?.trim() || '';
    return `[${spk}]: ${txt}`;
  }).join('\n');
  const q = document.getElementById('tcMultiQuestion')?.value?.trim() || '';
  const full = q
    ? `Context from transcript:\n${context}\n\nQuestion: ${q}`
    : `Context from transcript:\n${context}`;
  const qi = document.getElementById('questionInput');
  if (qi) qi.value = full;
  document.getElementById('tcMultiQuestion').value = '';
  clearSelection();
  if (_tcSelectMode) toggleSelectMode();
  triggerAI();
}

function copyTranscriptLive() {
  const lines = [];
  document.querySelectorAll('#transcriptPanel .transcript-entry').forEach(e => {
    const label = e.querySelector('.speaker')?.textContent.trim() || '';
    const text = e.querySelector('.text')?.textContent.trim() || '';
    lines.push(`[${label.toUpperCase()}]: ${text}`);
  });
  copyText(lines.join('\n\n'), 'Transcript');
}

// ── Transcript Search ─────────────────────────────────────────────────────────
function toggleTranscriptSearch() {
  const bar = document.getElementById('tcSearchBar');
  const btn = document.getElementById('tcSearchBtn');
  const open = bar.style.display !== 'none';
  bar.style.display = open ? 'none' : 'block';
  btn.classList.toggle('active', !open);
  if (!open) {
    const inp = document.getElementById('tcSearchInput');
    inp.value = '';
    inp.focus();
    filterTranscript('');
  } else {
    filterTranscript('');
  }
}

function filterTranscript(query) {
  const q = query.trim().toLowerCase();
  const entries = document.querySelectorAll('#transcriptPanel .transcript-entry');
  let matches = 0;
  entries.forEach(el => {
    const text = el.querySelector('.text')?.textContent.toLowerCase() || '';
    if (!q || text.includes(q)) {
      el.style.display = '';
      if (q) {
        const textEl = el.querySelector('.text');
        if (textEl) {
          const raw = textEl.dataset.raw || textEl.textContent;
          textEl.dataset.raw = raw;
          const idx = raw.toLowerCase().indexOf(q);
          if (idx >= 0) {
            textEl.innerHTML = escHtml(raw.slice(0, idx)) +
              `<mark style="background:rgb(var(--accent-rgb) / 0.3);color:var(--text);border-radius:2px">` +
              escHtml(raw.slice(idx, idx + q.length)) + `</mark>` +
              escHtml(raw.slice(idx + q.length));
          }
        }
        matches++;
      }
    } else {
      el.style.display = 'none';
    }
  });
  if (!q) {
    entries.forEach(el => {
      const textEl = el.querySelector('.text');
      if (textEl && textEl.dataset.raw) textEl.textContent = textEl.dataset.raw;
      el.style.display = '';
    });
  }
  const countEl = document.getElementById('tcSearchCount');
  if (countEl) countEl.textContent = q ? `${matches} match${matches !== 1 ? 'es' : ''}` : '';
}

// ── Focus Mode ────────────────────────────────────────────────────────────────
let _focusMode = false;
function toggleFocusMode() {
  _focusMode = !_focusMode;
  document.body.classList.toggle('focus-mode', _focusMode);
  const btn = document.getElementById('focusModeBtn');
  if (btn) {
    btn.classList.toggle('active', _focusMode);
    btn.title = _focusMode ? 'Exit focus mode (F)' : 'Focus mode — hide UI chrome (F)';
  }
  if (_focusMode) toast('Focus mode on — press F to exit', 'info', 2500);
}

// ── Copy All Q+A ─────────────────────────────────────────────────────────────
function copyAllQA() {
  const items = document.querySelectorAll('#aiHistory .ai-item');
  if (!items.length) { toast('No AI answers to copy', 'warn'); return; }
  const lines = [];
  // Items are prepended, so reverse to get chronological order
  Array.from(items).reverse().forEach((item, i) => {
    const q = item.querySelector('.ai-item-q')?.textContent.replace(/^Q:\s*/,'').trim();
    const a = (item.querySelector('.ai-item-a')?.dataset.plain) || item.querySelector('.ai-item-a')?.textContent.trim() || '';
    if (q) lines.push(`Q${i+1}: ${q}`);
    if (a) { lines.push(''); lines.push(`A: ${a}`); }
    lines.push('');
  });
  copyText(lines.join('\n').trim(), 'All Q+A pairs');
}

// ── Ask AI About Entry ────────────────────────────────────────────────────────
function sendEntryToAI(btn) {
  const entry = btn.closest('.transcript-entry');
  const text = entry?.querySelector('.text')?.textContent?.trim();
  if (!text) return;
  const qi = document.getElementById('questionInput');
  const fqi = document.getElementById('fQuestionInput');
  if (qi) qi.value = text;
  if (fqi) fqi.value = text;
  triggerAI();
}

function editTranscriptEntry(btn) {
  const entry = btn.closest('.transcript-entry');
  const textEl = entry?.querySelector('.text');
  if (!textEl) return;
  const current = textEl.textContent.trim();
  const input = document.createElement('input');
  Object.assign(input.style, { width:'100%', background:'var(--bg3)', border:'1px solid var(--accent)',
    borderRadius:'8px', color:'var(--text)', fontFamily:'var(--sans)', fontSize: textEl.style.fontSize || '14.5px', padding:'6px 8px' });
  input.value = current;
  textEl.replaceWith(input);
  input.focus(); input.select();
  const commit = () => {
    const newText = input.value.trim() || current;
    const div2 = document.createElement('div');
    div2.className = 'text';
    div2.style.fontSize = textEl.style.fontSize || transcriptFontSize + 'px';
    div2.textContent = newText;
    input.replaceWith(div2);
    toast('Entry updated', 'success', 2000);
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { input.replaceWith(textEl); }
  });
  input.addEventListener('blur', commit);
}

function deleteTranscriptEntry(btn) {
  const entry = btn.closest('.transcript-entry');
  if (!entry) return;
  entry.style.opacity = '0';
  entry.style.transition = 'opacity 0.2s';
  setTimeout(() => { entry.remove(); transcriptCount = Math.max(0, transcriptCount - 1); }, 200);
}

// ── Copy Q+A Pair ─────────────────────────────────────────────────────────────
function copyQA(item) {
  const q = item.querySelector('.ai-item-q')?.textContent.replace(/^Q:\s*/,'').trim() || '';
  const a = (item.querySelector('.ai-item-a')?.dataset.plain) || item.querySelector('.ai-item-a')?.textContent.trim() || '';
  const text = q ? `Q: ${q}\n\nA: ${a}` : a;
  copyText(text, 'Q+A pair');
}

// ── Bookmark AI Answer ────────────────────────────────────────────────────────
function rateAI(btn, rating) {
  const item = btn.closest('.ai-item');
  const prev = parseInt(item.dataset.rating || '0');
  if (prev === rating) {
    // un-rate
    item.dataset.rating = '0';
    item.style.borderLeftColor = '';
    btn.style.opacity = '1';
    return;
  }
  item.dataset.rating = String(rating);
  // Reset sibling rating buttons
  item.querySelectorAll('[onclick^="rateAI"]').forEach(b => { b.style.opacity = '0.4'; b.style.color = ''; });
  btn.style.opacity = '1';
  if (rating === 1) {
    btn.style.color = 'var(--green)';
    item.style.borderLeftColor = 'var(--green)';
    toast('Marked as helpful', 'success', 1500);
  } else {
    btn.style.color = 'var(--red)';
    item.style.borderLeftColor = 'var(--red)';
    toast('Marked as not helpful', 'warn', 1500);
  }
}

function toggleBookmarkAI(btn) {
  const item = btn.closest('.ai-item');
  const isBookmarked = item.dataset.bookmarked === '1';
  if (isBookmarked) {
    item.dataset.bookmarked = '0';
    item.style.borderLeftColor = '';
    item.style.borderLeftWidth = '';
    btn.setAttribute('aria-pressed', 'false');
    btn.style.color = '';
  } else {
    item.dataset.bookmarked = '1';
    item.style.borderLeftColor = 'var(--yellow)';
    item.style.borderLeftWidth = '3px';
    btn.setAttribute('aria-pressed', 'true');
    btn.style.color = 'var(--yellow)';
    toast('Answer bookmarked', 'info', 2000);
  }
}

// ── Quick Questions ───────────────────────────────────────────────────────────
function toggleQuickQ() {
  const strip = document.getElementById('quickQStrip');
  const btn = document.getElementById('quickQBtn');
  const visible = strip.style.display !== 'none';
  strip.style.display = visible ? 'none' : 'block';
  btn.classList.toggle('active', !visible);
}

function quickQ(text) {
  const qi = document.getElementById('questionInput');
  const fqi = document.getElementById('fQuestionInput');
  if (qi) { qi.value = text; qi.focus(); }
  if (fqi) fqi.value = text;
  triggerAI();
}

// ── Code Editor Helper ────────────────────────────────────────────────────────
function toggleCodeEditor() {
  const panel = document.getElementById('codeEditorPanel');
  const btn = document.getElementById('codeEditorBtn');
  const visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  btn.classList.toggle('active', !visible);
}

function runCodeHelp(action) {
  const code = document.getElementById('codeInput').value.trim();
  if (!code) { alert('Paste some code first.'); return; }
  const lang = document.getElementById('codeLangSelect').value;
  const problem = document.getElementById('codeProblemInput').value.trim();
  const resultEl = document.getElementById('codeHelpResult');
  resultEl.style.display = 'block';
  resultEl.textContent = '⏳ Analyzing…';

  const sessionId = SESSION_ID;
  fetch(`/api/session/${sessionId}/code-help/`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken')},
    body: JSON.stringify({code, language: lang, action, problem})
  }).then(res => {
    if (!res.ok) { res.text().then(t => { resultEl.textContent = 'Error: ' + t; }); return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    resultEl.textContent = '';
    function read() {
      reader.read().then(({done, value}) => {
        if (done) return;
        const chunk = decoder.decode(value);
        chunk.split('\n').forEach(line => {
          if (line.startsWith('data: ')) {
            const d = line.slice(6);
            if (d === '[DONE]') return;
            try { resultEl.textContent += JSON.parse(d).text || ''; } catch {}
          }
        });
        resultEl.scrollTop = resultEl.scrollHeight;
        read();
      });
    }
    read();
  }).catch(e => { resultEl.textContent = 'Error: ' + e.message; });
}

// ── Mock Interview ────────────────────────────────────────────────────────────
function getNextMockQuestion() {
  const btn = document.getElementById('mockQBtn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  const sessionId = SESSION_ID;
  fetch(`/api/session/${sessionId}/mock-question/`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken')},
    body: JSON.stringify({})
  }).then(res => {
    if (!res.ok) { res.text().then(t => alert('Error: ' + t)); if (btn) { btn.disabled = false; btn.innerHTML = MOCK_BTN_HTML; } return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    function read() {
      reader.read().then(({done, value}) => {
        if (done) {
          if (btn) { btn.disabled = false; btn.innerHTML = MOCK_BTN_HTML; }
          if (fullText.trim()) appendTranscriptEntry('🤖 AI Interviewer', fullText.trim(), 'system');
          return;
        }
        const chunk = decoder.decode(value);
        chunk.split('\n').forEach(line => {
          if (line.startsWith('data: ')) {
            const d = line.slice(6);
            if (d === '[DONE]') return;
            try { fullText += JSON.parse(d).text || ''; } catch {}
          }
        });
        read();
      });
    }
    read();
  }).catch(e => { alert('Error: ' + e.message); if (btn) { btn.disabled = false; btn.innerHTML = MOCK_BTN_HTML; } });
}

function appendTranscriptEntry(speaker, text, type) {
  const feed = document.getElementById('transcriptFeed');
  if (!feed) return;
  const entry = document.createElement('div');
  entry.className = 'transcript-entry';
  entry.style.cssText = 'padding:10px 14px;border-bottom:1px solid var(--border);animation:fadeIn .3s ease';
  const label = type === 'system'
    ? `<span style="font-size:10px;font-family:var(--mono);color:#a78bfa;font-weight:700">${speaker}</span>`
    : `<span style="font-size:10px;font-family:var(--mono);color:var(--accent);font-weight:700">${speaker}</span>`;
  entry.innerHTML = `<div style="margin-bottom:4px">${label}</div><div style="font-size:14px;line-height:1.55;white-space:pre-wrap">${text}</div>`;
  feed.appendChild(entry);
  feed.scrollTop = feed.scrollHeight;
}

// ── Export Session ────────────────────────────────────────────────────────────
function exportSession() {
  const lines = [];
  const sessionTitle = document.querySelector('.session-info h1')?.textContent.trim() || 'Session';
  const now = new Date().toISOString().slice(0,16).replace('T',' ');

  lines.push(`# ${sessionTitle}`);
  lines.push(`_Exported: ${now}_`);
  lines.push('');

  // Transcript
  const transcriptEntries = document.querySelectorAll('#transcriptPanel .transcript-entry');
  if (transcriptEntries.length) {
    lines.push('## // TRANSCRIPT');
    lines.push('');
    transcriptEntries.forEach(e => {
      const label = e.querySelector('.speaker')?.textContent.trim() || 'SPEAKER';
      const text = e.querySelector('.text')?.textContent.trim() || '';
      if (text) lines.push(`**[${label.toUpperCase()}]** ${text}`);
    });
    lines.push('');
  }

  // AI answers from history
  const aiItems = document.querySelectorAll('#aiHistory .ai-item');
  if (aiItems.length) {
    lines.push('## // AI ANSWERS');
    lines.push('');
    aiItems.forEach((item, i) => {
      const q = item.querySelector('.ai-item-q')?.textContent.replace(/^Q:\s*/,'').trim();
      const a = (item.querySelector('.ai-item-a')?.dataset.plain) || item.querySelector('.ai-item-a')?.textContent.trim() || '';
      if (q) lines.push(`### Q${i+1}: ${q}`);
      if (a) { lines.push(''); lines.push(a); }
      lines.push('');
    });
  }

  // Current live AI answer
  const liveAnswer = (aiAnswerText?.dataset.plain) || aiAnswerText?.textContent.trim();
  if (liveAnswer) {
    const liveQ = document.getElementById('aiTriggerText')?.textContent.trim();
    lines.push('## // CURRENT AI ANSWER');
    lines.push('');
    if (liveQ) lines.push(`### ${liveQ}`);
    lines.push('');
    lines.push(liveAnswer);
    lines.push('');
  }

  const md = lines.join('\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = sessionTitle.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40);
  a.href = url;
  a.download = `session-${slug}-${now.slice(0,10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Session exported as Markdown', 'success');
}

// ── Notes ─────────────────────────────────────────────────────────────────────
let _noteDraftTimer = null;
const _NOTE_DRAFT_KEY = `noteDraft_${SESSION_ID}`;
function _saveNoteDraft(val) {
  clearTimeout(_noteDraftTimer);
  _noteDraftTimer = setTimeout(() => {
    try { localStorage.setItem(_NOTE_DRAFT_KEY, val); } catch(e) {}
  }, 500);
}
// Restore draft on load
(function() {
  try {
    const draft = localStorage.getItem(_NOTE_DRAFT_KEY);
    const inp = document.getElementById('noteInput');
    if (draft && inp) { inp.value = draft; }
  } catch(e) {}
})();

function addNote() {
  const noteInput = document.getElementById('noteInput');
  const content = noteInput.value.trim();
  if (!content) return;
  try { localStorage.removeItem(_NOTE_DRAFT_KEY); } catch(e) {}
  fetch(`/api/session/${SESSION_ID}/note/`, {
    method: 'POST',
    headers: {'Content-Type':'application/json','X-CSRFToken':getCookie('csrftoken')},
    body: JSON.stringify({ content }),
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      addTranscriptEntryUI(content, 'note');
      noteInput.value = '';
      toast('Note saved', 'success');
    } else {
      toast('Failed: ' + (d.error || 'unknown'), 'error');
    }
  }).catch(e => toast('Error: ' + e.message, 'error'));
}

function clearInput() {
  const qi = document.getElementById('questionInput');
  const fi = _doc().getElementById('fQuestionInput');
  const text = (qi ? qi.value : '').trim() || (fi ? fi.value : '').trim();
  if (text) saveMicToServer(text); // always persist before discarding
  if (qi) qi.value = '';
  if (fi) fi.value = '';
  micManualAccum = '';
  micLastCommitted = '';
  // Hide the interim transcript entry so the display matches the cleared input
  if (interimEntry) interimEntry.style.display = 'none';
  if (interimText) interimText.textContent = 'Transcribing…';
  const qc = document.getElementById('qInputCount');
  if (qc) qc.style.opacity = '0';
}

function saveAndClearInput() {
  const qi = document.getElementById('questionInput');
  const text = qi ? qi.value.trim() : '';
  if (!text) return;
  micManualAccum = '';
  addTranscriptEntryUI(text, 'microphone');
  saveMicToServer(text);
  if (interimLabel) { interimLabel.textContent = 'You'; interimLabel.style.color = 'var(--accent2)'; }
  clearInput();
  setStatus('Saved to transcript ✓');
}

// ── AI OUTPUT TEMPLATES ───────────────────────────────────────────────────────
const _TPL_KEY = 'aiTemplate_default';
let AI_TEMPLATES = [];
let _aiTemplatesLoaded = false;

let _activeTplId = (function() {
  try { return localStorage.getItem(_TPL_KEY) || ''; } catch(e) { return ''; }
})();

async function _loadAITemplates() {
  try {
    const res = await fetch('/api/templates/?type=ai_help');
    if (res.ok) AI_TEMPLATES = await res.json();
  } catch(e) {}
  if (!AI_TEMPLATES.length) {
    AI_TEMPLATES = [{pk: 0, icon: '✨', name: 'Default', description: 'Clear, direct answer — no forced structure', prompt: ''}];
  }
  // If stored id doesn't match any pk (e.g. old string id), reset to first
  if (!AI_TEMPLATES.find(t => String(t.pk) === String(_activeTplId))) {
    _activeTplId = String(AI_TEMPLATES[0].pk);
    try { localStorage.setItem(_TPL_KEY, _activeTplId); } catch(e) {}
  }
  _aiTemplatesLoaded = true;
  _renderTplList();
}

function _getActiveTpl() {
  return AI_TEMPLATES.find(t => String(t.pk) === String(_activeTplId)) || AI_TEMPLATES[0];
}

function _renderTplList() {
  const list = document.getElementById('aiTplList');
  const nameEl = document.getElementById('aiTplActiveName');
  const badgeEl = document.getElementById('aiTplCurrentBadge');
  if (!list) return;
  const tpl = _getActiveTpl();
  if (nameEl) nameEl.textContent = tpl ? tpl.name : 'Default';
  if (badgeEl) badgeEl.textContent = (!tpl || !tpl.prompt) ? '' : (tpl.icon + ' ' + tpl.name);
  if (!AI_TEMPLATES.length) {
    list.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px">Loading templates…</div>';
    return;
  }
  list.innerHTML = AI_TEMPLATES.map(t => `
    <div class="ai-tpl-item${String(t.pk) === String(_activeTplId) ? ' active' : ''}" onclick="selectTemplate(${t.pk})">
      <span class="ai-tpl-icon">${t.icon}</span>
      <div>
        <div class="ai-tpl-name">${t.name}</div>
        <div class="ai-tpl-desc">${t.description || ''}</div>
      </div>
    </div>`).join('');
}

function selectTemplate(pk) {
  _activeTplId = String(pk);
  try { localStorage.setItem(_TPL_KEY, _activeTplId); } catch(e) {}
  _renderTplList();
  closeTplDropdown();
  const tpl = _getActiveTpl();
  toast(`// Template: ${tpl ? tpl.name : 'Default'}`, 'info', 1800);
}

function setDefaultTemplate() {
  try { localStorage.setItem(_TPL_KEY, _activeTplId); } catch(e) {}
  const tpl = _getActiveTpl();
  toast(`// "${tpl ? tpl.name : 'Default'}" set as profile default`, 'success', 2500);
  closeTplDropdown();
}

function toggleTplDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('aiTplDropdown');
  if (!dd) return;
  const isOpen = dd.classList.contains('open');
  if (!isOpen) {
    if (!_aiTemplatesLoaded) _loadAITemplates();
    else _renderTplList();
    dd.classList.add('open');
  } else dd.classList.remove('open');
}
function closeTplDropdown() {
  document.getElementById('aiTplDropdown')?.classList.remove('open');
}
document.addEventListener('click', e => { if (!e.target.closest('.ai-split-wrap')) closeTplDropdown(); });

// ── MEETING AI TEMPLATES ─────────────────────────────────────────────────────
let MEETING_AI_TEMPLATES = [];
let _meetingAILoaded = false;

async function _loadMeetingAITemplates() {
  try {
    const res = await fetch('/api/templates/?type=meeting_ai');
    if (res.ok) MEETING_AI_TEMPLATES = await res.json();
  } catch(e) {}
  if (!MEETING_AI_TEMPLATES.length) {
    MEETING_AI_TEMPLATES = [
      {pk: 0, name: 'Action Items', icon: '📌', description: 'List action items with owners and deadlines', prompt: 'List action items from this meeting so far with owners and deadlines.'},
      {pk: 1, name: 'Info Gaps', icon: '❓', description: 'Key information gaps or unanswered questions', prompt: 'What are the key information gaps or unanswered questions in this meeting?'},
    ];
  }
  _meetingAILoaded = true;
  _renderMeetingAIList();
}

function _renderMeetingAIList() {
  const list = document.getElementById('meetingAITplList');
  if (!list) return;
  if (!MEETING_AI_TEMPLATES.length) {
    list.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px">Loading…</div>';
    return;
  }
  list.innerHTML = MEETING_AI_TEMPLATES.map(t => `
    <div class="ai-tpl-item" onclick="meetingAIPrompt(${JSON.stringify(t.prompt)});closeMeetingAIDropdown()">
      <span class="ai-tpl-icon">${t.icon}</span>
      <div>
        <div class="ai-tpl-name">${t.name}</div>
        <div class="ai-tpl-desc">${t.description || ''}</div>
      </div>
    </div>`).join('');
}

function toggleMeetingAIDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('meetingAIDropdown');
  const btn = document.getElementById('meetingAIArrow');
  if (!dd || !btn) return;
  const isOpen = dd.classList.contains('open');
  if (!isOpen) {
    if (!_meetingAILoaded) _loadMeetingAITemplates();
    else _renderMeetingAIList();
    // Use fixed positioning to escape overflow-y:auto scroll context
    const rect = btn.getBoundingClientRect();
    dd.style.position = 'fixed';
    dd.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    dd.style.right = (window.innerWidth - rect.right) + 'px';
    dd.style.top = 'auto';
    dd.style.left = 'auto';
    dd.classList.add('open');
  } else dd.classList.remove('open');
}
function closeMeetingAIDropdown() {
  document.getElementById('meetingAIDropdown')?.classList.remove('open');
}
document.addEventListener('click', e => { if (!e.target.closest('#meetingAISplitWrap')) closeMeetingAIDropdown(); });
document.addEventListener('click', e => {
  if (!e.target.closest('#mhBtn') && !e.target.closest('#fMhBtn') && !e.target.closest('#mhPanel')) {
    const panel = document.getElementById('mhPanel');
    const btn   = document.getElementById('mhBtn');
    const fBtn  = document.getElementById('fMhBtn');
    if (panel) panel.classList.remove('open');
    if (btn)   btn.classList.remove('active');
    if (fBtn)  fBtn.classList.remove('active');
  }
});

// ── CONVERSATION INSIGHTS DROPDOWN ───────────────────────────────────────────
const _INSIGHT_KEY = 'convInsight_default';
let CONV_TEMPLATES = [];
let _convTemplatesLoaded = false;

let _activeInsightId = (function() {
  try { return localStorage.getItem(_INSIGHT_KEY) || ''; } catch(e) { return ''; }
})();

async function _loadConvTemplates() {
  try {
    const res = await fetch('/api/templates/?type=conversation');
    if (res.ok) CONV_TEMPLATES = await res.json();
  } catch(e) {}
  if (!CONV_TEMPLATES.length) {
    CONV_TEMPLATES = [
      {pk: -1, icon:'🏷️', name:'Label & Analyze',  description:'Label entries + tone, dynamic, key fact',    prompt:''},
      {pk: -2, icon:'💬', name:'What to Ask Next',  description:'Top 3 questions to ask right now',          prompt:'You are a real-time conversation coach. Based on the conversation transcript below, suggest the top 3 most impactful questions to ask next. For each, give the question and one sentence on why it matters right now. Be direct and tactical.'},
      {pk: -3, icon:'📋', name:'Topics to Cover',   description:'Key topics not yet addressed',               prompt:'You are a real-time conversation coach. Based on the conversation so far, identify the key topics or areas that have NOT yet been covered but should be. List them in priority order (most critical first) with a brief reason for each. Be concise.'},
      {pk: -4, icon:'⭐', name:'Key Points Recap',  description:'Most important points so far',               prompt:'You are a real-time conversation analyst. Summarize the 5 most important points, decisions, or facts from this conversation so far. Use a numbered list. Be precise and brutally concise.'},
      {pk: -5, icon:'🔍', name:'Blind Spots',        description:'Gaps, assumptions, missing context',         prompt:'You are a real-time conversation analyst. Identify the blind spots, unstated assumptions, and missing context in this conversation. What is NOT being said that should be addressed? List each gap with a one-sentence explanation.'},
      {pk: -6, icon:'🌊', name:'Conversation Flow',  description:'How the conversation is progressing',        prompt:'You are a real-time conversation coach. Analyze the flow and momentum of this conversation: what phase is it in (opening/exploration/deep dive/closing), who is leading, what is the underlying dynamic, and what tension or alignment exists? End with one concrete tactical suggestion to improve the conversation direction.'},
      {pk: -7, icon:'🎯', name:'Wrap-Up Plan',        description:'How to close the conversation well',         prompt:'You are a real-time conversation coach. Based on the conversation so far, suggest how to wrap up effectively. What key points should be summarized? What commitments should be confirmed? What follow-up actions should be agreed upon? Be specific and actionable.'},
    ];
  }
  if (!CONV_TEMPLATES.find(t => String(t.pk) === String(_activeInsightId))) {
    _activeInsightId = String(CONV_TEMPLATES[0].pk);
    try { localStorage.setItem(_INSIGHT_KEY, _activeInsightId); } catch(e) {}
  }
  _convTemplatesLoaded = true;
  _renderConvInsightList();
}

function _getActiveInsight() {
  return CONV_TEMPLATES.find(t => String(t.pk) === String(_activeInsightId)) || CONV_TEMPLATES[0] || null;
}

function _renderConvInsightList() {
  const list = document.getElementById('convInsightList');
  if (!list) return;
  if (!CONV_TEMPLATES.length) {
    list.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:12px">Loading…</div>';
    return;
  }
  list.innerHTML = CONV_TEMPLATES.map(t => `
    <div class="ai-tpl-item${String(t.pk) === String(_activeInsightId) ? ' active' : ''}" onclick="selectInsight(${t.pk})">
      <span class="ai-tpl-icon">${t.icon}</span>
      <div>
        <div class="ai-tpl-name">${t.name}</div>
        <div class="ai-tpl-desc">${t.description || ''}</div>
      </div>
    </div>`).join('');
}

function selectInsight(pk) {
  _activeInsightId = String(pk);
  try { localStorage.setItem(_INSIGHT_KEY, _activeInsightId); } catch(e) {}
  const t = _getActiveInsight();
  const btn = document.getElementById('convHelperBtn');
  const fBtn = _doc().getElementById('fConvHelperBtn');
  const label = t ? (t.icon || '🧠') : '🧠';
  if (btn)  btn.textContent = label;
  if (fBtn) fBtn.textContent = label;
  closeConvInsightDropdown();
  triggerConvHelper();
}

function toggleConvInsightDropdown(e) {
  e.stopPropagation();
  const dd = document.getElementById('convInsightDropdown');
  const btn = document.getElementById('convInsightArrow');
  if (!dd || !btn) return;
  const isOpen = dd.classList.contains('open');
  if (!isOpen) {
    if (!_convTemplatesLoaded) { _loadConvTemplates(); }
    else _renderConvInsightList();
    const rect = btn.getBoundingClientRect();
    const ddW = 230;
    const ddH = 240;
    dd.style.position = 'fixed';
    dd.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    dd.style.top = 'auto';
    dd.style.right = 'auto';
    dd.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - ddW - 8)) + 'px';
    dd.style.maxHeight = ddH + 'px';
    dd.style.minWidth = ddW + 'px';
    dd.classList.add('open');
  } else dd.classList.remove('open');
}
function closeConvInsightDropdown() {
  document.getElementById('convInsightDropdown')?.classList.remove('open');
}
document.addEventListener('click', e => { if (!e.target.closest('#convInsightWrap') && !e.target.closest('#fConvInsightWrap')) closeConvInsightDropdown(); });
document.addEventListener('click', e => {
  if (!e.target.closest('#fTcConfigBtn') && !e.target.closest('#micModeBadge') && !e.target.closest('#tcPanel')) {
    const panel = document.getElementById('tcPanel');
    const btn   = document.getElementById('fTcConfigBtn');
    if (panel) { panel.classList.remove('open'); _returnTCPanel(panel); }
    if (btn)   btn.classList.remove('open');
  }
});

// Load AI Help and Conversation templates on page init
_loadAITemplates();
_loadConvTemplates();

// Apply template prompt prefix to the question before sending
function _applyTemplate(question) {
  const tpl = _getActiveTpl();
  if (!tpl.prompt) return question;
  const resolvedPrompt = tpl.prompt.replace(/\{job_title\}/g, SESSION_TITLE);
  return `[INSTRUCTION: ${resolvedPrompt}]\n\n${question}`;
}

// ── AI HELP ───────────────────────────────────────────────────────────────────
function triggerAI(question, fromVoice) {
  if (isStreaming) return;
  showAiPanel();

  const fInput = _doc().getElementById('fQuestionInput');

  // In manual mode, flush accumulated mic speech first
  if (transcribeMode === 'manual' && micManualAccum && !question) {
    const accum = micManualAccum.trim();
    micManualAccum = '';
    micLastCommitted = '';
    saveMicToServer(accum);
    addTranscriptEntryUI(accum, 'microphone');
    interimEntry.style.display = 'none';
    interimText.textContent = 'Transcribing…';
    if (interimLabel) { interimLabel.textContent = 'You'; interimLabel.style.color = 'var(--accent2)'; }
    question = accum;
    fromVoice = true; // already saved above
  }

  const wasTyped = !question;
  question = question || questionInput.value.trim() || (fInput && fInput.value.trim());
  if (!question) {
    const entries = transcriptPanel.querySelectorAll('.transcript-entry .text');
    question = Array.from(entries).slice(-5).map(e => e.textContent).join(' ').trim();
  }
  if (!question) { setStatus('Nothing to send'); return; }

  // Persist typed text — voice/manual-flush paths already called saveMicToServer
  if (wasTyped && !fromVoice) saveMicToServer(question);

  lastQuestion = question;
  questionInput.value = '';
  if (fInput) fInput.value = '';
  micManualAccum = '';
  micLastCommitted = '';
  // Clear the interim transcript entry so the panel looks clean after submit
  interimEntry.style.display = 'none';
  interimText.textContent = 'Transcribing…';
  if (interimLabel) { interimLabel.textContent = 'You'; interimLabel.style.color = 'var(--accent2)'; }
  isStreaming = true;
  document.title = '✨ Thinking — ' + document.title.replace(/^[🔴✨]\s*/,'').replace(/^Thinking — /,'');
  aiHelpBtn.disabled = true;
  aiHelpBtn.textContent = '⏳ Thinking…';
  const fBtn = _doc().getElementById('fAiHelpBtn');
  if (fBtn) { fBtn.disabled = true; fBtn.textContent = '⏳'; }

  const aiHistory = _doc().getElementById('aiHistory');
  aiPlaceholder.style.display = 'none';
  if (aiHistory) aiHistory.style.display = 'none';
  aiLive.style.display = 'block';
  aiTriggerText.textContent = question.length > 120 ? question.slice(0, 120) + '…' : question;
  aiAnswerText.textContent = '';
  aiAnswerText.style.fontSize = aiFontSize + 'px';
  aiCursor.style.display = 'inline-block';
  const _d = _doc();
  _d.getElementById('aiLiveActions').style.display = 'none';
  _d.getElementById('clearAIBtn').style.display = 'flex';
  _d.getElementById('copyAIBtn').style.display = 'none';
  _d.getElementById('regenBtn').style.display = 'none';

  fetch(`/api/session/${SESSION_ID}/chat/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
    body: JSON.stringify({ question: _applyTemplate(question) }),
  }).then(async (resp) => {
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      aiAnswerText.textContent = '❌ ' + (err.error || `HTTP ${resp.status}`);
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.type === 'text') {
            aiAnswerText.textContent += d.text;
            _sessionOutputChars += d.text.length;
            scrollAI();
            const _wc2 = aiAnswerText.textContent.trim().split(/\s+/).filter(Boolean).length;
            const _rt2El = document.getElementById('aiReadTime');
            if (_rt2El) {
              const _rs2 = Math.ceil(_wc2 / 3.5);
              _rt2El.textContent = `${_wc2}w`;
            }
          }
          else if (d.type === 'error') { aiAnswerText.textContent += '\n\n❌ ' + d.error; }
        } catch {}
      }
    }
  }).catch(err => {
    aiAnswerText.textContent = '❌ ' + err.message;
  }).finally(() => {
    isStreaming = false;
    // Estimate cost: output tokens ≈ chars/4, ~$0.003/1K tokens
    const _outTokens = _sessionOutputChars / 4;
    sessionCost = (_outTokens / 1000) * 0.003;
    const _costEl = document.getElementById('sessionCostDisplay');
    if (_costEl) {
      _costEl.textContent = `~$${sessionCost.toFixed(4)}`;
      _costEl.style.display = '';
    }
    document.title = document.title.replace(/^✨ Thinking — /,'');
    aiHelpBtn.disabled = false;
    aiHelpBtn.textContent = 'Get answer';
    const fBtnF = _doc().getElementById('fAiHelpBtn');
    if (fBtnF) { fBtnF.disabled = false; fBtnF.textContent = '✨ AI'; }
    aiCursor.style.display = 'none';
    setStatus('Done ✓');
    const _df = _doc();
    _df.getElementById('aiLiveActions').style.display = 'flex';
    _df.getElementById('copyAIBtn').style.display = 'flex';
    _df.getElementById('regenBtn').style.display = 'flex';
    _df.getElementById('speakAIBtn').style.display = 'flex';
    const finalAnswer = aiAnswerText.textContent;
    aiAnswerText.dataset.plain = finalAnswer;
    if (bionicMode) {
      renderBionic(aiAnswerText, finalAnswer);
    } else {
      renderMarkdown(aiAnswerText, finalAnswer);
    }
    archiveAI(question, finalAnswer);
    aiLive.style.display = 'none';
    // Update reading time in live actions
    const wc = finalAnswer.trim().split(/\s+/).filter(Boolean).length;
    const rs = Math.ceil(wc / 3.5);
    const rt = rs >= 60 ? `${Math.floor(rs/60)}m ${rs%60}s` : `${rs}s`;
    const rtEl = _df.getElementById('aiReadTime');
    if (rtEl) rtEl.textContent = `${wc} words · ${rt} read`;
  });
}

function regenAI() {
  if (!lastQuestion || isStreaming) return;
  triggerAI(lastQuestion);
}

function copyCurrentAI() {
  const text = aiAnswerText.textContent;
  if (text) copyText(text, 'AI answer');
}

function archiveAI(question, answer) {
  if (!answer.trim()) return;
  const _da = _doc();
  let hist = _da.getElementById('aiHistory');
  if (!hist) {
    hist = _da.createElement('div');
    hist.className = 'ai-history';
    hist.id = 'aiHistory';
    aiPanel.insertBefore(hist, aiLive);
  }
  const item = _da.createElement('div');
  item.className = 'ai-item';
  const answerEl = _da.createElement('div');
  answerEl.className = 'ai-item-a';
  answerEl.style.fontSize = aiFontSize + 'px';
  answerEl.dataset.plain = answer;
  if (bionicMode) {
    renderBionic(answerEl, answer);
  } else {
    renderMarkdown(answerEl, answer);
  }
  item.innerHTML = `<div class="ai-item-q" title="Click to fold this answer">${escHtml(question.slice(0,120))}</div>`;
  item.appendChild(answerEl);
  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length;
  const readSec = Math.ceil(wordCount / 3.5);
  const readLabel = readSec >= 60 ? `${Math.floor(readSec/60)}m ${readSec%60}s` : `${readSec}s`;
  // Confidence score: based on answer length and hedging language
  const hedgeWords = (answer.match(/\b(maybe|perhaps|possibly|might|could|unclear|not sure|depends|varies|uncertain|I think|I believe|probably)\b/gi) || []).length;
  const confScore = Math.max(0, Math.min(100, wordCount >= 80 ? 85 - hedgeWords * 5 : wordCount >= 40 ? 65 - hedgeWords * 5 : 40 - hedgeWords * 5));
  const confLabel = confScore >= 75 ? 'high' : confScore >= 50 ? 'medium' : 'low';
  const _txt = "this.closest('.ai-item').querySelector('.ai-item-a').dataset.plain||this.closest('.ai-item').querySelector('.ai-item-a').textContent";
  item.insertAdjacentHTML('beforeend', `<div class="ai-item-actions"><span class="ai-info"><span class="ai-meta">${wordCount} words · ${readLabel} read</span><span class="ai-conf ai-conf-${confLabel}" title="An estimate from the length of the answer and how often it hedges">Confidence: ${confLabel}</span></span><span class="ai-btns"><button class="btn btn-ghost btn-xs ai-act" onclick="rateAI(this,1)" title="Helpful" aria-label="Mark as helpful">${ICONS.thumbUp}</button><button class="btn btn-ghost btn-xs ai-act" onclick="rateAI(this,-1)" title="Not helpful" aria-label="Mark as not helpful">${ICONS.thumbDown}</button><button class="btn btn-ghost btn-xs ai-act" onclick="toggleBookmarkAI(this)" title="Bookmark" aria-label="Bookmark this answer" aria-pressed="false">${ICONS.bookmark}</button><button class="btn btn-ghost btn-xs" onclick="copyText(${_txt},'Answer')" title="Copy the answer">${ICONS.copy} Copy</button><button class="btn btn-ghost btn-xs" onclick="copyQA(this.closest('.ai-item'))" title="Copy the question and the answer">Copy Q&amp;A</button><button class="btn btn-ghost btn-xs" onclick="speakAI(${_txt},this)">Read aloud</button></span></div>`);
  // Toggle minimized on click of the question line
  item.querySelector('.ai-item-q').addEventListener('click', () => item.classList.toggle('minimized'));
  hist.prepend(item);
  hist.style.display = 'flex';
  const _cqa = _doc().getElementById('copyAllQABtn');
  if (_cqa) _cqa.style.display = 'flex';
  // Keep only latest 2 expanded; minimize the rest
  const items = hist.querySelectorAll('.ai-item');
  items.forEach((el, i) => { if (i >= 2) el.classList.add('minimized'); else el.classList.remove('minimized'); });
}

function clearAI() {
  aiLive.style.display = 'none';
  const _dc = _doc();
  const h = _dc.getElementById('aiHistory');
  if (h) { h.innerHTML = ''; h.style.display = 'none'; }
  aiPlaceholder.style.display = 'block';
  _dc.getElementById('clearAIBtn').style.display = 'none';
  _dc.getElementById('copyAIBtn').style.display = 'none';
  _dc.getElementById('regenBtn').style.display = 'none';
  _dc.getElementById('speakAIBtn').style.display = 'none';
  const _cqaC = _dc.getElementById('copyAllQABtn');
  if (_cqaC) _cqaC.style.display = 'none';
  stopSpeak();
  // keep bionic-on class so toggle state is preserved
}

// ── TEXT TO SPEECH ────────────────────────────────────────────────────────────
let _ttsUtterance = null;
let _ttsSpeaking = false;

function speakAI(text, btn) {
  if (!window.speechSynthesis) { toast('TTS not supported in this browser', 'warn'); return; }
  if (_ttsSpeaking) { stopSpeak(); return; }
  const cleaned = text.replace(/[#*`_~>\[\]]/g, ' ').replace(/\s+/g,' ').trim();
  if (!cleaned) return;
  _ttsUtterance = new SpeechSynthesisUtterance(cleaned);
  _ttsUtterance.rate = 1.05;
  _ttsUtterance.pitch = 1.0;
  _ttsSpeaking = true;
  const _d = _doc();
  if (btn) { btn.textContent = 'Stop'; btn.style.color = 'var(--yellow)'; }
  const speakBtn = _d.getElementById('speakAIBtn');
  if (speakBtn) { speakBtn.innerHTML = ICON_STOP; speakBtn.title = 'Stop reading'; speakBtn.setAttribute('aria-label', 'Stop reading'); speakBtn.style.color = 'var(--yellow)'; }
  const speakLiveBtn = _d.getElementById('speakLiveBtn');
  if (speakLiveBtn) { speakLiveBtn.textContent = 'Stop'; speakLiveBtn.style.color = 'var(--yellow)'; }
  _ttsUtterance.onend = _ttsUtterance.onerror = () => {
    _ttsSpeaking = false;
    if (btn) { btn.textContent = 'Read aloud'; btn.style.color = ''; }
    if (speakBtn) { speakBtn.innerHTML = ICONS.volume; speakBtn.title = 'Read aloud'; speakBtn.setAttribute('aria-label', 'Read aloud'); speakBtn.style.color = ''; }
    if (speakLiveBtn) { speakLiveBtn.textContent = 'Read aloud'; speakLiveBtn.style.color = ''; }
  };
  speechSynthesis.speak(_ttsUtterance);
}

function speakCurrentAI() {
  const text = (aiAnswerText && aiAnswerText.dataset.plain) ? aiAnswerText.dataset.plain : (aiAnswerText ? aiAnswerText.textContent : '');
  speakAI(text, null);
}

function stopSpeak() {
  if (window.speechSynthesis) speechSynthesis.cancel();
  _ttsSpeaking = false;
}

// ── CONVERSATION HELPER ───────────────────────────────────────────────────────
function triggerConvHelper() {
  if (isStreaming) return;
  showAiPanel();

  // Gather visible transcript entries from the DOM
  const entryEls = transcriptPanel.querySelectorAll('.transcript-entry:not(.interim-entry)');
  const entries = Array.from(entryEls).slice(-20).map(el => ({
    speaker: (el.querySelector('.speaker') || {textContent: 'You'}).textContent.trim(),
    text: (el.querySelector('.text') || {textContent: ''}).textContent.trim(),
  })).filter(e => e.text);

  if (entries.length === 0) { setStatus('No transcript yet'); return; }

  const activeInsight = _getActiveInsight();
  const insightLabel = activeInsight ? `${activeInsight.icon || '🧠'} ${activeInsight.name}` : '🧠 Conversation Insights';
  const insightPrompt = activeInsight ? (activeInsight.prompt || '') : '';

  isStreaming = true;
  const btn  = document.getElementById('convHelperBtn');
  const fBtn = _doc().getElementById('fConvHelperBtn');
  if (btn)  { btn.disabled  = true; btn.textContent  = '⏳'; }
  if (fBtn) { fBtn.disabled = true; fBtn.textContent = '⏳'; }

  // Show insights directly in aiLive — no archiving so subsequent AI Help works cleanly
  const _d = _doc();
  aiPlaceholder.style.display = 'none';
  const _hist = _d.getElementById('aiHistory');
  if (_hist) _hist.style.display = 'none';
  aiLive.style.display = 'block';
  aiTriggerText.textContent = insightLabel;
  aiAnswerText.textContent = '';
  aiAnswerText.style.fontSize = aiFontSize + 'px';
  aiCursor.style.display = 'inline-block';
  const _liveAct = _d.getElementById('aiLiveActions');
  if (_liveAct) _liveAct.style.display = 'none';
  const _clearBtn = _d.getElementById('clearAIBtn');
  if (_clearBtn) _clearBtn.style.display = 'flex';
  const _copyBtn  = _d.getElementById('copyAIBtn');
  if (_copyBtn)  _copyBtn.style.display = 'none';
  const _regenBtn = _d.getElementById('regenBtn');
  if (_regenBtn) _regenBtn.style.display = 'none';

  fetch(`/api/session/${SESSION_ID}/conversation-helper/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
    body: JSON.stringify({ entries, insight_prompt: insightPrompt }),
  }).then(async (resp) => {
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      aiAnswerText.textContent = '❌ ' + (err.error || `HTTP ${resp.status}`);
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.type === 'text') {
            aiAnswerText.textContent += d.text;
            _sessionOutputChars += d.text.length;
            scrollAI();
          }
          else if (d.type === 'error') { aiAnswerText.textContent += '\n\n❌ ' + d.error; }
        } catch {}
      }
    }
  }).catch(err => {
    aiAnswerText.textContent = '❌ ' + err.message;
  }).finally(() => {
    isStreaming = false;
    const _outTokens2 = _sessionOutputChars / 4;
    sessionCost = (_outTokens2 / 1000) * 0.003;
    const _costEl2 = document.getElementById('sessionCostDisplay');
    if (_costEl2) { _costEl2.textContent = `~$${sessionCost.toFixed(4)}`; _costEl2.style.display = ''; }
    const _curInsight = _getActiveInsight();
    const _insightIcon = _curInsight ? (_curInsight.icon || '🧠') : '🧠';
    if (btn)  { btn.disabled  = false; btn.textContent  = _insightIcon; }
    if (fBtn) { fBtn.disabled = false; fBtn.textContent = _insightIcon; }
    aiCursor.style.display = 'none';
    setStatus('Insights ready ✓');
    const _df = _doc();
    // Show copy button; keep result visible in aiLive until user runs AI Help or clears
    const _la = _df.getElementById('aiLiveActions');
    if (_la) _la.style.display = 'flex';
    const _cb = _df.getElementById('copyAIBtn');
    if (_cb) _cb.style.display = 'flex';
    const _rb = _df.getElementById('regenBtn');
    if (_rb) _rb.style.display = 'none';
    // Render markdown on final text
    const finalAnswer = aiAnswerText.textContent;
    aiAnswerText.dataset.plain = finalAnswer;
    if (finalAnswer.trim()) {
      if (bionicMode) {
        renderBionic(aiAnswerText, finalAnswer);
      } else {
        renderMarkdown(aiAnswerText, finalAnswer);
      }
    }
  });
}

function endSession() {
  if (!confirm('End this session?')) return;
  clearInterval(timerInterval);
  stopMic();
  _launchConfetti();
  setTimeout(() => {
    fetch(`/api/session/${SESSION_ID}/end/`, { method: 'POST', headers: {'X-CSRFToken': getCookie('csrftoken')} })
      .then(() => window.location.href = `/session/${SESSION_ID}/detail/`);
  }, 1200);
}

function _launchConfetti() {
  const colors = ['#FFC83D','#4ADE9B','#A9A4FF','#FF9EC0','#7CC0FF'];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div');
    const size = 6 + Math.random() * 8;
    Object.assign(el.style, {
      position: 'fixed', pointerEvents: 'none', zIndex: '99999',
      width: size + 'px', height: size + 'px',
      borderRadius: Math.random() > 0.5 ? '50%' : '2px',
      background: colors[Math.floor(Math.random() * colors.length)],
      left: Math.random() * 100 + 'vw',
      top: '-10px',
      opacity: '1',
      transition: `transform ${0.8 + Math.random() * 0.8}s ease-out, opacity 0.4s ease ${0.7 + Math.random() * 0.5}s`,
    });
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.style.transform = `translateY(${60 + Math.random() * 60}vh) rotate(${Math.random() * 360}deg)`;
      el.style.opacity = '0';
    }));
    setTimeout(() => el.remove(), 1600);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
let _transcriptScrollLocked = false;
let _transcriptNewCount = 0;

function scrollTranscript() {
  if (_transcriptScrollLocked) {
    _transcriptNewCount++;
    const badge = document.getElementById('transcriptScrollBadge');
    if (badge) { badge.textContent = '↓ ' + _transcriptNewCount + ' new'; badge.style.display = 'flex'; }
    return;
  }
  transcriptPanel.scrollTop = transcriptPanel.scrollHeight;
}

let _aiScrollLocked = false;
let _aiNewCount = 0;

function scrollAI() {
  if (_aiScrollLocked) {
    _aiNewCount++;
    const badge = document.getElementById('aiScrollBadge');
    if (badge) { badge.textContent = '↓ ' + _aiNewCount + ' new'; badge.style.display = 'flex'; }
    return;
  }
  aiPanel.scrollTop = aiPanel.scrollHeight;
}
function setStatus(msg) { statusChip.textContent = msg; }
function escHtml(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Transcript minimize / restore ────────────────────────────────────────────
function minimizeTranscript() {
  transcriptMinimized = true;
  const layout = document.querySelector('.main-layout');
  layout.classList.add('transcript-hidden');
  document.getElementById('showTranscriptBtn').style.display = 'inline';
  document.getElementById('dragHint').style.display = 'none';
  // Seed input with latest transcript entry
  const entries = document.querySelectorAll('#transcriptPanel .transcript-entry .text');
  if (entries.length > 0) {
    populateInputFromTranscript(entries[entries.length - 1].textContent);
  }
}

function restoreTranscript() {
  transcriptMinimized = false;
  const layout = document.querySelector('.main-layout');
  layout.classList.remove('transcript-hidden');
  const saved = localStorage.getItem('transcriptW');
  if (saved) layout.style.setProperty('--transcript-w', saved);
  document.getElementById('showTranscriptBtn').style.display = 'none';
  document.getElementById('dragHint').style.display = 'inline';
  // Clear auto-typed content from input when transcript is restored
  const qi = document.getElementById('questionInput');
  if (qi && qi.dataset.autoTyped) { qi.value = ''; delete qi.dataset.autoTyped; }
}

// ── Column drag resizer ───────────────────────────────────────────────────────
(function initColResizer() {
  const resizer = document.getElementById('colResizer');
  if (!resizer) return;
  let startX, startW;

  resizer.addEventListener('mousedown', e => {
    e.preventDefault();
    const layout = document.querySelector('.main-layout');
    const transcriptPanel = layout.querySelector('.panel');
    startX = e.clientX;
    startW = transcriptPanel.getBoundingClientRect().width;
    resizer.classList.add('dragging');

    function onMove(ev) {
      const delta = ev.clientX - startX;
      const newW = Math.max(80, startW + delta);
      layout.style.setProperty('--transcript-w', newW + 'px');
    }
    function onUp() {
      resizer.classList.remove('dragging');
      // Save width only if AI panel still has room (≥340px)
      const w = layout.style.getPropertyValue('--transcript-w');
      const wPx = parseFloat(w);
      if (w && !isNaN(wPx) && wPx <= window.innerWidth - 350) {
        localStorage.setItem('transcriptW', w);
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Restore saved width on load — cap so AI panel is never pushed off-screen
  const saved = localStorage.getItem('transcriptW');
  if (saved) {
    const layout = document.querySelector('.main-layout');
    if (layout) {
      const savedPx = parseFloat(saved);
      const maxW = window.innerWidth - 350; // reserve ≥345px for AI panel + resizer
      if (!isNaN(savedPx) && savedPx > 0 && savedPx <= maxW) {
        layout.style.setProperty('--transcript-w', saved);
      }
    }
  }
})();

// ── Panel state helpers ───────────────────────────────────────────────────────

function _getPanel() {
  return document.getElementById('aiFloatPanel') ||
    (typeof _pipDocWindow !== 'undefined' && _pipDocWindow && !_pipDocWindow.closed &&
      _pipDocWindow.document.getElementById('aiFloatPanel'));
}

// Returns the document where the AI panel currently lives (PiP or main)
function _doc() {
  return (typeof _pipDocWindow !== 'undefined' && _pipDocWindow && !_pipDocWindow.closed)
    ? _pipDocWindow.document : document;
}

function _getPanelState() {
  const panel = _getPanel();
  if (!panel) return 'embedded';
  if (typeof _pipDocWindow !== 'undefined' && _pipDocWindow && !_pipDocWindow.closed) return 'pip';
  if (panel.classList.contains('ai-panel-embedded')) return 'embedded';
  if (panel.classList.contains('collapsed')) return 'bubble';
  return 'floating';
}

function embedAI() {
  const panel = _getPanel();
  const mainLayout = document.querySelector('.main-layout');
  panel.classList.remove('collapsed');
  panel.classList.add('ai-panel-embedded');
  panel.style.position = '';
  panel.style.top = ''; panel.style.left = ''; panel.style.right = '';
  panel.style.width = ''; panel.style.height = '';
  panel.style.borderRadius = ''; panel.style.border = ''; panel.style.boxShadow = '';
  panel.style.minWidth = ''; panel.style.minHeight = '';
  if (panel.parentNode !== mainLayout) mainLayout.appendChild(panel);
  mainLayout.classList.add('with-ai');
  const btn = document.getElementById('popOutBtn');
  if (btn) btn.title = 'Pop out as floating window';
}

function detachToFloating() {
  const panel = _getPanel();
  panel.classList.remove('ai-panel-embedded');
  if (panel.parentNode !== document.body) document.body.appendChild(panel);
  panel.style.position = 'fixed';
  const s = JSON.parse(localStorage.getItem('aiFloat') || '{}');
  panel.style.width  = s.width  || '380px';
  panel.style.height = s.height || '480px';
  panel.style.top    = s.top    || '110px';
  if (s.left) { panel.style.left = s.left; panel.style.right = 'auto'; }
  else { panel.style.right = '24px'; panel.style.left = 'auto'; }
  document.querySelector('.main-layout').classList.remove('with-ai');
}

// ── Floating panel: drag, opacity, collapse/expand ───────────────────────────
(function initFloat() {
  const panel     = document.getElementById('aiFloatPanel');
  const bar       = document.getElementById('aiDragBar');
  const barBottom = document.getElementById('aiDragBarBottom');
  let dragging = false, ox = 0, oy = 0, dragMoved = false;

  // Only restore saved position/size when not embedded
  if (!panel.classList.contains('ai-panel-embedded')) {
    const saved = JSON.parse(localStorage.getItem('aiFloat') || '{}');
    if (saved.top)    panel.style.top    = saved.top;
    if (saved.left)   { panel.style.left = saved.left; panel.style.right = 'auto'; }
    else if (saved.right) { panel.style.right = saved.right; }
    if (saved.width)  panel.style.width  = saved.width;
    if (saved.height) panel.style.height = saved.height;
    if (saved.opacity) {
      const bgAlpha = Math.max(0.05, (saved.opacity / 100) * 0.9).toFixed(2);
      panel.style.setProperty('--panel-bg-alpha', bgAlpha);
      const sl = document.getElementById('opacitySlider');
      if (sl) sl.value = saved.opacity;
    }
  }

  function saveState() {
    if (panel.classList.contains('collapsed')) return;
    if (panel.classList.contains('ai-panel-embedded')) return;
    localStorage.setItem('aiFloat', JSON.stringify({
      top: panel.style.top, left: panel.style.left, right: panel.style.right,
      width: panel.style.width, height: panel.style.height,
      opacity: document.getElementById('opacitySlider')?.value || 90,
    }));
  }

  function restoreExpanded() {
    const s = JSON.parse(localStorage.getItem('aiFloat') || '{}');
    panel.classList.remove('collapsed');
    panel.style.position = 'fixed';
    panel.style.width  = s.width  || '380px';
    panel.style.height = s.height || '480px';
    if (s.top)    panel.style.top    = s.top;
    else          panel.style.top    = '110px';
    if (s.left)   { panel.style.left = s.left; panel.style.right = 'auto'; }
    else          { panel.style.right = '24px'; panel.style.left  = 'auto'; }
    const collapseBtn = document.getElementById('collapseBtn');
    if (collapseBtn) collapseBtn.textContent = '✕';
  }
  panel._expand = restoreExpanded;

  // Drag start — skip when embedded
  function startDrag(e) {
    if (panel.classList.contains('ai-panel-embedded')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    dragging = true; dragMoved = false;
    const rect = panel.getBoundingClientRect();
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    panel.style.right = 'auto';
    e.preventDefault();
  }

  bar.addEventListener('mousedown', startDrag);
  if (barBottom) barBottom.addEventListener('mousedown', startDrag);

  // Collapsed bubble: drag from anywhere on the bubble
  panel.addEventListener('mousedown', e => {
    if (!panel.classList.contains('collapsed')) return;
    if (e.target.tagName === 'BUTTON') return;
    dragging = true; dragMoved = false;
    const rect = panel.getBoundingClientRect();
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    panel.style.right = 'auto';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    dragMoved = true;
    panel.style.left = (e.clientX - ox) + 'px';
    panel.style.top  = (e.clientY - oy) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; saveState(); }
  });

  // Click bubble → expand as floating panel
  panel.addEventListener('click', e => {
    if (!panel.classList.contains('collapsed')) return;
    if (dragMoved) { dragMoved = false; return; }
    restoreExpanded();
  });

  new ResizeObserver(() => saveState()).observe(panel);
})();

// Sync float panel input with main question input
document.addEventListener('DOMContentLoaded', () => {
  // Minimize all but the latest 2 pre-loaded AI answers and wire click-to-expand
  const hist = document.getElementById('aiHistory');
  if (hist) {
    const items = hist.querySelectorAll('.ai-item');
    items.forEach((el, i) => {
      if (i >= 2) el.classList.add('minimized');
      const q = el.querySelector('.ai-item-q');
      if (q) q.addEventListener('click', () => el.classList.toggle('minimized'));
    });
  }

  const mainInput  = document.getElementById('questionInput');
  const floatInput = document.getElementById('fQuestionInput');
  if (mainInput && floatInput) {
    floatInput.addEventListener('input', () => { mainInput.value = floatInput.value; });
    mainInput.addEventListener('input',  () => { floatInput.value = mainInput.value; });
  }
  // Sync mic button state to float copy
  const origMic = document.getElementById('micBtn');
  const fMic    = document.getElementById('fMicBtn');
  if (origMic && fMic) {
    const obs = new MutationObserver(() => {
      fMic.classList.toggle('active', origMic.classList.contains('active'));
    });
    obs.observe(origMic, { attributes: true, attributeFilter: ['class'] });
  }
});

function setFloatOpacity(val) {
  const panel = _getPanel();
  const v = Number(val) / 100;
  // Glass effect: only fade background, text stays fully opaque at all levels
  const bgAlpha = Math.max(0.05, v * 0.9).toFixed(2);
  panel.style.setProperty('--panel-bg-alpha', bgAlpha);
}

function restoreAIPanel() {
  const panel = _getPanel();
  panel.style.display = '';
  if (!panel.classList.contains('ai-panel-embedded')) {
    embedAI();
  } else {
    document.querySelector('.main-layout').classList.add('with-ai');
  }
  const showBtn = document.getElementById('showAiBtn');
  if (showBtn) showBtn.style.display = 'none';
}

function toggleAiPanel() {
  const state = _getPanelState();
  const panel = _getPanel();
  if (state === 'embedded') {
    // Hide column — keep panel embedded, just remove from grid
    document.querySelector('.main-layout').classList.remove('with-ai');
    panel.style.display = 'none';
    const showBtn = document.getElementById('showAiBtn');
    if (showBtn) showBtn.style.display = '';
  } else if (state === 'bubble') {
    panel._expand && panel._expand();
  } else {
    // floating or pip: toggle collapse
    if (panel.classList.contains('collapsed')) {
      panel._expand && panel._expand();
    } else {
      panel.classList.add('collapsed');
    }
  }
}

function showAiPanel() {
  const panel = _getPanel();
  if (panel.classList.contains('ai-panel-embedded')) return; // already visible
  if (panel.classList.contains('collapsed')) {
    panel._expand && panel._expand();
  }
}

// ── Detect if this page is already a popup opened by another tab ─────────────
(function detectPopupMode() {
  try {
    if (window.opener && !window.opener.closed) {
      // We're the popped-out window — change ⧉ to "Pop in"
      document.addEventListener('DOMContentLoaded', () => {});
      const setPopinLabel = () => {
        const btn = document.getElementById('popOutBtn');
        if (btn) { btn.title = 'Pop in (return to original tab)'; btn.textContent = '⊙'; }
      };
      // Try immediately; also after short delay for late DOM
      setPopinLabel();
      setTimeout(setPopinLabel, 500);
    }
  } catch(e) {}
})();

async function popOutAI() {
  const panel = _getPanel();
  const state = _getPanelState();

  // ── PiP window already open → close it and re-embed ──────────────────────
  if (_pipDocWindow && !_pipDocWindow.closed) {
    _pipDocWindow.close();
    return;
  }

  // ── Floating or bubble → re-embed ─────────────────────────────────────────
  if (state === 'floating' || state === 'bubble') {
    embedAI();
    const btn = document.getElementById('popOutBtn');
    if (btn) { btn.title = 'Pop out above all windows'; btn.textContent = '⧉'; }
    return;
  }

  // ── Embedded → try Document Picture-in-Picture (stays above all windows) ──
  if ('documentPictureInPicture' in window) {
    try {
      const pipWin = await window.documentPictureInPicture.requestWindow({
        width: 420, height: 560, disallowReturnToOpener: false
      });
      _pipDocWindow = pipWin;

      // Proxy all JS functions needed by panel buttons back to the original window
      const _proxyScript = pipWin.document.createElement('script');
      _proxyScript.textContent = `
        const _pipFns = ['popOutAI','toggleAiPanel','toggleBionic','adjustAIFontSize',
          'regenAI','copyCurrentAI','clearAI','triggerAI','toggleMic',
          'restoreTranscript','copyText','setFloatOpacity','openModal','adjustFontSize',
          'toggleTCPanel','clearInput','saveAndClearInput','triggerConvHelper'];
        _pipFns.forEach(fn => {
          window[fn] = function() { return window.opener[fn].apply(window.opener, arguments); };
        });
        window.event = window.event || {};
      `;
      pipWin.document.head.appendChild(_proxyScript);

      // Copy all stylesheets into the PiP window
      [...document.styleSheets].forEach(ss => {
        try {
          const css = [...ss.cssRules].map(r => r.cssText).join('');
          const style = pipWin.document.createElement('style');
          style.textContent = css;
          pipWin.document.head.appendChild(style);
        } catch (_) {
          if (ss.href) {
            const link = pipWin.document.createElement('link');
            link.rel = 'stylesheet'; link.href = ss.href;
            pipWin.document.head.appendChild(link);
          }
        }
      });

      // Carry the current theme into the PiP window so its tokens match the main window
      pipWin.document.documentElement.setAttribute('data-theme', document.documentElement.getAttribute('data-theme') || 'dark');
      const bodyStyle = pipWin.document.createElement('style');
      bodyStyle.textContent = `
        html, body {
          margin:0; padding:0; overflow:hidden;
          background: var(--bg) !important;
        }
        #aiFloatPanel {
          position:fixed!important; top:0!important; left:0!important;
          right:0!important; bottom:0!important; width:100%!important; height:100%!important;
          border-radius:0!important; border:none!important; box-shadow:none!important;
          resize:none!important;
          backdrop-filter:blur(20px) saturate(180%) brightness(1.1)!important;
          -webkit-backdrop-filter:blur(20px) saturate(180%) brightness(1.1)!important;
        }
        #aiFloatPanel .ai-float-bar { cursor:default; border-radius:0!important; }
        #aiFloatPanel .ai-float-foot { display:none!important; }
        /* Show input row and all control buttons in PiP window */
        .ai-float-input-row { display: flex !important; }
        #fMicBtn, #fTcConfigBtn, #fAiHelpBtn, #fConvHelperBtn, .fai-btn { display: inline-flex !important; }
      `;
      pipWin.document.head.appendChild(bodyStyle);

      // Move panel into PiP window
      panel.classList.remove('ai-panel-embedded');
      panel.style.removeProperty('background'); // clear any inline bg from old setFloatOpacity calls
      document.querySelector('.main-layout').classList.remove('with-ai');
      pipWin.document.body.appendChild(panel);
      // Hide main-window bottom bar — controls are now in the PiP window
      document.body.classList.add('pip-active');

      // popOutBtn is now inside the PiP window
      const btn = pipWin.document.getElementById('popOutBtn');
      if (btn) { btn.title = 'Dock back'; btn.textContent = '⊙'; }

      // When PiP window closes, move panel back and re-embed
      pipWin.addEventListener('pagehide', () => {
        _pipDocWindow = null;
        document.body.classList.remove('pip-active'); // restore bottom bar
        const mainLayout = document.querySelector('.main-layout');
        mainLayout.appendChild(panel);
        panel.classList.add('ai-panel-embedded');
        panel.style.position = '';
        panel.style.top = ''; panel.style.left = ''; panel.style.right = '';
        panel.style.width = ''; panel.style.height = '';
        mainLayout.classList.add('with-ai');
        const b = document.getElementById('popOutBtn');
        if (b) { b.title = 'Pop out above all windows'; b.textContent = '⧉'; }
      });
      return;
    } catch (e) {
      console.warn('PiP failed:', e.message);
    }
  }

  // ── Fallback: detach as floating overlay inside the page ──────────────────
  detachToFloating();
  const btn = document.getElementById('popOutBtn');
  if (btn) { btn.title = 'Dock back into layout'; btn.textContent = '⊙'; }
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  const typing = ['INPUT','TEXTAREA'].includes(tag);
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); if (!isStreaming) triggerAI(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); toggleTranscriptSearch(); return; }
  if (typing) return;
  if (e.key === '/') { e.preventDefault(); questionInput.focus(); }
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); document.getElementById('noteInput').focus(); }
  if (e.key === 'm' || e.key === 'M') { e.preventDefault(); toggleMic(); }
  if (e.key === 's' || e.key === 'S') { e.preventDefault(); speakCurrentAI(); }
  if (e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); endSession(); }
  if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFocusMode(); }
  if (e.key === 'x' || e.key === 'X') { e.preventDefault(); exportSession(); }
  if (e.key === '?') { e.preventDefault(); openModal('shortcutsModal'); }
  if (e.key === 'p' || e.key === 'P') { e.preventDefault(); popOutAI(); }
});

// ── Teams Recorder ────────────────────────────────────────────────────────────
if (SESSION_TYPE === 'meeting') {
  let participants = [];
  let activeSpeaker = null;
  // Open on load, except on a phone, where the open panel leaves no room for the transcript; one tap opens it
  let recorderPanelOpen = !window.matchMedia('(max-width: 640px)').matches;
  document.getElementById('teamsRecorderPanel').classList.toggle('panel-open', recorderPanelOpen);
  document.getElementById('recorderPanelToggle').textContent = recorderPanelOpen ? '▲' : '▼';

  function toggleRecorderPanel() {
    recorderPanelOpen = !recorderPanelOpen;
    document.getElementById('teamsRecorderPanel').classList.toggle('panel-open', recorderPanelOpen);
    document.getElementById('recorderPanelToggle').textContent = recorderPanelOpen ? '▲' : '▼';
  }

  function renderParticipants() {
    // Sync global voice participants so transcript chips stay up to date
    if (participants.length) {
      // Real participants: override auto-speakers
      _voiceParticipants = participants.map(p => ({ id: p.id, name: p.name, color: p.color }));
    } else if (_autoSpeakers.length) {
      // No real participants: keep auto-speakers
      _voiceParticipants = [..._autoSpeakers];
    } else {
      _voiceParticipants = [];
    }
    _refreshAllVoiceChips();
    const list = document.getElementById('participantsList');
    const speakerBtns = document.getElementById('speakerBtnList');
    list.innerHTML = '';
    speakerBtns.innerHTML = '';
    participants.forEach(p => {
      // Badge in list
      list.insertAdjacentHTML('beforeend', `
        <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:${p.color}22;border:1px solid ${p.color};font-size:12px;color:${p.color};font-weight:600">
          ${escHtml(p.name)}
          <span onclick="removeParticipant('${p.id}')" style="cursor:pointer;opacity:0.6;font-size:12px" title="Remove">✕</span>
        </span>
      `);
      // Speaker select button
      const isActive = activeSpeaker && activeSpeaker.id === p.id;
      speakerBtns.insertAdjacentHTML('beforeend', `
        <button onclick="setActiveSpeaker('${p.id}')"
          style="padding:4px 10px;border-radius:10px;border:2px solid ${isActive ? p.color : 'var(--border)'};
                 background:${isActive ? p.color + '22' : 'transparent'};color:${isActive ? p.color : 'var(--text2)'};
                 font-size:12px;font-weight:${isActive ? '700' : '400'};cursor:pointer;transition:all 0.15s">
          ${escHtml(p.name)}
        </button>
      `);
    });
  }

  async function loadParticipants() {
    const r = await fetch(`/api/session/${SESSION_ID}/participants/`);
    const d = await r.json();
    participants = d.participants || [];
    renderParticipants();
  }

  async function addParticipant() {
    const nameEl = document.getElementById('newParticipantName');
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); toast('Enter a participant name first', 'info'); return; }
    const role = document.getElementById('newParticipantRole').value.trim();
    try {
      const r = await fetch(`/api/session/${SESSION_ID}/participants/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
        body: JSON.stringify({ name, role }),
      });
      const d = await r.json();
      if (!r.ok) { toast(d.error || 'Failed to add participant', 'error'); return; }
      if (d.id) {
        participants.push({ id: d.id, name: d.name, role: d.role, color: d.color });
        nameEl.value = '';
        document.getElementById('newParticipantRole').value = '';
        renderParticipants();
        toast(`Added ${name}`, 'success');
      }
    } catch (e) {
      toast('Network error: ' + e.message, 'error');
    }
  }

  async function scanTeamsParticipants() {
    const btn = document.getElementById('scanScreenBtn');
    const orig = btn.innerHTML;
    btn.textContent = 'Scanning…';
    btn.disabled = true;
    try {
      // Request screen share (video required for the frame, audio not needed)
      let display;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      } catch (e) {
        toast('Screen share cancelled', 'info');
        return;
      }

      const videoTrack = display.getVideoTracks()[0];
      // Capture a single frame via ImageCapture if available, else fallback to video element
      let blob;
      if (typeof ImageCapture !== 'undefined') {
        const ic = new ImageCapture(videoTrack);
        const bitmap = await ic.grabFrame();
        display.getTracks().forEach(t => t.stop());
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      } else {
        // Safari / older browsers: use a video element
        const video = document.createElement('video');
        video.srcObject = new MediaStream([videoTrack]);
        video.muted = true;
        await video.play();
        await new Promise(res => { video.onloadeddata = res; setTimeout(res, 2000); });
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280; canvas.height = video.videoHeight || 720;
        canvas.getContext('2d').drawImage(video, 0, 0);
        video.srcObject = null;
        display.getTracks().forEach(t => t.stop());
        blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      }

      const form = new FormData();
      form.append('screenshot', blob, 'screen.png');
      const resp = await fetch(`/api/session/${SESSION_ID}/scan-participants/`, {
        method: 'POST',
        headers: { 'X-CSRFToken': getCookie('csrftoken') },
        body: form,
      });
      const data = await resp.json();
      if (!resp.ok) { toast(data.error || 'Scan failed', 'error'); return; }

      const names = (data.names || []).filter(n => n && n.trim());
      const speakers = (data.speakers || []).filter(n => n && n.trim());
      const detectedTitle = (data.title || '').trim();

      // Combine names + speakers (deduplicated)
      const allNames = [...new Set([...names, ...speakers])];
      if (!allNames.length) { toast('No participant names detected in screenshot', 'info'); return; }

      let added = 0;
      for (const name of allNames) {
        if (participants.find(p => p.name.toLowerCase() === name.toLowerCase())) continue;
        const r2 = await fetch(`/api/session/${SESSION_ID}/participants/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
          body: JSON.stringify({ name: name.trim() }),
        });
        const d = await r2.json();
        if (d.id) { participants.push({ id: d.id, name: d.name, role: d.role, color: d.color }); added++; }
      }
      renderParticipants();
      toast(added ? `Added ${added} participant${added > 1 ? 's' : ''} from screen` : 'Participants already in list', added ? 'success' : 'info');

      // Auto-update session title if detected
      if (detectedTitle) {
        try {
          const tRes = await fetch(`/api/session/${SESSION_ID}/edit/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: JSON.stringify({ title: detectedTitle }),
          });
          if (tRes.ok) {
            const titleEl = document.querySelector('.session-info h1');
            if (titleEl) titleEl.textContent = detectedTitle;
            toast(`Meeting title: "${detectedTitle}"`, 'info', 3000);
          }
        } catch(e) {}
      }

      // Refresh calendar if connected (calendar knows about this meeting)
      if (calendarConnected) {
        try { refreshCalendarEvents(); } catch(e) {}
      }
    } catch (e) {
      toast('Scan error: ' + e.message, 'error');
    } finally {
      btn.innerHTML = orig;
      btn.disabled = false;
    }
  }

  async function removeParticipant(pid) {
    await fetch(`/api/session/${SESSION_ID}/participants/${pid}/delete/`, {
      method: 'POST', headers: { 'X-CSRFToken': getCookie('csrftoken') },
    });
    participants = participants.filter(p => p.id !== pid);
    if (activeSpeaker && activeSpeaker.id === pid) activeSpeaker = null;
    renderParticipants();
    updateActiveSpeakerDisplay();
  }

  function setActiveSpeaker(pid) {
    activeSpeaker = participants.find(p => p.id === pid) || null;
    renderParticipants();
    updateActiveSpeakerDisplay();
  }

  function updateActiveSpeakerDisplay() {
    const el = document.getElementById('activeSpeakerDisplay');
    if (activeSpeaker) {
      el.innerHTML = `<span style="color:${activeSpeaker.color};font-weight:700">${escHtml(activeSpeaker.name)}</span>`;
    } else {
      el.textContent = 'None selected';
    }
  }

  function getActiveSpeakerName() {
    return activeSpeaker ? activeSpeaker.name : '';
  }

  // Click transcript entry to assign speaker
  document.getElementById('transcriptPanel').addEventListener('click', e => {
    const entry = e.target.closest('.transcript-entry[data-entry-id]');
    if (!entry || !activeSpeaker) return;
    const entryId = entry.dataset.entryId;
    const speakerLabel = entry.querySelector('.speaker');
    fetch(`/api/session/${SESSION_ID}/entry/${entryId}/speaker/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
      body: JSON.stringify({ speaker_name: activeSpeaker.name }),
    }).then(() => {
      if (speakerLabel) speakerLabel.style.color = activeSpeaker.color;
      if (speakerLabel) speakerLabel.textContent = activeSpeaker.name;
      entry.style.borderLeft = `3px solid ${activeSpeaker.color}`;
      toast(`Assigned to ${activeSpeaker.name}`, 'success');
    });
  });

  function meetingAIPrompt(text) {
    setMicInputText(text);
    triggerAI(text);
  }

  async function generateMeetingSummary() {
    const btn = document.getElementById('summaryBtn');
    btn.disabled = true;
    btn.textContent = 'Writing…';
    try {
      const r = await fetch(`/api/session/${SESSION_ID}/meeting-summary/`, {
        method: 'POST', headers: { 'X-CSRFToken': getCookie('csrftoken') },
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      renderMeetingSummary(d);
    } catch (err) {
      toast('Summary error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = ICONS.doc + ' Summary';
    }
  }

  function renderMeetingSummary(d) {
    const out = document.getElementById('meetingSummaryOut');
    const content = document.getElementById('meetingSummaryContent');
    let html = `<p style="margin-bottom:10px">${escHtml(d.summary || '')}</p>`;
    if (d.key_decisions?.length) {
      html += `<div style="margin-bottom:8px"><strong>✅ Key Decisions:</strong><ul style="margin:4px 0 0 16px">` +
        d.key_decisions.map(x => `<li>${escHtml(x)}</li>`).join('') + `</ul></div>`;
    }
    if (d.action_items?.length) {
      html += `<div style="margin-bottom:8px"><strong>📌 Action Items:</strong><ul style="margin:4px 0 0 16px">` +
        d.action_items.map(x => `<li>${escHtml(x.item)}${x.owner ? ' — <em>' + escHtml(x.owner) + '</em>' : ''}${x.deadline ? ' <span style="color:var(--text3)">' + escHtml(x.deadline) + '</span>' : ''}</li>`).join('') + `</ul></div>`;
    }
    if (d.open_questions?.length) {
      html += `<div style="margin-bottom:8px"><strong>❓ Open Questions:</strong><ul style="margin:4px 0 0 16px">` +
        d.open_questions.map(x => `<li>${escHtml(x)}</li>`).join('') + `</ul></div>`;
    }
    if (d.information_gaps?.length) {
      html += `<div style="margin-bottom:8px"><strong>🔍 Information Gaps:</strong><ul style="margin:4px 0 0 16px">` +
        d.information_gaps.map(x => `<li>${escHtml(x)}</li>`).join('') + `</ul></div>`;
    }
    content.innerHTML = html;
    out.style.display = 'block';
    out.scrollIntoView({ behavior: 'smooth' });
  }

  // Load cross-session context indicator
  async function loadCrossSessionCtx() {
    const el = document.getElementById('crossSessionCtx');
    if (!el) return;
    // The context is already injected into the system prompt — just indicate if past meetings exist
    try {
      const r = await fetch(`/api/session/${SESSION_ID}/data/`);
      const d = await r.json();
      el.innerHTML = d.has_past_meetings
        ? `Past meeting context loaded for <strong>${escHtml(SESSION_COMPANY)}</strong>`
        : `No past meetings found for <strong>${escHtml(SESSION_COMPANY)}</strong>`;
    } catch {
      el.textContent = '';
    }
  }

  // Override saveMicToServer to include active speaker when set
  // Use variable assignment (not function declaration) to avoid V8 block-function hoisting
  const _origSaveMicToServer = saveMicToServer;
  saveMicToServer = function(text) {
    const speakerName = getActiveSpeakerName();
    fetch(`/api/session/${SESSION_ID}/transcript/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
      body: JSON.stringify({ transcripts: [{ content: text, type: 'microphone', speaker_name: speakerName }] }),
    }).catch(() => {});
  };

  // Also patch addTranscriptEntryUI to show speaker color when active
  // Use variable assignment (not function declaration) to avoid V8 block-function hoisting
  const _origAddTranscriptEntryUI = addTranscriptEntryUI;
  addTranscriptEntryUI = function(text, type, speakerName) {
    const autoName = (type === 'system' && !speakerName) ? getActiveSpeakerName() : '';
    if (autoName) speakerName = autoName;
    _origAddTranscriptEntryUI(text, type, speakerName);
    // Apply active speaker border color on freshly created system entry
    if (type === 'system' && activeSpeaker) {
      const entries = transcriptPanel.querySelectorAll('.transcript-entry.system');
      const last = entries[entries.length - 1];
      if (last) last.style.borderLeftColor = activeSpeaker.color;
    }
  };

  // ── Zoom / expand panel ───────────────────────────────────────────────────
  let teamsZoomed = false;
  function toggleTeamsZoom() {
    teamsZoomed = !teamsZoomed;
    const panel = document.getElementById('teamsRecorderPanel');
    const btn = document.getElementById('teamsZoomBtn');
    if (teamsZoomed) {
      document.body.classList.add('teams-zoomed');
      panel.classList.add('zoomed');
      btn.innerHTML = ICONS.expand;
      btn.title = 'Make the panel shorter';
    } else {
      document.body.classList.remove('teams-zoomed');
      panel.classList.remove('zoomed');
      btn.innerHTML = ICONS.expand;
      btn.title = 'Make the panel taller';
    }
  }

  // ── Calendar sync ─────────────────────────────────────────────────────────
  let calendarConnected = false;
  let calendarType = null; // 'google' | 'microsoft'

  function toggleCalendarPanel() {
    const panel = document.getElementById('calendarSyncPanel');
    const isOpen = panel.style.display !== 'none';
    panel.style.display = isOpen ? 'none' : 'block';
    if (!isOpen && !calendarConnected) {
      document.getElementById('calConnectStatus').textContent = 'Choose a calendar provider to sync today\'s meetings.';
    }
  }

  function connectGoogleCalendar() {
    const btn = document.getElementById('googleCalBtn');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    const CLIENT_ID = window.GOOGLE_CALENDAR_CLIENT_ID || '';
    if (!CLIENT_ID) {
      document.getElementById('calConnectStatus').textContent = '⚠ Google Calendar not configured (missing CLIENT_ID).';
      btn.disabled = false;
      btn.textContent = 'Google Calendar';
      return;
    }
    const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly';
    const redirectUri = window.location.origin + '/oauth/google-calendar/callback/';
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(SCOPES)}&prompt=consent`;
    const popup = window.open(authUrl, 'googleCalAuth', 'width=500,height=620,left=300,top=100');
    const pollTimer = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(pollTimer);
          btn.disabled = false;
          btn.textContent = 'Google Calendar';
          return;
        }
        const hash = popup.location.hash;
        if (hash && hash.includes('access_token')) {
          clearInterval(pollTimer);
          popup.close();
          const params = new URLSearchParams(hash.substring(1));
          const token = params.get('access_token');
          if (token) {
            localStorage.setItem('gcal_token', token);
            localStorage.setItem('gcal_token_ts', Date.now());
            calendarConnected = true;
            calendarType = 'google';
            btn.textContent = 'Google connected';
            btn.style.borderColor = 'var(--green)';
            document.getElementById('calRefreshBtn').style.display = '';
            fetchGoogleCalendarEvents(token);
          }
        }
      } catch(e) { /* cross-origin, still polling */ }
    }, 500);
  }

  function connectMicrosoftCalendar() {
    const btn = document.getElementById('msCalBtn');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    const CLIENT_ID = window.MICROSOFT_CALENDAR_CLIENT_ID || '';
    if (!CLIENT_ID) {
      document.getElementById('calConnectStatus').textContent = '⚠ Microsoft Calendar not configured (missing CLIENT_ID).';
      btn.disabled = false;
      btn.textContent = 'Outlook or Teams';
      return;
    }
    const SCOPES = 'openid profile Calendars.Read offline_access';
    const redirectUri = window.location.origin + '/oauth/microsoft-calendar/callback/';
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(SCOPES)}`;
    const popup = window.open(authUrl, 'msCalAuth', 'width=500,height=620,left=300,top=100');
    const pollTimer = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(pollTimer);
          btn.disabled = false;
          btn.textContent = 'Outlook or Teams';
          return;
        }
        const hash = popup.location.hash;
        if (hash && hash.includes('access_token')) {
          clearInterval(pollTimer);
          popup.close();
          const params = new URLSearchParams(hash.substring(1));
          const token = params.get('access_token');
          if (token) {
            localStorage.setItem('mscal_token', token);
            localStorage.setItem('mscal_token_ts', Date.now());
            calendarConnected = true;
            calendarType = 'microsoft';
            btn.textContent = 'Outlook connected';
            btn.style.borderColor = 'var(--green)';
            document.getElementById('calRefreshBtn').style.display = '';
            fetchMicrosoftCalendarEvents(token);
          }
        }
      } catch(e) { /* cross-origin, still polling */ }
    }, 500);
  }

  async function fetchGoogleCalendarEvents(token) {
    const statusEl = document.getElementById('calConnectStatus');
    statusEl.textContent = '⏳ Fetching today\'s meetings…';
    const today = new Date();
    const timeMin = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const timeMax = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString();
    try {
      const r = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime&maxResults=20`,
        { headers: { Authorization: 'Bearer ' + token } }
      );
      if (!r.ok) throw new Error('API error ' + r.status);
      const d = await r.json();
      renderCalendarEvents(d.items || []);
      statusEl.textContent = `✅ Google Calendar synced`;
    } catch(e) {
      statusEl.textContent = '❌ Failed to fetch calendar: ' + e.message;
      if (e.message.includes('401')) {
        localStorage.removeItem('gcal_token');
        document.getElementById('googleCalBtn').textContent = 'Google Calendar';
        document.getElementById('googleCalBtn').disabled = false;
      }
    }
  }

  async function fetchMicrosoftCalendarEvents(token) {
    const statusEl = document.getElementById('calConnectStatus');
    statusEl.textContent = '⏳ Fetching today\'s meetings…';
    const today = new Date();
    const startDt = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const endDt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString();
    try {
      const r = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(startDt)}&endDateTime=${encodeURIComponent(endDt)}&$orderby=start/dateTime&$top=20&$select=subject,start,end,attendees,bodyPreview,onlineMeeting`,
        { headers: { Authorization: 'Bearer ' + token } }
      );
      if (!r.ok) throw new Error('API error ' + r.status);
      const d = await r.json();
      const events = (d.value || []).map(ev => ({
        summary: ev.subject,
        start: { dateTime: ev.start?.dateTime },
        end: { dateTime: ev.end?.dateTime },
        attendees: (ev.attendees || []).map(a => ({
          email: a.emailAddress?.address,
          displayName: a.emailAddress?.name,
          responseStatus: a.status?.response === 'accepted' ? 'accepted' : 'tentative'
        }))
      }));
      renderCalendarEvents(events);
      statusEl.textContent = `✅ Outlook Calendar synced`;
    } catch(e) {
      statusEl.textContent = '❌ Failed to fetch calendar: ' + e.message;
    }
  }

  function renderCalendarEvents(events) {
    const container = document.getElementById('calendarEventsList');
    const countEl = document.getElementById('calEventCount');
    if (!events.length) {
      container.innerHTML = '<div style="font-size:12px;color:var(--text3);font-style:italic">No meetings scheduled today</div>';
      countEl.textContent = '';
      return;
    }
    countEl.textContent = `(${events.length})`;
    container.innerHTML = '';
    events.forEach((ev, i) => {
      const startStr = ev.start?.dateTime
        ? new Date(ev.start.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : (ev.start?.date ? 'All day' : '');
      const endStr = ev.end?.dateTime
        ? new Date(ev.end.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      const timeLabel = endStr ? `${startStr} – ${endStr}` : startStr;
      const attendeeCount = (ev.attendees || []).length;
      const div = document.createElement('div');
      div.className = 'cal-event-item';
      div.setAttribute('title', `Click to load ${attendeeCount} participant${attendeeCount !== 1 ? 's' : ''} from this event`);
      div.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <span style="font-size:12px;font-weight:600;color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(ev.summary || 'Untitled')}</span>
          <span class="evt-time" style="flex-shrink:0">${escHtml(timeLabel)}</span>
        </div>
        ${attendeeCount ? `<div style="font-size:12px;color:var(--text3);margin-top:2px">${attendeeCount} attendee${attendeeCount !== 1 ? 's' : ''} • click to sync participants</div>` : ''}
      `;
      div.addEventListener('click', () => loadCalendarMeeting(ev));
      container.appendChild(div);
    });
  }

  async function loadCalendarMeeting(calEvent) {
    const attendees = calEvent.attendees || [];
    if (!attendees.length) {
      toast('No attendees found in this calendar event', 'info');
      return;
    }
    let added = 0;
    for (const attendee of attendees) {
      const name = attendee.displayName || attendee.email || '';
      if (!name) continue;
      // Skip if already in participants
      if (participants.some(p => p.name.toLowerCase() === name.toLowerCase())) continue;
      try {
        const r = await fetch(`/api/session/${SESSION_ID}/participants/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
          body: JSON.stringify({ name, role: attendee.email || '' }),
        });
        const d = await r.json();
        if (d.id) {
          participants.push({ id: d.id, name: d.name, role: d.role, color: d.color });
          added++;
        }
      } catch(e) { /* skip failed attendee */ }
    }
    renderParticipants();
    if (added > 0) {
      toast(`Added ${added} participant${added !== 1 ? 's' : ''} from calendar`, 'success');
    } else {
      toast('All attendees already in participant list', 'info');
    }
    // Auto-expand panel to show the new participants
    if (!teamsZoomed) toggleTeamsZoom();
  }

  function refreshCalendarEvents() {
    const gcalToken = localStorage.getItem('gcal_token');
    const mscalToken = localStorage.getItem('mscal_token');
    if (calendarType === 'google' && gcalToken) fetchGoogleCalendarEvents(gcalToken);
    else if (calendarType === 'microsoft' && mscalToken) fetchMicrosoftCalendarEvents(mscalToken);
    else toast('No calendar connected', 'info');
  }

  // Restore calendar session on page load
  (function restoreCalendarSession() {
    const gcalToken = localStorage.getItem('gcal_token');
    const gcalTs = parseInt(localStorage.getItem('gcal_token_ts') || '0');
    const mscalToken = localStorage.getItem('mscal_token');
    const mscalTs = parseInt(localStorage.getItem('mscal_token_ts') || '0');
    const oneHour = 3600 * 1000;
    if (gcalToken && (Date.now() - gcalTs < oneHour)) {
      calendarConnected = true;
      calendarType = 'google';
      const btn = document.getElementById('googleCalBtn');
      if (btn) { btn.textContent = 'Google connected'; btn.style.borderColor = 'var(--green)'; }
      document.getElementById('calRefreshBtn').style.display = '';
    } else if (mscalToken && (Date.now() - mscalTs < oneHour)) {
      calendarConnected = true;
      calendarType = 'microsoft';
      const btn = document.getElementById('msCalBtn');
      if (btn) { btn.textContent = 'Outlook connected'; btn.style.borderColor = 'var(--green)'; }
      document.getElementById('calRefreshBtn').style.display = '';
    }
  })();

  loadParticipants();
  loadCrossSessionCtx();
}

// ── Mobile tab switching ──────────────────────────────────────────────────
let _mobileActiveTab = 'transcript';

function switchMobileTab(tab) {
  _mobileActiveTab = tab;
  const layout = document.getElementById('mainLayout');
  if (!layout) return;
  layout.classList.toggle('mobile-tab-transcript', tab === 'transcript');
  layout.classList.toggle('mobile-tab-ai', tab === 'ai');
  const tBtn = document.getElementById('mTabTranscript');
  const aBtn = document.getElementById('mTabAI');
  if (tBtn) tBtn.classList.toggle('active', tab === 'transcript');
  if (aBtn) aBtn.classList.toggle('active', tab === 'ai');
  // Scroll transcript to bottom when switching to it
  if (tab === 'transcript') {
    const tp = document.getElementById('transcriptPanel');
    if (tp) tp.scrollTop = tp.scrollHeight;
  }
}

// ── Document attach panel ────────────────────────────────────────────────
(function initDocAttach() {
  const CSRFT = getCookie('csrftoken');
  let docPanelOpen = false;

  function toggleDocPanel() {
    docPanelOpen = !docPanelOpen;
    document.getElementById('docAttachPanel').style.display = docPanelOpen ? 'block' : 'none';
    if (docPanelOpen) loadDocAttachList();
  }
  window.toggleDocPanel = toggleDocPanel;

  document.addEventListener('click', e => {
    const wrap = document.getElementById('docAttachWrap');
    if (wrap && !wrap.contains(e.target)) {
      docPanelOpen = false;
      document.getElementById('docAttachPanel').style.display = 'none';
    }
  });

  async function loadDocAttachList() {
    const list = document.getElementById('docAttachList');
    const empty = document.getElementById('docAttachEmpty');
    try {
      const [docsResp, sessionDocsResp] = await Promise.all([
        fetch('/api/documents/'),
        fetch(`/api/session/${SESSION_ID}/documents/`),
      ]);
      if (!docsResp.ok || !sessionDocsResp.ok) {
        empty.textContent = 'Failed to load documents.';
        empty.style.display = 'block';
        return;
      }
      const docsData = await docsResp.json();
      const documents = docsData.documents || [];
      const sessionData = await sessionDocsResp.json();
      const sessionDocs = sessionData.documents || [];
      const attachedIds = new Set(sessionDocs.filter(d => d.attached).map(d => d.id));

      list.querySelectorAll('.doc-attach-row').forEach(el => el.remove());

      if (!documents.length) {
        empty.textContent = 'No documents uploaded.';
        empty.style.display = 'block';
        updateDocBadge(0);
        return;
    }
    empty.style.display = 'none';

    documents.forEach(doc => {
      const attached = attachedIds.has(doc.id);
      const row = document.createElement('label');
      row.className = 'doc-attach-row';
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:13px;';
      row.onmouseover = () => row.style.background = 'var(--bg3)';
      row.onmouseout = () => row.style.background = '';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = attached;
      cb.disabled = doc.status !== 'ready';
      cb.dataset.id = doc.id;
      cb.addEventListener('change', async () => {
        if (cb.checked) {
          await fetch(`/api/session/${SESSION_ID}/documents/attach/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': CSRFT },
            body: JSON.stringify({ document_ids: [doc.id] }),
          });
        } else {
          await fetch(`/api/session/${SESSION_ID}/documents/${doc.id}/detach/`, {
            method: 'POST', headers: { 'X-CSRFToken': CSRFT },
          });
        }
        updateDocBadge(list.querySelectorAll('input[type=checkbox]:checked').length);
      });
      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameSpan.title = doc.filename;
      nameSpan.textContent = doc.filename;
      const statusSpan = document.createElement('span');
      statusSpan.style.cssText = 'font-size:11px;flex-shrink:0;';
      statusSpan.style.color = doc.status === 'ready' ? '#10b981' : doc.status === 'error' ? '#ef4444' : 'var(--text3)';
      statusSpan.textContent = doc.status === 'ready' ? '●' : doc.status === 'error' ? '✗' : '…';
      row.appendChild(cb);
      row.appendChild(nameSpan);
      row.appendChild(statusSpan);
      list.appendChild(row);
    });
      updateDocBadge(attachedIds.size);
    } catch (err) {
      const empty = document.getElementById('docAttachEmpty');
      if (empty) { empty.textContent = 'Error loading documents.'; empty.style.display = 'block'; }
    }
  }

  function updateDocBadge(n) {
    const badge = document.getElementById('docAttachCount');
    if (n > 0) { badge.style.display = 'block'; badge.textContent = n; }
    else badge.style.display = 'none';
  }

  // Load badge count on page load (without opening panel)
  fetch(`/api/session/${SESSION_ID}/documents/`).then(r => r.ok ? r.json() : {documents:[]}).then(data => {
    const docs = data.documents || [];
    updateDocBadge(docs.filter(d => d.attached).length);
  }).catch(() => {});
})();

// Initialize mobile tab state and auto-switch to AI when a response arrives
(function initMobile() {
  const isMobile = () => window.matchMedia('(max-width: 640px)').matches;
  if (isMobile()) {
    switchMobileTab('transcript');
  }
  // Patch triggerAI to auto-switch to AI tab on mobile
  const _origTriggerAI = triggerAI;
  triggerAI = function() {
    const result = _origTriggerAI.apply(this, arguments);
    if (isMobile()) switchMobileTab('ai');
    return result;
  };
  // Handle resize: add/remove mobile tab classes
  window.addEventListener('resize', () => {
    if (isMobile()) {
      switchMobileTab(_mobileActiveTab);
    } else {
      const layout = document.getElementById('mainLayout');
      if (layout) {
        layout.classList.remove('mobile-tab-transcript', 'mobile-tab-ai');
      }
    }
  }, { passive: true });
})();
