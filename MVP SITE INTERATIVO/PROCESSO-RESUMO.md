# MVP Site Interativo — Resumo do processo

**Data do pacote:** 2 de junho de 2026  
**Projeto:** explorador 3D do empreendimento (site + editor + admin + CRM)

---

## Como rodar

```bash
npm install
npm run dev
```

Ou no Windows: `iniciar-dev.bat`

**Build produção:** `npm run build` → pasta `dist/`

**CRM Excel:**
- `npm run crm:init` — cria planilha exemplo
- `npm run crm:sync` — sincroniza Excel → JSON
- Planilha: `public/crm/unidades.xlsx`
- JSON gerado: `public/config/crmUnits.json`

---

## Funcionalidades implementadas neste ciclo

### 1. Pins de panorama (editor)
- Salvar pin ao criar → aparece no site
- Alinhamento / coordenadas em espaço da imagem

### 2. Apartamentos CRM
- Pins na fachada com cores do Excel:
  - **Preto/padrão** = disponível
  - **Amarelo** = reservado
  - **Vermelho** = vendido
- Sincronização automática no dev (watch + F5)
- Polling no site a cada ~20s
- Botão no editor: **Atualizar CRM do Excel**

### 3. Menu dock — recolher / expandir (global)
- Clicou no **pin** → menu some, aparece **flecha**
- Clicou na **flecha** → menu volta
- Clicou **fora do menu** → menu recolhe
- Módulo: `src/ui/dockCollapse.ts`
- Classes CSS: `dock-collapsed`, `dock-reveal`

### 4. Editor — pins por unidade (faces do prédio)
- Cada unidade do submenu tem **sua própria imagem e lista de pins**
- Ao trocar de unidade, pins de outras faces **não aparecem**
- Aba Highlights usa a imagem da unidade selecionada
- Pins de panorama (SPORTS, KIDS, etc.) **ocultos** na aba Apartamentos

### 5. Remoção do Interior Book flutuante
- Barra `1 / 1` com setas removida do site
- Navegação entre páginas do book: setas do teclado (← →)

### 6. Rollback insolação (Dia / Tarde / Noite)
- **Ida:** vídeo nativo `play()` em 1x
- **Volta:** tenta `playbackRate = -1` (mesma fluidez)
- Fallback: scrub no canvas na **mesma duração** do vídeo (sem travar em 30fps fixo)
- Arquivo: `src/core/videoTransitionPlayer.ts`

---

## Estrutura principal

| Área | Arquivos |
|------|----------|
| Site | `src/main.ts`, `src/core/engine.ts` |
| Pins panorama | `src/core/poiManager.ts` |
| Pins apartamento | `src/core/apartmentPoiManager.ts` |
| Dock / menu | `src/ui/dockCollapse.ts`, `src/ui/apartmentsNav.ts` |
| CRM | `src/config/crmConfig.ts`, `scripts/crmExcelSync.mjs` |
| Editor | `src/edit/main.ts`, `src/edit/apartmentPinsEditor.ts` |
| Estilos | `src/styles/explorer.css`, `src/edit/edit.css` |
| Vídeo / insolação | `src/core/videoTransitionPlayer.ts` |

---

## Dados do projeto

- Overrides JSON: `src/config/generated/` e `public/config/`
- Mídias custom: `public/images/custom/`
- Excel CRM: `public/crm/unidades.xlsx`
- Nomes dos pins de unidade devem bater com coluna `unidade` do Excel (ex.: `1102`)

---

## O que NÃO vai no zip (reinstalar local)

- `node_modules/` → rodar `npm install` após extrair

---

## Próximos passos sugeridos (opcional)

- Migrar pins da unidade A para outras faces no editor
- Testar rollback Dia/Tarde/Noite em todos os vídeos de insolação
- Publicar `dist/` em hospedagem estática + API admin se necessário
