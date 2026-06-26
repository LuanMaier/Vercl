param(
  [string]$Label = "manual"
)

$root = Split-Path $PSScriptRoot -Parent

$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
$dest = Join-Path (Join-Path $root ".restore-points") "$Label-$stamp"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $root "src") (Join-Path $dest "src")
foreach ($f in @("vite.config.ts", "tsconfig.json", "index.html", "edit.html", "admin.html", "package.json")) {
  Copy-Item -Force (Join-Path $root $f) $dest
}

@"
# Ponto de restauração local

Criado: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Pasta: $dest

## Restaurar (PowerShell, na raiz do projeto)

``````powershell
.\scripts\restore-point.ps1 -From "$dest"
``````

## Restaurar manualmente

1. Copie `src` desta pasta sobre `src` do projeto
2. Copie os arquivos de config (vite.config.ts, tsconfig.json, *.html, package.json)
"@ | Set-Content (Join-Path $dest "RESTORE.md") -Encoding UTF8

Write-Output $dest
