import {
  Activity,
  Info,
  KeyRound,
  Layout,
  Mail,
  Bell,
  ListChecks,
  Palette,
  ShieldCheck,
  SlidersHorizontal,
  Filter,
  Users,
  UserCog,
  Keyboard,
  Tag as TagIcon,
  type LucideIcon
} from 'lucide-react'
import AboutSection from './AboutSection'
import GeneralSection from './GeneralSection'
import NotificationsSection from './NotificationsSection'
import DailySection from './DailySection'
import ProfileSection from './ProfileSection'
import ShortcutsSection from './ShortcutsSection'
import TagsSection from './TagsSection'
import AppearanceSection from './AppearanceSection'
import LayoutSection from './LayoutSection'
import AccountsSection from './AccountsSection'
import PrivacySection from './PrivacySection'
import FilterRulesSection from './FilterRulesSection'
import ContactsSection from './ContactsSection'
import PgpSettings from './PgpSettings'
import DiagnosticsSection from './DiagnosticsSection'
import AccountScope from './AccountScope'

export interface SettingsSectionContext {
  onAddAccount: () => void
}

/**
 * The group a section appears under in the navigation.
 *
 * Fifteen entries of equal rank stop being a list and become a search problem. Someone looking
 * for tags reads past layout, profile and shortcuts without anything telling them they are in
 * the wrong neighbourhood.
 *
 * The grouping follows the question someone has in mind rather than the way the application is
 * built. How it looks, what happens in my mailboxes, who may do what, what is this.
 */
export type SettingsGroupId = 'general' | 'display' | 'mail' | 'security' | 'system'

export const SETTINGS_GROUPS: { id: SettingsGroupId; labelKey: string }[] = [
  { id: 'general', labelKey: 'settings.groups.general' },
  { id: 'display', labelKey: 'settings.groups.display' },
  { id: 'mail', labelKey: 'settings.groups.mail' },
  { id: 'security', labelKey: 'settings.groups.security' },
  { id: 'system', labelKey: 'settings.groups.system' }
]

export interface SettingsSectionDefinition {
  id: string
  group: SettingsGroupId
  labelKey: string
  icon: LucideIcon
  render: (context: SettingsSectionContext) => JSX.Element
}

/**
 * Single source of truth for the settings navigation. Adding a settings area means adding one
 * entry here plus its component file. Nothing else in the shell has to change.
 */
export const SETTINGS_SECTIONS: SettingsSectionDefinition[] = [
  {
    id: 'general',
    group: 'general',
    labelKey: 'settings.sections.general',
    icon: SlidersHorizontal,
    render: () => <GeneralSection />
  },
  {
    id: 'notifications',
    group: 'general',
    labelKey: 'settings.sections.notifications',
    icon: Bell,
    render: () => <NotificationsSection />
  },
  {
    id: 'daily',
    group: 'general',
    labelKey: 'daily.title',
    icon: ListChecks,
    render: () => <DailySection />
  },
  {
    id: 'appearance',
    group: 'display',
    labelKey: 'settings.appearance',
    icon: Palette,
    render: () => <AppearanceSection />
  },
  {
    id: 'layout',
    group: 'display',
    labelKey: 'settings.sections.layout',
    icon: Layout,
    render: () => <LayoutSection />
  },
  {
    id: 'profile',
    group: 'security',
    labelKey: 'profile.title',
    icon: UserCog,
    render: () => <ProfileSection />
  },
  {
    id: 'shortcuts',
    group: 'display',
    labelKey: 'settings.sections.shortcuts',
    icon: Keyboard,
    render: () => <ShortcutsSection />
  },
  {
    id: 'accounts',
    group: 'mail',
    labelKey: 'settings.accounts',
    icon: Mail,
    render: ({ onAddAccount }) => <AccountsSection onAddAccount={onAddAccount} />
  },
  {
    id: 'privacy',
    group: 'security',
    labelKey: 'settings.sections.privacy',
    icon: ShieldCheck,
    render: () => <PrivacySection />
  },
  {
    id: 'tags',
    group: 'mail',
    labelKey: 'settings.sections.tags',
    icon: TagIcon,
    render: () => <TagsSection />
  },
  {
    id: 'filters',
    group: 'mail',
    labelKey: 'settings.filterRules',
    icon: Filter,
    render: () => <AccountScope>{(account) => <FilterRulesSection accountId={account.id} />}</AccountScope>
  },
  {
    id: 'contacts',
    group: 'mail',
    labelKey: 'settings.contacts',
    icon: Users,
    render: () => <ContactsSection />
  },
  {
    id: 'pgp',
    group: 'security',
    labelKey: 'settings.pgp',
    icon: KeyRound,
    render: () => <PgpSettings />
  },
  {
    id: 'diagnostics',
    group: 'system',
    labelKey: 'settings.sections.diagnostics',
    icon: Activity,
    render: () => <DiagnosticsSection />
  },
  // Last, because nothing here is needed day to day, only when there is something to report.
  {
    id: 'about',
    group: 'system',
    labelKey: 'settings.sections.about',
    icon: Info,
    render: () => <AboutSection />
  }
]
