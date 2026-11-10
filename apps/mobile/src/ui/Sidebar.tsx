import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type { Account } from '../accounts'
import { buildFolderTree, visibleRows } from '../folderTree'
import type { Folder } from '../folders'
import type { SidebarData } from '../sidebar'
import { UNIFIED_ROLES, type UnifiedRole } from '../unified'
import type { Location } from './drawer'
import { folderIconName, roleIconName } from './folderIcon'
import { folderLabel, roleLabel } from './folderLabel'
import { Icon, type IconName } from './Icon'
import { useStyles } from './useStyles'
import { useTheme } from './useTheme'
import { t } from '../i18n'

/** How far a row is moved in for each level it sits below another. */
const INDENT = 18

/** One row of the sidebar: how deep it is, what opens it, its picture, its name, and how many are unread. */
function Row(props: {
  label: string
  icon: IconName
  depth: number
  chosen: boolean
  count: number
  expanded?: boolean | null
  onToggle?: () => void
  onPress: () => void
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  const tone = props.chosen ? colors.accent : colors.muted
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.chosen }}
      style={[styles.sidebarRow, props.chosen && styles.sidebarRowChosen, { paddingLeft: 12 + props.depth * INDENT }]}
      onPress={props.onPress}
    >
      {props.expanded !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={props.expanded ? t('Zuklappen') : t('Aufklappen')}
          disabled={props.expanded === null}
          hitSlop={8}
          style={styles.expander}
          onPress={props.onToggle}
        >
          {props.expanded === null ? null : <Icon name={props.expanded ? 'chevronDown' : 'chevronRight'} size={14} color={colors.muted} />}
        </Pressable>
      ) : null}
      <Icon name={props.icon} size={18} color={tone} />
      <Text style={[styles.sidebarLabel, props.chosen && styles.sidebarLabelChosen]} numberOfLines={1}>
        {props.label}
      </Text>
      {props.count > 0 ? <Text style={styles.count}>{props.count}</Text> : null}
    </Pressable>
  )
}

/**
 * The sidebar, with what the desktop's has: the folders that are one for all accounts, and then every account, with
 * its colour and whether it is connected, and its folders as a tree with their pictures and how many of them are
 * unread. Where the user is, is marked. What is closed is closed here and nowhere else.
 */
export function Sidebar(props: {
  data: SidebarData | null
  location: Location
  /** The accounts that are connected now. */
  connected: string[]
  onUnified: (role: UnifiedRole) => void
  onSearch: (query: string) => void
  onFolder: (account: Account, folder: Folder) => void
  onAccounts: () => void
  onAddAccount: () => void
  onSettings: () => void
  onTasks: () => void
}) {
  const styles = useStyles()
  const { colors } = useTheme()
  // Closed accounts by their id, and closed folders by the id of the account and their path, so that they do not clash.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())
  const toggle = (key: string) =>
    setClosed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  const { data } = props

  return (
    <View style={styles.sidebar}>
      <ScrollView contentContainerStyle={{ paddingVertical: 12 }}>
        <View style={styles.sidebarAccount}>
          <Icon name="unified" size={18} color={colors.text} />
          <Text style={styles.sidebarAccountName}>{t('Vereinheitlicht')}</Text>
        </View>
        {UNIFIED_ROLES.map((role) => (
          <Row
            key={role}
            label={roleLabel(role)}
            icon={roleIconName(role)}
            depth={1}
            chosen={props.location.role === role}
            count={data?.unified[role] ?? 0}
            onPress={() => props.onUnified(role)}
          />
        ))}

        {data && data.searches.length > 0 ? (
          <>
            <View style={styles.sidebarDivider} />
            <View style={styles.sidebarAccount}>
              <Icon name="search" size={18} color={colors.text} />
              <Text style={styles.sidebarAccountName}>{t('Suchen')}</Text>
            </View>
            {data.searches.map((search) => (
              <Row key={search.id} label={search.name} icon="search" depth={1} chosen={false} count={0} onPress={() => props.onSearch(search.query)} />
            ))}
          </>
        ) : null}

        <View style={styles.sidebarDivider} />

        {data?.accounts.map(({ account, folders, unread }) => {
          const open = !closed.has(account.id)
          const prefix = `${account.id}/`
          const paths = new Set([...closed].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)))
          return (
            <View key={account.id}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                style={styles.sidebarAccount}
                onPress={() => toggle(account.id)}
              >
                <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} color={colors.muted} />
                <View style={[styles.accountSquare, { backgroundColor: account.color }]} />
                <Text style={styles.sidebarAccountName} numberOfLines={1}>
                  {account.displayName}
                </Text>
                <View
                  accessibilityLabel={props.connected.includes(account.id) ? t('Verbunden') : t('Nicht verbunden')}
                  style={[styles.statusDot, { backgroundColor: props.connected.includes(account.id) ? colors.success : colors.warning }]}
                />
              </Pressable>
              {open
                ? visibleRows(buildFolderTree(folders), paths, unread).map((row) => (
                    <Row
                      key={row.node.path}
                      label={row.node.folder ? folderLabel(row.node.folder) : row.node.label}
                      icon={row.node.folder ? folderIconName(row.node.folder) : 'folder'}
                      depth={row.depth + 1}
                      chosen={row.node.folder !== null && props.location.folderId === row.node.folder.id}
                      count={row.count}
                      expanded={row.expanded}
                      onToggle={() => toggle(prefix + row.node.path)}
                      onPress={() => (row.node.folder ? props.onFolder(account, row.node.folder) : toggle(prefix + row.node.path))}
                    />
                  ))
                : null}
            </View>
          )
        })}

        <View style={styles.sidebarDivider} />
        <Row label={t('Aufgaben')} icon="today" depth={0} chosen={false} count={0} onPress={props.onTasks} />
        <Row label={t('Konten')} icon="folder" depth={0} chosen={false} count={0} onPress={props.onAccounts} />
        <Row label={t('Konto hinzufügen')} icon="plus" depth={0} chosen={false} count={0} onPress={props.onAddAccount} />
        <Row label={t('Einstellungen')} icon="settings" depth={0} chosen={false} count={0} onPress={props.onSettings} />
      </ScrollView>
    </View>
  )
}
