# Transições em vídeo (WebM)

Coloque aqui os clipes de transição entre vistas. O motor usa **vídeo quando a chave está em** `src/config/videoTransitions.ts`; caso contrário continua com a sequência JPG em `src/config/sequences.ts`.

## Nomenclatura

| Arquivo | Rota |
|---------|------|
| `0_6.webm` | Panorâmica (0) → Parque (6) |
| `6_0.webm` | Parque → Panorâmica (reverso) |

Padrão: `{from}_{to}.webm` — mesmas chaves do grafo `SEQUENCES`.

## Variante mobile (opcional)

`public/media/trans/mobile/0_6.webm` — referencie em `mobileSrc` no config.

## Especificação sugerida (ffmpeg)

```bash
ffmpeg -i entrada.mp4 -an -c:v libvpx-vp9 -b:v 0 -crf 32 -row-mt 1 \
  -vf "scale=1920:-2" -pix_fmt yuv420p 0_6.webm
```

- **Codec:** VP9 ou VP8 em container WebM
- **Sem áudio** (`-an`)
- **Duração:** ~1,5–3 s (igual sensação das 48 frames a ~36 fps)
- **Resolução:** 1920 px largura (desktop); 1280 ou 960 para `mobile/`

## Ativar no projeto

Em `src/config/videoTransitions.ts`:

```ts
'0_6': {
  type: 'video',
  src: '/media/trans/0_6.webm',
  mobileSrc: '/media/trans/mobile/0_6.webm',
},
```

Se o `.webm` falhar ao carregar, o motor **volta automaticamente** para a sequência JPG da mesma aresta.
