# NeoPlayer

Player web/PWA para playlists M3U/M3U8 fornecidas pelo usuário.

## Correção principal desta versão
As playlists não são mais gravadas no `localStorage`. Catálogos grandes podem ultrapassar o limite de armazenamento do navegador e gerar `QuotaExceededError`. O NeoPlayer agora usa **IndexedDB** para persistir playlists, favoritos e histórico sem tentar serializar todo o catálogo em uma única chave do localStorage.

A versão também corrige a leitura de atributos M3U (`tvg-logo`, `group-title`, `tvg-id`) e amplia a identificação de filmes/séries.

## Deploy
- `npm install`
- `npm run build`
- Vercel: importe o repositório; a detecção do Vite deve ser automática.
