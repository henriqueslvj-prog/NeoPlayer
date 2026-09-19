import React, {useEffect, useMemo, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import Hls from "hls.js";
import {
  Search, Home, Tv, Film, Layers3, Star, Clock3, Settings, Plus,
  Play, Pause, Volume2, VolumeX, Maximize, Minimize, X, ChevronRight,
  Trash2, Link2, Upload, Menu, SlidersHorizontal, RefreshCw, Info, Eye, EyeOff, CheckCircle2
} from "lucide-react";
import "./styles.css";

const STORE = "neoplayer-v3";
const DB_NAME = "NeoPlayerDB";
const DB_VERSION = 1;
const EMPTY_STORE = {playlists:[], active:null, favorites:[], history:[]};

function openDB(){
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){ reject(new Error("IndexedDB não disponível neste navegador.")); return; }
    const req=indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("app")) db.createObjectStore("app",{keyPath:"key"});
      if(!db.objectStoreNames.contains("playlists")) db.createObjectStore("playlists",{keyPath:"id"});
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}

async function readStore(){
  try{
    const db=await openDB();
    const value=await new Promise((resolve,reject)=>{
      const tx=db.transaction(["app","playlists"],"readonly");
      const stateReq=tx.objectStore("app").get("state");
      const listReq=tx.objectStore("playlists").getAll();
      tx.oncomplete=()=>resolve({
        ...(stateReq.result?.value || {active:null,favorites:[],history:[]}),
        playlists:listReq.result || []
      });
      tx.onerror=()=>reject(tx.error);
    });
    if(value) return value;
  }catch{}

  // Migração da versão antiga que usava localStorage.
  try{
    const legacy=JSON.parse(localStorage.getItem("neoplayer-v2"));
    if(legacy?.playlists){
      await saveStore(legacy);
      for(const playlist of legacy.playlists) await savePlaylist(playlist);
      localStorage.removeItem("neoplayer-v2");
      return legacy;
    }
  }catch{}
  return EMPTY_STORE;
}

async function saveStore(s){
  const db=await openDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction("app","readwrite");
    tx.objectStore("app").put({key:"state",value:{active:s.active,favorites:s.favorites||[],history:s.history||[]}});
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
  });
}
async function savePlaylist(playlist){
  const db=await openDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction("playlists","readwrite");
    tx.objectStore("playlists").put(playlist);
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
  });
}
async function deletePlaylistFromDB(id){
  const db=await openDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction("playlists","readwrite");
    tx.objectStore("playlists").delete(id);
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
  });
}

function parseM3U(text, source=""){
  const lines = text.replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);
  const items = [];
  let meta = {};
  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    if(line.startsWith("#EXTINF")){
      const attrs = {};
      const attrRe = /([\w-]+)="([^"]*)"/g; let m;
      while((m=attrRe.exec(line))) attrs[m[1]] = m[2];
      const comma = line.indexOf(",");
      const title = comma >= 0 ? line.slice(comma+1).trim() : (attrs["tvg-name"] || "Sem nome");
      meta = {
        name: title || attrs["tvg-name"] || "Sem nome",
        logo: attrs["tvg-logo"] || "",
        group: attrs["group-title"] || "Outros",
        tvgId: attrs["tvg-id"] || ""
      };
    } else if(!line.startsWith("#")){
      items.push({...meta, url:line, id:`${items.length}-${btoa(unescape(encodeURIComponent(line))).slice(0,14)}`});
      meta = {};
    }
  }
  return items;
}

function guessKind(item){
  const g=(item.group||"").toLowerCase(), n=(item.name||"").toLowerCase(), u=(item.url||"").toLowerCase();
  if(/filme|filmes|movie|movies|cinema|vod/.test(g) || /\/(movie|movies)\//.test(u)) return "Filmes";
  if(/série|series|season|temporada|tv show|shows/.test(g) || /\/(series|tvshows)\//.test(u)) return "Séries";
  if(/sport|esporte|futebol|sports/.test(g)) return "Esportes";
  return "TV ao Vivo";
}

function App(){
  const [store,setStore]=useState(null);
  useEffect(()=>{ readStore().then(setStore).catch(()=>setStore(EMPTY_STORE)); },[]);
  const [page,setPage]=useState("home");
  const [search,setSearch]=useState("");
  const [query,setQuery]=useState("");
  const [sidebar,setSidebar]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const [selected,setSelected]=useState(null);
  const [settings,setSettings]=useState(false);

  const active = store?.playlists.find(p=>p.id===store.active) || store?.playlists[0] || null;
  const items = active?.items || [];
  const favs = new Set(store?.favorites || []);
  const history = items.filter(i=>(store?.history || []).includes(i.id));
  const filtered = useMemo(()=>items.filter(i=>
    !query || `${i.name} ${i.group}`.toLowerCase().includes(query.toLowerCase())
  ),[items,query]);

  useEffect(()=>{ if(active && store && store.active!==active.id){const n={...store,active:active.id};setStore(n);saveStore(n)} },[active,store]);
  useEffect(()=>{
    if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
  },[]);

  if(!store) return <div className="app"><div className="welcome"><div className="welcome-content"><div className="logo-big"><span>▶</span> NEO<span>PLAYER</span></div><p>Carregando sua biblioteca...</p></div></div></div>;

  function openItem(item){
    setSelected(item);
    const h=[item.id,...store.history.filter(x=>x!==item.id)].slice(0,40);
    const n={...store,history:h}; setStore(n); saveStore(n);
  }
  function toggleFav(id){
    const next=new Set(store.favorites);
    next.has(id)?next.delete(id):next.add(id);
    const n={...store,favorites:[...next]}; setStore(n); saveStore(n);
  }
  async function deletePlaylist(id){
    const n={...store,playlists:store.playlists.filter(p=>p.id!==id),active:store.active===id?null:store.active};
    setStore(n);
    await saveStore(n);
    await deletePlaylistFromDB(id);
  }
  async function addPlaylist(data){
    const n={...store,playlists:[...store.playlists,data],active:data.id};
    setStore(n);
    await savePlaylist(data);
    await saveStore(n);
    setShowAdd(false);
  }

  return <div className="app">
    <Header onMenu={()=>setSidebar(!sidebar)} search={search} setSearch={setSearch} onSearch={()=>{setQuery(search);setPage("search")}} onAdd={()=>setShowAdd(true)} />
    <Sidebar open={sidebar} page={page} setPage={setPage} close={()=>setSidebar(false)} playlists={store.playlists} active={store.active} setActive={(id)=>{const n={...store,active:id};setStore(n);saveStore(n)}} />
    <main className={sidebar?"main shifted":"main"}>
      {!active ? <Welcome onAdd={()=>setShowAdd(true)} /> :
      <>
        {page==="home" && <HomePage items={items} history={history} favs={favs} openItem={openItem} toggleFav={toggleFav} />}
        {page==="live" && <Catalog title="TV ao Vivo" items={filtered.filter(i=>guessKind(i)==="TV ao Vivo")} openItem={openItem} favs={favs} toggleFav={toggleFav} />}
        {page==="movies" && <Catalog title="Filmes" items={filtered.filter(i=>guessKind(i)==="Filmes")} openItem={openItem} favs={favs} toggleFav={toggleFav} />}
        {page==="series" && <Catalog title="Séries" items={filtered.filter(i=>guessKind(i)==="Séries")} openItem={openItem} favs={favs} toggleFav={toggleFav} />}
        {page==="favorites" && <Catalog title="Meus favoritos" items={items.filter(i=>favs.has(i.id))} openItem={openItem} favs={favs} toggleFav={toggleFav} />}
        {page==="history" && <Catalog title="Continuar assistindo" items={history} openItem={openItem} favs={favs} toggleFav={toggleFav} />}
        {page==="search" && <Catalog title={query?`Resultados para “${query}”`:"Buscar"} items={filtered} openItem={openItem} favs={favs} toggleFav={toggleFav} />}
        {page==="playlists" && <PlaylistManager playlists={store.playlists} active={store.active} setActive={(id)=>{const n={...store,active:id};setStore(n);saveStore(n)}} add={()=>setShowAdd(true)} remove={deletePlaylist}/>}
        {page==="settings" && <SettingsPage store={store} setStore={(n)=>{setStore(n);saveStore(n)}} />}
      </>}
    </main>
    <BottomNav page={page} setPage={setPage} />
    {showAdd && <AddPlaylist onClose={()=>setShowAdd(false)} onAdd={addPlaylist}/>}
    {selected && <Player item={selected} onClose={()=>setSelected(null)} favorite={favs.has(selected.id)} toggleFav={()=>toggleFav(selected.id)} />}
    {settings && null}
  </div>
}

function Header({onMenu,search,setSearch,onSearch,onAdd}){
 return <header className="header">
   <button className="icon-btn mobile-only" onClick={onMenu}><Menu/></button>
   <div className="brand" onClick={onMenu}><span className="brand-mark">▶</span><span>NEO<span className="accent">PLAYER</span></span></div>
   <nav className="desktop-nav">
     <a>Início</a><a>TV ao Vivo</a><a>Filmes</a><a>Séries</a>
   </nav>
   <div className="header-actions">
     <div className="searchbox"><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onSearch()} placeholder="Buscar..." /><button onClick={onSearch}>↵</button></div>
     <button className="icon-btn" title="Adicionar playlist" onClick={onAdd}><Plus/></button>
   </div>
 </header>
}

function Sidebar({open,page,setPage,close,playlists,active,setActive}){
 const go=(p)=>{setPage(p);close()};
 return <aside className={`sidebar ${open?"open":""}`}>
   <div className="side-title">Navegação</div>
   <Side icon={<Home/>} text="Início" active={page==="home"} onClick={()=>go("home")}/>
   <Side icon={<Tv/>} text="TV ao Vivo" active={page==="live"} onClick={()=>go("live")}/>
   <Side icon={<Film/>} text="Filmes" active={page==="movies"} onClick={()=>go("movies")}/>
   <Side icon={<Layers3/>} text="Séries" active={page==="series"} onClick={()=>go("series")}/>
   <Side icon={<Star/>} text="Favoritos" active={page==="favorites"} onClick={()=>go("favorites")}/>
   <Side icon={<Clock3/>} text="Histórico" active={page==="history"} onClick={()=>go("history")}/>
   <div className="side-title playlist-title">Playlists</div>
   {playlists.map(p=><button className={`playlist-link ${active===p.id?"selected":""}`} key={p.id} onClick={()=>{setActive(p.id);go("home")}}><span className="dot"/> {p.name}</button>)}
   <Side icon={<Link2/>} text="Gerenciar playlists" active={page==="playlists"} onClick={()=>go("playlists")}/>
   <Side icon={<Settings/>} text="Configurações" active={page==="settings"} onClick={()=>go("settings")}/>
 </aside>
}
function Side({icon,text,active,onClick}){return <button className={`side-link ${active?"active":""}`} onClick={onClick}>{icon}<span>{text}</span></button>}

function Welcome({onAdd}){
 return <section className="welcome">
   <div className="welcome-glow"/>
   <div className="welcome-content">
    <div className="logo-big"><span>▶</span> STREAM<span>BOX</span></div>
    <h1>Seu entretenimento,<br/><b>em um só lugar.</b></h1>
    <p>Adicione M3U/M3U8, arquivo ou Xtream Codes e organize todo o conteúdo em uma interface moderna.</p>
    <button className="primary-btn" onClick={onAdd}><Plus size={20}/> Adicionar playlist</button>
   </div>
 </section>
}

function HomePage({items,history,favs,openItem,toggleFav}){
 const groups=[...new Set(items.map(i=>i.group||"Outros"))].slice(0,8);
 const featured=items[0];
 return <div>
   {featured && <Hero item={featured} onPlay={()=>openItem(featured)} />}
   {history.length>0 && <Row title="Continuar assistindo" items={history} openItem={openItem} favs={favs} toggleFav={toggleFav}/>}
   <Row title="⭐ Favoritos" items={items.filter(i=>favs.has(i.id)).slice(0,12)} openItem={openItem} favs={favs} toggleFav={toggleFav}/>
   {groups.map(g=><Row key={g} title={g} items={items.filter(i=>(i.group||"Outros")===g).slice(0,14)} openItem={openItem} favs={favs} toggleFav={toggleFav}/>)}
 </div>
}
function Hero({item,onPlay}){
 return <section className="hero">
   <div className="hero-overlay"/>
   <div className="hero-content">
     <span className="eyebrow">DESTAQUE</span><h1>{item.name}</h1>
     <p>{item.group||"Conteúdo"} • reprodução direta</p>
     <button className="primary-btn" onClick={onPlay}><Play size={19} fill="currentColor"/> Assistir agora</button>
   </div>
 </section>
}
function Row({title,items,openItem,favs,toggleFav}){
 if(!items.length) return null;
 return <section className="row-section"><div className="row-head"><h2>{title}</h2><ChevronRight size={19}/></div><div className="cards-scroll">{items.map(i=><Card key={i.id} item={i} openItem={openItem} favorite={favs.has(i.id)} toggleFav={toggleFav}/>)}</div></section>
}
function Card({item,openItem,favorite,toggleFav}){
 return <article className="card">
   <button className="poster" onClick={()=>openItem(item)}>
     {item.logo?<img src={item.logo} onError={e=>e.currentTarget.style.display="none"}/>:<div className="poster-fallback">▶</div>}
     <div className="poster-shade"/><span className="play-float"><Play size={18} fill="currentColor"/></span>
   </button>
   <button className={`fav-mini ${favorite?"is-fav":""}`} onClick={()=>toggleFav(item.id)}><Star size={15} fill={favorite?"currentColor":"none"}/></button>
   <div className="card-title">{item.name}</div><div className="card-meta">{item.group||"Outros"}</div>
 </article>
}
function Catalog({title,items,openItem,favs,toggleFav}){
 return <section className="catalog"><div className="catalog-title"><div><span className="eyebrow">BIBLIOTECA</span><h1>{title}</h1></div><span className="count">{items.length} itens</span></div><div className="grid">{items.map(i=><Card key={i.id} item={i} openItem={openItem} favorite={favs.has(i.id)} toggleFav={toggleFav}/>)}</div>{!items.length&&<Empty text="Nenhum conteúdo encontrado."/>}</section>
}
function Empty({text}){return <div className="empty"><Info/><p>{text}</p></div>}

function PlaylistManager({playlists,active,setActive,add,remove}){
 return <section className="settings-page"><div className="catalog-title"><div><span className="eyebrow">BIBLIOTECA</span><h1>Minhas playlists</h1></div><button className="primary-btn" onClick={add}><Plus/> Adicionar</button></div>
 <div className="playlist-grid">{playlists.map(p=><div className={`playlist-card ${active===p.id?"current":""}`} key={p.id}><div className="playlist-icon">▶</div><div><h3>{p.name}</h3><p>{p.items.length} conteúdos</p><small>{p.url}</small></div><div className="playlist-actions"><button onClick={()=>setActive(p.id)}>Abrir</button><button className="danger" onClick={()=>remove(p.id)}><Trash2 size={17}/></button></div></div>)}</div>
 {!playlists.length&&<Empty text="Adicione sua primeira playlist M3U/M3U8."/>}</section>
}
function SettingsPage({store,setStore}){
 const clear=()=>{if(confirm("Limpar histórico?")) setStore({...store,history:[]})};
 return <section className="settings-page"><span className="eyebrow">PREFERÊNCIAS</span><h1>Configurações</h1>
 <div className="settings-card"><div><h3>Dados locais</h3><p>Playlists, favoritos e histórico são armazenados neste dispositivo usando IndexedDB, apropriado para catálogos grandes.</p></div><button className="secondary-btn" onClick={clear}><RefreshCw/> Limpar histórico</button></div>
 <div className="settings-card"><div><h3>Sobre o player</h3><p>NeoPlayer é um player de playlists M3U/M3U8. O conteúdo é fornecido pelas playlists adicionadas pelo usuário.</p></div></div>
 </section>
}

function AddPlaylist({onClose,onAdd}){
 const [tab,setTab]=useState("url");
 const [name,setName]=useState("Minha Playlist");
 const [url,setUrl]=useState("");
 const [server,setServer]=useState("");
 const [username,setUsername]=useState("");
 const [password,setPassword]=useState("");
 const [showPassword,setShowPassword]=useState(false);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [success,setSuccess]=useState("");
 const [tested,setTested]=useState(null);

 function resetFeedback(){setError("");setSuccess("");setTested(null)}
 function normalizeServer(value){
   let v=value.trim();
   if(!v) return "";
   if(!/^https?:\/\//i.test(v)) v="http://"+v;
   return v.replace(/\/+$/,'');
 }
 async function fetchPlaylist(sourceUrl){
   const res=await fetch('/api/proxy?mode=playlist',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({url:sourceUrl})
   });
   const data=await res.json().catch(()=>({}));
   if(!res.ok) throw new Error(data.error || "Não foi possível acessar a playlist.");
   const text=data.content || "";
   const items=parseM3U(text,sourceUrl);
   if(!items.length) throw new Error("A fonte respondeu, mas nenhum conteúdo M3U foi encontrado.");
   return items;
 }
 async function submitUrl(){
   resetFeedback();
   if(!url.trim()){setError("Cole uma URL M3U/M3U8.");return}
   setLoading(true);
   try{
     const items=await fetchPlaylist(url.trim());
     onAdd({id:crypto.randomUUID(),name:name.trim()||"Minha Playlist",url:url.trim(),items,createdAt:Date.now(),sourceType:"m3u"});
   }catch(e){setError(e.message || "Falha ao carregar a playlist.");}
   finally{setLoading(false)}
 }
 async function testXtream(){
   resetFeedback();
   const base=normalizeServer(server);
   if(!base){setError("Informe o servidor Xtream.");return}
   if(!username.trim()){setError("Informe o usuário.");return}
   if(!password){setError("Informe a senha.");return}
   setLoading(true);
   try{
     const params=new URLSearchParams({username:username.trim(),password,type:'m3u_plus',output:'m3u8'});
     let source=`${base}/get.php?${params.toString()}`;
     let items;
     try { items=await fetchPlaylist(source); }
     catch(first){
       const fallback=new URLSearchParams({username:username.trim(),password,type:'m3u_plus',output:'ts'});
       source=`${base}/get.php?${fallback.toString()}`;
       items=await fetchPlaylist(source);
     }
     const counts={live:0,movies:0,series:0};
     for(const item of items){const k=guessKind(item);if(k==='Filmes')counts.movies++;else if(k==='Séries')counts.series++;else counts.live++;}
     setTested({source,items,counts});
     setSuccess(`Conexão estabelecida • ${items.length.toLocaleString('pt-BR')} conteúdos encontrados`);
   }catch(e){setError(e.message || "Não foi possível validar os dados Xtream.");}
   finally{setLoading(false)}
 }
 function addTested(){
   if(!tested)return;
   onAdd({
     id:crypto.randomUUID(),
     name:name.trim()||"Minha Playlist",
     url:tested.source,
     items:tested.items,
     createdAt:Date.now(),
     sourceType:"xtream",
     xtream:{server:normalizeServer(server),username:username.trim(),password}
   });
 }
 async function file(e){
   const f=e.target.files?.[0]; if(!f)return;
   setLoading(true);setError("");setSuccess("");
   try{
     const text=await f.text();const items=parseM3U(text,f.name);
     if(!items.length)throw new Error("Nenhum conteúdo encontrado.");
     onAdd({id:crypto.randomUUID(),name:name.trim()||f.name,url:"arquivo local",items,createdAt:Date.now(),sourceType:"file"});
   }catch(e){setError(e.message)}finally{setLoading(false)}
 }
 return <div className="modal-backdrop"><div className="modal xtream-modal">
   <button className="modal-close" onClick={onClose}><X/></button><span className="eyebrow">NOVA PLAYLIST</span><h2>Adicionar conteúdo</h2><p className="modal-sub">Use uma URL M3U/M3U8, arquivo ou credenciais Xtream Codes.</p>
   <label>Nome<input value={name} onChange={e=>{setName(e.target.value);setTested(null)}} placeholder="Minha Playlist"/></label>
   <div className="tabs">
     <button className={tab==="url"?"active":""} onClick={()=>{setTab("url");resetFeedback()}}><Link2/> URL</button>
     <button className={tab==="file"?"active":""} onClick={()=>{setTab("file");resetFeedback()}}><Upload/> Arquivo</button>
     <button className={tab==="xtream"?"active":""} onClick={()=>{setTab("xtream");resetFeedback()}}><SlidersHorizontal/> Xtream</button>
   </div>
   {tab==="url" && <label>URL M3U/M3U8<input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://exemplo.com/playlist.m3u"/></label>}
   {tab==="file" && <label className="filebox"><Upload size={22}/><span>Selecionar arquivo M3U</span><input type="file" accept=".m3u,.m3u8,.txt" onChange={file}/></label>}
   {tab==="xtream" && <div className="xtream-fields">
     <label>Servidor<input value={server} onChange={e=>{setServer(e.target.value);setTested(null)}} placeholder="http://servidor.com:8080"/></label>
     <label>Usuário<input value={username} onChange={e=>{setUsername(e.target.value);setTested(null)}} placeholder="Usuário" autoComplete="username"/></label>
     <label>Senha<div className="password-wrap"><input type={showPassword?"text":"password"} value={password} onChange={e=>{setPassword(e.target.value);setTested(null)}} placeholder="Senha" autoComplete="current-password"/><button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
     {tested && <div className="xtream-stats"><CheckCircle2 size={18}/><div><strong>Conexão validada</strong><span>{tested.counts.live.toLocaleString('pt-BR')} TV • {tested.counts.movies.toLocaleString('pt-BR')} filmes • {tested.counts.series.toLocaleString('pt-BR')} séries</span></div></div>}
   </div>}
   {error&&<div className="error">{error}</div>}
   {success&&<div className="success">{success}</div>}
   {tab==="url"&&<button className="primary-btn full" disabled={loading} onClick={submitUrl}>{loading?<><RefreshCw className="spin"/> Lendo playlist...</>:<><Plus/> Adicionar playlist</>}</button>}
   {tab==="xtream"&&(!tested ? <button className="primary-btn full" disabled={loading} onClick={testXtream}>{loading?<><RefreshCw className="spin"/> Testando conexão...</>:<><CheckCircle2/> Testar conexão</>}</button> : <button className="primary-btn full" onClick={addTested}><Plus/> Adicionar playlist</button>)}
 </div></div>
}
function Player({item,onClose,favorite,toggleFav}){
 const videoRef=useRef(null), [playing,setPlaying]=useState(true), [muted,setMuted]=useState(false), [full,setFull]=useState(false), [error,setError]=useState("");
 useEffect(()=>{
   const video=videoRef.current; if(!video)return;
   let hls;
   setError("");
   if(Hls.isSupported()){
     hls=new Hls({enableWorker:true,lowLatencyMode:true});
     hls.loadSource(`/api/proxy?url=${encodeURIComponent(item.url)}`);hls.attachMedia(video);hls.on(Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{}));
     hls.on(Hls.Events.ERROR,(_,d)=>{if(d.fatal)setError("Não foi possível reproduzir este stream.");});
   } else if(video.canPlayType("application/vnd.apple.mpegurl")) {video.src=`/api/proxy?url=${encodeURIComponent(item.url)}`;video.play().catch(()=>{});}
   else setError("Este navegador não suporta HLS.");
   return ()=>hls?.destroy();
 },[item]);
 const toggle=()=>{const v=videoRef.current;if(!v)return;v.paused?v.play():v.pause();setPlaying(!v.paused)};
 const fullscreen=async()=>{const el=document.querySelector(".player-shell"); if(!document.fullscreenElement){await el.requestFullscreen?.();setFull(true)}else{await document.exitFullscreen?.();setFull(false)}};
 return <div className="player-overlay"><div className="player-shell">
   <video ref={videoRef} playsInline muted={muted} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} />
   <div className="player-gradient"/><button className="player-close" onClick={onClose}><X/></button>
   <div className="player-info"><span className="eyebrow">{item.group||"CONTEÚDO"}</span><h2>{item.name}</h2>{error&&<p className="player-error">{error}</p>}</div>
   <div className="player-controls"><button onClick={toggle}>{playing?<Pause/>:<Play fill="currentColor"/>}</button><button onClick={()=>setMuted(!muted)}>{muted?<VolumeX/>:<Volume2/>}</button><div className="control-spacer"/><button className={favorite?"fav-active":""} onClick={toggleFav}><Star fill={favorite?"currentColor":"none"}/></button><button onClick={fullscreen}>{full?<Minimize/>:<Maximize/>}</button></div>
 </div></div>
}

function BottomNav({page,setPage}){
 return <nav className="bottom-nav"><button className={page==="home"?"active":""} onClick={()=>setPage("home")}><Home/><span>Início</span></button><button className={page==="live"?"active":""} onClick={()=>setPage("live")}><Tv/><span>TV</span></button><button className={page==="favorites"?"active":""} onClick={()=>setPage("favorites")}><Star/><span>Favoritos</span></button><button className={page==="settings"?"active":""} onClick={()=>setPage("settings")}><Settings/><span>Ajustes</span></button></nav>
}
createRoot(document.getElementById("root")).render(<App/>);
