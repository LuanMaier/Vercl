import type { ImageFitMode } from './coverCoords'

/** Intensidade máxima do blur (px) no meio da transição */
const MAX_BLUR_PX = 11

export function motionBlurAmount(progress: number): number {
  if (progress <= 0 || progress >= 1) return 0
  return Math.sin(progress * Math.PI) * MAX_BLUR_PX
}

export function drawImageFit(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  viewW: number,
  viewH: number,
  blurPx = 0,
  mode: ImageFitMode = 'cover',
) {
  const nw =
    'naturalWidth' in img && (img as HTMLImageElement).naturalWidth
      ? (img as HTMLImageElement).naturalWidth
      : 'videoWidth' in img && (img as HTMLVideoElement).videoWidth
        ? (img as HTMLVideoElement).videoWidth
        : 'width' in img
          ? (img as ImageBitmap).width
          : 0
  const nh =
    'naturalHeight' in img && (img as HTMLImageElement).naturalHeight
      ? (img as HTMLImageElement).naturalHeight
      : 'videoHeight' in img && (img as HTMLVideoElement).videoHeight
        ? (img as HTMLVideoElement).videoHeight
        : 'height' in img
          ? (img as ImageBitmap).height
          : 0
  if (!nw) return

  ctx.clearRect(0, 0, viewW, viewH)

  if (mode === 'contain') {
    const coverScale = Math.max(viewW / nw, viewH / nh)
    const cdw = Math.round(nw * coverScale)
    const cdh = Math.round(nh * coverScale)
    const cdx = Math.round((viewW - cdw) / 2)
    const cdy = Math.round((viewH - cdh) / 2)
    ctx.save()
    ctx.filter = 'blur(32px) brightness(0.36) saturate(1.1)'
    ctx.drawImage(img, cdx, cdy, cdw, cdh)
    ctx.restore()

    const scale = Math.min(viewW / nw, viewH / nh)
    const dw = Math.round(nw * scale)
    const dh = Math.round(nh * scale)
    const dx = Math.round((viewW - dw) / 2)
    const dy = Math.round((viewH - dh) / 2)
    if (blurPx > 0.35) {
      ctx.save()
      ctx.filter = `blur(${blurPx.toFixed(2)}px)`
      ctx.drawImage(img, dx, dy, dw, dh)
      ctx.restore()
    } else {
      ctx.drawImage(img, dx, dy, dw, dh)
    }
    return
  }

  const scale = Math.max(viewW / nw, viewH / nh)
  const dw = Math.round(nw * scale)
  const dh = Math.round(nh * scale)
  const dx = Math.round((viewW - dw) / 2)
  const dy = Math.round((viewH - dh) / 2)

  if (blurPx > 0.35) {
    ctx.save()
    ctx.filter = `blur(${blurPx.toFixed(2)}px)`
    ctx.drawImage(img, dx, dy, dw, dh)
    ctx.restore()
  } else {
    ctx.drawImage(img, dx, dy, dw, dh)
  }
}

export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  viewW: number,
  viewH: number,
  blurPx = 0,
) {
  drawImageFit(ctx, img, viewW, viewH, blurPx, 'cover')
}
