import { Menu, MenuItem, session, type BrowserWindow } from 'electron'

/**
 * Spell checking while writing.
 *
 * Chromium does the checking; what it does not do is offer the corrections. Without a context
 * menu the red underline is a reproach with no remedy. You can see that a word is wrong and
 * have no way to fix it except retyping. So the menu is the feature, not the underline.
 *
 * The dictionaries are Chromium's own and are fetched once per language, then cached. Nothing
 * of what is typed leaves the machine: the check runs locally against those word lists.
 */

/**
 * German and English at once, because that is how the mail actually looks.
 *
 * Chromium checks every enabled language in parallel and only flags a word none of them know,
 * so a mixed message does not light up in red. The list is filtered against what this build
 * actually ships. Asking for a language Chromium does not have throws.
 */
const WANTED = ['de', 'en-US']

export function configureSpellChecker(): void {
  const available = session.defaultSession.availableSpellCheckerLanguages
  const languages = WANTED.filter((language) => available.includes(language))
  if (languages.length === 0) return
  session.defaultSession.setSpellCheckerLanguages(languages)
}

/**
 * The editing context menu for one window.
 *
 * Electron ships no context menu at all, so cut/copy/paste are added alongside the
 * corrections. Otherwise right-clicking a text field would offer spelling help but not the
 * clipboard, which is the odder half to be missing.
 */
interface MenuTexts {
  addToDictionary: string
  cut: string
  copy: string
  paste: string
}

/**
 * Same approach as the notification strings: one small table.
 *
 * Kept here rather than read from the renderer's translation files: this menu is built in
 * the main process, and four words are cheaper to repeat than a second i18next instance
 * loaded for them.
 */
const TEXTS: Record<string, MenuTexts> = {
  de: {
    addToDictionary: 'Zum Wörterbuch hinzufügen',
    cut: 'Ausschneiden',
    copy: 'Kopieren',
    paste: 'Einfügen'
  },
  en: {
    addToDictionary: 'Add to dictionary',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste'
  },
  es: {
    addToDictionary: 'Añadir al diccionario',
    cut: 'Cortar',
    copy: 'Copiar',
    paste: 'Pegar'
  },
  fr: {
    addToDictionary: 'Ajouter au dictionnaire',
    cut: 'Couper',
    copy: 'Copier',
    paste: 'Coller'
  },
  pt: {
    addToDictionary: 'Adicionar ao dicionário',
    cut: 'Recortar',
    copy: 'Copiar',
    paste: 'Colar'
  }
}

export function menuTexts(language: string, systemLocale: string): MenuTexts {
  const tag = language === 'system' ? systemLocale : language
  return TEXTS[tag.slice(0, 2).toLowerCase()] ?? TEXTS.en
}

export function attachEditingMenu(win: BrowserWindow, texts: () => Promise<MenuTexts>): void {
  win.webContents.on('context-menu', async (_event, params) => {
    const labels = await texts()
    const menu = new Menu()

    for (const suggestion of params.dictionarySuggestions) {
      menu.append(
        new MenuItem({
          label: suggestion,
          click: () => win.webContents.replaceMisspelling(suggestion)
        })
      )
    }

    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length > 0) {
        menu.append(new MenuItem({ type: 'separator' }))
      }
      // A name Chromium does not know is not a mistake, and teaching it once is kinder than
      // stepping over the same underline every time.
      menu.append(
        new MenuItem({
          label: labels.addToDictionary,
          click: () =>
            session.defaultSession.addWordToSpellCheckerDictionary(params.misspelledWord)
        })
      )
      menu.append(new MenuItem({ type: 'separator' }))
    }

    if (params.isEditable || params.selectionText) {
      if (params.isEditable) menu.append(new MenuItem({ role: 'cut', label: labels.cut }))
      menu.append(new MenuItem({ role: 'copy', label: labels.copy }))
      if (params.isEditable) menu.append(new MenuItem({ role: 'paste', label: labels.paste }))
    }

    // Nothing to offer: no menu at all rather than an empty box.
    if (menu.items.length === 0) return
    menu.popup({ window: win })
  })
}
