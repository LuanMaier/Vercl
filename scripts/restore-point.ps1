param(
  [Parameter(Mandatory = $true)]
  [string]$From
)

$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path $From)) {
  Write-Error "Pasta de restauração não encontrada: $From"
  exit 1
}

Copy-Item -Recurse -Force (Join-Path $From "src") (Join-Path $root "src")
foreach ($f in @("vite.config.ts", "tsconfig.json", "index.html", "edit.html", "admin.html", "package.json")) {
  $src = Join-Path $From $f
  if (Test-Path $src) {
    Copy-Item -Force $src (Join-Path $root $f)
  }
}

Write-Output "Restaurado de: $From"
