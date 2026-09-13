/* PianoTrack native module. Standalone beta; all storage and assets are isolated. */
window.PianoModule=(() => {
  const STORAGE_KEY='piano-practice-timer-beta', ACTIVE_KEY='piano-practice-active-beta', RECORD_MODE_KEY='piano-practice-record-mode-beta', PREVIOUS_KEY='piano-practice-previous-beta', GOAL_KEY='piano-practice-goal-beta';
  const APP_VERSION='2.1-beta.1', SCHEMA_VERSION=1;
  const root=document.getElementById('pianoRoot');const $=id=>root.querySelector(`#${id}`);
  const timerEl=$('timer'),startedAtEl=$('startedAt'),mainButton=$('mainButton'),finishDialog=$('finishDialog'),sessionResult=$('sessionResult'),saveSession=$('saveSession'),recordList=$('pianoRecordList'),toast=$('pianoToast');
  const calendarMode=$('calendarMode'),listMode=$('listMode'),calendarModeButton=$('calendarModeButton'),listModeButton=$('listModeButton'),calendarGrid=$('calendarGrid'),calendarDetail=$('calendarDetail'),monthLabel=$('monthLabel'),prevMonth=$('prevMonth'),nextMonth=$('nextMonth');
  const detailDialog=$('detailDialog'),detailStart=$('detailStart'),detailEnd=$('detailEnd'),detailDuration=$('detailDuration'),detailNote=$('detailNote'),editStartFromDetail=$('editStartFromDetail'),editEndFromDetail=$('editEndFromDetail'),editNoteFromDetail=$('editNoteFromDetail'),deleteFromDetail=$('deleteFromDetail');
  const editDialog=$('editDialog'),editTitle=$('editTitle'),editStart=$('editStart'),editEnd=$('editEnd'),editNote=$('editNote'),editDuration=$('editDuration'),editError=$('editError'),saveEdit=$('saveEdit'),deleteFromEdit=$('deleteFromEdit');
  const deleteDialog=$('deleteDialog'),deleteDescription=$('deleteDescription'),confirmDelete=$('confirmDelete');
  const todayTotal=$('todayTotal'),weekTotal=$('weekTotal'),lastWeekTotal=$('lastWeekTotal'),monthTotal=$('monthTotal'),lastMonthTotal=$('lastMonthTotal'),allTotal=$('allTotal'),dailyAverage=$('dailyAverage'),goalProgress=$('goalProgress');
  const goalType=$('goalType'),goalHours=$('goalHours'),goalMinutes=$('goalMinutes'),saveGoal=$('saveGoal');
  const exportBackup=$('exportBackup'),importBackup=$('importBackup'),restorePrevious=$('restorePrevious'),backupFile=$('backupFile'),dataCount=$('dataCount'),dataFirst=$('dataFirst'),dataLast=$('dataLast'),dataSize=$('dataSize'),resetData=$('resetData');
  const importDialog=$('importDialog'),importDescription=$('importDescription'),confirmImport=$('confirmImport'),restoreDialog=$('restoreDialog'),confirmRestore=$('confirmRestore'),resetDialog=$('resetDialog'),resetStep2=$('resetStep2'),resetFinalDialog=$('resetFinalDialog'),confirmReset=$('confirmReset');
  const openAbout=$('openAbout'),aboutDialog=$('aboutDialog'),closeAbout=$('closeAbout');
  const now=new Date();
  let sessions=loadSessions(),activeStart=loadActiveStart(),pendingDeleteId=null,editingId=null,editingField=null,detailId=null,pendingImport=null,openDays=new Set(),recordMode=localStorage.getItem(RECORD_MODE_KEY)==='list'?'list':'calendar',calendarMonth=new Date(now.getFullYear(),now.getMonth(),1),selectedCalendarDay=localDateKey(Date.now());


  const MODE_KEY='piano-practice-mode-beta', OPTIONS_KEY='piano-practice-auto-options-beta', AUTO_KEY='piano-practice-auto-state-beta';
  const timerMode=$('timerMode'),quietMinutes=$('quietMinutes'),soundThreshold=$('soundThreshold');
  timerMode.value=localStorage.getItem(MODE_KEY)==='auto'?'auto':'manual';
  try{const options=JSON.parse(localStorage.getItem(OPTIONS_KEY));if([1,2,3,5].includes(options.quiet))quietMinutes.value=options.quiet;if(Number.isFinite(options.threshold)&&options.threshold>=-65&&options.threshold<=-20)soundThreshold.value=options.threshold;}catch{}
  let mic=null,audioContext=null,audioLoop=null,openingMic=false,micGeneration=0,wakeLock=null,pilot;
  pilot=new window.Autopilot({quietMs:Number(quietMinutes.value)*60000,threshold:Number(soundThreshold.value),onSegment:saveAutoSegment,onChange:autoChanged});
  function autoBusy(){return pilot&&pilot.state!=='idle';}
  function saveAutoSegment(start,end){
    // Deterministic ID makes recovery idempotent if a crash occurs between two writes.
    const id=`auto-${start}`;
    const record={id,startedAt:start,endedAt:end,durationMs:end-start,note:'オート計測'};
    const index=sessions.findIndex(s=>s.id===id);if(index<0)sessions.push(record);else sessions[index]=record;
    saveSessions();
  }
  function persistAuto(){if(autoBusy())localStorage.setItem(AUTO_KEY,JSON.stringify(pilot.checkpoint()));else localStorage.removeItem(AUTO_KEY);}
  function autoChanged(){activeStart=pilot.start;persistAuto();if(pilot.state==='idle'||pilot.state==='suspended')stopMic();if(pilot.state==='idle'){if(finishDialog.open)finishDialog.close();showToast('オート計測を終了しました。記録を保存しました');}renderAll();}
  function renderMode(){
    if(!timerMode)return;
    timerMode.disabled=!!activeStart||autoBusy()||openingMic;
    quietMinutes.disabled=soundThreshold.disabled=timerMode.disabled;
    $('autoOptions').hidden=timerMode.value!=='auto';
    $('thresholdLabel').textContent=`${soundThreshold.value} dBFS`;
    $('audioMeter').hidden=!mic;
    $('resumeAuto').hidden=pilot?.state!=='suspended';
    $('resumeAuto').disabled=openingMic;
    if(!autoBusy())$('autoStatus').textContent=timerMode.value==='auto'?'オートモード · 開始するとマイクを接続します':'マニュアルモード';
  }
  function renderAutoTimer(){
    const labels={running:pilot.quiet===null?'オート · 計測中':'オート · 静かな状態が続いています',paused:'自動一時停止中 · 音が続くと再開します',suspended:'監視中断 · 確認できた時間まで保存しました'};
    $('autoStatus').textContent=labels[pilot.state];
    timerEl.textContent=formatClock(pilot.elapsed(Date.now()));
    startedAtEl.textContent='休止時間を除いた今回の計測時間';mainButton.textContent='終了';
    root.classList.toggle('running',pilot.state==='running');root.querySelector('.status-dot').setAttribute('aria-label',labels[pilot.state]);
  }
  async function stopMic(){
    micGeneration++;clearInterval(audioLoop);audioLoop=null;
    const stream=mic;mic=null;if(stream)stream.getTracks().forEach(t=>{t.onended=null;t.onmute=null;t.stop();});
    const context=audioContext;audioContext=null;if(context)context.close().catch(()=>{});
    if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}
    $('audioMeter').hidden=true;
  }
  async function beginAuto(resume=false){
    if(openingMic)return;openingMic=true;renderMode();mainButton.disabled=true;
    const generation=++micGeneration;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('HTTPSで開き、マイクに対応したブラウザをご利用ください。');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      if(generation!==micGeneration||document.hidden){stream.getTracks().forEach(t=>t.stop());throw new Error('画面を開いた状態でもう一度開始してください。');}
      mic=stream;audioContext=new (window.AudioContext||window.webkitAudioContext)();
      const analyser=audioContext.createAnalyser();analyser.fftSize=2048;audioContext.createMediaStreamSource(stream).connect(analyser);
      await audioContext.resume();
      if(generation!==micGeneration||document.hidden||audioContext?.state!=='running')throw new Error('音量の監視を開始できませんでした。もう一度お試しください。');
      const values=new Float32Array(analyser.fftSize);
      pilot.quietMs=Number(quietMinutes.value)*60000;pilot.threshold=Number(soundThreshold.value);
      if(resume)pilot.resume(Date.now());else pilot.begin(Date.now());
      stream.getTracks().forEach(t=>{t.onended=t.onmute=()=>pilot.suspend(Date.now());});
      audioContext.onstatechange=()=>{if(audioContext&&audioContext.state!=='running')pilot.suspend(Date.now());};
      audioLoop=setInterval(()=>{
        if(!audioContext||audioContext.state!=='running'){pilot.suspend(Date.now());return;}
        analyser.getFloatTimeDomainData(values);const rms=Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length),db=20*Math.log10(Math.max(rms,0.000001));
        $('audioMeter').value=Math.max(-90,db);pilot.sample(db,Date.now());persistAuto();renderTimer();
      },250);
      if(navigator.wakeLock)navigator.wakeLock.request('screen').then(lock=>{if(generation===micGeneration)wakeLock=lock;else lock.release();}).catch(()=>{});
    }catch(error){
      stopMic();if(autoBusy())pilot.suspend(Date.now());
      $('autoStatus').textContent=error.name==='NotAllowedError'?'マイクが許可されませんでした。設定でマニュアルに切り替えて利用できます。':error.message;
      showToast('マイクを開始できませんでした');
    }finally{openingMic=false;mainButton.disabled=false;timerMode.disabled=!!activeStart||autoBusy();quietMinutes.disabled=soundThreshold.disabled=timerMode.disabled;$('resumeAuto').disabled=false;}
  }
  function cancelAuto(){stopMic();pilot.state='idle';pilot.start=null;localStorage.removeItem(AUTO_KEY);}
  timerMode.addEventListener('change',()=>{localStorage.setItem(MODE_KEY,timerMode.value);renderMode();});
  for(const input of [quietMinutes,soundThreshold])input.addEventListener('input',()=>{localStorage.setItem(OPTIONS_KEY,JSON.stringify({quiet:Number(quietMinutes.value),threshold:Number(soundThreshold.value)}));renderMode();});
  $('resumeAuto').addEventListener('click',()=>beginAuto(true));
  function suspendMonitoring(){if(autoBusy())pilot.suspend(Date.now());else if(openingMic)stopMic();}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)suspendMonitoring();});
  window.addEventListener('pagehide',suspendMonitoring);

  function makeId(){return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`}
  function parseStoredData(raw){const parsed=JSON.parse(raw||'[]');if(Array.isArray(parsed))return{schemaVersion:1,sessions:parsed};if(parsed&&Number(parsed.schemaVersion)===SCHEMA_VERSION&&Array.isArray(parsed.sessions))return parsed;throw new Error('対応していないデータ形式です。')}
  function makeStoredData(value=sessions){return{schemaVersion:SCHEMA_VERSION,sessions:value}}
  function loadSessions(){try{const stored=parseStoredData(localStorage.getItem(STORAGE_KEY));let changed=false;const result=stored.sessions.filter(s=>Number.isFinite(s.startedAt)&&Number.isFinite(s.endedAt)).map(s=>{const x={...s,note:typeof s.note==='string'?s.note:''};if(typeof x.id!=='string'||!x.id){x.id=makeId();changed=true}x.durationMs=x.endedAt-x.startedAt;return x});if(changed)localStorage.setItem(STORAGE_KEY,JSON.stringify(makeStoredData(result)));return result}catch{return[]}}
  function loadActiveStart(){const v=Number(localStorage.getItem(ACTIVE_KEY));return Number.isFinite(v)&&v>0?v:null}
  function loadGoal(){try{const value=JSON.parse(localStorage.getItem(GOAL_KEY));if(['daily','monthly','yearly'].includes(value.type)&&Number.isInteger(value.minutes)&&value.minutes>0)return value}catch{}return{type:'daily',minutes:30}}
  function renderGoal(){const goal=loadGoal();goalType.value=goal.type;goalHours.value=Math.floor(goal.minutes/60);goalMinutes.value=goal.minutes%60}
  function saveGoalSetting(){const hours=Number(goalHours.value),minutes=Number(goalMinutes.value);if(!Number.isInteger(hours)||!Number.isInteger(minutes)||hours<0||hours>999||minutes<0||minutes>59||hours*60+minutes<=0){showToast('1分以上の目標時間を入力してください');return}localStorage.setItem(GOAL_KEY,JSON.stringify({type:goalType.value,minutes:hours*60+minutes}));renderGoal();renderGoalProgress();showToast('練習目標を保存しました')}
  function saveSessions({backup=true}={}){const current=localStorage.getItem(STORAGE_KEY);if(backup)localStorage.setItem(PREVIOUS_KEY,current??JSON.stringify(makeStoredData([])));localStorage.setItem(STORAGE_KEY,JSON.stringify(makeStoredData()));renderDataInfo();window.dispatchEvent(new Event('pianotrackchange'))}
  function normalizeSessions(value){if(!Array.isArray(value))throw new Error('sessions が配列ではありません。');return value.map(item=>{if(!item||typeof item.startedAt!=='number'||typeof item.endedAt!=='number')throw new Error('不正なセッションが含まれています。');const startedAt=item.startedAt,endedAt=item.endedAt;if(!Number.isFinite(startedAt)||!Number.isFinite(endedAt)||!Number.isFinite(new Date(startedAt).getTime())||!Number.isFinite(new Date(endedAt).getTime())||endedAt<=startedAt)throw new Error('不正なセッションが含まれています。');return{id:typeof item.id==='string'&&item.id?item.id:makeId(),startedAt,endedAt,durationMs:endedAt-startedAt,note:typeof item.note==='string'?item.note.slice(0,300):''}})}
  function exportData(){const payload={version:1,app:'PianoTrack',appVersion:APP_VERSION,schemaVersion:SCHEMA_VERSION,exportedAt:new Date().toISOString(),sessions};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a'),d=new Date(),z=n=>String(n).padStart(2,'0');a.href=url;a.download=`pianotrack-${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast('バックアップを書き出しました')}
  async function prepareImport(file){try{const text=await file.text(),data=JSON.parse(text);if(!data||data.version!==1||!['PianoTrack','Piano Practice Timer'].includes(data.app)||('schemaVersion'in data&&Number(data.schemaVersion)!==SCHEMA_VERSION))throw new Error('対応していないバックアップ形式です。');const normalized=normalizeSessions(data.sessions);pendingImport=normalized;importDescription.textContent=`${normalized.length}件のセッションを読み込み、現在のデータを置き換えます。`;importDialog.showModal()}catch(error){showToast(error.message||'バックアップを読み込めませんでした')}finally{backupFile.value=''}}
  function applyImport(){if(!pendingImport)return;cancelAuto();sessions=pendingImport;pendingImport=null;saveSessions();activeStart=null;localStorage.removeItem(ACTIVE_KEY);importDialog.close();renderAll();showToast('バックアップを復元しました')}
  function restorePreviousData(){if(autoBusy()||activeStart){showToast('計測を終了してから戻してください');restoreDialog.close();return;}const raw=localStorage.getItem(PREVIOUS_KEY);if(raw===null)return;try{const restored=normalizeSessions(parseStoredData(raw).sessions),current=localStorage.getItem(STORAGE_KEY);sessions=restored;localStorage.setItem(STORAGE_KEY,JSON.stringify(makeStoredData()));if(current!==null)localStorage.setItem(PREVIOUS_KEY,current);restoreDialog.close();renderAll();showToast('直前の状態に戻しました')}catch{showToast('直前のデータを復元できませんでした')}}
  function resetAllData(){cancelAuto();sessions=[];saveSessions();activeStart=null;localStorage.removeItem(ACTIVE_KEY);resetFinalDialog.close();renderAll();showToast('すべての記録を削除しました')}
  function renderDataInfo(){if(!dataCount)return;dataCount.textContent=`${sessions.length}件`;const sorted=[...sessions].sort((a,b)=>a.startedAt-b.startedAt),date=ts=>new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts));dataFirst.textContent=sorted.length?date(sorted[0].startedAt):'—';dataLast.textContent=sorted.length?date(sorted.at(-1).endedAt):'—';const bytes=new Blob([localStorage.getItem(STORAGE_KEY)||'[]']).size;dataSize.textContent=bytes<1024?`${bytes} B`:`${(bytes/1024).toFixed(bytes<10240?1:0)} KB`;restorePrevious.disabled=localStorage.getItem(PREVIOUS_KEY)===null}
  function sessionIndex(id){return sessions.findIndex(s=>s.id===id)}
  function formatClock(ms){const t=Math.max(0,Math.floor(ms/1000)),h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=t%60;return[h,m,s].map(n=>String(n).padStart(2,'0')).join(':')}
  function formatDuration(ms){const mins=Math.max(0,Math.round(ms/60000)),h=Math.floor(mins/60),m=mins%60;if(!h)return`${m}分`;if(!m)return`${h}時間`;return`${h}時間${String(m).padStart(2,'0')}分`}
  function formatExactDuration(ms){const sec=Math.max(0,Math.floor(ms/1000)),h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;if(h)return`${h}時間${m}分${s}秒`;if(m)return`${m}分${s}秒`;return`${s}秒`}
  function formatTime(ts){return new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit'}).format(new Date(ts))}
  function toLocalInput(ts){const d=new Date(ts),z=n=>String(n).padStart(2,'0');return`${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`}
  function fromLocalInput(value){if(!value)return NaN;return new Date(value).getTime()}
  function localDateKey(ts){const d=new Date(ts);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function dayBounds(key){const[y,m,d]=key.split('-').map(Number);return[new Date(y,m-1,d).getTime(),new Date(y,m-1,d+1).getTime()]}
  function startOfDay(d=new Date()){return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime()}
  function overlap(s,a,b){return Math.max(0,Math.min(s.endedAt,b)-Math.max(s.startedAt,a))}
  function rowsForDay(key){const[a,b]=dayBounds(key);return sessions.map(s=>({s,duration:overlap(s,a,b)})).filter(x=>x.duration>0).sort((x,y)=>x.s.startedAt-y.s.startedAt)}
  function dayTotal(key){return rowsForDay(key).reduce((n,x)=>n+x.duration,0)}
  function getRecordDays(){const keys=new Set();sessions.forEach(s=>{let t=startOfDay(new Date(s.startedAt));while(t<s.endedAt){keys.add(localDateKey(t));const d=new Date(t);t=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1).getTime()}});return[...keys].sort((a,b)=>b.localeCompare(a))}
  function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

  function renderTimer(){if(autoBusy()){renderAutoTimer();return;}const status=root.querySelector('.status-dot');if(activeStart){root.classList.add('running');status.setAttribute('aria-label','計測中');timerEl.textContent=formatClock(Date.now()-activeStart);startedAtEl.textContent=`${formatTime(activeStart)} に開始`;mainButton.textContent='終了'}else{root.classList.remove('running');status.setAttribute('aria-label','停止中');timerEl.textContent='00:00:00';startedAtEl.textContent='準備ができたら開始してください';mainButton.textContent='開始'}}
  function progressMarkup(label,total,target){const percent=target?total/target*100:0;return`<div class="goal-progress-period"><div class="goal-progress-head"><div><span>${label}</span><strong>${formatDuration(total)}／${formatDuration(target)}</strong></div><b>${Math.round(percent)}%</b></div><div class="goal-progress-track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,Math.round(percent))}"><i style="width:${Math.min(100,percent)}%"></i></div></div>`}
  function renderGoalProgress(){const goal=loadGoal(),target=goal.minutes*60000,current=new Date(),summary=window.PianoSummary,previous=summary.previousPeriodTotals(sessions,{activeStart});if(goal.type==='daily'){const year=current.getFullYear(),month=current.getMonth(),days=new Date(year,month+1,0).getDate(),first=(new Date(year,month,1).getDay()+6)%7,now=Date.now();let cells='<span class="goal-calendar-blank"></span>'.repeat(first);let achieved=0,elapsed=0;for(let day=1;day<=days;day++){const start=new Date(year,month,day).getTime(),end=new Date(year,month,day+1).getTime(),future=start>now,total=summary.totalBetween(sessions,start,end,activeStart,now),done=!future&&total>=target;if(!future)elapsed++;if(done)achieved++;cells+=`<span class="goal-calendar-day${done?' achieved':''}${future?' future':''}"><span>${day}</span>${done?'<b aria-label="達成">✓</b>':''}</span>`}goalProgress.innerHTML=`<div class="goal-progress-head"><div><span>一日目標の達成度</span><strong>${formatDuration(target)}／日</strong></div><b>${achieved}／${elapsed}日</b></div><div class="goal-weekdays" aria-hidden="true"><span>月</span><span>火</span><span>水</span><span>木</span><span>金</span><span>土</span><span>日</span></div><div class="goal-calendar">${cells}</div><div class="goal-previous">${progressMarkup('昨日の達成度',previous.yesterday,target)}</div>`;return}const start=goal.type==='monthly'?new Date(current.getFullYear(),current.getMonth(),1).getTime():new Date(current.getFullYear(),0,1).getTime(),end=goal.type==='monthly'?new Date(current.getFullYear(),current.getMonth()+1,1).getTime():new Date(current.getFullYear()+1,0,1).getTime(),total=summary.totalBetween(sessions,start,end,activeStart),label=goal.type==='monthly'?'今月の達成度':'今年の達成度',previousLabel=goal.type==='monthly'?'先月の達成度':'昨年の達成度',previousTotal=goal.type==='monthly'?previous.lastMonth:previous.lastYear;goalProgress.innerHTML=progressMarkup(label,total,target)+progressMarkup(previousLabel,previousTotal,target)}
  function renderSummary(){const summary=window.PianoSummary.summarizePractice(sessions,{activeStart}),previous=window.PianoSummary.previousPeriodTotals(sessions,{activeStart});todayTotal.textContent=formatDuration(summary.today);weekTotal.textContent=formatDuration(summary.week);lastWeekTotal.textContent=formatDuration(previous.lastWeek);monthTotal.textContent=formatDuration(summary.month);lastMonthTotal.textContent=formatDuration(previous.lastMonth);allTotal.textContent=formatDuration(summary.all);dailyAverage.textContent=formatDuration(window.PianoSummary.dailyAverage(sessions,{activeStart}));renderGoalProgress()}
  function sessionRowsHtml(key){const[a,b]=dayBounds(key);return rowsForDay(key).map(({s,duration})=>{const crosses=localDateKey(s.startedAt)!==localDateKey(s.endedAt-1);const timeLabel=crosses?`${formatTime(Math.max(s.startedAt,a))}〜${formatTime(Math.min(s.endedAt,b))}（日またぎ）`:`${formatTime(s.startedAt)}〜${formatTime(s.endedAt)}`;const note=s.note?`<div class="session-note">${escapeHtml(s.note)}</div>`:'';const noteMark=s.note?`<span class="note-mark" aria-label="メモあり" title="メモあり"><svg class="ui-line-icon" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg></span>`:'';return`<button class="session-row" type="button" data-id="${escapeHtml(s.id)}"><div><div class="session-time">${timeLabel}</div><div class="session-duration">${formatExactDuration(duration)}</div>${note}</div><span class="session-tail">${noteMark}<span class="edit-mark" aria-hidden="true"></span></span></button>`}).join('')}
  function renderList(){const days=getRecordDays();if(!days.length){recordList.innerHTML='<div class="empty">まだ保存された記録はありません。<br>最初の練習を始めてみましょう。</div>';return}recordList.innerHTML=days.map(key=>{const rows=rowsForDay(key),total=rows.reduce((n,x)=>n+x.duration,0),[y,m,d]=key.split('-').map(Number),label=new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date(y,m-1,d)),open=openDays.has(key)?' open':'';return`<article class="day-card${open}" data-day="${key}"><button class="day-toggle" type="button" aria-expanded="${openDays.has(key)}"><span class="day-main"><span class="day-date">${label}</span><span class="day-meta">${rows.length}セッション</span></span><span class="day-total">${formatDuration(total)} <span class="chevron" aria-hidden="true"></span></span></button><div class="session-list">${sessionRowsHtml(key)}</div></article>`}).join('')}
  function levelFor(ms){const mins=ms/60000;if(mins<=0)return 0;if(mins<15)return 1;if(mins<30)return 2;if(mins<60)return 3;return 4}
  function renderCalendar(){const y=calendarMonth.getFullYear(),m=calendarMonth.getMonth(),days=new Date(y,m+1,0).getDate(),first=(new Date(y,m,1).getDay()+6)%7;monthLabel.textContent=`${y}年${m+1}月`;let html='';for(let i=0;i<first;i++)html+='<button class="calendar-day blank" tabindex="-1"></button>';for(let d=1;d<=days;d++){const key=localDateKey(new Date(y,m,d)),total=dayTotal(key),level=levelFor(total),today=key===localDateKey(Date.now())?' today':'',selected=key===selectedCalendarDay?' selected':'',dot=total>0?'<span class="dot"></span>':'';html+=`<button class="calendar-day level-${level}${today}${selected}" type="button" data-day="${key}" aria-label="${m+1}月${d}日 ${formatDuration(total)}">${d}${dot}</button>`}calendarGrid.innerHTML=html;renderCalendarDetail()}
  function renderCalendarDetail(){const key=selectedCalendarDay,[y,m,d]=key.split('-').map(Number),rows=rowsForDay(key),total=rows.reduce((n,x)=>n+x.duration,0),label=new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short'}).format(new Date(y,m-1,d));calendarDetail.innerHTML=`<div class="calendar-detail-title"><strong>${label}</strong><span>${rows.length?`${rows.length}セッション・${formatDuration(total)}`:'練習記録なし'}</span></div>${rows.length?`<div class="session-list">${sessionRowsHtml(key)}</div>`:'<div class="calendar-empty">この日の練習記録はありません。</div>'}`}
  function setRecordMode(mode){recordMode=mode;localStorage.setItem(RECORD_MODE_KEY,mode);calendarMode.hidden=mode!=='calendar';listMode.hidden=mode!=='list';calendarModeButton.classList.toggle('active',mode==='calendar');listModeButton.classList.toggle('active',mode==='list');if(mode==='calendar')renderCalendar();else renderList()}
  function renderRecords(){setRecordMode(recordMode)}
  function renderAll(){renderMode();renderTimer();renderSummary();renderRecords();renderDataInfo();renderGoal()}

  async function startTimer(){if(timerMode.value==='auto'){await beginAuto();return;}activeStart=Date.now();localStorage.setItem(ACTIVE_KEY,String(activeStart));renderAll();showToast('練習を開始しました')}
  function requestFinish(){if(!activeStart&&!autoBusy())return;sessionResult.textContent=formatExactDuration(autoBusy()?pilot.elapsed(Date.now()):Date.now()-activeStart);finishDialog.showModal()}
  function finishAndSave(){if(autoBusy()){pilot.finish(Date.now());stopMic();finishDialog.close();renderAll();showToast('オート計測を終了しました');return;}if(!activeStart)return;const endedAt=Date.now(),durationMs=endedAt-activeStart;if(durationMs>=1000){sessions.push({id:makeId(),startedAt:activeStart,endedAt,durationMs,note:''});saveSessions()}activeStart=null;localStorage.removeItem(ACTIVE_KEY);finishDialog.close();selectedCalendarDay=localDateKey(endedAt);renderAll();showToast('練習時間を保存しました')}
  function formatDateTime(ts){return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(ts))}
  function openDetail(id){const s=sessions[sessionIndex(id)];if(!s)return;detailId=id;detailStart.textContent=formatDateTime(s.startedAt);detailEnd.textContent=formatDateTime(s.endedAt);detailDuration.textContent=formatExactDuration(s.endedAt-s.startedAt);detailNote.textContent=s.note||'メモはありません';detailNote.classList.toggle('empty-note',!s.note);detailDialog.showModal()}
  function openEditor(id,field){const s=sessions[sessionIndex(id)];if(!s)return;editingId=id;editingField=field;editStart.value=toLocalInput(s.startedAt);editEnd.value=toLocalInput(s.endedAt);editNote.value=s.note||'';editError.textContent='';const startField=editStart.closest('.field'),endField=editEnd.closest('.field'),noteField=editNote.closest('.field');startField.classList.toggle('is-hidden',field!=='start');endField.classList.toggle('is-hidden',field!=='end');noteField.classList.toggle('is-hidden',field!=='note');editStart.disabled=field!=='start';editEnd.disabled=field!=='end';editNote.disabled=field!=='note';editDuration.classList.toggle('is-hidden',field==='note');editTitle.textContent=field==='start'?'開始時刻を編集':field==='end'?'終了時刻を編集':'メモを編集';saveEdit.textContent=field==='note'?'メモを保存':'時刻を保存';updateEditDuration();editDialog.showModal();requestAnimationFrame(()=>field==='note'?editNote.focus():field==='start'?editStart.focus():editEnd.focus())}
  function updateEditDuration(){const a=fromLocalInput(editStart.value),b=fromLocalInput(editEnd.value);editDuration.textContent=Number.isFinite(a)&&Number.isFinite(b)&&b>a?formatExactDuration(b-a):'時刻を確認してください'}
  function saveSessionEdit(){if(!editingId||!editingField)return;const index=sessionIndex(editingId),current=sessions[index];if(!current)return;if(editingField==='note'){sessions[index]={...current,note:editNote.value.trim()}}else{const candidate=fromLocalInput(editingField==='start'?editStart.value:editEnd.value);if(!Number.isFinite(candidate)){editError.textContent='日時を入力してください。';return}const startedAt=editingField==='start'?candidate:current.startedAt,endedAt=editingField==='end'?candidate:current.endedAt;if(endedAt<=startedAt){editError.textContent='終了日時は開始日時より後にしてください。';return}if(endedAt-startedAt>86400000){editError.textContent='1回の記録は24時間以内にしてください。';return}sessions[index]={...current,startedAt,endedAt,durationMs:endedAt-startedAt}}saveSessions();const id=editingId;editingId=null;editingField=null;editDialog.close();renderAll();openDetail(id);showToast('記録を更新しました')}
  function requestDelete(id){const s=sessions[sessionIndex(id)];if(!s)return;pendingDeleteId=id;deleteDescription.textContent=`${new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric'}).format(new Date(s.startedAt))} ${formatTime(s.startedAt)}〜${formatTime(s.endedAt)}（${formatExactDuration(s.endedAt-s.startedAt)}）`;deleteDialog.showModal()}
  function deleteSession(){if(!pendingDeleteId)return;const index=sessionIndex(pendingDeleteId);if(index>=0)sessions.splice(index,1);pendingDeleteId=null;editingId=null;saveSessions();deleteDialog.close();renderAll();showToast('記録を削除しました')}
  function showView(id){const isTimer=id==='timerView';root.classList.toggle('timer-view',isTimer);root.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==id);root.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===id));if(!isTimer)window.scrollTo({top:0,behavior:'smooth'});if(id==='recordsView')renderRecords();if(id==='statisticsView')renderSummary();if(id==='settingsView'){renderDataInfo();renderGoal()}}
  function showToast(msg){toast.textContent=msg;toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),1800)}

  mainButton.addEventListener('click',()=>activeStart||autoBusy()?requestFinish():startTimer());saveSession.addEventListener('click',finishAndSave);confirmDelete.addEventListener('click',deleteSession);saveEdit.addEventListener('click',saveSessionEdit);editStart.addEventListener('input',updateEditDuration);editEnd.addEventListener('input',updateEditDuration);
  editStartFromDetail.addEventListener('click',()=>{if(!detailId)return;const id=detailId;detailDialog.close();openEditor(id,'start')});editEndFromDetail.addEventListener('click',()=>{if(!detailId)return;const id=detailId;detailDialog.close();openEditor(id,'end')});editNoteFromDetail.addEventListener('click',()=>{if(!detailId)return;const id=detailId;detailDialog.close();openEditor(id,'note')});deleteFromDetail.addEventListener('click',()=>{if(!detailId)return;const id=detailId;detailDialog.close();requestDelete(id)});deleteFromEdit.addEventListener('click',()=>{if(!editingId)return;const id=editingId;editDialog.close();requestDelete(id)});
  exportBackup.addEventListener('click',exportData);importBackup.addEventListener('click',()=>backupFile.click());backupFile.addEventListener('change',()=>{const file=backupFile.files&&backupFile.files[0];if(file)prepareImport(file)});confirmImport.addEventListener('click',applyImport);importDialog.addEventListener('close',()=>{if(importDialog.returnValue==='cancel')pendingImport=null});restorePrevious.addEventListener('click',()=>{if(localStorage.getItem(PREVIOUS_KEY)!==null)restoreDialog.showModal()});confirmRestore.addEventListener('click',restorePreviousData);resetData.addEventListener('click',()=>resetDialog.showModal());resetStep2.addEventListener('click',()=>{resetDialog.close();resetFinalDialog.showModal()});confirmReset.addEventListener('click',resetAllData);saveGoal.addEventListener('click',saveGoalSetting);
  calendarModeButton.addEventListener('click',()=>setRecordMode('calendar'));listModeButton.addEventListener('click',()=>setRecordMode('list'));prevMonth.addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);selectedCalendarDay=localDateKey(calendarMonth);renderCalendar()});nextMonth.addEventListener('click',()=>{calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);selectedCalendarDay=localDateKey(calendarMonth);renderCalendar()});
  calendarGrid.addEventListener('click',e=>{const day=e.target.closest('.calendar-day[data-day]');if(!day)return;selectedCalendarDay=day.dataset.day;renderCalendar()});calendarDetail.addEventListener('click',e=>{const row=e.target.closest('.session-row');if(row)openDetail(row.dataset.id)});
  root.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>showView(t.dataset.view)));
  openAbout.addEventListener('click',()=>aboutDialog.showModal());
  closeAbout.addEventListener('click',()=>aboutDialog.close());
  aboutDialog.addEventListener('click',e=>{if(e.target===aboutDialog)aboutDialog.close()});recordList.addEventListener('click',e=>{const session=e.target.closest('.session-row');if(session){openDetail(session.dataset.id);return}const toggle=e.target.closest('.day-toggle');if(toggle){const key=toggle.closest('.day-card').dataset.day;if(openDays.has(key))openDays.delete(key);else openDays.add(key);renderList()}});
  detailDialog.addEventListener('close',()=>{detailId=null});editDialog.addEventListener('close',()=>{if(editDialog.returnValue==='cancel'){editingId=null;editingField=null}editError.textContent=''});deleteDialog.addEventListener('close',()=>{if(deleteDialog.returnValue==='cancel')pendingDeleteId=null});document.addEventListener('visibilitychange',()=>{
    if(!document.hidden && document.body.classList.contains('piano-native-mode')) renderAll()
  });
  setInterval(()=>{
    if((activeStart||autoBusy()) && document.body.classList.contains('piano-native-mode')){
      renderTimer();
      renderSummary();
      if(recordMode==='calendar')renderCalendar();
    }
  },1000);



  try{const saved=JSON.parse(localStorage.getItem(AUTO_KEY));if(saved){timerMode.value='auto';pilot.recover(saved);}}catch{}

  $('saveForgot').addEventListener('click',()=>{
    const end=fromLocalInput($('forgotEnd').value);
    if(!activeStart||!Number.isFinite(end)||end<=activeStart||end>Date.now()){$('forgotError').textContent='開始日時より後、現在以前の日時を指定してください。';return;}
    sessions.push({id:makeId(),startedAt:activeStart,endedAt:end,durationMs:end-activeStart,note:''});saveSessions();activeStart=null;localStorage.removeItem(ACTIVE_KEY);$('forgotDialog').close();renderAll();
  });
  function checkForgot(){if(activeStart&&!autoBusy()&&Date.now()-activeStart>=14400000&&!$('forgotDialog').open){$('forgotEnd').value=toLocalInput(Date.now());$('forgotDialog').showModal();}}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkForgot();});
  checkForgot();

  showView('timerView');
  renderAll();

})();
