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

  var state={pay:[],goals:{}},goalIds={};
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
    else{try{sessionStorage.removeItem('ub-aktiv')}catch(e){}KEY=null;tresor=null;$('app').hidden=true;$('unlock').hidden=true;$('login').hidden=false;state={pay:[],goals:{}};goalIds={}}
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

  // Einträge als verschlüsselte Objekte: t:'z' Zahlung, t:'g' Monatsziel
  function payObj(d,m,b,k,n){return {t:'z',d:d,a:m,b:b,k:k,n:n||''}}
  function fromObj(id,o){return {id:id,date:o.d,method:o.a,amount:+o.b,cust:+o.k,note:o.n||''}}

  async function loadAll(){
    $('app').classList.add('loading');
    var a=await sb.from('eintraege').select('id,daten').order('id');
    if(a.error){$('app').classList.remove('loading');flash('Daten konnten nicht geladen werden: '+a.error.message);return}
    var pay=[],goals={},gids={},bad=0;
    for(var i=0;i<a.data.length;i++){
      var r=a.data[i];
      try{var o=await dec(r.daten);if(o.t==='z')pay.push(fromObj(r.id,o));else if(o.t==='g'){goals[o.m]=+o.z;gids[o.m]=r.id}}catch(e){bad++}
    }
    state.pay=pay;state.goals=goals;goalIds=gids;
    $('app').classList.remove('loading');
    render();
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

  // Sicherung als CSV (entschlüsselt, nur auf diesem Gerät)
  $('btnExport').addEventListener('click',function(){
    var lines=['Datum;Zahlungsart;Betrag;Kunden;Notiz'];
    state.pay.slice().sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:a.id-b.id}).forEach(function(p){
      lines.push([fmtDate(p.date),p.method,p.amount.toFixed(2).replace('.',','),p.cust,'"'+String(p.note).replace(/"/g,'""')+'"'].join(';'));
    });
    var blob=new Blob(['﻿'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download='umsatzbuch-sicherung-'+iso(now.getFullYear(),now.getMonth(),now.getDate())+'.csv';
    document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href)},1000);
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
    $('btnSave').textContent='Speichern';$('btnCancel').hidden=true;
  }
  $('fDate').value=iso(now.getFullYear(),now.getMonth(),now.getDate());
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
  function cmp(cur,prev,fmt){
    if(!prev) return 'Vormonat: keine Daten';
    var p=(cur-prev)/prev*100;
    return '<span class="'+(p>=0?'up':'down')+'">'+(p>=0?'+':'')+p.toFixed(1).replace('.',',')+' %</span> zum Vormonat ('+fmt(prev)+')';
  }

  function render(){
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
        var d=parseIso(r.date);
        return '<tr><td class="c-date num">'+fmtDate(r.date)+'</td><td class="c-day">'+WD[d.getDay()]+'</td><td class="c-method">'+esc(r.method)+'</td><td class="r num c-amount">'+eur.format(r.amount)+'</td><td class="r num c-cust">'+r.cust+(r.cust===1?' Kunde':' Kunden')+'</td><td class="c-note">'+esc(r.note)+'</td><td class="r c-act"><button type="button" class="link" data-edit="'+r.id+'">Ändern</button><button type="button" class="link" data-del="'+r.id+'">Löschen</button></td></tr>';
      }).join('')+'<tr class="sum"><td colspan="3" class="c-date">Summe '+MONTHS[selM]+'</td><td class="r num c-amount">'+eur.format(t.sales)+'</td><td class="r num c-cust">'+int.format(t.cust)+' Kunden</td><td colspan="2" class="c-act"></td></tr>';
    }
  }

  function flash(t,el){el=el||$('msg');el.textContent=t;clearTimeout(el._t);el._t=setTimeout(function(){el.textContent=''},4000)}
  function byId(id){for(var i=0;i<state.pay.length;i++)if(state.pay[i].id===id)return state.pay[i];return null}

  var pendingDel=null;
  $('tbody').addEventListener('click',async function(e){
    var b=e.target.closest('button');if(!b)return;
    if(b.dataset.edit){
      var r=byId(+b.dataset.edit);if(!r)return;
      editId=r.id;$('fDate').value=r.date;$('fMethod').value=r.method;$('fSales').value=r.amount;$('fCust').value=r.cust;$('fNote').value=r.note;
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
        render();flash('Zahlung gelöscht.');
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
    resetForm();render();
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
