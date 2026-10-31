// Finds the texts that are written into the code of the phone application, which is what the language catalogs are made of.
//
//   node scripts/mobile-strings.mjs scan [--json]   lists what is found, by file
//   node scripts/mobile-strings.mjs baseline        writes how many each file has to scripts/mobile-strings-baseline.json
//   node scripts/mobile-strings.mjs check           fails when a file has more fixed texts than the baseline says
//   node scripts/mobile-strings.mjs keys            lists the texts that are in t(...), tn(...) and msg(...), which the catalogs have to have
//   node scripts/mobile-strings.mjs extract [--apply]  moves the fixed texts into t(...), or only says what it would do
//
// A text counts when it is something a person reads: it has words in it, and it is a JSX text, the value of an attribute that is shown (`label`, `title`,
// `placeholder`, ...), or a string that reads as a sentence or a label (a capital letter, a space or an umlaut) and is not an import, a key or a style.
// It stops counting when it is the argument of `t(...)`, `tn(...)` or `msg(...)`, which is what it is moved into.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { parse } = require('@babel/parser')
const traverse = require('@babel/traverse').default

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const appDir = join(root, 'apps', 'mobile')
const BASELINE = join(root, 'scripts', 'mobile-strings-baseline.json')

/** Attributes whose value is shown to the person. */
const SHOWN = new Set(['label', 'title', 'placeholder', 'hint', 'accessibilityLabel', 'text', 'subtitle', 'note', 'description'])
/** Attributes that are never text, whatever they hold. */
const NEVER = new Set(['style', 'key', 'testID', 'accessibilityRole', 'keyboardType', 'autoCapitalize', 'behavior', 'returnKeyType', 'textAlignVertical', 'color', 'variant', 'icon', 'src', 'source', 'name', 'onPress', 'value', 'selectionColor', 'keyExtractor'])

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'android' || name === 'ios' || name === 'build') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name) && !path.includes(`${sep}testing${sep}`)) out.push(path)
  }
  return out
}

const hasWords = (text) => /[A-Za-zÄÖÜäöüß]{3,}/.test(text)
/** Reads as a text for a person: a sentence or a label, not an identifier, a path, a key or a flag. */
function looksLikeText(text) {
  const t = text.trim()
  if (!hasWords(t)) return false
  if (/^[a-z][A-Za-z0-9_.-]*$/.test(t)) return false // identifier, key, route
  if (/^[\\/@.#]|:\/\/|^\w+:\w/.test(t)) return false // path, scheme, header
  if (/^\\?[A-Za-z]+$/.test(t) && /^\\/.test(t)) return false // an IMAP flag
  if (/^[A-Z][A-Z0-9_]+$/.test(t)) return false // CONSTANT
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|WITH|BEGIN|EXISTS)\b/i.test(t)) return false // SQL
  if (/\b(LIKE \?|ESCAPE|json_each|NOT NULL|date_ms|account_id|special_use)\b|^NOT \{\}$|^\(?[a-z]\.[a-z_]+/.test(t)) return false // SQL
  if (/function\s*\(|=>|\bvar \w+ =/.test(t)) return false // code
  if (/<\/?[a-z][a-z0-9]*[ >/]|<!doctype|^[a-z-]+\{|^[a-z_]+(, [a-z_]+){3,}/i.test(t)) return false // HTML, CSS, a list of columns
  if (/^(This|The|A|An|Not connected|Sending at|NotSupported|Peregrine[A-Z]|nothing to do|application\/)\b/.test(t) && !/[ÄÖÜäöüß]/.test(t)) return false // an English message for the developer
  return /[ÄÖÜäöüß]/.test(t) || /\s/.test(t) || /^[A-ZÄÖÜ][a-zäöüß]{2,}/.test(t)
}

function scanFile(path) {
  const text = readFileSync(path, 'utf8')
  const ast = parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true })
  const found = []
  const add = (node, value, kind) => found.push({ line: node.loc.start.line, kind, text: value })

  /** Whether the node is inside the call of `t(...)` or `tn(...)`, which is where a text is moved to. */
  const inT = (nodePath) =>
    nodePath.findParent((p) => p.isCallExpression() && p.node.callee.type === 'Identifier' && (p.node.callee.name === 't' || p.node.callee.name === 'tn' || p.node.callee.name === 'msg')) !== null
  const COMPARE = new Set(['===', '!==', '==', '!='])
  const QUIET_CALLS = new Set(['test', 'includes', 'startsWith', 'endsWith', 'indexOf', 'localeCompare', 'toLocaleDateString', 'toLocaleString', 'toLocaleTimeString', 'get', 'set', 'has', 'run', 'all', 'exec', 'command', 'warn', 'error', 'on', 'emit', 'addEventListener'])
  const skip = (nodePath) => {
    const parent = nodePath.parent
    if (!parent) return false
    if (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportAllDeclaration') return true
    if (parent.type === 'TSLiteralType' || parent.type === 'TSEnumMember') return true
    if ((parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && parent.key === nodePath.node && !parent.computed) return true
    if (parent.type === 'MemberExpression' && parent.computed && parent.property === nodePath.node) return true
    if (parent.type === 'SwitchCase') return true
    if (parent.type === 'BinaryExpression' && COMPARE.has(parent.operator)) return true
    if (parent.type === 'CallExpression' && parent.callee.type === 'Identifier' && parent.callee.name === 'require') return true
    // What is written to a log is for the developer and stays as it is.
    if (nodePath.findParent((p) => p.isCallExpression() && p.node.callee.type === 'MemberExpression' && p.node.callee.property.type === 'Identifier' && ['warn', 'error', 'log', 'info', 'debug'].includes(p.node.callee.property.name))) return true
    if (parent.type === 'CallExpression' && parent.callee.type === 'MemberExpression' && parent.callee.property.type === 'Identifier' && QUIET_CALLS.has(parent.callee.property.name) && parent.arguments.includes(nodePath.node)) return true
    return false
  }

  traverse(ast, {
    JSXText(nodePath) {
      const value = nodePath.node.value.replace(/\s+/g, ' ').trim()
      if (value && hasWords(value)) add(nodePath.node, value, 'jsx')
    },
    JSXAttribute(nodePath) {
      const { name, value } = nodePath.node
      if (!value || value.type !== 'StringLiteral' || name.type !== 'JSXIdentifier') return
      if (NEVER.has(name.name) || !hasWords(value.value)) return
      if (SHOWN.has(name.name) || looksLikeText(value.value)) add(value, value.value, `attr:${name.name}`)
    },
    StringLiteral(nodePath) {
      if (nodePath.parent.type === 'JSXAttribute' || inT(nodePath) || skip(nodePath)) return
      if (looksLikeText(nodePath.node.value)) add(nodePath.node, nodePath.node.value, 'string')
    },
    TemplateLiteral(nodePath) {
      if (inT(nodePath) || skip(nodePath)) return
      const { quasis } = nodePath.node
      const flat = quasis.map((q) => q.value.cooked ?? '').join('{}')
      if (looksLikeText(flat)) add(nodePath.node, flat, quasis.length > 1 ? 'template' : 'string')
    }
  })
  return found
}


/** `'text'` written as a string literal in the code, with the quote and the backslash escaped and nothing else. */
function quoted(text) {
  return `'${JSON.stringify(text).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`
}

/** A name for what is put into a text, from the expression: `error`, `account.name` is `name`, and for the rest `n`. Each name once for a text. */
function paramName(expression, used) {
  let base = 'n'
  if (expression.type === 'Identifier') base = expression.name
  else if (expression.type === 'MemberExpression' && !expression.computed && expression.property.type === 'Identifier') base = expression.property.name
  let name = base
  for (let i = 2; used.has(name); i++) name = `${base}${i}`
  used.add(name)
  return name
}

const isFunctionLike = (p) => p.isFunction() || p.isClassMethod() || p.isClassPrivateMethod() || p.isObjectMethod()

/**
 * The edits that move the texts of a file into `t(...)`: each is a range of the source and what replaces it. A text at the top of the module, outside any
 * function, cannot be asked for yet (the language is not chosen when the module is read), so it is marked `msg(...)` and shown with `t(label)` where it is used.
 */
function editsFor(path) {
  const text = readFileSync(path, 'utf8')
  const ast = parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true })
  const edits = []
  const used = new Set()
  const inT = (nodePath) => nodePath.findParent((p) => p.isCallExpression() && p.node.callee.type === 'Identifier' && ['t', 'tn', 'msg'].includes(p.node.callee.name)) !== null
  const topLevel = (nodePath) => nodePath.findParent(isFunctionLike) === null
  const call = (nodePath) => (topLevel(nodePath) ? 'msg' : 't')
  const COMPARE = new Set(['===', '!==', '==', '!='])
  const QUIET_CALLS = new Set(['test', 'includes', 'startsWith', 'endsWith', 'indexOf', 'localeCompare', 'toLocaleDateString', 'toLocaleString', 'toLocaleTimeString', 'get', 'set', 'has', 'run', 'all', 'exec', 'command', 'warn', 'error', 'on', 'emit', 'addEventListener'])
  const skip = (nodePath) => {
    const parent = nodePath.parent
    if (!parent) return false
    if (parent.type === 'ImportDeclaration' || parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportAllDeclaration') return true
    if (parent.type === 'TSLiteralType' || parent.type === 'TSEnumMember') return true
    if ((parent.type === 'ObjectProperty' || parent.type === 'ObjectMethod') && parent.key === nodePath.node && !parent.computed) return true
    if (parent.type === 'MemberExpression' && parent.computed && parent.property === nodePath.node) return true
    if (parent.type === 'SwitchCase') return true
    if (parent.type === 'BinaryExpression' && COMPARE.has(parent.operator)) return true
    if (parent.type === 'CallExpression' && parent.callee.type === 'Identifier' && parent.callee.name === 'require') return true
    if (nodePath.findParent((p) => p.isCallExpression() && p.node.callee.type === 'MemberExpression' && p.node.callee.property.type === 'Identifier' && ['warn', 'error', 'log', 'info', 'debug'].includes(p.node.callee.property.name))) return true
    if (parent.type === 'CallExpression' && parent.callee.type === 'MemberExpression' && parent.callee.property.type === 'Identifier' && QUIET_CALLS.has(parent.callee.property.name) && parent.arguments.includes(nodePath.node)) return true
    return false
  }
  const manual = []

  traverse(ast, {
    JSXText(nodePath) {
      const node = nodePath.node
      const value = node.value.replace(/\s+/g, ' ').trim()
      if (!value || !hasWords(value)) return
      const siblings = nodePath.parent.children
      if (siblings.some((child) => child.type === 'JSXExpressionContainer' || child.type === 'JSXElement')) {
        manual.push({ line: node.loc.start.line, text: value, why: 'text next to other children' })
        return
      }
      const raw = text.slice(node.start, node.end)
      const lead = raw.match(/^\s*/)[0]
      const trail = raw.match(/\s*$/)[0]
      edits.push({ start: node.start, end: node.end, make: () => `${lead}{t(${quoted(value)})}${trail}`, key: value, kind: 'jsx' })
    },
    JSXAttribute(nodePath) {
      const { name, value } = nodePath.node
      if (!value || value.type !== 'StringLiteral' || name.type !== 'JSXIdentifier') return
      if (NEVER.has(name.name) || !hasWords(value.value)) return
      if (SHOWN.has(name.name) || looksLikeText(value.value)) edits.push({ start: value.start, end: value.end, make: () => `{t(${quoted(value.value)})}`, key: value.value, kind: 'attr' })
    },
    StringLiteral(nodePath) {
      if (nodePath.parent.type === 'JSXAttribute' || inT(nodePath) || skip(nodePath)) return
      if (!looksLikeText(nodePath.node.value)) return
      const fn = call(nodePath)
      const n = nodePath.node
      edits.push({ start: n.start, end: n.end, make: () => `${fn}(${quoted(n.value)})`, key: n.value, kind: fn })
    },
    TemplateLiteral(nodePath) {
      if (inT(nodePath) || skip(nodePath)) return
      const node = nodePath.node
      const flat = node.quasis.map((q) => q.value.cooked ?? '').join('{}')
      if (!looksLikeText(flat)) return
      const fn = call(nodePath)
      if (node.expressions.length === 0) {
        edits.push({ start: node.start, end: node.end, make: () => `${fn}(${quoted(flat)})`, key: flat, kind: fn })
        return
      }
      if (fn === 'msg') {
        manual.push({ line: node.loc.start.line, text: flat, why: 'a text with values at the top of a module' })
        return
      }
      const names = new Set()
      let key = node.quasis[0].value.cooked ?? ''
      const params = []
      node.expressions.forEach((expression, index) => {
        const name = paramName(expression, names)
        key += `{${name}}${node.quasis[index + 1].value.cooked ?? ''}`
        params.push({ name, expression })
      })
      edits.push({ start: node.start, end: node.end, make: (inner) => `t(${quoted(key)}, { ${params.map(({ name, expression }) => (name === expression.name && expression.type === 'Identifier' ? name : `${name}: ${inner(expression.start, expression.end)}`)).join(', ')} })`, key, kind: 't', template: true })
    }
  })
  return { text, edits, manual }
}

/** The source with the edits applied; an edit inside the expression of a template is applied to the text that goes into the call. */
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end)
  const render = (from, to, within) => {
    let out = ''
    let at = from
    for (const edit of within) {
      if (edit.start < at) continue
      out += text.slice(at, edit.start)
      const inside = within.filter((other) => other !== edit && other.start >= edit.start && other.end <= edit.end)
      out += edit.make((a, b) => render(a, b, inside.filter((other) => other.start >= a && other.end <= b)))
      at = edit.end
    }
    return out + text.slice(at, to)
  }
  return render(0, text.length, sorted)
}

/** The import of what the file now uses, after its last import, and the path to the module from the file. */
function withImport(text, usesT, usesMsg, path) {
  const names = [usesT && 't', usesMsg && 'msg'].filter(Boolean)
  if (names.length === 0) return text
  const rel = relative(join(path, '..'), join(appDir, 'src', 'i18n')).split(sep).join('/')
  const target = path.endsWith(`${sep}App.tsx`) ? './src/i18n' : rel.startsWith('.') ? rel : `./${rel}`
  const existing = /import \{([^}]*)\} from '(\.{1,2}\/)+i18n'\n/.exec(text)
  if (existing) {
    const have = new Set(existing[1].split(',').map((x) => x.trim()).filter(Boolean))
    names.forEach((n) => have.add(n))
    return text.replace(existing[0], `import { ${[...have].sort().join(', ')} } from '${existing[0].match(/from '([^']+)'/)[1]}'\n`)
  }
  const importPattern = /^import[\s\S]*?from '[^']+'\n|^import '[^']+'\n/gm
  let end = 0
  for (const match of text.matchAll(importPattern)) end = match.index + match[0].length
  return `${text.slice(0, end)}import { ${names.join(', ')} } from '${target}'\n${text.slice(end)}`
}

function extractAll(apply) {
  const report = { files: 0, texts: 0, manual: [], keys: new Set() }
  for (const path of [...files(join(appDir, 'src')), join(appDir, 'App.tsx')]) {
    if (path.endsWith(`${sep}i18n.ts`)) continue
    const { text, edits, manual } = editsFor(path)
    const file = relative(root, path).split(sep).join('/')
    for (const item of manual) report.manual.push({ file, ...item })
    if (edits.length === 0) continue
    report.files++
    report.texts += edits.length
    for (const edit of edits) report.keys.add(edit.key)
    if (apply) {
      let next = applyEdits(text, edits)
      next = withImport(next, edits.some((e) => e.kind !== 'msg'), edits.some((e) => e.kind === 'msg'), path)
      writeFileSync(path, next)
    }
  }
  return report
}


/** The texts that are in `t(...)`, `tn(...)` (as `one|other`) and `msg(...)` over the whole application: what the catalogs have to have. */
export function usedKeys() {
  const keys = new Set()
  for (const path of [...files(join(appDir, 'src')), join(appDir, 'App.tsx')]) {
    const ast = parse(readFileSync(path, 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true })
    traverse(ast, {
      CallExpression(nodePath) {
        const { callee, arguments: args } = nodePath.node
        if (callee.type !== 'Identifier') return
        const literal = (node) => (node && node.type === 'StringLiteral' ? node.value : null)
        if (callee.name === 't' || callee.name === 'msg') {
          const key = literal(args[0])
          if (key !== null) keys.add(key)
        } else if (callee.name === 'tn') {
          const one = literal(args[1])
          const other = literal(args[2])
          if (one !== null && other !== null) keys.add(`${one}|${other}`)
        }
      }
    })
  }
  return keys
}

export function scanAll() {
  const result = {}
  for (const path of [...files(join(appDir, 'src')), join(appDir, 'App.tsx')]) {
    const found = scanFile(path)
    if (found.length > 0) result[relative(root, path).split(sep).join('/')] = found
  }
  return result
}

if (process.argv[1] && /mobile-strings\.mjs$/.test(process.argv[1])) {
  const [command, ...flags] = process.argv.slice(2)
  const scan = ['scan', 'baseline', 'check'].includes(command) ? scanAll() : {}
  const counts = Object.fromEntries(Object.entries(scan).map(([file, found]) => [file, found.length]).sort())

  if (command === 'scan') {
    if (flags.includes('--json')) console.log(JSON.stringify(scan, null, 2))
    else {
      for (const [file, found] of Object.entries(scan)) {
        console.log(`${file} (${found.length})`)
        for (const item of found) console.log(`  ${item.line}\t${item.kind}\t${JSON.stringify(item.text)}`)
      }
      console.log(`\n${Object.values(counts).reduce((a, b) => a + b, 0)} texts in ${Object.keys(counts).length} files`)
    }
  } else if (command === 'keys') {
    console.log(JSON.stringify([...usedKeys()].sort(), null, 2))
  } else if (command === 'extract') {
    const apply = flags.includes('--apply')
    const report = extractAll(apply)
    console.log(`${apply ? 'moved' : 'would move'} ${report.texts} texts in ${report.files} files (${report.keys.size} different)`)
    for (const item of report.manual) console.log(`  by hand: ${item.file}:${item.line}  ${item.why}: ${JSON.stringify(item.text)}`)
  } else if (command === 'baseline') {
    writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n')
    console.log(`baseline written: ${Object.values(counts).reduce((a, b) => a + b, 0)} texts in ${Object.keys(counts).length} files`)
  } else if (command === 'check') {
    const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
    const more = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0))
    if (more.length > 0) {
      for (const [file, n] of more) console.error(`${file}: ${n} fixed texts, the baseline allows ${baseline[file] ?? 0}. Move the new ones into t('...').`)
      process.exit(1)
    }
    console.log('OK: no new fixed texts')
  } else {
    console.error('usage: node scripts/mobile-strings.mjs scan [--json] | baseline | check')
    process.exit(2)
  }

}
