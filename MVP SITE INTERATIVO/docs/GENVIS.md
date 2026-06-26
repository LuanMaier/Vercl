# Genvis (brayun.studio) vs este core

## Genvis — [genvis.brayun.studio](https://genvis.brayun.studio)

| Aspecto | Implementação |
|---------|----------------|
| Player | `VideoSpinner` — 2 elementos `<video>` (A/B) |
| Transição | WebM `transNext` / `transPrev` entre câmeras |
| Loop | `loop` WebM por câmera |
| Dados | `STATIC_PROJECT_DATA` embutido no HTML |
| Módulos | `spinner.js`, `genplan.js`, `viewer.js` |
| UI | Glass + Guided Tour + planos |

Estado: `LOADING` → `IDLE` (loop) → `TRANSITIONING`.

## Archviz-poket (este clone)

| Aspecto | Implementação |
|---------|----------------|
| Player | Canvas 2D + sequência JPG |
| Transição | 48 frames por par `from_to` |
| Luz | Sequências `day_night`, etc. |
| 360 | Three.js sphere (só no modal) |

## Integração neste repo (Fase A — feito)

1. Grafo `TRANSITIONS` = `SEQUENCES` + overrides em `videoTransitions.ts`.
2. `VideoTransitionPlayer` — dual `<video>` A/B, prefetch de arestas vizinhas.
3. `ExplorerEngine.playTransition` — vídeo primeiro; fallback JPG se erro.

Config por aresta:

```ts
// src/config/videoTransitions.ts
'0_6': { type: 'video', src: '/media/trans/0_6.webm' },
```

Config Genvis-like (futuro — loops por câmera):

```ts
{
  id: 0,
  loop: '/media/coworking_loop.webm',
  transNext: '/media/coworking_1-2.webm',
  transPrev: '/media/coworking_1-4.webm',
}
```
