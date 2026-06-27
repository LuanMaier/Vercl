/**
 * Gera versões leves dos vídeos em public/media/mobile/ (mesma estrutura).
 * Desktop continua usando public/media/ — mobile usa /media/mobile/ com fallback.
 *
 * Uso: npm run media:mobile
 *      npm run media:mobile -- --force
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.join(__dirname, '..')
const mediaRoot = path.join(projectRoot, 'public', 'media')
const mobileRoot = path.join(mediaRoot, 'mobile')

const MAX_WIDTH = 1280
const CRF = '28'
const PRESET = 'medium'
const force = process.argv.includes('--force')

const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov'])

function walkVideos(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = path.relative(mediaRoot, full)
    if (rel.startsWith(`mobile${path.sep}`) || rel === 'mobile') continue
    const st = fs.statSync(full)
    if (st.isDirectory()) walkVideos(full, out)
    else if (VIDEO_EXT.has(path.extname(name).toLowerCase())) out.push(full)
  }
  return out
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    proc.stderr.on('data', (c) => {
      err += c
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(err.slice(-800) || `ffmpeg exit ${code}`))
    })
    proc.on('error', reject)
  })
}

async function transcode(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const ext = path.extname(dest).toLowerCase()
  const vf = `scale='min(${MAX_WIDTH},iw)':-2`

  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-an', '-vf', vf]

  if (ext === '.webm') {
    args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', dest)
  } else {
    args.push(
      '-c:v',
      'libx264',
      '-preset',
      PRESET,
      '-crf',
      CRF,
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      dest,
    )
  }

  await runFfmpeg(args)
}

async function main() {
  const videos = walkVideos(mediaRoot)
  if (!videos.length) {
    console.log('Nenhum vídeo em public/media/.')
    return
  }

  console.log(`Encontrados ${videos.length} vídeos. Saída: public/media/mobile/`)
  console.log(`Perfil: até ${MAX_WIDTH}px, CRF ${CRF}\n`)

  let done = 0
  let skipped = 0

  for (const src of videos) {
    const rel = path.relative(mediaRoot, src)
    const dest = path.join(mobileRoot, rel)
    const srcMb = (fs.statSync(src).size / (1024 * 1024)).toFixed(1)

    if (
      !force &&
      fs.existsSync(dest) &&
      fs.statSync(dest).mtimeMs >= fs.statSync(src).mtimeMs - 1000
    ) {
      skipped++
      console.log(`  skip  ${rel}`)
      continue
    }

    process.stdout.write(`  → ${rel} (${srcMb} MB)... `)
    const t0 = Date.now()
    try {
      await transcode(src, dest)
      const destMb = (fs.statSync(dest).size / (1024 * 1024)).toFixed(1)
      const sec = ((Date.now() - t0) / 1000).toFixed(0)
      console.log(`${destMb} MB (${sec}s)`)
      done++
    } catch (e) {
      console.log('ERRO')
      console.error(e instanceof Error ? e.message : e)
      process.exitCode = 1
      return
    }
  }

  fs.writeFileSync(path.join(mobileRoot, '.ready'), `${new Date().toISOString()}\n`)
  console.log(`\nPronto: ${done} gerados, ${skipped} já atualizados.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
