import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import { fileURLToPath } from 'url'
import { adminMediaPlugin } from './vite/adminMediaPlugin'

const root = path.dirname(fileURLToPath(import.meta.url))
const generatedConfigDir = path.join(root, 'src', 'config', 'generated')

/** Evita page reload do Vite quando a API grava JSON de config no editor. */
function ignoreGeneratedConfigHmr(): Plugin {
  return {
    name: 'ignore-generated-config-hmr',
    handleHotUpdate({ file }) {
      if (file.startsWith(generatedConfigDir)) {
        return []
      }
    },
  }
}

export default defineConfig({
  plugins: [adminMediaPlugin(), ignoreGeneratedConfigHmr()],
  build: {
    sourcemap: false,
    modulePreload: {
      resolveDependencies: (_filename, deps, { hostId }) => {
        // O Gaussian Splat (spark + gaussianSplatViewer) só é necessário se o
        // visitante abrir o hub "Interativo" — não precarregar no site público
        // evita baixar ~1,8 MB (gzip) em toda visita que nunca usa o splat.
        if (hostId.endsWith('index.html')) {
          return deps.filter((d) => !d.includes('vendor-spark') && !d.includes('edit-splat'))
        }
        return deps
      },
    },
    rollupOptions: {
      input: {
        main: path.resolve(root, 'index.html'),
        edit: path.resolve(root, 'edit.html'),
        admin: path.resolve(root, 'admin.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('@sparkjsdev/spark')) return 'vendor-spark'
          if (id.includes('node_modules/three')) return 'vendor-three'
          // Utilitários usados tanto pelo site (index.html) quanto pelo editor
          // (edit.html). Sem um bucket próprio, o Rollup às vezes funde esse
          // código compartilhado dentro de um chunk "edit-*" qualquer, o que
          // força o site público a baixar/precarregar bundles do editor.
          if (id.includes('/src/media/') || id.includes('/core/paths')) return 'shared-media'
          if (id.includes('/edit/bookEditor')) return 'edit-book'
          if (
            id.includes('/edit/apartmentsEditor') ||
            id.includes('/edit/apartmentPinsEditor') ||
            id.includes('/edit/apartmentHighlight')
          ) {
            return 'edit-apartments'
          }
          if (id.includes('/edit/dockEditor')) return 'edit-dock'
          if (id.includes('/edit/insolationPanel')) return 'edit-insolation'
          if (id.includes('/edit/splatEditor') || id.includes('/core/gaussianSplatViewer')) {
            return 'edit-splat'
          }
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    open: '/',
    watch: {
      ignored: [generatedConfigDir],
    },
  },
  preview: {
    port: 4174,
    strictPort: false,
    host: true,
  },
  optimizeDeps: {
    include: ['three', '@sparkjsdev/spark'],
  },
})
