(function(){
  if(window.__tux&&window.__tux.__v>=7){console.log('%c[图寻] v'+window.__tux.__v+' already loaded','color:#fc6');return;}
  var API='/api/v0/tuxun';
  var S={gameId:null,gameType:null,apiType:'game',roundId:null,panoId:null,source:null,
         lat:null,lng:null,via:null,done:false,busy:false,status:'',lastResult:null,src:null};
  var CFG={auto:false,delay:2000};
  try{var c=JSON.parse(localStorage.getItem('tuxunAuto')||'null');if(c)CFG=c;}catch(e){}
  var CACHE={}; // panoId -> {lat,lng,via}
  var L=function(){console.log.apply(console,['%c[图寻]','color:#2b6;font-weight:700'].concat([].slice.call(arguments)));};
  function save(){try{localStorage.setItem('tuxunAuto',JSON.stringify(CFG));}catch(e){}}

  function apiTypeOf(t){
    if(!t)return 'game';
    if(['team','team_match','solo','solo_match','battle_royale','rank','party'].indexOf(t)>=0)return 'game';
    if(['daily_challenge','challenge'].indexOf(t)>=0)return 'challenge';
    if(['map_country_streak','province_streak','country_streak'].indexOf(t)>=0)return 'streak';
    if(t==='infinity')return 'infinity';
    return 'game';
  }

  // ---- gameId from URL: /party/<id> or /solo/<id> ----
  function idFromUrl(){
    var m=location.pathname.match(/\/(?:party|solo|challenge|game)\/([0-9a-fA-F-]{20,})/);
    return m?m[1]:null;
  }

  function absorb(g,srcLabel){
    if(!g||!g.rounds||!g.rounds.length)return false;
    var id=g.gameId||g.id;
    if(id)S.gameId=id;
    if(g.type){S.gameType=g.type;S.apiType=apiTypeOf(g.type);}
    var r=g.rounds[g.rounds.length-1];
    if(r.round!==S.roundId){
      S.roundId=r.round;S.done=false;S.lat=S.lng=null;S.via=null;S.status='';
      L('-- round',r.round,'-- ('+(srcLabel||'?')+')');
    }
    if(r.source)S.source=r.source;
    if(r.panoId&&r.panoId!==S.panoId){
      S.panoId=r.panoId;L('pano',r.panoId,r.source);
      if(CACHE[r.panoId]){S.lat=CACHE[r.panoId].lat;S.lng=CACHE[r.panoId].lng;S.via='cache';L('cached coords',S.lat,S.lng);}
    }
    if(g.status&&g.status!=='ongoing')return false;
    if(r.endTime&&Date.now()>r.endTime)return false;
    if(CFG.auto&&!S.done&&!S.busy)queue();
    return true;
  }

  // ---- REST poll: /solo/get?gameId= (this is what getGameInfo uses) ----
  function pollOnce(){
    var gid=S.gameId||idFromUrl();
    if(!gid)return Promise.resolve(false);
    var eps=[S.apiType==='game'?'solo/get':'party/get','solo/get','party/get','game/getContent'];
    return (function nx(i){
      if(i>=eps.length)return Promise.resolve(false);
      var ep=eps[i];
      return fetch(API+'/'+ep+'?gameId='+encodeURIComponent(gid),{credentials:'include'})
        .then(function(r){return r.json()})
        .then(function(j){
          if(j&&j.success&&j.data&&j.data.rounds&&j.data.rounds.length){
            S.src=ep; absorb(j.data,ep); return true;
          }
          return nx(i+1);
        })
        .catch(function(){return nx(i+1)});
    })(0);
  }

  // ---- hooks (still useful if they land in time) ----
  try{
    var XO=XMLHttpRequest.prototype.open,XS=XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open=function(m,u){this.__u=u;return XO.apply(this,arguments);};
    XMLHttpRequest.prototype.send=function(){var s=this;this.addEventListener('load',function(){
      try{var u=String(s.__u||'');if(!/\/v0\/tuxun\//.test(u))return;
        if(/\/pin\?|\/guess\?/.test(u)){L('REST',u.split('/v0/tuxun')[1].slice(0,80));return;}
        var t=s.responseText;if(!t||t.length>4e6||!/rounds|panoId/.test(t))return;
        var j=JSON.parse(t);if(j&&j.data)absorb(j.data,'xhr');}catch(e){}});
      return XS.apply(this,arguments);};
  }catch(e){}

  try{
    var W0=WebSocket;
    function HS(u,p){var w=p?new W0(u,p):new W0(u);
      w.addEventListener('message',function(ev){try{
        var m=JSON.parse(ev.data);if(!m||m.scope!=='tuxun_game')return;
        var d=m.data||{},g=d.game||d;
        if(d.code==='round_end')readResult(g);
        absorb(g,'ws');
      }catch(e){}});
      return w;}
    HS.prototype=W0.prototype;['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k){HS[k]=W0[k]});
    window.WebSocket=HS;
  }catch(e){}

  function distKm(a,b,c,d){
    var R=6371,p=Math.PI/180,dLat=(c-a)*p,dLng=(d-b)*p;
    var x=Math.sin(dLat/2)**2+Math.cos(a*p)*Math.cos(c*p)*Math.sin(dLng/2)**2;
    return 2*R*Math.asin(Math.sqrt(x));
  }
  function readResult(g){
    try{var r=g&&g.rounds&&g.rounds[g.rounds.length-1];if(!r||r.lat==null)return;
      S.lastResult={round:r.round,lat:r.lat,lng:r.lng};
      if(S.lat!=null){var d=distKm(S.lat,S.lng,r.lat,r.lng);S.lastResult.distKm=+d.toFixed(3);
        L('RESULT r'+r.round,'dist',S.lastResult.distKm+'km');}
    }catch(e){}
  }

  // ---- solve ----
  function queue(){if(S.done||S.busy||!S.panoId)return;solve();}
  function solve(){
    if(S.lat!=null&&S.lng!=null){if(CFG.auto)submit();return;}
    if(!S.panoId){S.status='no panoId yet';L(S.status,'- polling '+(S.src||'rest'));pollOnce().then(function(ok){if(ok&&S.panoId)solve();});return;}
    var pid=S.panoId;
    S.busy=true;S.status='solving...';
    var src=S.source||'google_pano';
    var eps=src==='qq_pano'?['getQQPanoInfo','getPanoInfo','getTuxunPanoInfo']
          :src==='tuxun_pano'?['getTuxunPanoInfo','getPanoInfo','getQQPanoInfo']
          :['getPanoInfo','getQQPanoInfo','getTuxunPanoInfo'];
    (function nx(i){
      if(i>=eps.length){S.busy=false;S.status='proxies null';L('all proxies null',pid);return;}
      var ep=eps[i];
      fetch(API+'/mapProxy/'+ep+'?pano='+encodeURIComponent(pid),{credentials:'include'})
      .then(function(r){return r.json()}).then(function(j){
        var d=j&&j.data;
        if(d&&d.lat!=null&&d.lng!=null){
          S.lat=d.lat;S.lng=d.lng;S.via=ep;S.busy=false;S.status='coords via '+ep;
          CACHE[pid]={lat:d.lat,lng:d.lng,via:ep};
          L('COORDS',d.lat,d.lng,'via',ep);
          if(CFG.auto)submit();
          return;
        }
        nx(i+1);
      }).catch(function(e){L(ep,'err',e.message);nx(i+1)});
    })(0);
  }

  // ---- submit ----
  function get(path,params){
    var qs=Object.keys(params).map(function(k){return k+'='+encodeURIComponent(params[k]);}).join('&');
    return fetch(API+'/'+path+'?'+qs,{credentials:'include'}).then(function(r){return r.json();});
  }
  function submit(){
    if(S.lat==null||S.done)return;
    if(!S.gameId){S.gameId=idFromUrl();}
    if(!S.gameId){L('no gameId');return;}
    var lat=S.lat,lng=S.lng,delay=Math.max(0,CFG.delay||0),t=S.apiType;
    S.status='submitting in '+delay+'ms';L(S.status,'type='+t);
    setTimeout(function(){
      if(S.done)return;
      get(t+'/pin',{type:t,gameId:S.gameId,lat:lat,lng:lng})
      .then(function(j){L('pin ->',JSON.stringify(j).slice(0,110));
        return get(t+'/guess',{type:t,gameId:S.gameId,lat:lat,lng:lng});})
      .then(function(j){S.done=true;S.status='submitted';
        L('guess ->',JSON.stringify(j).slice(0,180));})
      .catch(function(e){S.status='err: '+e.message;L('submit err',e.message);});
    },delay);
  }

  // ---- main loop: REST poll keeps state fresh without socket timing ----
  var tick=setInterval(function(){
    try{
      if(!S.gameId)S.gameId=idFromUrl();
      if(CFG.auto&&!S.done){pollOnce();}
    }catch(e){}
  },1500);

  window.__tux={__v:7,S:S,CFG:CFG,CACHE:CACHE,solve:solve,submit:submit,queue:queue,save:save,poll:pollOnce,
    arm:function(d){CFG.auto=true;if(d)CFG.delay=d;save();L('AUTO ARMED',JSON.stringify(CFG),'gameId='+(S.gameId||idFromUrl()));pollOnce();},
    disarm:function(){CFG.auto=false;save();L('auto off');},
    stop:function(){clearInterval(tick);L('polling stopped');}};

  L('ready v7 — REST polling. __tux.arm() to start, __tux.poll() to test one fetch');
  if(CFG.auto)pollOnce();
})();