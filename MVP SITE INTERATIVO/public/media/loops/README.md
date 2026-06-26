# Loops idle por vista

Vídeo em loop enquanto o usuário está parado numa vista — vegetação, água, movimento ambiente.

## Pelo editor (recomendado)

1. Abra **Cena** → selecione a vista (ex.: Praia, Parque)
2. Painel **Fundo da vista** → **Vídeo em loop**
3. Envie MP4/WebM (sem áudio) → **Salvar**
4. Mantenha uma **Imagem HERO** para posicionar pins e capa de carregamento

## Manual (legado)

Em `src/config/viewLoops.ts` ou `mediaOverrides.json` → `viewLoopVideos`.

## Especificação

- Sem áudio, loop contínuo
- Mesma resolução das transições (~1920 px largura)
- MP4 (H.264) ou WebM

## Comportamento no site

- Modo **loop**: vídeo repete na vista idle
- Falha no vídeo → cai no poster/HERO estático
- Transição ou pin → loop para e volta ao normal
- Panorâmica: slider de sol substitui o loop ao mudar luz
