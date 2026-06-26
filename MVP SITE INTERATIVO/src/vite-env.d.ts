/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ADMIN_USER: string
  readonly VITE_ADMIN_PASSWORD_HASH: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
