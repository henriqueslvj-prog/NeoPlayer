const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 NeoPlayer/2.1';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, Accept, Origin, Referer');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
}

function parseTarget(raw) {
  if (!raw) throw new Error('URL ausente.');
  const target = new URL(raw);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('A URL precisa usar HTTP ou HTTPS.');
  const host = target.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('Destino não permitido.');
  }
  const ip = host.match(/^(?:\\d{1,3}\\.){3}\\d{1,3}$/)?.[0];
  if (ip) {
    const [a,b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
      throw new Error('Destino privado não permitido.');
    }
  }
  return target;
}

function proxyUrl(url) {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

function looksLikeManifest(text, contentType='') {
  return /#EXTM3U/i.test(text.slice(0, 500)) || /mpegurl|m3u8/i.test(contentType);
}

function rewriteManifest(text, baseUrl) {
  // URI attributes: EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, etc.
  text = text.replace(/URI="([^"]+)"/gi, (_, ref) => {
    if (/^(data:|blob:|https?:\/\/.*\/api\/proxy\?url=)/i.test(ref)) return `URI="${ref}"`;
    try { return `URI="${proxyUrl(new URL(ref, baseUrl).href)}"`; } catch { return `URI="${ref}"`; }
  });
  // Segment/sub-playlist lines that are not comments.
  return text.split(/\r?\n/).map(line => {
    const trimmed=line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    try {
      if (/^(data:|blob:)/i.test(trimmed)) return line;
      const abs = new URL(trimmed, baseUrl).href;
      return proxyUrl(abs);
    } catch { return line; }
  }).join('\n');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const raw = req.method === 'GET' ? req.query?.url : (typeof req.body === 'string' ? (()=>{try{return JSON.parse(req.body).url}catch{return ''}})() : req.body?.url);
  if (!raw) return res.status(400).json({error:'Informe a URL.'});

  let target;
  try { target = parseTarget(raw); }
  catch (e) { return res.status(400).json({error:e.message || 'URL inválida.'}); }

  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 55000);
  try {
    const range = req.headers.range;
    const headers = {
      'User-Agent': DEFAULT_UA,
      'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, text/plain, */*',
      'Accept-Encoding': 'identity',
      'Connection': 'keep-alive'
    };
    if (range) headers.Range = range;

    let upstream;
    try {
      upstream = await fetch(target.href, {redirect:'follow', signal:controller.signal, headers, cache:'no-store'});
    } catch (firstError) {
      // Retry once with a minimal header set; some origins reject unusual header combinations.
      upstream = await fetch(target.href, {redirect:'follow', signal:controller.signal, headers:{'User-Agent':DEFAULT_UA,'Accept':'*/*'}, cache:'no-store'});
    }
    if (!upstream.ok && upstream.status !== 206) return res.status(502).json({error:`Servidor de origem respondeu HTTP ${upstream.status}.`});

    const contentType = upstream.headers.get('content-type') || '';
    const finalUrl = upstream.url || target.href;

    // Playlist endpoint: return JSON for the UI parser.
    const isPlaylistRequest = req.query?.mode === 'playlist';
    if (isPlaylistRequest) {
      const content = await upstream.text();
      if (!content.trim()) return res.status(502).json({error:'Playlist vazia.'});
      res.setHeader('Cache-Control','no-store');
      return res.status(200).json({content, finalUrl});
    }

    // HLS manifests must have every child URL rewritten through this proxy,
    // otherwise the browser will hit the original host and CORS returns.
    if (/mpegurl|m3u8/i.test(contentType) || target.pathname.toLowerCase().endsWith('.m3u8')) {
      const text = await upstream.text();
      if (!looksLikeManifest(text, contentType)) return res.status(502).json({error:'Resposta não parece ser um manifesto HLS válido.'});
      const rewritten = rewriteManifest(text, finalUrl);
      res.setHeader('Content-Type','application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
      return res.status(200).send(rewritten);
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    for (const h of ['content-length','content-range','accept-ranges']) {
      const v=upstream.headers.get(h); if(v) res.setHeader(h,v);
    }
    res.setHeader('Cache-Control','no-store');
    return res.status(upstream.status === 206 ? 206 : 200).send(buffer);
  } catch (error) {
    if (error?.name === 'AbortError') return res.status(504).json({error:'O servidor de origem demorou mais de 55 segundos para responder. Isso indica lentidão ou indisponibilidade no servidor da playlist.'});
    return res.status(502).json({error:'Não foi possível acessar o conteúdo de origem.'});
  } finally { clearTimeout(timer); }
}
