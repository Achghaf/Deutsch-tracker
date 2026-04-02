// PDF.js
if(typeof pdfjsLib!=='undefined')pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ===== SUPABASE CONFIG — remplace ces 2 valeurs =====
const SUPABASE_URL = 'https://crgqqzpkppmlhjyawumk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_IZamkQuR6GgxYLQUqYOOOw_EtlieEI_';
// =====================================================

// Initialize Supabase with session persistence and auto-refresh enabled.
const _supa = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // Persist the user session in local storage so that refreshes keep the user logged in.
    persistSession: true,
    // Automatically refresh the access token when it expires.
    autoRefreshToken: true,
  },
});
let currentUser = null;
let currentRole = 'user'; // 'admin' | 'user'
let newsFilter = 'all';
let editingNewsId = null;
let _newsPosts = [];
let currentLang = 'de';
let _appInited = false;
let _staticUiBound = false;
let _adminAllUsers = [];
let _adminRoleFilter = 'all';

function isAdmin(){ return currentRole === 'admin'; }

const USER_PAGES = ['tracker','pdf','translate','news','quiz','level','vocab','listening'];

function applyRoleUI(){
  const admin = isAdmin();
  // News nav items — visible for everyone (users can read, only admin can write)
  document.querySelectorAll('.nav-item[data-page="news"], .desk-nav-item[data-page="news"]')
    .forEach(el => el.style.display = '');
  // News composer — hidden for users
  const composer = document.querySelector('.news-composer');
  if(composer) composer.style.display = admin ? '' : 'none';
  // Reset button — hidden for users
  document.querySelectorAll('.reset-btn').forEach(el => el.style.display = admin ? '' : 'none');
  // Role badge in profile
  let roleBadge = document.getElementById('role-badge');
  if(!roleBadge){
    roleBadge = document.createElement('div');
    roleBadge.id = 'role-badge';
    roleBadge.style.cssText = 'display:inline-block;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;padding:2px 8px;border-radius:20px;margin-top:4px;font-weight:600;';
    const nameEl = document.getElementById('profile-display-name');
    if(nameEl) nameEl.insertAdjacentElement('afterend', roleBadge);
  }
  // Display badge label and styles depending on the current role
  if(currentRole === 'admin'){
    roleBadge.textContent = '\u{1F451} Admin';
    roleBadge.style.background = 'rgba(232,184,75,0.15)';
    roleBadge.style.color = 'var(--gold)';
    roleBadge.style.border = '1px solid rgba(232,184,75,0.3)';
  }else if(currentRole === 'pending'){
    roleBadge.textContent = '\u{23F3} Pending';
    // Use a subtle gold tint to indicate awaiting approval
    roleBadge.style.background = 'rgba(232,184,75,0.12)';
    roleBadge.style.color = 'var(--gold)';
    roleBadge.style.border = '1px solid rgba(232,184,75,0.3)';
  }else{
    roleBadge.textContent = '\u{1F464} User';
    roleBadge.style.background = 'rgba(255,255,255,0.07)';
    roleBadge.style.color = 'var(--muted)';
    roleBadge.style.border = '1px solid var(--border)';
  }
  // Edit/delete buttons in news posts
  document.querySelectorAll('.news-icon-btn').forEach(b => b.style.display = admin ? '' : 'none');
  // Admin panel in profile
  const adminPanel = document.getElementById('admin-panel');
  if(adminPanel) adminPanel.style.display = admin ? 'block' : 'none';
  // If admin opens profile, load users
  if(admin && adminPanel && adminPanel.style.display !== 'none'){
    adminLoadUsers();
  }
  // Admin nav items — only visible to admins
  const deskAdminNav = document.getElementById('desk-admin-nav');
  const mobAdminNav = document.getElementById('mob-admin-nav');
  if(deskAdminNav) deskAdminNav.style.display = admin ? '' : 'none';
  if(mobAdminNav) mobAdminNav.style.display = admin ? '' : 'none';
  // If user tries to stay on admin page without permission, redirect
  if(!admin && activeAppPage === 'admin') switchPage('tracker');
}

function wait(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

function setOverlayState(target){
  document.getElementById('app-loader').classList.toggle('visible',target==='loader');
  document.getElementById('login-screen').classList.toggle('visible',target==='login');
  document.getElementById('confirm-screen').classList.toggle('visible',target==='confirm');
  document.getElementById('request-screen').classList.toggle('visible',target==='request');
}
function showLoader(){setOverlayState('loader');}
function showLoginScreen(){setOverlayState('login');}
function showConfirmScreen(){setOverlayState('confirm');}
function showRequestScreen(){setOverlayState('request');}
function hideRequestScreen(){showLoginScreen();}
function showAppShell(){setOverlayState('app');}

async function startAuthenticatedApp(user){
  currentUser=user;
  // Role resolution: hardcoded admin email + user_metadata fallback
  const ADMIN_EMAIL = 'achrafbensaid01@gmail.com';
  const meta = user.user_metadata || {};
  // Determine the role from user metadata. The default role is 'user'.
  if(user.email === ADMIN_EMAIL || meta.role === 'admin'){
    currentRole = 'admin';
  }else if(meta.role === 'pending'){
    currentRole = 'pending';
  }else{
    currentRole = 'user';
  }
  showUserBadge(currentUser);
  try{
    if(!_appInited){
      _appInited=true;
      await initApp();
    }else{
      updateTodayLabel();
      render();
      renderNewsPage();
      updateStorageBar();
    }
  }catch(err){
    console.error('App init error:', err);
    try{
      updateTodayLabel();
      render();
      renderNewsPage();
      updateStorageBar();
    }catch(_){ }
  }
  showAppShell();
  switchPage(activeAppPage||'tracker');
  setTimeout(startPresenceHeartbeat, 2000);
  setTimeout(initNotifications, 3000);
}

async function bootstrapAuth(){
  showLoader();
  try{
    const sessionResult=await Promise.race([
      _supa.auth.getSession(),
      new Promise(resolve=>setTimeout(()=>resolve({data:{session:null}}),2500))
    ]);
    const session=sessionResult?.data?.session||null;
    if(session?.user){
      await startAuthenticatedApp(session.user);
    }else{
      const isSignupReturn=new URLSearchParams(window.location.search).get('type')==='signup';
      // Check if a persisted user is stored locally (for offline persistence). If so, skip login.
      const persistedStr = localStorage.getItem('persist_user');
      if(persistedStr){
        try{
          const persistedUser = JSON.parse(persistedStr);
          await startAuthenticatedApp(persistedUser);
          return;
        }catch(_){ /* ignore parse errors */ }
      }
      if(isSignupReturn)showConfirmScreen();
      else showLoginScreen();
      // When no session is found, optionally allow a guest session for
      // offline usage by appending ?guest=1 or #guest to the URL.  This
      // sets up a dummy user object and bypasses the login screen.
      const qp = new URLSearchParams(window.location.search);
      if (qp.get('guest') === '1' || window.location.hash.includes('guest')) {
        const guestUser = { id: 'guest', email: 'guest@local', user_metadata: { name: 'Gast' } };
        startAuthenticatedApp(guestUser);
      }
    }
  }catch(e){
    console.error('Auth bootstrap error:', e);
    showLoginScreen();
  }
}
bootstrapAuth();


// ===== AUTH SUPABASE =====
let authMode='login';
function switchAuthTab(mode){
  authMode=mode;
  document.getElementById('tab-login').classList.toggle('active',mode==='login');
  document.getElementById('tab-register').classList.toggle('active',mode==='register');
  const isReg = mode==='register';
  document.getElementById('field-password').style.display='block';
  document.getElementById('field-confirm-password').style.display=isReg?'block':'none';
  const fieldName=document.getElementById('field-name');if(fieldName)fieldName.style.display=isReg?'block':'none';
  document.getElementById('auth-password').placeholder=isReg?'Passwort wählen (min. 6 Zeichen)':'••••••••';
  document.getElementById('auth-password').autocomplete=isReg?'new-password':'current-password';
  document.getElementById('auth-btn').textContent=isReg?'Konto erstellen':'Anmelden';
  document.getElementById('auth-error').classList.remove('visible');
}

function showAuthError(msg){const el=document.getElementById('auth-error');el.textContent=msg;el.classList.add('visible');}

// Hide email confirmation screen and return to login screen
function hideConfirmScreen(){
  showLoginScreen();
}

// No client-side signup throttling here.
// Supabase already enforces server-side protections, and localStorage-based
// limits can falsely block real users on the same browser.
function getSignupRedirectUrl(){
  return window.location.origin + window.location.pathname;
}

async function handleAuth(){
  const email=document.getElementById('auth-email').value.trim().toLowerCase();
  const btn=document.getElementById('auth-btn');

  if(authMode==='register'){
    const pwd=document.getElementById('auth-password').value;
    const confirmPwd=document.getElementById('auth-confirm-password').value;
    const displayName=(document.getElementById('auth-name')&&document.getElementById('auth-name').value.trim())||'';
    if(!email){showAuthError('Bitte gib deine E-Mail ein.');return;}
    if(!pwd||pwd.length<6){showAuthError('Passwort muss mindestens 6 Zeichen haben.');return;}
    if(pwd!==confirmPwd){showAuthError('Passwörter stimmen nicht überein.');return;}
    btn.disabled=true;btn.textContent='...';
    document.getElementById('auth-error').classList.remove('visible');
    try{
      const {data,error}=await _supa.auth.signUp({
        email,
        password:pwd,
        options:{ data:{ role:'pending', name: displayName||undefined } }
      });      // When a user signs up we also create a record in the `pending_users` table so that
      // admins can view and approve the access request. Without this insert new accounts
      // would never appear in the Pending Access Requests list. We only perform the insert
      // if there was no sign‑up error. We intentionally swallow any insert errors here
      // because the primary sign‑up may still succeed, and failing to insert should not
      // block the user from completing registration.
      if (!error) {
        try {
          await _supa.from('pending_users').insert({
            email: email,
            full_name: displayName || null,
            status: 'pending'
          });
        } catch (insErr) {
          console.error('Failed to insert pending user', insErr);
        }
      }

      if(error) throw error;
      if(displayName) try{localStorage.setItem('profile_display_name',displayName);}catch(_){}
      btn.disabled=false;btn.textContent='Konto erstellen';
      if(data?.session){ return; }
      showRequestScreen();
    }catch(e){
      btn.disabled=false;btn.textContent='Konto erstellen';
      const msg=(e&&e.message)?e.message:String(e);
      if(/already registered/i.test(msg)||/already exists/i.test(msg)){
        showAuthError('Diese E-Mail ist bereits registriert. Bitte melde dich an.');
      } else {
        showAuthError(msg);
      }
    }
    return;
  }

  // LOGIN mode
  const pwd=document.getElementById('auth-password').value;
  if(!email||!pwd){showAuthError(t('error_fill_all'));return;}
  if(pwd.length<6){showAuthError(t('error_pwd_short'));return;}
  btn.disabled=true;btn.textContent='...';
  document.getElementById('auth-error').classList.remove('visible');
  try{
    const { error } = await _supa.auth.signInWithPassword({ email, password: pwd });
    if(error) throw error;
  } catch(e){
    btn.disabled = false;
    btn.textContent = 'Anmelden';
    const msgs = {
      'Invalid login credentials': t('error_invalid_login'),
      'Email not confirmed': t('error_not_confirmed'),
    };
    const serverMsg = (e && e.message) ? e.message : '';
    if(/too many/i.test(serverMsg) || /429/.test(serverMsg) || /rate limit/i.test(serverMsg)){
      showAuthError(t('error_too_many'));
    } else {
      showAuthError(msgs[serverMsg] || serverMsg || String(e));
    }
  }
}

async function logout(){
  if(!confirm(t('confirm_logout')))return;
  await _supa.auth.signOut();
}

// Supabase handles the session automatically.

_supa.auth.onAuthStateChange(async(event,session)=>{
  if(session?.user){
    // Persist the logged-in user to localStorage so refreshes keep them signed in.
    try{ localStorage.setItem('persist_user', JSON.stringify(session.user)); } catch(_){ }
    await startAuthenticatedApp(session.user);
  }else{
    // Remove any persisted user on logout or session expiration.
    try{ localStorage.removeItem('persist_user'); } catch(_){ }
    currentUser=null;
    _appInited=false;
    if(document.getElementById('confirm-screen').classList.contains('visible'))return;
    showLoginScreen();
    ['mob-profile-btn','desk-profile-btn'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    const mobProfileNav=document.getElementById('mob-profile-nav-item');if(mobProfileNav)mobProfileNav.style.display='none';
    closeProfileModal();
  }
});

function showUserBadge(user){
  // Determine display name from user metadata or email
  const savedName = localStorage.getItem('profile_display_name');
  const name = savedName || (user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name)) || (user.email ? user.email.split('@')[0] : '');
  const avatarEmoji = localStorage.getItem('profile_avatar_emoji') || '';
  const avatarColor = localStorage.getItem('profile_avatar_color') || '';
  const initial = name ? name[0].toUpperCase() : '?';
  const avatarDisplay = avatarEmoji || initial;
  // Update all profile avatar buttons
  ['mob-profile-btn','desk-profile-btn'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){
      el.textContent=avatarDisplay;
      el.style.display='flex';
      if(avatarColor) el.style.background=avatarColor;
      else el.style.background='linear-gradient(145deg,#2a1f6e 0%,#4a2d9c 40%,#7b3fc4 100%)';
    }
  });
  // Show mobile profile nav item
  const mobProfileNav=document.getElementById('mob-profile-nav-item');
  if(mobProfileNav) mobProfileNav.style.display='';
  const deskProfileBtn=document.getElementById('desk-profile-btn');
  if(deskProfileBtn) deskProfileBtn.style.display='flex';
  // Populate profile modal
  const avatarBig=document.getElementById('profile-avatar-big');
  if(avatarBig){
    avatarBig.textContent=avatarDisplay;
    if(avatarColor) avatarBig.style.background=avatarColor;
    else avatarBig.style.background='linear-gradient(145deg,#2a1f6e 0%,#4a2d9c 40%,#7b3fc4 100%)';
  }
  const displayNameEl=document.getElementById('profile-display-name');
  if(displayNameEl) displayNameEl.textContent=name||initial;
  const displayEmail=document.getElementById('profile-display-email');
  if(displayEmail) displayEmail.textContent=user.email||'';
  const emailInput=document.getElementById('profile-email-input');
  if(emailInput) emailInput.value=user.email||'';
  const nameInput=document.getElementById('profile-name-input');
  if(nameInput) nameInput.value=name||'';
  // Update name in header
  const headerNameEl=document.getElementById('user-header-name');
  if(headerNameEl) headerNameEl.textContent = name || '';
  // Update stats chips
  updateProfileStats();
  updateDocsAccountHint();
  applyRoleUI();
}

function updateProfileStats(){
  try{
    const weeks=Object.keys(state.completedWeeks||{}).filter(k=>state.completedWeeks[k]).length;
    const streak=state.streak||0;
    const pct=Math.round(weeks/20*100);
    const psw=document.getElementById('ps-weeks');if(psw)psw.textContent=weeks;
    const pss=document.getElementById('ps-streak');if(pss)pss.textContent=streak;
    const psp=document.getElementById('ps-progress');if(psp)psp.textContent=pct+'%';
  }catch(e){}
}

// Avatar picker logic
const AVATAR_EMOJIS=['🦊','🐻','🦁','🐼','🐯','🐺','🦅','🐙','🌟','⚡','🎯','🔥','🌙','💎','🎸','🚀','🌺','🍀'];
const AVATAR_COLORS=['linear-gradient(135deg,#e8b84b,#b5832a)','linear-gradient(135deg,#5b7ec9,#3a5fa0)','linear-gradient(135deg,#3dba6e,#2a8c50)','linear-gradient(135deg,#cc1f1f,#991515)','linear-gradient(135deg,#8b3dba,#6a2d9a)','linear-gradient(135deg,#3aacf0,#2080c0)','linear-gradient(135deg,#f07030,#c05020)','linear-gradient(135deg,#888,#444)'];

function initAvatarPicker(){
  const grid=document.getElementById('avatar-emoji-grid');
  const colorRow=document.getElementById('avatar-color-row');
  if(!grid||!colorRow)return;
  const currentEmoji=localStorage.getItem('profile_avatar_emoji')||'';
  const currentColor=localStorage.getItem('profile_avatar_color')||'';
  grid.innerHTML='';
  AVATAR_EMOJIS.forEach(em=>{
    const btn=document.createElement('button');
    btn.className='avatar-emoji-opt'+(currentEmoji===em?' selected':'');
    btn.textContent=em;
    btn.onclick=(e)=>{
      e.stopPropagation();
      localStorage.setItem('profile_avatar_emoji',em);
      document.querySelectorAll('.avatar-emoji-opt').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected');
      if(currentUser) showUserBadge(currentUser);
    };
    grid.appendChild(btn);
  });
  // Add "initial" option
  const clearBtn=document.createElement('button');
  clearBtn.className='avatar-emoji-opt'+(currentEmoji===''?' selected':'');
  clearBtn.textContent='Aa';clearBtn.style.fontSize='0.75rem';clearBtn.style.fontFamily="'Bebas Neue',sans-serif";
  clearBtn.onclick=(e)=>{e.stopPropagation();localStorage.removeItem('profile_avatar_emoji');document.querySelectorAll('.avatar-emoji-opt').forEach(b=>b.classList.remove('selected'));clearBtn.classList.add('selected');if(currentUser)showUserBadge(currentUser);};
  grid.appendChild(clearBtn);

  colorRow.innerHTML='';
  AVATAR_COLORS.forEach(c=>{
    const sw=document.createElement('div');
    sw.className='avatar-color-swatch'+(currentColor===c?' selected':'');
    sw.style.background=c;
    sw.onclick=(e)=>{
      e.stopPropagation();
      localStorage.setItem('profile_avatar_color',c);
      document.querySelectorAll('.avatar-color-swatch').forEach(s=>s.classList.remove('selected'));
      sw.classList.add('selected');
      if(currentUser)showUserBadge(currentUser);
    };
    colorRow.appendChild(sw);
  });
}

function toggleAvatarPicker(e){
  e.stopPropagation();
  initAvatarPicker();
  const picker=document.getElementById('avatar-emoji-picker');
  if(!picker) return;
  const isOpen = picker.classList.contains('open');
  if(isOpen){ picker.classList.remove('open'); return; }
  // Position the picker relative to the avatar button using fixed coords
  const avatar = document.getElementById('profile-avatar-big');
  if(avatar){
    const rect = avatar.getBoundingClientRect();
    const pickerW = 240;
    // Center below avatar, keep within viewport
    let left = rect.left + rect.width/2 - pickerW/2;
    let top = rect.bottom + 10;
    left = Math.max(8, Math.min(left, window.innerWidth - pickerW - 8));
    if(top + 300 > window.innerHeight) top = rect.top - 10 - 300; // flip up if no room
    picker.style.left = left + 'px';
    picker.style.top = top + 'px';
  }
  picker.classList.add('open');
}

document.addEventListener('click',function(e){
  const picker=document.getElementById('avatar-emoji-picker');
  const wrap=document.getElementById('profile-avatar-wrap');
  if(picker&&picker.classList.contains('open')&&!wrap.contains(e.target)&&!picker.contains(e.target)){
    picker.classList.remove('open');
  }
});

// ===== DATA =====
const DATA_I18N={
  de:{
    months:[
      {id:'m1',cls:'m1',title:'Monat 1',sub:'Grundlagen (A1)',desc:'Alphabet · Artikel · Basissätze',weeks:[{w:1,name:'Alphabet & Aussprache',topic:'Buchstaben, Umlaute ä/ö/ü, ß, ch/sch'},{w:2,name:'Grüße & Zahlen',topic:'Phrasen, Zahlen 1–1000, Tage, Monate'},{w:3,name:'Artikel & Genus',topic:'der/die/das Regeln, Genus erkennen'},{w:4,name:'sein, haben & Präsens',topic:'Konjugation, einfache Sätze'}]},
      {id:'m2',cls:'m2',title:'Monat 2',sub:'A1 fertig, A2 Start',desc:'Fälle · Modalverben · Vergangenheit',weeks:[{w:5,name:'Nominativ & Akkusativ',topic:'Artikelveränderung, direkte Objekte'},{w:6,name:'Modalverben',topic:'können, müssen, wollen, dürfen, sollen, mögen'},{w:7,name:'Perfekt',topic:'haben/sein + Partizip II, unregelmäßige Formen'},{w:8,name:'Dativ + Präpositionen',topic:'mit, von, aus, bei, nach, seit, zu'}]},
      {id:'m3',cls:'m3',title:'Monat 3',sub:'A2 fertig, B1 Einstieg',desc:'Wortschatz · Komplexe Grammatik · Gespräche',weeks:[{w:9,name:'Alltagswortschatz',topic:'Zuhause, Essen, Reisen, Einkaufen – 500 Wörter'},{w:10,name:'Wechselpräpositionen',topic:'an, auf, in, über, neben – Akk. vs Dat.'},{w:11,name:'Genitiv',topic:'des/der Besitz, formales Schreiben'},{w:12,name:'Wiederholung & Sprechen',topic:'Mock-Gespräche, A2 Checkpoint'}]},
      {id:'m4',cls:'m4',title:'Monat 4',sub:'B1 Grammatikkern',desc:'Nebensätze · Futur · Konjunktiv II',weeks:[{w:13,name:'Nebensätze',topic:'weil, dass, obwohl, wenn, als – Verb ans Ende'},{w:14,name:'Futur I',topic:'werden + Infinitiv, Pläne & Vorhersagen'},{w:15,name:'Konjunktiv II',topic:'würde, könnte, hätte – Höflichkeit & Hypothesen'},{w:16,name:'Hören & Lesen',topic:'Slow German Podcast, DW Artikel, B1 Texte'}]},
      {id:'m5',cls:'m5',title:'Monat 5',sub:'B1 Konsolidierung',desc:'Flüssigkeit · Immersion · Prüfungsvorbereitung',weeks:[{w:17,name:'Wortschatzerweiterung',topic:'Arbeit, Meinungen, Emotionen – 1000+ Wörter'},{w:18,name:'Sprechübung',topic:'italki Stunden, Gespräche, Aussprache'},{w:19,name:'Schreiben & Verstehen',topic:'kurze E-Mails, DW Artikel, B1 Texte'},{w:20,name:'B1 Probetest & Review',topic:'Vollständiger Probetest, Schwachstellen, Review'}]},
    ],
    dailyTasks:[
      {id:'anki',name:'Anki Vokabeln',icon:'🃏',duration:'20 Min.'},
      {id:'grammar',name:'Grammatik/Thema',icon:'📖',duration:'30 Min.'},
      {id:'listen',name:'Hörverstehen',icon:'🎧',duration:'20 Min.'},
      {id:'speak',name:'Sprechen / Schreiben',icon:'🗣',duration:'20 Min.'}
    ]
  },
  en:{
    months:[
      {id:'m1',cls:'m1',title:'Month 1',sub:'Foundations (A1)',desc:'Alphabet · Articles · Basic sentences',weeks:[{w:1,name:'Alphabet & Pronunciation',topic:'Letters, umlauts ä/ö/ü, ß, ch/sch'},{w:2,name:'Greetings & Numbers',topic:'Phrases, numbers 1–1000, days, months'},{w:3,name:'Articles & Gender',topic:'der/die/das rules, recognizing gender'},{w:4,name:'sein, haben & Present tense',topic:'Conjugation, simple sentences'}]},
      {id:'m2',cls:'m2',title:'Month 2',sub:'Finish A1, start A2',desc:'Cases · Modal verbs · Past tense',weeks:[{w:5,name:'Nominative & Accusative',topic:'Article changes, direct objects'},{w:6,name:'Modal verbs',topic:'can, must, want, may, should, like'},{w:7,name:'Perfect tense',topic:'haben/sein + past participle, irregular forms'},{w:8,name:'Dative + Prepositions',topic:'mit, von, aus, bei, nach, seit, zu'}]},
      {id:'m3',cls:'m3',title:'Month 3',sub:'Finish A2, enter B1',desc:'Vocabulary · Complex grammar · Conversations',weeks:[{w:9,name:'Everyday vocabulary',topic:'Home, food, travel, shopping – 500 words'},{w:10,name:'Two-way prepositions',topic:'an, auf, in, über, neben – acc. vs dat.'},{w:11,name:'Genitive',topic:'des/der possession, formal writing'},{w:12,name:'Review & Speaking',topic:'Mock conversations, A2 checkpoint'}]},
      {id:'m4',cls:'m4',title:'Month 4',sub:'Core B1 grammar',desc:'Subordinate clauses · Future · Subjunctive II',weeks:[{w:13,name:'Subordinate clauses',topic:'weil, dass, obwohl, wenn, als – verb at the end'},{w:14,name:'Future I',topic:'werden + infinitive, plans & predictions'},{w:15,name:'Konjunktiv II',topic:'would, could, had – politeness & hypotheses'},{w:16,name:'Listening & Reading',topic:'Slow German podcast, DW articles, B1 texts'}]},
      {id:'m5',cls:'m5',title:'Month 5',sub:'B1 consolidation',desc:'Fluency · Immersion · Exam prep',weeks:[{w:17,name:'Vocabulary expansion',topic:'Work, opinions, emotions – 1000+ words'},{w:18,name:'Speaking practice',topic:'italki lessons, conversations, pronunciation'},{w:19,name:'Writing & Comprehension',topic:'Short emails, DW articles, B1 texts'},{w:20,name:'B1 mock test & review',topic:'Full mock test, weak points, review'}]},
    ],
    dailyTasks:[
      {id:'anki',name:'Anki vocabulary',icon:'🃏',duration:'20 min'},
      {id:'grammar',name:'Grammar / Topic',icon:'📖',duration:'30 min'},
      {id:'listen',name:'Listening practice',icon:'🎧',duration:'20 min'},
      {id:'speak',name:'Speaking / Writing',icon:'🗣',duration:'20 min'}
    ]
  }
};
function getData(){return DATA_I18N[currentLang]||DATA_I18N.de;}

// ===== TRACKER STATE (Supabase) =====
let state={completedWeeks:{},dailyDone:{},notes:'',streak:0,startDate:null,lastActiveDay:null,newsPosts:[],reminderNotif:false};
let saveTimeout=null;
let activeAppPage='tracker';

async function loadState(){
  if(!currentUser)return;
  try{
    const {data}=await _supa.from('tracker_state').select('data').eq('user_id',currentUser.id).single();
    if(data?.data)state={...state,...data.data};
  }catch(e){}
  if(!state.startDate)state.startDate=new Date().toDateString();
  if(!Array.isArray(state.newsPosts))state.newsPosts=[];
  if(typeof state.reminderNotif!=='boolean')state.reminderNotif=!!state.reminderNotif;
}
function save(){
  if(!currentUser)return;
  clearTimeout(saveTimeout);
  saveTimeout=setTimeout(async()=>{
    try{await _supa.from('tracker_state').upsert({user_id:currentUser.id,data:state,updated_at:new Date().toISOString()},{onConflict:'user_id'});}
    catch(e){}
  },800);
}
function getToday(){return new Date().toDateString();}
function getLocale(){return currentLang==='en'?'en-GB':'de-DE';}
function updateTodayLabel(){
  const todayLabel=document.getElementById('today-label');
  if(todayLabel){
    todayLabel.textContent=new Date().toLocaleDateString(getLocale(),{weekday:'long',day:'numeric',month:'long'});
  }
}
function resetDailyIfNewDay(){
  const today=getToday();
  if(!state.lastActiveDay){state.lastActiveDay=today;save();return;}
  if(state.lastActiveDay!==today){
    const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
    const wasYesterday=state.lastActiveDay===yesterday.toDateString();
    const allTaskIds=['anki','grammar','listen','speak'];
    const prevAllDone=wasYesterday&&allTaskIds.every(id=>state.dailyDone[id]);
    if(prevAllDone){state.streak=(state.streak||0)+1;}
    else if(state.lastActiveDay!==today){state.streak=0;}
    state.dailyDone={};state.lastActiveDay=today;save();
  }
}

// Schedule a midnight reset — if tasks not done by end of day, streak resets
let _midnightTimer=null;
function scheduleMidnightReset(){
  clearTimeout(_midnightTimer);
  const now=new Date();
  const msUntilMidnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,0,0,2).getTime()-now.getTime();
  _midnightTimer=setTimeout(()=>{
    // At midnight: if not all tasks done, reset streak
    const allTaskIds=['anki','grammar','listen','speak'];
    const allDone=allTaskIds.every(id=>state.dailyDone[id]);
    if(!allDone){
      state.streak=0;
      save();
      showToast('💔 Streak zurückgesetzt – vergiss deine Aufgaben nicht!');
    }
    // Reset daily tasks for the new day
    state.dailyDone={};
    state.lastActiveDay=getToday();
    save();
    render();
    updateStreakWidget();
    scheduleMidnightReset();
    scheduleStreakReminder(); // schedule next midnight
  },msUntilMidnight);
}
function computeProgress(){return Math.round(Object.keys(state.completedWeeks).filter(k=>state.completedWeeks[k]).length/20*100);}

function renderJourney(){
  const bar=document.getElementById('journey-bar');bar.innerHTML='';
  const data=getData();
  const pcts=data.months.map(m=>m.weeks.filter(w=>state.completedWeeks[w.w]).length/m.weeks.length);
  data.months.forEach((m,i)=>{
    const p=pcts[i],isDone=p===1,isActive=p>0&&!isDone;
    const node=document.createElement('div');node.className='month-node';
    node.innerHTML=`<div class="month-dot ${isDone?'done':isActive?'active':'locked'}">${isDone?'✓':i+1}</div><div class="month-label">${m.title}</div><div class="month-sublabel">${m.sub}</div>`;
    bar.appendChild(node);
    if(i<data.months.length-1){const conn=document.createElement('div');const np=pcts[i+1];conn.className='month-connector '+(p===1?'done':np>0?'partial':'');if(np>0&&np<1)conn.style.setProperty('--fill',Math.round(np*100)+'%');bar.appendChild(conn);}
  });
}
function renderMonths(){
  const grid=document.getElementById('months-grid');grid.innerHTML='';
  const data=getData();
  data.months.forEach(m=>{
    const done=m.weeks.filter(w=>state.completedWeeks[w.w]).length,pct=Math.round(done/m.weeks.length*100),isDone=pct===100,isActive=pct>0&&!isDone;
    const card=document.createElement('div');card.className=`month-card ${m.cls} ${isDone?'done':isActive?'active':''}`;
    card.innerHTML=`<div class="month-card-header"><div><div class="month-card-title">${m.title} — ${m.sub}</div><div class="month-card-sub">${m.desc}</div></div><div class="month-pct" style="color:${isDone?'var(--green)':'var(--gold)'}">${pct}%</div></div><div style="height:8px"></div><div class="month-progress-bar"><div class="month-progress-fill" style="width:${pct}%"></div></div><div class="weeks-list">${m.weeks.map(w=>{const wDone=!!state.completedWeeks[w.w];return`<div class="week-row" onclick="toggleWeek(${w.w})"><div class="week-check ${wDone?'done':''}">${wDone?'✓':''}</div><div class="week-info"><div class="week-name">${t('week_label')} ${w.w}: ${w.name}</div><div class="week-topic">${w.topic}</div></div><div class="week-num">W${w.w}</div></div>`;}).join('')}</div>`;
    grid.appendChild(card);
  });
}
function renderDaily(){
  const grid=document.getElementById('daily-grid');grid.innerHTML='';
  const data=getData();
  data.dailyTasks.forEach(t=>{
    const done=!!state.dailyDone[t.id],card=document.createElement('div');
    card.className=`task-card ${done?'done':''}`;card.onclick=()=>toggleTask(t.id);
    card.innerHTML=`<div class="task-icon">${t.icon}</div><div class="task-info"><div class="task-name">${t.name}</div><div class="task-duration">${t.duration}</div></div><div class="task-checkbox">${done?'✓':''}</div>`;
    grid.appendChild(card);
  });
}
function updateStreakWidget(){
  const allTaskIds=['anki','grammar','listen','speak'];
  const doneTasks=allTaskIds.filter(id=>state.dailyDone[id]).length;
  const total=allTaskIds.length;
  const allDone=doneTasks===total;
  const pct=Math.round(doneTasks/total*100);

  const counter=document.getElementById('streak-counter');
  const bar=document.getElementById('streak-bar-fill');
  const barLabel=document.getElementById('streak-tasks-label');
  const warning=document.getElementById('streak-warning');
  if(!counter)return;

  counter.classList.toggle('complete',allDone);
  counter.classList.toggle('at-risk',!allDone&&(state.streak>0||doneTasks>0));
  if(bar)bar.style.width=pct+'%';
  if(barLabel)barLabel.textContent=doneTasks+'/'+total;

  // update warning text with i18n if available
  if(warning&&typeof t==='function'){
    const warnKey='streak_warning';
    const msg=(typeof i18n!=='undefined'&&i18n[currentLang]&&i18n[currentLang][warnKey])||'⚠ Complete your tasks!';
    warning.textContent=msg;
  }
}
function updateStats(){
  const wd=Object.keys(state.completedWeeks).filter(k=>state.completedWeeks[k]).length,pct=computeProgress(),td=Object.keys(state.dailyDone).filter(k=>state.dailyDone[k]).length;
  document.getElementById('stat-weeks').textContent=wd;
  document.getElementById('stat-streak').textContent=state.streak||0;
  document.getElementById('stat-vocab').textContent=wd>=17?'1000+':wd>=9?'500+':Math.min(wd*40,300);
  document.getElementById('stat-hours').textContent=wd*10;
  document.getElementById('stat-tasks').textContent=td+'/4';
  document.getElementById('stat-days-left').textContent=Math.max(0,140-wd*7);
  document.getElementById('arc-pct').textContent=pct;
  document.getElementById('arc-circle').style.strokeDashoffset=2*Math.PI*65*(1-pct/100);
  updateStreakWidget();
  // Update weekly XP bar if available
  try{ updateWeeklyXP(); }catch(e){}
  // Update daily quote
  try{ updateDailyQuote(); }catch(e){}
}
function toggleWeek(w){
  state.completedWeeks[w] = !state.completedWeeks[w];
  showToast(state.completedWeeks[w] ? t('toast_week_done').replace('{week}', w) : t('toast_week_reset').replace('{week}', w));
  save();
  render();
  // Confetti burst when a week is completed
  if(state.completedWeeks[w]){
    try{
      if(typeof confetti === 'function') confetti({ particleCount: 60, spread: 60, origin: { y: 0.6 } });
    }catch(e){}
  }
}
function toggleTask(id){
  state.dailyDone[id]=!state.dailyDone[id];
  save();renderDaily();updateStats();
  const allTaskIds=['anki','grammar','listen','speak'];
  const allDone=allTaskIds.every(i=>state.dailyDone[i]);
  if(allDone){
    showToast('🔥 '+t('toast_all_tasks_done')+' Streak gesichert!');
    try {
      if(typeof confetti==='function') {
        confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
      }
    } catch(e) {}
  }
}
function resetAll(){if(!isAdmin()){showToast('⛔ Admin only');return;}if(!confirm(t('confirm_reset')))return;state={...state,completedWeeks:{},dailyDone:{},notes:'',streak:0,startDate:new Date().toDateString(),lastActiveDay:null,reminderNotif:!!state.reminderNotif};save();document.getElementById('notes-area').value='';render();renderNewsPage();}
function render(){renderJourney();renderMonths();renderDaily();updateStats();}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200);}

// ===== PDF (Supabase Storage + DB) =====
let pdfs=[],currentFilter='all',editingId=null,pdfDoc=null,currentPage=1,totalPages=1,docsSearchTerm='',pdfScrollHandler=null;

function storagePath(id){return currentUser.id+'/'+id+'.pdf';}

function updateDocsAccountHint(){
  const el=document.getElementById('docs-account');
  if(!el)return;
  const email=currentUser?.email||'—';
  el.textContent=`${t('docs_for_account')} ${email}`;
}
function isPhoneDocsView(){return window.matchMedia('(max-width: 767px)').matches;}
function shouldRenderDocThumbnails(){return !isPhoneDocsView();}

async function refreshDocs(){
  await loadPdfs();
  showToast(t('toast_docs_refreshed'));
}

async function loadPdfs(){
  if(!currentUser)return;
  updateDocsAccountHint();
  document.getElementById('pdf-grid').innerHTML='<div class="pdf-empty" style="grid-column:1/-1"><div class="spinner" style="margin:0 auto"></div></div>';
  try{
    const query = isAdmin()
      ? _supa.from('pdf_files').select('*').order('added_at_ts',{ascending:false})
      : _supa.from('pdf_files').select('*').eq('user_id',currentUser.id).order('added_at_ts',{ascending:false});
    const {data,error}=await query;
    if(error)throw error;
    pdfs=data||[];
  }catch(e){
    pdfs=[];
    const msg=(e&&e.message)?e.message:t('pdf_list_error');
    document.getElementById('pdf-grid').innerHTML=`<div class="pdf-empty" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><p>${t('pdf_list_error')}</p><p style="margin-top:8px;font-size:0.72rem;opacity:0.8">${msg}</p></div>`;
    showToast(t('pdf_list_error'));
  }
  updateStorageBar();
  renderPdfGrid();
}

function updateStorageBar(){
  const totalBytes=pdfs.reduce((a,p)=>a+(p.size||0),0);
  const mb=(totalBytes/1024/1024).toFixed(1);
  const fileWord=pdfs.length===1?t('storage_file_singular'):t('storage_file_plural');
  document.getElementById('storage-info').textContent=`${mb} MB · ${pdfs.length} ${fileWord} · ☁️ Supabase`;
  const pct=Math.min(100,parseFloat(mb)/500*100);
  document.getElementById('storage-fill').style.width=pct+'%';
  document.getElementById('storage-fill').style.background=pct>80?'var(--red)':pct>50?'var(--gold)':'var(--green)';
}

function handleFiles(files){
  Array.from(files).forEach(file=>{
    if(!file.type.includes('pdf')&&!file.name.endsWith('.pdf')){showToast(t('toast_only_pdf'));return;}
    if(file.size>50*1024*1024){showToast(t('toast_file_too_big'));return;}
    uploadPdf(file);
  });
}

async function uploadPdf(file){
  const id=Date.now()+'_'+Math.random().toString(36).substr(2,6);
  const name=file.name.replace(/\.pdf$/i,'');
  const path=storagePath(id);
  const meta={id,name,category:'other',size:file.size,storage_path:path,added_at:new Date().toLocaleDateString(getLocale()),added_at_ts:Date.now(),user_id:currentUser.id,uploading:true,progress:0};
  pdfs.unshift(meta);renderPdfGrid();

  try{
    const {error:storageError}=await _supa.storage.from('pdfs').upload(path,file,{contentType:'application/pdf',upsert:false});
    if(storageError)throw storageError;

    const dbMeta={id,name,category:'other',size:file.size,storage_path:path,added_at:new Date().toLocaleDateString(getLocale()),added_at_ts:Date.now(),user_id:currentUser.id};
    const {error:dbError}=await _supa.from('pdf_files').insert(dbMeta);
    if(dbError){
      await _supa.storage.from('pdfs').remove([path]);
      throw dbError;
    }

    const idx=pdfs.findIndex(p=>p.id===id);if(idx!==-1)pdfs[idx]={...dbMeta,uploading:false};
    await loadPdfs();
    showToast(t('toast_upload_success'));
    openRenameModal(id);
  }catch(e){
    pdfs=pdfs.filter(p=>p.id!==id);
    renderPdfGrid();updateStorageBar();
    showToast(t('toast_upload_error_prefix')+' '+((e&&e.message)?e.message:t('generic_error')));
  }
}

function renderPdfGrid(){
  const grid=document.getElementById('pdf-grid');
  const search=docsSearchTerm.trim().toLowerCase();
  const filtered=(currentFilter==='all'?pdfs:pdfs.filter(p=>p.category===currentFilter)).filter(p=>{
    if(!search)return true;
    const hay=[p.name||'',p.category||''].join(' ').toLowerCase();
    return hay.includes(search);
  });
  const lightMode=isPhoneDocsView();
  if(filtered.length===0){
    const email=currentUser?.email||'—';
    const emptyMsg=search?t('pdf_empty_search'):(currentFilter==='all'?t('pdf_empty_all'):t('pdf_empty_cat'));
    grid.innerHTML=`<div class="pdf-empty" style="grid-column:1/-1"><div class="empty-icon">📂</div><p>${emptyMsg}</p><p style="margin-top:8px;font-size:0.72rem;opacity:0.82">${t('docs_for_account')} ${email}</p></div>`;
    return;
  }
  const cats={
    grammar:t('cat_grammar'),
    vocabulary:t('cat_vocab'),
    exercise:t('cat_exercise'),
    exam:t('cat_exam'),
    other:t('cat_other')
  };
  const fmt=b=>b>1024*1024?(b/1024/1024).toFixed(1)+' MB':Math.round(b/1024)+' KB';
  grid.innerHTML=filtered.map(p=>`
    <div class="pdf-card" id="card-${p.id}">
      <div class="pdf-preview" onclick="${p.uploading?'':` openPdf('${p.id}')`}">
        ${p.uploading
          ?`<div class="pdf-upload-overlay"><div class="upload-progress-bar"><div class="upload-progress-fill" id="prog-fill-${p.id}" style="width:${p.progress||0}%"></div></div><div class="upload-progress-text" id="prog-txt-${p.id}">${p.progress||0}%</div></div><div class="pdf-preview-icon">⏫</div>`
          :lightMode
            ?`<div class="pdf-preview-icon" style="display:flex;opacity:0.95;flex-direction:column;gap:10px"><span style="font-size:2.4rem">📄</span><span style="font-size:0.72rem;color:var(--muted);letter-spacing:0.06em">${t('pdf_tap_open')}</span></div>`
            :`<canvas id="thumb-${p.id}"></canvas><div class="pdf-preview-icon" id="icon-${p.id}" style="display:none">📄</div>`}
      </div>
      <div class="pdf-card-body">
        <div class="pdf-cat-tag cat-${p.category}">${cats[p.category]||t('cat_other')}</div>
        <div class="pdf-card-name" title="${p.name}">${p.name}</div>
        <div class="pdf-card-meta"><span>${fmt(p.size)}</span><span>${p.added_at||''}</span>${isAdmin()&&p.user_id!==currentUser?.id?`<span style="color:var(--gold);font-size:0.58rem">👤 other user</span>`:''}</div>
      </div>
      ${p.uploading?'':`<div class="pdf-actions"><button class="pdf-action-btn" onclick="openPdf('${p.id}')">${t('pdf_view_btn')}</button>${isAdmin()||p.user_id===currentUser?.id?`<button class="pdf-action-btn" onclick="openRenameModal('${p.id}')">${t('pdf_edit_btn')}</button><button class="pdf-action-btn danger" onclick="deletePdf('${p.id}')">${t('pdf_delete_btn')}</button>`:``}</div>`}
    </div>`).join('');
  if(shouldRenderDocThumbnails()){
    filtered.filter(p=>!p.uploading).forEach(p=>generateThumbnail(p));
  }
}

async function getPdfUrl(p){
  const{data,error}=await _supa.storage.from('pdfs').createSignedUrl(p.storage_path,3600);
  if(error)throw error;
  return data?.signedUrl||null;
}

async function generateThumbnail(p){
  if(typeof pdfjsLib==='undefined'){const i=document.getElementById('icon-'+p.id);if(i)i.style.display='flex';return;}
  try{
    const url=await getPdfUrl(p);if(!url)return;
    const pdf=await pdfjsLib.getDocument({url}).promise;
    const page=await pdf.getPage(1);
    const canvas=document.getElementById('thumb-'+p.id);if(!canvas)return;
    const vp=page.getViewport({scale:0.5});canvas.width=vp.width;canvas.height=vp.height;
    await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
  }catch(e){const i=document.getElementById('icon-'+p.id);if(i)i.style.display='flex';}
}

async function openPdf(id){
  const p=pdfs.find(x=>String(x.id)===String(id));if(!p)return;
  document.getElementById('modal-title').textContent=p.name;
  document.getElementById('pdf-modal').classList.add('open');
  document.body.style.overflow='hidden';
  const body=document.getElementById('modal-body');
  body.innerHTML=`<div class="pdf-loading"><div class="spinner"></div><span style="font-size:0.8rem;color:var(--muted)">${t('loading')}</span></div>`;
  try{
    const url=await getPdfUrl(p);
    if(!url){body.innerHTML=`<div style="padding:20px;text-align:center"><p style="color:var(--muted);font-size:0.8rem">${t('pdf_missing')}</p></div>`;return;}
    if(typeof pdfjsLib==='undefined'){body.innerHTML=`<div style="padding:20px;text-align:center"><a href="${url}" target="_blank" style="color:var(--gold)">${t('pdf_open_external')}</a></div>`;return;}
    pdfDoc=await pdfjsLib.getDocument({url}).promise;
    totalPages=pdfDoc.numPages;currentPage=1;
    body.innerHTML='<div class="pdf-scroll-pages" id="pdf-scroll-pages"></div>';
    await renderPdfDocumentVertical();
  }catch(e){body.innerHTML=`<div style="padding:20px;text-align:center"><p style="color:var(--muted);font-size:0.8rem">${t('pdf_load_error')}</p></div>`;}
}

function updatePdfViewerInfo(pageNum){
  currentPage=Math.max(1,Math.min(totalPages||1,pageNum||1));
  document.getElementById('page-info').textContent=`${t('pdf_page')} ${currentPage} / ${totalPages} · ${t('pdf_vertical_hint')}`;
  document.getElementById('prev-page').disabled=currentPage<=1;
  document.getElementById('next-page').disabled=currentPage>=totalPages;
}

function removePdfScrollHandler(){
  const body=document.getElementById('modal-body');
  if(body&&pdfScrollHandler){body.removeEventListener('scroll',pdfScrollHandler);}
  pdfScrollHandler=null;
}

function bindPdfScrollHandler(){
  removePdfScrollHandler();
  const body=document.getElementById('modal-body');
  const pages=[...body.querySelectorAll('.pdf-page-sheet')];
  if(!pages.length)return;
  pdfScrollHandler=()=>{
    const bodyTop=body.getBoundingClientRect().top;
    let bestPage=1;
    let bestDist=Infinity;
    pages.forEach((el,idx)=>{
      const dist=Math.abs(el.getBoundingClientRect().top-bodyTop-12);
      if(dist<bestDist){bestDist=dist;bestPage=idx+1;}
    });
    updatePdfViewerInfo(bestPage);
  };
  body.addEventListener('scroll',pdfScrollHandler,{passive:true});
  pdfScrollHandler();
}

async function renderPdfDocumentVertical(){
  if(!pdfDoc)return;
  const wrap=document.getElementById('pdf-scroll-pages');
  if(!wrap)return;
  removePdfScrollHandler();
  wrap.innerHTML='';
  updatePdfViewerInfo(1);
  const body=document.getElementById('modal-body');
  const availableWidth=Math.max(260,Math.min((body.clientWidth||800)-40,940));
  for(let num=1;num<=totalPages;num++){
    const sheet=document.createElement('div');
    sheet.className='pdf-page-sheet';
    sheet.dataset.page=String(num);
    sheet.innerHTML=`<div class="pdf-page-label">${t('pdf_page')} ${num}</div><canvas></canvas>`;
    wrap.appendChild(sheet);

    try{
      const page=await pdfDoc.getPage(num);
      const canvas=sheet.querySelector('canvas');
      const vp=page.getViewport({scale:1});
      const scale=Math.min(availableWidth/vp.width,2.2);
      const sv=page.getViewport({scale});
      const dpr=Math.min(window.devicePixelRatio||1,2);
      const ctx=canvas.getContext('2d');
      canvas.style.width=sv.width+'px';
      canvas.style.height=sv.height+'px';
      canvas.width=Math.floor(sv.width*dpr);
      canvas.height=Math.floor(sv.height*dpr);
      ctx.setTransform(dpr,0,0,dpr,0,0);
      await page.render({canvasContext:ctx,viewport:sv}).promise;
    }catch(e){
      sheet.insertAdjacentHTML('beforeend',`<div style="padding:10px 0 0;color:var(--muted);font-size:0.75rem">${t('pdf_load_error')}</div>`);
    }
  }
  requestAnimationFrame(()=>{
    body.scrollTop=0;
    bindPdfScrollHandler();
    updatePdfViewerInfo(1);
  });
}

async function renderPdfPage(num){
  await renderPdfDocumentVertical();
  const target=document.querySelector(`.pdf-page-sheet[data-page="${Math.max(1,Math.min(totalPages||1,num||1))}"]`);
  if(target)target.scrollIntoView({behavior:'auto',block:'start'});
  updatePdfViewerInfo(num||1);
}

async function changePage(delta){
  const n=currentPage+delta;if(n<1||n>totalPages)return;
  const target=document.querySelector(`.pdf-page-sheet[data-page="${n}"]`);
  if(target){target.scrollIntoView({behavior:'smooth',block:'start'});}
  updatePdfViewerInfo(n);
}
function closePdfModal(){document.getElementById('pdf-modal').classList.remove('open');document.body.style.overflow='';removePdfScrollHandler();pdfDoc=null;}

async function deletePdf(id){
  if(!confirm(t('confirm_delete_pdf')))return;
  try{
    const p=pdfs.find(x=>String(x.id)===String(id));
    if(p?.storage_path){
      const {error:storageError}=await _supa.storage.from('pdfs').remove([p.storage_path]);
      if(storageError)throw storageError;
    }
    const {error:dbError}=await _supa.from('pdf_files').delete().eq('id',id).eq('user_id',currentUser.id);
    if(dbError)throw dbError;
    pdfs=pdfs.filter(p=>String(p.id)!==String(id));
    await loadPdfs();
    showToast(t('toast_deleted'));
  }catch(e){showToast(t('toast_delete_error')+' '+((e&&e.message)?e.message:''));}
}

function openRenameModal(id){
  const p=pdfs.find(x=>String(x.id)===String(id));if(!p)return;
  editingId=id;document.getElementById('rename-input').value=p.name;document.getElementById('rename-cat').value=p.category||'other';document.getElementById('rename-modal').classList.add('open');
}
function closeRenameModal(){document.getElementById('rename-modal').classList.remove('open');editingId=null;}
async function confirmRename(){
  if(!editingId)return;
  const p=pdfs.find(x=>String(x.id)===String(editingId));if(!p)return;
  const name=document.getElementById('rename-input').value.trim();const cat=document.getElementById('rename-cat').value;
  if(name)p.name=name;p.category=cat;
  try{
    const {error}=await _supa.from('pdf_files').update({name:p.name,category:p.category}).eq('id',p.id).eq('user_id',currentUser.id);
    if(error)throw error;
    await loadPdfs();
    closeRenameModal();
    showToast(t('toast_saved'));
  }catch(e){showToast(t('toast_save_error')+' '+((e&&e.message)?e.message:''));}
}

// ===== NAVIGATION =====
function switchPage(page){
  // Role guard: users can only access allowed pages
  // Ensure any running quiz timer is cleared when navigating
  if(typeof resetQuizTimer === 'function') resetQuizTimer();
  if(!isAdmin() && !USER_PAGES.includes(page)){
    showToast('⛔ Access restricted');
    return;
  }
  const target=document.getElementById('page-'+page);
  if(!target)return;

  activeAppPage=page;
  try{localStorage.setItem('active_app_page',page);}catch(e){}

  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  target.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===page));
  document.querySelectorAll('.desk-nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===page));

  try{
    if(page==='translate') initTranslatePage();
    if(page==='news') initNewsPage();
    if(page==='pdf') loadPdfs();
    if(page==='admin') loadAdminPage();
    if(page==='quiz') initQuizPage();
    if(page==='level') initLevelPage();
      if(page==='vocab') initVocabPage();
      if(page==='listening') initListeningPage();
      if(page==='tracker') { updateDailyQuote(); updateWeeklyXP(); }
  }catch(err){
    console.error('Page init error for', page, err);
  }

  window.scrollTo(0,0);
  updateNavCurrentIndicator(page);
  if(typeof updateNavTabs==='function') updateNavTabs(page);
  // Scroll active nav item into view in the scrollable bottom nav
  try{
    const track=document.getElementById('bottom-nav-track');
    const activeItem=track&&track.querySelector('.nav-item.active');
    if(activeItem&&track){
      const itemLeft=activeItem.offsetLeft;
      const itemWidth=activeItem.offsetWidth;
      const trackWidth=track.clientWidth;
      const scrollTarget=itemLeft-(trackWidth/2)+(itemWidth/2);
      track.scrollTo({left:Math.max(0,scrollTarget),behavior:'smooth'});
    }
    updateNavScrollFade();
  }catch(e){}
}

function bindNavigationControls(){
  document.querySelectorAll('.desk-nav-item[data-page], .nav-item[data-page]').forEach(item=>{
    const page=item.dataset.page;
    if(!page)return;

    item.style.cursor='pointer';
    item.setAttribute('role', item.tagName==='BUTTON' ? item.getAttribute('role') || 'button' : 'button');
    if(!item.hasAttribute('tabindex') && item.tagName!=='BUTTON') item.setAttribute('tabindex','0');

    item.onclick=(e)=>{
      if(e){
        e.preventDefault();
        e.stopPropagation();
      }
      switchPage(page);
    };

    item.onkeydown=(e)=>{
      if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        switchPage(page);
      }
    };
  });
}

// ===== INIT =====
async function initApp(){
  try{
    const savedPage=localStorage.getItem('active_app_page');
    if(savedPage==='tracker'||savedPage==='pdf'||savedPage==='translate'||savedPage==='news')activeAppPage=savedPage;
  }catch(e){}

  const notesEl=document.getElementById('notes-area');
  notesEl.value=state.notes||'';

  if(!_staticUiBound){
    _staticUiBound=true;
    notesEl.addEventListener('input',()=>{state.notes=notesEl.value;save();});
    document.getElementById('pdf-input').addEventListener('change',e=>handleFiles(e.target.files));
    const zone=document.getElementById('upload-zone');
    zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
    zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
    zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');handleFiles(e.dataTransfer.files);});
    document.querySelectorAll('.cat-btn').forEach(btn=>btn.addEventListener('click',()=>{
      currentFilter=btn.dataset.cat;
      document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      renderPdfGrid();
      updateStorageBar();
    }));
    bindNavigationControls();
    document.getElementById('rename-modal').addEventListener('click',e=>{if(e.target===document.getElementById('rename-modal'))closeRenameModal();});
    const docsSearchEl=document.getElementById('docs-search');
    if(docsSearchEl){
      docsSearchEl.addEventListener('input',()=>{docsSearchTerm=docsSearchEl.value;renderPdfGrid();});
      docsSearchEl.addEventListener('search',()=>{docsSearchTerm=docsSearchEl.value;renderPdfGrid();}); // handles clear button on mobile
    }
    document.getElementById('rename-input').addEventListener('keydown',e=>{if(e.key==='Enter')confirmRename();if(e.key==='Escape')closeRenameModal();});
  scheduleMidnightReset();
    document.getElementById('auth-password').addEventListener('keydown',e=>{if(e.key==='Enter')handleAuth();});
  }

  updateTodayLabel();
  render();
  renderNewsPage();
  updateStorageBar();
  updateDocsAccountHint();
  loadPdfs().catch(()=>{});

  const stateLoad=loadState()
    .then(()=>{
      resetDailyIfNewDay();
      notesEl.value=state.notes||'';
      updateTodayLabel();
      render();
      renderNewsPage();
      updateStorageBar();
    })
    .catch(err=>{
      console.error('State load error:', err);
      updateTodayLabel();
      render();
      renderNewsPage();
      updateStorageBar();
    });

  await Promise.race([stateLoad, wait(6000)]);
  applyRoleUI();

  // Initialise quiz history and suggestions UI once state and role are ready
  try{
    if(typeof updateQuizHistoryUI === 'function') updateQuizHistoryUI();
    if(typeof suggestNextTasks === 'function') suggestNextTasks();
  }catch(e){ console.warn('Init analytics error', e); }
}


// ===== NAV DRAWER =====
var _drawerOpen = false;

// Page metadata for the current indicator
var PAGE_META = {
  tracker:   { label: 'Tracker',    icon: '<svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24" width="20"><rect height="18" rx="2" width="18" x="3" y="3"/><path d="M7 16V12M12 16V8M17 16v-4"/></svg>' },
  pdf:       { label: 'Dokumente',  icon: '<svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24" width="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" x2="15" y1="13" y2="13"/><line x1="9" x2="15" y1="17" y2="17"/></svg>' },
  news:      { label: 'News',       icon: '<svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24" width="20"><path d="M4 4h16v16H4z"/><path d="M4 9h16M9 4v16"/></svg>' },
  translate: { label: 'Übersetzer', icon: '<svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24" width="20"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' },
  quiz:      { label: 'Quiz',       icon: '<svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24" width="20"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>' },
  vocab:     { label: 'Vokabeln',   icon: '📚' },
  listening: { label: 'Hören',      icon: '🎧' },
  level:     { label: 'Niveau',     icon: '<svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" viewBox="0 0 24 24" width="20"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>' },
  admin:     { label: 'Admin',      icon: '👑' },
};

function updateNavCurrentIndicator(page){
  var meta = PAGE_META[page] || { label: page, icon: '●' };
  var iconEl = document.getElementById('nav-current-icon');
  var labelEl = document.getElementById('nav-current-label');
  if(iconEl) iconEl.innerHTML = meta.icon;
  if(labelEl) labelEl.textContent = meta.label;
  // update active state in drawer
  document.querySelectorAll('.nav-drawer-item[data-page]').forEach(function(el){
    el.classList.toggle('active', el.dataset.page === page);
  });
}

function openNavDrawer(){
  _drawerOpen = true;
  document.getElementById('nav-drawer').classList.add('open');
  document.getElementById('nav-drawer-overlay').classList.add('open');
  var moreBtn=document.getElementById('nav-more-btn');
  if(moreBtn){moreBtn.classList.add('open');moreBtn.classList.remove('active');}
}
function closeNavDrawer(){
  _drawerOpen = false;
  document.getElementById('nav-drawer').classList.remove('open');
  document.getElementById('nav-drawer-overlay').classList.remove('open');
  var moreBtn=document.getElementById('nav-more-btn');
  if(moreBtn) moreBtn.classList.remove('open');
}
function toggleNavDrawer(){
  if(_drawerOpen) closeNavDrawer(); else openNavDrawer();
}
function drawerNav(page){
  closeNavDrawer();
  switchPage(page);
}
function navTabClick(page,btn){
  closeNavDrawer();
  switchPage(page);
}
function updateNavTabs(page){
  var pinnedPages=['tracker','pdf','translate'];
  document.querySelectorAll('#bottom-nav .nav-tab[data-page]').forEach(function(tab){
    tab.classList.toggle('active', tab.dataset.page===page);
  });
  var moreBtn=document.getElementById('nav-more-btn');
  if(moreBtn) moreBtn.classList.toggle('active', !pinnedPages.includes(page));
  document.querySelectorAll('.nav-drawer-item[data-page]').forEach(function(item){
    item.classList.toggle('active', item.dataset.page===page);
  });
}

// Swipe-down to close drawer
(function(){
  var startY = 0;
  var drawer = null;
  document.addEventListener('touchstart', function(e){
    drawer = document.getElementById('nav-drawer');
    if(drawer && drawer.classList.contains('open')){
      startY = e.touches[0].clientY;
    }
  }, {passive:true});
  document.addEventListener('touchend', function(e){
    if(!drawer || !drawer.classList.contains('open')) return;
    var endY = e.changedTouches[0].clientY;
    if(endY - startY > 60) closeNavDrawer();
  }, {passive:true});
})();

if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));

// ===== PROFILE MODAL =====
function openProfileModal(){
  document.getElementById('profile-msg').className='profile-msg';
  document.getElementById('profile-pwd1').value='';
  document.getElementById('profile-pwd2').value='';
  // Close avatar picker if open
  const picker=document.getElementById('avatar-emoji-picker');
  if(picker) picker.classList.remove('open');
  // Refresh stats chips
  updateProfileStats();
  document.getElementById('profile-modal').classList.add('open');
  document.body.style.overflow='hidden';
  applyProfileLang();
  updateNotifToggleUI();
  applyRoleUI();
  if(isAdmin()) adminLoadUsers();
}
function closeProfileModal(){
  document.getElementById('profile-modal').classList.remove('open');
  document.body.style.overflow='';
}
function handleProfileOverlayClick(e){
  if(e.target===document.getElementById('profile-modal'))closeProfileModal();
}
function applyProfileLang(){
  const L=i18n[currentLang]||i18n.de;
  const lbl_e=document.getElementById('lbl-email');if(lbl_e)lbl_e.textContent=L.label_email||'Email';
  const lbl_p=document.getElementById('lbl-new-pwd');if(lbl_p)lbl_p.textContent=L.lbl_new_pwd||'New password';
  const lbl_c=document.getElementById('lbl-confirm-pwd');if(lbl_c)lbl_c.textContent=L.lbl_confirm_pwd||'Confirm password';
  const sb=document.getElementById('profile-save-btn');if(sb)sb.textContent=L.profile_save||'💾 Save changes';
  const lb=document.querySelector('#profile-modal .profile-btn.danger');if(lb)lb.textContent=L.profile_logout||'↩ Log out';
  const rl=document.getElementById('lbl-reminder');if(rl)rl.textContent=L.lbl_reminder||'🔔 Streak reminder';
  const rs=document.getElementById('lbl-reminder-sub');if(rs)rs.textContent=L.lbl_reminder_sub||'Notify me 2h before midnight if tasks aren\'t done';
  updateNotifToggleUI();
}
async function saveProfileChanges(){
  const pwd1=document.getElementById('profile-pwd1').value;
  const pwd2=document.getElementById('profile-pwd2').value;
  const nameInput=document.getElementById('profile-name-input');
  const newName=(nameInput&&nameInput.value.trim())||'';
  const msg=document.getElementById('profile-msg');
  const btn=document.getElementById('profile-save-btn');
  msg.className='profile-msg';
  const L=i18n[currentLang]||i18n.de;

  // Save display name locally
  if(newName){
    localStorage.setItem('profile_display_name',newName);
    if(currentUser) showUserBadge(currentUser);
  }

  // If no password change, just save name
  if(!pwd1&&!pwd2){
    if(newName){msg.textContent='✓ Profile updated!';msg.className='profile-msg success';}
    else{msg.textContent=L.profile_no_change||'Enter a new password to update.';msg.className='profile-msg error';}
    return;
  }
  if(pwd1!==pwd2){msg.textContent=L.profile_pwd_mismatch||'Passwords do not match.';msg.className='profile-msg error';return;}
  if(pwd1.length<6){msg.textContent=L.profile_pwd_short||'Password too short (min 6 chars).';msg.className='profile-msg error';return;}
  btn.disabled=true;btn.textContent='...';
  try{
    const{error}=await _supa.auth.updateUser({password:pwd1});
    if(error)throw error;
    msg.textContent=L.profile_saved||'✓ Password updated!';msg.className='profile-msg success';
    document.getElementById('profile-pwd1').value='';document.getElementById('profile-pwd2').value='';
  }catch(e){msg.textContent=e.message;msg.className='profile-msg error';}
  btn.disabled=false;btn.textContent=L.profile_save||'💾 Save changes';
}

// ===== i18n =====
const i18n={
  de:{
    app_title:'Mein Ziel: Deutsch B1',
    loader_connecting:'Verbindung...',
    nav_tracker:'Tracker',
    nav_docs:'Dokumente',
    nav_news:'News',

    login_title_1:'Mein Ziel:',
    login_title_2:'Deutsch B1',
    login_sub:'5-Monats-Lernplan · Von Null zu B1',
    tab_login:'Anmelden',
    tab_register:'Registrieren',
    label_email:'E‑Mail',
    label_pwd:'Passwort',
    label_confirm:'Passwort bestätigen',
    placeholder_email:'beispiel@gmail.com',
    placeholder_pwd:'••••••••',
    btn_login:'Anmelden',
    btn_register:'Konto erstellen',
    logout:'Abmelden',
    logout_mob:'↩',
    reset_btn:'↺ Zurücksetzen',
    h1_1:'Mein Ziel:',
    h1_2:'Deutsch B1',
    h1_sub:'5-Monats-Lernplan · Von Null zu B1',
    badge:'B1‑Niveau',
    progress_label:'Fortschritt',
    lbl_weeks:'Wochen',
    lbl_streak:'🔥 Streak',
    lbl_vocab:'Vokabeln',
    lbl_hours:'Stunden',
    lbl_today:'Heute',
    lbl_days:'Tage noch',
    section_journey:'5‑Monate Reise',
    section_daily:'Tägliche Aufgaben',
    section_notes:'Notizen',
    notes_placeholder:'Schreib hier deine Gedanken auf Deutsch...',
    pdf_title:'Meine Dokumente',
    storage_label:'💾 Lokal',
    storage_loading:'Lädt...',
    storage_file_singular:'Datei',
    storage_file_plural:'Dateien',
    docs_for_account:'Dokumente für:',
    docs_refresh_btn:'↻ Synchronisieren',
    toast_docs_refreshed:'↻ Dokumente synchronisiert',
    pdf_search_placeholder:'Dokument suchen...',
    pdf_empty_search:'Keine Dokumente passen zu deiner Suche.',
    pdf_vertical_hint:'vertikal scrollen',
    upload_title:'PDF hochladen',
    upload_sub:'Lokal gespeichert · Offline verfügbar · Max 200 MB pro Datei',
    cat_all:'Alle',
    cat_grammar:'📘 Grammatik',
    cat_vocab:'📚 Vokabeln',
    cat_exercise:'✏️ Übungen',
    cat_exam:'📝 Prüfung',
    cat_other:'📄 Sonstiges',
    pdf_empty_all:'Noch keine Dokumente. Lade dein erstes PDF hoch!',
    pdf_empty_cat:'Keine Dokumente in dieser Kategorie.',
    pdf_view_btn:'👁 Öffnen',
    pdf_edit_btn:'✏️ Bearbeiten',
    pdf_delete_btn:'🗑 Löschen',
    pdf_page:'Seite',
    pdf_missing:'Datei nicht gefunden.',
    pdf_open_external:'📥 PDF öffnen',
    pdf_load_error:'Fehler beim Laden.',
    loading:'Lädt...',
    week_label:'Woche',
    streak_days:'Tage',
    streak_warning:'⚠ Erledige deine Aufgaben!',
    nav_translate:'Übersetzer',
    lang_arabic:'Arabisch',
    lang_english:'Englisch',
    copy_btn:'Kopieren',
    copy_done:'Kopiert!',
    translate_empty:'Gib ein deutsches, englisches oder arabisches Wort oder einen Satz ein',
    translate_error:'Übersetzung fehlgeschlagen. Bitte erneut versuchen.',
    translate_no_history:'Deine Übersetzungen erscheinen hier',
    translate_page_title:'Übersetzer',
    translate_page_sub:'Deutsch, Englisch & Arabisch',
    translate_btn_label:'Übersetzen',
    translate_speak:'Anhören',
    translate_history_label:'Verlauf',
    translate_history_clear:'Löschen',
    news_page_title:'Artikel & News',
    news_page_sub:'Eigene Artikel und Updates veröffentlichen',
    news_title_label:'Titel',
    news_type_label:'Typ',
    news_summary_label:'Kurzbeschreibung',
    news_body_label:'Inhalt',
    news_title_placeholder:'Titel deines Beitrags...',
    news_summary_placeholder:'Kurze Zusammenfassung...',
    news_body_placeholder:'Schreibe hier deinen Artikel oder deine News...',
    news_publish_btn:'Veröffentlichen',
    news_update_btn:'Aktualisieren',
    news_cancel_btn:'Abbrechen',
    news_feed_title:'Veröffentlichte Beiträge',
    news_filter_all:'Alle',
    news_filter_article:'Artikel',
    news_filter_news:'News',
    news_badge_article:'Artikel',
    news_badge_news:'News',
    news_edit_btn:'Bearbeiten',
    news_delete_btn:'Löschen',
    news_empty:'Noch keine Beiträge. Veröffentliche deinen ersten Artikel oder eine News.',
    news_delete_confirm:'Diesen Beitrag löschen?',
    news_toast_published:'📰 Beitrag veröffentlicht',
    news_toast_updated:'✏️ Beitrag aktualisiert',
    news_toast_deleted:'🗑 Beitrag gelöscht',
    news_validation_title:'Bitte gib einen Titel ein',
    news_validation_body:'Bitte schreibe den Inhalt deines Beitrags',
    news_editing_hint:'Du bearbeitest gerade einen bestehenden Beitrag.',
    notif_title:'Streak in Gefahr!',
    notif_body_streak:'Du hast noch 2 Stunden, um deinen {streak}-Tage-Streak zu retten!',
    notif_body_no_streak:'Erledige deine täglichen Aufgaben vor Mitternacht!',
    notif_unsupported:'⚠ Benachrichtigungen werden in diesem Browser nicht unterstützt',
    notif_blocked:'🚫 Benachrichtigungen blockiert — bitte in den Browser-Einstellungen aktivieren',
    notif_active:'✓ Du wirst um 22:00 erinnert, wenn die Aufgaben nicht erledigt sind',
    lbl_reminder:'🔔 Streak-Erinnerung',
    lbl_reminder_sub:'2 Stunden vor Mitternacht erinnern, wenn Aufgaben nicht erledigt',
    confirm_logout:'Abmelden?',
    confirm_reset:'Alles zurücksetzen?',
    confirm_delete_pdf:'PDF löschen?',
    lbl_new_pwd:'Neues Passwort',
    lbl_confirm_pwd:'Passwort bestätigen',
    profile_save:'💾 Änderungen speichern',
    profile_logout:'↩ Abmelden',
    profile_no_change:'Gib ein neues Passwort ein.',
    profile_pwd_mismatch:'Passwörter stimmen nicht überein.',
    profile_pwd_short:'Passwort zu kurz (min 6 Zeichen).',
    profile_saved:'✓ Passwort aktualisiert!',
    confirm_title:'Bestätige deine E‑Mail',
    confirm_text:'Wir haben dir eine Bestätigungs‑E‑Mail geschickt. Klicke auf den Link, um dein Konto zu aktivieren. Sobald bestätigt, komm zurück und melde dich an.',
    confirm_btn:'Zurück zur Anmeldung',
    confirm_success:'✓ Deine E‑Mail wurde bestätigt! Du kannst dich jetzt anmelden.',
    error_fill_all:'Bitte fülle alle Felder aus.',
    error_pwd_match:'Die Passwörter stimmen nicht überein.',
    error_pwd_short:'Passwort zu kurz (min. 6 Zeichen).',
        error_too_many:'Zu viele Bestätigungs-E-Mails wurden gerade gesendet. Versuche es später erneut oder erhöhe in Supabase Auth die E-Mail-/Rate-Limits bzw. nutze ein eigenes SMTP.',
    error_email_provider_restricted:'Die Standard-E-Mail-Zustellung von Supabase ist eingeschränkt. Nutze ein eigenes SMTP oder autorisierte Empfänger im Projekt.',
    error_invalid_login:'E‑Mail oder Passwort ist inkorrekt.',
    error_user_exists:'Diese E‑Mail wird bereits verwendet.',
    error_not_confirmed:'Prüfe deine E‑Mail, um dein Konto zu bestätigen.',
    toast_week_done:'✓ Woche {week} abgeschlossen!',
    toast_week_reset:'Woche {week} zurückgesetzt',
    toast_all_tasks_done:'🔥 Alle Aufgaben heute erledigt!',
    toast_correct_answer:'✓ Richtig!',
    toast_wrong_answer:'✗ Falsch',
    toast_deleted:'🗑 Gelöscht',
    toast_delete_error:'⚠️ Fehler beim Löschen',
    toast_saved:'✓ Gespeichert',
    toast_save_error:'⚠️ Speicherfehler',
    toast_upload_success:'✓ PDF gespeichert!',
    toast_upload_error_prefix:'⚠️ Upload fehlgeschlagen:',
    pdf_list_error:'Dokumente konnten nicht geladen werden.',
    generic_error:'Unbekannter Fehler',
    toast_only_pdf:'⚠️ Nur PDF-Dateien erlaubt',
    toast_file_too_big:'⚠️ Datei zu groß (max 50 MB)',
    vocab_title:'Vokabeltrainer',
    vocab_known_btn:'✓ Kenne ich',
    vocab_again_btn:'✗ Nochmal',
    vocab_filter_all:'Alle Kategorien',
    vocab_filter_noun:'Nomen',
    vocab_filter_verb:'Verben',
    vocab_filter_adjective:'Adjektive',
    vocab_filter_phrase:'Phrasen',
    vocab_finished:'🎉 Fertig!',
    speaking_title:'Sprechübung',
    speaking_btn:'🎤 Sprechen',
    stats_section_title:'Statistiken',
    suggest_section_title:'Empfehlungen',
    speech_not_supported:'Spracherkennung wird nicht unterstützt.',
    listening_title:'Hörverständnis',
    listening_audio_btn:'▶ Audio',
    listening_show_btn:'👁 Übersetzung',
    listening_input_ph:'Tippe, was du gehört hast...',
    listening_submit_btn:'✓ Überprüfen',
    listening_score_label:'Richtige Antworten:',
    listening_speed_slow:'🐢 Langsam',
    listening_speed_normal:'⚖ Normal',
    listening_speed_fast:'🐇 Schnell',
    pdf_tap_open:'Tippen zum Öffnen'
  },
  en:{
    app_title:'My Goal: German B1',
    loader_connecting:'Connecting...',
    nav_tracker:'Tracker',
    nav_docs:'Documents',
    nav_news:'News',

    login_title_1:'My Goal:',
    login_title_2:'German B1',
    login_sub:'5-Month Study Plan · From Zero to B1',
    tab_login:'Log in',
    tab_register:'Register',
    label_email:'Email',
    label_pwd:'Password',
    label_confirm:'Confirm password',
    placeholder_email:'example@gmail.com',
    placeholder_pwd:'••••••••',
    btn_login:'Log in',
    btn_register:'Create account',
    logout:'Log out',
    logout_mob:'↩',
    reset_btn:'↺ Reset',
    h1_1:'My Goal:',
    h1_2:'German B1',
    h1_sub:'5-Month Study Plan · From Zero to B1',
    badge:'B1 LEVEL',
    progress_label:'Progress',
    lbl_weeks:'Weeks',
    lbl_streak:'🔥 Streak',
    lbl_vocab:'Vocabulary',
    lbl_hours:'Hours',
    lbl_today:'Today',
    lbl_days:'Days left',
    section_journey:'5-Month Journey',
    section_daily:'Daily Tasks',
    section_notes:'Notes',
    notes_placeholder:'Write your thoughts in German...',
    pdf_title:'My Documents',
    // Use "Local" instead of "Cloud" since files are stored offline for the user.
    storage_label:'💾 Local',
    storage_loading:'Loading...',
    storage_file_singular:'file',
    storage_file_plural:'files',
    docs_for_account:'Documents for:',
    docs_refresh_btn:'↻ Sync',
    toast_docs_refreshed:'↻ Documents synced',
    pdf_search_placeholder:'Search documents...',
    pdf_empty_search:'No documents match your search.',
    pdf_vertical_hint:'scroll vertically',
    upload_title:'Upload PDF',
    // Clarify that files are stored locally and available offline
    upload_sub:'Stored locally · Available offline · Max 200 MB per file',
    cat_all:'All',
    cat_grammar:'📘 Grammar',
    cat_vocab:'📚 Vocabulary',
    cat_exercise:'✏️ Exercises',
    cat_exam:'📝 Exam',
    cat_other:'📄 Other',
    pdf_empty_all:'No documents yet. Upload your first PDF!',
    pdf_empty_cat:'No documents in this category.',
    pdf_view_btn:'👁 Open',
    pdf_edit_btn:'✏️ Edit',
    pdf_delete_btn:'🗑 Delete',
    pdf_page:'Page',
    pdf_missing:'File not found.',
    pdf_open_external:'📥 Open PDF',
    pdf_load_error:'Failed to load the PDF.',
    loading:'Loading...',
    week_label:'Week',
    streak_days:'Days',
    streak_warning:'⚠ Complete your tasks!',
    nav_translate:'Translator',
    lang_arabic:'Arabic',
    lang_english:'English',
    copy_btn:'Copy',
    copy_done:'Copied!',
    translate_empty:'Enter a word or sentence in German, English or Arabic',
    translate_error:'Translation failed. Please try again.',
    translate_no_history:'Your translations will appear here',
    translate_page_title:'Translator',
    translate_page_sub:'German, English & Arabic',
    translate_btn_label:'Translate',
    translate_speak:'Listen',
    translate_history_label:'History',
    translate_history_clear:'Clear',
    news_page_title:'Articles & News',
    news_page_sub:'Publish your own articles and updates',
    news_title_label:'Title',
    news_type_label:'Type',
    news_summary_label:'Summary',
    news_body_label:'Content',
    news_title_placeholder:'Post title...',
    news_summary_placeholder:'Short summary...',
    news_body_placeholder:'Write your article or news here...',
    news_publish_btn:'Publish',
    news_update_btn:'Update',
    news_cancel_btn:'Cancel',
    news_feed_title:'Published posts',
    news_filter_all:'All',
    news_filter_article:'Article',
    news_filter_news:'News',
    news_badge_article:'Article',
    news_badge_news:'News',
    news_edit_btn:'Edit',
    news_delete_btn:'Delete',
    news_empty:'No posts yet. Publish your first article or news update.',
    news_delete_confirm:'Delete this post?',
    news_toast_published:'📰 Post published',
    news_toast_updated:'✏️ Post updated',
    news_toast_deleted:'🗑 Post deleted',
    news_validation_title:'Please enter a title',
    news_validation_body:'Please write the content of your post',
    news_editing_hint:'You are editing an existing post.',
    notif_title:'Streak at risk!',
    notif_body_streak:'You have 2 hours left to protect your {streak}-day streak!',
    notif_body_no_streak:'Complete your daily tasks before midnight!',
    notif_unsupported:'⚠ Notifications not supported in this browser',
    notif_blocked:'🚫 Notifications blocked — enable them in browser settings',
    notif_active:'✓ You will be reminded at 22:00 if tasks aren\'t done',
    lbl_reminder:'🔔 Streak reminder',
    lbl_reminder_sub:'Notify me 2h before midnight if tasks aren\'t done',
    confirm_logout:'Log out?',
    confirm_reset:'Reset all progress?',
    confirm_delete_pdf:'Delete PDF?',
    lbl_new_pwd:'New password',
    lbl_confirm_pwd:'Confirm password',
    profile_save:'💾 Save changes',
    profile_logout:'↩ Log out',
    profile_no_change:'Enter a new password to update.',
    profile_pwd_mismatch:'Passwords do not match.',
    profile_pwd_short:'Password too short (min 6 chars).',
    profile_saved:'✓ Password updated!',
    confirm_title:'Confirm your email',
    confirm_text:'We sent you a confirmation email. Click the link in that email to activate your account. Once confirmed, come back and log in.',
    confirm_btn:'Back to login',
    confirm_success:'✓ Your email has been confirmed! You can now log in.',
    error_fill_all:'Please fill in all fields.',
    error_pwd_match:'Passwords do not match.',
    error_pwd_short:'Password too short (min. 6 chars).',
        error_too_many:'Too many confirmation emails were sent recently. Try again later, or increase the Supabase Auth email/rate limits or use custom SMTP.',
    error_email_provider_restricted:'Supabase default email delivery is restricted. Use custom SMTP or authorized recipient addresses for this project.',
    error_invalid_login:'Email or password is incorrect.',
    error_user_exists:'This email is already in use.',
    error_not_confirmed:'Check your email to confirm your account.',
    toast_week_done:'✓ Week {week} completed!',
    toast_week_reset:'Week {week} reset',
    toast_all_tasks_done:'🔥 All tasks completed today!',
    toast_correct_answer:'✓ Correct!',
    toast_wrong_answer:'✗ Wrong',
    toast_deleted:'🗑 Deleted',
    toast_delete_error:'⚠️ Delete failed',
    toast_saved:'✓ Saved',
    toast_save_error:'⚠️ Save failed',
    toast_upload_success:'✓ PDF saved!',
    toast_upload_error_prefix:'⚠️ Upload failed:',
    pdf_list_error:'Could not load documents.',
    generic_error:'Unknown error',
    toast_only_pdf:'⚠️ Only PDF files are allowed',
    toast_file_too_big:'⚠️ File is too large (max 50 MB)',
    vocab_title:'Vocabulary Trainer',
    vocab_known_btn:'✓ Know it',
    vocab_again_btn:'✗ Again',
    vocab_filter_all:'All categories',
    vocab_filter_noun:'Nouns',
    vocab_filter_verb:'Verbs',
    vocab_filter_adjective:'Adjectives',
    vocab_filter_phrase:'Phrases',
    vocab_finished:'🎉 Finished!',
    speaking_title:'Speaking Practice',
    speaking_btn:'🎤 Speak',
    stats_section_title:'Statistics',
    suggest_section_title:'Suggestions',
    speech_not_supported:'Speech recognition is not supported.',
    listening_title:'Listening Practice',
    listening_audio_btn:'▶ Play Audio',
    listening_show_btn:'👁 Show translation',
    listening_input_ph:'Type what you heard...',
    listening_submit_btn:'✓ Check',
    listening_score_label:'Correct answers:',
    listening_speed_slow:'🐢 Slow',
    listening_speed_normal:'⚖ Normal',
    listening_speed_fast:'🐇 Fast',
    pdf_tap_open:'Tap to open'
  },
  ar:{
    app_title:'هدفي: الألمانية B1',
    loader_connecting:'جارٍ الاتصال...',
    nav_tracker:'المتتبع',
    nav_docs:'الوثائق',
    nav_news:'الأخبار',
    login_title_1:'هدفي:',
    login_title_2:'الألمانية B1',
    login_sub:'خطة دراسة 5 أشهر · من الصفر إلى B1',
    tab_login:'تسجيل الدخول',
    tab_register:'تسجيل',
    label_email:'البريد الإلكتروني',
    label_pwd:'كلمة المرور',
    label_confirm:'تأكيد كلمة المرور',
    placeholder_email:'example@gmail.com',
    placeholder_pwd:'••••••••',
    btn_login:'تسجيل الدخول',
    btn_register:'إنشاء حساب',
    logout:'تسجيل الخروج',
    logout_mob:'↩',
    reset_btn:'↺ إعادة تعيين',
    h1_1:'هدفي:',
    h1_2:'الألمانية B1',
    h1_sub:'خطة دراسة 5 أشهر · من الصفر إلى B1',
    badge:'مستوى B1',
    progress_label:'التقدم',
    lbl_weeks:'أسابيع',
    // Use a more descriptive term for the daily streak of achievements
    lbl_streak:'🔥 سلسلة الإنجازات',
    lbl_vocab:'المفردات',
    lbl_hours:'ساعات',
    lbl_today:'اليوم',
    lbl_days:'أيام متبقية',
    section_journey:'رحلة 5 أشهر',
    section_daily:'المهام اليومية',
    section_notes:'ملاحظات',
    notes_placeholder:'اكتب أفكارك بالألمانية...',
    pdf_title:'وثائقي',
    storage_label:'💾 محلي',
    storage_loading:'جارٍ التحميل...',
    storage_file_singular:'ملف',
    storage_file_plural:'ملفات',
    docs_for_account:'الوثائق لـ:',
    docs_refresh_btn:'↻ مزامنة',
    toast_docs_refreshed:'↻ تمت المزامنة',
    pdf_search_placeholder:'البحث في الوثائق...',
    pdf_empty_search:'لا توجد وثائق مطابقة.',
    // Use an imperative verb for scrolling guidance
    pdf_vertical_hint:'مرر عموديًا',
    upload_title:'رفع PDF',
    // Clarify local storage and offline availability
    upload_sub:'مخزن محليًا · متاح دون اتصال · الحد الأقصى 200 ميجا لكل ملف',
    cat_all:'الكل',
    cat_grammar:'📘 قواعد',
    cat_vocab:'📚 مفردات',
    cat_exercise:'✏️ تمارين',
    cat_exam:'📝 امتحان',
    cat_other:'📄 أخرى',
    // Encourage the user to upload their first file now
    pdf_empty_all:'لا توجد وثائق بعد. ارفع أول ملف PDF الآن!',
    pdf_empty_cat:'لا توجد وثائق في هذه الفئة.',
    pdf_view_btn:'👁 فتح',
    pdf_edit_btn:'✏️ تعديل',
    pdf_delete_btn:'🗑 حذف',
    pdf_page:'صفحة',
    pdf_missing:'الملف غير موجود.',
    pdf_open_external:'📥 فتح PDF',
    pdf_load_error:'فشل تحميل الملف.',
    loading:'جارٍ التحميل...',
    week_label:'أسبوع',
    streak_days:'أيام',
    streak_warning:'⚠ أكمل مهامك!',
    nav_translate:'المترجم',
    lang_arabic:'العربية',
    lang_english:'الإنجليزية',
    copy_btn:'نسخ',
    copy_done:'تم النسخ!',
    translate_empty:'أدخل كلمة أو جملة بالألمانية أو الإنجليزية أو العربية',
    translate_error:'فشل الترجمة. حاول مرة أخرى.',
    translate_no_history:'ستظهر ترجماتك هنا',
    translate_page_title:'المترجم',
    translate_page_sub:'الترجمة بين الألمانية والإنجليزية والعربية',
    translate_btn_label:'ترجمة',
    translate_speak:'استماع',
    translate_history_label:'السجل',
    translate_history_clear:'مسح',
    news_page_title:'مقالات وأخبار',
    news_page_sub:'انشر مقالاتك وتحديثاتك',
    news_title_label:'العنوان',
    news_type_label:'النوع',
    news_summary_label:'ملخص',
    news_body_label:'المحتوى',
    news_title_placeholder:'عنوان المنشور...',
    news_summary_placeholder:'ملخص قصير...',
    news_body_placeholder:'اكتب مقالتك أو خبرك هنا...',
    news_publish_btn:'نشر',
    news_update_btn:'تحديث',
    news_cancel_btn:'إلغاء',
    news_feed_title:'المنشورات',
    news_filter_all:'الكل',
    news_filter_article:'مقال',
    news_filter_news:'خبر',
    news_badge_article:'مقال',
    news_badge_news:'خبر',
    news_edit_btn:'تعديل',
    news_delete_btn:'حذف',
    news_empty:'لا توجد منشورات بعد. انشر أول مقالة أو خبر.',
    // Ask the question more explicitly
    news_delete_confirm:'هل تريد حذف هذا المنشور؟',
    news_toast_published:'📰 تم النشر',
    news_toast_updated:'✏️ تم التحديث',
    news_toast_deleted:'🗑 تم الحذف',
    news_validation_title:'الرجاء إدخال عنوان',
    news_validation_body:'الرجاء كتابة محتوى المنشور',
    news_editing_hint:'أنت تعدل منشوراً موجوداً.',
    // Clarify that the streak refers to achievements
    notif_title:'سلسلة الإنجازات في خطر!',
    // Improve grammar and make it clear the streak spans a number of days
    notif_body_streak:'لديك ساعتان لحماية سلسلة الإنجازات التي تمتد لـ {streak} يومًا!',
    notif_body_no_streak:'أكمل مهامك اليومية قبل منتصف الليل!',
    notif_unsupported:'⚠ الإشعارات غير مدعومة في هذا المتصفح',
    notif_blocked:'🚫 الإشعارات محظورة — فعّلها من إعدادات المتصفح',
    notif_active:'✓ ستتلقى تذكيراً عند الساعة 22:00 إذا لم تكتمل المهام',
    // Clarify that this reminder is about the daily streak
    lbl_reminder:'🔔 تذكير السلسلة اليومية',
    // Use the imperative form for clarity and naturalness
    lbl_reminder_sub:'ذكرني قبل منتصف الليل بساعتين إذا لم أتم المهام',
    // Ask confirmation in full form
    confirm_logout:'هل تريد تسجيل الخروج؟',
    // Use a full confirmation phrase
    confirm_reset:'هل تريد إعادة تعيين جميع التقدم؟',
    // Specify that a file is being deleted
    confirm_delete_pdf:'هل تريد حذف ملف PDF؟',
    lbl_new_pwd:'كلمة مرور جديدة',
    lbl_confirm_pwd:'تأكيد كلمة المرور',
    profile_save:'💾 حفظ التغييرات',
    profile_logout:'↩ تسجيل الخروج',
    profile_no_change:'أدخل كلمة مرور جديدة للتحديث.',
    profile_pwd_mismatch:'كلمتا المرور غير متطابقتين.',
    profile_pwd_short:'كلمة المرور قصيرة جداً (6 أحرف على الأقل).',
    profile_saved:'✓ تم تحديث كلمة المرور!',
    confirm_title:'تأكيد بريدك الإلكتروني',
    confirm_text:'أرسلنا لك بريداً للتأكيد. انقر على الرابط لتفعيل حسابك.',
    confirm_btn:'العودة إلى تسجيل الدخول',
    // Clarify that the email itself was confirmed
    confirm_success:'✓ تم تأكيد بريدك الإلكتروني! يمكنك تسجيل الدخول الآن.',
    error_fill_all:'الرجاء ملء جميع الحقول.',
    error_pwd_match:'كلمتا المرور غير متطابقتين.',
    error_pwd_short:'كلمة المرور قصيرة جداً (6 أحرف على الأقل).',
    error_too_many:'تم إرسال عدد كبير من رسائل التأكيد. حاول لاحقاً.',
    error_email_provider_restricted:'تسليم البريد الافتراضي محدود. استخدم SMTP مخصصاً.',
    error_invalid_login:'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    error_user_exists:'هذا البريد الإلكتروني مستخدم بالفعل.',
    error_not_confirmed:'تحقق من بريدك الإلكتروني لتأكيد حسابك.',
    toast_week_done:'✓ الأسبوع {week} مكتمل!',
    toast_week_reset:'تم إعادة تعيين الأسبوع {week}',
    toast_all_tasks_done:'🔥 جميع المهام مكتملة اليوم!',
    toast_correct_answer:'✓ صحيح!',
    toast_wrong_answer:'✗ خطأ',
    toast_deleted:'🗑 تم الحذف',
    toast_delete_error:'⚠️ فشل الحذف',
    toast_saved:'✓ تم الحفظ',
    toast_save_error:'⚠️ فشل الحفظ',
    toast_upload_success:'✓ تم حفظ PDF!',
    toast_upload_error_prefix:'⚠️ فشل الرفع:',
    pdf_list_error:'تعذر تحميل الوثائق.',
    generic_error:'خطأ غير معروف',
    toast_only_pdf:'⚠️ ملفات PDF فقط مسموحة',
    toast_file_too_big:'⚠️ الملف كبير جداً (حد أقصى 50 ميجا)',
    vocab_title:'مدرب المفردات',
    vocab_known_btn:'✓ أعرفها',
    vocab_again_btn:'✗ أعد المحاولة',
    vocab_filter_all:'كل الفئات',
    vocab_filter_noun:'الأسماء',
    vocab_filter_verb:'الأفعال',
    vocab_filter_adjective:'الصفات',
    vocab_filter_phrase:'العبارات',
    vocab_finished:'🎉 انتهى!',
    speaking_title:'تمرين النطق',
    speaking_btn:'🎤 تحدث',
    stats_section_title:'إحصائيات',
    suggest_section_title:'اقتراحات',
    speech_not_supported:'التعرف على الكلام غير مدعوم.',
    listening_title:'تمرين الاستماع',
    listening_audio_btn:'▶ تشغيل الصوت',
    listening_show_btn:'👁 عرض الترجمة',
    listening_input_ph:'اكتب ما سمعت...',
    listening_submit_btn:'✓ تحقق',
    listening_score_label:'الإجابات الصحيحة:',
    listening_speed_slow:'🐢 بطيء',
    listening_speed_normal:'⚖ عادي',
    listening_speed_fast:'🐇 سريع',
    pdf_tap_open:'اضغط للفتح'
  }
};

function t(key){return(i18n[currentLang]||i18n.de)[key]||key;}

function toggleLangMenu(){
  const menu = document.getElementById('lang-fab-menu');
  if(menu) menu.classList.toggle('open');
}
document.addEventListener('click', e => {
  const fab = document.getElementById('lang-fab');
  if(fab && !fab.contains(e.target)){
    const menu = document.getElementById('lang-fab-menu');
    if(menu) menu.classList.remove('open');
  }
});

function setLang(lang){
  currentLang = ['de','en','ar'].includes(lang) ? lang : 'de';
  localStorage.setItem('app_lang', currentLang);
  document.documentElement.lang = currentLang;
  document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('app_title');
  ['de','en','ar'].forEach(l => {
    const el = document.getElementById('lang-'+l);
    if(el) el.classList.toggle('active', currentLang === l);
  });
  const menu = document.getElementById('lang-fab-menu');
  if(menu) menu.classList.remove('open');
  applyLang();
  if(_appInited){
    updateTodayLabel();
    render();
    renderNewsPage();
    renderPdfGrid();
    updateStorageBar();
    if(pdfDoc){renderPdfPage(currentPage);}
  }
}

function applyLang(){
  const L=i18n[currentLang]||i18n.de;
  document.documentElement.lang=currentLang;
  document.title=L.app_title||document.title;

  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const k=el.dataset.i18n;
    if(L[k])el.textContent=L[k];
  });

  const loaderText=document.getElementById('loader-text');if(loaderText)loaderText.textContent=L.loader_connecting;
  const lt=document.querySelector('.login-title');if(lt)lt.innerHTML=L.login_title_1+'<br><span>'+L.login_title_2+'</span>';
  const ls=document.querySelector('.login-sub');if(ls)ls.textContent=L.login_sub;
  const tl=document.getElementById('tab-login');if(tl)tl.textContent=L.tab_login;
  const tr=document.getElementById('tab-register');if(tr)tr.textContent=L.tab_register;

  const emailInput=document.getElementById('auth-email');if(emailInput)emailInput.placeholder=L.placeholder_email;
  const pwdInput=document.getElementById('auth-password');if(pwdInput)pwdInput.placeholder=L.placeholder_pwd;
  // Fix incorrect ID for confirm password field and update its placeholder
  const confirmInput=document.getElementById('auth-confirm-password');
  if(confirmInput)confirmInput.placeholder=L.placeholder_pwd;

  // Update labels individually rather than relying on index order. The previous
  // implementation used a simple index-based approach which broke when the
  // "Display Name" field is shown in the registration tab. We instead look up
  // each field by its ID and update the corresponding label if a translation
  // string exists. Note: there is currently no explicit translation key for the
  // display name label; if added in the future, use L.label_name here.
  const emailLabel=document.querySelector('#auth-email')?.closest('.login-field')?.querySelector('label');
  if(emailLabel&&L.label_email) emailLabel.textContent=L.label_email;
  const pwdLabel=document.querySelector('#auth-password')?.closest('.login-field')?.querySelector('label');
  if(pwdLabel&&L.label_pwd) pwdLabel.textContent=L.label_pwd;
  const confirmLabel=document.querySelector('#auth-confirm-password')?.closest('.login-field')?.querySelector('label');
  if(confirmLabel&&L.label_confirm) confirmLabel.textContent=L.label_confirm;

  const ab=document.getElementById('auth-btn');if(ab)ab.textContent=authMode==='login'?L.btn_login:L.btn_register;

  const h1=document.querySelector('h1');if(h1)h1.innerHTML=L.h1_1+'<br><span>'+L.h1_2+'</span>';
  const hsub=document.querySelector('header p');if(hsub)hsub.textContent=L.h1_sub;
  const badge=document.querySelector('.level-badge');if(badge)badge.textContent=L.badge;
  const mpl=document.querySelector('.main-progress-label');if(mpl)mpl.textContent=L.progress_label;

  const sw=document.getElementById('stat-weeks');if(sw&&sw.nextElementSibling)sw.nextElementSibling.textContent=L.lbl_weeks;
  const st=document.getElementById('stat-streak');if(st&&st.nextElementSibling)st.nextElementSibling.textContent=L.lbl_streak;
  const sul=document.getElementById('streak-unit-label');if(sul)sul.textContent=L.streak_days||'Tage';
  updateStreakWidget();
  const sv=document.getElementById('stat-vocab');if(sv&&sv.nextElementSibling)sv.nextElementSibling.textContent=L.lbl_vocab;
  const sh=document.getElementById('stat-hours');if(sh&&sh.nextElementSibling)sh.nextElementSibling.textContent=L.lbl_hours;
  const stasks=document.getElementById('stat-tasks');if(stasks&&stasks.nextElementSibling)stasks.nextElementSibling.textContent=L.lbl_today;
  const sdl=document.getElementById('stat-days-left');if(sdl&&sdl.nextElementSibling)sdl.nextElementSibling.textContent=L.lbl_days;

  const journeyTitle=document.querySelector('.journey-section .section-title');if(journeyTitle)journeyTitle.textContent=L.section_journey;
  const dailyTitle=document.querySelector('.daily-section .section-title');if(dailyTitle)dailyTitle.textContent=L.section_daily;
  const notesTitle=document.querySelector('.notes-section .section-title');if(notesTitle)notesTitle.textContent=L.section_notes;
  const pdfTitle=document.querySelector('.pdf-page .section-title');if(pdfTitle)pdfTitle.textContent=L.pdf_title;

  const notesArea=document.getElementById('notes-area');if(notesArea)notesArea.placeholder=L.notes_placeholder;
  const storageLabel=document.querySelector('.storage-label');if(storageLabel)storageLabel.textContent=L.storage_label;
  const storageInfo=document.getElementById('storage-info');if(storageInfo&&storageInfo.textContent.includes('Charg')||storageInfo&&storageInfo.textContent.includes('Load'))storageInfo.textContent=L.storage_loading;
  const docsRefreshBtn=document.getElementById('docs-refresh-btn');if(docsRefreshBtn)docsRefreshBtn.textContent=L.docs_refresh_btn;
  const docsSearch=document.getElementById('docs-search');if(docsSearch)docsSearch.placeholder=L.pdf_search_placeholder;
  const uploadTitle=document.querySelector('.upload-title');if(uploadTitle)uploadTitle.textContent=L.upload_title;
  const uploadSub=document.querySelector('.upload-sub');if(uploadSub)uploadSub.textContent=L.upload_sub;

  document.querySelectorAll('.cat-btn').forEach(btn=>{
    const cat=btn.dataset.cat;
    const map={all:'cat_all',grammar:'cat_grammar',vocabulary:'cat_vocab',exercise:'cat_exercise',exam:'cat_exam',other:'cat_other'};
    if(map[cat]&&L[map[cat]])btn.textContent=L[map[cat]];
  });

  const desktopNav=document.querySelectorAll('.desk-nav-item[data-page]');
  if(desktopNav[0])desktopNav[0].textContent=L.nav_tracker;
  if(desktopNav[1])desktopNav[1].textContent=L.nav_docs;
  if(desktopNav[2])desktopNav[2].textContent=(L.nav_news||'News');
  if(desktopNav[3])desktopNav[3].textContent=(L.nav_translate||'Translator');


  const newsPageTitle=document.getElementById('news-page-title');if(newsPageTitle)newsPageTitle.textContent=L.news_page_title||'Articles & News';
  const newsPageSub=document.getElementById('news-page-sub');if(newsPageSub)newsPageSub.textContent=L.news_page_sub||'Publish your own articles and updates';
  const newsTitleLabel=document.getElementById('news-title-label');if(newsTitleLabel)newsTitleLabel.textContent=L.news_title_label||'Title';
  const newsTypeLabel=document.getElementById('news-type-label');if(newsTypeLabel)newsTypeLabel.textContent=L.news_type_label||'Type';
  const newsSummaryLabel=document.getElementById('news-summary-label');if(newsSummaryLabel)newsSummaryLabel.textContent=L.news_summary_label||'Summary';
  const newsBodyLabel=document.getElementById('news-body-label');if(newsBodyLabel)newsBodyLabel.textContent=L.news_body_label||'Content';
  const newsTitleInput=document.getElementById('news-title-input');if(newsTitleInput)newsTitleInput.placeholder=L.news_title_placeholder||'Post title...';
  const newsSummaryInput=document.getElementById('news-summary-input');if(newsSummaryInput)newsSummaryInput.placeholder=L.news_summary_placeholder||'Short summary...';
  const newsBodyInput=document.getElementById('news-body-input');if(newsBodyInput)newsBodyInput.placeholder=L.news_body_placeholder||'Write your article or news here...';
  const newsFeedTitle=document.getElementById('news-feed-title');if(newsFeedTitle)newsFeedTitle.textContent=L.news_feed_title||'Published posts';
  const newsCancelBtn=document.getElementById('news-cancel-btn');if(newsCancelBtn)newsCancelBtn.textContent=L.news_cancel_btn||'Cancel';
  document.querySelectorAll('.news-filter-btn').forEach(btn=>{
    const f=btn.dataset.filter;
    const map={all:'news_filter_all',article:'news_filter_article',news:'news_filter_news'};
    if(map[f]&&L[map[f]])btn.textContent=L[map[f]];
  });
  const newsTypeSelect=document.getElementById('news-type-select');
  if(newsTypeSelect){
    const opts=newsTypeSelect.options;
    if(opts[0])opts[0].text=L.news_filter_article||'Article';
    if(opts[1])opts[1].text=L.news_filter_news||'News';
  }

  const rb=document.querySelector('.reset-btn');if(rb)rb.textContent=L.reset_btn;
  const ct=document.querySelector('.confirm-title');if(ct)ct.textContent=L.confirm_title;
  const ctext=document.querySelector('.confirm-text');if(ctext)ctext.textContent=L.confirm_text;
  const cb=document.querySelector('.confirm-btn');if(cb)cb.textContent=L.confirm_btn;
  const cm=document.getElementById('confirm-success-msg');if(cm&&cm.textContent)cm.textContent=L.confirm_success;

  const prevBtn=document.getElementById('prev-page');if(prevBtn)prevBtn.textContent='◀ '+(currentLang==='en'?'Prev':'Zurück');
  const nextBtn=document.getElementById('next-page');if(nextBtn)nextBtn.textContent=(currentLang==='en'?'Next':'Weiter')+' ▶';
  if(pdfDoc){updatePdfViewerInfo(currentPage);document.querySelectorAll('.pdf-page-label').forEach((el,idx)=>el.textContent=`${t('pdf_page')} ${idx+1}`);}

  const renameTitle=document.querySelector('.rename-title');if(renameTitle)renameTitle.textContent=currentLang==='en'?'✏️ Edit document':'✏️ Dokument bearbeiten';
  const renameInput=document.getElementById('rename-input');if(renameInput)renameInput.placeholder=currentLang==='en'?'Document name...':'Dokumentname...';
  const renameBtns=document.querySelectorAll('.rename-btn');
  if(renameBtns[0])renameBtns[0].textContent=currentLang==='en'?'Cancel':'Abbrechen';
  if(renameBtns[1])renameBtns[1].textContent=currentLang==='en'?'Save':'Speichern';

  if(document.getElementById('profile-modal').classList.contains('open'))applyProfileLang();
  updateNewsComposerUi();
  // Translate page i18n
  const tpt=document.getElementById('translate-page-title');if(tpt)tpt.textContent=L.translate_page_title||'Translator';
  const tps=document.getElementById('translate-page-sub');if(tps)tps.textContent=L.translate_page_sub||'Translate between German, English & Arabic';
  const tbl=document.getElementById('translate-btn-label');if(tbl)tbl.textContent=L.translate_btn_label||'Translate';
  const thl=document.getElementById('translate-history-label');if(thl)thl.textContent=L.translate_history_label||'History';
  const thc=document.getElementById('translate-history-clear-btn');if(thc)thc.textContent=L.translate_history_clear||'Clear';
  const tsp=document.getElementById('translate-speak-btn');if(tsp)tsp.querySelector('.btn-label').textContent='🔊 '+(L.translate_speak||'Listen');
  const tinp=document.getElementById('translate-input');if(tinp)tinp.placeholder=L.translate_empty||'Enter a word or sentence in German, English or Arabic...';
  const nnav=document.querySelector('.nav-item[data-page="news"] .nav-label');if(nnav)nnav.textContent=L.nav_news||'News';
  const tnav=document.querySelector('.nav-item[data-page="translate"] .nav-label');if(tnav)tnav.textContent=L.nav_translate||'Translator';
  const ndnav=document.querySelector('.desk-nav-item[data-page="news"]');if(ndnav)ndnav.textContent=(L.nav_news||'News');
  const tdnav=document.querySelector('.desk-nav-item[data-page="translate"]');if(tdnav)tdnav.textContent=(L.nav_translate||'Translator');

  // Vocabulary Trainer page i18n
  const vocabTitleEl=document.getElementById('vocab-title');
  if(vocabTitleEl){
    vocabTitleEl.textContent=L.vocab_title||'📚 Vocabulary Trainer';
  }

  // Listening Practice page i18n
  const listeningTitleEl=document.getElementById('listening-title');
  if(listeningTitleEl){
    listeningTitleEl.textContent=L.listening_title||'🎧 Listening Practice';
  }
  const playBtn=document.getElementById('listening-play-btn');
  if(playBtn){
    playBtn.textContent=L.listening_audio_btn||'▶ Audio';
  }
  const showBtn=document.getElementById('listening-show-btn');
  if(showBtn){
    showBtn.textContent=L.listening_show_btn||'👁 Show translation';
  }
  const listeningInput=document.getElementById('listening-input');
  if(listeningInput){
    listeningInput.placeholder=L.listening_input_ph||'Type what you heard...';
  }
  const submitBtn=document.getElementById('listening-submit-btn');
  if(submitBtn){
    submitBtn.textContent=L.listening_submit_btn||'✓ Check';
  }
  const slowBtn=document.getElementById('listening-slow-btn');
  if(slowBtn){
    slowBtn.textContent=L.listening_speed_slow||'🐢 Slow';
  }
  const normalBtn=document.getElementById('listening-normal-btn');
  if(normalBtn){
    normalBtn.textContent=L.listening_speed_normal||'⚖ Normal';
  }
  const fastBtn=document.getElementById('listening-fast-btn');
  if(fastBtn){
    fastBtn.textContent=L.listening_speed_fast||'🐇 Fast';
  }
  const scoreLabel=document.getElementById('listening-score-label');
  if(scoreLabel){
    scoreLabel.textContent=L.listening_score_label||'Correct answers:';
  }
}

(() => {
  const saved=localStorage.getItem('app_lang')||'de';
  setLang(saved);

  try{
    const params=new URLSearchParams(window.location.search);
    if(params.get('type')==='signup'){
      const msgEl=document.getElementById('confirm-success-msg');
      if(msgEl){
        msgEl.textContent=t('confirm_success');
        msgEl.classList.add('visible');
      }
      showConfirmScreen();
      if(history&&history.replaceState){
        history.replaceState({},document.title,window.location.pathname);
      }
    }
  }catch(e){}
  bindNavigationControls();
})();

let _lastDocsPhoneMode=isPhoneDocsView();
window.addEventListener('resize',()=>{
  const nowPhone=isPhoneDocsView();
  if(nowPhone!==_lastDocsPhoneMode){
    _lastDocsPhoneMode=nowPhone;
    if(activeAppPage==='pdf')renderPdfGrid();
  }
  if(pdfDoc&&document.getElementById('pdf-modal').classList.contains('open')){
    renderPdfPage(currentPage);
  }
});

document.addEventListener('DOMContentLoaded',()=>{
  try{bindNavigationControls();}catch(e){console.error('Navigation bind error:', e);}
});

// ===== STREAK REMINDER NOTIFICATIONS =====
let _notifTimer = null;

function isNotifSupported(){
  return 'Notification' in window;
}

function updateNotifToggleUI(){
  const btn = document.getElementById('notif-toggle');
  const status = document.getElementById('notif-status');
  if(!btn) return;
  const enabled = !!state.reminderNotif;
  btn.classList.toggle('on', enabled);
  btn.setAttribute('aria-checked', enabled ? 'true' : 'false');
  if(!isNotifSupported()){
    if(status){ status.textContent = t('notif_unsupported') || '⚠ Notifications not supported in this browser'; status.className='profile-reminder-status warn'; }
    btn.disabled = true; btn.style.opacity = '0.4';
    return;
  }
  if(Notification.permission === 'denied'){
    if(status){ status.textContent = t('notif_blocked') || '🚫 Notifications blocked — enable them in browser settings'; status.className='profile-reminder-status err'; }
    return;
  }
  if(status){
    if(enabled){
      status.textContent = t('notif_active') || '✓ You will be reminded at 22:00 if tasks aren\'t done';
      status.className = 'profile-reminder-status ok';
    } else {
      status.textContent = '';
      status.className = 'profile-reminder-status';
    }
  }
}

async function toggleReminderNotif(){
  if(!isNotifSupported()) return;
  // If turning ON, request permission first
  if(!state.reminderNotif){
    if(Notification.permission === 'default'){
      const perm = await Notification.requestPermission();
      if(perm !== 'granted'){
        updateNotifToggleUI();
        return;
      }
    }
    if(Notification.permission !== 'granted'){
      updateNotifToggleUI();
      return;
    }
    state.reminderNotif = true;
    scheduleStreakReminder();
  } else {
    state.reminderNotif = false;
    cancelStreakReminder();
  }
  save();
  updateNotifToggleUI();
}

function scheduleStreakReminder(){
  cancelStreakReminder();
  if(!state.reminderNotif) return;
  if(!isNotifSupported() || Notification.permission !== 'granted') return;

  const now = new Date();
  // Fire at 22:00 today (2h before midnight)
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 22, 0, 0);
  // If 22:00 already passed today, schedule for tomorrow
  if(target <= now) target.setDate(target.getDate() + 1);
  const ms = target.getTime() - now.getTime();

  _notifTimer = setTimeout(()=>{
    const allTaskIds = ['anki','grammar','listen','speak'];
    const allDone = allTaskIds.every(id => state.dailyDone?.[id]);
    if(!allDone && state.reminderNotif){
      const streak = state.streak || 0;
      new Notification('🔥 ' + (t('notif_title') || 'Streak at risk!'), {
        body: streak > 0
          ? (t('notif_body_streak') || 'You have 2 hours left to protect your {streak}-day streak!').replace('{streak}', streak)
          : (t('notif_body_no_streak') || 'Complete your daily tasks before midnight!'),
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        tag: 'streak-reminder',
        renotify: true,
      });
    }
    // Reschedule for next day
    scheduleStreakReminder();
  }, ms);
}

function cancelStreakReminder(){
  if(_notifTimer){ clearTimeout(_notifTimer); _notifTimer = null; }
}


// ===== NEWS / POSTS =====

function getNewsBadgeLabel(type){
  return type === 'news' ? t('news_badge_news') : t('news_badge_article');
}

function formatNewsDate(ts){
  try{
    const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
    return d.toLocaleString(getLocale(), { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }catch(e){ return ''; }
}

function clearNewsForm(){
  const title=document.getElementById('news-title-input');
  const type=document.getElementById('news-type-select');
  const summary=document.getElementById('news-summary-input');
  const body=document.getElementById('news-body-input');
  const status=document.getElementById('news-status');
  if(title)title.value='';
  if(type)type.value='article';
  if(summary)summary.value='';
  if(body)body.value='';
  if(status){status.textContent='';status.className='news-status';}
  editingNewsId=null;
  updateNewsComposerUi();
}

function updateNewsComposerUi(){
  const composer=document.querySelector('.news-composer');
  const submitBtn=document.getElementById('news-submit-btn');
  const cancelBtn=document.getElementById('news-cancel-btn');
  const status=document.getElementById('news-status');
  // Only admins see the composer
  if(composer) composer.style.display = isAdmin() ? '' : 'none';
  if(submitBtn){
    const lbl = submitBtn.querySelector('.btn-label');
    if(lbl) lbl.textContent = editingNewsId ? t('news_update_btn') : t('news_publish_btn');
  }
  if(cancelBtn)cancelBtn.style.display = editingNewsId ? 'inline-flex' : 'none';
  if(status && editingNewsId){
    status.textContent = t('news_editing_hint');
    status.className = 'news-status editing';
  }else if(status){
    status.textContent = '';
    status.className = 'news-status';
  }
}

async function loadNewsPosts(){
  const list=document.getElementById('news-list');
  if(list) list.innerHTML = '<div class="news-empty"><div class="spinner" style="margin:0 auto;width:28px;height:28px;border:3px solid var(--border);border-top-color:var(--gold);border-radius:50%;animation:spin 0.8s linear infinite"></div></div>';
  try{
    const {data,error} = await _supa.from('news_posts').select('*').order('created_at',{ascending:false});
    if(error) throw error;
    _newsPosts = data || [];
  }catch(e){
    _newsPosts = [];
    if(list) list.innerHTML = `<div class="news-empty"><div class="icon">⚠️</div><p>Could not load posts: ${e.message||'error'}</p></div>`;
    return;
  }
  renderNewsPage();
}

function renderNewsPage(){
  updateNewsComposerUi();
  if(typeof applyRoleUI==='function') setTimeout(applyRoleUI,0);
  const list=document.getElementById('news-list');
  if(!list) return;
  const items = [..._newsPosts]
    .filter(item => newsFilter==='all' ? true : item.type===newsFilter);

  if(items.length===0){
    list.innerHTML = `<div class="news-empty"><div class="icon">📰</div><p>${t('news_empty')}</p></div>`;
    return;
  }

  list.innerHTML = items.map(item => `
    <article class="news-card">
      <div class="news-card-head">
        <div class="news-meta">
          <div class="news-badges">
            <span class="news-badge ${item.type==='news'?'news':'article'}">${getNewsBadgeLabel(item.type)}</span>
            <span class="news-date">${formatNewsDate(item.updated_at || item.created_at)}</span>
          </div>
          <div class="news-title">${escapeHtml(item.title || '')}</div>
          ${item.author_email ? `<div class="news-date" style="margin-top:4px;color:var(--muted)">by ${escapeHtml(item.author_email)}</div>` : ''}
        </div>
        ${isAdmin() ? `<div class="news-card-actions">
          <button class="news-icon-btn" onclick="editNewsPost('${item.id}')">${t('news_edit_btn')}</button>
          <button class="news-icon-btn danger" onclick="deleteNewsPost('${item.id}')">${t('news_delete_btn')}</button>
        </div>` : ''}
      </div>
      <div class="news-card-body">
        ${item.summary ? `<div class="news-summary">${escapeHtml(item.summary)}</div>` : ''}
        <div class="news-body">${escapeHtml(item.body || '')}</div>
      </div>
    </article>
  `).join('');
}

function escapeHtml(value){
  return String(value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;')
    .replace(/\n/g,'<br>');
}

function setNewsFilter(filter, btn){
  newsFilter = filter;
  document.querySelectorAll('.news-filter-btn').forEach(el => el.classList.toggle('active', el.dataset.filter===filter));
  renderNewsPage();
}

async function submitNewsPost(){
  if(!isAdmin()){showToast('⛔ Admin only');return;}
  const title=(document.getElementById('news-title-input')?.value||'').trim();
  const type=(document.getElementById('news-type-select')?.value||'article').trim();
  const summary=(document.getElementById('news-summary-input')?.value||'').trim();
  const body=(document.getElementById('news-body-input')?.value||'').trim();

  if(!title){ showToast(t('news_validation_title')); document.getElementById('news-title-input')?.focus(); return; }
  if(!body){ showToast(t('news_validation_body')); document.getElementById('news-body-input')?.focus(); return; }

  const btn=document.getElementById('news-submit-btn');
  if(btn){btn.disabled=true;btn.classList.add('loading');}

  try{
    if(editingNewsId){
      const {error}=await _supa.from('news_posts').update({
        title, type, summary, body, updated_at: new Date().toISOString()
      }).eq('id', editingNewsId);
      if(error) throw error;
      showToast(t('news_toast_updated'));
    }else{
      const id='post_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
      const {error}=await _supa.from('news_posts').insert({
        id, title, type, summary, body,
        author_email: currentUser?.email || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      if(error) throw error;
      showToast(t('news_toast_published'));
    }
    clearNewsForm();
    await loadNewsPosts();
  }catch(e){
    showToast('Error: '+(e.message||'Could not save post'));
  }finally{
    if(btn){btn.disabled=false;btn.classList.remove('loading');}
  }
}

function editNewsPost(id){
  if(!isAdmin()){showToast('⛔ Admin only');return;}
  const item = _newsPosts.find(post => post.id === id);
  if(!item) return;
  editingNewsId = id;
  document.getElementById('news-title-input').value = item.title || '';
  document.getElementById('news-type-select').value = item.type || 'article';
  document.getElementById('news-summary-input').value = item.summary || '';
  document.getElementById('news-body-input').value = item.body || '';
  updateNewsComposerUi();
  switchPage('news');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelNewsEdit(){
  clearNewsForm();
}

async function deleteNewsPost(id){
  if(!isAdmin()){showToast('⛔ Admin only');return;}
  if(!confirm(t('news_delete_confirm'))) return;
  try{
    const {error}=await _supa.from('news_posts').delete().eq('id',id);
    if(error) throw error;
    if(editingNewsId===id) clearNewsForm();
    showToast(t('news_toast_deleted'));
    await loadNewsPosts();
  }catch(e){
    showToast('Error: '+(e.message||'Could not delete'));
  }
}

function initNewsPage(){
  loadNewsPosts();
}

// ===== PRESENCE =====
let _userPresence = {}; // { email: lastSeenTimestamp }
let _presenceInterval = null;

async function startPresenceHeartbeat(){
  if(!currentUser) return;
  const sendBeat = async () => {
    try{
      const {error} = await _supa.from('user_presence').upsert({
        email: currentUser.email,
        last_seen: new Date().toISOString()
      }, { onConflict: 'email' });
      // Silently ignore lock conflicts and missing table
    }catch(e){}
  };
  sendBeat();
  clearInterval(_presenceInterval);
  _presenceInterval = setInterval(sendBeat, 30000);
  // Also send on page visibility change
  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden) sendBeat();
  });
}

async function fetchPresence(){
  if(!isAdmin()) return;
  try{
    const {data,error} = await _supa.from('user_presence').select('email,last_seen');
    if(error){
      const msg = error.message||'';
      if(msg.includes('does not exist')||msg.includes('42P01')||msg.includes('lock')||msg.includes('stole')) return;
      throw error;
    }
    _userPresence = {};
    (data||[]).forEach(row=>{
      _userPresence[row.email] = new Date(row.last_seen).getTime();
    });
  }catch(e){ _userPresence = {}; }
}

// ===== NOTIFICATIONS =====
let _notifications = [];
let _notifPanelOpen = false;

async function initNotifications(){
  await loadNotifications();
  // Populate target select with users if admin
  if(isAdmin()){
    document.querySelectorAll('#admin-notif-send-row,#mob-admin-notif-send-row').forEach(el=>el.style.display='');
    populateNotifTargets();
  }
}

async function populateNotifTargets(){
  const sel = document.getElementById('notif-target-select');
  if(!sel) return;
  sel.innerHTML = '<option value="all">🌍 All Users</option>';
  if(_adminAllUsers && _adminAllUsers.length){
    _adminAllUsers.forEach(u=>{
      const opt = document.createElement('option');
      opt.value = u.email;
      opt.textContent = '👤 ' + u.email;
      sel.appendChild(opt);
    });
  }
}

async function loadNotifications(){
  try{
    let query = _supa.from('notifications').select('*').order('created_at',{ascending:false}).limit(50);
    if(!isAdmin() && currentUser?.email){
      query = query.or(`target.eq.all,target.eq.${currentUser.email}`);
    }
    const {data,error} = await query;
    // Silently ignore if table doesn't exist yet (42P01)
    if(error){
      const msg = error.message||'';
      if(msg.includes('does not exist')||msg.includes('42P01')||msg.includes('relation')||msg.includes('lock')||msg.includes('stole')) return;
      throw error;
    }
    _notifications = data || [];
  }catch(e){
    _notifications = [];
    // Silent fail - table may not be created yet
    return;
  }
  renderNotifBadge();
  renderNotifList();
}

function getUnreadCount(){
  const readIds = JSON.parse(localStorage.getItem('notif_read_'+currentUser?.id)||'[]');
  return _notifications.filter(n=>!readIds.includes(n.id)).length;
}

function renderNotifBadge(){
  const count = getUnreadCount();
  document.querySelectorAll('.notif-badge, .nav-tab-badge').forEach(el=>{
    el.textContent = count > 9 ? '9+' : count;
    el.classList.toggle('visible', count > 0);
  });
}

function renderNotifList(){
  const readIds = JSON.parse(localStorage.getItem('notif_read_'+currentUser?.id)||'[]');
  const html = _notifications.length === 0
    ? '<div class="notif-empty">No notifications yet</div>'
    : _notifications.map(n=>`
        <div class="notif-item ${readIds.includes(n.id)?'':'unread'}" onclick="markOneRead('${n.id}')">
          <div class="notif-item-title">${escapeHtml(n.title||'')}</div>
          <div class="notif-item-body">${escapeHtml(n.body||'')}</div>
          <div class="notif-item-date">${formatNewsDate(n.created_at)}${n.target!=='all'?' · 👤 '+escapeHtml(n.target):''}</div>
        </div>`).join('');
  document.querySelectorAll('#notif-list,#mob-notif-list').forEach(el=>{ if(el) el.innerHTML=html; });
}

function mobToggleNotif(e){
  if(e){ e.stopPropagation(); e.preventDefault(); }
  _notifPanelOpen = !_notifPanelOpen;
  const mp = document.getElementById('mob-notif-panel');
  if(mp){ mp.style.display = _notifPanelOpen ? 'flex' : 'none'; }
  if(_notifPanelOpen) loadNotifications();
}
function toggleNotifPanel(){
  _notifPanelOpen = !_notifPanelOpen;
  // desktop
  const dp = document.getElementById('notif-panel');
  if(dp) dp.classList.toggle('open', _notifPanelOpen);
  // mobile
  const mp = document.getElementById('mob-notif-panel');
  if(mp) mp.style.display = _notifPanelOpen ? 'flex' : 'none';
  if(_notifPanelOpen) loadNotifications();
}

// Close panel when clicking outside
document.addEventListener('click', e=>{
  if(!_notifPanelOpen) return;
  const dp = document.getElementById('notif-panel');
  const deskBtn = document.getElementById('desk-notif-btn');
  const mobBtn = document.getElementById('mob-notif-btn');
  const mp = document.getElementById('mob-notif-panel');
  const clickedOutside =
    (!dp || !dp.contains(e.target)) &&
    (!deskBtn || !deskBtn.contains(e.target)) &&
    (!mobBtn || !mobBtn.contains(e.target)) &&
    (!mp || !mp.contains(e.target));
  if(clickedOutside){
    _notifPanelOpen = false;
    if(dp) dp.classList.remove('open');
    if(mp) mp.style.display = 'none';
  }
});

function markOneRead(id){
  const readIds = JSON.parse(localStorage.getItem('notif_read_'+currentUser?.id)||'[]');
  if(!readIds.includes(id)) readIds.push(id);
  localStorage.setItem('notif_read_'+currentUser?.id, JSON.stringify(readIds));
  renderNotifBadge();
  renderNotifList();
}

function markAllRead(){
  const ids = _notifications.map(n=>n.id);
  localStorage.setItem('notif_read_'+currentUser?.id, JSON.stringify(ids));
  renderNotifBadge();
  renderNotifList();
}

function openNotifModal(){
  _notifPanelOpen = false;
  document.getElementById('notif-panel')?.classList.remove('open');
  const mp = document.getElementById('mob-notif-panel');
  if(mp) mp.style.display='none';
  if(isAdmin() && _adminAllUsers.length) populateNotifTargets();
  document.getElementById('notif-modal-overlay').classList.add('open');
}

function closeNotifModal(e){
  if(e && e.target !== document.getElementById('notif-modal-overlay')) return;
  document.getElementById('notif-modal-overlay').classList.remove('open');
  document.getElementById('notif-title-input').value='';
  document.getElementById('notif-body-input').value='';
}

async function sendNotification(){
  if(!isAdmin()){showToast('⛔ Admin only');return;}
  const title = document.getElementById('notif-title-input').value.trim();
  const body = document.getElementById('notif-body-input').value.trim();
  const target = document.getElementById('notif-target-select').value;
  if(!title){showToast('Title is required');return;}
  if(!body){showToast('Message is required');return;}
  const btn = document.getElementById('notif-send-btn');
  if(btn){btn.disabled=true;btn.classList.add('loading');}
  try{
    const {error} = await _supa.from('notifications').insert({
      title, body, target,
      created_at: new Date().toISOString(),
      sender_email: currentUser?.email||''
    });
    if(error) throw error;
    showToast('✅ Notification sent!');
    document.getElementById('notif-modal-overlay').classList.remove('open');
    document.getElementById('notif-title-input').value='';
    document.getElementById('notif-body-input').value='';
    await loadNotifications();
  }catch(e){
    showToast('Error: '+(e.message||'Could not send'));
  }finally{
    if(btn){btn.disabled=false;btn.classList.remove('loading');}
  }
}

// ===== TRANSLATOR =====
let translateHistory = [];
let _translatePageBound = false;

function loadTranslateHistory(){
  try{ translateHistory = JSON.parse(localStorage.getItem('translate_history')||'[]'); }
  catch(e){ translateHistory=[]; }
  renderTranslateHistory();
}
function saveTranslateHistory(){ try{ localStorage.setItem('translate_history', JSON.stringify(translateHistory.slice(0,50))); }catch(e){} }

function escapeHtml(str){
  return String(str || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function encInline(str){ return encodeURIComponent(String(str || '')); }
function uniqueHistory(items){
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.de}__${item.ar}__${item.en}`;
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clearTranslateInput(){
  document.getElementById('translate-input').value='';
  document.getElementById('translate-results').innerHTML='';
  document.getElementById('translate-input').focus();
}

function clearTranslateHistory(){
  translateHistory=[];
  saveTranslateHistory();
  renderTranslateHistory();
}

function speakInput(){
  const text = document.getElementById('translate-input').value.trim();
  if(!text) return;
  if(!('speechSynthesis' in window)){ showToast('⚠ Speech not supported'); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  window.speechSynthesis.speak(u);
}

function speakResult(text, lang){
  if(!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  window.speechSynthesis.speak(u);
}

function copyText(text, btnEl){
  navigator.clipboard.writeText(text).then(()=>{
    btnEl.textContent = '✓ ' + (t('copy_done')||'Copied!');
    btnEl.classList.add('copied');
    setTimeout(()=>{ btnEl.textContent = t('copy_btn')||'Copy'; btnEl.classList.remove('copied'); }, 1800);
  }).catch(()=>{ showToast('Copy failed'); });
}

function renderResultCards(de, ar, en, phonetic){
  const results = document.getElementById('translate-results');
  const arInline = encInline(ar);
  const enInline = encInline(en);
  results.innerHTML = `
    <div class="translate-card">
      <div class="translate-card-header">
        <div class="translate-card-lang"><span class="translate-card-flag">🇸🇦</span> ${t('lang_arabic')||'Arabic'}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="translate-card-copy" onclick="speakResult(decodeURIComponent('${arInline}'),'ar-SA')">🔊</button>
          <button class="translate-card-copy" id="copy-ar" onclick="copyText(decodeURIComponent('${arInline}'), this)">${t('copy_btn')||'Copy'}</button>
        </div>
      </div>
      <div class="translate-card-body">
        <div class="translate-result-text" dir="rtl" style="font-size:1.1rem;text-align:right">${escapeHtml(ar)}</div>
      </div>
    </div>
    <div class="translate-card">
      <div class="translate-card-header">
        <div class="translate-card-lang"><span class="translate-card-flag">🇬🇧</span> ${t('lang_english')||'English'}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="translate-card-copy" onclick="speakResult(decodeURIComponent('${enInline}'),'en-GB')">🔊</button>
          <button class="translate-card-copy" id="copy-en" onclick="copyText(decodeURIComponent('${enInline}'), this)">${t('copy_btn')||'Copy'}</button>
        </div>
      </div>
      <div class="translate-card-body">
        <div class="translate-result-text">${escapeHtml(en)}</div>
        ${phonetic ? `<div class="translate-phonetic">/${escapeHtml(phonetic)}/</div>` : ''}
      </div>
    </div>
  `;
}

// ---- Dynamic translation helpers ----
// Language metadata used for dynamic translation cards. Flags use emoji and
// names are in English; t() is called lazily on render to allow later
// localization. Arabic text uses right‑to‑left direction.
const langInfo = {
  de: { flag: '🇩🇪', get name(){ return t('lang_german') || 'German'; }, dir: 'ltr' },
  en: { flag: '🇬🇧', get name(){ return t('lang_english') || 'English'; }, dir: 'ltr' },
  ar: { flag: '🇸🇦', get name(){ return t('lang_arabic') || 'Arabic'; }, dir: 'rtl' }
};

/**
 * Detect the source language of a given string using simple heuristics.
 * - Arabic: if any Arabic script characters are present
 * - German: if any umlaut/ß characters or common German words appear more
 *   frequently than common English words
 * - English: fallback when above conditions are not met
 *
 * @param {string} text Input text to analyse
 * @returns {string} ISO language code ('de','en','ar')
 */
function detectLanguage(text){
  if(/[\u0600-\u06FF]/.test(text)) return 'ar';
  if(/[äöüßÄÖÜ]/.test(text)) return 'de';
  const lower = (' ' + text.toLowerCase() + ' ');
  const germanWords = [' der ', ' die ', ' das ', ' und ', ' ist '];
  let germanScore = 0;
  germanWords.forEach(w => { germanScore += (lower.split(w).length - 1); });
  const englishWords = [' the ', ' and ', ' is ', ' of ', ' to '];
  let englishScore = 0;
  englishWords.forEach(w => { englishScore += (lower.split(w).length - 1); });
  if(germanScore > englishScore) return 'de';
  return 'en';
}

/**
 * Render translation result cards dynamically based on the detected source
 * language.  Only target languages (the other two of de/en/ar) are
 * displayed.  Each card includes copy and speak buttons similar to the
 * original implementation.
 *
 * @param {string} srcLang The detected source language
 * @param {object} results Object mapping language codes ('de','en','ar') to
 *                         translated text (including the original text at srcLang)
 */
function renderResultCardsDynamic(srcLang, results){
  const container = document.getElementById('translate-results');
  if(!container) return;
  const langs = ['de','en','ar'];
  const cards = [];
  langs.forEach(lang => {
    if(lang === srcLang) return;
    const info = langInfo[lang] || { flag:'', name: lang.toUpperCase(), dir:'ltr' };
    const txt = results[lang] || '—';
    const enc = encInline(txt);
    const voice = lang === 'ar' ? 'ar-SA' : (lang === 'de' ? 'de-DE' : 'en-GB');
    const dirAttr = lang === 'ar' ? 'dir="rtl" style="text-align:right"' : '';
    cards.push(`<div class="translate-card">
      <div class="translate-card-header">
        <div class="translate-card-lang"><span class="translate-card-flag">${info.flag}</span> ${info.name}</div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="translate-card-copy" onclick="speakResult(decodeURIComponent('${enc}'),'${voice}')">🔊</button>
          <button class="translate-card-copy" onclick="copyText(decodeURIComponent('${enc}'), this)">${t('copy_btn')||'Copy'}</button>
        </div>
      </div>
      <div class="translate-card-body">
        <div class="translate-result-text" ${dirAttr}>${escapeHtml(txt)}</div>
      </div>
    </div>`);
  });
  container.innerHTML = cards.join('');
}

function renderTranslateHistory(){
  const list = document.getElementById('translate-history-list');
  if(!list) return;
  if(translateHistory.length === 0){
    list.innerHTML = `<div class="translate-empty"><div class="translate-empty-icon">📖</div><p>${t('translate_no_history')||'Your translations will appear here'}</p></div>`;
    return;
  }
  list.innerHTML = translateHistory.map((h,i) => {
    const src = h.src || 'de';
    const srcFlag = (langInfo[src] && langInfo[src].flag) || '🌐';
    const srcText = h[src] || '';
    // Build secondary lines for target translations
    const targets = [];
    ['de','en','ar'].forEach(lang => {
      if(lang === src) return;
      const txt = h[lang];
      if(!txt) return;
      const flag = (langInfo[lang] && langInfo[lang].flag) || '';
      const dirAttr = lang === 'ar' ? 'direction:rtl;text-align:right' : '';
      targets.push(`<div style="font-size:0.78rem;color:#aaa;${dirAttr}">${flag} ${escapeHtml(txt)}</div>`);
    });
    return `
      <div class="translate-history-item" onclick="restoreHistory(${i})" style="flex-direction:column;align-items:stretch;gap:6px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div class="translate-history-de" style="font-size:0.9rem;font-weight:600">${srcFlag} ${escapeHtml(srcText)}</div>
          <div style="font-size:0.65rem;color:var(--muted);white-space:nowrap">${h.date||''}</div>
        </div>
        ${targets.join('')}
      </div>
    `;
  }).join('');
}

function restoreHistory(i){
  const h = translateHistory[i];
  if(!h) return;
  // Determine the source language stored in history (fallback to 'de')
  const srcLang = h.src || 'de';
  // Put the original text in the input area according to its source language
  const inputEl = document.getElementById('translate-input');
  if(inputEl){
    inputEl.value = h[srcLang] || '';
  }
  // Render translation cards dynamically using stored results
  // `h` already contains keys for 'de','en','ar' so pass as results
  renderResultCardsDynamic(srcLang, h);
  // Scroll to top
  window.scrollTo(0, 0);
}

async function fetchWithTimeout(url, ms=8000, options={}){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, { signal: controller.signal, ...options });
    clearTimeout(timer);
    return r;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

/**
 * Translate a German text into a target language using a two‑stage approach.
 * First it attempts to use Google Translate’s unofficial public endpoint, then
 * falls back to the MyMemory API if Google fails or returns an empty result.
 *
 * Google’s endpoint doesn’t require an API key and generally provides
 * higher‑quality translations for major language pairs.  The query uses
 * `client=gtx` which is commonly used by browser extensions and the result
 * is a nested array.  See the discussion in the py‑googletrans project where
 * the endpoint `https://translate.googleapis.com/translate_a/single?client=gtx` is
 * described along with sample parameters【670556233022063†L525-L566】.
 *
 * @param {string} text The German word or sentence to translate
 * @param {string} targetLang Target ISO language code (e.g. 'en' or 'ar')
 * @returns {Promise<string>} The translated text
 */
function getGoogleApiKey(){ return ''; } // not needed for gtx endpoint

async function translateOne(text, targetLang){
  return translateGenericGCloud(text, 'de', targetLang);
}

/* ===== Google Translate (gtx endpoint) ===== */
async function translateGenericGCloud(text, from, to){
  // Construct parameters for POST request. Google’s unofficial
  // translate endpoint now expects POST rather than a long query string.
  const params = new URLSearchParams();
  params.append('client', 'gtx');
  params.append('dt', 't');
  params.append('sl', from);
  params.append('tl', to);
  params.append('q', text);
  // Use fetchWithTimeout to send a POST request with URL encoded body.
  const res = await fetchWithTimeout('https://translate.googleapis.com/translate_a/single', 10000, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: params
  });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  // Parse the returned JSON. The response is a nested array: [[["translation","original",...],...],...]
  const json = await res.json();
  const parts = json?.[0];
  if(!Array.isArray(parts)) throw new Error('Unexpected response');
  // Flatten the first element of each translation pair and join into a single string.
  const result = parts.map(p => p?.[0] || '').join('');
  if(!result.trim()) throw new Error('Empty result');
  return result;
}

async function doTranslate(){
  const input = document.getElementById('translate-input').value.trim();
  if(!input){
    showToast(t('translate_empty') || 'Enter text to translate');
    return;
  }
  // Detect source language using heuristics (ar, de or en)
  const srcLang = detectLanguage(input);
  // Determine target languages (the other two of de/en/ar)
  const langs = ['de','en','ar'];
  const targets = langs.filter(l => l !== srcLang);
  const resultsContainer = document.getElementById('translate-results');
  // Show loading skeletons for each target language
  resultsContainer.innerHTML = targets.map(lang => {
    const info = langInfo[lang] || { flag:'', name: lang.toUpperCase() };
    return `<div class="translate-card"><div class="translate-card-header"><div class="translate-card-lang"><span class="translate-card-flag">${info.flag}</span> ${info.name}</div></div><div class="translate-card-body"><div class="translate-result-text loading-shimmer" style="height:24px;border-radius:4px"></div></div></div>`;
  }).join('');
  // Perform translations in parallel
  const results = { de:'', en:'', ar:'' };
  results[srcLang] = input;
  await Promise.all(targets.map(async lang => {
    try{
      results[lang] = await translateGeneric(input, srcLang, lang);
    }catch(e){
      results[lang] = '';
    }
  }));
  // If none of the translations succeeded, show an error card
  if(targets.every(lang => !results[lang])){
    resultsContainer.innerHTML = `<div class="translate-card" style="border-color:rgba(204,31,31,0.3)"><div class="translate-card-body"><div class="translate-result-text" style="color:#ff6b6b;font-size:0.85rem">⚠ Translation failed. Check your connection and try again.</div></div></div>`;
    return;
  }
  // Render dynamic result cards
  renderResultCardsDynamic(srcLang, results);
  // Save to history with explicit source language
  translateHistory.unshift({ de: results.de || '', en: results.en || '', ar: results.ar || '', phonetic:'', date: new Date().toLocaleDateString(), src: srcLang });
  translateHistory = uniqueHistory(translateHistory).slice(0, 5);
  saveTranslateHistory();
  renderTranslateHistory();
}

function saveTranslateApiKey(){} // no longer needed

function initTranslatePage(){
  loadTranslateHistory();
  if(_translatePageBound) return;
  _translatePageBound = true;
  const inp = document.getElementById('translate-input');
  if(inp){
    inp.addEventListener('keydown', e => {
      if((e.ctrlKey || e.metaKey) && e.key === 'Enter'){
        e.preventDefault();
        doTranslate();
      }
    });
  }
}

// ===== ADMIN ROLE MANAGEMENT =====
async function adminSetRole(role){
  const email = (document.getElementById('admin-target-email')?.value||'').trim().toLowerCase();
  const msgEl = document.getElementById('admin-panel-msg');
  if(!email){ msgEl.style.color='#ff6b6b'; msgEl.textContent='⚠ Entrez un email.'; return; }
  if(!isAdmin()){ msgEl.style.color='#ff6b6b'; msgEl.textContent='⛔ Accès refusé.'; return; }
  msgEl.style.color='var(--muted)'; msgEl.textContent='⏳ Mise à jour...';
  try{
    // Use Supabase admin API via edge function or RPC
    // We use a custom RPC function 'set_user_role' (see setup instructions)
    const { data, error } = await _supa.rpc('set_user_role', { target_email: email, new_role: role });
    if(error) throw error;
    msgEl.style.color='var(--green)';
    msgEl.textContent = `✓ ${email} → ${role === 'admin' ? '👑 Admin' : '👤 User'}`;
    document.getElementById('admin-target-email').value = '';
    adminLoadUsers();
  } catch(e){
    msgEl.style.color='#ff6b6b';
    msgEl.textContent = '✗ ' + (e?.message || String(e));
  }
}

async function adminLoadUsers(){
  const listEl = document.getElementById('admin-users-list');
  if(!listEl || !isAdmin()) return;
  listEl.textContent = 'Chargement...';
  try{
    const { data, error } = await _supa.rpc('list_users_with_roles');
    if(error) throw error;
    if(!data || data.length === 0){ listEl.textContent = 'Aucun utilisateur trouvé.'; return; }
    listEl.innerHTML = data.map(u => {
      const role = u.role || 'user';
      const badge = role === 'admin'
        ? '<span style="color:var(--gold);font-size:0.65rem">👑 admin</span>'
        : '<span style="color:var(--muted);font-size:0.65rem">👤 user</span>';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--white);font-size:0.75rem">${u.email}</span>
        ${badge}
      </div>`;
    }).join('');
  } catch(e){
    listEl.innerHTML = `<span style="color:#ff6b6b;font-size:0.72rem">Erreur: ${e?.message||e}</span>`;
  }
}


// ===== ADMIN DASHBOARD PAGE =====

async function supaRetry(fn, retries=5, delayMs=1000){
  for(let i=0;i<retries;i++){
    try{ return await fn(); }
    catch(e){
      const msg = e?.message||'';
      const isLock = msg.includes('lock') || msg.includes('stole') || msg.includes('57014') || msg.includes('timeout');
      if(isLock && i < retries-1){
        await new Promise(r=>setTimeout(r, delayMs*(i+1)));
        continue;
      }
      throw e;
    }
  }
}

async function loadAdminPage(){
  if(!isAdmin()) return;
  document.getElementById('admin-stat-total').textContent = '—';
  document.getElementById('admin-stat-today').textContent = '—';
  document.getElementById('admin-stat-week').textContent = '—';
  document.getElementById('admin-stat-admins').textContent = '—';
  document.getElementById('admin-users-list-full').innerHTML = '<div class="admin-empty">Loading...</div>';
  document.getElementById('admin-chart-bars').innerHTML = '<div class="admin-empty" style="width:100%">Loading chart...</div>';

  // Step 1: pending requests (isolated, first)
  await loadPendingRequests();

  // Step 2: users list — wait after pending to avoid lock contention
  await new Promise(r=>setTimeout(r,1200));
  try {
    const data = await supaRetry(async()=>{
      const {data,error} = await _supa.rpc('list_users_with_roles');
      if(error) throw error;
      return data;
    });
    _adminAllUsers = data || [];
    renderAdminStats();
    renderAdminChart();
    renderAdminUsersList();
  } catch(e){
    document.getElementById('admin-users-list-full').innerHTML =
      `<div class="admin-empty" style="color:#ff6b6b">Error: ${e?.message||e}<br><small>Make sure the Supabase SQL functions are created.</small></div>`;
  }

  // Step 3: presence
  await new Promise(r=>setTimeout(r,1200));
  await fetchPresence();
  renderAdminUsersList();

  // Step 4: documents
  await new Promise(r=>setTimeout(r,1200));
  await adminLoadDocs();
}

let _adminAllDocs = [];
let _adminDocSearch = '';

async function adminLoadDocs(){
  if(!isAdmin()) return;
  const el = document.getElementById('admin-docs-list');
  if(el) el.innerHTML = '<div class="admin-empty">Loading...</div>';
  try{
    const data = await supaRetry(async()=>{
      const {data,error} = await _supa.from('pdf_files').select('*').order('added_at_ts',{ascending:false});
      if(error) throw error;
      return data;
    });
    _adminAllDocs = data || [];
    renderAdminDocs();
  }catch(e){
    if(el) el.innerHTML = `<div class="admin-empty" style="color:#ff6b6b">Error: ${e?.message||'Could not load documents'}</div>`;
  }
}

function adminFilterDocs(){
  _adminDocSearch = (document.getElementById('admin-doc-search')?.value||'').trim().toLowerCase();
  renderAdminDocs();
}

async function adminDeleteDoc(id, storagePath){
  if(!confirm('Delete this document?')) return;
  try{
    await _supa.storage.from('pdfs').remove([storagePath]);
    await _supa.from('pdf_files').delete().eq('id',id);
    showToast('Document deleted');
    adminLoadDocs();
  }catch(e){
    showToast('Error: '+(e.message||'Could not delete'));
  }
}

function renderAdminDocs(){
  const el = document.getElementById('admin-docs-list');
  if(!el) return;
  const fmt=b=>b>1024*1024?(b/1024/1024).toFixed(1)+' MB':Math.round(b/1024)+' KB';
  let docs = _adminAllDocs;
  if(_adminDocSearch) docs = docs.filter(d=>(d.name||'').toLowerCase().includes(_adminDocSearch));
  if(!docs.length){ el.innerHTML='<div class="admin-empty">No documents found.</div>'; return; }
  el.innerHTML = docs.map(d=>`
    <div class="admin-user-row" style="flex-wrap:wrap;gap:8px">
      <div style="font-size:1.4rem;flex-shrink:0">📄</div>
      <div class="admin-user-info" style="min-width:0;flex:1">
        <div class="admin-user-email" style="font-weight:600">${escapeHtml(d.name||'Untitled')}</div>
        <div class="admin-user-date">${d.user_id||'?'} · ${fmt(d.size||0)} · ${d.added_at||''}</div>
      </div>
      <button onclick="adminDeleteDoc('${d.id}','${d.storage_path}')" style="padding:5px 12px;background:transparent;border:1px solid var(--red);border-radius:5px;color:#ff6b6b;font-family:'DM Sans',sans-serif;font-size:0.72rem;cursor:pointer;flex-shrink:0">🗑 Delete</button>
    </div>`).join('');
}

function renderAdminStats(){
  const users = _adminAllUsers;
  const total = users.length;
  const admins = users.filter(u => u.role === 'admin').length;

  const now = new Date();
  const todayStr = now.toDateString();
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);

  const toDay = users.filter(u => {
    if(!u.created_at) return false;
    return new Date(u.created_at).toDateString() === todayStr;
  }).length;
  const thisWeek = users.filter(u => {
    if(!u.created_at) return false;
    return new Date(u.created_at) >= weekAgo;
  }).length;

  document.getElementById('admin-stat-total').textContent = total;
  document.getElementById('admin-stat-total-sub').textContent = `${admins} admin${admins!==1?'s':''}, ${total-admins} user${total-admins!==1?'s':''}`;
  document.getElementById('admin-stat-today').textContent = toDay;
  document.getElementById('admin-stat-today-sub').textContent = toDay > 0 ? '🆕 New signups!' : 'No signups yet';
  document.getElementById('admin-stat-week').textContent = thisWeek;
  document.getElementById('admin-stat-week-sub').textContent = 'Last 7 days';
  document.getElementById('admin-stat-admins').textContent = admins;
  document.getElementById('admin-stat-admins-sub').textContent = admins === 1 ? 'Only you' : `${admins} admins`;
}

function renderAdminChart(){
  const users = _adminAllUsers;
  const bars = document.getElementById('admin-chart-bars');
  const days = [];
  for(let i = 6; i >= 0; i--){
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push({ date: d, label: d.toLocaleDateString('en',{weekday:'short'}), count: 0 });
  }
  users.forEach(u => {
    if(!u.created_at) return;
    const ud = new Date(u.created_at).toDateString();
    days.forEach(d => { if(d.date.toDateString() === ud) d.count++; });
  });
  const max = Math.max(...days.map(d => d.count), 1);
  bars.innerHTML = days.map(d => {
    const h = Math.max(Math.round((d.count / max) * 96), d.count > 0 ? 4 : 2);
    const isToday = d.date.toDateString() === new Date().toDateString();
    return `<div class="admin-bar-col">
      <div class="admin-bar-val">${d.count > 0 ? d.count : ''}</div>
      <div class="admin-bar" style="height:${h}px;opacity:${isToday?'1':'0.55'};background:${isToday?'var(--gold)':'var(--blue)'}"></div>
      <div class="admin-bar-label" style="color:${isToday?'var(--gold)':'var(--muted)'}">${d.label}</div>
    </div>`;
  }).join('');
}

function renderAdminUsersList(){
  if(!Array.isArray(_adminAllUsers)) return;
  const search = (document.getElementById('admin-user-search')?.value||'').toLowerCase();
  const list = document.getElementById('admin-users-list-full');
  const now = new Date();

  let filtered = _adminAllUsers.filter(u => {
    const matchRole = _adminRoleFilter === 'all' || u.role === _adminRoleFilter;
    const matchSearch = !search || (u.email||'').toLowerCase().includes(search);
    return matchRole && matchSearch;
  });

  if(filtered.length === 0){
    list.innerHTML = '<div class="admin-empty">No users found.</div>';
    return;
  }

  list.innerHTML = filtered.map(u => {
    const role = u.role || 'user';
    const initial = (u.email||'?')[0].toUpperCase();
    const created = u.created_at ? new Date(u.created_at) : null;
    const dateStr = created ? created.toLocaleDateString('en',{day:'numeric',month:'short',year:'numeric'}) : '—';
    const diffMs = created ? now - created : null;
    const isNew = diffMs !== null && diffMs < 7 * 24 * 60 * 60 * 1000;
    const isAdm = role === 'admin';
    // Presence
    const presenceTs = _userPresence[u.email];
    let dotClass = 'offline', dotTitle = 'Offline';
    if(presenceTs){
      const diffSec = (Date.now() - presenceTs) / 1000;
      if(diffSec < 45){ dotClass = 'online'; dotTitle = 'Online'; }
      else if(diffSec < 180){ dotClass = 'away'; dotTitle = 'Away'; }
    }
    return `<div class="admin-user-row">
      <div class="admin-avatar-wrap">
        <div class="admin-user-avatar ${isAdm?'is-admin':''}">${initial}</div>
        <span class="status-dot ${dotClass}" title="${dotTitle}"></span>
      </div>
      <div class="admin-user-info">
        <div class="admin-user-email">${u.email||'—'}${isNew ? '<span class="admin-new-badge">NEW</span>' : ''}</div>
        <div class="admin-user-date">Joined ${dateStr} · <span style="color:${dotClass==='online'?'var(--green)':dotClass==='away'?'var(--gold)':'var(--muted)'}">${dotTitle}</span></div>
      </div>
      <span class="admin-role-badge ${role}">
        ${role === 'admin' ? '👑 admin' : role === 'pending' ? '🕒 pending' : '👤 user'}
      </span>
      <select class="admin-role-select" onchange="adminChangeRole('${u.email}', this.value, this)">
        <option value="pending" ${role==='pending'?'selected':''}>Pending</option>
        <option value="user" ${role==='user'?'selected':''}>User</option>
        <option value="admin" ${role==='admin'?'selected':''}>Admin</option>
      </select>
    </div>`;
  }).join('');
}

function adminFilterUsers(){
  if(!_adminAllUsers || !_adminAllUsers.length) return;
  renderAdminUsersList();
}
// ===== PENDING REQUESTS =====
async function loadPendingRequests(){
  const list = document.getElementById('admin-pending-list');
  const badge = document.getElementById('pending-count-badge');
  if(!list) return;
  list.innerHTML = '<div class="admin-empty">Laden...</div>';
  try{
    const {data, error} = await _supa.from('pending_users').select('*').eq('status','pending').order('created_at',{ascending:false});
    if(error) throw error;
    const count = data ? data.length : 0;
    if(badge){
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
    if(!data || count === 0){
      list.innerHTML = '<div class="admin-empty" style="color:var(--green)">✓ Keine ausstehenden Anfragen</div>';
      return;
    }
    list.innerHTML = data.map(r => {
      const date = r.created_at ? new Date(r.created_at).toLocaleDateString('en',{day:'numeric',month:'short',year:'numeric'}) : '—';
      return `<div class="pending-row" id="prow-${r.id}">
        <div class="pending-info">
          <div class="pending-email">${r.email}</div>
          ${r.full_name ? `<div class="pending-name">👤 ${r.full_name}</div>` : ''}
          ${r.reason ? `<div class="pending-reason">💬 "${r.reason}"</div>` : ''}
        </div>
        <div class="pending-date">${date}</div>
        <div class="pending-actions">
          <button class="pending-approve-btn" onclick="approvePendingRequest('${r.id}','${r.email}',this)">✓ Genehmigen</button>
          <button class="pending-reject-btn" onclick="rejectPendingRequest('${r.id}',this)">✗ Ablehnen</button>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    list.innerHTML = `<div class="admin-empty" style="color:var(--red)">Fehler: ${e.message||String(e)}</div>`;
  }
}

async function approvePendingRequest(id, email, btn){
  if(!isAdmin()) return;
  const row = document.getElementById('prow-'+id);
  if(btn){ btn.disabled=true; btn.textContent='...'; }
  const rejectBtn = row ? row.querySelector('.pending-reject-btn') : null;
  if(rejectBtn) rejectBtn.disabled=true;
  try{
    // 1. Invite the user — they get an email to set their password
    const {error:invErr} = await _supa.auth.admin.inviteUserByEmail(email);
    if(invErr) throw invErr;
    // 2. Mark as approved
    const {error:upErr} = await _supa.from('pending_users').update({status:'approved'}).eq('id',id);
    if(upErr) throw upErr;
    if(row) row.remove();
    showToast('✓ Einladung gesendet an ' + email);
    // Update badge count
    const badge = document.getElementById('pending-count-badge');
    if(badge){
      const n = parseInt(badge.textContent||'0') - 1;
      badge.textContent = n;
      badge.style.display = n > 0 ? 'inline-block' : 'none';
    }
    const list = document.getElementById('admin-pending-list');
    if(list && !list.querySelector('.pending-row')){
      list.innerHTML = '<div class="admin-empty" style="color:var(--green)">✓ Keine ausstehenden Anfragen</div>';
    }
  }catch(e){
    showToast('✗ Fehler: ' + (e?.message||String(e)));
    if(btn){ btn.disabled=false; btn.textContent='✓ Genehmigen'; }
    if(rejectBtn) rejectBtn.disabled=false;
  }
}

async function rejectPendingRequest(id, btn){
  if(!isAdmin()) return;
  if(!confirm('Anfrage wirklich ablehnen?')) return;
  const row = document.getElementById('prow-'+id);
  if(btn){ btn.disabled=true; btn.textContent='...'; }
  try{
    const {error} = await _supa.from('pending_users').update({status:'rejected'}).eq('id',id);
    if(error) throw error;
    if(row) row.remove();
    showToast('Anfrage abgelehnt.');
    const badge = document.getElementById('pending-count-badge');
    if(badge){
      const n = parseInt(badge.textContent||'0') - 1;
      badge.textContent = n;
      badge.style.display = n > 0 ? 'inline-block' : 'none';
    }
    const list = document.getElementById('admin-pending-list');
    if(list && !list.querySelector('.pending-row')){
      list.innerHTML = '<div class="admin-empty" style="color:var(--green)">✓ Keine ausstehenden Anfragen</div>';
    }
  }catch(e){
    showToast('✗ Fehler: ' + (e?.message||String(e)));
    if(btn){ btn.disabled=false; btn.textContent='✗ Ablehnen'; }
  }
}

function adminSetFilter(role, btn){
  _adminRoleFilter = role;
  document.querySelectorAll('.admin-filter-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderAdminUsersList();
}

async function adminChangeRole(email, newRole, selectEl){
  if(!isAdmin()) return;
  selectEl.disabled = true;
  try {
    const { error } = await _supa.rpc('set_user_role', { target_email: email, new_role: newRole });
    if(error) throw error;
    // Update local data
    const u = _adminAllUsers.find(x => x.email === email);
    if(u) u.role = newRole;
    showToast(`✓ ${email} → ${newRole}`);
    renderAdminStats();
    renderAdminUsersList();
  } catch(e) {
    showToast('✗ ' + (e?.message||String(e)));
    selectEl.disabled = false;
  }
}

/* ===== QR / BARCODE SCANNER ===== */
let _scanStream=null,_scanTimer=null,_scanCanvas=null,_scanCtx=null,_scanTab='camera';

function openScannerModal(){
  document.getElementById('scanner-modal').classList.add('open');
  document.getElementById('scanner-result-area').classList.remove('visible');
  if(_scanTab==='camera') startCamera();
}

function closeScannerModal(){
  stopCamera();
  document.getElementById('scanner-modal').classList.remove('open');
  document.getElementById('scanner-result-area').classList.remove('visible');
}

function switchScannerTab(tab){
  _scanTab=tab;
  document.getElementById('tab-camera').classList.toggle('active',tab==='camera');
  document.getElementById('tab-image').classList.toggle('active',tab==='image');
  document.getElementById('scanner-camera-panel').style.display=tab==='camera'?'':'none';
  document.getElementById('scanner-image-panel').style.display=tab==='image'?'':'none';
  document.getElementById('scanner-result-area').classList.remove('visible');
  if(tab==='camera'){startCamera();}else{stopCamera();}
}

async function startCamera(){
  const wrap=document.getElementById('scanner-video-wrap');
  const video=document.getElementById('scanner-video');
  try{
    _scanStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    video.srcObject=_scanStream;
    video.play();
    video.onloadedmetadata=()=>{ startScanLoop(video); };
    document.getElementById('scanner-hint').textContent='Point the camera at a QR code or barcode';
  }catch(err){
    wrap.innerHTML='<div class="scanner-camera-err"><div class="err-icon">\uD83D\uDEAB</div><div>Camera access denied.<br>Please allow camera permissions and try again,<br>or use the <strong>Upload Image</strong> tab instead.</div></div>';
  }
}

function stopCamera(){
  clearInterval(_scanTimer);_scanTimer=null;
  if(_scanStream){_scanStream.getTracks().forEach(t=>t.stop());_scanStream=null;}
}

function startScanLoop(video){
  if(!_scanCanvas){_scanCanvas=document.createElement('canvas');_scanCtx=_scanCanvas.getContext('2d',{willReadFrequently:true});}
  clearInterval(_scanTimer);
  _scanTimer=setInterval(async()=>{
    if(video.readyState<2||video.paused)return;
    _scanCanvas.width=video.videoWidth;_scanCanvas.height=video.videoHeight;
    _scanCtx.drawImage(video,0,0);
    const result=await decodeFrame(_scanCanvas,_scanCtx);
    if(result){
      clearInterval(_scanTimer);
      showScanResult(result);
      document.getElementById('scanner-hint').textContent='\u2705 Code read! See result below.';
    }
  },300);
}

async function decodeFrame(canvas,ctx){
  if('BarcodeDetector' in window){
    try{
      const bd=new BarcodeDetector({formats:['qr_code','ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','data_matrix','pdf417','aztec','codabar']});
      const codes=await bd.detect(canvas);
      if(codes.length>0)return codes[0].rawValue;
    }catch(e){}
  }
  try{
    if(!window.jsQR){
      await loadScript('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js');
    }
    const imageData=ctx.getImageData(0,0,canvas.width,canvas.height);
    const code=window.jsQR(imageData.data,canvas.width,canvas.height,{inversionAttempts:'dontInvert'});
    if(code)return code.data;
  }catch(e){}
  return null;
}

function loadScript(src){
  return new Promise((res,rej)=>{
    const s=document.createElement('script');s.src=src;
    s.onload=res;s.onerror=rej;document.head.appendChild(s);
  });
}

async function scanFromImage(event){
  const file=event.target.files[0];
  if(!file)return;
  document.getElementById('scanner-result-area').classList.remove('visible');
  const img=new Image();
  const url=URL.createObjectURL(file);
  img.onload=async()=>{
    if(!_scanCanvas){_scanCanvas=document.createElement('canvas');_scanCtx=_scanCanvas.getContext('2d',{willReadFrequently:true});}
    _scanCanvas.width=img.naturalWidth;_scanCanvas.height=img.naturalHeight;
    _scanCtx.drawImage(img,0,0);
    URL.revokeObjectURL(url);
    const result=await decodeFrame(_scanCanvas,_scanCtx);
    if(result){showScanResult(result);}
    else{showToast('\u26A0\uFE0F No code found in that image');}
    event.target.value='';
  };
  img.src=url;
}

function showScanResult(value){
  const area=document.getElementById('scanner-result-area');
  document.getElementById('scanner-result-text').textContent=value;
  const actions=document.getElementById('scanner-result-actions');
  actions.innerHTML='';
  const copyBtn=document.createElement('button');
  copyBtn.className='scanner-result-btn primary';
  copyBtn.textContent='\uD83D\uDCCB Copy';
  copyBtn.onclick=()=>{navigator.clipboard.writeText(value).then(()=>showToast('\u2713 Copied!'));};
  actions.appendChild(copyBtn);
  const isUrl=/^https?:\/\//i.test(value)||/^www\./i.test(value);
  if(isUrl){
    const openBtn=document.createElement('button');
    openBtn.className='scanner-result-btn';
    openBtn.textContent='\uD83D\uDD17 Open Link';
    openBtn.onclick=()=>{window.open(value.startsWith('http')?value:'https://'+value,'_blank');};
    actions.appendChild(openBtn);
  }
  const againBtn=document.createElement('button');
  againBtn.className='scanner-result-btn';
  againBtn.textContent='\uD83D\uDD04 Scan Again';
  againBtn.onclick=()=>{
    area.classList.remove('visible');
    if(_scanTab==='camera'){
      document.getElementById('scanner-hint').textContent='Point the camera at a QR code or barcode';
      startScanLoop(document.getElementById('scanner-video'));
    }
  };
  actions.appendChild(againBtn);
  area.classList.add('visible');
}

/* ==== extracted from index.html ==== */

// ===== HAND-CRAFTED QUESTION BANK =====
// 180 questions: A1/A2/B1 × grammar/vocabulary/reading, 20 each

const QUESTION_BANK = {
  A1: {
    grammar: [
      {q:"Welcher Artikel passt? ___ Mann ist nett.", options:["Der","Die","Das","Den"], correct:0, explanation:"'Mann' ist maskulin → der Mann."},
      {q:"Ergänze: Ich ___ aus Deutschland.", options:["bin","bist","ist","sind"], correct:0, explanation:"Ich + sein → ich bin."},
      {q:"Was ist die richtige Form? Sie (haben) ___ ein Buch.", options:["hat","haben","habe","hast"], correct:0, explanation:"Sie (3. Person Singular) → hat."},
      {q:"Welcher Artikel? ___ Kind spielt.", options:["Das","Der","Die","Den"], correct:0, explanation:"'Kind' ist neutral → das Kind."},
      {q:"Ergänze: Du ___ sehr schön.", options:["bist","bin","ist","sind"], correct:0, explanation:"Du + sein → du bist."},
      {q:"Wähle die richtige Form: Er ___ Hunger.", options:["hat","haben","habe","hast"], correct:0, explanation:"Er (3. Person Singular) → hat."},
      {q:"Welcher Artikel? ___ Frau liest.", options:["Die","Der","Das","Den"], correct:0, explanation:"'Frau' ist feminin → die Frau."},
      {q:"Ergänze: Wir ___ Freunde.", options:["sind","bin","bist","ist"], correct:0, explanation:"Wir + sein → wir sind."},
      {q:"Was ist Plural von 'das Auto'?", options:["die Autos","die Auto","der Autos","das Autos"], correct:0, explanation:"Auto → Autos (Plural mit -s, Artikel immer die)."},
      {q:"Welche Verneinung ist korrekt? Ich habe ___ Hund.", options:["keinen","kein","keine","nicht"], correct:0, explanation:"'Hund' ist maskulin im Akkusativ → keinen Hund."},
      {q:"Richtige Wortstellung? ___ du Deutsch?", options:["Sprichst","Spreche","Spricht","Sprechen"], correct:0, explanation:"Frage mit du → Sprichst du?"},
      {q:"Ergänze: Das Buch ist ___.", options:["interessant","interessante","interessanter","interessantes"], correct:0, explanation:"Nach 'sein' wird das Adjektiv nicht gebeugt."},
      {q:"Welcher Artikel im Akkusativ? Ich sehe ___ Mann.", options:["den","der","die","das"], correct:0, explanation:"Maskulin im Akkusativ → den."},
      {q:"Was ist korrekt? Wir ___ jeden Tag.", options:["lernen","lerne","lernst","lernt"], correct:0, explanation:"Wir + lernen → wir lernen."},
      {q:"Wie sagt man Verneinung? Er kommt ___.", options:["nicht","kein","keine","keinen"], correct:0, explanation:"Bei Verben verwendet man 'nicht'."},
      {q:"Welches Possessivpronomen? ___ Name ist Max. (ich)", options:["Mein","Dein","Sein","Ihr"], correct:0, explanation:"Ich → mein (maskulin)."},
      {q:"Korrekte Form: Die Kinder ___ laut.", options:["sind","ist","bin","bist"], correct:0, explanation:"Die Kinder (Plural) + sein → sind."},
      {q:"Welcher Artikel? ___ Apfel ist rot.", options:["Der","Die","Das","Den"], correct:0, explanation:"'Apfel' ist maskulin → der Apfel."},
      {q:"Ergänze: Ich ___ gern Musik.", options:["höre","hört","hören","hörst"], correct:0, explanation:"Ich + hören → ich höre."},
      {q:"Plural von 'die Frau'?", options:["die Frauen","die Fraus","die Frau","der Frauen"], correct:0, explanation:"Frau → Frauen (Plural mit -en)."},
      {q:"Ergänze: ___ du alt?", options:["Bist","Bin","Ist","Sind"], correct:0, explanation:"Die Frage an du → Bist du alt?"},
      {q:"Plural von 'der Tisch'?", options:["die Tische","die Tisch","der Tische","das Tische"], correct:0, explanation:"Plural: die Tische."},
      {q:"Was ist korrekt? Wir ___ in der Schule.", options:["sind","ist","bin","bist"], correct:0, explanation:"Wir sind in der Schule."}
    ],
    vocabulary: [
      {q:"Was bedeutet 'Hund'?", options:["dog","cat","bird","fish"], correct:0, explanation:"Hund = dog auf Englisch."},
      {q:"Wie sagt man 'hello' auf Deutsch?", options:["Hallo","Tschüss","Danke","Bitte"], correct:0, explanation:"'Hallo' ist die deutsche Begrüßung."},
      {q:"Was ist 'Brot' auf Englisch?", options:["bread","butter","milk","water"], correct:0, explanation:"Brot = bread."},
      {q:"Welche Zahl ist 'fünfzehn'?", options:["15","50","5","51"], correct:0, explanation:"fünfzehn = 15."},
      {q:"Was bedeutet 'rot'?", options:["red","blue","green","yellow"], correct:0, explanation:"rot = red."},
      {q:"Wie heißt Montag auf Englisch?", options:["Monday","Tuesday","Sunday","Friday"], correct:0, explanation:"Montag = Monday."},
      {q:"Was ist 'Wasser' auf Englisch?", options:["water","wine","juice","milk"], correct:0, explanation:"Wasser = water."},
      {q:"Was bedeutet 'groß'?", options:["big/tall","small","old","new"], correct:0, explanation:"groß = big oder tall."},
      {q:"Wie sagt man 'thank you' auf Deutsch?", options:["Danke","Bitte","Entschuldigung","Hallo"], correct:0, explanation:"Danke = thank you."},
      {q:"Was ist 'Haus' auf Englisch?", options:["house","car","school","street"], correct:0, explanation:"Haus = house."},
      {q:"Was bedeutet 'kalt'?", options:["cold","hot","warm","cool"], correct:0, explanation:"kalt = cold."},
      {q:"Welcher Monat ist 'März'?", options:["March","May","June","February"], correct:0, explanation:"März = March."},
      {q:"Was ist 'Schule' auf Englisch?", options:["school","church","hospital","library"], correct:0, explanation:"Schule = school."},
      {q:"Was bedeutet 'schnell'?", options:["fast","slow","far","near"], correct:0, explanation:"schnell = fast."},
      {q:"Wie sagt man 'yes' auf Deutsch?", options:["Ja","Nein","Vielleicht","Natürlich"], correct:0, explanation:"Ja = yes."},
      {q:"Was ist 'Katze' auf Englisch?", options:["cat","dog","mouse","bird"], correct:0, explanation:"Katze = cat."},
      {q:"Was bedeutet 'alt'?", options:["old","new","young","big"], correct:0, explanation:"alt = old."},
      {q:"Wie sagt man 'good morning' auf Deutsch?", options:["Guten Morgen","Guten Abend","Gute Nacht","Guten Tag"], correct:0, explanation:"Guten Morgen = good morning."},
      {q:"Was ist 'Milch' auf Englisch?", options:["milk","water","juice","tea"], correct:0, explanation:"Milch = milk."},
      {q:"Was bedeutet 'klein'?", options:["small","big","tall","long"], correct:0, explanation:"klein = small."},
      {q:"Was bedeutet 'Freund'?", options:["friend","enemy","brother","father"], correct:0, explanation:"Freund = friend."},
      {q:"Wie sagt man 'good night' auf Deutsch?", options:["Gute Nacht","Guten Morgen","Guten Tag","Auf Wiedersehen"], correct:0, explanation:"Gute Nacht = good night."},
      {q:"Was ist 'Mutter' auf Englisch?", options:["mother","father","daughter","sister"], correct:0, explanation:"Mutter = mother."}
    ],
    reading: [
      {q:"'Ich heiße Anna.' Was erfahren wir?", options:["Ihren Namen","Ihr Alter","Ihre Stadt","Ihren Beruf"], correct:0, explanation:"'Ich heiße' = mein Name ist → wir erfahren den Namen."},
      {q:"'Das Wetter ist heute schön.' Wie ist das Wetter?", options:["schön","schlecht","kalt","regnerisch"], correct:0, explanation:"Das Adjektiv 'schön' beschreibt das Wetter."},
      {q:"'Der Zug kommt um 9 Uhr.' Wann kommt der Zug?", options:["um 9 Uhr","um 6 Uhr","um 12 Uhr","um 3 Uhr"], correct:0, explanation:"'um 9 Uhr' gibt die Uhrzeit an."},
      {q:"'Maria kauft Brot und Milch.' Was kauft sie?", options:["Brot und Milch","Brot und Käse","Milch und Käse","Brot und Butter"], correct:0, explanation:"Der Satz nennt genau: Brot und Milch."},
      {q:"'Peter ist Arzt.' Was ist Peters Beruf?", options:["Arzt","Lehrer","Koch","Fahrer"], correct:0, explanation:"'ist Arzt' = Beruf ist Arzt."},
      {q:"'Das Kind schläft.' Was macht das Kind?", options:["schlafen","spielen","essen","lesen"], correct:0, explanation:"'schläft' = to sleep (3. Person Singular)."},
      {q:"'Der Supermarkt ist um 8 Uhr geöffnet.' Wann öffnet er?", options:["um 8 Uhr","um 9 Uhr","um 10 Uhr","um 7 Uhr"], correct:0, explanation:"'um 8 Uhr geöffnet' = opens at 8."},
      {q:"'Ich trinke Kaffee.' Was trinke ich?", options:["Kaffee","Tee","Wasser","Saft"], correct:0, explanation:"'Ich trinke Kaffee' = I drink coffee."},
      {q:"'Die Katze sitzt auf dem Sofa.' Wo ist die Katze?", options:["auf dem Sofa","unter dem Tisch","im Garten","vor der Tür"], correct:0, explanation:"'auf dem Sofa' = on the sofa."},
      {q:"'Es ist sehr heiß heute.' Wie ist das Wetter?", options:["heiß","kalt","windig","regnerisch"], correct:0, explanation:"'heiß' = hot."},
      {q:"'Wir essen um 12 Uhr Mittag.' Wann essen sie?", options:["um 12 Uhr","um 13 Uhr","um 11 Uhr","um 14 Uhr"], correct:0, explanation:"um 12 Uhr = at 12 o'clock."},
      {q:"'Meine Mutter heißt Lisa.' Wer heißt Lisa?", options:["die Mutter","die Schwester","die Freundin","die Tochter"], correct:0, explanation:"'Meine Mutter heißt Lisa' = the mother's name is Lisa."},
      {q:"'Das Buch kostet fünf Euro.' Was kostet es?", options:["5 Euro","10 Euro","15 Euro","2 Euro"], correct:0, explanation:"'fünf Euro' = five euros."},
      {q:"'Ich gehe heute ins Kino.' Wohin geht er/sie?", options:["ins Kino","in die Schule","in den Park","ins Restaurant"], correct:0, explanation:"'ins Kino gehen' = to go to the cinema."},
      {q:"'Tom hat zwei Schwestern.' Wie viele Schwestern hat Tom?", options:["zwei","eine","drei","keine"], correct:0, explanation:"'zwei Schwestern' = two sisters."},
      {q:"'Die Bibliothek ist links.' Wo ist die Bibliothek?", options:["links","rechts","geradeaus","hinten"], correct:0, explanation:"'links' = left."},
      {q:"'Es regnet.' Wie ist das Wetter?", options:["Es regnet.","Es scheint die Sonne.","Es ist windig.","Es ist kalt."], correct:0, explanation:"'Es regnet' = it is raining."},
      {q:"'Ich lerne Deutsch seit drei Monaten.' Wie lange lerne ich?", options:["drei Monate","drei Jahre","drei Wochen","drei Tage"], correct:0, explanation:"'seit drei Monaten' = for three months."},
      {q:"'Das Restaurant ist zu.' Was bedeutet 'zu'?", options:["geschlossen","geöffnet","voll","leer"], correct:0, explanation:"'zu' = closed in this context."},
      {q:"'Anna arbeitet als Lehrerin.' Was ist Annas Beruf?", options:["Lehrerin","Ärztin","Köchin","Verkäuferin"], correct:0, explanation:"'arbeitet als Lehrerin' = works as a teacher."},
      {q:"'Paul spielt Fußball im Park.' Was macht Paul?", options:["Fußball spielen","Tennis spielen","Schwimmen","Lesen"], correct:0, explanation:"Er spielt Fußball."},
      {q:"'Sie liest ein interessantes Buch.' Was liest sie?", options:["ein Buch","eine Zeitung","eine Zeitschrift","einen Brief"], correct:0, explanation:"Sie liest ein Buch."},
      {q:"'Der Arzt arbeitet im Krankenhaus.' Wo arbeitet der Arzt?", options:["im Krankenhaus","in der Schule","im Büro","im Restaurant"], correct:0, explanation:"Er arbeitet im Krankenhaus."}
    ]
  },
  A2: {
    grammar: [
      {q:"Welche Form ist korrekt? Gestern ___ ich ins Kino gegangen.", options:["bin","habe","war","hatte"], correct:0, explanation:"'gehen' bildet Perfekt mit 'sein' → bin gegangen."},
      {q:"Ergänze mit Dativ: Ich helfe ___ Frau.", options:["der","die","das","den"], correct:0, explanation:"'helfen' verlangt Dativ, feminin Dativ → der."},
      {q:"Welche Konjunktion passt? Ich lerne Deutsch, ___ ich nach Deutschland fahren möchte.", options:["weil","aber","und","oder"], correct:0, explanation:"'weil' gibt den Grund an, Verb ans Ende."},
      {q:"Richtige Präposition: Ich fahre ___ Bus.", options:["mit dem","in den","auf dem","von dem"], correct:0, explanation:"Transportmittel: mit dem Bus."},
      {q:"Ergänze: Das ist das Buch, ___ ich gelesen habe.", options:["das","die","der","den"], correct:0, explanation:"Relativpronomen für neutrales Nomen im Akkusativ → das."},
      {q:"Welche Form? Sie hat das Buch ___.", options:["gelesen","liest","las","lesen"], correct:0, explanation:"Perfekt mit haben → Partizip II: gelesen."},
      {q:"Korrekte Steigerung: Heute ist es ___ als gestern.", options:["kälter","kälterer","am kältesten","kalt"], correct:0, explanation:"Komparativ von 'kalt' → kälter."},
      {q:"Präposition: Das Buch liegt ___ dem Tisch.", options:["auf","in","an","bei"], correct:0, explanation:"'auf dem Tisch' = on the table (Lage → Dativ)."},
      {q:"Welches Modalverb? Du ___ lauter sprechen.", options:["sollst","musst","kannst","darfst"], correct:0, explanation:"'sollst' = you should (Aufforderung)."},
      {q:"Perfekt von 'schreiben': Er hat einen Brief ___.", options:["geschrieben","schreiben","schrieb","schreibt"], correct:0, explanation:"Perfekt Partizip II von schreiben → geschrieben."},
      {q:"Richtige Wortstellung: ___ kommt er nach Hause?", options:["Wann","Was","Wer","Wie"], correct:0, explanation:"Nach Uhrzeit/Zeit fragt man mit 'wann'."},
      {q:"Dativ Plural: Ich gebe ___ Kindern Geschenke.", options:["den","die","der","das"], correct:0, explanation:"Dativ Plural → den (alle Genera)."},
      {q:"Welche Form? Wenn ich Zeit ___, komme ich.", options:["hätte","habe","hatte","haben"], correct:0, explanation:"Konjunktiv II von haben → hätte (Hypothese)."},
      {q:"Akkusativ: Er kauft ___ neuen Computer.", options:["einen","ein","eine","einem"], correct:0, explanation:"Computer ist maskulin, Akkusativ → einen."},
      {q:"Korrekte Negation: Ich ___ morgen arbeiten.", options:["muss nicht","nicht muss","muss kein","kein muss"], correct:0, explanation:"Modalverb + Negation: muss nicht."},
      {q:"Reflexivpronomen: Ich ___ sehr gefreut.", options:["habe mich","habe mir","bin mich","bin mir"], correct:0, explanation:"sich freuen → habe mich gefreut (Perfekt)."},
      {q:"Genitiv: Das ist das Auto ___ Mannes.", options:["des","dem","den","der"], correct:0, explanation:"Genitiv maskulin → des Mannes."},
      {q:"Trennbares Verb: Er ___ um 7 Uhr ___. (aufstehen)", options:["steht / auf","aufsteht / —","steh / auf","steht auf / —"], correct:0, explanation:"Trennbares Verb: Präfix ans Ende → steht...auf."},
      {q:"Komparativ: Dieses Buch ist ___ interessant als jenes.", options:["interessanter","mehr interessant","am interessantesten","interessantest"], correct:0, explanation:"Komparativ: -er anhängen → interessanter."},
      {q:"Welche Präposition? Das Bild hängt ___ der Wand.", options:["an","auf","in","vor"], correct:0, explanation:"Bilder hängen an der Wand (Lage → Dativ)."},
      {q:"Ergänze: ___ der Tag, an dem du geboren bist?", options:["Welcher","Welche","Welches","Wer"], correct:0, explanation:"Tag (maskulin) → welcher Tag."},
      {q:"Richtige Form: ___ du schon einmal in Berlin ___? (sein)", options:["Bist / gewesen","Warst / gewesen","Bist / war","War / warst"], correct:0, explanation:"Perfekt: Bist du schon einmal in Berlin gewesen?"},
      {q:"Welche Präposition? Ich interessiere mich ___ Musik.", options:["für","auf","an","mit"], correct:0, explanation:"sich interessieren für."}
    ],
    vocabulary: [
      {q:"Was bedeutet 'Krankenhaus'?", options:["hospital","pharmacy","clinic","school"], correct:0, explanation:"Krankenhaus = hospital."},
      {q:"Was ist das Gegenteil von 'kaufen'?", options:["verkaufen","bezahlen","kosten","handeln"], correct:0, explanation:"Das Gegenteil von kaufen ist verkaufen."},
      {q:"Was bedeutet 'Entschuldigung'?", options:["excuse me / sorry","thank you","please","goodbye"], correct:0, explanation:"Entschuldigung = excuse me oder sorry."},
      {q:"Was ist 'Bahnhof' auf Englisch?", options:["train station","bus stop","airport","harbour"], correct:0, explanation:"Bahnhof = train station."},
      {q:"Was bedeutet 'eigentlich'?", options:["actually","probably","always","never"], correct:0, explanation:"eigentlich = actually."},
      {q:"Was ist das Gegenteil von 'früh'?", options:["spät","langsam","kurz","wenig"], correct:0, explanation:"Das Gegenteil von früh ist spät."},
      {q:"Was bedeutet 'ungefähr'?", options:["approximately","exactly","always","never"], correct:0, explanation:"ungefähr = approximately."},
      {q:"Was ist 'Rathaus' auf Englisch?", options:["town hall","court house","school","office"], correct:0, explanation:"Rathaus = town hall."},
      {q:"Was bedeutet 'Ferien'?", options:["holidays / vacation","weekdays","weekends","work"], correct:0, explanation:"Ferien = holidays or vacation."},
      {q:"Was ist das Gegenteil von 'anfangen'?", options:["aufhören","weitermachen","beginnen","starten"], correct:0, explanation:"Das Gegenteil von anfangen ist aufhören."},
      {q:"Was bedeutet 'trotzdem'?", options:["nevertheless","therefore","however","although"], correct:0, explanation:"trotzdem = nevertheless / anyway."},
      {q:"Was ist 'Schlüssel' auf Englisch?", options:["key","lock","door","handle"], correct:0, explanation:"Schlüssel = key."},
      {q:"Was bedeutet 'pünktlich'?", options:["on time","too late","too early","always"], correct:0, explanation:"pünktlich = on time / punctual."},
      {q:"Was ist das Gegenteil von 'laut'?", options:["leise","ruhig","still","leiser"], correct:0, explanation:"Das Gegenteil von laut ist leise."},
      {q:"Was bedeutet 'Zeitung'?", options:["newspaper","book","magazine","letter"], correct:0, explanation:"Zeitung = newspaper."},
      {q:"Was ist 'Urlaub' auf Englisch?", options:["holiday / vacation","work","school","weekend"], correct:0, explanation:"Urlaub = holiday or vacation."},
      {q:"Was bedeutet 'sofort'?", options:["immediately","later","soon","never"], correct:0, explanation:"sofort = immediately / right away."},
      {q:"Was ist 'Brücke' auf Englisch?", options:["bridge","road","river","tunnel"], correct:0, explanation:"Brücke = bridge."},
      {q:"Was bedeutet 'deshalb'?", options:["therefore","however","but","although"], correct:0, explanation:"deshalb = therefore / that's why."},
      {q:"Was ist das Gegenteil von 'vergessen'?", options:["erinnern","denken","wissen","kennen"], correct:0, explanation:"Das Gegenteil von vergessen ist sich erinnern."},
      {q:"Was bedeutet 'bequem'?", options:["comfortable","difficult","heavy","expensive"], correct:0, explanation:"bequem = comfortable."},
      {q:"Was ist das Gegenteil von 'hoch'?", options:["niedrig","groß","klein","weit"], correct:0, explanation:"hoch vs niedrig."},
      {q:"Was bedeutet 'Zukunft'?", options:["future","past","present","history"], correct:0, explanation:"Zukunft = future."}
    ],
    reading: [
      {q:"'Der Zug hat Verspätung wegen des schlechten Wetters.' Warum hat der Zug Verspätung?", options:["wegen des Wetters","wegen eines Unfalls","wegen Bauarbeiten","wegen der Ferien"], correct:0, explanation:"'wegen des schlechten Wetters' = because of bad weather."},
      {q:"'Obwohl es regnet, gehen sie spazieren.' Was machen sie trotz des Regens?", options:["spazieren gehen","zu Hause bleiben","ins Kino gehen","einkaufen"], correct:0, explanation:"'Obwohl' = although → sie gehen trotzdem spazieren."},
      {q:"'Das Geschäft öffnet montags bis freitags von 9 bis 18 Uhr.' Wann ist es geöffnet?", options:["Mo–Fr 9–18 Uhr","Mo–Sa 9–18 Uhr","täglich 9–18 Uhr","Mo–Fr 8–17 Uhr"], correct:0, explanation:"'montags bis freitags von 9 bis 18 Uhr' = Mo–Fr 9 to 18."},
      {q:"'Anna hat ihr Buch vergessen, deshalb kann sie nicht lernen.' Warum kann sie nicht lernen?", options:["Sie hat ihr Buch vergessen.","Sie ist krank.","Sie hat keine Zeit.","Das Buch ist langweilig."], correct:0, explanation:"'deshalb' verknüpft Ursache und Folge."},
      {q:"'Bitte rufen Sie mich morgen zwischen 10 und 12 Uhr an.' Wann soll man anrufen?", options:["zwischen 10 und 12 Uhr","vor 10 Uhr","nach 12 Uhr","heute Abend"], correct:0, explanation:"'zwischen 10 und 12 Uhr' = between 10 and 12."},
      {q:"'Die Wohnung hat drei Zimmer, eine Küche und ein Bad.' Wie viele Zimmer hat die Wohnung?", options:["drei","vier","fünf","zwei"], correct:0, explanation:"'drei Zimmer' = three rooms (Küche und Bad zählen extra)."},
      {q:"'Er arbeitet seit fünf Jahren als Ingenieur.' Was ist sein Beruf?", options:["Ingenieur","Arzt","Lehrer","Manager"], correct:0, explanation:"'arbeitet als Ingenieur' = works as an engineer."},
      {q:"'Wenn das Wetter schön ist, fahren wir ans Meer.' Was ist die Bedingung?", options:["gutes Wetter","freier Tag","kein Geld","keine Zeit"], correct:0, explanation:"'Wenn...schön ist' = if the weather is nice."},
      {q:"'Das Konzert beginnt um 20 Uhr und dauert zwei Stunden.' Wann endet es?", options:["um 22 Uhr","um 21 Uhr","um 23 Uhr","um 20:30 Uhr"], correct:0, explanation:"20 Uhr + 2 Stunden = 22 Uhr."},
      {q:"'Sie hat die Prüfung nicht bestanden, weil sie nicht gelernt hat.' Was war das Problem?", options:["Sie hat nicht gelernt.","Sie war krank.","Die Prüfung war zu schwer.","Sie hatte kein Buch."], correct:0, explanation:"'weil sie nicht gelernt hat' = because she didn't study."},
      {q:"'Ich suche eine Wohnung mit Balkon in der Nähe des Zentrums.' Was ist wichtig?", options:["Balkon und zentrale Lage","Garten und Garage","große Küche","günstiger Preis"], correct:0, explanation:"Die Anzeige nennt: Balkon und Nähe zum Zentrum."},
      {q:"'Morgen ist Markt. Man kann dort frisches Gemüse und Obst kaufen.' Was kann man kaufen?", options:["Gemüse und Obst","Fleisch und Fisch","Brot und Käse","Kleidung und Schuhe"], correct:0, explanation:"'frisches Gemüse und Obst' sind explizit genannt."},
      {q:"'Er hat angerufen, aber niemand hat abgenommen.' Was ist passiert?", options:["Niemand hat das Telefon beantwortet.","Das Telefon war kaputt.","Er hatte die falsche Nummer.","Das Netz war weg."], correct:0, explanation:"'niemand hat abgenommen' = nobody answered."},
      {q:"'Die Bibliothek ist am Wochenende geschlossen.' Wann kann man nicht hin?", options:["am Wochenende","abends","früh morgens","an Feiertagen"], correct:0, explanation:"'am Wochenende geschlossen' = closed on weekends."},
      {q:"'Er spricht drei Sprachen: Deutsch, Englisch und Arabisch.' Wie viele Sprachen spricht er?", options:["drei","zwei","vier","fünf"], correct:0, explanation:"Drei Sprachen werden aufgezählt."},
      {q:"'Kinder unter 12 Jahren zahlen die Hälfte.' Was zahlen 10-jährige Kinder?", options:["die Hälfte des Preises","nichts","den vollen Preis","ein Drittel"], correct:0, explanation:"'unter 12 Jahren → die Hälfte'."},
      {q:"'Das Hotel liegt direkt am Strand.' Wo liegt das Hotel?", options:["am Strand","im Stadtzentrum","am Bahnhof","im Wald"], correct:0, explanation:"'direkt am Strand' = right on the beach."},
      {q:"'Wegen Krankheit bleibt das Büro heute geschlossen.' Warum ist das Büro zu?", options:["wegen Krankheit","wegen Ferien","wegen Umbau","wegen Feiertag"], correct:0, explanation:"'wegen Krankheit' = due to illness."},
      {q:"'Sie lernt Deutsch, um in Deutschland studieren zu können.' Warum lernt sie Deutsch?", options:["um in Deutschland zu studieren","um Freunde zu finden","um zu reisen","um zu arbeiten"], correct:0, explanation:"'um...zu' drückt den Zweck aus."},
      {q:"'Der Kurs findet dienstags und donnerstags statt.' An welchen Tagen?", options:["Dienstag und Donnerstag","Montag und Mittwoch","Mittwoch und Freitag","Montag und Freitag"], correct:0, explanation:"'dienstags und donnerstags' = Tuesdays and Thursdays."},
      {q:"'Sie hat den Zug verpasst, weil er zu spät war.' Was hat sie verpasst?", options:["den Zug","den Bus","das Flugzeug","die Straßenbahn"], correct:0, explanation:"Sie hat den Zug verpasst."},
      {q:"'Wir müssen einkaufen gehen, da der Kühlschrank leer ist.' Warum gehen sie einkaufen?", options:["Der Kühlschrank ist leer.","Sie haben Hunger.","Es regnet.","Sie haben keine Zeit."], correct:0, explanation:"Der Kühlschrank ist leer."},
      {q:"'Obwohl er müde war, half er seiner Freundin beim Umzug.' Was tat er?", options:["Er half seiner Freundin.","Er ging schlafen.","Er ging ins Kino.","Er arbeitete nicht."], correct:0, explanation:"Er half beim Umzug."}
    ]
  },
  B1: {
    grammar: [
      {q:"Passiv: Das Buch ___ vom Lehrer empfohlen.", options:["wird","ist","hat","sein"], correct:0, explanation:"Passiv Präsens: wird + Partizip II."},
      {q:"Konjunktiv II: Wenn ich reich wäre, ___ ich eine Weltreise machen.", options:["würde","werde","bin","wäre"], correct:0, explanation:"Konjunktiv II Folgesatz: würde + Infinitiv."},
      {q:"Infinitivkonstruktion: Sie versucht, täglich ___ zu üben.", options:["Klavier","Klaviers","dem Klavier","das Klavier"], correct:0, explanation:"'Klavier üben' = üben ohne Artikel. Oder: das Klavierspielen. Hier: Klavier üben → Klavier."},
      {q:"Welche Form? Er ___ schon gegessen haben, bevor sie ankam.", options:["soll","muss","darf","kann"], correct:0, explanation:"'soll...haben' = epistemic modality (it is said that he...)."},
      {q:"Relativsatz: Das ist der Mann, ___ ich das Buch gegeben habe.", options:["dem","der","den","dessen"], correct:0, explanation:"'geben' + Dativ: dem Mann (maskulin Dativ) → dem."},
      {q:"Indirekte Rede: Er sagte, er ___ krank.", options:["sei","ist","war","wäre"], correct:0, explanation:"Indirekte Rede: Konjunktiv I von 'sein' → sei."},
      {q:"Zweiteilige Konjunktion: ___ ich Hunger habe, ___ ich nicht.", options:["Obwohl / esse","Weil / esse","Wenn / esse","Als / aß"], correct:0, explanation:"'Obwohl' drückt einen Gegensatz aus."},
      {q:"Nominalisierung: Das ___ des Projekts war schwierig.", options:["Durchführen","Durchführung","Durchführe","Durchgeführt"], correct:0, explanation:"Nominalisierung von Verben: die Durchführung."},
      {q:"Passiv Perfekt: Das Haus ___ gebaut worden.", options:["ist","hat","wird","wurde"], correct:0, explanation:"Passiv Perfekt: ist + Partizip II + worden."},
      {q:"Konzessivsatz: ___ er müde war, arbeitete er weiter.", options:["Obwohl","Weil","Wenn","Da"], correct:0, explanation:"'obwohl' = although → konzessiv."},
      {q:"Genitiv: Trotz ___ schlechten Wetters gingen sie spazieren.", options:["des","dem","den","der"], correct:0, explanation:"'trotz' + Genitiv; Wetter ist neutral → des."},
      {q:"Futur II: Bis morgen ___ er die Arbeit fertig ___ haben.", options:["wird / gemacht","hat / gemacht","wird / machen","ist / gemacht"], correct:0, explanation:"Futur II: wird + Partizip II + haben."},
      {q:"Welche Verbform? Er ___ das Problem lösen können.", options:["hätte","würde","sollte","könnte"], correct:0, explanation:"Konjunktiv II von können → könnte."},
      {q:"Zweiteilige Konjunktion: ___ ...___ er kommt, bleibt er länger.", options:["Wenn / auch","Sowohl / als auch","Entweder / oder","Weder / noch"], correct:0, explanation:"'Wenn...auch' = even if."},
      {q:"Attribut: Das ist ein ___ gelöstes Problem.", options:["gut","gutes","gute","gutem"], correct:0, explanation:"Nach unbestimmtem Artikel, neutral, Nominativ → gutes."},
      {q:"Kausalsatz: ___ der Zug Verspätung hatte, kamen wir zu spät.", options:["Da","Obwohl","Wenn","Als"], correct:0, explanation:"'Da' = since/because (kausal)."},
      {q:"Infinitiv mit zu: Er bat mich, ___ zu kommen.", options:["früher","früh","frühzeitig","frühes"], correct:0, explanation:"Adjektiv als Adverb: früher (komparativ) = earlier."},
      {q:"Welches Adjektiv? Das war eine ___ Entscheidung.", options:["schwierige","schwieriger","schwierigen","schwierigem"], correct:0, explanation:"Nach unbestimmtem Artikel, feminin, Nominativ → schwierige."},
      {q:"Passiv mit Modalverb: Das Problem ___ gelöst werden.", options:["muss","ist","hat","wird"], correct:0, explanation:"Modalverb + Passiv: muss + Partizip II + werden."},
      {q:"Temporalsatz: ___ sie ankam, hatte er schon gegessen.", options:["Als","Wenn","Während","Bevor"], correct:0, explanation:"'Als' = when (einmalig in der Vergangenheit)."},
      {q:"Konjunktiv I: Er sagt, er ___ morgen kommen. (kommen)", options:["komme","kommt","gekommen","käme"], correct:0, explanation:"Konjunktiv I in indirekter Rede: komme."},
      {q:"Adjektivdeklination: Das ___ Auto wurde repariert.", options:["defekte","defekter","defektes","defekten"], correct:0, explanation:"Nach bestimmtem Artikel, neutrum, Nominativ → defekte."},
      {q:"Finalsatz: Ich lerne Deutsch, ___ in Deutschland zu arbeiten.", options:["um","damit","dass","ob"], correct:0, explanation:"Finalsatz mit Infinitiv + zu: um ... zu."}
    ],
    vocabulary: [
      {q:"Was bedeutet 'die Beziehung'?", options:["relationship","position","question","decision"], correct:0, explanation:"Beziehung = relationship."},
      {q:"Was ist das Synonym von 'beginnen'?", options:["anfangen","aufhören","beenden","abbrechen"], correct:0, explanation:"beginnen = anfangen (synonym)."},
      {q:"Was bedeutet 'die Herausforderung'?", options:["challenge","experience","opportunity","danger"], correct:0, explanation:"Herausforderung = challenge."},
      {q:"Was ist das Gegenteil von 'erfolgreich'?", options:["erfolglos","schlecht","schwach","arm"], correct:0, explanation:"Das Gegenteil von erfolgreich ist erfolglos."},
      {q:"Was bedeutet 'nachhaltig'?", options:["sustainable","temporary","efficient","modern"], correct:0, explanation:"nachhaltig = sustainable."},
      {q:"Was ist ein Synonym von 'wichtig'?", options:["bedeutsam","interessant","nützlich","bekannt"], correct:0, explanation:"wichtig ≈ bedeutsam (bedeutend)."},
      {q:"Was bedeutet 'die Voraussetzung'?", options:["prerequisite / requirement","result","conclusion","suggestion"], correct:0, explanation:"Voraussetzung = prerequisite or requirement."},
      {q:"Was ist das Gegenteil von 'zustimmen'?", options:["ablehnen","antworten","fragen","schweigen"], correct:0, explanation:"Das Gegenteil von zustimmen ist ablehnen."},
      {q:"Was bedeutet 'aufgrund'?", options:["due to / because of","despite","without","against"], correct:0, explanation:"aufgrund = due to / because of."},
      {q:"Was ist ein Synonym von 'erklären'?", options:["erläutern","fragen","antworten","zeigen"], correct:0, explanation:"erklären ≈ erläutern."},
      {q:"Was bedeutet 'die Gelegenheit'?", options:["opportunity","problem","solution","question"], correct:0, explanation:"Gelegenheit = opportunity."},
      {q:"Was ist das Gegenteil von 'öffentlich'?", options:["privat","persönlich","intern","geheim"], correct:0, explanation:"Das Gegenteil von öffentlich ist privat."},
      {q:"Was bedeutet 'verursachen'?", options:["to cause","to prevent","to solve","to avoid"], correct:0, explanation:"verursachen = to cause."},
      {q:"Was ist ein Synonym von 'schnell'?", options:["rasch","langsam","ruhig","spät"], correct:0, explanation:"schnell ≈ rasch."},
      {q:"Was bedeutet 'die Auswirkung'?", options:["impact / effect","cause","reason","solution"], correct:0, explanation:"Auswirkung = impact or effect."},
      {q:"Was ist das Gegenteil von 'zunehmen'?", options:["abnehmen","sinken","fallen","verlieren"], correct:0, explanation:"Das Gegenteil von zunehmen ist abnehmen."},
      {q:"Was bedeutet 'im Gegensatz zu'?", options:["in contrast to","in addition to","because of","instead of"], correct:0, explanation:"im Gegensatz zu = in contrast to."},
      {q:"Was ist ein Synonym von 'versuchen'?", options:["probieren","machen","wollen","können"], correct:0, explanation:"versuchen ≈ probieren."},
      {q:"Was bedeutet 'die Maßnahme'?", options:["measure / action","law","rule","decision"], correct:0, explanation:"Maßnahme = measure or action taken."},
      {q:"Was ist das Gegenteil von 'erlauben'?", options:["verbieten","fordern","verlangen","befehlen"], correct:0, explanation:"Das Gegenteil von erlauben ist verbieten."},
      {q:"Was bedeutet 'die Bevölkerung'?", options:["population","government","company","education"], correct:0, explanation:"Bevölkerung = population."},
      {q:"Was ist ein Synonym von 'verhindern'?", options:["stoppen","erlauben","fördern","unterstützen"], correct:0, explanation:"verhindern ≈ stoppen."},
      {q:"Was bedeutet 'die Bestätigung'?", options:["confirmation","rejection","condition","assumption"], correct:0, explanation:"Bestätigung = confirmation."}
    ],
    wortschatz: [
      // ── Berufe (Jobs & Professions) ──
      {q:"Was bedeutet 'der Rechtsanwalt'?", options:["lawyer","doctor","engineer","accountant"], correct:0, explanation:"Rechtsanwalt = lawyer."},
      {q:"Was ist 'die Krankenschwester' auf Englisch?", options:["nurse","midwife","pharmacist","surgeon"], correct:0, explanation:"Krankenschwester = nurse (female)."},
      {q:"Was bedeutet 'der Handwerker'?", options:["tradesman / craftsman","factory worker","office worker","manager"], correct:0, explanation:"Handwerker = craftsman or tradesperson."},
      {q:"Was ist 'der Buchhalter' auf Englisch?", options:["accountant","bookseller","librarian","auditor"], correct:0, explanation:"Buchhalter = accountant."},
      {q:"Was bedeutet 'die Selbstständigkeit'?", options:["self-employment","unemployment","retirement","promotion"], correct:0, explanation:"Selbstständigkeit = self-employment or independence."},
      {q:"Was ist das Synonym von 'berufstätig'?", options:["erwerbstätig","arbeitslos","beschäftigt","berufslos"], correct:0, explanation:"berufstätig ≈ erwerbstätig (employed)."},
      {q:"Was bedeutet 'die Vollzeitstelle'?", options:["full-time position","part-time position","internship","temporary job"], correct:0, explanation:"Vollzeitstelle = full-time job."},
      {q:"Was ist 'der Kollege' auf Englisch?", options:["colleague","boss","employee","client"], correct:0, explanation:"Kollege = colleague."},
      {q:"Was bedeutet 'kündigen'?", options:["to resign / to fire","to hire","to apply","to promote"], correct:0, explanation:"kündigen = to resign (oneself) or to terminate (someone)."},
      {q:"Was ist 'das Gehalt' auf Englisch?", options:["salary","bonus","pension","tax"], correct:0, explanation:"Gehalt = salary."},
      // ── Bewerbung (Job Application) ──
      {q:"Was bedeutet 'der Lebenslauf'?", options:["CV / résumé","cover letter","reference","contract"], correct:0, explanation:"Lebenslauf = CV or résumé."},
      {q:"Was ist 'das Vorstellungsgespräch'?", options:["job interview","introductory letter","presentation","performance review"], correct:0, explanation:"Vorstellungsgespräch = job interview."},
      {q:"Was bedeutet 'die Bewerbung'?", options:["application","advertisement","qualification","recommendation"], correct:0, explanation:"Bewerbung = application (for a job)."},
      {q:"Was ist 'die Arbeitserfahrung' auf Englisch?", options:["work experience","qualification","training","internship"], correct:0, explanation:"Arbeitserfahrung = work experience."},
      {q:"Was bedeutet 'die Qualifikation'?", options:["qualification","motivation","position","promotion"], correct:0, explanation:"Qualifikation = qualification."},
      {q:"Was ist ein Synonym von 'bewerben (sich)'?", options:["kandidieren","kündigen","beschäftigen","einarbeiten"], correct:0, explanation:"sich bewerben ≈ kandidieren (to apply, to be a candidate)."},
      {q:"Was bedeutet 'das Anschreiben'?", options:["cover letter","attachment","reference letter","employment contract"], correct:0, explanation:"Anschreiben = cover letter."},
      {q:"Was ist 'der Arbeitgeber' auf Englisch?", options:["employer","employee","manager","recruiter"], correct:0, explanation:"Arbeitgeber = employer."},
      {q:"Was bedeutet 'die Probezeit'?", options:["probationary period","work break","overtime","annual leave"], correct:0, explanation:"Probezeit = probationary / trial period."},
      {q:"Was ist 'die Stellenanzeige'?", options:["job advertisement","job contract","salary slip","application form"], correct:0, explanation:"Stellenanzeige = job advertisement."},
      // ── Umwelt (Environment) ──
      {q:"Was bedeutet 'die Nachhaltigkeit'?", options:["sustainability","recycling","pollution","conservation"], correct:0, explanation:"Nachhaltigkeit = sustainability."},
      {q:"Was ist 'der Klimawandel' auf Englisch?", options:["climate change","global warming","air pollution","natural disaster"], correct:0, explanation:"Klimawandel = climate change."},
      {q:"Was bedeutet 'die Treibhausgase'?", options:["greenhouse gases","exhaust fumes","industrial waste","chemical gases"], correct:0, explanation:"Treibhausgase = greenhouse gases."},
      {q:"Was ist das Synonym von 'umweltfreundlich'?", options:["ökologisch","umweltschädlich","industriell","synthetisch"], correct:0, explanation:"umweltfreundlich ≈ ökologisch (eco-friendly)."},
      {q:"Was bedeutet 'erneuerbare Energien'?", options:["renewable energies","nuclear energy","fossil fuels","electrical energy"], correct:0, explanation:"erneuerbare Energien = renewable energies."},
      {q:"Was ist 'die Abfallentsorgung'?", options:["waste disposal","waste production","recycling center","landfill"], correct:0, explanation:"Abfallentsorgung = waste disposal."},
      {q:"Was bedeutet 'die Luftverschmutzung'?", options:["air pollution","water pollution","soil contamination","noise pollution"], correct:0, explanation:"Luftverschmutzung = air pollution."},
      {q:"Was ist 'das Recycling' auf Deutsch?", options:["das Recycling / Wiederverwertung","die Entsorgung","der Abfall","der Müll"], correct:0, explanation:"Recycling = Wiederverwertung in German."},
      {q:"Was bedeutet 'der Naturschutz'?", options:["nature conservation","nature documentary","natural history","national park"], correct:0, explanation:"Naturschutz = nature conservation."},
      {q:"Was ist 'die Überschwemmung'?", options:["flood","drought","earthquake","storm"], correct:0, explanation:"Überschwemmung = flood."},
      // ── Gesellschaft (Society) ──
      {q:"Was bedeutet 'die Integration'?", options:["integration","immigration","assimilation","migration"], correct:0, explanation:"Integration = integration into society."},
      {q:"Was ist 'die Gleichberechtigung'?", options:["equal rights","human rights","civil rights","voting rights"], correct:0, explanation:"Gleichberechtigung = equal rights / gender equality."},
      {q:"Was bedeutet 'die Demokratie'?", options:["democracy","monarchy","dictatorship","republic"], correct:0, explanation:"Demokratie = democracy."},
      {q:"Was ist 'die Armut' auf Englisch?", options:["poverty","inequality","unemployment","homelessness"], correct:0, explanation:"Armut = poverty."},
      {q:"Was bedeutet 'die Meinungsfreiheit'?", options:["freedom of speech","freedom of movement","freedom of religion","freedom of press"], correct:0, explanation:"Meinungsfreiheit = freedom of speech / opinion."},
      {q:"Was ist ein Synonym von 'gemeinschaftlich'?", options:["kollektiv","privat","individuell","persönlich"], correct:0, explanation:"gemeinschaftlich ≈ kollektiv (collective, communal)."},
      {q:"Was bedeutet 'die Diskriminierung'?", options:["discrimination","segregation","prejudice","stereotype"], correct:0, explanation:"Diskriminierung = discrimination."},
      {q:"Was ist 'das Ehrenamt'?", options:["voluntary work","honorary title","civil service","part-time job"], correct:0, explanation:"Ehrenamt = voluntary/honorary work."},
      {q:"Was bedeutet 'der demografische Wandel'?", options:["demographic change","economic change","political change","social change"], correct:0, explanation:"demografischer Wandel = demographic change (aging population etc.)."},
      {q:"Was ist 'die Sozialhilfe'?", options:["social welfare / benefits","social insurance","pension","health insurance"], correct:0, explanation:"Sozialhilfe = social welfare benefits."},
      // ── Gesundheit (Health) ──
      {q:"Was bedeutet 'die Krankenversicherung'?", options:["health insurance","life insurance","accident insurance","pension insurance"], correct:0, explanation:"Krankenversicherung = health insurance."},
      {q:"Was ist 'das Rezept' im medizinischen Kontext?", options:["prescription","recipe","diagnosis","treatment"], correct:0, explanation:"Rezept = prescription (in a medical context)."},
      {q:"Was bedeutet 'die Vorsorge'?", options:["prevention / precaution","treatment","recovery","diagnosis"], correct:0, explanation:"Vorsorge = prevention or precautionary care."},
      {q:"Was ist 'der Facharzt'?", options:["specialist / consultant","GP","surgeon","pharmacist"], correct:0, explanation:"Facharzt = medical specialist."},
      {q:"Was bedeutet 'die Nebenwirkung'?", options:["side effect","main effect","overdose","allergic reaction"], correct:0, explanation:"Nebenwirkung = side effect."},
      {q:"Was ist 'die Notaufnahme'?", options:["emergency room","outpatient clinic","waiting room","operating theatre"], correct:0, explanation:"Notaufnahme = emergency room / A&E."},
      {q:"Was bedeutet 'psychische Gesundheit'?", options:["mental health","physical health","emotional well-being","social health"], correct:0, explanation:"psychische Gesundheit = mental health."},
      {q:"Was ist 'die Genesung'?", options:["recovery","illness","treatment","diagnosis"], correct:0, explanation:"Genesung = recovery (from illness)."},
      {q:"Was bedeutet 'ausgewogen'?", options:["balanced","healthy","nutritious","organic"], correct:0, explanation:"ausgewogen = balanced (e.g., ausgewogene Ernährung = balanced diet)."},
      {q:"Was ist 'die Impfung'?", options:["vaccination","injection","blood test","surgery"], correct:0, explanation:"Impfung = vaccination."},
      // ── Kommunikation (Communication) ──
      {q:"Was bedeutet 'missverständlich'?", options:["misleading / ambiguous","understandable","clear","polite"], correct:0, explanation:"missverständlich = prone to misunderstanding, ambiguous."},
      {q:"Was ist 'die Verhandlung'?", options:["negotiation","presentation","conversation","discussion"], correct:0, explanation:"Verhandlung = negotiation."},
      {q:"Was bedeutet 'überzeugen'?", options:["to convince / persuade","to inform","to argue","to explain"], correct:0, explanation:"überzeugen = to convince or persuade."},
      {q:"Was ist 'das Missverständnis'?", options:["misunderstanding","disagreement","conflict","argument"], correct:0, explanation:"Missverständnis = misunderstanding."},
      {q:"Was bedeutet 'sich äußern'?", options:["to express oneself","to listen","to agree","to be silent"], correct:0, explanation:"sich äußern = to express oneself / make a statement."},
      {q:"Was ist ein Synonym von 'mitteilen'?", options:["informieren","verstehen","antworten","fragen"], correct:0, explanation:"mitteilen ≈ informieren (to inform, to communicate)."},
      {q:"Was bedeutet 'die Stellungnahme'?", options:["statement / position","argument","question","answer"], correct:0, explanation:"Stellungnahme = official statement or position."},
      {q:"Was ist 'höflich' auf Englisch?", options:["polite","friendly","respectful","formal"], correct:0, explanation:"höflich = polite."},
      {q:"Was bedeutet 'schriftlich'?", options:["in writing / written","verbally","officially","formally"], correct:0, explanation:"schriftlich = in writing."},
      {q:"Was ist 'die Zusammenfassung'?", options:["summary","conclusion","introduction","paragraph"], correct:0, explanation:"Zusammenfassung = summary."}
    ],
    reading: [
      {q:"'Trotz steigender Preise kaufen viele Deutsche weiterhin Bio-Produkte.' Was zeigt das?", options:["Bio bleibt beliebt trotz höherer Kosten.","Bio wird billiger.","Niemand kauft mehr Bio.","Preise sinken."], correct:0, explanation:"'trotz steigender Preise...weiterhin' = despite higher prices, still buying."},
      {q:"'Die Studie zeigt, dass regelmäßige Bewegung das Risiko von Herzerkrankungen um 30% senkt.' Was ist das Ergebnis?", options:["Sport reduziert Herzerkrankungen deutlich.","Sport hat keinen Effekt.","Herzerkrankungen steigen.","30% aller Menschen sind krank."], correct:0, explanation:"'senkt...um 30%' = reduces by 30%."},
      {q:"'Aufgrund des demografischen Wandels wird die Rentenversicherung reformiert.' Was ist der Grund?", options:["demografischer Wandel","wirtschaftliche Krise","politische Entscheidung","technischer Fortschritt"], correct:0, explanation:"'aufgrund des demografischen Wandels' = due to demographic change."},
      {q:"'Wer bis Freitag kündigt, erhält eine Abfindung.' Was ist die Bedingung?", options:["Kündigung bis Freitag","Kündigung bis Montag","Kündigung im Januar","sofortige Kündigung"], correct:0, explanation:"'Wer bis Freitag kündigt' = those who resign by Friday."},
      {q:"'Obwohl die Wirtschaft wächst, steigt die Arbeitslosigkeit.' Was ist das Problem?", options:["Arbeitslosigkeit wächst trotz Wirtschaftswachstum.","Die Wirtschaft schrumpft.","Die Arbeitslosigkeit sinkt.","Alles ist positiv."], correct:0, explanation:"'Obwohl...wächst, steigt...' = contradiction."},
      {q:"'Das Projekt wurde wegen Budgetproblemen auf nächstes Jahr verschoben.' Was passierte?", options:["Es wird später realisiert.","Es wurde abgesagt.","Es begann früher.","Das Budget wurde erhöht."], correct:0, explanation:"'verschoben' = postponed."},
      {q:"'Je mehr man liest, desto besser wird man im Schreiben.' Was ist die Aussage?", options:["Lesen verbessert das Schreiben.","Schreiben ist unwichtig.","Lesen macht müde.","Schreiben ist schwieriger als Lesen."], correct:0, explanation:"'Je mehr...desto besser' = the more...the better."},
      {q:"'Die Maßnahmen zur Reduzierung von CO₂ sind umstritten.' Was bedeutet 'umstritten'?", options:["controversial","effective","popular","new"], correct:0, explanation:"umstritten = controversial, disputed."},
      {q:"'Angesichts der Klimakrise fordern Experten sofortige Maßnahmen.' Was fordern Experten?", options:["sofortiges Handeln","mehr Studien","weniger Regulierung","spätere Entscheidungen"], correct:0, explanation:"'sofortige Maßnahmen' = immediate measures."},
      {q:"'Das Unternehmen hat seine Produktion ins Ausland verlagert, um Kosten zu senken.' Was war das Ziel?", options:["Kostenreduzierung","mehr Qualität","neue Märkte","bessere Mitarbeiter"], correct:0, explanation:"'um Kosten zu senken' = in order to reduce costs."},
      {q:"'Nicht nur Kinder, sondern auch Erwachsene profitieren von Bewegung.' Was sagt der Text?", options:["Alle Altersgruppen profitieren.","Nur Kinder profitieren.","Erwachsene profitieren nicht.","Bewegung schadet."], correct:0, explanation:"'nicht nur...sondern auch' = not only...but also."},
      {q:"'Immer mehr Menschen arbeiten im Homeoffice, was sowohl Vor- als auch Nachteile hat.' Was ist die Hauptaussage?", options:["Homeoffice hat Pros und Cons.","Homeoffice ist perfekt.","Homeoffice sollte verboten werden.","Homeoffice ist selten."], correct:0, explanation:"'sowohl...als auch' = both...and."},
      {q:"'Die Stadt investiert in den Ausbau des öffentlichen Nahverkehrs.' Warum?", options:["Um Mobilität zu verbessern.","Um Autos zu fördern.","Um Geld zu sparen.","Um Parkplätze zu schaffen."], correct:0, explanation:"Investition in ÖPNV = improving public mobility."},
      {q:"'Laut einer Umfrage sind 70% der Deutschen mit ihrem Leben zufrieden.' Was zeigt die Umfrage?", options:["Die meisten Deutschen sind zufrieden.","70% sind unzufrieden.","Alle sind glücklich.","Niemand ist zufrieden."], correct:0, explanation:"70% = die Mehrheit → die meisten."},
      {q:"'Das Gesetz tritt am 1. Januar in Kraft.' Was passiert am 1. Januar?", options:["Das Gesetz wird gültig.","Das Gesetz wird abgeschafft.","Das Gesetz wird diskutiert.","Das Gesetz wird geschrieben."], correct:0, explanation:"'in Kraft treten' = to come into effect."},
      {q:"'Sowohl die Regierung als auch die Opposition unterstützt das Projekt.' Was sagt der Text?", options:["Alle politischen Seiten sind dafür.","Nur die Regierung ist dafür.","Nur die Opposition ist dafür.","Niemand unterstützt es."], correct:0, explanation:"'sowohl...als auch' = both sides support it."},
      {q:"'Das Angebot gilt nur solange der Vorrat reicht.' Was bedeutet das?", options:["Das Angebot ist begrenzt.","Das Angebot ist unbegrenzt.","Es gibt kein Angebot.","Das Angebot läuft ewig."], correct:0, explanation:"'solange der Vorrat reicht' = while supplies last."},
      {q:"'Wegen anhaltender Trockenheit drohen Ernteausfälle.' Was ist die Folge der Trockenheit?", options:["Schlechtere Ernte","Bessere Ernte","Mehr Regen","Günstigere Preise"], correct:0, explanation:"'Ernteausfälle' = crop failures due to drought."},
      {q:"'Die Konferenz brachte keine konkreten Ergebnisse.' Was bedeutet das?", options:["Es wurden keine klaren Beschlüsse gefasst.","Die Konferenz war sehr erfolgreich.","Viele Ergebnisse wurden erzielt.","Die Konferenz wurde abgesagt."], correct:0, explanation:"'keine konkreten Ergebnisse' = no concrete results."},
      {q:"'Im Vergleich zum Vorjahr sind die Temperaturen gestiegen.' Was hat sich verändert?", options:["Es ist wärmer als letztes Jahr.","Es ist kälter als letztes Jahr.","Die Temperaturen sind gleich.","Das Wetter ist besser."], correct:0, explanation:"'gestiegen' = increased → wärmer."},
      {q:"'Die Regierung plant Maßnahmen, um die Wirtschaft anzukurbeln.' Was will die Regierung tun?", options:["die Wirtschaft stimulieren","Steuern erhöhen","die Wirtschaft schwächen","die Industrie schließen"], correct:0, explanation:"'anzukurbeln' bedeutet 'to stimulate'."},
      {q:"'Angesichts des starken Wettbewerbs muss das Unternehmen innovativ sein.' Warum muss es innovativ sein?", options:["wegen des starken Wettbewerbs","wegen des hohen Gewinns","wegen der guten Produkte","wegen der niedrigen Kosten"], correct:0, explanation:"Der Wettbewerb zwingt zur Innovation."},
      {q:"'Der Professor betonte die Bedeutung von Bildung für die Zukunft.' Was betonte der Professor?", options:["die Bedeutung von Bildung","die Höhe der Kosten","den Spaß am Lernen","die Gefahr von Technik"], correct:0, explanation:"Er betonte die Bedeutung von Bildung."}
    ]
  }
};

// ===== QUIZ / LEVEL PAGE INIT =====
function initQuizPage() {}
function initLevelPage() {
  const area = document.getElementById('level-area');
  if (area && area.querySelector('.level-start-card')) return;
  if (area && !area.querySelector('.quiz-card') && !area.querySelector('.level-result-card')) {
    area.innerHTML = `<div class="level-start-card">
      <div class="level-start-icon">🎯</div>
      <div class="level-start-title">Wie gut ist dein Deutsch?</div>
      <div class="level-start-desc">Mach einen adaptiven Test mit 20 Fragen. Das System passt sich deinen Antworten an, um dein genaues Niveau (A1 bis B2) zu ermitteln.</div>
      <button class="level-start-btn" onclick="startLevelTest()">Test starten</button>
    </div>`;
  }
}

// ===== QUIZ FEATURE =====
let _quizData = [];
let _quizAnswered = 0;
let _quizScore = 0;

// ====== Quiz Timer and Scoreboard ======
// Maximum time per question in seconds
const QUIZ_MAX_TIME = 30;
// Current timer ID and remaining time
let quizTimerId = null;
let quizTimeLeft = 0;
// Track current quiz topic and difficulty for reporting
let currentQuizTopic = '';
let currentQuizDifficulty = '';

/**
 * Start the countdown timer for the given question index.  This creates
 * a one-second interval that updates the corresponding timer bar.
 * When time reaches zero, the question is automatically marked wrong.
 */
function startQuizTimer(qIdx){
  resetQuizTimer();
  quizTimeLeft = QUIZ_MAX_TIME;
  const timerEl = document.getElementById('quiz-timer-' + qIdx);
  if(!timerEl) return;
  // Ensure the bar is full at start
  timerEl.style.width = '100%';
  timerEl.style.background = 'var(--red)';
  quizTimerId = setInterval(() => {
    quizTimeLeft--;
    const pct = Math.max((quizTimeLeft / QUIZ_MAX_TIME) * 100, 0);
    timerEl.style.width = pct + '%';
    if(quizTimeLeft <= 0){
      // Time out: mark as wrong (-1 index)
      resetQuizTimer();
      answerQuiz(qIdx, -1);
    }
  }, 1000);
}

/**
 * Clear any existing quiz timer interval.
 */
function resetQuizTimer(){
  if(quizTimerId){
    clearInterval(quizTimerId);
    quizTimerId = null;
  }
}

/**
 * Save quiz result to state and award XP.  Keeps a history of the
 * most recent 50 quiz attempts.  XP is calculated as 10 times the
 * number of correct answers.  After updating state the history UI
 * and suggestions are refreshed.
 */
function saveQuizResult(score,total,pct,topic,level){
  if(!state.quizHistory) state.quizHistory = [];
  state.quizHistory.unshift({score:score,total:total,pct:pct,topic:topic,level:level,date:new Date().toISOString()});
  // Limit history to 50 entries
  if(state.quizHistory.length > 50) state.quizHistory = state.quizHistory.slice(0,50);
  // Award XP: 10 per correct answer
  const xpEarned = score * 10;
  addXP(xpEarned);
  save();
  updateQuizHistoryUI();
  suggestNextTasks();
}

/**
 * Render the quiz history list in the tracker analytics section.  Shows
 * up to the 5 most recent quiz results with date and score.
 */
function updateQuizHistoryUI(){
  const container = document.getElementById('quiz-history');
  if(!container) return;
  const history = (state && state.quizHistory) || [];
  if(!history || history.length === 0){
    const emptyMsg = currentLang === 'ar' ? 'لا بيانات للاختبارات' : (currentLang === 'en' ? 'No quiz data' : 'Keine Quizdaten');
    container.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;text-align:center">'+emptyMsg+'</div>';
    return;
  }
  const items = history.slice(0,5).map(item => {
    const d = new Date(item.date);
    const locale = currentLang === 'ar' ? 'ar' : (currentLang === 'en' ? 'en' : 'de');
    const dateStr = d.toLocaleDateString(locale,{day:'numeric',month:'short'});
    return `<div class="quiz-history-item"><span>${dateStr}</span><span>${item.score}/${item.total} (${item.pct}%)</span></div>`;
  });
  container.innerHTML = items.join('');
}

/**
 * Suggest next tasks based on daily completion and quiz history.  If tasks
 * remain incomplete, the suggestions will encourage the user to complete
 * them.  If recent quiz performance is low, an additional quiz is
 * recommended.  Otherwise a generic congratulation message is shown.
 */
function suggestNextTasks(){
  const el = document.getElementById('suggestions');
  if(!el) return;
  const suggestions = [];
  const tasks = state.dailyDone || {};
  // Suggest completing daily tasks that are not done yet
  if(!tasks['anki']) suggestions.push('📚 '+(currentLang==='ar'?'تمرن على المفردات':'Vokabeln lernen'));
  if(!tasks['grammar']) suggestions.push('📖 '+(currentLang==='ar'?'راجع القواعد أو موضوعاً':'Grammatik oder ein Thema üben'));
  if(!tasks['listen']) suggestions.push('🎧 '+(currentLang==='ar'?'قم بتمرين الاستماع':'Hörübung machen'));
  if(!tasks['speak']) suggestions.push('🗣 '+(currentLang==='ar'?'تمرن على التحدث أو الكتابة':'Sprech- oder Schreibübung durchführen'));
  // If recent quiz performance is poor
  if(state.quizHistory && state.quizHistory.length > 0){
    const last = state.quizHistory[0];
    if(last.pct < 60) suggestions.push('🧠 '+(currentLang==='ar'?'جرب اختباراً آخر لتحسين الأداء':'Mache ein weiteres Quiz, um deine Schwächen zu verbessern'));
  }
  if(suggestions.length === 0){
    suggestions.push('🎉 '+(currentLang==='ar'?'عمل رائع! استمر.':'Tolle Arbeit! Alle Aufgaben erledigt.'));
  }
  el.innerHTML = suggestions.map(s => `<div class="suggest-item">${s}</div>`).join('');
}

/**
 * Increment the weekly XP total and update the XP bar.  If no weekly XP is
 * stored yet, initialize it to zero.  This helper also persists the state
 * and shows a toast to notify the user of XP gained.  Different messages
 * are shown depending on the current UI language.
 * @param {number} xp - The amount of XP to add.
 */
function addXP(xp){
  if(!xp || isNaN(xp)) return;
  if(!state.weeklyXP) state.weeklyXP = 0;
  state.weeklyXP += xp;
  // Cap weekly XP at 500 (weekly goal)
  if(state.weeklyXP > 500) state.weeklyXP = 500;
  // Persist and update UI
  try{ updateWeeklyXP(); }catch(e){}
  save();
  // Show a toast message about XP earned
  let msg;
  if(currentLang === 'ar'){
    msg = '+' + xp + ' نقطة خبرة';
  } else if(currentLang === 'en'){
    msg = '+' + xp + ' XP earned!';
  } else {
    msg = '+' + xp + ' XP gesammelt!';
  }
  showToast(msg);
}

function getQuestions(level, topic, count) {
  const levels = level === 'auto'
    ? (typeof computeProgress === 'function'
        ? (computeProgress() < 25 ? ['A1'] : computeProgress() < 55 ? ['A1','A2'] : ['A1','A2','B1'])
        : ['A1','A2','B1'])
    : [level];

  let pool = [];
  const topics = topic === 'mixed' ? ['grammar','vocabulary','reading','wortschatz'] : [topic];

  levels.forEach(lvl => {
    topics.forEach(tp => {
      const qs = QUESTION_BANK[lvl]?.[tp] || [];
      pool.push(...qs.map(q => ({ ...q, _level: lvl, _topic: tp })));
    });
  });

  // Shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

// ====== QUIZAPI.IO INTEGRATION ======
// Replace 'YOUR_API_KEY' with your actual QuizAPI.io API key.
// You can get a free API key by signing up for an account【124474803706671†L41-L45】.
const QUIZ_API_KEY = 'YOUR_API_KEY';

/**
 * Map internal difficulty levels (A1/A2/B1 or 'auto') to QuizAPI.io difficulty parameters.
 * For 'auto', this uses computeProgress() to infer the difficulty.
 */
function mapDifficultyToQuizAPI(level) {
  let diffs = [];
  if (level === 'auto') {
    const p = typeof computeProgress === 'function' ? computeProgress() : 0;
    if (p < 25) diffs.push('EASY');
    else if (p < 55) diffs.push('MEDIUM');
    else diffs.push('HARD');
  } else {
    if (level === 'A1') diffs.push('EASY');
    else if (level === 'A2') diffs.push('MEDIUM');
    else if (level === 'B1') diffs.push('HARD');
  }
  return diffs.join(',');
}

/**
 * Fetch quiz questions from QuizAPI.io.
 * Uses the Questions endpoint with optional topic mapping to tags and difficulty mapping.
 * See the API docs for available parameters like `category`, `difficulty`, `tags`, `limit` and `random`【770445692521638†L114-L125】.
 */
async function fetchQuizQuestions(level, topic, count) {
  // Do nothing if no API key is provided.
  if (!QUIZ_API_KEY || QUIZ_API_KEY === 'YOUR_API_KEY') {
    return [];
  }
  const diffs = mapDifficultyToQuizAPI(level);
  const params = new URLSearchParams();
  if (diffs) params.set('difficulty', diffs);
  // Map our topic to QuizAPI tags; you can customise this mapping.
  if (topic && topic !== 'mixed') {
    params.set('tags', topic);
  }
  params.set('limit', count);
  params.set('random', 'true');
  const url = `https://quizapi.io/api/v1/questions?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${QUIZ_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const json = await res.json();
    if (!json || !json.data) return [];
    // Transform API questions into internal format
    return json.data.map(item => {
      const answers = item.answers || [];
      const options = answers.map(ans => ans.text);
      // Find index of correct answer
      let correctIdx = answers.findIndex(ans => ans.isCorrect);
      if (correctIdx < 0) {
        // fallback: assume first option is correct if not provided
        correctIdx = 0;
      }
      return {
        q: item.text,
        options,
        correct: correctIdx,
        explanation: item.explanation || '',
        _level: level
      };
    });
  } catch (e) {
    console.error('QuizAPI fetch error', e);
    return [];
  }
}

/**
 * Randomize the order of answer options for each question.
 * Shuffles the options array and updates the correct index accordingly.
 */
function randomizeQuizOptions(data) {
  return data.map(q => {
    const arr = q.options.map((opt, idx) => ({ opt, idx }));
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const newCorrect = arr.findIndex(item => item.idx === q.correct);
    q.options = arr.map(item => item.opt);
    q.correct = newCorrect;
    return q;
  });
}

async function generateQuiz() {
  const difficulty = document.getElementById('quiz-difficulty').value;
  const topic = document.getElementById('quiz-topic').value;
  // Save current quiz selection for reporting
  currentQuizDifficulty = difficulty;
  currentQuizTopic = topic;
  const count = parseInt(document.getElementById('quiz-count').value);
  const area = document.getElementById('quiz-area');
  const btn = document.getElementById('quiz-gen-btn');
  const label = document.getElementById('quiz-gen-label');
  const spinner = document.getElementById('quiz-gen-spinner');
  // Show loading spinner and disable button
  // Ensure any previous timer is cleared
  resetQuizTimer();
  if (btn) btn.disabled = true;
  if (label) label.textContent = '⏳ Lade Quiz...';
  if (spinner) spinner.style.display = 'inline-block';
  _quizScore = 0;
  _quizAnswered = 0;
  // Try fetching AI-generated questions from QuizAPI.io
  let questions = [];
  try {
    questions = await fetchQuizQuestions(difficulty, topic, count);
  } catch (err) {
    console.error(err);
  }
  if (questions && questions.length > 0) {
    _quizData = questions;
  } else {
    // Fallback to local question bank if API returns no data
    _quizData = getQuestions(difficulty, topic, count);
  }
  // Randomize answer order for each question
  if (_quizData && _quizData.length > 0) {
    _quizData = randomizeQuizOptions(_quizData);
  }
  // Hide spinner and reset button
  if (spinner) spinner.style.display = 'none';
  if (label) label.textContent = '✨ Quiz starten';
  if (btn) btn.disabled = false;
  if (!_quizData || _quizData.length === 0) {
    area.innerHTML = `<div class="quiz-card" style="text-align:center;color:var(--muted)">Keine Fragen für diese Auswahl gefunden.</div>`;
    return;
  }
  renderQuiz();
  // Start timer for first question
  startQuizTimer(0);
}

function renderQuiz() {
  const area = document.getElementById('quiz-area');
  if (!_quizData || _quizData.length === 0) return;

  area.innerHTML = _quizData.map((q, i) => `
    <div class="quiz-card" id="quiz-card-${i}">
      <div class="quiz-q-num">Frage ${i + 1} / ${_quizData.length}${q._level ? ' · ' + q._level : ''}</div>
      <div class="quiz-timer"><div class="quiz-timer-fill" id="quiz-timer-${i}"></div></div>
      <div class="quiz-q-text">${q.q}</div>
      <div class="quiz-options">
        ${q.options.map((opt, j) => `
          <button class="quiz-option" id="quiz-opt-${i}-${j}" onclick="answerQuiz(${i},${j})">${opt}</button>
        `).join('')}
      </div>
      <div class="quiz-explanation" id="quiz-exp-${i}">${q.explanation || ''}</div>
    </div>
  `).join('') + `<div id="quiz-result-area"></div>`;
}

function answerQuiz(qIdx, optIdx) {
  // Stop existing timer when answering
  resetQuizTimer();
  const q = _quizData[qIdx];
  if (!q) return;
  const correct = q.correct;
  q.options.forEach((_, j) => {
    const btn = document.getElementById(`quiz-opt-${qIdx}-${j}`);
    if (!btn) return;
    btn.disabled = true;
    if (j === correct) btn.classList.add('correct');
    else if (j === optIdx) btn.classList.add('wrong');
  });
  const expEl = document.getElementById(`quiz-exp-${qIdx}`);
  if (expEl) expEl.style.display = 'block';
  if (optIdx === correct) _quizScore++;
  _quizAnswered++;
  if (_quizAnswered === _quizData.length) {
    setTimeout(showQuizResult, 400);
  } else {
    // Start timer for next question
    startQuizTimer(_quizAnswered);
  }
}

function showQuizResult() {
  const pct = Math.round((_quizScore / _quizData.length) * 100);
  const msg = pct >= 80 ? '🏆 Ausgezeichnet! Du beherrschst das Material sehr gut.' :
              pct >= 60 ? '👍 Gut gemacht! Mit etwas mehr Übung wirst du noch besser.' :
              pct >= 40 ? '📚 Nicht schlecht. Übe weiter und du wirst dich verbessern!' :
              '💪 Weitermachen! Wiederhole das Material und versuche es nochmal.';
  const el = document.getElementById('quiz-result-area');
  if (el) el.innerHTML = `
    <div class="quiz-result">
      <div class="quiz-result-score">${_quizScore}/${_quizData.length}</div>
      <div class="quiz-result-label">${pct}% richtig</div>
      <div class="quiz-result-msg">${msg}</div>
      <button class="quiz-gen-btn" style="margin:0 auto" onclick="generateQuiz()">🔄 Neues Quiz</button>
    </div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Save result for analytics and award XP
  try{
    saveQuizResult(_quizScore, _quizData.length, pct, currentQuizTopic, currentQuizDifficulty);
  }catch(e){ console.warn('saveQuizResult error', e); }
}

// ===== LEVEL TEST FEATURE =====
let _levelCurrent = 0;
let _levelCurrentLevel = 'A2';
let _levelHistory = [];
let _levelUsed = { A1: new Set(), A2: new Set(), B1: new Set() };
const _LEVELS = ['A1', 'A2', 'B1'];

function startLevelTest() {
  _levelCurrent = 0;
  _levelCurrentLevel = 'A2';
  _levelHistory = [];
  _levelUsed = { A1: new Set(), A2: new Set(), B1: new Set() };
  showNextLevelQuestion();
}

function getUnusedQuestion(level) {
  const allTopics = ['grammar','vocabulary','reading'];
  let pool = [];
  allTopics.forEach(tp => {
    (QUESTION_BANK[level]?.[tp] || []).forEach((q, i) => {
      if (!_levelUsed[level].has(tp + '_' + i)) {
        pool.push({ ...q, _key: tp + '_' + i, _level: level });
      }
    });
  });
  if (pool.length === 0) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  _levelUsed[level].add(pick._key);
  return pick;
}

function showNextLevelQuestion() {
  const area = document.getElementById('level-area');
  const q = getUnusedQuestion(_levelCurrentLevel);
  if (!q) {
    // No more questions at this level, try adjacent
    const idx = _LEVELS.indexOf(_levelCurrentLevel);
    const alt = idx > 0 ? _LEVELS[idx - 1] : null;
    if (alt) { _levelCurrentLevel = alt; showNextLevelQuestion(); return; }
    showLevelResult(); return;
  }

  const qNum = _levelCurrent + 1;
  area.innerHTML = `
    <div class="quiz-card">
      <div class="level-q-header">
        <div class="level-q-stage">Frage ${qNum} / 20</div>
        <div class="level-q-current-level">${_levelCurrentLevel}</div>
      </div>
      <div style="height:4px;background:var(--border);border-radius:2px;margin-bottom:16px;overflow:hidden">
        <div style="height:100%;width:${(qNum/20)*100}%;background:var(--gold);border-radius:2px;transition:width 0.5s ease"></div>
      </div>
      <div class="quiz-q-text">${q.q}</div>
      <div class="quiz-options">
        ${q.options.map((opt, j) => `
          <button class="quiz-option" id="level-opt-${j}" onclick="answerLevelQuestion(${j}, this._q)" data-correct="${q.correct}" data-j="${j}">${opt}</button>
        `).join('')}
      </div>
      <div class="quiz-explanation" id="level-exp" style="display:none">${q.explanation || ''}</div>
    </div>`;

  // Store current question on area element
  area._currentQ = q;
}

function answerLevelQuestion(optIdx) {
  const area = document.getElementById('level-area');
  const q = area._currentQ;
  if (!q) return;
  const correct = q.correct;
  const isCorrect = optIdx === correct;

  // Disable all and show feedback
  q.options.forEach((_, j) => {
    const btn = document.getElementById(`level-opt-${j}`);
    if (!btn) return;
    btn.disabled = true;
    if (j === correct) btn.classList.add('correct');
    else if (j === optIdx) btn.classList.add('wrong');
  });
  const expEl = document.getElementById('level-exp');
  if (expEl) expEl.style.display = 'block';

  _levelHistory.push({ level: _levelCurrentLevel, correct: isCorrect });

  // Adaptive: correct → harder, wrong → easier
  const lvlIdx = _LEVELS.indexOf(_levelCurrentLevel);
  if (isCorrect && lvlIdx < _LEVELS.length - 1) _levelCurrentLevel = _LEVELS[lvlIdx + 1];
  else if (!isCorrect && lvlIdx > 0) _levelCurrentLevel = _LEVELS[lvlIdx - 1];

  _levelCurrent++;

  if (_levelCurrent >= 20) {
    setTimeout(showLevelResult, 800);
  } else {
    setTimeout(showNextLevelQuestion, 900);
  }
}

function showLevelResult() {
  const scores = {};
  _LEVELS.forEach(l => scores[l] = { correct: 0, total: 0 });
  _levelHistory.forEach(h => {
    if (scores[h.level]) { scores[h.level].total++; if (h.correct) scores[h.level].correct++; }
  });

  let finalLevel = 'A1';
  for (let i = _LEVELS.length - 1; i >= 0; i--) {
    const l = _LEVELS[i];
    const s = scores[l];
    if (s.total > 0 && (s.correct / s.total) >= 0.6) { finalLevel = l; break; }
  }

  const levelDescriptions = {
    A1: 'Anfänger – Du kannst einfache Sätze verstehen und grundlegende Kommunikation führen.',
    A2: 'Grundlagen – Du kannst alltägliche Ausdrücke verstehen und dich in einfachen Situationen verständigen.',
    B1: 'Mittelstufe – Du kannst die Hauptpunkte klarer Standardsprache zu vertrauten Themen verstehen.'
  };
  const adviceMap = {
    A1: 'Konzentriere dich auf Grundvokabular und einfache Satzstrukturen. Lerne täglich 10–15 neue Wörter.',
    A2: 'Übe alltägliche Situationen. Höre deutsche Podcasts für Anfänger und erweitere deinen Wortschatz.',
    B1: 'Arbeite an Grammatik (Konjunktiv, Passiv) und Wortschatz. Lese deutsche Artikel und schaue deutsche Serien.'
  };
  const skillColors = { A1: 'var(--m1)', A2: 'var(--m2)', B1: 'var(--m3)' };
  const totalCorrect = _levelHistory.filter(h => h.correct).length;
  const totalPct = Math.round((totalCorrect / 20) * 100);

  const area = document.getElementById('level-area');
  area.innerHTML = `
    <div class="level-result-card">
      <div class="level-result-banner">
        <div class="level-result-badge">${finalLevel}</div>
        <div class="level-result-name">${finalLevel === 'A1' ? 'Anfänger' : finalLevel === 'A2' ? 'Grundlagen' : 'Mittelstufe'}</div>
        <div class="level-result-desc">${levelDescriptions[finalLevel]}</div>
      </div>
      <div class="level-skills-grid">
        ${_LEVELS.map(l => {
          const s = scores[l];
          const pct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
          return `<div class="level-skill">
            <div class="level-skill-name">${l}</div>
            <div class="level-skill-bar"><div class="level-skill-fill" style="width:${pct}%;background:${skillColors[l]}"></div></div>
            <div class="level-skill-pct">${pct}%</div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <div class="level-advice">
      <div class="level-advice-title">💡 Empfehlungen für dich</div>
      <div class="level-advice-text">${adviceMap[finalLevel]}</div>
    </div>
    <div style="text-align:center;margin-bottom:8px;font-family:'DM Mono',monospace;font-size:0.75rem;color:var(--muted)">
      ${totalCorrect} / 20 richtig (${totalPct}%)
    </div>
    <button class="level-restart-btn" onclick="startLevelTest()">🔄 Test wiederholen</button>`;
}

/* ==== extracted from index.html ==== */

/* Additional functionality for the improved app */
    (function(){
      // DOM ready
      document.addEventListener('DOMContentLoaded', function(){
        // Password strength monitor
        const pwdInput=document.getElementById('auth-password');
        const strengthBar=document.getElementById('password-strength-bar');
        const strengthWrap=document.getElementById('password-strength');
        if(pwdInput){
          pwdInput.addEventListener('input',function(){
            if(typeof authMode!=='undefined' && authMode==='register'){
              const val=pwdInput.value||'';
              strengthWrap.style.display='block';
              const score=window.computeStrength(val);
              strengthBar.style.width=Math.min(score,100)+'%';
              if(score<40){strengthBar.style.background='var(--red)';}
              else if(score<70){strengthBar.style.background='var(--gold)';}
              else{strengthBar.style.background='var(--green)';}
            }else{
              strengthWrap.style.display='none';
            }
          });
        }
        // Forgot password link
        const forgot=document.getElementById('forgot-password-link');
        if(forgot){
          forgot.addEventListener('click',async function(e){
            e.preventDefault();
            const email=(document.getElementById('auth-email').value||'').trim().toLowerCase();
            if(!email){showToast('Bitte gib deine E-Mail ein.');return;}
            try{
              await _supa.auth.resetPasswordForEmail(email,{ redirectTo: getSignupRedirectUrl() });
              showToast('E-Mail zum Zurücksetzen wurde gesendet.');
            }catch(err){
              showToast('Fehler beim Zurücksetzen: '+(err&&err.message?err.message:String(err)));
            }
          });
        }
        // Google OAuth button
        const googleBtn=document.getElementById('google-btn');
        if(googleBtn){
          googleBtn.addEventListener('click',async function(e){
            e.preventDefault();
            try{
              await _supa.auth.signInWithOAuth({provider:'google'});
            }catch(err){
              showToast('Google Login fehlgeschlagen');
            }
          });
        }
        // Offline detection
        const offlineBanner=document.getElementById('offline-banner');
        function updateOffline(){
          if(navigator.onLine){
            if(offlineBanner) offlineBanner.style.display='none';
          }else{
            if(offlineBanner) offlineBanner.style.display='block';
          }
        }
        window.addEventListener('online',updateOffline);
        window.addEventListener('offline',updateOffline);
        updateOffline();
      });
      // Password strength function
      window.computeStrength=function(pwd){
        let score=0;
        if(!pwd) return 0;
        if(pwd.length>=8) score+=40; else if(pwd.length>=5) score+=20;
        if(/[A-Z]/.test(pwd)) score+=20;
        if(/[0-9]/.test(pwd)) score+=20;
        if(/[^A-Za-z0-9]/.test(pwd)) score+=20;
        return Math.min(score,100);
      };
      // Vocabulary trainer
      // Holds vocabulary entries in the form {de, en, example, cat}.  Data
      // will be loaded from Supabase when available, otherwise from a
      // free API or a small fallback list.  A queue is used for
      // spaced‑repetition logic and progress tracking.
      // ===== MATCH PAIRS VOCABULARY ENGINE =====
      let vocabData=[];
      let matchActiveCat='all';
      let matchSelected=null;
      let matchMatched=new Set();
      let matchRoundPairs=[];
      let matchBlocked=false;

      async function fetchRandomVocab(count=12){
        try{
          const res=await fetch(`https://random-words-api.kushcreates.com/api?language=de&words=${count}`);
          if(!res.ok) throw new Error(`HTTP ${res.status}`);
          const words=await res.json();
          const entries=[];
          for(const item of words){
            const word=(item.word||item.name||'').trim();
            if(!word) continue;
            let translation='';
            try{ translation=await translateOne(word,'en'); }catch(e){}
            entries.push({de:word,en:translation||'',cat:'other'});
          }
          return entries;
        }catch(e){ return []; }
      }

      window.initVocabPage=async function(){
        if(vocabData.length===0){
          let loaded=false;
          if(currentUser){
            try{
              const {data,error}=await _supa.from('vocabulary').select('*').eq('user_id',currentUser.id);
              if(error) throw error;
              if(data&&data.length>0){
                vocabData=data.map(r=>({de:r.word,en:r.translation,cat:r.category||'other'}));
                loaded=true;
              }
            }catch(e){ console.warn('Supabase vocab:',e?.message||e); }
          }
          if(!loaded){
            try{
              const api=await fetchRandomVocab(12);
              if(api&&api.length>0){ vocabData=api; loaded=true; }
            }catch(e){}
          }
          if(!loaded){
            vocabData=[
              // Berufe
              {de:'der Rechtsanwalt',en:'lawyer',cat:'berufe'},{de:'der Buchhalter',en:'accountant',cat:'berufe'},
              {de:'der Handwerker',en:'craftsman / tradesman',cat:'berufe'},{de:'das Gehalt',en:'salary',cat:'berufe'},
              {de:'kündigen',en:'to resign / terminate',cat:'berufe'},{de:'die Vollzeitstelle',en:'full-time position',cat:'berufe'},
              {de:'der Kollege',en:'colleague',cat:'berufe'},{de:'die Selbstständigkeit',en:'self-employment',cat:'berufe'},
              // Bewerbung
              {de:'der Lebenslauf',en:'CV / résumé',cat:'bewerbung'},{de:'das Vorstellungsgespräch',en:'job interview',cat:'bewerbung'},
              {de:'das Anschreiben',en:'cover letter',cat:'bewerbung'},{de:'die Probezeit',en:'probationary period',cat:'bewerbung'},
              {de:'die Stellenanzeige',en:'job advertisement',cat:'bewerbung'},{de:'der Arbeitgeber',en:'employer',cat:'bewerbung'},
              {de:'die Qualifikation',en:'qualification',cat:'bewerbung'},{de:'sich bewerben',en:'to apply for a job',cat:'bewerbung'},
              // Umwelt
              {de:'die Nachhaltigkeit',en:'sustainability',cat:'umwelt'},{de:'der Klimawandel',en:'climate change',cat:'umwelt'},
              {de:'die Luftverschmutzung',en:'air pollution',cat:'umwelt'},{de:'der Naturschutz',en:'nature conservation',cat:'umwelt'},
              {de:'erneuerbare Energien',en:'renewable energies',cat:'umwelt'},{de:'die Überschwemmung',en:'flood',cat:'umwelt'},
              {de:'die Treibhausgase',en:'greenhouse gases',cat:'umwelt'},{de:'das Recycling',en:'recycling',cat:'umwelt'},
              // Gesellschaft
              {de:'die Gleichberechtigung',en:'equal rights',cat:'gesellschaft'},{de:'die Demokratie',en:'democracy',cat:'gesellschaft'},
              {de:'die Diskriminierung',en:'discrimination',cat:'gesellschaft'},{de:'das Ehrenamt',en:'voluntary work',cat:'gesellschaft'},
              {de:'die Armut',en:'poverty',cat:'gesellschaft'},{de:'die Integration',en:'integration',cat:'gesellschaft'},
              {de:'die Meinungsfreiheit',en:'freedom of speech',cat:'gesellschaft'},{de:'die Sozialhilfe',en:'social welfare',cat:'gesellschaft'},
              // Gesundheit
              {de:'die Krankenversicherung',en:'health insurance',cat:'gesundheit'},{de:'das Rezept',en:'prescription',cat:'gesundheit'},
              {de:'die Vorsorge',en:'prevention / precaution',cat:'gesundheit'},{de:'der Facharzt',en:'specialist doctor',cat:'gesundheit'},
              {de:'die Nebenwirkung',en:'side effect',cat:'gesundheit'},{de:'die Notaufnahme',en:'emergency room',cat:'gesundheit'},
              {de:'die Genesung',en:'recovery',cat:'gesundheit'},{de:'die Impfung',en:'vaccination',cat:'gesundheit'},
              // Kommunikation
              {de:'die Verhandlung',en:'negotiation',cat:'kommunikation'},{de:'überzeugen',en:'to convince / persuade',cat:'kommunikation'},
              {de:'das Missverständnis',en:'misunderstanding',cat:'kommunikation'},{de:'die Stellungnahme',en:'statement / position',cat:'kommunikation'},
              {de:'sich äußern',en:'to express oneself',cat:'kommunikation'},{de:'die Zusammenfassung',en:'summary',cat:'kommunikation'},
              {de:'höflich',en:'polite',cat:'kommunikation'},{de:'schriftlich',en:'in writing',cat:'kommunikation'},
            ];
          }
        }
        document.querySelectorAll('#page-vocab .vocab-cat-btn').forEach(btn=>{
          if(!btn.dataset.bound){
            btn.dataset.bound='1';
            btn.onclick=function(){
              document.querySelectorAll('#page-vocab .vocab-cat-btn').forEach(b=>b.classList.remove('active'));
              btn.classList.add('active');
              matchActiveCat=btn.dataset.cat;
              newVocabRound();
            };
          }
        });
        newVocabRound();
      };

      window.newVocabRound=function(){
        const pool=(matchActiveCat==='all')?vocabData:vocabData.filter(x=>x.cat===matchActiveCat);
        const grid=document.getElementById('match-grid');
        if(!pool||pool.length===0){
          if(grid) grid.innerHTML='<p style="color:var(--muted);font-size:0.85rem;grid-column:1/-1;text-align:center;padding:20px">Keine Vokabeln in dieser Kategorie.</p>';
          return;
        }
        const shuffled=[...pool].sort(()=>Math.random()-0.5);
        matchRoundPairs=shuffled.slice(0,Math.min(6,shuffled.length)).map((p,i)=>({...p,id:i}));
        matchSelected=null;
        matchMatched=new Set();
        matchBlocked=false;
        document.getElementById('vocab-finished').classList.remove('visible');
        renderMatchGrid();
        updateMatchScore();
      };

      function renderMatchGrid(){
        const grid=document.getElementById('match-grid');
        if(!grid) return;
        const deCards=matchRoundPairs.map(p=>({id:p.id,type:'de',text:p.de}));
        const enCards=matchRoundPairs.map(p=>({id:p.id,type:'en',text:p.en}));
        const all=[...deCards,...enCards].sort(()=>Math.random()-0.5);
        grid.innerHTML='';
        all.forEach(card=>{
          const el=document.createElement('div');
          el.className='match-card '+card.type;
          el.dataset.id=card.id;
          el.dataset.type=card.type;
          el.innerHTML='<span class="match-card-text">'+card.text+'</span>';
          el.onclick=()=>handleMatchTap(el,card);
          grid.appendChild(el);
        });
      }

      function handleMatchTap(el,card){
        if(matchBlocked||matchMatched.has(card.id)) return;
        if(matchSelected&&matchSelected.id===card.id&&matchSelected.type===card.type){
          el.classList.remove('selected'); matchSelected=null; return;
        }
        if(matchSelected&&matchSelected.type===card.type){
          document.querySelectorAll('.match-card.selected').forEach(c=>c.classList.remove('selected'));
          el.classList.add('selected'); matchSelected=card; return;
        }
        el.classList.add('selected');
        if(!matchSelected){ matchSelected=card; return; }
        const prev=matchSelected; matchSelected=null; matchBlocked=true;
        if(prev.id===card.id){
          setTimeout(()=>{
            document.querySelectorAll('.match-card[data-id="'+card.id+'"]').forEach(c=>{ c.classList.remove('selected'); c.classList.add('matched'); });
            matchMatched.add(card.id); matchBlocked=false;
            updateMatchScore();
            if(matchMatched.size===matchRoundPairs.length) showVocabFinished();
          },200);
        }else{
          setTimeout(()=>{
            document.querySelectorAll('.match-card.selected').forEach(c=>{ c.classList.remove('selected'); c.classList.add('wrong'); setTimeout(()=>c.classList.remove('wrong'),420); });
            matchBlocked=false;
          },180);
        }
      }

      function updateMatchScore(){
        const matched=matchMatched.size, total=matchRoundPairs.length;
        const el1=document.getElementById('vocab-matched'), el2=document.getElementById('vocab-total'), bar=document.getElementById('vocab-progress-fill');
        if(el1) el1.textContent=matched; if(el2) el2.textContent=total;
        if(bar) bar.style.width=total>0?(matched/total*100)+'%':'0%';
      }

      function showVocabFinished(){
        const sub=document.getElementById('vocab-finished-sub');
        if(sub) sub.textContent=matchRoundPairs.length+' paires trouv\u00e9es ! \ud83c\udfc6';
        document.getElementById('vocab-finished').classList.add('visible');
      }

      // Listening practice
      // The listening module presents a German sentence and hides its
      // English translation until the user reveals it.  Users then type
      // what they hear and receive immediate feedback.  This array
      // holds the German/English pairs and will be populated via
      // Supabase, a free AI translation API or a fallback list.
      let listeningData=[
        {de:'Guten Morgen, wie geht es dir?',en:'Good morning, how are you?'},
        {de:'Ich habe Hunger und möchte essen.',en:'I am hungry and would like to eat.'},
        {de:'Wir fahren morgen nach Berlin.',en:'We are going to Berlin tomorrow.'},
        {de:'Kannst du mir bitte helfen?',en:'Can you help me please?'}
      ];
      let listeningScore=0;
      let listeningIndex=0;
      let speechRate=1;

      /**
       * Fetch a handful of simple English sentences and translate
       * them to German.  Uses MyMemory via translateGeneric.
       * The resulting list items are objects with {de,en}.  When
       * offline or on error the returned array is empty.
       *
       * @returns {Promise<Array<{de:string,en:string}>>}
       */
      async function fetchListeningData(){
        const sentences=[
          'I love learning new languages.',
          'The weather is nice today.',
          'Do you like reading books?',
          'He will go to school tomorrow.',
          'What time is it now?',
          'Can you help me?'
        ];
        const pairs=[];
        for(const en of sentences){
          let de='';
          try{
            de=await translateGeneric(en,'en','de');
          }catch(e){
            de='';
          }
          // Only push pairs where translation succeeded
          if(de){
            pairs.push({de:de, en:en});
          }
        }
        return pairs;
      }

      /**
       * Generic translation helper for arbitrary language pairs using
       * MyMemory.  It closely mirrors translateOne but allows the
       * source language to vary.  See https://mymemory.translated.net/.
       *
       * @param {string} text Text to translate
       * @param {string} from Source language code (e.g. 'en')
       * @param {string} to Target language code (e.g. 'de')
       */
      async function translateGeneric(text, from, to){
        return translateGenericGCloud(text, from, to);
      }

      /**
       * Initialise the listening page.  This resets score and index,
       * then tries to populate listeningData from Supabase or the
       * AI translation API.  The function awaits translation
       * completion before showing the first sentence.  Should an
       * error occur it falls back to the predefined sample list.
       */
      window.initListeningPage=async function(){
        listeningScore=0;
        listeningIndex=0;
        // Load custom sentences from Supabase if available
        let loaded=false;
        if(listeningData.length<=4){
          // Only attempt to load from Supabase when not already
          // populated by API or previous calls and when logged in.
          if(currentUser){
            try{
              const {data,error}=await _supa.from('listening_sentences').select('*').eq('user_id', currentUser.id);
              if(error) throw error;
              if(data && data.length>0){
                listeningData=(data||[]).map(row=>({de:row.sentence,en:row.translation}));
                loaded=true;
              }
            }catch(e){
              console.warn('Supabase listening load failed:',e?.message||e);
            }
          }
          if(!loaded){
            // Fetch simple sentences and translate them.  This may
            // return fewer items than requested if translation fails.
            try{
              const pairs=await fetchListeningData();
              if(pairs && pairs.length>0){
                listeningData=pairs;
                loaded=true;
              }
            }catch(e){
              console.warn('Listening API load failed:',e?.message||e);
            }
          }
        }
        updateListeningScore();
        showListeningSentence();
        const playBtn=document.getElementById('listening-play-btn');
        const showBtn=document.getElementById('listening-show-btn');
        const submitBtn=document.getElementById('listening-submit-btn');
        const slowBtn=document.getElementById('listening-slow-btn');
        const normalBtn=document.getElementById('listening-normal-btn');
        const fastBtn=document.getElementById('listening-fast-btn');
        if(playBtn) playBtn.onclick=function(){ playAudio(); };
        if(showBtn) showBtn.onclick=function(){ revealTranslation(); };
        if(submitBtn) submitBtn.onclick=function(){ checkListeningAnswer(); };
        if(slowBtn) slowBtn.onclick=function(){ speechRate=0.8; playAudio(); };
        if(normalBtn) normalBtn.onclick=function(){ speechRate=1; playAudio(); };
        if(fastBtn) fastBtn.onclick=function(){ speechRate=1.3; playAudio(); };
        const speakBtn=document.getElementById('listening-speak-btn');
        if(speakBtn) speakBtn.onclick=function(){ startSpeakingPractice(); };
        const input=document.getElementById('listening-input');
        if(input) input.value='';
      };
      function showListeningSentence(){
        if(listeningIndex>=listeningData.length) listeningIndex=0;
        const item=listeningData[listeningIndex];
        const sEl=document.getElementById('listening-sentence');
        const tEl=document.getElementById('listening-translation');
        if(sEl) sEl.textContent=item.de;
        if(tEl){
          tEl.textContent=item.en;
          tEl.classList.add('hidden');
        }
        const input=document.getElementById('listening-input');
        if(input) input.value='';
      }
      function playAudio(){
        const item=listeningData[listeningIndex];
        const utter=new SpeechSynthesisUtterance(item.de);
        utter.lang='de-DE';
        utter.rate=speechRate||1;
        window.speechSynthesis.speak(utter);
      }
      function revealTranslation(){
        const tEl=document.getElementById('listening-translation');
        if(tEl) tEl.classList.remove('hidden');
      }
      function checkListeningAnswer(){
        const input=document.getElementById('listening-input');
        const userVal=(input&&input.value||'').trim().toLowerCase();
        const item=listeningData[listeningIndex];
        const correct=item.de.toLowerCase().replace(/[.,!?]/g,'');
        if(userVal===correct){
          listeningScore++;
          showToast(t('toast_correct_answer') || '✓ Correct!');
        }else{
          showToast(t('toast_wrong_answer') || '✗ Wrong');
        }
        listeningIndex++;
        updateListeningScore();
        showListeningSentence();
      }
      function updateListeningScore(){
        const pct=(listeningScore/listeningData.length)*100;
        const scoreEl=document.getElementById('listening-score');
        const barEl=document.getElementById('listening-score-bar');
        if(scoreEl) scoreEl.textContent=listeningScore;
        if(barEl) barEl.style.width=pct+'%';
      }

  /**
   * Start speech recognition for speaking practice.  Uses the Web Speech API
   * to capture the user's spoken sentence and compares it to the current
   * listening item.  If SpeechRecognition is not available, shows a toast.
   */
  function startSpeakingPractice(){
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SpeechRecognition){
      showToast(t('speech_not_supported') || 'Speech recognition not supported.');
      return;
    }
    const item = listeningData[listeningIndex];
    const target = item.de.toLowerCase().replace(/[.,!?]/g,'').trim();
    try{
      const recog = new SpeechRecognition();
      recog.lang = 'de-DE';
      recog.interimResults = false;
      recog.maxAlternatives = 1;
      recog.onresult = function(e){
        const transcript = (e.results[0][0].transcript || '').toLowerCase().trim();
        if(transcript === target){
          listeningScore++;
          showToast(t('toast_correct_answer') || '✓ Correct!');
        } else {
          showToast(t('toast_wrong_answer') || '✗ Wrong');
        }
        listeningIndex++;
        updateListeningScore();
        showListeningSentence();
      };
      recog.onerror = function(ev){
        console.warn('Speech recognition error', ev.error);
        showToast('🎤 '+ev.error);
      };
      recog.start();
    }catch(err){
      showToast('🎤 '+(err?.message||'Error'));
    }
  }
      // Daily quote and XP
      const DAILY_QUOTES=[
        {de:'Übung macht den Meister.',en:'Practice makes perfect.'},
        {de:'Aller Anfang ist schwer.',en:'Every beginning is hard.'},
        {de:'Geduld bringt Rosen.',en:'Patience brings roses.'},
        {de:'Ohne Fleiß kein Preis.',en:'No pain, no gain.'}
      ];
      window.updateDailyQuote=function(){
        const idx=(new Date().getDate()+new Date().getMonth())%DAILY_QUOTES.length;
        const q=DAILY_QUOTES[idx];
        const box=document.getElementById('daily-quote-box');
        if(box){
          box.innerHTML='<div class="quote-de">'+q.de+'</div><div class="quote-en">'+q.en+'</div>';
        }
      };
      window.updateWeeklyXP=function(){
        try{
          const xp=(state&&state.weeklyXP)?state.weeklyXP:0;
          const pct=Math.min((xp/500)*100,100);
          const fill=document.getElementById('xp-week-fill');
          const label=document.querySelector('.xp-bar-label');
          if(fill) fill.style.width=pct+'%';
          if(label) label.textContent='Wöchentliche XP: '+xp+'/500';
        }catch(e){}
      };

    })();

    // ===== Bottom nav scroll fade indicators =====
    function updateNavScrollFade(){
      const nav=document.getElementById('bottom-nav');
      const track=document.getElementById('bottom-nav-track');
      if(!nav||!track)return;
      const scrollLeft=track.scrollLeft;
      const maxScroll=track.scrollWidth-track.clientWidth;
      nav.classList.toggle('can-scroll-left', scrollLeft>4);
      nav.classList.toggle('can-scroll-right', maxScroll>4 && scrollLeft<maxScroll-4);
    }
    // Init on DOM ready
    document.addEventListener('DOMContentLoaded',function(){
      const track=document.getElementById('bottom-nav-track');
      if(track){
        track.addEventListener('scroll',updateNavScrollFade,{passive:true});
        // Small delay to let layout settle
        setTimeout(updateNavScrollFade,200);
      }
    });
    // Also run after a resize
    window.addEventListener('resize',updateNavScrollFade,{passive:true});
    // Run once at page load too
    setTimeout(updateNavScrollFade,400);
