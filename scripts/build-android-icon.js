/**
 * Builds the launcher icon of the Android app from the falcon of the desktop's icon.
 *
 * The sources are two SVG layers in apps/mobile/android/icon/ (foreground.svg, monochrome.svg) and the gradient of
 * resources/icon.svg as the background. From them it writes
 *   - the three vector drawables of the adaptive icon (background, foreground, monochrome) and the two XML files that
 *     put them together, for Android 8 and later (the monochrome layer is what the themed icon of Android 13 uses),
 *   - the PNGs of the icon for Android 7, which has no adaptive icons: a rounded square and a circle in five sizes.
 *
 * The vector drawables are made from the SVG layers and not drawn twice, so that the two cannot drift apart. The SVG
 * layers may only hold what is converted here: <g transform="translate() scale()">, <path> and <ellipse> with a fill, an
 * opacity and the even-odd rule.
 *
 * Rendering goes through Chromium by way of Electron, as scripts/build-icon.js does. Run it with: npm run icon:android
 * Pass --preview=<folder> to also write how the icon looks under a circle and a rounded square mask.
 */
const fs = require('fs')
const path = require('path')
const { app, BrowserWindow } = require('electron')

const ICON = path.join(__dirname, '..', 'apps', 'mobile', 'android', 'icon')
const RES = path.join(__dirname, '..', 'apps', 'mobile', 'android', 'app', 'src', 'main', 'res')
/** The gradient of resources/icon.svg, from the top down. */
const GRADIENT = ['#a78bfa', '#5b21b6']
/** The edge of the picture of a legacy icon, by density. */
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }
/** An adaptive icon is 108 units; what any launcher shows of it is the middle 72, and the safe zone is the middle 66. */
const VISIBLE = { from: 18, size: 72 }
const NOTICE = 'Made by scripts/build-android-icon.js from apps/mobile/android/icon/. Do not edit it by hand.'

const attributes = (text) => Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))

/** The transforms of the nested groups and the shapes of a layer, in the order they are drawn. */
function parseLayer(svg) {
  const groups = [...svg.matchAll(/<g transform="([^"]+)">/g)].map((m) => m[1])
  const shapes = [...svg.matchAll(/<(path|ellipse)\b([^>]*?)\/>/g)].map((m) => ({ tag: m[1], ...attributes(m[2]) }))
  return { groups, shapes }
}

const number = (n) => String(Math.round(n * 10000) / 10000)

/** `translate(a,b) scale(s)` or `translate(a,b)` as the attributes of a vector drawable group. */
function groupAttributes(transform) {
  const move = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(transform)
  const scale = /scale\(([-\d.]+)\)/.exec(transform)
  if (!move) throw new Error(`a group transform that is not understood: ${transform}`)
  const parts = [`android:translateX="${move[1]}"`, `android:translateY="${move[2]}"`]
  if (scale) parts.push(`android:scaleX="${scale[1]}"`, `android:scaleY="${scale[1]}"`)
  return parts.join(' ')
}

/** An ellipse as a path of two arcs. */
const ellipsePath = (e) => {
  const cx = Number(e.cx)
  const cy = Number(e.cy)
  const rx = Number(e.rx)
  const ry = Number(e.ry)
  return `M${number(cx - rx)} ${number(cy)}a${rx} ${ry} 0 1 0 ${number(2 * rx)} 0a${rx} ${ry} 0 1 0 ${number(-2 * rx)} 0z`
}

const argb = (hex) => `#FF${hex.replace('#', '').toUpperCase()}`

function vectorOf(svgText, what) {
  const { groups, shapes } = parseLayer(svgText)
  const lines = groups.map((g, depth) => `${'    '.repeat(depth + 1)}<group ${groupAttributes(g)}>`)
  const indent = '    '.repeat(groups.length + 1)
  for (const shape of shapes) {
    const parts = [`android:fillColor="${argb(shape.fill)}"`]
    if (shape.opacity) parts.push(`android:fillAlpha="${shape.opacity}"`)
    if (shape['fill-rule'] === 'evenodd') parts.push('android:fillType="evenOdd"')
    parts.push(`android:pathData="${shape.tag === 'ellipse' ? ellipsePath(shape) : shape.d}"`)
    lines.push(`${indent}<path ${parts.join(' ')} />`)
  }
  for (let depth = groups.length - 1; depth >= 0; depth--) lines.push(`${'    '.repeat(depth + 1)}</group>`)
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- ${what}. ${NOTICE} -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
${lines.join('\n')}
</vector>
`
}

const backgroundVector = `<?xml version="1.0" encoding="utf-8"?>
<!-- The background of the launcher icon: the violet gradient of the desktop's icon. ${NOTICE} -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:pathData="M0,0h108v108h-108z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:type="linear"
                android:startX="54"
                android:startY="0"
                android:endX="54"
                android:endY="108">
                <item android:color="${argb(GRADIENT[0])}" android:offset="0" />
                <item android:color="${argb(GRADIENT[1])}" android:offset="1" />
            </gradient>
        </aapt:attr>
    </path>
</vector>
`

const adaptiveIcon = `<?xml version="1.0" encoding="utf-8"?>
<!-- ${NOTICE} -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`

/** The picture of the icon as an SVG: the gradient and the falcon, cut to a shape out of the middle of the 108 units. */
function picture(foregroundInner, shape, size) {
  const { from, size: edge } = VISIBLE
  const clip =
    shape === 'round'
      ? `<circle cx="${from + edge / 2}" cy="${from + edge / 2}" r="${edge / 2}"/>`
      : `<rect x="${from}" y="${from}" width="${edge}" height="${edge}" rx="${edge * 0.18}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${from} ${from} ${edge} ${edge}" width="${size}" height="${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GRADIENT[0]}"/><stop offset="1" stop-color="${GRADIENT[1]}"/></linearGradient>
    <clipPath id="c">${clip}</clipPath>
  </defs>
  <g clip-path="url(#c)"><rect width="108" height="108" fill="url(#g)"/>${foregroundInner}</g>
</svg>`
}

/** What is inside the root element of an SVG, without its comments. */
const innerOf = (svg) =>
  svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')

async function render(win, svg) {
  await win.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
  )
  // As scripts/build-icon.js has it: Chromium needs a moment before the gradient is in place.
  await new Promise((r) => setTimeout(r, 500))
  return win.webContents.capturePage()
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

app.on('ready', async () => {
  const foreground = fs.readFileSync(path.join(ICON, 'foreground.svg'), 'utf8')
  const monochrome = fs.readFileSync(path.join(ICON, 'monochrome.svg'), 'utf8')

  write(path.join(RES, 'drawable', 'ic_launcher_background.xml'), backgroundVector)
  write(path.join(RES, 'drawable', 'ic_launcher_foreground.xml'), vectorOf(foreground, 'The foreground of the launcher icon: the falcon'))
  write(path.join(RES, 'drawable', 'ic_launcher_monochrome.xml'), vectorOf(monochrome, 'The monochrome layer of the launcher icon, for the themed icon'))
  write(path.join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptiveIcon)
  write(path.join(RES, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptiveIcon)

  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  const inner = innerOf(foreground)
  for (const [shape, name] of [['square', 'ic_launcher'], ['round', 'ic_launcher_round']]) {
    const big = await render(win, picture(inner, shape, 512))
    for (const [density, size] of Object.entries(DENSITIES)) {
      write(path.join(RES, `mipmap-${density}`, `${name}.png`), big.resize({ width: size, height: size, quality: 'best' }).toPNG())
    }
  }

  const preview = process.argv.find((a) => a.startsWith('--preview='))
  if (preview) {
    const folder = preview.slice('--preview='.length)
    fs.mkdirSync(folder, { recursive: true })
    const cases = [
      ['circle', picture(inner, 'round', 512)],
      ['square', picture(inner, 'square', 512)],
      ['monochrome', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="18 18 72 72" width="512" height="512"><rect x="18" y="18" width="72" height="72" fill="#d7e3ff"/><g fill="none">${innerOf(monochrome).replace(/#ffffff/g, '#1a3a73')}</g></svg>`]
    ]
    for (const [name, svg] of cases) {
      const image = await render(win, svg)
      fs.writeFileSync(path.join(folder, `preview-${name}.png`), image.toPNG())
    }
  }

  console.log('launcher icon written: 3 vector drawables, 2 adaptive icon files, 10 PNGs for Android 7')
  app.quit()
})
