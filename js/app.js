// ════════════════════════════════════════════════════════
//  28天品牌故事挑戰 — 核心應用邏輯
// ════════════════════════════════════════════════════════

const App = window.App = {
  sb:           null,
  cfg:          null,   // { start_date, team_name, expected_members }
  me:           null,   // { id, name, pin, avatar_index, bazi_profile }
  bazi:         null,   // { pillars, profile, masterType, formatted }
  todayDay:     1,
  currentPage:  'task',
  galaxyUserId: null,   // which user's galaxy to show in social page
};

/* ── Tiny helpers ── */
const $  = (s,r=document) => r.querySelector(s);
const $$ = (s,r=document) => [...r.querySelectorAll(s)];
App.esc = (t) => String(t??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

App.toast = (msg, dur=2400) => {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(App._tt);
  App._tt = setTimeout(() => t.classList.remove('show'), dur);
};

App.openModal = (html) => {
  $('#modalCard').innerHTML = html;
  $('#modalOverlay').classList.remove('hidden');
};
App.closeModal = () => $('#modalOverlay').classList.add('hidden');

/* ── Simple markdown-ish renderer ── */
App.renderPrompt = (text) => {
  let html = App.esc(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/^•\s/gm, '<li>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return `<div class="rendered-prompt"><p>${html}</p></div>`;
};

/* ── Quadrant colour helper ── */
App.qColor = (id) => ['#C0392B','#8E44AD','#27AE60','#2980B9','#E67E22'][id] || '#C9A84C';

/* ── Day calculation ── */
App.dayFromDate = () => {
  const start = new Date(App.cfg.start_date + 'T00:00:00');
  const now   = new Date(); now.setHours(0,0,0,0);
  const diff  = Math.floor((now - start) / 86400000) + 1;
  return Math.max(1, Math.min(28, diff));
};

/* ── SHA-256 (for PIN hashing — optional, kept simple) ── */
App.sha256 = async (txt) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
};

/* ════════════════════════════════════════
   Background floating icons
════════════════════════════════════════ */
function paintMotifs() {
  const icons = ['🌍','💰','👥','🏆','📚','🌍','💰','👥','🏆','📚','✨','💎','🔥'];
  const wrap = $('#bgMotifs'); let html = '';
  for (let i = 0; i < 28; i++) {
    const ic  = icons[i % icons.length];
    const sz  = 24 + Math.random() * 44;
    const lft = Math.random() * 100, top = Math.random() * 100;
    const dur = 7 + Math.random() * 9, del = -Math.random() * 9;
    html += `<span style="left:${lft}%;top:${top}%;font-size:${sz}px;animation-duration:${dur}s;animation-delay:${del}s">${ic}</span>`;
  }
  wrap.innerHTML = html;
}

/* ════════════════════════════════════════
   Supabase DB layer
════════════════════════════════════════ */
function initDB() {
  App.sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}

App.db = {
  async loadConfig() {
    const { data } = await App.sb.from('bazi28_config').select('*').eq('id',1).maybeSingle();
    App.cfg = data || { start_date: new Date().toISOString().slice(0,10), team_name:'28天品牌故事', expected_members:10 };
  },
  async findMember(name) {
    const { data } = await App.sb.from('bazi28_members').select('*').eq('name',name).maybeSingle();
    return data;
  },
  async createMember(name, pin, birthYear, birthMonth, birthDay, birthHour, avatarIdx, baziProfile) {
    const { data, error } = await App.sb.from('bazi28_members').insert({
      name, pin, birth_year:birthYear, birth_month:birthMonth, birth_day:birthDay,
      birth_hour:birthHour, avatar_index:avatarIdx, bazi_profile:baziProfile,
    }).select().single();
    if (error) throw error;
    return data;
  },
  async getMyTask(day) {
    const { data } = await App.sb.from('bazi28_tasks').select('*').eq('member_id',App.me.id).eq('day_index',day).maybeSingle();
    return data;
  },
  async saveTask(day, response) {
    const { error } = await App.sb.from('bazi28_tasks').upsert({
      member_id:App.me.id, member_name:App.me.name, day_index:day,
      response, completed_at:new Date().toISOString(),
    }, { onConflict:'member_id,day_index' });
    if (error) throw error;
  },
  async myTasks() {
    const { data } = await App.sb.from('bazi28_tasks').select('*').eq('member_id',App.me.id);
    return data || [];
  },
  async memberTasks(memberId) {
    const { data } = await App.sb.from('bazi28_tasks').select('*').eq('member_id', memberId);
    return data || [];
  },
  async todayDoneMembers(day) {
    const { data } = await App.sb.from('bazi28_tasks').select('member_id,member_name,response').eq('day_index',day).neq('response','');
    return data || [];
  },
  async memberProfile(memberId) {
    const { data } = await App.sb.from('bazi28_members').select('id,name,avatar_index').eq('id',memberId).maybeSingle();
    return data;
  },
  async allMembersScores() {
    const { data } = await App.sb.from('bazi28_tasks').select('member_id,member_name').neq('response','');
    if (!data) return [];
    const map = {};
    data.forEach(r => {
      if (!map[r.member_id]) map[r.member_id] = { member_name:r.member_name, count:0 };
      map[r.member_id].count++;
    });
    return Object.entries(map).map(([id,v]) => ({ id, name:v.member_name, days:v.count }))
                              .sort((a,b) => b.days - a.days);
  },
  async allMembers() {
    const { data } = await App.sb.from('bazi28_members').select('id,name,avatar_index').order('created_at');
    return data || [];
  },
  async getAIChats(day) {
    const { data } = await App.sb.from('bazi28_ai_chats')
      .select('role,content,created_at')
      .eq('member_id', App.me.id).eq('day_index', day).order('created_at');
    return data || [];
  },
  async countTodayUserMsg(day) {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await App.sb.from('bazi28_ai_chats')
      .select('id')
      .eq('member_id', App.me.id).eq('day_index', day).eq('role', 'user')
      .gte('created_at', today + 'T00:00:00');
    return (data || []).length;
  },
  async saveAIChat(day, role, content) {
    await App.sb.from('bazi28_ai_chats').insert({ member_id: App.me.id, day_index: day, role, content });
  },
  async givePraise(toId, toName, dayIndex, emoji) {
    const { error } = await App.sb.from('bazi28_praises').insert({
      from_id:App.me.id, from_name:App.me.name,
      to_id:toId, to_name:toName, day_index:dayIndex, emoji,
    });
    if (error) throw error;
  },
  async praisesForTask(toId, dayIndex) {
    const { data } = await App.sb.from('bazi28_praises').select('*').eq('to_id',toId).eq('day_index',dayIndex);
    return data || [];
  },
  async getMilestone(type) {
    const { data } = await App.sb.from('bazi28_milestones')
      .select('*').eq('member_id', App.me.id).eq('type', type).maybeSingle();
    return data;
  },
  async saveMilestone(type, content) {
    const { error } = await App.sb.from('bazi28_milestones').upsert({
      member_id: App.me.id, type, content,
    }, { onConflict: 'member_id,type' });
    if (error) throw error;
  },
};

/* ════════════════════════════════════════
   Auth Flow
════════════════════════════════════════ */
async function handleCheckName() {
  const name = $('#loginName').value.trim();
  const msg  = $('#loginMsg');
  msg.textContent = '';
  if (!name) return (msg.textContent = '請輸入你的名字');
  const btn = $('#checkNameBtn');
  btn.disabled = true; $('span',btn).textContent = '查詢中…';
  try {
    const member = await App.db.findMember(name);
    if (member) {
      // Returning user → show PIN step
      $('#stepName').classList.add('hidden');
      $('#stepPin').classList.remove('hidden');
    } else {
      // New user → show register form
      $('#stepName').classList.add('hidden');
      $('#stepRegister').classList.remove('hidden');
    }
  } catch(e) {
    msg.textContent = '連線失敗，請稍後重試';
  } finally {
    btn.disabled = false; $('span',btn).textContent = '開始 →';
  }
}

async function handlePinLogin() {
  const name = $('#loginName').value.trim();
  const pin  = $('#loginPin').value.trim();
  const msg  = $('#loginMsg');
  msg.textContent = '';
  if (!/^\d{4}$/.test(pin)) return (msg.textContent = 'PIN 請輸入4位數字');
  const btn = $('#pinLoginBtn');
  btn.disabled = true; $('span',btn).textContent = '驗證中…';
  try {
    const member = await App.db.findMember(name);
    if (!member || member.pin !== pin) return (msg.textContent = 'PIN 錯誤，請再試一次');
    App.me = member;
    restoreBazi();
    localStorage.setItem('bazi28_me', JSON.stringify({ name, pin }));
    enterApp();
  } catch(e) {
    msg.textContent = '連線失敗，請稍後重試';
  } finally {
    btn.disabled = false; $('span',btn).textContent = '進入 →';
  }
}

async function handleRegister() {
  const name  = $('#loginName').value.trim();
  const year  = parseInt($('#regYear').value);
  const month = parseInt($('#regMonth').value);
  const day   = parseInt($('#regDay').value);
  const hour  = parseInt($('#regHour').value);
  const pin   = $('#regPin').value.trim();
  const msg   = $('#loginMsg');
  msg.textContent = '';

  if (!year || year<1940 || year>2010) return (msg.textContent = '請輸入有效的出生年份（1940-2010）');
  if (!month) return (msg.textContent = '請選擇出生月份');
  if (!day   || day<1 || day>31)  return (msg.textContent = '請輸入有效的出生日期');
  if (!/^\d{4}$/.test(pin))       return (msg.textContent = 'PIN 請設定4位數字');

  const btn = $('#registerBtn');
  btn.disabled = true; $('span',btn).textContent = '計算中 ✨';
  try {
    // Calculate BaZi
    const result = BAZI.calculate(year, month, day, hour);
    App.bazi = result;

    const avatarIdx = Math.floor(Math.random() * DATA28.AVATARS.length);
    const baziProfile = { percents: result.profile.percents, selfElem: result.profile.selfElem, formatted: result.formatted };

    const member = await App.db.createMember(name, pin, year, month, day, hour, avatarIdx, baziProfile);
    App.me = member;
    localStorage.setItem('bazi28_me', JSON.stringify({ name, pin }));

    // Show profile reveal
    $('#loginOverlay').classList.add('hidden');
    showProfileReveal(result, member);
  } catch(e) {
    msg.textContent = '名字已被使用或連線失敗，請換一個名字';
    console.error(e);
  } finally {
    btn.disabled = false; $('span',btn).textContent = '計算我的能量 ✨';
  }
}

function restoreBazi() {
  if (!App.me?.bazi_profile) return;
  const p = App.me.bazi_profile;
  // Reconstruct minimal bazi object from stored profile
  App.bazi = {
    profile: { percents: p.percents, selfElem: p.selfElem },
    masterType: BAZI.getDayMasterType(p.selfElem),
    formatted: p.formatted,
  };
}

function logout() {
  if (App._praiseChannel) { App.sb.removeChannel(App._praiseChannel); App._praiseChannel = null; }
  localStorage.removeItem('bazi28_me');
  App.me = null; App.bazi = null; App.galaxyUserId = null;
  $('#app').classList.add('hidden');
  // Reset login form
  ['stepPin','stepRegister'].forEach(id => $('#'+id).classList.add('hidden'));
  $('#stepName').classList.remove('hidden');
  $('#loginName').value = ''; $('#loginPin').value = ''; $('#loginMsg').textContent = '';
  $('#loginOverlay').classList.remove('hidden');
}

/* ════════════════════════════════════════
   Profile Reveal Animation
════════════════════════════════════════ */
function showProfileReveal(bazi, member) {
  const { profile, masterType, formatted } = bazi;
  const overlay = $('#profileRevealOverlay');
  overlay.classList.remove('hidden');

  $('#revealMasterIcon').textContent = masterType.icon;
  $('#revealMasterName').textContent = masterType.name + ' · ' + masterType.elem + '日主';
  $('#revealMasterName').style.color  = masterType.color;
  $('#revealMasterDesc').textContent  = masterType.desc;

  // Four pillars
  const pLabels = ['年柱','月柱','日柱','時柱'];
  const pVals   = [formatted.year, formatted.month, formatted.day, formatted.hour];
  $('#revealPillars').innerHTML = pLabels.map((l,i) =>
    `<div class="pillar-box" style="box-shadow:3px 3px 0 ${masterType.color}">
       ${App.esc(pVals[i])}<small>${l}</small>
     </div>`
  ).join('');

  // Radar SVG
  const colors = DATA28.QUADRANTS.map(q => q.color);
  $('#revealRadar').innerHTML = BAZI.buildRadarSVG(profile.percents, colors);

  // Energy bars (animate after short delay)
  const barsEl = $('#revealBars');
  barsEl.innerHTML = DATA28.QUADRANTS.map((q, i) => {
    const pct = profile.percents[i];
    const lbl = DATA28.energyLabel(pct);
    return `<div class="qbar-row">
      <span class="qbar-icon">${q.icon}</span>
      <div class="qbar-info">
        <div class="qbar-name">${q.name} <span class="qbar-tag ${lbl.cls}">${lbl.text}</span></div>
        <div class="qbar-track">
          <div class="qbar-fill" id="bar${i}" style="width:0%;--bar-color:${q.color}"></div>
        </div>
      </div>
      <div class="qbar-pct">${pct >= 50 ? 'MAX' : pct + '%'}</div>
    </div>`;
  }).join('');

  // Animate bars
  setTimeout(() => {
    DATA28.QUADRANTS.forEach((_,i) => {
      const el = $(`#bar${i}`);
      if (el) el.style.width = Math.min(profile.percents[i], 50) / 50 * 100 + '%';
    });
  }, 200);

  $('#startJourneyBtn').onclick = () => {
    overlay.classList.add('hidden');
    enterApp();
  };
}

/* ════════════════════════════════════════
   Enter Main App
════════════════════════════════════════ */
function enterApp() {
  App.todayDay = App.dayFromDate();
  $('#loginOverlay').classList.add('hidden');
  $('#profileRevealOverlay').classList.add('hidden');
  const topAvatar = $('#topAvatar');
  topAvatar.textContent = DATA28.AVATARS[App.me.avatar_index || 0];
  $('#topName').textContent  = App.me.name;
  $('#topTeam').textContent  = App.cfg.team_name || '品牌故事';
  $('#dayBadge').textContent = `Day ${App.todayDay}`;
  $('#app').classList.remove('hidden');
  showPage('task');
  subscribePraises();
  setTimeout(() => checkDay5Milestone(), 900);
}

function subscribePraises() {
  if (App._praiseChannel) App.sb.removeChannel(App._praiseChannel);
  App._praiseChannel = App.sb
    .channel('praise-inbox-' + App.me.id)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'bazi28_praises',
      filter: `to_id=eq.${App.me.id}`,
    }, (payload) => {
      const { from_name, emoji } = payload.new;
      showPraiseNotif(from_name, emoji);
    })
    .subscribe();
}

function showPraiseNotif(fromName, emoji) {
  const el = $('#praiseNotif');
  if (!el) return;
  $('#praiseNotifEmoji').textContent = emoji;
  $('#praiseNotifText').textContent  = `${fromName} 給你送來鼓勵！`;
  el.classList.add('show');
  clearTimeout(App._praiseNotifTimer);
  App._praiseNotifTimer = setTimeout(() => el.classList.remove('show'), 4500);
}

/* ════════════════════════════════════════
   Day 5 品牌人設卡
════════════════════════════════════════ */
async function checkDay5Milestone() {
  if (App.todayDay < 5) return;
  const existing = await App.db.getMilestone('day5_card');
  if (existing) return;

  const allTasks = await App.db.myTasks();
  const stories  = allTasks.filter(t => t.day_index <= 4 && t.response);

  if (stories.length === 0) {
    if (App._day5Prompted) return;
    App._day5Prompted = true;
    App.openModal(`
      <div style="text-align:center;padding:32px 20px">
        <div style="font-size:52px;margin-bottom:12px">🌟</div>
        <div style="font-size:19px;font-weight:900;font-style:italic;color:var(--ink);margin-bottom:10px">你的品牌人設卡正在等你</div>
        <p style="font-size:14px;color:var(--ink-mid);line-height:1.7;margin-bottom:0">完成任意一天的故事，AI 就能為你生成<br><strong>專屬品牌人設卡</strong>，幫你找到自己最獨特的優勢！</p>
        <button class="btn btn-gold btn-block" onclick="App.closeModal();showPage('task')" style="margin-top:20px"><span>去完成今日任務 ✨</span></button>
        <button class="link-btn" onclick="App.closeModal()" style="margin-top:10px;display:block;text-align:center">稍後再說</button>
      </div>
    `);
    return;
  }

  App.openModal(`
    <div style="text-align:center;padding:40px 24px">
      <div style="font-size:48px;margin-bottom:14px">✨</div>
      <div style="font-size:18px;font-weight:900;font-style:italic;color:var(--ink)">正在生成你的品牌人設卡…</div>
      <div style="font-size:13px;color:var(--ink-light);margin-top:8px">AI 正在分析你的故事，請稍候</div>
      <div style="font-size:32px;margin-top:20px" class="spinning">⏳</div>
    </div>
  `);

  try {
    const masterTypeName = App.bazi?.masterType?.name || '';
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/day5-milestone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}` },
      body: JSON.stringify({
        memberName: App.me.name,
        masterTypeName,
        stories: stories.map(s => ({
          day_index: s.day_index,
          title: DATA28.getTask(s.day_index).title,
          response: s.response,
        })),
      }),
    });
    const cardData = await res.json();
    if (cardData.error) throw new Error(cardData.error);
    const full = { ...cardData, masterTypeName, memberName: App.me.name };
    await App.db.saveMilestone('day5_card', full);
    showMilestonePopup(full);
  } catch(err) {
    App.closeModal();
    console.error('day5 milestone:', err);
    App.toast('人設卡生成失敗，請稍後重試');
  }
}

function showMilestonePopup(cardData) {
  App.closeModal();
  const canvas  = generateMilestoneCanvas(cardData);
  const dataUrl = canvas.toDataURL('image/png');
  App.openModal(`
    <div style="text-align:center;padding:16px">
      <div style="font-size:13px;font-weight:700;color:var(--gold);letter-spacing:1px;margin-bottom:10px">✦ 你的品牌人設卡已生成 ✦</div>
      <img src="${dataUrl}" style="width:100%;max-width:380px;border-radius:12px;display:block;margin:0 auto 14px;box-shadow:0 4px 24px rgba(0,0,0,.4)" alt="品牌人設卡"/>
      <a href="${dataUrl}" download="${App.esc(App.me.name || '我')}_品牌人設卡.png"
         class="btn btn-gold btn-block" style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;margin-bottom:8px">
        <span>⬇️ 下載圖片</span>
      </a>
      <button class="btn btn-outline btn-block" onclick="App.closeModal()" style="border-color:var(--cream-dark);color:var(--ink-mid)">關閉</button>
      <div style="font-size:11px;color:var(--ink-light);margin-top:10px">在「📜 記錄」頁可隨時重新查看</div>
    </div>
  `);
}

function generateMilestoneCanvas(cardData) {
  const W = 1080, H = 1080;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const gold = '#C9A84C', cream = '#FFF8EE';
  const F = (w, s) => `${w} ${s}px 'PingFang TC','Noto Sans TC','Microsoft YaHei',sans-serif`;

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#120A00'); bg.addColorStop(1, '#1E1100');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Top gold gradient overlay
  const hg = ctx.createLinearGradient(0, 50, 0, 220);
  hg.addColorStop(0, 'rgba(201,168,76,0.16)'); hg.addColorStop(1, 'rgba(201,168,76,0)');
  ctx.fillStyle = hg; _milestoneRR(ctx, 29, 29, W-58, 190, 16); ctx.fill();

  // Outer border
  ctx.strokeStyle = gold; ctx.lineWidth = 6;
  _milestoneRR(ctx, 28, 28, W-56, H-56, 18); ctx.stroke();
  // Inner border
  ctx.strokeStyle = 'rgba(201,168,76,0.28)'; ctx.lineWidth = 1.5;
  _milestoneRR(ctx, 46, 46, W-92, H-92, 10); ctx.stroke();

  ctx.textAlign = 'center';

  // App title
  ctx.fillStyle = 'rgba(201,168,76,0.55)'; ctx.font = F(500, 24);
  ctx.fillText('28天品牌故事挑戰', W/2, 96);

  // Badge
  const bW=320, bH=48, bX=W/2-bW/2, bY=114;
  ctx.fillStyle = 'rgba(201,168,76,0.14)'; _milestoneRR(ctx, bX, bY, bW, bH, 24); ctx.fill();
  ctx.strokeStyle = 'rgba(201,168,76,0.42)'; ctx.lineWidth = 1; _milestoneRR(ctx, bX, bY, bW, bH, 24); ctx.stroke();
  ctx.fillStyle = gold; ctx.font = F('bold', 22);
  ctx.fillText('✦  第5天 · 品牌人設卡  ✦', W/2, bY + 31);

  // Character title
  let y = 226;
  ctx.fillStyle = cream; ctx.font = F(900, 52);
  const charN = _milestoneWrap(ctx, cardData.character || '品牌先鋒', W/2, y, W-160, 64);
  y += charN * 64 + 28;

  // Divider
  ctx.strokeStyle = gold; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(100, y); ctx.lineTo(W-100, y); ctx.stroke();
  [100, W/2, W-100].forEach(x => {
    ctx.fillStyle = gold; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2); ctx.fill();
  });
  y += 48;

  // Core advantage
  ctx.fillStyle = gold; ctx.font = F(600, 24); ctx.textAlign = 'center';
  ctx.fillText('⬡  核心優勢  ⬡', W/2, y); y += 52;
  ctx.fillStyle = cream; ctx.font = F(900, 44);
  const advN = _milestoneWrap(ctx, cardData.advantage || '', W/2, y, W-160, 56);
  y += advN * 56 + 38;

  // Tags
  const tags = (cardData.tags || []).slice(0, 4);
  const tagColors = ['#C0392B','#8E44AD','#27AE60','#2980B9'];
  ctx.font = F(600, 22);
  const tWs = tags.map(t => Math.max(ctx.measureText(t).width + 44, 110));
  const tGap = 14;
  const tTotal = tWs.reduce((s,w)=>s+w,0) + tGap*(tags.length-1);
  let tx = W/2 - tTotal/2;
  tags.forEach((tag, i) => {
    const tw = tWs[i], th = 46;
    ctx.fillStyle = tagColors[i%4] + '40'; _milestoneRR(ctx, tx, y, tw, th, th/2); ctx.fill();
    ctx.strokeStyle = tagColors[i%4]; ctx.lineWidth = 1.5; _milestoneRR(ctx, tx, y, tw, th, th/2); ctx.stroke();
    ctx.fillStyle = cream; ctx.font = F(600, 22); ctx.textAlign = 'center';
    ctx.fillText(tag, tx + tw/2, y + 30); tx += tw + tGap;
  });
  y += 60;

  // Story quote
  ctx.fillStyle = gold; ctx.fillRect(82, y - 8, 4, 104);
  ctx.fillStyle = 'rgba(201,168,76,0.10)'; _milestoneRR(ctx, 93, y - 14, W-174, 118, 10); ctx.fill();
  ctx.fillStyle = cream; ctx.font = `italic 28px 'PingFang TC','Noto Sans TC',sans-serif`;
  ctx.textAlign = 'left';
  _milestoneWrap(ctx, `「${cardData.story || ''}」`, 112, y + 36, W-230, 40);
  y += 130;

  // Decorative
  ['✦','✦','✦'].forEach((s, i) => {
    ctx.fillStyle = `rgba(201,168,76,${0.18+i*0.09})`; ctx.textAlign='center';
    ctx.font = `${16+i*5}px sans-serif`;
    ctx.fillText(s, W/4*(i+1), y + 14);
  });

  // Bottom
  const botY = H - 108;
  ctx.strokeStyle = 'rgba(201,168,76,0.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(80, botY); ctx.lineTo(W-80, botY); ctx.stroke();
  ctx.fillStyle = gold; ctx.font = F('bold', 32); ctx.textAlign = 'center';
  ctx.fillText(cardData.memberName || App.me.name, W/2, botY + 44);
  ctx.fillStyle = 'rgba(201,168,76,0.55)'; ctx.font = F(400, 22);
  ctx.fillText(cardData.masterTypeName || '28天品牌挑戰者', W/2, botY + 74);

  return cv;
}

function _milestoneWrap(ctx, text, x, y, maxW, lineH) {
  if (!text) return 0;
  let line = '', n = 0;
  for (const ch of [...text]) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + n * lineH); line = ch; n++;
    } else { line = test; }
  }
  if (line) { ctx.fillText(line, x, y + n * lineH); n++; }
  return n;
}

function _milestoneRR(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}

/* ════════════════════════════════════════
   Navigation
════════════════════════════════════════ */
function showPage(page) {
  if (App._galaxy3D && page !== 'social') {
    App._galaxy3D.cleanup();
    App._galaxy3D = null;
  }
  App.currentPage = page;
  $$('.page').forEach(p => p.classList.add('hidden'));
  $(`#page-${page}`).classList.remove('hidden');
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));

  if (page === 'task')   renderTaskPage();
  if (page === 'record') renderRecordPage();
  if (page === 'social') renderSocialPage();
  if (page === 'team')   renderTeamPage();
}

/* ════════════════════════════════════════
   小老師 AI 對話
════════════════════════════════════════ */
async function showTeacherModal(task) {
  const day = task.day;
  const [chats, todayCount] = await Promise.all([
    App.db.getAIChats(day),
    App.db.countTodayUserMsg(day),
  ]);
  let remaining = Math.max(0, 5 - todayCount);

  const chatHtml = chats.map(c =>
    `<div class="teacher-msg ${c.role === 'user' ? 'teacher-msg-user' : 'teacher-msg-ai'}">
      ${c.role === 'assistant' ? '<span class="teacher-msg-avatar">🤖</span>' : ''}
      <div class="teacher-msg-bubble">${App.esc(c.content)}</div>
    </div>`
  ).join('');

  App.openModal(`
    <div class="teacher-modal-wrap">
      <div class="teacher-modal-header">
        <div class="teacher-modal-info">
          <span class="teacher-modal-icon">🤖</span>
          <div>
            <div class="teacher-modal-title">小老師</div>
            <div class="teacher-modal-sub">Day ${day} · ${App.esc(task.title)}</div>
          </div>
        </div>
        <button class="modal-close" onclick="App.closeModal()" style="position:relative;top:0;right:0;flex-shrink:0">✕</button>
      </div>
      <div class="teacher-chat" id="teacherChat">
        <div class="teacher-msg teacher-msg-ai">
          <span class="teacher-msg-avatar">🤖</span>
          <div class="teacher-msg-bubble">對今天的任務有什麼想問的或是要協助的呢？ 😊</div>
        </div>
        ${chatHtml}
      </div>
      <div class="teacher-footer">
        <div class="teacher-limit" id="teacherLimit">今天還剩 <strong>${remaining}</strong> 次對話機會</div>
        <div id="teacherInputRow">
          ${remaining > 0 ? `
            <div class="teacher-input-row">
              <textarea class="teacher-input" id="teacherInput" placeholder="輸入你的問題…" rows="2"></textarea>
              <button class="teacher-send-btn" id="teacherSendBtn">送出</button>
            </div>` : '<div class="teacher-limit-msg">今天的對話次數已用完，明天見！🌙</div>'}
        </div>
      </div>
    </div>
  `);

  const chatEl = document.getElementById('teacherChat');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;

  if (remaining > 0) {
    const doSend = () => sendTeacherMessage(task, chats, () => {
      remaining--;
      const lEl = document.getElementById('teacherLimit');
      if (lEl) lEl.querySelector('strong').textContent = Math.max(0, remaining);
      if (remaining <= 0) {
        const ir = document.getElementById('teacherInputRow');
        if (ir) ir.innerHTML = '<div class="teacher-limit-msg">今天的對話次數已用完，明天見！🌙</div>';
      }
    });
    document.getElementById('teacherSendBtn').onclick = doSend;
    document.getElementById('teacherInput').onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
    };
  }
}

async function sendTeacherMessage(task, history, onSuccess) {
  const input = document.getElementById('teacherInput');
  const sendBtn = document.getElementById('teacherSendBtn');
  const chatEl = document.getElementById('teacherChat');
  if (!input || !chatEl) return;
  const msg = input.value.trim();
  if (!msg) return;

  input.value = ''; input.disabled = true;
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '…'; }

  chatEl.insertAdjacentHTML('beforeend', `
    <div class="teacher-msg teacher-msg-user"><div class="teacher-msg-bubble">${App.esc(msg)}</div></div>
    <div class="teacher-msg teacher-msg-ai" id="tcLoad"><span class="teacher-msg-avatar">🤖</span><div class="teacher-msg-bubble">思考中…</div></div>
  `);
  chatEl.scrollTop = chatEl.scrollHeight;
  await App.db.saveAIChat(task.day, 'user', msg);

  try {
    const res = await fetch(`${window.CONFIG.SUPABASE_URL}/functions/v1/teacher-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.CONFIG.SUPABASE_ANON_KEY}` },
      body: JSON.stringify({
        dayIndex: task.day, taskTitle: task.title, taskPrompt: task.prompt, message: msg,
        history: history.map(h => ({ role: h.role, content: h.content })),
      }),
    });
    const { reply } = await res.json();
    document.getElementById('tcLoad')?.remove();
    chatEl.insertAdjacentHTML('beforeend', `
      <div class="teacher-msg teacher-msg-ai"><span class="teacher-msg-avatar">🤖</span><div class="teacher-msg-bubble">${App.esc(reply)}</div></div>
    `);
    chatEl.scrollTop = chatEl.scrollHeight;
    await App.db.saveAIChat(task.day, 'assistant', reply);
    history.push({ role: 'user', content: msg }, { role: 'assistant', content: reply });
    onSuccess?.();
    input.disabled = false;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '送出'; }
    input.focus();
  } catch(_) {
    document.getElementById('tcLoad')?.remove();
    chatEl.insertAdjacentHTML('beforeend', `
      <div class="teacher-msg teacher-msg-ai"><span class="teacher-msg-avatar">🤖</span><div class="teacher-msg-bubble">連線失敗，請重試 😢</div></div>
    `);
    chatEl.scrollTop = chatEl.scrollHeight;
    input.disabled = false;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '送出'; }
  }
}

async function generateBrandStory() {
  const btn = document.getElementById('aiGenBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span>生成中，請稍候… ✨</span>';
  try {
    const res = await fetch(`${window.CONFIG.SUPABASE_URL}/functions/v1/generate-brand-story`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${window.CONFIG.SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ memberId: App.me.id, memberName: App.me.name, baziProfile: App.me.bazi_profile }),
    });
    if (!res.ok) throw new Error();
    const { story } = await res.json();
    const ta = document.getElementById('taskResponse');
    if (ta) { ta.value = story; ta.dispatchEvent(new Event('input')); ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    App.toast('品牌故事已生成！你可以繼續編輯後提交。✨', 3500);
    btn.innerHTML = '<span>✨ 重新生成</span>';
  } catch(_) {
    App.toast('生成失敗，請確認 AI 功能已設定');
    btn.innerHTML = '<span>✨ AI 幫我生成品牌故事</span>';
  } finally {
    btn.disabled = false;
  }
}

/* ════════════════════════════════════════
   AI 時代優勢報告 (Day 28 Conclusion)
════════════════════════════════════════ */
function renderAIEraSectionHtml(bazi) {
  if (!bazi?.profile?.percents) return '';
  const adv = DATA28.getAIEraAdvantage(bazi.profile.percents);
  const { primary, secondary, dominantQ, secondaryQ, dominantPct, secondaryPct } = adv;

  return `
    <div class="ai-era-card">
      <div class="ai-era-header">
        <div class="ai-era-badge">🤖 × 👑</div>
        <div class="ai-era-title">你在 AI 時代的核心優勢</div>
        <div class="ai-era-sub">基於你的八字能量圖譜，專屬計算</div>
      </div>
      <div class="ai-era-body">
        <div class="ai-era-profile-row">
          <span class="ai-era-chip" style="background:${dominantQ.color}22;border-color:${dominantQ.color};color:${dominantQ.color}">${dominantQ.icon} ${dominantQ.name} ${dominantPct}%</span>
          <span class="ai-era-x">×</span>
          <span class="ai-era-chip" style="background:${secondaryQ.color}22;border-color:${secondaryQ.color};color:${secondaryQ.color}">${secondaryQ.icon} ${secondaryQ.name} ${secondaryPct}%</span>
        </div>
        <div class="ai-era-advantage-box">
          <div class="ai-era-headline">${App.esc(primary.headline)}</div>
          <div class="ai-era-headline-sub">${App.esc(primary.subtitle)}</div>
        </div>
        <div class="ai-era-section">
          <div class="ai-era-section-hd">🌐 為什麼在 AI 時代特別有力</div>
          <div class="ai-era-section-body">${App.esc(primary.whyAI)}</div>
        </div>
        <div class="ai-era-section">
          <div class="ai-era-section-hd">⚡ 你的核心競爭優勢</div>
          <div class="ai-era-section-body">${App.esc(primary.coreAdvantage)}</div>
        </div>
        <div class="ai-era-strategies">
          <div class="ai-era-section-hd">🚀 四大放大策略</div>
          ${primary.strategies.map((s, i) => `
            <div class="ai-era-strategy-item">
              <div class="ai-era-strategy-num">${i+1}</div>
              <div class="ai-era-strategy-text">${App.esc(s)}</div>
            </div>
          `).join('')}
        </div>
        <div class="ai-era-cta">
          <div class="ai-era-cta-label">🎯 你的第一步行動</div>
          <div class="ai-era-cta-text">${App.esc(primary.action)}</div>
        </div>
        ${secondaryPct >= 20 ? `
        <div class="ai-era-secondary">
          <div class="ai-era-secondary-label" style="color:${secondaryQ.color}">${secondaryQ.icon} 第二能量加成：${secondary.headline}</div>
          <div class="ai-era-secondary-text">${App.esc(secondary.coreAdvantage)}</div>
        </div>` : ''}
      </div>
    </div>
  `;
}

/* ════════════════════════════════════════
   任務頁 (Task Page)
════════════════════════════════════════ */
async function renderTaskPage() {
  const pg = $('#page-task');
  pg.innerHTML = '<div class="empty-tip"><span class="spinning">⏳</span> 載入任務中…</div>';

  const task     = DATA28.getTask(App.todayDay);
  const existing = await App.db.getMyTask(App.todayDay);
  const ctx      = App.bazi ? DATA28.getPersonalizedContext(task, App.bazi.profile.percents) : null;

  // Determine accent colours
  let accentColor = '#C9A84C', accentIcon = task.icon;
  if (task.type === 'quadrant') {
    accentColor = DATA28.QUADRANTS[task.quadrantId].color;
  }

  const doneCount = (await App.db.myTasks()).filter(t => t.response).length;
  const pct = Math.round(doneCount / 28 * 100);

  pg.innerHTML = `
    <!-- Hero card -->
    <div class="card-hero">
      <div class="speed-lines"></div>
      <div class="task-day-header">
        <span class="task-day-no">Day ${App.todayDay} / 28</span>
        ${task.type === 'quadrant' ? `<span class="task-quadrant-chip" style="background:${accentColor}">${DATA28.QUADRANTS[task.quadrantId].name}</span>` : ''}
        ${task.type === 'warmup'   ? `<span class="task-quadrant-chip" style="background:#C9A84C;color:#1A0F00">暖身</span>` : ''}
        ${task.type === 'summary'  ? `<span class="task-quadrant-chip" style="background:#8B6B1A">大總結</span>` : ''}
        ${task.type === 'brand'    ? `<span class="task-quadrant-chip" style="background:linear-gradient(135deg,#C0392B,#8E44AD)">品牌故事</span>` : ''}
      </div>
      ${task.type === 'quadrant' ? `<div class="task-quadrant-label">${task.icon} ${DATA28.QUADRANTS[task.quadrantId].subtitle}</div>` : ''}
      <div class="task-title">${App.esc(task.title)}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-label">${doneCount} / 28 天完成 · ${pct}%</div>
      ${ctx ? `<div class="task-context-box">${App.esc(ctx)}</div>` : ''}
    </div>

    <!-- Prompt card -->
    <div class="card" id="promptCard">
      <div class="card-title-row">
        <span class="card-title">${task.icon} 今日任務</span>
        <button class="teacher-btn" id="teacherBtn">🤖 小老師</button>
      </div>
      ${App.renderPrompt(task.prompt)}
      ${task.type === 'brand' ? `<div class="ai-gen-section">
        <p class="ai-gen-hint">根據你過去 27 天的所有記錄，AI 將生成你的專屬品牌故事</p>
        <button class="btn btn-gold btn-block" id="aiGenBtn" style="margin-top:6px"><span>✨ AI 幫我生成品牌故事</span></button>
      </div>` : ''}
    </div>

    <!-- Response area -->
    <div class="card">
      <div class="card-title">✍️ 寫下你的故事</div>
      ${existing?.response ? `<div class="task-already-done">✅ 今天已完成！你可以繼續編輯。</div>` : ''}
      <div class="task-textarea-wrap" style="margin-top:10px">
        <textarea class="task-textarea" id="taskResponse" placeholder="在這裡寫下你的故事……不需要完美，只需要真實。">${App.esc(existing?.response || '')}</textarea>
        <span class="word-count" id="wordCount">0 字</span>
      </div>
      <button class="btn btn-gold btn-block" id="saveTaskBtn" style="margin-top:12px">
        <span>${existing?.response ? '更新故事 ✨' : '提交今日故事 ✨'}</span>
      </button>
    </div>
    ${App.todayDay === 28 && App.bazi ? renderAIEraSectionHtml(App.bazi) : ''}
  `;

  // Word count
  const ta = $('#taskResponse'), wc = $('#wordCount');
  const updateWC = () => {
    const n = ta.value.replace(/\s/g,'').length;
    wc.textContent = n + ' 字';
    wc.classList.toggle('over', n > 1200);
  };
  ta.addEventListener('input', updateWC);
  updateWC();

  // Teacher button
  $('#teacherBtn').onclick = () => showTeacherModal(task);

  // AI gen (Day 28)
  if (task.type === 'brand') {
    const aiGenBtn = $('#aiGenBtn');
    if (aiGenBtn) aiGenBtn.onclick = generateBrandStory;
  }

  // Save
  $('#saveTaskBtn').onclick = async () => {
    const text = $('#taskResponse').value.trim();
    if (text.length < 20) return App.toast('請寫多一點（至少20字）😊');
    const btn = $('#saveTaskBtn'); btn.disabled = true;
    $('span',btn).textContent = '儲存中…';
    try {
      await App.db.saveTask(App.todayDay, text);
      App.toast('故事已記錄！🌟');
      launchConfetti();
      $('span',btn).textContent = '更新故事 ✨';
      // Re-render to show "done" badge
      await renderTaskPage();
    } catch(e) {
      App.toast('儲存失敗，請重試');
      btn.disabled = false; $('span',btn).textContent = '提交今日故事 ✨';
    }
  };
}

/* ════════════════════════════════════════
   記錄頁 (Record Page)
════════════════════════════════════════ */
async function renderRecordPage() {
  const pg = $('#page-record');
  pg.innerHTML = '<div class="empty-tip"><span class="spinning">⏳</span> 載入記錄中…</div>';

  const [tasks, milestone] = await Promise.all([
    App.db.myTasks(),
    App.db.getMilestone('day5_card'),
  ]);
  const doneMap = {};
  tasks.forEach(t => { if (t.response) doneMap[t.day_index] = t; });

  const cells = Array.from({length:28}, (_,i) => {
    const d = i+1;
    const task = DATA28.getTask(d);
    const done = doneMap[d];
    const isToday = d === App.todayDay;
    const isFuture = d > App.todayDay;
    const cls = done ? 'done' : isToday ? 'today' : isFuture ? 'future' : '';
    const bg  = done && task.quadrantId != null ? App.qColor(task.quadrantId) : '';
    const excerpt = done ? done.response.slice(0,40) + '…' : '';
    return `<div class="record-cell ${cls}" data-day="${d}"
              ${bg ? `style="background:${bg};border-color:${bg}"` : ''}>
      <div class="record-cell-day">Day ${d}</div>
      <div class="record-cell-icon">${task.icon}</div>
      ${done ? `<div class="record-cell-excerpt">${App.esc(excerpt)}</div>` : ''}
    </div>`;
  }).join('');

  const milestoneHtml = milestone ? `
    <div class="milestone-record-card">
      <div class="milestone-record-badge">✨ 第5天・品牌人設卡</div>
      <div class="milestone-record-character">${App.esc(milestone.content.character || '')}</div>
      <div class="milestone-record-advantage">${App.esc(milestone.content.advantage || '')}</div>
      <div class="milestone-record-tags">
        ${(milestone.content.tags || []).map(t => `<span class="milestone-record-tag">${App.esc(t)}</span>`).join('')}
      </div>
      <button class="btn btn-gold btn-block" id="milestoneViewBtn" style="margin-top:14px"><span>🖼️ 查看 & 下載圖片</span></button>
    </div>
  ` : '';

  pg.innerHTML = `
    ${milestoneHtml}
    <div class="card">
      <div class="card-title">📜 我的28天記錄</div>
      <div class="record-grid">${cells}</div>
    </div>
    <div id="recordDetail"></div>
  `;

  if (milestone) {
    $('#milestoneViewBtn', pg).onclick = () => showMilestonePopup(milestone.content);
  }

  $$('.record-cell:not(.future)', pg).forEach(cell => {
    cell.addEventListener('click', () => showRecordDetail(+cell.dataset.day, doneMap, pg));
  });
}

function showRecordDetail(day, doneMap, pg) {
  const task = DATA28.getTask(day);
  const done = doneMap[day];
  const det  = $('#recordDetail', pg);
  if (!det) return;

  if (done) {
    _renderRecordView(day, done, task, det, doneMap, pg);
  } else {
    _renderRecordEdit(day, task, '', det, doneMap, pg);
  }
}

function _accentFor(task) {
  return task.quadrantId != null ? DATA28.QUADRANTS[task.quadrantId].color : '#C9A84C';
}

function _renderRecordView(day, done, task, det, doneMap, pg) {
  const q = task.quadrantId != null ? DATA28.QUADRANTS[task.quadrantId] : null;
  const ac = _accentFor(task);
  const date = new Date(done.completed_at).toLocaleDateString('zh-TW');

  det.innerHTML = `
    <div class="record-detail-card" style="border-color:${ac};box-shadow:3px 3px 0 ${ac}">
      <div class="record-detail-header">
        <div class="record-detail-icon">${task.icon}</div>
        <div>
          <div class="record-detail-title">Day ${day} · ${App.esc(task.title)}</div>
          <div class="record-detail-day">完成於 ${date} ${q?`· ${q.name}`:''}</div>
        </div>
      </div>
      <div class="record-detail-text">${App.esc(done.response)}</div>
      <button class="btn btn-outline btn-block btn-sm" id="editRecordBtn" style="margin-top:12px">✏️ 修改這天的故事</button>
    </div>
  `;
  $('#editRecordBtn', det).onclick = () => _renderRecordEdit(day, task, done.response, det, doneMap, pg);
  det.scrollIntoView({ behavior:'smooth' });
}

function _renderRecordEdit(day, task, existing, det, doneMap, pg) {
  const ac    = _accentFor(task);
  const isNew = !existing;

  det.innerHTML = `
    <div class="record-detail-card" style="border-color:${ac};box-shadow:3px 3px 0 ${ac}">
      <div class="record-detail-header">
        <div class="record-detail-icon">${task.icon}</div>
        <div>
          <div class="record-detail-title">Day ${day} · ${App.esc(task.title)}</div>
          <div class="record-detail-day" style="color:${ac}">${isNew ? '補填記錄' : '修改記錄'}</div>
        </div>
      </div>
      <div class="record-edit-prompt">${App.renderPrompt(task.prompt)}</div>
      <div class="task-textarea-wrap" style="margin-top:10px">
        <textarea class="task-textarea" id="recEditTA" placeholder="在這裡寫下你的故事……">${App.esc(existing)}</textarea>
        <span class="word-count" id="recEditWC">0 字</span>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        ${!isNew ? `<button class="btn btn-outline btn-block" id="recCancelBtn" style="flex:0 0 80px">取消</button>` : ''}
        <button class="btn btn-gold btn-block" id="recSaveBtn"><span>${isNew ? '儲存記錄 ✨' : '更新故事 ✨'}</span></button>
      </div>
    </div>
  `;

  const ta = $('#recEditTA', det);
  const wc = $('#recEditWC', det);
  const updateWC = () => { wc.textContent = ta.value.replace(/\s/g,'').length + ' 字'; };
  ta.addEventListener('input', updateWC);
  updateWC();

  if (!isNew) {
    $('#recCancelBtn', det).onclick = () => _renderRecordView(day, doneMap[day], task, det, doneMap, pg);
  }

  $('#recSaveBtn', det).onclick = async () => {
    const text = ta.value.trim();
    if (text.length < 20) return App.toast('請寫多一點（至少20字）😊');
    const btn = $('#recSaveBtn', det); btn.disabled = true;
    $('span', btn).textContent = '儲存中…';
    try {
      await App.db.saveTask(day, text);
      App.toast(isNew ? `Day ${day} 記錄已補填！🌟` : '故事已更新！🌟');
      const updated = await App.db.getMyTask(day);
      if (updated) doneMap[day] = updated;
      // Refresh grid cell
      const cell = $(`.record-cell[data-day="${day}"]`, pg);
      if (cell) {
        cell.classList.add('done');
        cell.classList.remove('today');
        if (task.quadrantId != null) {
          const c = App.qColor(task.quadrantId);
          cell.style.background = c; cell.style.borderColor = c;
        }
        const excerpEl = cell.querySelector('.record-cell-excerpt');
        const excerpt = text.slice(0,40) + '…';
        if (excerpEl) excerpEl.textContent = excerpt;
        else cell.insertAdjacentHTML('beforeend', `<div class="record-cell-excerpt">${App.esc(excerpt)}</div>`);
      }
      _renderRecordView(day, updated, task, det, doneMap, pg);
    } catch(_) {
      App.toast('儲存失敗，請重試');
      btn.disabled = false;
      $('span', btn).textContent = isNew ? '儲存記錄 ✨' : '更新故事 ✨';
    }
  };

  det.scrollIntoView({ behavior:'smooth' });
  setTimeout(() => ta.focus(), 300);
}

/* ════════════════════════════════════════
   星系社交頁 (Galaxy Social Page)
════════════════════════════════════════ */
async function renderSocialPage() {
  const pg = $('#page-social');
  pg.innerHTML = '<div class="empty-tip"><span class="spinning">⏳</span> 載入星系中…</div>';

  if (!App.galaxyUserId) App.galaxyUserId = App.me.id;

  const allMem    = await App.db.allMembers();
  const viewMem   = allMem.find(m => m.id === App.galaxyUserId) || allMem.find(m => m.id === App.me.id);
  if (!viewMem) { App.galaxyUserId = App.me.id; }

  const tasks   = await App.db.memberTasks(App.galaxyUserId);
  const doneMap = {};
  tasks.forEach(t => { if (t.response) doneMap[t.day_index] = t; });

  const doneCount = Object.keys(doneMap).length;
  const av   = DATA28.AVATARS[viewMem?.avatar_index || 0];
  const isMe = App.galaxyUserId === App.me.id;

  pg.innerHTML = `
    <div class="galaxy-wrap">
      <div class="galaxy-topbar">
        <div class="galaxy-title">
          ${av}
          <span>${App.esc(viewMem?.name || '?')}</span>
          <span class="galaxy-badge ${isMe ? 'galaxy-badge-me' : 'galaxy-badge-other'}">${isMe ? '我的星系' : '他人星系'}</span>
        </div>
        <div class="galaxy-user-sel" id="galaxyUserSel">
          <button class="galaxy-menu-btn" id="galaxyMenuBtn">${av} ▾</button>
          <div class="galaxy-dropdown hidden" id="galaxyDropdown">
            <div class="galaxy-drop-item ${isMe ? 'active' : ''}" data-uid="${App.me.id}">
              <span>${DATA28.AVATARS[App.me.avatar_index||0]}</span>
              <span>${App.esc(App.me.name)}</span>
              <span class="galaxy-me-tag">我</span>
            </div>
            ${allMem.filter(m => m.id !== App.me.id).map(m => `
              <div class="galaxy-drop-item ${m.id === App.galaxyUserId ? 'active' : ''}" data-uid="${m.id}">
                <span>${DATA28.AVATARS[m.avatar_index||0]}</span>
                <span>${App.esc(m.name)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="galaxy-stats">
        <span class="galaxy-stat-n">${doneCount}</span>
        <span class="galaxy-stat-lbl">顆星點亮</span>
        <span class="galaxy-stat-sep">·</span>
        <span class="galaxy-stat-n">${28 - doneCount}</span>
        <span class="galaxy-stat-lbl">顆待發光</span>
      </div>
      <div class="galaxy-legend">
        <span class="galaxy-legend-item"><span class="galaxy-legend-dot" style="background:#C9A84C"></span>核心</span>
        ${DATA28.QUADRANTS.map(q => `<span class="galaxy-legend-item"><span class="galaxy-legend-dot" style="background:${q.color}"></span>${q.name}</span>`).join('')}
      </div>
      <div class="galaxy-svg-wrap" id="galaxySvgWrap"></div>
      <button class="btn btn-gold btn-block" id="dlBookshelfBtn" style="margin-top:16px"><span>📖 下載星系紀念冊（HTML）</span></button>
    </div>
  `;

  buildGalaxy3D(doneMap, viewMem);

  const dlBtn = $('#dlBookshelfBtn');
  if (dlBtn) dlBtn.onclick = () => downloadBookshelf(viewMem || App.me, doneMap, doneCount);

  $('#galaxyMenuBtn').onclick = (e) => {
    e.stopPropagation();
    $('#galaxyDropdown').classList.toggle('hidden');
  };
  $$('.galaxy-drop-item').forEach(item => {
    item.onclick = () => {
      App.galaxyUserId = item.dataset.uid;
      renderSocialPage();
    };
  });
  function onOutside(e) {
    const sel = document.getElementById('galaxyUserSel');
    if (sel && !sel.contains(e.target)) {
      const dd = document.getElementById('galaxyDropdown');
      if (dd) dd.classList.add('hidden');
      document.removeEventListener('click', onOutside, true);
    }
  }
  document.addEventListener('click', onOutside, true);
}

/* 產生獨立、可下載的星系 SVG 字串（不含事件，圖示與標題已內嵌） */
function galaxySVGString(doneMap, member) {
  const W = 380, H = 380, CX = 190, CY = 190;
  const RINGS = [
    { r: 46,  qId: -1, color: '#C9A84C', days: [1, 27, 28] },
    { r: 78,  qId: 0,  color: '#C0392B', days: [2,3,4,5,6] },
    { r: 106, qId: 1,  color: '#8E44AD', days: [7,8,9,10,11] },
    { r: 132, qId: 2,  color: '#27AE60', days: [12,13,14,15,16] },
    { r: 156, qId: 3,  color: '#2980B9', days: [17,18,19,20,21] },
    { r: 177, qId: 4,  color: '#E67E22', days: [22,23,24,25,26] },
  ];
  const uid = Math.floor(Math.random() * 1e9);
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-width:380px">
    <defs>
      <radialGradient id="sbg${uid}" cx="50%" cy="50%" r="55%">
        <stop offset="0%" stop-color="#1C0D38"/><stop offset="55%" stop-color="#0E0720"/><stop offset="100%" stop-color="#050210"/>
      </radialGradient>
      <radialGradient id="sunr${uid}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#C9A84C" stop-opacity="0.4"/><stop offset="100%" stop-color="#C9A84C" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sbg${uid})" rx="14"/>`;
  for (let i = 0; i < 88; i++) {
    const x = (Math.random() * W).toFixed(1), y = (Math.random() * H).toFixed(1);
    const r = (Math.random() * 1.3 + 0.2).toFixed(1), o = (Math.random() * 0.45 + 0.05).toFixed(2);
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`;
  }
  RINGS.forEach(ring => {
    const d = (ring.r * 0.28).toFixed(1), g = (ring.r * 0.07).toFixed(1);
    svg += `<circle cx="${CX}" cy="${CY}" r="${ring.r}" fill="none" stroke="${ring.color}" stroke-width="1.5" stroke-opacity="0.28" stroke-dasharray="${d} ${g}"/>`;
  });
  svg += `<circle cx="${CX}" cy="${CY}" r="42" fill="url(#sunr${uid})"/>`;
  svg += `<circle cx="${CX}" cy="${CY}" r="26" fill="#130826" stroke="#C9A84C" stroke-width="2.5"/>`;
  svg += `<text x="${CX}" y="${CY + 9}" text-anchor="middle" dominant-baseline="middle" font-size="24">${DATA28.AVATARS[member?.avatar_index || 0]}</text>`;
  RINGS.forEach(ring => {
    const count = ring.days.length;
    ring.days.forEach((day, i) => {
      const angle = -Math.PI / 2 + (i / count) * 2 * Math.PI;
      const x = (CX + ring.r * Math.cos(angle)).toFixed(1);
      const y = (CY + ring.r * Math.sin(angle)).toFixed(1);
      const done = doneMap[day];
      const task = DATA28.getTask(day);
      const c = ring.color, big = ring.qId === -1;
      if (done) {
        const sr = big ? 15 : 11;
        svg += `<circle cx="${x}" cy="${y}" r="${sr + 6}" fill="${c}" opacity="0.18"/>`;
        svg += `<circle cx="${x}" cy="${y}" r="${sr}" fill="${c}" stroke="#fff" stroke-width="1.5" stroke-opacity="0.4" opacity="0.92"/>`;
        svg += `<text x="${x}" y="${(+y + 5).toFixed(1)}" text-anchor="middle" font-size="${big ? 13 : 9}">${task.icon}</text>`;
      } else {
        svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="${c}" opacity="0.18"/>`;
      }
    });
  });
  svg += `</svg>`;
  return svg;
}

/* 把星系 + 個人 28 天累計記錄打包成一份可下載的獨立 HTML 檔 */
function downloadBookshelf(member, doneMap, doneCount) {
  const name = member?.name || '我';
  const avatar = DATA28.AVATARS[member?.avatar_index || 0];
  const svg = galaxySVGString(doneMap, member);

  let recs = '';
  for (let d = 1; d <= 28; d++) {
    const row = doneMap[d];
    if (!row || !row.response) continue;
    const t = DATA28.getTask(d);
    const q = (t.quadrantId != null) ? DATA28.QUADRANTS[t.quadrantId] : null;
    const color = q ? q.color : '#C9A84C';
    recs += `<div class="rec" style="border-left-color:${color}">
      <div class="rec-h"><span class="rec-day">Day ${d}</span><span class="rec-title">${t.icon} ${App.esc(t.title)}</span></div>
      <p class="rec-body">${App.esc(row.response)}</p>
    </div>`;
  }
  if (!recs) recs = '<p style="text-align:center;opacity:.7">還沒有完成任何一天的故事，先去點亮你的第一顆星吧！</p>';

  const today = new Date().toLocaleDateString('zh-TW');
  const title = `${name} 的 28 天星系紀念冊`;
  const html = `<!DOCTYPE html>
<html lang="zh-Hant"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${App.esc(title)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#060312;color:#EDE7FF;font-family:"PingFang TC","Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;line-height:1.8;padding:24px 16px 60px}
  .wrap{max-width:640px;margin:0 auto}
  header{text-align:center;margin-bottom:24px}
  .ava{font-size:52px}
  h1{font-size:22px;margin:6px 0;color:#fff;font-weight:900;letter-spacing:1px}
  .sub{color:#C9A84C;font-size:14px;font-weight:700}
  .stat{margin-top:10px;font-size:13px;opacity:.85}
  .galaxy{display:flex;justify-content:center;margin:20px 0 30px}
  .sec-title{font-size:15px;font-weight:900;color:#C9A84C;letter-spacing:2px;text-align:center;margin:28px 0 16px;position:relative}
  .sec-title:before,.sec-title:after{content:"✦";margin:0 10px;opacity:.6}
  .rec{background:rgba(255,255,255,.04);border-left:4px solid #C9A84C;border-radius:10px;padding:14px 16px;margin-bottom:14px}
  .rec-h{display:flex;align-items:center;gap:10px;margin-bottom:8px}
  .rec-day{font-size:12px;font-weight:800;color:#0E0720;background:#C9A84C;border-radius:999px;padding:2px 10px}
  .rec-title{font-size:15px;font-weight:800;color:#fff}
  .rec-body{font-size:14px;color:#D8CFF0;white-space:pre-wrap;word-break:break-word}
  footer{text-align:center;margin-top:36px;font-size:12px;opacity:.55}
</style></head>
<body>
  <div class="wrap">
    <header>
      <div class="ava">${avatar}</div>
      <h1>${App.esc(name)} 的星系紀念冊</h1>
      <div class="sub">28 天品牌故事挑戰</div>
      <div class="stat">✨ 點亮了 ${doneCount} / 28 顆星</div>
    </header>
    <div class="galaxy">${svg}</div>
    <div class="sec-title">我的 28 天故事</div>
    ${recs}
    <footer>於 ${today} 生成 · 願你的品牌之光持續閃耀 🌟</footer>
  </div>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}_28天星系紀念冊.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  if (App.toast) App.toast('星系紀念冊已下載 📖✨');
}

function buildGalaxySVG(doneMap, member) {
  const wrap = $('#galaxySvgWrap');
  if (!wrap) return;

  const W = 380, H = 380, CX = 190, CY = 190;

  const RINGS = [
    { r: 46,  qId: -1, color: '#C9A84C', days: [1, 27, 28] },
    { r: 78,  qId: 0,  color: '#C0392B', days: [2,3,4,5,6] },
    { r: 106, qId: 1,  color: '#8E44AD', days: [7,8,9,10,11] },
    { r: 132, qId: 2,  color: '#27AE60', days: [12,13,14,15,16] },
    { r: 156, qId: 3,  color: '#2980B9', days: [17,18,19,20,21] },
    { r: 177, qId: 4,  color: '#E67E22', days: [22,23,24,25,26] },
  ];

  const uid = Math.floor(Math.random() * 1e9);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="galaxy-svg" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="sbg${uid}" cx="50%" cy="50%" r="55%">
        <stop offset="0%" stop-color="#1C0D38"/>
        <stop offset="55%" stop-color="#0E0720"/>
        <stop offset="100%" stop-color="#050210"/>
      </radialGradient>
      <radialGradient id="sunr${uid}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#C9A84C" stop-opacity="0.4"/>
        <stop offset="100%" stop-color="#C9A84C" stop-opacity="0"/>
      </radialGradient>
      <filter id="sg${uid}" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sbg${uid})" rx="14"/>`;

  // decorative micro stars
  for (let i = 0; i < 88; i++) {
    const x = (Math.random() * W).toFixed(1);
    const y = (Math.random() * H).toFixed(1);
    const r = (Math.random() * 1.3 + 0.2).toFixed(1);
    const o = (Math.random() * 0.45 + 0.05).toFixed(2);
    svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`;
  }

  // orbital rings
  RINGS.forEach(ring => {
    const d = (ring.r * 0.28).toFixed(1);
    const g = (ring.r * 0.07).toFixed(1);
    svg += `<circle cx="${CX}" cy="${CY}" r="${ring.r}" fill="none" stroke="${ring.color}" stroke-width="1.5" stroke-opacity="0.28" stroke-dasharray="${d} ${g}"/>`;
  });

  // center sun glow + avatar
  svg += `<circle cx="${CX}" cy="${CY}" r="42" fill="url(#sunr${uid})"/>`;
  svg += `<circle cx="${CX}" cy="${CY}" r="26" fill="#130826" stroke="#C9A84C" stroke-width="2.5"/>`;
  svg += `<text x="${CX}" y="${CY + 9}" text-anchor="middle" dominant-baseline="middle" font-size="24">${DATA28.AVATARS[member?.avatar_index || 0]}</text>`;

  // story stars
  const clickable = [];
  RINGS.forEach(ring => {
    const count = ring.days.length;
    ring.days.forEach((day, i) => {
      const angle = -Math.PI / 2 + (i / count) * 2 * Math.PI;
      const x = (CX + ring.r * Math.cos(angle)).toFixed(1);
      const y = (CY + ring.r * Math.sin(angle)).toFixed(1);
      const done = doneMap[day];
      const task = DATA28.getTask(day);
      const c    = ring.color;
      const big  = ring.qId === -1;

      if (done) {
        const sr = big ? 15 : 11;
        svg += `<circle cx="${x}" cy="${y}" r="${sr + 6}" fill="${c}" opacity="0.18"/>`;
        svg += `<circle cx="${x}" cy="${y}" r="${sr}" fill="${c}" stroke="#fff" stroke-width="1.5" stroke-opacity="0.4" opacity="0.92" class="gstar" data-day="${day}" style="cursor:pointer"><title>Day ${day} · ${task.title}</title></circle>`;
        svg += `<text x="${x}" y="${(+y + 5).toFixed(1)}" text-anchor="middle" font-size="${big ? 13 : 9}" style="pointer-events:none">${task.icon}</text>`;
        clickable.push({ day, task, response: done.response });
      } else {
        svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="${c}" opacity="0.18"><title>Day ${day} · ${task.title}（未完成）</title></circle>`;
      }
    });
  });

  svg += `</svg>`;
  wrap.innerHTML = svg;

  $$('.gstar', wrap).forEach(el => {
    const day = +el.getAttribute('data-day');
    const s   = clickable.find(c => c.day === day);
    if (!s) return;
    el.addEventListener('click', () => showStarModal(s.day, s.task, s.response, member));
  });
}

/* ════════════════════════════════════════
   3D 互動星系 (Three.js) — 行星持續公轉
════════════════════════════════════════ */
function buildGalaxy3D(doneMap, member) {
  const wrap = $('#galaxySvgWrap');
  if (!wrap) return;

  if (App._galaxy3D) { App._galaxy3D.cleanup(); App._galaxy3D = null; }

  if (!window.THREE || !window.THREE.OrbitControls) {
    buildGalaxySVG(doneMap, member);
    return;
  }

  const THREE = window.THREE;
  const W = wrap.clientWidth || 360;
  const H = Math.round(Math.min(W, 420));

  wrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.className = 'galaxy-3d-canvas';
  wrap.appendChild(canvas);

  const hint = document.createElement('div');
  hint.className = 'galaxy-3d-hint';
  hint.textContent = '✋ 拖曳旋轉 · 捏合/滾輪縮放 · 點擊星星查看故事';
  wrap.appendChild(hint);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x050210, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 100);
  camera.position.set(0, 3.5, 7.5);

  const controls = new THREE.OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.5;
  controls.maxDistance = 16;
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  // Background star field
  {
    const pos = [];
    for (let i = 0; i < 600; i++) {
      const r = 14 + Math.random() * 8;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pos.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09 })));
  }

  const RINGS = [
    { r: 1.25, qId: -1, hex: 0xC9A84C, speed: 0.012, days: [1, 27, 28] },
    { r: 2.05, qId: 0,  hex: 0xC0392B, speed: 0.009, days: [2,3,4,5,6] },
    { r: 2.78, qId: 1,  hex: 0x8E44AD, speed: 0.007, days: [7,8,9,10,11] },
    { r: 3.48, qId: 2,  hex: 0x27AE60, speed: 0.0055, days: [12,13,14,15,16] },
    { r: 4.10, qId: 3,  hex: 0x2980B9, speed: 0.0042, days: [17,18,19,20,21] },
    { r: 4.65, qId: 4,  hex: 0xE67E22, speed: 0.0032, days: [22,23,24,25,26] },
  ];

  // Static orbital guide lines
  RINGS.forEach(ring => {
    const pts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * ring.r, 0, Math.sin(a) * ring.r));
    }
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: ring.hex, transparent: true, opacity: 0.32 })
    ));
  });

  // Center: glow halo + dark core + gold equatorial ring
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.75, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xC9A84C, transparent: true, opacity: 0.12, depthWrite: false })
  ));
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.40, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0x1C0A40 })
  ));
  scene.add(new THREE.Mesh(
    new THREE.TorusGeometry(0.50, 0.028, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xC9A84C })
  ));

  function makeEmojiSprite(text, sizePx) {
    const c = document.createElement('canvas');
    c.width = sizePx; c.height = sizePx;
    const ctx = c.getContext('2d');
    ctx.font = `${Math.round(sizePx * 0.65)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, sizePx / 2, sizePx * 0.57);
    const tex = new THREE.CanvasTexture(c);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp._tex = tex;
    return sp;
  }

  const avSprite = makeEmojiSprite(DATA28.AVATARS[member?.avatar_index || 0], 128);
  avSprite.scale.set(0.82, 0.82, 0.82);
  scene.add(avSprite);

  const orbitGroups = [];
  const clickableStars = [];
  const raycaster = new THREE.Raycaster();
  const createdTextures = [avSprite._tex];

  RINGS.forEach(ring => {
    const group = new THREE.Group();
    scene.add(group);
    orbitGroups.push({ group, speed: ring.speed });

    const count = ring.days.length;
    ring.days.forEach((day, i) => {
      const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
      const x = Math.cos(angle) * ring.r;
      const z = Math.sin(angle) * ring.r;
      const done = doneMap[day];
      const task = DATA28.getTask(day);

      if (done) {
        const sr = ring.qId === -1 ? 0.23 : 0.17;

        const glowMesh = new THREE.Mesh(
          new THREE.SphereGeometry(sr + 0.15, 12, 12),
          new THREE.MeshBasicMaterial({ color: ring.hex, transparent: true, opacity: 0.22, depthWrite: false })
        );
        glowMesh.position.set(x, 0, z);
        group.add(glowMesh);

        const starMesh = new THREE.Mesh(
          new THREE.SphereGeometry(sr, 16, 16),
          new THREE.MeshBasicMaterial({ color: ring.hex })
        );
        starMesh.position.set(x, 0, z);
        starMesh.userData = { day, task, response: done.response };
        group.add(starMesh);
        clickableStars.push(starMesh);

        const iconSp = makeEmojiSprite(task.icon, 64);
        iconSp.scale.set(sr * 2.5, sr * 2.5, sr * 2.5);
        iconSp.position.set(x, 0, z);
        group.add(iconSp);
        createdTextures.push(iconSp._tex);
      } else {
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(0.065, 8, 8),
          new THREE.MeshBasicMaterial({ color: ring.hex, transparent: true, opacity: 0.22 })
        );
        dot.position.set(x, 0, z);
        group.add(dot);
      }
    });
  });

  let pointerDownXY = null;
  canvas.addEventListener('pointerdown', e => { pointerDownXY = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', e => {
    if (!pointerDownXY) return;
    const dx = e.clientX - pointerDownXY.x, dy = e.clientY - pointerDownXY.y;
    pointerDownXY = null;
    if (dx * dx + dy * dy > 64) return;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      ),
      camera
    );
    const hits = raycaster.intersectObjects(clickableStars);
    if (hits.length) {
      const { day, task, response } = hits[0].object.userData;
      showStarModal(day, task, response, member);
    }
  });

  let animId;
  let tick = 0;
  function animate() {
    animId = requestAnimationFrame(animate);
    tick += 0.022;
    orbitGroups.forEach(({ group, speed }) => {
      group.rotation.y += speed;
    });
    clickableStars.forEach((s, idx) => {
      s.scale.setScalar(1 + 0.08 * Math.sin(tick + idx * 0.9));
    });
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function onResize() {
    const nW = wrap.clientWidth || 360;
    renderer.setSize(nW, H);
    camera.aspect = nW / H;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', onResize);

  App._galaxy3D = {
    cleanup() {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      createdTextures.forEach(t => t && t.dispose());
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      renderer.dispose();
    }
  };
}

async function showStarModal(day, task, response, member) {
  const q       = task.quadrantId !== null ? DATA28.QUADRANTS[task.quadrantId] : null;
  const color   = q ? q.color : '#C9A84C';
  const av      = DATA28.AVATARS[member?.avatar_index || 0];
  const memberId   = member?.id;
  const memberName = member?.name || '?';

  const praises  = await App.db.praisesForTask(memberId, day);
  const myPraise = praises.find(p => p.from_id === App.me.id);
  const praiseEmojis = ['👏','🔥','💎','✨','🌟','💪','🙏','❤️'];

  App.openModal(`
    <div class="book-modal" style="padding:0;max-height:none">
      <div class="book-modal-header" style="background:${color}">
        <div class="book-modal-avatar">${av}</div>
        <div class="book-modal-name">${App.esc(memberName)}</div>
        <div class="book-modal-meta">Day ${day} · ${task.icon} ${App.esc(task.title)}</div>
      </div>
      <div class="book-modal-body">
        <div class="book-modal-task-name">${task.icon} ${App.esc(task.title)}</div>
        <div class="book-modal-text">${App.esc(response || '')}</div>
      </div>
      <div class="praise-section">
        <div class="praise-count">收到 ${praises.length} 個鼓勵 ${praises.map(p => p.emoji).join('')}</div>
        ${memberId !== App.me.id ? `
          <div style="font-size:13px;font-weight:700;color:var(--ink-mid);margin-bottom:4px">給予鼓勵：</div>
          <div class="praise-btn-row">
            ${praiseEmojis.map(e => `<button class="praise-btn ${myPraise?.emoji === e ? 'sent' : ''}" data-emoji="${e}">${e}</button>`).join('')}
          </div>` : '<div style="font-size:13px;color:var(--ink-light)">這是你自己的故事 ❤️</div>'}
        <button class="btn btn-outline btn-block btn-sm" onclick="App.closeModal()">關閉</button>
      </div>
    </div>
  `);

  $$('.praise-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const emoji = btn.dataset.emoji;
      try {
        await App.db.givePraise(memberId, memberName, day, emoji);
        $$('.praise-btn').forEach(b => { b.classList.remove('sent'); b.disabled = true; });
        btn.classList.add('sent');
        App.toast(`已送出 ${emoji} 鼓勵給 ${memberName}！`);
      } catch(e) {
        App.toast('鼓勵發送失敗');
      }
    });
  });
}

/* ════════════════════════════════════════
   積分頁 (Team Page)
════════════════════════════════════════ */
async function renderTeamPage() {
  const pg = $('#page-team');
  pg.innerHTML = '<div class="empty-tip"><span class="spinning">⏳</span> 計算積分中…</div>';

  const [scores, allMem, todayDone] = await Promise.all([
    App.db.allMembersScores(),
    App.db.allMembers(),
    App.db.todayDoneMembers(App.todayDay),
  ]);

  const totalDays = allMem.length > 0
    ? scores.reduce((s,r) => s+r.days, 0)
    : 0;

  const doneToday = todayDone.filter(t => t.response).length;
  const total     = allMem.length;
  const allDone   = doneToday >= total && total > 0;

  // Team score = days where all completed (simplified: use today's status)
  // Accumulated team score = sum of completed days across all members
  const teamScore = totalDays;

  pg.innerHTML = `
    <div class="team-score-big">
      <div class="team-score-label">團隊累計能量點</div>
      <div class="team-score-number">${teamScore}</div>
      <div class="team-score-sub">全員完成任務即得當日積分 🏆</div>
    </div>

    <div class="today-status">
      <div class="status-title">今日進度 · Day ${App.todayDay}</div>
      <div class="status-fraction">
        <span class="status-done">${doneToday}</span>
        <span class="status-total">/ ${total} 位完成</span>
      </div>
      <span class="status-msg ${allDone?'all-done':'pending'}">
        ${allDone ? '🎉 全員完成！今日積分已解鎖！' : `還差 ${total - doneToday} 位，一起加油！`}
      </span>
    </div>

    <div class="card">
      <div class="card-title">🏆 個人記錄排行</div>
      <div class="leaderboard">
        ${scores.map((s,i) => {
          const memberInfo = allMem.find(m => m.id === s.id);
          const av  = memberInfo ? DATA28.AVATARS[memberInfo.avatar_index || 0] : '📖';
          const rankCls = i===0?'top1':i===1?'top2':i===2?'top3':'';
          const isMe = s.id === App.me.id;
          return `<div class="lb-row" style="${isMe?'border-color:var(--gold);box-shadow:3px 3px 0 var(--gold-deep)':''}">
            <div class="lb-rank ${rankCls}">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</div>
            <div class="lb-avatar">${av}</div>
            <div class="lb-name">${App.esc(s.name)}${isMe?' <span style="font-size:11px;color:var(--gold)">(你)</span>':''}</div>
            <div>
              <div class="lb-score">${s.days}</div>
              <div class="lb-days">天</div>
            </div>
          </div>`;
        }).join('')}
        ${scores.length === 0 ? '<div class="empty-tip">還沒有記錄，成為第一個完成任務的人吧！</div>' : ''}
      </div>
    </div>
  `;
}

/* ════════════════════════════════════════
   Profile Modal
════════════════════════════════════════ */
function showProfileModal() {
  if (!App.bazi) return App.toast('能量檔案載入中…');
  const { profile, masterType, formatted } = App.bazi;
  const av  = DATA28.AVATARS[App.me.avatar_index || 0];
  const colors = DATA28.QUADRANTS.map(q => q.color);

  const barsHtml = DATA28.QUADRANTS.map((q,i) => {
    const pct = profile.percents[i];
    const lbl = DATA28.energyLabel(pct);
    return `<div class="qbar-row">
      <span class="qbar-icon">${q.icon}</span>
      <div class="qbar-info">
        <div class="qbar-name">${q.name} <span class="qbar-tag ${lbl.cls}">${lbl.text}</span></div>
        <div class="qbar-track">
          <div class="qbar-fill" style="width:${Math.min(pct,50)/50*100}%;--bar-color:${q.color}"></div>
        </div>
      </div>
      <div class="qbar-pct">${pct >= 50 ? 'MAX' : pct + '%'}</div>
    </div>`;
  }).join('');

  $('#profileModalCard').innerHTML = `
    <div style="position:relative">
      <button class="modal-close" onclick="$('#profileModal').classList.add('hidden')">✕</button>
      <div class="pm-header">
        <div class="pm-avatar">${av}</div>
        <div class="pm-name">${App.esc(App.me.name)}</div>
        <div class="pm-type" style="color:${masterType.color}">${masterType.icon} ${masterType.name} · ${masterType.elem}日主</div>
      </div>
      <p style="font-size:13px;color:var(--ink-mid);line-height:1.6;background:var(--cream);border-radius:var(--radius-sm);padding:10px 12px;border-left:4px solid var(--gold);margin:0 0 14px">${App.esc(masterType.desc)}</p>
      <div class="pillars-row" style="margin-bottom:16px">
        ${['年柱','月柱','日柱','時柱'].map((l,i) => {
          const v = [formatted?.year,formatted?.month,formatted?.day,formatted?.hour][i] || '?';
          return `<div class="pillar-box" style="box-shadow:3px 3px 0 ${masterType.color}">${App.esc(v)}<small>${l}</small></div>`;
        }).join('')}
      </div>
      <div class="reveal-section-title">五大能量圖譜</div>
      <div class="radar-wrap">${BAZI.buildRadarSVG(profile.percents, colors)}</div>
      <div class="quadrant-bars">${barsHtml}</div>
    </div>
  `;
  $('#profileModal').classList.remove('hidden');
}

/* ════════════════════════════════════════
   Confetti Animation
════════════════════════════════════════ */
function launchConfetti() {
  const canvas = $('#confettiCanvas');
  const ctx    = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#C9A84C','#E8C96A','#C0392B','#27AE60','#8E44AD','#2980B9','#FFF8EE'];
  const particles = Array.from({length:90}, () => ({
    x: Math.random() * canvas.width,
    y: -20,
    vx: (Math.random()-0.5) * 4,
    vy: Math.random() * 3 + 2,
    r: Math.random() * 8 + 4,
    color: colors[Math.floor(Math.random()*colors.length)],
    spin: (Math.random()-0.5) * 0.3,
    angle: Math.random() * Math.PI * 2,
    shape: Math.random() > 0.5 ? 'rect' : 'star',
  }));

  let frame = 0;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x  += p.vx; p.y += p.vy; p.vy += 0.06; p.angle += p.spin;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.fillRect(-p.r/2, -p.r/4, p.r, p.r/2);
      } else {
        ctx.beginPath();
        for (let j=0;j<5;j++) {
          const a = (j*4*Math.PI/5)-Math.PI/2;
          const ai= ((j*4+2)*Math.PI/5)-Math.PI/2;
          if (j===0) ctx.moveTo(Math.cos(a)*p.r, Math.sin(a)*p.r);
          else ctx.lineTo(Math.cos(a)*p.r, Math.sin(a)*p.r);
          ctx.lineTo(Math.cos(ai)*p.r*.45, Math.sin(ai)*p.r*.45);
        }
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    });
    frame++;
    if (frame < 100) requestAnimationFrame(draw);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  draw();
}

/* ════════════════════════════════════════
   Boot
════════════════════════════════════════ */
async function boot() {
  paintMotifs();
  initDB();
  await App.db.loadConfig();

  // Wire up login steps
  $('#checkNameBtn').onclick = handleCheckName;
  $('#loginName').onkeydown = (e) => { if(e.key==='Enter') handleCheckName(); };
  $('#pinLoginBtn').onclick  = handlePinLogin;
  $('#loginPin').onkeydown   = (e) => { if(e.key==='Enter') handlePinLogin(); };
  $('#registerBtn').onclick  = handleRegister;
  $('#backToName').onclick   = () => { $('#stepPin').classList.add('hidden'); $('#stepName').classList.remove('hidden'); };
  $('#backToName2').onclick  = () => { $('#stepRegister').classList.add('hidden'); $('#stepName').classList.remove('hidden'); };

  // Nav
  $$('.tab').forEach(t => t.onclick = () => showPage(t.dataset.page));
  $('#logoutBtn').onclick = logout;
  $('#topAvatar').onclick = showProfileModal;
  $('#profileModal').onclick = (e) => { if(e.target.id==='profileModal') $('#profileModal').classList.add('hidden'); };
  $('#modalOverlay').onclick = (e) => { if(e.target.id==='modalOverlay') App.closeModal(); };

  // Auto login
  const saved = JSON.parse(localStorage.getItem('bazi28_me') || 'null');
  if (saved) {
    try {
      const m = await App.db.findMember(saved.name);
      if (m && m.pin === saved.pin) {
        App.me = m;
        restoreBazi();
        enterApp();
        return;
      }
    } catch(_) {}
  }
  // Show login
  $('#loginOverlay').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', boot);
