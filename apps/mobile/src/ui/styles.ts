import { StyleSheet } from 'react-native'
import { SIZE, type Theme } from './theme'

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
    back: { minHeight: SIZE.target, justifyContent: 'center', alignSelf: 'flex-start' },
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
    chevron: { fontSize: 22, color: colors.muted },
    // A message in a list: a stripe for the account, and two lines.
    messageRow: { flexDirection: 'row', gap: 10 },
    stripe: { width: 4, borderRadius: 2, alignSelf: 'stretch' },
    messageHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
    sender: { flex: 1, fontSize: 15, color: colors.muted },
    from: { fontSize: 15, color: colors.text },
    date: { fontSize: 12, color: colors.muted },
    subject: { fontSize: 15, color: colors.muted, marginTop: 2 },
    // What has not been read is in the colour of the text, and the rest is muted.
    unread: { fontWeight: '700', color: colors.text },
    itemMeta: { fontSize: 13, color: colors.muted, marginTop: 2 },
    link: { color: colors.accent, fontSize: 16, paddingVertical: 4 },
    spinner: { marginVertical: SIZE.gap },

    // What a message has to say for itself, above its text.
    notice: { borderRadius: SIZE.radius, borderWidth: 1, padding: 12, marginBottom: SIZE.gap },
    noticeInfo: { backgroundColor: colors.accentSoft, borderColor: 'transparent' },
    noticeWarning: { backgroundColor: colors.surface, borderColor: colors.warning },
    noticeDanger: { backgroundColor: colors.dangerSoft, borderColor: 'transparent' },
    noticeTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
    noticeDetail: { fontSize: 13, lineHeight: 18, marginTop: 4, color: colors.text },
    noticeAction: { color: colors.accent, fontSize: 14, fontWeight: '600', marginTop: 8 },

    // Who a message is from.
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
