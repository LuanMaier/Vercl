# MVP Site Interativo — Explorer Core

Clone da **lógica** do [archviz-poket.vercel.app](https://archviz-poket.vercel.app), separada da UI.

## Arquitetura

```
src/
  config/     ← dados: vistas, sequências, POIs, luz (edite aqui)
  core/       ← motor: canvas, navegação, moods, 360°
  ui/         ← shell mínimo (troque depois)
  styles/     ← CSS temporário
```

Referência alternativa vídeo: [genvis.brayun.studio](https://genvis.brayun.studio) — ver [docs/GENVIS.md](docs/GENVIS.md).

## Rodar

```bash
npm install
npm run dev
```

http://localhost:5174

## Área restrita (edição de pins)

1. No site público, clique em **Área restrita** (canto superior direito) ou abra http://localhost:5174/admin.html
2. Login com usuário/senha definidos em `.env.local` (não vai para o Git)
3. Após entrar → editor em http://localhost:5174/edit.html

Configuração (primeira vez):

```bash
cp .env.example .env.local
# Edite VITE_ADMIN_USER e gere o hash da senha:
npm run admin:hash
```

- Arrastar, **adicionar** e **remover** pins
- **SALVAR HERO** / **SALVAR IMAGEM** / **SALVAR VÍDEO** / **Salvar pins no projeto** gravam na pasta do projeto (só com `npm run dev` ativo):
  - Imagens → `public/images/custom/`
  - Vídeos → `public/media/custom/`
  - Mapa de pins → `src/config/generated/poisOverrides.json`
  - Índice de mídia → `src/config/generated/mediaOverrides.json`
  - Insolação (dia/tarde/noite): imagens + vídeos de transição por vista no editor
- O site principal atualiza na hora (mesma aba ou outra com dev server)
- **Menu inferior** usa o vídeo do PIN cuja vista destino = botão clicado (ida e volta precisam de PINs separados com vídeos diferentes)
- **Copiar código** → colar em `src/config/pois.ts` (opcional, para versionar no Git)
- Link **Editar pins** no canto do site principal

## Iluminação (leve)

Por padrão `USE_LIGHT_FRAME_SEQUENCES = false` — troca poster por vista/mood (`src/config/lighting.ts`), sem 48 frames.

## API do motor (console)

```js
__explorer.jumpTo(6)   // Parque
__explorer.setLight('night')
```

## O que falta

Colocar imagens em `public/images/` — ver [public/images/README.md](public/images/README.md).

## Transições em vídeo (híbrido)

- Grafo unificado: `src/config/transitions.ts` (JPG por padrão)
- Ativar WebM: `src/config/videoTransitions.ts` + arquivos em `public/media/trans/` — ver [public/media/trans/README.md](public/media/trans/README.md)
- Motor: `src/core/videoTransitionPlayer.ts` (dual `<video>` A/B, estilo Genvis)
- Se o `.webm` falhar, cai automaticamente na sequência JPG da mesma aresta
- Loops idle: `src/config/viewLoops.ts` + `public/media/loops/` — ver README na pasta

## Próximos passos (UI)

- Trocar `src/ui/shell.ts` + `src/styles/explorer.css`
- Adicionar botões em `#mood-bar` via `bindMoodBar`
- Mudar `.poi-btn` / `.t-pt` no CSS ou novo componente
