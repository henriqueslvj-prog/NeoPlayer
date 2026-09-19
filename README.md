# NeoPlayer v5

Player web PWA para playlists M3U/M3U8, arquivos M3U e credenciais Xtream Codes.

## Fontes suportadas
- URL M3U/M3U8
- Arquivo `.m3u`, `.m3u8` ou `.txt`
- Xtream Codes: servidor + usuário + senha

## Xtream Codes
O NeoPlayer monta o endpoint padrão `get.php` usando as credenciais informadas, valida a resposta pelo proxy da Vercel e mostra uma contagem aproximada de TV, filmes e séries encontrada no M3U retornado pelo provedor.

## Armazenamento
Playlists são persistidas no IndexedDB para suportar catálogos grandes sem depender do limite pequeno do localStorage.

## Deploy
```bash
npm install
npm run build
```

Na Vercel, importe o repositório GitHub. O projeto usa Vite e funções serverless em `/api`.

## Observação
O funcionamento depende do servidor/provedor permitir acesso HTTP/HLS e responder às requisições. O proxy não contorna autenticação, DRM, bloqueios de IP ou outras restrições de acesso.
