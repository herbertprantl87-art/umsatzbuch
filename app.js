(function(){
  var MONTHS=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  var WD=['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
  var WD_SHORT=['Mo','Di','Mi','Do','Fr','Sa','So'];
  var METHODS=['Amazon Gutschein','Paysafe','Überweisung'];
  var eur=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
  var eur0=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR',maximumFractionDigits:0});
  var int=new Intl.NumberFormat('de-DE');
  var $=function(id){return document.getElementById(id)};
  function pad(n){return String(n).padStart(2,'0')}
  function iso(y,m,d){return y+'-'+pad(m+1)+'-'+pad(d)}
  function parseIso(s){var p=s.split('-');return new Date(+p[0],+p[1]-1,+p[2])}
  function fmtDate(s){var d=parseIso(s);return pad(d.getDate())+'.'+pad(d.getMonth()+1)+'.'+d.getFullYear()}
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}

  var cfg=window.UMSATZBUCH_CONFIG||{};
  if(!cfg.supabaseUrl||!cfg.supabaseAnonKey||cfg.supabaseUrl.indexOf('DEIN-PROJEKT')>-1){
    $('cfgMsg').hidden=false;$('cfgMsg').textContent='Die Seite ist noch nicht mit der Datenbank verbunden. Bitte in config.js die Supabase-URL und den Key eintragen.';return;
  }
  // Anmeldung nur im Tab speichern (sessionStorage): Tab zu = abgemeldet.
  // Alte, dauerhaft gespeicherte Anmeldungen aus früheren Versionen entfernen.
  try{Object.keys(localStorage).forEach(function(k){if(k.indexOf('sb-')===0)localStorage.removeItem(k)})}catch(e){}
  var sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{storage:window.sessionStorage,persistSession:true}});

  var state={pay:[],goals:{},auf:[]},goalIds={};
  var now=new Date(),selY=now.getFullYear(),selM=now.getMonth();
  var user=null,editId=null,KEY=null,tresor=null;

  // ---------- Verschlüsselung im Browser (AES-GCM, Schlüssel aus dem Datenkennwort) ----------
  var te=new TextEncoder(),tdec=new TextDecoder();
  function b64(u8){var s='';for(var i=0;i<u8.length;i++)s+=String.fromCharCode(u8[i]);return btoa(s)}
  function unb64(s){var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
  async function derive(pw,salt,iter){
    var base=await crypto.subtle.importKey('raw',te.encode(pw),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:salt,iterations:iter,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function enc(obj,key){
    var s=JSON.stringify(obj);s+=' '.repeat(128-(te.encode(s).length%128)); // auf 128 Byte auffüllen, damit die Länge nichts verrät
    var iv=crypto.getRandomValues(new Uint8Array(12));
    var ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:iv},key||KEY,te.encode(s)));
    var out=new Uint8Array(12+ct.length);out.set(iv);out.set(ct,12);return 'v1:'+b64(out);
  }
  async function dec(str,key){
    var u=unb64(String(str).slice(3));
    var pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:u.slice(0,12)},key||KEY,u.slice(12));
    return JSON.parse(tdec.decode(pt));
  }

  // Schlüssel auf diesem Gerät merken (IndexedDB, nicht auslesbar)
  function idb(){return new Promise(function(res,rej){var r=indexedDB.open('umsatzbuch',1);r.onupgradeneeded=function(){r.result.createObjectStore('keys')};r.onsuccess=function(){res(r.result)};r.onerror=function(){rej(r.error)}})}
  async function idbDo(mode,fn){try{var db=await idb();return await new Promise(function(res){var t=db.transaction('keys',mode),q=fn(t.objectStore('keys'));t.oncomplete=function(){res(q&&q.result)};t.onerror=function(){res(null)}})}catch(e){return null}}
  function idbGet(k){return idbDo('readonly',function(s){return s.get(k)})}
  function idbSet(k,v){return idbDo('readwrite',function(s){return s.put(v,k)})}
  function idbDel(k){return idbDo('readwrite',function(s){return s.delete(k)})}

  // ---------- Anmeldung ----------
  $('loginForm').addEventListener('submit',async function(e){
    e.preventDefault();
    $('loginMsg').className='';$('loginMsg').textContent='Anmeldung läuft …';
    var r=await sb.auth.signInWithPassword({email:$('lMail').value.trim(),password:$('lPw').value});
    if(r.error){$('loginMsg').className='err';$('loginMsg').textContent='Anmeldung fehlgeschlagen. E-Mail oder Passwort stimmt nicht.';return}
    $('lPw').value='';$('loginMsg').textContent='';
  });
  async function logout(){var id=user&&user.id;KEY=null;if(id)await idbDel(id);sb.auth.signOut()}
  $('btnLogout').addEventListener('click',logout);
  $('uLogout').addEventListener('click',logout);

  // Automatisch abmelden nach 15 Minuten ohne Nutzung (auch wenn das Handy die Seite im Hintergrund pausiert)
  var IDLE_MS=15*60*1000;
  function touch(){try{sessionStorage.setItem('ub-aktiv',String(Date.now()))}catch(e){}}
  function lastActive(){try{return +sessionStorage.getItem('ub-aktiv')||0}catch(e){return 0}}
  async function idleCheck(){
    var t=lastActive();
    if(user&&t&&Date.now()-t>IDLE_MS){
      try{sessionStorage.removeItem('ub-aktiv')}catch(e){}
      KEY=null;await sb.auth.signOut();
      $('loginMsg').className='';$('loginMsg').textContent='Aus Sicherheitsgründen nach 15 Minuten ohne Nutzung abgemeldet.';
    }
  }
  ['pointerdown','keydown','touchstart','scroll'].forEach(function(ev){window.addEventListener(ev,function(){if(user)touch()},{passive:true})});
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')idleCheck()});
  window.addEventListener('pageshow',idleCheck);
  window.addEventListener('focus',idleCheck);
  setInterval(idleCheck,30000);

  sb.auth.onAuthStateChange(function(_ev,session){
    var u=session?session.user:null;
    if(u&&user&&u.id===user.id)return;
    // Tab war zu lange unbenutzt (z. B. Handy im Hintergrund): direkt abmelden statt öffnen
    if(u&&lastActive()&&Date.now()-lastActive()>IDLE_MS){
      try{sessionStorage.removeItem('ub-aktiv')}catch(e){}
      $('loginMsg').textContent='Aus Sicherheitsgründen nach 15 Minuten ohne Nutzung abgemeldet.';
      sb.auth.signOut();return;
    }
    user=u;
    if(user){touch();$('login').hidden=true;afterLogin()}
    else{try{sessionStorage.removeItem('ub-aktiv')}catch(e){}KEY=null;tresor=null;$('app').hidden=true;$('unlock').hidden=true;$('login').hidden=false;state={pay:[],goals:{},auf:[]};goalIds={}}
  });

  async function afterLogin(){
    var r=await sb.from('tresor_schluessel').select('salz,iterationen,pruefwert').maybeSingle();
    if(r.error){showUnlock(false);umsg('Verbindung zur Datenbank fehlgeschlagen: '+r.error.message,true);return}
    tresor=r.data;
    if(tresor){
      var k=await idbGet(user.id);
      if(k){try{var v=await dec(tresor.pruefwert,k);if(v.ok==='umsatzbuch'){KEY=k;return openApp()}}catch(e){}await idbDel(user.id)}
    }
    showUnlock(!tresor);
  }
  function umsg(t,err){$('unlockMsg').textContent=t;$('unlockMsg').className=err?'err':''}
  var setupMode=false;
  function showUnlock(setup){
    setupMode=setup;
    $('ulTitle').textContent=setup?'Datenkennwort festlegen':'Datenkennwort eingeben';
    $('ulText').textContent=setup
      ?'Mit diesem Kennwort werden alle Zahlen verschlüsselt, bevor sie gespeichert werden. Niemand sonst kann sie lesen. Geht das Kennwort verloren, sind die Daten nicht wiederherstellbar. Bitte sicher notieren.'
      :'Die Zahlen sind verschlüsselt. Mit dem Datenkennwort werden sie auf diesem Gerät lesbar.';
    $('uPw2Wrap').hidden=!setup;$('uNotedWrap').hidden=!setup;
    $('uPw').autocomplete=setup?'new-password':'current-password';
    $('uBtn').textContent=setup?'Festlegen':'Entsperren';
    $('uPw').value='';$('uPw2').value='';umsg('');
    $('app').hidden=true;$('unlock').hidden=false;$('uPw').focus();
  }
  $('unlockForm').addEventListener('submit',async function(e){
    e.preventDefault();
    var pw=$('uPw').value;
    if(setupMode){
      if(pw.length<8){umsg('Bitte mindestens 8 Zeichen.',true);return}
      if(pw!==$('uPw2').value){umsg('Die beiden Eingaben stimmen nicht überein.',true);return}
      if(!$('uNoted').checked){umsg('Bitte bestätigen, dass das Kennwort notiert ist.',true);return}
      umsg('Wird eingerichtet …');
      var salt=crypto.getRandomValues(new Uint8Array(16)),iter=600000;
      var key=await derive(pw,salt,iter);
      var row={user_id:user.id,salz:b64(salt),iterationen:iter,pruefwert:await enc({ok:'umsatzbuch'},key)};
      var r=await sb.from('tresor_schluessel').insert(row);
      if(r.error){umsg('Einrichten fehlgeschlagen: '+r.error.message,true);return}
      tresor=row;KEY=key;
    } else {
      umsg('Wird geprüft …');
      var k=await derive(pw,unb64(tresor.salz),tresor.iterationen);
      try{var v=await dec(tresor.pruefwert,k);if(v.ok!=='umsatzbuch')throw 0}catch(err){umsg('Das Datenkennwort stimmt nicht.',true);return}
      KEY=k;
    }
    if($('uRemember').checked)await idbSet(user.id,KEY);
    $('uPw').value='';$('uPw2').value='';
    openApp();
  });

  async function openApp(){
    $('unlock').hidden=true;$('app').hidden=false;$('userMail').textContent=user.email;
    await migrate();
    await loadAll();
  }

  // Einträge als verschlüsselte Objekte: t:'z' Zahlung, t:'g' Monatsziel, t:'a' Auftrag
  function payObj(d,m,b,k,n){return {t:'z',d:d,a:m,b:b,k:k,n:n||''}}
  function fromObj(id,o){return {id:id,date:o.d,method:o.a,amount:+o.b,cust:+o.k,note:o.n||''}}

  async function loadAll(){
    $('app').classList.add('loading');
    var a=await sb.from('eintraege').select('id,daten').order('id');
    if(a.error){$('app').classList.remove('loading');flash('Daten konnten nicht geladen werden: '+a.error.message);return}
    var pay=[],goals={},gids={},auf=[],bad=0;
    for(var i=0;i<a.data.length;i++){
      var r=a.data[i];
      try{var o=await dec(r.daten);if(o.t==='z')pay.push(fromObj(r.id,o));else if(o.t==='g'){goals[o.m]=+o.z;gids[o.m]=r.id}else if(o.t==='a')auf.push(fromAuf(r.id,o))}catch(e){bad++}
    }
    state.pay=pay;state.goals=goals;goalIds=gids;state.auf=auf;
    $('app').classList.remove('loading');
    render();renderAuf();
    if(bad)flash(bad+' Einträge konnten nicht entschlüsselt werden.');
  }

  // Einmalig: unverschlüsselte Altdaten verschlüsselt übernehmen und danach löschen
  async function migrate(){
    var a=await sb.from('zahlungen').select('id,datum,zahlungsart,betrag,kunden,notiz');
    var b=await sb.from('monatsziele').select('monat,ziel');
    var za=a.error?[]:a.data,zb=b.error?[]:b.data;
    if(!za.length&&!zb.length)return;
    var rows=[];
    for(var i=0;i<za.length;i++){var x=za[i];rows.push({user_id:user.id,daten:await enc(payObj(x.datum,x.zahlungsart,+x.betrag,+x.kunden,x.notiz))})}
    for(var j=0;j<zb.length;j++){rows.push({user_id:user.id,daten:await enc({t:'g',m:zb[j].monat,z:+zb[j].ziel})})}
    var r=await sb.from('eintraege').insert(rows);
    if(r.error){flash('Übernahme der Altdaten fehlgeschlagen: '+r.error.message);return}
    if(za.length)await sb.from('zahlungen').delete().eq('user_id',user.id).in('id',za.map(function(x){return x.id}));
    if(zb.length)await sb.from('monatsziele').delete().eq('user_id',user.id);
    flash(rows.length+' bisherige Einträge wurden verschlüsselt.');
  }

  // Sicherung als CSV (entschlüsselt, nur auf diesem Gerät). In der Ansicht Aufträge: die Aufträge.
  function q(s){return '"'+String(s).replace(/"/g,'""')+'"'}
  function saveCsv(lines,name){
    var blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download=name+'-'+iso(now.getFullYear(),now.getMonth(),now.getDate())+'.csv';
    document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href)},1000);
  }
  $('btnExport').addEventListener('click',function(){
    if(!$('viewAuftraege').hidden){
      var al=['Art;Name;Telegram;Adresse;Von;Bis;Was;Betrag;Zahlungsart;Im Umsatzbuch am;Status;Erledigt am'];
      state.auf.slice().sort(function(a,b){return a.id-b.id}).forEach(function(x){
        al.push([ARTEN[x.art],q(x.name),q(x.tg.replace(/^@/,'')),q(x.adr.replace(/\r?\n/g,', ')),x.von?fmtDate(x.von):'',x.bis?fmtDate(x.bis):'',q(x.note),x.betrag!=null?x.betrag.toFixed(2).replace('.',','):'',x.za,uebernommen(x).map(function(p){return fmtDate(p.date)}).join(' '),x.ok?'erledigt':'offen',x.okAm?fmtDate(x.okAm):''].join(';'));
      });
      saveCsv(al,'auftraege-sicherung');
      flash('Sicherung mit '+state.auf.length+' Aufträgen heruntergeladen. Bitte sicher aufbewahren, die Datei ist nicht verschlüsselt.',$('aMsg'));
      return;
    }
    var lines=['Datum;Zahlungsart;Betrag;Kunden;Notiz'];
    state.pay.slice().sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:a.id-b.id}).forEach(function(p){
      lines.push([fmtDate(p.date),p.method,p.amount.toFixed(2).replace('.',','),p.cust,q(p.note)].join(';'));
    });
    saveCsv(lines,'umsatzbuch-sicherung');
    flash('Sicherung mit '+state.pay.length+' Zahlungen heruntergeladen. Bitte sicher aufbewahren, die Datei ist nicht verschlüsselt.');
  });

  // Auswahl
  MONTHS.forEach(function(n,i){var o=document.createElement('option');o.value=i;o.textContent=n;$('selMonth').appendChild(o)});
  for(var y=now.getFullYear()-3;y<=now.getFullYear()+1;y++){var o=document.createElement('option');o.value=y;o.textContent=y;$('selYear').appendChild(o)}
  METHODS.forEach(function(m){var o=document.createElement('option');o.value=m;o.textContent=m;$('fMethod').appendChild(o)});
  $('selMonth').value=selM;$('selYear').value=selY;
  $('selMonth').onchange=function(){selM=+this.value;render()};
  $('selYear').onchange=function(){selY=+this.value;render()};
  function resetForm(){
    editId=null;$('fSales').value='';$('fCust').value='1';$('fNote').value='';
    $('btnSave').textContent='Speichern';$('btnCancel').hidden=true;walterForm();
  }
  ['fDate','fSales','fCust'].forEach(function(id){$(id).addEventListener('input',walterForm);$(id).addEventListener('change',walterForm)});
  ['pDate','pSales','pCust'].forEach(function(id){$(id).addEventListener('input',walterPay);$(id).addEventListener('change',walterPay)});
  $('fDate').value=iso(now.getFullYear(),now.getMonth(),now.getDate());
  $('fDate').addEventListener('input',showDay);
  $('fDate').addEventListener('change',showDay);
  resetForm();

  function monthRows(y,m){
    var pre=y+'-'+pad(m+1)+'-';
    return state.pay.filter(function(r){return r.date.indexOf(pre)===0}).sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:a.id-b.id});
  }
  function totals(rows){
    var s=0,c=0,days={};rows.forEach(function(r){s+=r.amount;c+=r.cust;days[r.date]=1});
    var n=Object.keys(days).length;
    return {sales:s,cust:c,days:n,basket:c?s/c:0,perDay:n?s/n:0};
  }
  // Anteil Walter (ab 01.12.2026): ein Viertel je Kunde, auf ganze Euro gerundet, bei genau ,50 abgerundet.
  // Beispiele: 15 € -> 4, 20 -> 5, 25 -> 6, 30 -> 7, 35 -> 9, 40 -> 10, 50 -> 12, 60 -> 15, 100 -> 25.
  // Hat eine Zahlung mehrere Kunden, wird mit dem Betrag je Kunde gerechnet (40 € mit 2 Kunden = 2 x 5 €).
  var WALTER_AB='2026-12-01';
  function viertel(b){var c=Math.round(b*100);return Math.max(0,Math.ceil(c/400-0.5))}
  function walter(d,b,k){
    if(!d||d<WALTER_AB||!(b>0))return 0;
    k=k>0?k:1;return k*viertel(b/k);
  }
  function walterSumme(rows){var w=0;rows.forEach(function(r){w+=walter(r.date,r.amount,r.cust)});return w}
  // Hinweis unter dem Eingabefeld: "Anteil Walter 15,00 € · bleibt 45,00 €"
  function walterHinweis(el,d,b,k){
    var s=betragIn(b),w=s>0?walter(d,s,parseInt(k,10)):0;
    el.textContent=w?'Anteil Walter '+eur.format(w)+' · bleibt '+eur.format(s-w):'';
  }
  function walterForm(){walterHinweis($('fWalter'),$('fDate').value,$('fSales').value,$('fCust').value)}
  function walterPay(){walterHinweis($('pWalter'),$('pDate').value,$('pSales').value,$('pCust').value)}
  function cmp(cur,prev,fmt){
    if(!prev) return 'Vormonat: keine Daten';
    var p=(cur-prev)/prev*100;
    return '<span class="'+(p>=0?'up':'down')+'">'+(p>=0?'+':'')+p.toFixed(1).replace('.',',')+' %</span> zum Vormonat ('+fmt(prev)+')';
  }

  // Tagesumsatz im Kasten oben: der Tag aus dem Datumsfeld (leer = heute)
  function showDay(){
    var h=new Date(),heute=iso(h.getFullYear(),h.getMonth(),h.getDate());
    var tag=$('fDate').value||heute,sum=0;
    state.pay.forEach(function(p){if(p.date===tag)sum+=p.amount});
    $('kToday').textContent=eur.format(sum);
    $('kTodayLabel').textContent=tag===heute?'Umsatz heute':'Umsatz am '+WD_SHORT[(parseIso(tag).getDay()+6)%7]+', '+fmtDate(tag);
  }

  function render(){
    showDay();

    var rows=monthRows(selY,selM),t=totals(rows);
    var py=selM===0?selY-1:selY,pm=selM===0?11:selM-1;
    var isCur=selY===now.getFullYear()&&selM===now.getMonth();
    var prevRows=monthRows(py,pm);
    // laufender Monat: Vormonat nur bis zum gleichen Tag vergleichen
    if(isCur){var lim=now.getDate();prevRows=prevRows.filter(function(r){return +r.date.slice(8)<lim})}
    var pt=totals(prevRows);

    $('kSales').textContent=eur.format(t.sales);
    $('kCust').textContent=int.format(t.cust);
    $('kBasket').textContent=eur.format(t.basket);
    $('kDay').textContent=eur.format(t.perDay);
    $('kSalesCmp').innerHTML=cmp(t.sales,pt.sales,function(v){return eur0.format(v)});
    var tw=walterSumme(rows);
    $('kWalter').textContent=tw?'Anteil Walter '+eur.format(tw)+' · bleibt '+eur.format(t.sales-tw):'';
    $('kCustCmp').innerHTML=cmp(t.cust,pt.cust,function(v){return int.format(v)});
    $('kBasketCmp').innerHTML=cmp(t.basket,pt.basket,function(v){return eur.format(v)});
    $('kDayCnt').textContent=t.days+(t.days===1?' Tag':' Tage')+' mit Umsatz';

    // Umsatz je Zahlungsart
    $('methods').innerHTML=METHODS.map(function(m){
      var s=0,n=0,c=0;rows.forEach(function(r){if(r.method===m){s+=r.amount;n++;c+=r.cust}});
      var share=t.sales?s/t.sales*100:0;
      return '<div class="method"><div class="m-head"><span class="m-name">'+m+'</span><span class="m-share num">'+share.toFixed(0)+' %</span></div>'+
        '<div class="m-value num">'+eur.format(s)+'</div>'+
        '<div class="m-bar"><i style="width:'+share+'%"></i></div>'+
        '<div class="m-sub num">'+n+(n===1?' Zahlung':' Zahlungen')+' · '+c+' Kunden</div></div>';
    }).join('');

    // Hochrechnung: Umsatz pro bisherigem Kalendertag mal Tage im Monat
    var dim=new Date(selY,selM+1,0).getDate();
    var lastDay=rows.length?+rows[rows.length-1].date.slice(8):0;
    var elapsed=isCur?Math.max(lastDay,now.getDate()-1):(rows.length?dim:0);
    var fc=elapsed?t.sales/elapsed*dim:0;
    if(!isCur&&rows.length) fc=t.sales;
    var goal=+(state.goals[selY+'-'+pad(selM+1)]||0);
    $('inGoal').value=goal||'';
    var scale=Math.max(goal,fc,t.sales)*1.08||1;
    $('gCur').style.width=(t.sales/scale*100)+'%';
    $('gFc').style.width=(fc/scale*100)+'%';
    $('gMark').hidden=!goal;
    $('gMark').style.left=(goal/scale*100)+'%';
    $('lCur').textContent=eur0.format(t.sales);
    $('lFc').textContent=eur0.format(fc);
    $('lGoal').textContent=goal?eur0.format(goal):'nicht gesetzt';
    $('goalPct').textContent=goal?(t.sales/goal*100).toFixed(0)+' % erreicht':'';

    var wd=[0,0,0,0,0,0,0];
    rows.forEach(function(r){var d=parseIso(r.date).getDay();wd[(d+6)%7]+=r.amount});
    var mx=Math.max.apply(null,wd)||1;
    $('bars').innerHTML=wd.map(function(v,i){
      return '<div class="bar"><span class="v num">'+(v?eur0.format(v).replace(/\s?€/,''):'')+'</span><div class="track"><div class="fill" style="height:'+(v/mx*100)+'%"></div></div><span class="d">'+WD_SHORT[i]+'</span></div>';
    }).join('');

    var tb=$('tbody');
    if(!rows.length){tb.innerHTML='<tr><td colspan="7" class="empty">Für '+MONTHS[selM]+' '+selY+' ist noch nichts eingetragen. Oben einfach die erste Zahlung speichern.</td></tr>';}
    else{
      tb.innerHTML=rows.map(function(r){
        var d=parseIso(r.date),w=walter(r.date,r.amount,r.cust);
        return '<tr><td class="c-date num">'+fmtDate(r.date)+'</td><td class="c-day">'+WD[d.getDay()]+'</td><td class="c-method">'+esc(r.method)+'</td><td class="r num c-amount">'+eur.format(r.amount)+(w?'<div class="walter">Anteil Walter '+eur.format(w)+'</div>':'')+'</td><td class="r num c-cust">'+r.cust+(r.cust===1?' Kunde':' Kunden')+'</td><td class="c-note">'+esc(r.note)+'</td><td class="r c-act"><button type="button" class="link" data-edit="'+r.id+'">Ändern</button><button type="button" class="link" data-del="'+r.id+'">Löschen</button></td></tr>';
      }).join('')+'<tr class="sum"><td colspan="3" class="c-date">Summe '+MONTHS[selM]+'</td><td class="r num c-amount">'+eur.format(t.sales)+(tw?'<div class="walter">Anteil Walter '+eur.format(tw)+'</div><div class="walter">bleibt '+eur.format(t.sales-tw)+'</div>':'')+'</td><td class="r num c-cust">'+int.format(t.cust)+' Kunden</td><td colspan="2" class="c-act"></td></tr>';
    }
  }

  function flash(t,el){el=el||$('msg');el.textContent=t;clearTimeout(el._t);el._t=setTimeout(function(){el.textContent=''},4000)}
  function byId(id){for(var i=0;i<state.pay.length;i++)if(state.pay[i].id===id)return state.pay[i];return null}

  var pendingDel=null;
  $('tbody').addEventListener('click',async function(e){
    var b=e.target.closest('button');if(!b)return;
    if(b.dataset.edit){
      var r=byId(+b.dataset.edit);if(!r)return;
      editId=r.id;$('fDate').value=r.date;$('fMethod').value=r.method;$('fSales').value=r.amount;$('fCust').value=r.cust;$('fNote').value=r.note;showDay();walterForm();
      $('btnSave').textContent='Änderung speichern';$('btnCancel').hidden=false;
      $('fSales').focus();window.scrollTo({top:$('form').offsetTop-80,behavior:'smooth'});
    }
    if(b.dataset.del){
      var id=+b.dataset.del;
      if(pendingDel===id){
        pendingDel=null;
        var r2=await sb.from('eintraege').delete().eq('user_id',user.id).eq('id',id);
        if(r2.error){flash('Löschen fehlgeschlagen: '+r2.error.message);return}
        state.pay=state.pay.filter(function(x){return x.id!==id});
        if(editId===id)resetForm();
        render();renderAuf();flash('Zahlung gelöscht.');
      } else {pendingDel=id;b.textContent='Wirklich löschen?';b.style.color='var(--warn)'}
    }
  });
  $('btnCancel').addEventListener('click',resetForm);

  $('form').addEventListener('submit',async function(e){
    e.preventDefault();
    var d=$('fDate').value,m=$('fMethod').value,s=parseFloat(String($('fSales').value).replace(',','.')),c=parseInt($('fCust').value,10);
    if(!d||METHODS.indexOf(m)<0||isNaN(s)||isNaN(c)){flash('Bitte Datum, Zahlungsart, Betrag und Kunden ausfüllen.');return}
    var o=payObj(d,m,Math.round(s*100)/100,c,$('fNote').value.trim());
    var daten=await enc(o);
    var r=editId
      ? await sb.from('eintraege').update({daten:daten}).eq('user_id',user.id).eq('id',editId).select('id').single()
      : await sb.from('eintraege').insert({user_id:user.id,daten:daten}).select('id').single();
    if(r.error){flash('Speichern fehlgeschlagen: '+r.error.message);return}
    var row=fromObj(r.data.id,o),was=editId;
    if(was)state.pay=state.pay.map(function(x){return x.id===was?row:x});else state.pay.push(row);
    var dd=parseIso(d);selY=dd.getFullYear();selM=dd.getMonth();$('selMonth').value=selM;$('selYear').value=selY;
    resetForm();render();renderAuf();
    flash((was?'Geändert: ':'Gespeichert: ')+fmtDate(d)+', '+m+', '+eur.format(s)+'.');
  });

  $('inGoal').addEventListener('change',async function(){
    var v=parseFloat(this.value);v=isNaN(v)?0:v;var k=selY+'-'+pad(selM+1);
    var daten=await enc({t:'g',m:k,z:v});
    var r=goalIds[k]
      ? await sb.from('eintraege').update({daten:daten}).eq('user_id',user.id).eq('id',goalIds[k]).select('id').single()
      : await sb.from('eintraege').insert({user_id:user.id,daten:daten}).select('id').single();
    if(r.error){flash('Ziel konnte nicht gespeichert werden: '+r.error.message);return}
    goalIds[k]=r.data.id;state.goals[k]=v;render();
  });

  // ---------- Aufträge (t:'a'): Flat, Bestellung versenden, Sonstiges ----------
  var ARTEN={flat:'Flat',versand:'Bestellung versenden',sonst:'Sonstiges'};
  var aEditId=null,aPendingDel=null;
  // Betrag (b), Zahlungsart (za) und die ids der schon übernommenen Zahlungen (zids) sind freiwillig
  function fromAuf(id,o){return {id:id,art:ARTEN[o.art]?o.art:'sonst',tg:o.tg||'',name:o.nm||'',adr:o.adr||'',von:o.von||'',bis:o.bis||'',note:o.n||'',ok:!!o.ok,okAm:o.okAm||'',
    betrag:o.b===undefined||o.b===null||o.b===''||isNaN(+o.b)?null:+o.b,za:METHODS.indexOf(o.za)>-1?o.za:'',zids:Array.isArray(o.zids)?o.zids.map(Number):[]}}
  function aufObj(a){return {t:'a',art:a.art,tg:a.tg,nm:a.name||'',adr:a.adr||'',von:a.von,bis:a.bis,n:a.note,ok:a.ok?1:0,okAm:a.okAm||'',b:a.betrag==null?'':a.betrag,za:a.za||'',zids:a.zids||[]}}
  // Betragsfeld lesen: leer = null, ungültig = NaN, sonst auf Cent gerundet
  function betragIn(v){v=String(v==null?'':v).trim().replace(',','.');if(v==='')return null;var n=parseFloat(v);return isNaN(n)||n<0?NaN:Math.round(n*100)/100}
  // Zahlungen im Umsatzbuch, die aus diesem Auftrag übernommen wurden (gelöschte fallen weg)
  function uebernommen(a){return (a.zids||[]).map(byId).filter(Boolean)}
  function fillMethods(sel,leer){
    if(leer){var o0=document.createElement('option');o0.value='';o0.textContent=leer;sel.appendChild(o0)}
    METHODS.forEach(function(m){var o=document.createElement('option');o.value=m;o.textContent=m;sel.appendChild(o)});
  }
  fillMethods($('aZa'),'später wählen');fillMethods($('extZa'),'später wählen');fillMethods($('pMethod'),'bitte wählen');
  function aById(id){for(var i=0;i<state.auf.length;i++)if(state.auf[i].id===id)return state.auf[i];return null}
  function heuteIso(){var h=new Date();return iso(h.getFullYear(),h.getMonth(),h.getDate())}
  function tageBis(s){return Math.round((parseIso(s)-parseIso(heuteIso()))/86400000)}
  function tage(n){return n===1?'1 Tag':n+' Tagen'}
  function plusTage(s,n){var d=parseIso(s);d.setDate(d.getDate()+n);return iso(d.getFullYear(),d.getMonth(),d.getDate())}
  // 1 Monat = bis zum Vortag desselben Tages im nächsten Monat (1.12. -> 31.12., 15.11. -> 14.12.)
  function bisNachMonaten(von,k){
    var d=parseIso(von),t=new Date(d.getFullYear(),d.getMonth()+k,d.getDate());
    if(t.getDate()!==d.getDate())t=new Date(d.getFullYear(),d.getMonth()+k+1,1); // z. B. 31.1. + 1 Monat
    t.setDate(t.getDate()-1);return iso(t.getFullYear(),t.getMonth(),t.getDate());
  }
  function bisFuer(von,dauer){var m=/^(\d+)([dm])$/.exec(dauer||'');if(!m||!von)return '';return m[2]==='m'?bisNachMonaten(von,+m[1]):plusTage(von,+m[1]-1)}
  // Dauer-Knöpfe (1 Woche, 1 Monat ...) und Tage-Feld setzen das Bis-Datum ab Von
  function dauerWahl(chips,von,bis,tageFeld){
    var wahl='';
    function knoepfe(){chips.querySelectorAll('[data-dauer]').forEach(function(b){b.classList.toggle('on',b.dataset.dauer===wahl)})}
    function zeige(){knoepfe();tageFeld.value=(von.value&&bis.value&&bis.value>=von.value)?Math.round((parseIso(bis.value)-parseIso(von.value))/86400000)+1:''}
    function setze(d){wahl=d;if(von.value)bis.value=bisFuer(von.value,d);zeige()}
    chips.addEventListener('click',function(e){var b=e.target.closest('[data-dauer]');if(b)setze(b.dataset.dauer)});
    ['input','change'].forEach(function(ev){
      von.addEventListener(ev,function(){if(wahl&&von.value)bis.value=bisFuer(von.value,wahl);zeige()});
      bis.addEventListener(ev,function(){wahl='';zeige()});
      tageFeld.addEventListener(ev,function(){var n=parseInt(tageFeld.value,10);wahl='';knoepfe();if(n>0&&von.value)bis.value=plusTage(von.value,n-1)});
    });
    return {setze:setze,leer:function(){wahl='';zeige()}};
  }
  var aDauer=dauerWahl($('aQuick'),$('aVon'),$('aBis'),$('aTage'));
  var extDauer=dauerWahl($('extQuick'),$('extVon'),$('extBis'),$('extTage'));

  // Ampel: rot = abgelaufen/überfällig, gelb = bald fällig, grün = Flat läuft
  function aufStatus(a){
    if(a.art==='flat'){
      if(a.von&&tageBis(a.von)>0){var v=tageBis(a.von);return {cls:'',txt:'beginnt '+(v===1?'morgen':'in '+tage(v))}}
      if(!a.bis)return {cls:'',txt:''};
      var d=tageBis(a.bis);
      if(d<0)return {cls:'red',txt:'abgelaufen seit '+(d===-1?'gestern':tage(-d))};
      if(d===0)return {cls:'gold',txt:'endet heute'};
      if(d<=3)return {cls:'gold',txt:'endet '+(d===1?'morgen':'in '+tage(d))};
      return {cls:'ok',txt:'läuft noch '+(d+1)+' Tage'};
    }
    if(!a.bis)return {cls:'',txt:''};
    var e=tageBis(a.bis);
    if(e<0)return {cls:'red',txt:'überfällig seit '+(e===-1?'gestern':tage(-e))};
    if(e===0)return {cls:'gold',txt:'heute fällig'};
    if(e===1)return {cls:'gold',txt:'morgen fällig'};
    return {cls:'',txt:'fällig in '+tage(e)};
  }
  function tgHtml(tg){
    var n=String(tg||'').trim().replace(/^@/,'');
    if(!n)return '';
    // Klick öffnet den Chat direkt in Telegram Web (Version A, im Browser), nicht in der App
    if(/^[A-Za-z0-9_]{4,32}$/.test(n))return '<a href="https://web.telegram.org/a/#?tgaddr='+encodeURIComponent('tg://resolve?domain='+n)+'" target="_blank" rel="noopener noreferrer">@'+n+'</a>';
    return '<span>'+esc(tg)+'</span>';
  }
  // In die Zwischenablage: erst der neue Weg, sonst der alte über ein unsichtbares Textfeld
  async function kopiere(t){
    try{await navigator.clipboard.writeText(t);return true}catch(e){}
    var ta=document.createElement('textarea');ta.value=t;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}ta.remove();return ok;
  }
  // Wer: Name und/oder @-Name, z. B. "Anna @anna"
  function wer(a){return [a.name,a.tg].filter(Boolean).join(' ')}
  function zeitraum(a){
    if(a.art==='flat'){
      if(a.von&&a.bis)return (a.von.slice(0,4)===a.bis.slice(0,4)?fmtDate(a.von).slice(0,6):fmtDate(a.von))+' – '+fmtDate(a.bis);
      if(a.bis)return 'bis '+fmtDate(a.bis);
      return a.von?'ab '+fmtDate(a.von):'';
    }
    return a.bis?(a.art==='versand'?'versenden bis ':'fällig am ')+fmtDate(a.bis):'';
  }
  function aufCard(a){
    var s=a.ok?{cls:'',txt:''}:aufStatus(a),z=zeitraum(a),teile=[];
    if(z)teile.push(esc(z));
    if(s.txt)teile.push('<b class="st-'+s.cls+'">'+esc(s.txt)+'</b>');
    if(a.ok&&a.okAm)teile.push('erledigt am '+fmtDate(a.okAm));
    return '<div class="auf'+(s.cls?' st-'+s.cls:'')+'">'+
      '<input type="checkbox" class="auf-chk" data-tick="'+a.id+'"'+(a.ok?' checked':'')+' aria-label="'+esc((a.ok?'Wieder offen: ':'Erledigt: ')+ARTEN[a.art]+' '+wer(a))+'">'+
      '<div class="auf-main"><div class="auf-top"><span class="badge">'+ARTEN[a.art]+'</span>'+(a.name?'<span>'+esc(a.name)+'</span>':'')+tgHtml(a.tg)+'</div>'+
      (teile.length?'<div class="auf-when">'+teile.join(' · ')+'</div>':'')+
      aufGeld(a)+
      aufSpalten(a)+'</div>'+
      '<div class="auf-act">'+(a.betrag!=null?'<button type="button" class="link" data-apay="'+a.id+'">Ins Umsatzbuch</button>':'')+
      (a.adr?'<button type="button" class="link" data-acopy="'+a.id+'">Adresse kopieren</button>':'')+
      '<button type="button" class="link" data-aedit="'+a.id+'">Ändern</button><button type="button" class="link" data-adel="'+a.id+'">Löschen</button></div></div>';
  }
  // Adresse und "Zu tun" als zwei Spalten nebeneinander (am Handy untereinander, CSS .auf-cols)
  function aufSpalten(a){
    var sp='';
    if(a.adr)sp+='<div class="auf-col"><div class="auf-h">Adresse</div><div class="auf-adr">'+esc(a.adr)+'</div></div>';
    if(a.note)sp+='<div class="auf-col"><div class="auf-h">Zu tun</div><div class="auf-note">'+esc(a.note)+'</div></div>';
    return sp?'<div class="auf-cols">'+sp+'</div>':'';
  }
  // Zeile "50,00 € · Paysafe · im Umsatzbuch am 26.11."
  function aufGeld(a){
    var ub=uebernommen(a),t=[];
    if(a.betrag!=null)t.push('<b class="num">'+eur.format(a.betrag)+'</b>');
    if(a.za)t.push(esc(a.za));
    if(ub.length)t.push('<span class="ub">im Umsatzbuch am '+ub.map(function(p){return fmtDate(p.date).slice(0,6)}).join(', ')+'</span>');
    return t.length?'<div class="auf-geld">'+t.join(' · ')+'</div>':'';
  }
  function renderAuf(){
    // Offene nach Fälligkeit (ohne Datum ans Ende), Erledigte: zuletzt abgehakte oben
    var open=state.auf.filter(function(a){return !a.ok}).sort(function(x,y){var a=x.bis||'9999',b=y.bis||'9999';return a<b?-1:a>b?1:x.id-y.id});
    var done=state.auf.filter(function(a){return a.ok}).sort(function(x,y){return x.okAm<y.okAm?1:x.okAm>y.okAm?-1:y.id-x.id});
    aPendingDel=null;
    $('aOpen').innerHTML=open.length?open.map(aufCard).join(''):'<div class="empty">Nichts zu erledigen.</div>';
    $('aDone').innerHTML=done.length?done.map(aufCard).join(''):'<div class="empty">Noch nichts erledigt.</div>';
    $('aDoneCnt').textContent=done.length;
    $('aOpenCnt').textContent=open.length;
    var rot=0,gelb=0;open.forEach(function(a){var c=aufStatus(a).cls;if(c==='red')rot++;else if(c==='gold')gelb++});
    var t=[];if(rot)t.push(rot+' abgelaufen oder überfällig');if(gelb)t.push(gelb+' bald fällig');
    $('aOpenSub').textContent=t.length?t.join(' · '):(open.length?'Nichts dringend.':'');
    $('selView').options[1].textContent='Aufträge'+(open.length?' ('+open.length+')':'');
  }

  function aFormArt(){
    var art=$('aArt').value;
    $('aVonWrap').hidden=art!=='flat';$('aQuick').hidden=art!=='flat';
    $('aBisLabel').textContent=art==='flat'?'Bis':art==='versand'?'Versenden bis':'Fällig am';
    $('aVon').required=art==='flat';$('aBis').required=art==='flat';
  }
  function aReset(){
    aEditId=null;$('aTg').value='';$('aName').value='';$('aAdr').value='';$('aVon').value=heuteIso();$('aBis').value='';$('aNote').value='';$('aBetrag').value='';$('aZa').value='';
    $('aSave').textContent='Speichern';$('aCancel').hidden=true;aFormArt();aDauer.leer();
  }
  async function aSpeichern(a){
    var daten=await enc(aufObj(a));
    var r=a.id
      ? await sb.from('eintraege').update({daten:daten}).eq('user_id',user.id).eq('id',a.id).select('id').single()
      : await sb.from('eintraege').insert({user_id:user.id,daten:daten}).select('id').single();
    if(r.error){flash('Speichern fehlgeschlagen: '+r.error.message,$('aMsg'));return false}
    if(a.id)state.auf=state.auf.map(function(x){return x.id===a.id?a:x});else{a.id=r.data.id;state.auf.push(a)}
    return true;
  }
  $('aArt').addEventListener('change',aFormArt);
  $('aCancel').addEventListener('click',aReset);
  $('aForm').addEventListener('submit',async function(e){
    e.preventDefault();
    var art=$('aArt').value,tg=$('aTg').value.trim(),von=art==='flat'?$('aVon').value:'',bis=$('aBis').value,n=$('aNote').value.trim();
    var name=$('aName').value.trim(),adr=$('aAdr').value.trim();
    if(!ARTEN[art])return;
    if(art==='flat'&&(!von||!bis)){flash('Bitte bei der Flat Von und Bis eintragen.',$('aMsg'));return}
    if(art==='flat'&&bis<von){flash('Das Ende liegt vor dem Beginn.',$('aMsg'));return}
    // Name, @-Name und Adresse sind freiwillig, aber irgendetwas muss zeigen, worum es geht
    if(!tg&&!name&&!adr&&!n){flash('Bitte Name, Telegram-Name oder was zu tun ist eintragen.',$('aMsg'));return}
    var betrag=betragIn($('aBetrag').value);
    if(isNaN(betrag)){flash('Der Betrag stimmt nicht.',$('aMsg'));return}
    var alt=aEditId?aById(aEditId):null;
    var a={id:alt?alt.id:null,art:art,tg:tg,name:name,adr:adr,von:von,bis:bis,note:n,ok:alt?alt.ok:false,okAm:alt?alt.okAm:'',betrag:betrag,za:$('aZa').value,zids:alt?alt.zids:[]};
    if(!(await aSpeichern(a)))return;
    aReset();renderAuf();
    flash((alt?'Geändert: ':'Gespeichert: ')+ARTEN[art]+(wer(a)?' '+wer(a):'')+'.',$('aMsg'));
  });
  // Abhaken: rutscht nach unten zu "Erledigt"; dort wieder entfernen = wieder offen.
  // Bei einer Flat fragt erst ein Fenster, ob sie verlängert wird.
  async function abhaken(a,ok,c,still){
    var neu=Object.assign({},a,{ok:ok,okAm:ok?heuteIso():''});
    if(c)c.disabled=true;
    if(!(await aSpeichern(neu))){if(c){c.checked=!ok;c.disabled=false}return false}
    if(aEditId===a.id)aReset();
    renderAuf();
    if(!still)flash((ok?'Erledigt: ':'Wieder offen: ')+ARTEN[a.art]+(wer(a)?' '+wer(a):'')+'.',$('aMsg'));
    return true;
  }
  $('viewAuftraege').addEventListener('change',async function(e){
    var c=e.target;if(!c.dataset||!c.dataset.tick)return;
    var a=aById(+c.dataset.tick);if(!a)return;
    if(c.checked&&a.art==='flat'){extOeffnen(a,c);return}
    await abhaken(a,c.checked,c);
  });

  // Verlängern-Fenster: neue Flat schließt an die alte an (oder ab heute, wenn sie schon abgelaufen ist)
  var ext=null;
  function extOeffnen(a,c){
    ext={a:a,c:c};
    var start=a.bis?plusTage(a.bis,1):heuteIso();if(start<heuteIso())start=heuteIso();
    $('extText').textContent=(wer(a)||'Flat')+(zeitraum(a)?' · bisher '+zeitraum(a):'');
    $('extVon').value=start;$('extBis').value='';$('extMsg').textContent='';
    $('extBetrag').value=a.betrag!=null?a.betrag:'';$('extZa').value=a.za||'';$('extPay').checked=false;
    extDauer.setze('1m');
    $('extDlg').showModal();
  }
  function extZu(){var e=ext;ext=null;if($('extDlg').open)$('extDlg').close();return e}
  $('extAbbr').addEventListener('click',function(){var e=extZu();if(e)e.c.checked=false});
  $('extDlg').addEventListener('cancel',function(){if(ext){ext.c.checked=false;ext=null}});
  $('extNur').addEventListener('click',async function(){var e=extZu();if(e)await abhaken(e.a,true,e.c)});
  $('extForm').addEventListener('submit',async function(ev){
    ev.preventDefault();if(!ext)return;
    var von=$('extVon').value,bis=$('extBis').value;
    if(!von||!bis){$('extMsg').textContent='Bitte Von und Bis wählen.';return}
    if(bis<von){$('extMsg').textContent='Das Ende liegt vor dem Beginn.';return}
    var betrag=betragIn($('extBetrag').value),za=$('extZa').value,mitZahlung=$('extPay').checked;
    if(isNaN(betrag)){$('extMsg').textContent='Der Betrag stimmt nicht.';return}
    if(mitZahlung&&betrag==null){$('extMsg').textContent='Für die Zahlung bitte den Betrag eintragen.';return}
    if(mitZahlung&&!za){$('extMsg').textContent='Für die Zahlung bitte die Zahlungsart wählen.';return}
    var e=extZu();
    if(!(await abhaken(e.a,true,e.c,true)))return;
    var neu={id:null,art:'flat',tg:e.a.tg,name:e.a.name,adr:e.a.adr,von:von,bis:bis,note:e.a.note,ok:false,okAm:'',betrag:betrag,za:za,zids:[]};
    // Häkchen gesetzt: Zahlung heute mit 1 Kunde eintragen und im neuen Auftrag merken
    var pid=null;
    if(mitZahlung){pid=await zahlungNeu(payObj(heuteIso(),za,betrag,1,zahlNotiz(neu)));if(pid!=null)neu.zids=[pid]}
    if(!(await aSpeichern(neu))){renderAuf();return}
    renderAuf();
    var t='Verlängert: '+(wer(e.a)||'Flat')+' '+zeitraum(neu)+'.';
    if(mitZahlung)t+=pid!=null?' '+eur.format(betrag)+' ist im Umsatzbuch.':' Die Zahlung konnte aber nicht gespeichert werden.';
    flash(t,$('aMsg'));
  });

  // Ins Umsatzbuch übernehmen: kleines Fenster, alles vorausgefüllt und änderbar.
  // Der Auftrag merkt sich die Zahlung (zids); nochmal übernehmen geht, mit Hinweis.
  function zahlNotiz(a){return ARTEN[a.art]+(wer(a)?' '+wer(a):'')+(a.art==='flat'&&zeitraum(a)?' '+zeitraum(a):'')}
  async function zahlungNeu(o,msgEl){
    var r=await sb.from('eintraege').insert({user_id:user.id,daten:await enc(o)}).select('id').single();
    if(r.error){flash('Zahlung nicht gespeichert: '+r.error.message,msgEl||$('aMsg'));return null}
    state.pay.push(fromObj(r.data.id,o));
    var dd=parseIso(o.d);selY=dd.getFullYear();selM=dd.getMonth();$('selMonth').value=selM;$('selYear').value=selY;
    render();return r.data.id;
  }
  var payA=null;
  function payOeffnen(a){
    payA=a;var ub=uebernommen(a);
    $('payText').textContent=ARTEN[a.art]+(wer(a)?' '+wer(a):'')+(zeitraum(a)?' · '+zeitraum(a):'');
    $('paySchon').hidden=!ub.length;
    $('paySchon').textContent=ub.length?'Schon übernommen: '+ub.map(function(p){return fmtDate(p.date)+' ('+eur.format(p.amount)+')'}).join(', ')+'. Speichern trägt die Zahlung noch einmal ein.':'';
    $('pDate').value=heuteIso();$('pMethod').value=a.za||'';$('pSales').value=a.betrag!=null?a.betrag:'';
    $('pCust').value='1';$('pNote').value=zahlNotiz(a);$('payMsg').textContent='';$('paySave').disabled=false;
    walterPay();$('payDlg').showModal();
  }
  function payZu(){payA=null;if($('payDlg').open)$('payDlg').close()}
  $('payAbbr').addEventListener('click',payZu);
  $('payDlg').addEventListener('cancel',function(){payA=null});
  $('payForm').addEventListener('submit',async function(ev){
    ev.preventDefault();if(!payA)return;
    var d=$('pDate').value,m=$('pMethod').value,s=betragIn($('pSales').value),c=parseInt($('pCust').value,10);
    if(!d||METHODS.indexOf(m)<0||s==null||isNaN(s)||isNaN(c)||c<0){$('payMsg').textContent='Bitte Datum, Zahlungsart, Betrag und Kunden ausfüllen.';return}
    $('paySave').disabled=true;
    var o=payObj(d,m,s,c,$('pNote').value.trim());
    var id=await zahlungNeu(o,$('payMsg'));
    if(id==null){$('paySave').disabled=false;return}
    var a=aById(payA.id)||payA;payZu();
    var neu=Object.assign({},a,{zids:(a.zids||[]).concat(id)});
    if(!(await aSpeichern(neu))){renderAuf();flash('Zahlung ist im Umsatzbuch, aber der Auftrag konnte sich das nicht merken.',$('aMsg'));return}
    renderAuf();
    flash('Ins Umsatzbuch übernommen: '+fmtDate(d)+', '+m+', '+eur.format(s)+'.',$('aMsg'));
  });
  $('viewAuftraege').addEventListener('click',async function(e){
    var b=e.target.closest('button[data-aedit],button[data-adel],button[data-apay],button[data-acopy]');if(!b)return;
    if(b.dataset.apay){var ap=aById(+b.dataset.apay);if(ap)payOeffnen(ap);return}
    if(b.dataset.acopy){
      var ac=aById(+b.dataset.acopy);if(!ac)return;
      flash(await kopiere(ac.adr)?'Adresse kopiert.':'Kopieren ging nicht. Bitte die Adresse mit dem Finger markieren.',$('aMsg'));
      return;
    }
    if(b.dataset.aedit){
      var a=aById(+b.dataset.aedit);if(!a)return;
      aEditId=a.id;$('aArt').value=a.art;aFormArt();
      $('aName').value=a.name;$('aAdr').value=a.adr;$('aTg').value=a.tg;$('aVon').value=a.von;$('aBis').value=a.bis;$('aNote').value=a.note;aDauer.leer();
      $('aBetrag').value=a.betrag!=null?a.betrag:'';$('aZa').value=a.za;
      $('aSave').textContent='Änderung speichern';$('aCancel').hidden=false;
      $('aName').focus();window.scrollTo({top:$('aForm').offsetTop-80,behavior:'smooth'});
      return;
    }
    // Löschen: die aus diesem Auftrag übernommenen Zahlungen werden im Umsatzbuch mitgelöscht
    var id=+b.dataset.adel,ad=aById(id),ub=ad?uebernommen(ad):[],ubSum=0;
    ub.forEach(function(p){ubSum+=p.amount});
    if(aPendingDel===id){
      aPendingDel=null;
      if(ub.length){
        var pids=ub.map(function(p){return p.id});
        var rz=await sb.from('eintraege').delete().eq('user_id',user.id).in('id',pids);
        if(rz.error){flash('Löschen fehlgeschlagen: '+rz.error.message,$('aMsg'));return}
        state.pay=state.pay.filter(function(x){return pids.indexOf(x.id)<0});
        if(pids.indexOf(editId)>-1)resetForm();
        render();
      }
      var r=await sb.from('eintraege').delete().eq('user_id',user.id).eq('id',id);
      if(r.error){flash('Löschen fehlgeschlagen: '+r.error.message,$('aMsg'));renderAuf();return}
      state.auf=state.auf.filter(function(x){return x.id!==id});
      if(aEditId===id)aReset();
      renderAuf();
      flash('Auftrag gelöscht'+(ub.length?', dazu im Umsatzbuch '+(ub.length===1?'1 Zahlung':ub.length+' Zahlungen')+' ('+eur.format(ubSum)+')':'')+'.',$('aMsg'));
    } else {aPendingDel=id;b.textContent=ub.length?'Wirklich löschen? Auch '+eur.format(ubSum)+' im Umsatzbuch':'Wirklich löschen?';b.style.color='var(--warn)'}
  });

  // Umschalten oben links: Umsatzbuch / Aufträge (Auswahl bleibt für diesen Tab)
  function setView(v){
    if(v!=='auftraege')v='umsatz';
    $('selView').value=v;
    $('viewUmsatz').hidden=v!=='umsatz';$('viewAuftraege').hidden=v!=='auftraege';$('monthCtl').hidden=v!=='umsatz';
    $('viewSub').textContent=v==='umsatz'?'Zahlungen eintragen, Monat auf einen Blick.':'Flats, Bestellungen und Erinnerungen. Abhaken, wenn erledigt.';
    document.title=v==='umsatz'?'Umsatzbuch':'Aufträge';
    try{sessionStorage.setItem('ub-ansicht',v)}catch(e){}
  }
  $('selView').addEventListener('change',function(){setView(this.value);window.scrollTo(0,0)});
  var startView='umsatz';try{startView=sessionStorage.getItem('ub-ansicht')||'umsatz'}catch(e){}
  setView(startView);aReset();renderAuf();

  // Nachtragen: Excel-Zeilen (Datum, Zahlungsart, Betrag, Kunden) oder Notizen wie
  //   Überweisung Gesamt: 40,00€ / Amazon Gesamt: 25€ / 03.02.26 Tagesumsatz: 65,00€
  function num(s){s=String(s||'').replace(/[€\s]/g,'');if(/^\d{1,3}(\.\d{3})+$/.test(s))s=s.replace(/\./g,'');else if(s.indexOf(',')>-1)s=s.replace(/\./g,'').replace(',','.');return parseFloat(s)}
  function dateIn(s){
    var m=String(s||'').match(/(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?!\d)/);
    if(m){var y=+m[3];if(y<100)y+=2000;var d=+m[1],mo=+m[2];if(mo>=1&&mo<=12&&d>=1&&d<=31)return iso(y,mo-1,d)}
    m=String(s||'').match(/(\d{4})-(\d{2})-(\d{2})/);return m?m[0]:null;
  }
  function toMethod(s){
    s=String(s||'').toLowerCase();
    if(s.indexOf('amazon')>-1)return METHODS[0];
    if(s.indexOf('paysafe')>-1)return METHODS[1];
    if(s.indexOf('überw')>-1||s.indexOf('ueberw')>-1||s.indexOf('uberw')>-1)return METHODS[2];
    return null;
  }
  // letzter Geldbetrag in der Zeile, Datum vorher entfernen
  function amountIn(s){
    s=String(s||'').replace(/\d{1,2}\.\d{1,2}\.\d{2,4}/g,' ').replace(/\d+\s*kund\w*/ig,' ');
    var all=s.match(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/g);
    return all?num(all[all.length-1]):NaN;
  }
  function custIn(s){var m=String(s||'').match(/(\d+)\s*kund/i);return m?+m[1]:null}
  function parseImport(text){
    var out={rows:[],issues:[],checks:[]},pending=[],cur=null;
    function add(d,p){out.rows.push({datum:d,zahlungsart:p.method,betrag:Math.round(p.amount*100)/100,kunden:p.cust===null?0:p.cust,zeile:p.line})}
    text.split(/\r?\n/).forEach(function(raw,i){
      var l=raw.trim(),n=i+1;if(!l)return;
      var f=l.split(/\t|;/);
      if(f.length>=3){ // Excel-Zeile
        if(/^(datum|zahlungsart|betrag)/i.test(f[0].trim()))return; // Überschrift
        var d=dateIn(f[0]),m=toMethod(f[1]),s=num(f[2]),c=f[3]===undefined||String(f[3]).trim()===''?null:parseInt(f[3],10);
        if(d&&m&&!isNaN(s))add(d,{method:m,amount:s,cust:c===null?1:c,line:n});else out.issues.push({line:n,text:l,msg:'nicht erkannt'});
        return;
      }
      var d2=dateIn(l),m2=toMethod(l),a=amountIn(l);
      if(m2){ // Zahlungsart-Zeile
        if(isNaN(a)){out.issues.push({line:n,text:l,msg:'kein Betrag gefunden'});return}
        var p={method:m2,amount:a,cust:custIn(l),line:n};
        if(d2)add(d2,p);else if(cur)add(cur,p);else pending.push(p);
        return;
      }
      if(d2){ // Datumszeile, ggf. mit Tagesumsatz
        if(pending.length){
          var sum=0;pending.forEach(function(p){add(d2,p);sum+=p.amount});
          if(!isNaN(a))out.checks.push({datum:d2,summe:Math.round(sum*100)/100,tages:a});
          pending=[];cur=null;
        } else cur=d2;
        return;
      }
      if(/^(datum|zahlungsart|betrag)/i.test(l))return; // Überschrift
      out.issues.push({line:n,text:l,msg:'nicht erkannt'});
    });
    pending.forEach(function(p){out.issues.push({line:p.line,text:p.method+' '+p.amount,msg:'kein Datum gefunden'})});
    return out;
  }
  var importRows=[];
  function sameExists(r){return state.pay.some(function(p){return p.date===r.datum&&p.method===r.zahlungsart&&Math.abs(p.amount-r.betrag)<0.005})}
  $('btnImport').addEventListener('click',function(){
    var res=parseImport($('paste').value),h=[];
    importRows=res.rows.filter(function(r){return !sameExists(r)});
    var dup=res.rows.length-importRows.length;
    if(!res.rows.length&&!res.issues.length){$('impPreview').hidden=true;flash('Das Feld ist leer.',$('impMsg'));return}
    if(res.rows.length){
      h.push('<table class="prev"><thead><tr><th>Datum</th><th>Zahlungsart</th><th class="r">Betrag</th><th class="r">Kunden</th><th></th></tr></thead><tbody>');
      res.rows.forEach(function(r){
        var d=sameExists(r);
        h.push('<tr'+(d?' class="skip"':'')+'><td class="num">'+fmtDate(r.datum)+'</td><td>'+r.zahlungsart+'</td><td class="r num">'+eur.format(r.betrag)+'</td><td class="r num">'+(r.kunden||'-')+'</td><td>'+(d?'schon vorhanden, wird übersprungen':'')+'</td></tr>');
      });
      h.push('</tbody></table>');
    }
    var warn=[];
    res.checks.forEach(function(c){
      if(Math.abs(c.summe-c.tages)>=0.005)warn.push('Am '+fmtDate(c.datum)+' ergeben die Zahlungsarten '+eur.format(c.summe)+', als Tagesumsatz steht aber '+eur.format(c.tages)+'. Bitte prüfen.');
      else warn.push('Am '+fmtDate(c.datum)+' stimmt die Summe mit dem Tagesumsatz überein ('+eur.format(c.tages)+').');
    });
    res.issues.forEach(function(x){warn.push('Zeile '+x.line+' ('+esc(x.text)+'): '+x.msg+'.')});
    if(res.rows.some(function(r){return !r.kunden}))warn.push('Für Zeilen ohne Kundenzahl wird 0 gespeichert. Die Zahl lässt sich danach über „Ändern“ nachtragen.');
    if(warn.length)h.push('<ul class="prev-notes">'+warn.map(function(w){return '<li>'+w+'</li>'}).join('')+'</ul>');
    $('impPreview').innerHTML=h.join('');$('impPreview').hidden=false;
    $('btnImportSave').hidden=!importRows.length;
    $('btnImportSave').textContent=importRows.length===1?'1 Zahlung speichern':importRows.length+' Zahlungen speichern';
    $('impMsg').textContent=importRows.length?'':(dup?'Alles schon vorhanden.':'Nichts zum Speichern erkannt.');
  });
  $('paste').addEventListener('input',function(){importRows=[];$('btnImportSave').hidden=true;$('impPreview').hidden=true});
  $('btnImportSave').addEventListener('click',async function(){
    if(!importRows.length)return;
    var objs=importRows.map(function(r){return payObj(r.datum,r.zahlungsart,r.betrag,r.kunden,'')});
    var rows=[];for(var i=0;i<objs.length;i++)rows.push({user_id:user.id,daten:await enc(objs[i])});
    var r=await sb.from('eintraege').insert(rows).select('id');
    if(r.error){flash('Speichern fehlgeschlagen: '+r.error.message,$('impMsg'));return}
    r.data.forEach(function(x,i){state.pay.push(fromObj(x.id,objs[i]))});
    var last=parseIso(objs[objs.length-1].d);selY=last.getFullYear();selM=last.getMonth();$('selMonth').value=selM;$('selYear').value=selY;
    importRows=[];$('paste').value='';$('impPreview').hidden=true;$('btnImportSave').hidden=true;
    render();flash(rows.length+(rows.length===1?' Zahlung':' Zahlungen')+' gespeichert.',$('impMsg'));
  });
})();
