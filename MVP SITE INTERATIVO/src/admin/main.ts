import '../styles/explorer.css'
import './admin.css'
import {
  createSession,
  getSafeRedirectNext,
  isAdminConfigured,
  isAuthenticated,
  verifyCredentials,
} from '../auth/adminAuth'

const root = document.getElementById('admin-app')!

if (isAuthenticated()) {
  location.replace(getSafeRedirectNext())
} else {
  renderLogin()
}

function renderLogin() {
  const configured = isAdminConfigured()

  root.innerHTML = `
    <div class="admin-card">
      <div class="admin-badge">Área restrita</div>
      <h1>Acesso administrativo</h1>
      <p class="admin-lead">Edição de pins e configuração interna — somente equipe autorizada.</p>
      ${
        configured
          ? `
        <form id="admin-form" class="admin-form">
          <label for="admin-user">Usuário</label>
          <input id="admin-user" name="user" type="text" autocomplete="username" required />
          <label for="admin-pass">Senha</label>
          <input id="admin-pass" name="pass" type="password" autocomplete="current-password" required />
          <p class="admin-error" id="admin-error" hidden></p>
          <button type="submit" class="admin-submit">Entrar</button>
        </form>
      `
          : `
        <p class="admin-setup">
          Crie o arquivo <code>.env.local</code> na raiz com <code>VITE_ADMIN_USER</code> e
          <code>VITE_ADMIN_PASSWORD_HASH</code>. Rode <code>npm run admin:hash</code> para gerar o hash.
        </p>
      `
      }
      <a href="/" class="admin-back">← Voltar ao site público</a>
    </div>
  `

  if (!configured) return

  const form = document.getElementById('admin-form') as HTMLFormElement
  const errorEl = document.getElementById('admin-error')!

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    errorEl.hidden = true

    const user = (document.getElementById('admin-user') as HTMLInputElement).value
    const pass = (document.getElementById('admin-pass') as HTMLInputElement).value
    const ok = await verifyCredentials(user, pass)

    if (!ok) {
      errorEl.textContent = 'Usuário ou senha incorretos.'
      errorEl.hidden = false
      return
    }

    createSession(user)
    location.replace(getSafeRedirectNext())
  })
}
