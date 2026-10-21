import { StyleSheet } from 'react-native'
import { SIZE, withAlpha, type Theme } from './theme'

/**
 * The look of the screens, made from the tokens of a theme. The same shapes as the desktop's: a page, what
 * stands out of it with a thin border, an accent for what can be done and for what is chosen, a tint of
 * red for what went wrong. Nothing here names a colour: they all come from the palette.
 */
function createStyles({ colors }: Theme) {
  const field = {
    minHeight: SIZE.target,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: SIZE.radius,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text
  } as const

  const button = {
    minHeight: SIZE.target,
    borderRadius: SIZE.radius,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center'
  } as const

  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background, paddingHorizontal: SIZE.padding, paddingTop: SIZE.gap },
    fill: { flex: 1 },
    centerContent: { justifyContent: 'center', alignItems: 'center' },
    form: { gap: 12, paddingBottom: SIZE.padding },
    row: { flexDirection: 'row', gap: SIZE.gap },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SIZE.gap, marginVertical: SIZE.gap },

    // The top of a screen: the way back, and what the screen is.
    back: { minHeight: SIZE.target, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    backText: { color: colors.accent, fontSize: 16, fontWeight: '500' },
    title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: 8 },
    subtitle: { fontSize: 14, color: colors.muted, marginBottom: 8 },

    hint: { color: colors.muted, fontSize: 14, lineHeight: 20, marginBottom: SIZE.gap },
    // What went wrong, in a block of its own so that it is not taken for part of the list.
    error: {
      color: colors.danger,
      backgroundColor: colors.dangerSoft,
      borderRadius: SIZE.radius,
      padding: 12,
      marginVertical: SIZE.gap,
      fontSize: 14,
      lineHeight: 20
    },
    // What is going on behind the screen: no connection, what waits for one.
    status: { backgroundColor: colors.accentSoft, borderRadius: SIZE.radius, padding: 12, marginBottom: SIZE.gap },
    statusText: { color: colors.accent, fontSize: 14 },
    statusProblem: { color: colors.danger, fontSize: 14, marginTop: 4 },
    pending: { fontSize: 13, color: colors.accent, marginTop: 2 },

    input: field,
    inputFocused: { borderColor: colors.accent },
    multiline: { minHeight: 200 },

    button: { ...button, backgroundColor: colors.accent, borderColor: colors.accent, marginTop: SIZE.gap },
    buttonSecondary: { ...button, backgroundColor: colors.surface, borderColor: colors.border, marginTop: SIZE.gap },
    buttonDanger: { ...button, backgroundColor: colors.surface, borderColor: colors.danger, marginTop: SIZE.gap },
    buttonDisabled: { opacity: 0.4 },
    buttonText: { color: colors.onAccent, fontSize: 16, fontWeight: '600' },
    buttonTextSecondary: { color: colors.text, fontSize: 16, fontWeight: '600' },
    buttonTextDanger: { color: colors.danger, fontSize: 16, fontWeight: '600' },

    // What is chosen out of several, and a small thing to do.
    chip: {
      minHeight: 40,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: 999,
      paddingHorizontal: 16,
      justifyContent: 'center'
    },
    chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    chipText: { color: colors.text, fontSize: 15 },
    chipTextActive: { color: colors.accent, fontSize: 15, fontWeight: '600' },

    // A line of a list.
    item: {
      minHeight: SIZE.target,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border
    },
    itemTitle: { fontSize: 16, color: colors.text },
    // A line that leads somewhere: the colour of an account, the name, a count and an arrow.
    listRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    dot: { width: 10, height: 10, borderRadius: 5 },
    expander: { width: 28, height: 32, alignItems: 'center', justifyContent: 'center' },
    rowIcon: { width: 24, alignItems: 'center' },
    count: {
      minWidth: 24,
      textAlign: 'center',
      overflow: 'hidden',
      fontSize: 12,
      fontWeight: '700',
      color: colors.accent,
      backgroundColor: colors.accentSoft,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2
    },
    // A message in a list: a stripe for the account, and two lines.
    messageRow: { flexDirection: 'row', gap: 10 },
    stripe: { width: 4, borderRadius: 2, alignSelf: 'stretch' },
    messageHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
    sender: { flex: 1, fontSize: 15, color: colors.muted },
    from: { fontSize: 15, color: colors.text },
    date: { fontSize: 12, color: colors.muted },
    subject: { fontSize: 15, color: colors.muted },
    // What has not been read is in the colour of the text, and the rest is muted.
    unread: { fontWeight: '700', color: colors.text },
    itemMeta: { fontSize: 13, color: colors.muted, marginTop: 2 },
    link: { color: colors.accent, fontSize: 16, paddingVertical: 4 },
    spinner: { marginVertical: SIZE.gap },

    // What a message has to say for itself, above its text.
    notice: { borderRadius: SIZE.radius, borderWidth: 1, padding: 12, marginBottom: SIZE.gap },
    noticeHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    noticeInfo: { backgroundColor: colors.accentSoft, borderColor: 'transparent' },
    // What is worth knowing is in the colour of a warning, as a tint with a thin edge, as on the desktop.
    noticeWarning: { backgroundColor: withAlpha(colors.warning, 0.12), borderColor: withAlpha(colors.warning, 0.5) },
    noticeDanger: { backgroundColor: colors.dangerSoft, borderColor: 'transparent' },
    noticeTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
    noticeDetail: { fontSize: 13, lineHeight: 18, marginTop: 4, color: colors.text },
    noticeAction: { color: colors.accent, fontSize: 14, fontWeight: '600', marginTop: 8 },

    // Who a message is from.
    markRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    senderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: SIZE.gap },
    avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    avatarText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
    senderName: { fontSize: 16, fontWeight: '600', color: colors.text },
    senderAddress: { fontSize: 13, color: colors.muted },

    // A question that has to be answered, and a choice of what to do.
    backdrop: { flex: 1, backgroundColor: '#00000099', justifyContent: 'center', padding: 24 },
    sheetBackdrop: { flex: 1, backgroundColor: '#00000099', justifyContent: 'flex-end' },
    dialog: { backgroundColor: colors.surface, borderRadius: 12, padding: 16, gap: 8 },
    dialogTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
    mono: { fontFamily: 'monospace', fontSize: 13, color: colors.text },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 8,
      paddingTop: 8,
      paddingBottom: 24
    },
    sheetItem: { minHeight: SIZE.target, justifyContent: 'center', paddingHorizontal: 16, borderRadius: SIZE.radius },
    sheetText: { fontSize: 16, color: colors.text },
    sheetTextDanger: { fontSize: 16, color: colors.danger },
    mailView: { borderRadius: SIZE.radius, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
    // The top of a list, as the desktop's window has it: the way to the sidebar, the search, and what is done to all.
    topBar: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: SIZE.gap },
    iconButton: { width: SIZE.target, height: SIZE.target, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
    searchPill: {
      flex: 1,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      borderRadius: 999,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border
    },
    searchPillText: { flex: 1, fontSize: 15, color: colors.muted },
    // The line over a list: what it is, how many, and the filters.
    listTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
    listTitle: { fontSize: 20, fontWeight: '700', color: colors.text },
    listCount: { fontSize: 13, color: colors.muted },
    filters: { flexDirection: 'row', gap: SIZE.gap, marginVertical: SIZE.gap },
    chipContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    // The button that writes a message, over the list, at the corner where the thumb is.
    fab: {
      position: 'absolute',
      right: 0,
      bottom: SIZE.gap,
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 18,
      borderRadius: 16,
      backgroundColor: colors.accent,
      elevation: 6,
      shadowColor: '#000000',
      shadowOpacity: 0.25,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 }
    },
    fabText: { color: colors.onAccent, fontSize: 15, fontWeight: '600' },
    listBottom: { paddingBottom: 88 },

    // The sidebar: the same rows as the desktop's, with a picture, a name, a count and what opens them.
    sidebar: { flex: 1, backgroundColor: colors.sunken },
    sidebarRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12, borderRadius: SIZE.radius, marginHorizontal: 8 },
    sidebarRowChosen: { backgroundColor: colors.accentSoft },
    sidebarLabel: { flex: 1, fontSize: 15, color: colors.text },
    sidebarLabelChosen: { color: colors.accent, fontWeight: '600' },
    sidebarAccount: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginTop: SIZE.gap },
    sidebarAccountName: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
    accountSquare: { width: 10, height: 10, borderRadius: 2 },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
    sidebarDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: SIZE.gap, marginHorizontal: 16 },

    // A list while messages are chosen, and a message that is.
    selectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    selectionCount: { fontSize: 18, fontWeight: '700', color: colors.text, flex: 1, textAlign: 'center' },
    messageRowChosen: { backgroundColor: colors.accentSoft },
    check: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center'
    },
    checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    checkMark: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
    // What can be done to a message, within reach of the thumb, and in place while the message scrolls.
    actionBar: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingVertical: SIZE.gap,
      marginHorizontal: -SIZE.padding
    },
    actionBarContent: { flexDirection: 'row', gap: SIZE.gap, paddingHorizontal: SIZE.padding },

    body: { fontSize: 16, lineHeight: 24, color: colors.text, paddingBottom: 24 },
    section: {
      marginTop: 24,
      marginBottom: 4,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.8,
      color: colors.muted,
      textTransform: 'uppercase'
    },
    // Settings that belong together, in one block like the desktop's.
    group: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: SIZE.radius,
      paddingHorizontal: 12,
      marginTop: 4
    },
    setting: {
      minHeight: SIZE.target,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12
    },
    settingLabel: { flex: 1, fontSize: 16, color: colors.text },
    timeInput: { width: 90, textAlign: 'center', minHeight: 40, paddingVertical: 6 },
    attachments: { marginTop: SIZE.gap, marginBottom: 24 },
    attachment: {
      paddingVertical: SIZE.gap,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      gap: 4
    }
  })
}

export type Styles = ReturnType<typeof createStyles>

const cache = new Map<Theme, Styles>()

/** The styles of a theme, made once: a theme is a constant, and a style sheet is not made on every render. */
export function stylesFor(theme: Theme): Styles {
  let styles = cache.get(theme)
  if (!styles) {
    styles = createStyles(theme)
    cache.set(theme, styles)
  }
  return styles
}
