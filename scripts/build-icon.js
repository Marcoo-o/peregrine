/**
 * Builds resources/icon.png and resources/icon.ico from the two SVG sources.
 *
 * Two sources, because a .ico may carry a different image per size and here it has to. From 32
 * pixels downwards the eye and the malar stripe of the full drawing merge into one dark smudge.
 * `icon-small.svg` is the same figure without those two parts. At 48 pixels and above the full
 * drawing holds, below it does not.
 *
 * Rendering goes through Chromium by way of Electron, because that antialiases the edges the
 * same way they will later appear on screen. Run it with: npm run icon
 */
const fs = require('fs')
const path = require('path')
const { app, BrowserWindow } = require('electron')

const RES = path.join(__dirname, '..', 'resources')
/** The size from which the full drawing is used. */
const FULL_FROM = 48
const SIZES = [256, 128, 64, 48, 32, 24, 16]

async function render(win, svgPath) {
  const svg = fs.readFileSync(svgPath, 'utf8')
  await win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  )
  // Chromium needs a moment before the gradient is in place. Without the wait the capture comes
  // back empty.
  await new Promise((r) => setTimeout(r, 700))
  return win.webContents.capturePage()
}

/**
 * Assembles the individual PNG images into one .ico.
 *
 * A .ico is a directory of images. A header, one entry per size carrying an offset and a
 * length, then the image data. Windows picks the size it needs itself. Supplying only one would
 * mean letting it scale, and that looks like mud at 16 pixels.
 */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // type 1 is icon
  header.writeUInt16LE(images.length, 4)

  let offset = 6 + images.length * 16
  const entries = images.map(({ size, data }) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(size === 256 ? 0 : size, 0) // 0 stands for 256
    e.writeUInt8(size === 256 ? 0 : size, 1)
    e.writeUInt8(0, 2) // no colour palette
    e.writeUInt8(0, 3)
    e.writeUInt16LE(1, 4) // planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    return e
  })
  return Buffer.concat([header, ...entries, ...images.map((b) => b.data)])
}

app.on('ready', async () => {
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })

  const full = await render(win, path.join(RES, 'icon.svg'))
  const small = await render(win, path.join(RES, 'icon-small.svg'))

  // The window icon during development, where there is always room for the full drawing.
  fs.writeFileSync(path.join(RES, 'icon.png'), full.toPNG())

  const images = SIZES.map((size) => ({
    size,
    data: (size >= FULL_FROM ? full : small)
      .resize({ width: size, height: size, quality: 'best' })
      .toPNG()
  }))
  const ico = buildIco(images)
  fs.writeFileSync(path.join(RES, 'icon.ico'), ico)

  console.log(
    `icon.png written, icon.ico with ${images.length} sizes ` +
      `(${SIZES.filter((s) => s >= FULL_FROM).join(', ')} full, ` +
      `${SIZES.filter((s) => s < FULL_FROM).join(', ')} reduced), ${ico.length} bytes`
  )
  app.quit()
})
