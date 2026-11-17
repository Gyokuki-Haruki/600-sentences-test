const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
const cfg = window.APP_CONFIG || {};
const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
const client = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
let sentences = [], user = null, autoQuestionCount = true, selectedSection = 1, orderMode = 'random', answerMode = 'write', queue = [], qIndex = 0, numCorrect = 0, selectedTokens = [], tokenPool = [], resultSaved = false, testId = null, pendingAnswer = null, correctionMode = false;

function view(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `${name}View`));
  $$('.app-nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo({top:0, behavior:'smooth'});
}
$$('.app-nav button').forEach(b => b.onclick = () => view(b.dataset.view));
$$('[data-go]').forEach(b => b.onclick = () => view(b.dataset.go));
function authEmail(id) { return `${id.toLowerCase()}@${new URL(cfg.SUPABASE_URL).hostname}`; }
function showApp(authUser, displayName='学習者') {
  user = authUser;
  $('#appShell').classList.remove('hidden');
  $('#usernameLabel').textContent = displayName;

  // 管理者だけ管理画面へのリンクを表示
  const adminLink = $('#adminUsersLink');
  if (adminLink) {
    adminLink.classList.toggle(
      'hidden',
      authUser.app_metadata?.role !== 'admin'
    );
  }

  view('home');
  updateStats();
}
$('#logoutButton').onclick = async () => { if(client) await client.auth.signOut(); user=null; location.replace('login.html'); };
async function init() {
  fillSelect($('#startSection'),40,'Section'); fillSelect($('#endSection'),40,'Section'); fillSelect($('#startNumber'),15,'番号'); fillSelect($('#endNumber'),15,'番号'); $('#endNumber').value='6';
  try { const r=await fetch('data/sentences.json'); if(!r.ok) throw new Error(); const data=await r.json(); sentences=data.sentences||[]; }
  catch { sentences=[]; $('#rangeSummary').textContent='JSONを読み込めません。Webサーバーから開いてください。'; }
  renderLibrary(); $('#questionLimit').value=rangeSentences().length; updatePreview();
  if(!client) { location.replace('login.html?error=config'); return; }
  const {data:{session}}=await client.auth.getSession();
  if(!session) { location.replace('login.html'); return; }
  if(session.user.app_metadata?.must_change_password) { location.replace('mypage.html?firstLogin=1'); return; }
  const {data:profile}=await client.from('user_profiles').select('display_name').eq('user_id',session.user.id).maybeSingle();
  showApp(session.user,profile?.display_name||session.user.email.split('@')[0]);
}
function fillSelect(el,max,label) { el.innerHTML=Array.from({length:max},(_,i)=>`<option value="${i+1}">${label} ${i+1}</option>`).join(''); }
function position(section,number) { return (section-1)*15+(number-1); }
function rangeSentences() { const a=position(+$('#startSection').value,+$('#startNumber').value),b=position(+$('#endSection').value,+$('#endNumber').value); return sentences.filter(q=>{const n=position(q.section,q.number);return n>=a&&n<=b;}); }
function configuredCount(count) { const raw=Number.parseInt($('#questionLimit').value,10); return Math.min(count,Number.isFinite(raw)?Math.max(0,raw):0); }
function updatePreview() {
  const start=`Section ${$('#startSection').value}・${$('#startNumber').value}番`,end=`Section ${$('#endSection').value}・${$('#endNumber').value}番`,available=rangeSentences().length,count=configuredCount(available);
  $('#questionCount').innerHTML=`${count} <small>問</small>`; $('#previewProgress').style.width=`${Math.min(100,count/Math.max(1,available)*100)}%`; $('#previewDescription').textContent=`${start} 〜 ${end}${available>count?`（範囲内 ${available} 問から出題）`:''}`;
  $('#selectedOrder').textContent=orderMode==='random'?'ランダム':'間違え率優先'; $('#selectedAnswer').textContent={write:'例文をすべて書く',sort:'並び替え',blank:'重要なところだけ穴埋め'}[answerMode];
  $('#rangeSummary').textContent=`範囲内の問題：${available}問。${available>count?`今回の出題数：${count}問。`:'範囲内の問題をすべて出題します。'}`;
}
$$('#orderChoices .option').forEach(b=>b.onclick=()=>{orderMode=b.dataset.value;$$('#orderChoices .option').forEach(x=>x.classList.toggle('active',x===b));updatePreview();});
$$('#answerChoices .option').forEach(b=>b.onclick=()=>{answerMode=b.dataset.value;$$('#answerChoices .option').forEach(x=>x.classList.toggle('active',x===b));updatePreview();});
['startSection','startNumber','endSection','endNumber'].forEach(id=>$('#'+id).onchange=()=>{if(autoQuestionCount)$('#questionLimit').value=rangeSentences().length;updatePreview();});
$('#questionLimit').onchange=()=>{autoQuestionCount=false;const raw=Number.parseInt($('#questionLimit').value,10);$('#questionLimit').value=Number.isFinite(raw)?Math.max(0,raw):0;updatePreview();};
$('#allQuestions').onclick=()=>{autoQuestionCount=true;$('#questionLimit').value=rangeSentences().length;updatePreview();};
async function oldWrongRates() {
  const {data,error}=await client.from('sentence_test_answers').select('sentence_id,is_correct').order('created_at',{ascending:false}).limit(1000),rows=error?[]:data||[],wrong=new Map(),total=new Map();
  rows.forEach(row=>{total.set(row.sentence_id,(total.get(row.sentence_id)||0)+1);if(!row.is_correct)wrong.set(row.sentence_id,(wrong.get(row.sentence_id)||0)+1);});
  return new Map([...total].map(([id,n])=>[id,(wrong.get(id)||0)/n]));
}
$('#beginTest').onclick=async()=>{
  const a=position(+$('#startSection').value,+$('#startNumber').value),b=position(+$('#endSection').value,+$('#endNumber').value); if(a>b){toast('開始位置は終了位置より前にしてください');return;}
  let candidates=rangeSentences(); if(!candidates.length){toast('この範囲に問題がありません');return;}
  if(orderMode==='random') candidates=candidates.sort(()=>Math.random()-.5); else {const rates=await oldWrongRates(); candidates.sort((x,y)=>(rates.get(y.id)??-0.01)-(rates.get(x.id)??-0.01));}
  const requested=Number.parseInt($('#questionLimit').value,10);$('#questionLimit').value=Number.isFinite(requested)?Math.max(0,requested):0;queue=candidates.slice(0,configuredCount(candidates.length)); qIndex=0; numCorrect=0; answerOutcomes=[]; testId=crypto.randomUUID(); renderQuestion(); view('quiz');
};
function norm(v) { return v.toLowerCase().replace(/[.,!?']/g,'').replace(/\s+/g,' ').trim(); }
function shuffle(items) { for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items; }
function properNameSet() {
  const names=new Set();
  sentences.forEach(sentence=>sentence.en.replace(/[?.!,]/g,'').split(/\s+/).forEach((word,index)=>{if(index>0&&/^[A-Z][a-z]/.test(word))names.add(word.toLowerCase());}));
  return names;
}
function sortDisplayWord(word,index,names) {
  if(/^I(?:['’].*)?$/.test(word)||/[A-Z].*[A-Z]|[a-z][A-Z]/.test(word)||names.has(word.toLowerCase()))return word;
  return word.toLowerCase();
}
function renderQuestion() {
  const q=queue[qIndex]; selectedTokens=[]; pendingAnswer=null; correctionMode=false;
  let html=`<div class="quiz-top"><span>${orderMode==='weak'?'間違え率優先':'ランダム'} · ${{write:'全入力',sort:'並び替え',blank:'穴埋め'}[answerMode]}</span><span>${qIndex+1} / ${queue.length}</span></div><div class="progress"><i style="width:${qIndex/queue.length*100}%"></i></div><div class="card question-card"><div class="question-head"><span class="pill">SECTION ${q.section} · ${q.number}番</span><span class="muted">日本語から英語へ</span></div><div class="question-jp">${escapeText(q.ja)}</div>`;
  if(answerMode==='write') html+=`<div class="prompt">英文を入力してください</div><textarea class="answer large" id="answerInput" placeholder="ここに英文を入力"></textarea>`;
  if(answerMode==='blank') {
    let cursor=0,answerLine='';
    for(const match of q.blank.matchAll(/\[([^\]]+)\]/g)) { answerLine+=escapeText(q.blank.slice(cursor,match.index)); const index=match.index; answerLine+=`<input class="answer small gap-input" data-gap="${index}" aria-label="空欄" placeholder="語句">`; cursor=match.index+match[0].length; }
    answerLine+=escapeText(q.blank.slice(cursor)); html+=`<div class="prompt">重要語句の空欄をすべて入力してください</div><div class="answer-line">${answerLine}</div>`;
  }
  if(answerMode==='sort') { const names=properNameSet();tokenPool=shuffle(q.en.replace(/[?.!,]/g,'').split(/\s+/).map((word,index)=>({word:sortDisplayWord(word,index,names),index})));html+=`<div class="prompt">カードをタップして正しい順に並べてください</div><div class="answer-slots" id="answerSlots"></div><div id="wordChips" class="word-chips">${tokenPool.map((t,i)=>`<button class="chip" data-token="${i}">${escapeText(t.word)}</button>`).join('')}</div>`; }
  html+=`<div id="feedback"></div><div class="quiz-actions"><button class="btn secondary" id="backSettings">中断して設定へ</button><button class="btn primary" id="checkAnswer">答えを確認　→</button></div></div>`; $('#quizRoot').innerHTML=html;
  if(answerMode==='sort') $$('#wordChips .chip').forEach(b=>b.onclick=()=>{if(resultSaved)return;selectedTokens.push(+b.dataset.token);b.disabled=true;drawSlots();});
  $('#backSettings').onclick=()=>view('settings'); $('#checkAnswer').onclick=checkAnswer; resultSaved=false;
}
function drawSlots() { $('#answerSlots').innerHTML=selectedTokens.map(i=>`<button class="slot" data-remove="${i}">${escapeText(tokenPool[i].word)}　×</button>`).join(''); $$('#answerSlots [data-remove]').forEach(b=>b.onclick=()=>{selectedTokens=selectedTokens.filter(i=>i!==+b.dataset.remove);$$('#wordChips .chip').forEach(c=>{if(+c.dataset.token===+b.dataset.remove)c.disabled=false;});drawSlots();}); }
async function checkAnswer() {
  if(correctionMode) { verifyCorrections(); return; }
  if(resultSaved) { if(qIndex<queue.length-1){qIndex++;renderQuestion();}else finishTest(); return; }
  const q=queue[qIndex],button=$('#checkAnswer');
  if(!pendingAnswer) {
    let isCorrect;
    if(answerMode==='blank') { const answers=[...q.blank.matchAll(/\[([^\]]+)\]/g)].map(match=>match[1]),given=[...$$('.gap-input')].map(input=>input.value); isCorrect=answers.length>1&&given.length===answers.length&&given.every((value,index)=>norm(value)===norm(answers[index])); }
    else { const given=answerMode==='sort'?selectedTokens.map(i=>tokenPool[i].word).join(' '):$('#answerInput').value; isCorrect=norm(given)===norm(q.en); }
    pendingAnswer={sentence_id:q.id,section:q.section,item_number:q.number,order_mode:orderMode,answer_mode:answerMode,is_correct:isCorrect};
  }
  button.disabled=true; button.textContent='保存中…'; const row={test_id:testId,...pendingAnswer};
  const {error}=await client.from('sentence_test_answers').insert(row);
  if(error) { button.disabled=false;button.textContent='結果を再送信';$('#feedback').innerHTML=`<div class="feedback bad"><b>この問題の結果を保存できませんでした。</b>${escapeText(error.message)}<br>再送信を押してください。</div>`;return; }
  const {is_correct:ok}=pendingAnswer;if(ok)numCorrect++;answerOutcomes.push({sentence_id:q.id,correct:ok});resultSaved=true;pendingAnswer=null;
  $$('#answerInput, .gap-input').forEach(input=>input.disabled=true);
  if(ok) { $('#feedback').innerHTML=`<div class="feedback good"><b>正解！いい調子です。</b></div>`; button.disabled=false;button.textContent=qIndex===queue.length-1?'結果を見る　→':'次の問題へ　→'; }
  else startCorrections(q);
}
function startCorrections(q) {
  correctionMode=true;
  $('#feedback').innerHTML=`<div class="feedback bad"><b>不正解です。正しい英文を確認してください。</b><p class="correct-answer">${escapeText(q.en)}</p><div class="correction-instruction">この英文を3回書いて覚えましょう。</div><div class="correction-list">${[1,2,3].map(i=>`<label>書き直し ${i}<textarea class="answer correction-input" rows="2" aria-label="書き直し ${i}" placeholder="${i}回目"></textarea></label>`).join('')}</div><p id="correctionMessage" class="correction-message"></p></div>`;
  $('#checkAnswer').disabled=false;$('#checkAnswer').textContent='3回分を確認';
}
function verifyCorrections() {
  const q=queue[qIndex],inputs=[...$$('.correction-input')],allCorrect=inputs.length===3&&inputs.every(input=>norm(input.value)===norm(q.en)),message=$('#correctionMessage');
  if(!allCorrect){message.textContent='3つすべてに正しい英文を入力してください。';message.classList.add('error');return;}
  correctionMode=false;inputs.forEach(input=>input.disabled=true);message.textContent='3回とも正しく書けました。';message.classList.remove('error');
  $('#feedback').querySelector('.feedback').insertAdjacentHTML('beforeend',`<p class="correct-answer">正解：${escapeText(q.en)}</p>`);
  const button=$('#checkAnswer');button.textContent=qIndex===queue.length-1?'結果を見る　→':'次の問題へ　→';
}
async function finishTest() {
  const total=queue.length,pct=Math.round(numCorrect/total*100);$('#quizRoot').innerHTML=`<div class="card result"><div class="emoji">${pct>=70?'🌟':'🌱'}</div><h2>おつかれさま！</h2><p>一文ずつ、着実に進めました。<br>続けることが英語力につながります。</p><div class="result-stat">${numCorrect} / ${total}<small>正解数</small></div><div class="result-stat">${pct}%<small>正答率</small></div><p class="save-note">回答ごとの結果を保存しました。</p><button class="btn primary" id="againButton">設定に戻る</button> <button class="btn secondary" id="homeButton">ホームへ</button></div>`;
  $('#againButton').onclick=()=>view('settings');$('#homeButton').onclick=()=>view('home');await updateStats();
}
let answerOutcomes=[];
function escapeText(value) { const d=document.createElement('div');d.textContent=value;return d.innerHTML; }
function renderLibrary() {
  const filters=$('#librarySections'),list=$('#libraryList');
  if(!sentences.length){list.textContent='問題を読み込めません。Webサーバーから開いてください。';return;}
  filters.innerHTML=Array.from({length:40},(_,i)=>`<button class="section-chip ${selectedSection===i+1?'active':''}" data-section="${i+1}">Section ${i+1}</button>`).join('');
  filters.querySelectorAll('button').forEach(button=>button.onclick=()=>{selectedSection=+button.dataset.section;renderLibrary();});
  const rows=sentences.filter(q=>q.section===selectedSection);
  list.innerHTML=`<h2 class="library-section-title">Section ${selectedSection}</h2>`+rows.map(q=>`<div class="library-row"><div><b>${q.section}-${String(q.number).padStart(2,'0')}</b>　${escapeText(q.ja)}<small>${escapeText(q.en)}</small></div></div>`).join('');
}
function toast(text) { const t=$('#toast');t.textContent=text;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2100); }
function dateKey(date){const d=new Date(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function renderLearningChart(rows){
  const days=+($('#chartDays')?.value||14),today=new Date(),values=[];
  for(let i=days-1;i>=0;i--){const date=new Date(today.getFullYear(),today.getMonth(),today.getDate()-i);values.push({date,key:dateKey(date),count:0});}
  const byDay=new Map(values.map(v=>[v.key,v]));rows.forEach(row=>{if(row.is_correct&&byDay.has(dateKey(row.created_at)))byDay.get(dateKey(row.created_at)).count++;});
  const w=960,h=180,left=42,right=12,top=12,bottom=34,chartH=h-top-bottom,max=Math.max(1,...values.map(v=>v.count)),ticks=4;
  const x=i=>left+(i/(Math.max(1,days-1)))*(w-left-right),y=n=>top+chartH-(n/max)*chartH;
  const grid=Array.from({length:ticks+1},(_,i)=>{const n=Math.round(max*i/ticks),yy=y(n);return `<line x1="${left}" y1="${yy}" x2="${w-right}" y2="${yy}"/><text x="${left-9}" y="${yy+4}" text-anchor="end">${n}</text>`;}).join('');
  const points=values.map((v,i)=>`${x(i)},${y(v.count)}`).join(' '),labels=values.map((v,i)=>i%Math.max(1,Math.ceil(days/7))===0||i===days-1?`<text x="${x(i)}" y="${h-13}" text-anchor="middle">${v.date.getMonth()+1}/${v.date.getDate()}</text>`:'').join('');
  $('#learningChart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="過去${days}日間の日ごとの正解数"><g class="chart-grid">${grid}</g><polyline class="chart-line" points="${points}"/>${values.map((v,i)=>`<circle class="chart-dot" cx="${x(i)}" cy="${y(v.count)}" r="4"><title>${v.key}: 正解 ${v.count} 問</title></circle>`).join('')}<g class="chart-labels">${labels}</g></svg>`;
}
$('#chartDays').onchange=()=>updateStats();
async function updateStats() { let rows=[];if(client&&user){const {data,error}=await client.from('sentence_test_answers').select('test_id,sentence_id,is_correct,created_at').order('created_at',{ascending:false}).limit(5000);if(!error)rows=data||[];}const tests=new Set(rows.map(r=>r.test_id)),right=rows.filter(r=>r.is_correct).length,unique=new Set(rows.map(r=>r.sentence_id));$('#statTests').innerHTML=`${tests.size} <small>回</small>`;$('#statSentences').innerHTML=`${unique.size} <small>/ 600 文</small>`;$('#statAccuracy').innerHTML=`${rows.length?Math.round(right/rows.length*100):'—'} <small>%</small>`;renderLearningChart(rows); }
init();
