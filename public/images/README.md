# Assets — Archviz Explorer Core

Copie do template original ou gere com IA. Estrutura esperada:

## Transições entre vistas (`seq_arch/`)

48 frames JPG por aresta, ex. `parque_00.jpg` … `parque_47.jpg`.

Prefixes usados em `src/config/sequences.ts`:

- `arch_` — panorâmica ↔ prédio
- `parque_`, `torre_`, `est_`
- `portaria_to_*`, `parque_to_*`, `est_to_*`, `predio_to_est_`

## Mobile (`seq_arch_m/`)

Mesmos nomes, resolução menor (opcional).

## Iluminação (`seq_arch/`)

- `dia_to_noite_00…47.jpg`
- `dia_to_sunset_00…47.jpg`
- `noite_to_sol_`, `sunset_to_noite_`

Posters finais: `dia_to_noite_47.jpg`, `dia_to_sunset_47.jpg`

## POI / 360

- `POI_001.jpg` — thumb popup
- `XP_NPL_360_2.jpg` — equirectangular 360°

## Futuro: vídeo (estilo Genvis)

Troque `playFrameSequence` por player WebM dual-buffer — ver `docs/GENVIS.md`.
