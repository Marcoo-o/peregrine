import type { LucideIcon } from 'lucide-react-native'
import Archive from 'lucide-react-native/icons/archive'
import ArrowLeft from 'lucide-react-native/icons/arrow-left'
import Check from 'lucide-react-native/icons/check'
import ChevronDown from 'lucide-react-native/icons/chevron-down'
import ChevronRight from 'lucide-react-native/icons/chevron-right'
import Clock from 'lucide-react-native/icons/clock'
import Ellipsis from 'lucide-react-native/icons/ellipsis'
import FilePen from 'lucide-react-native/icons/file-pen'
import Folder from 'lucide-react-native/icons/folder'
import Forward from 'lucide-react-native/icons/forward'
import ImageOff from 'lucide-react-native/icons/image-off'
import Inbox from 'lucide-react-native/icons/inbox'
import Info from 'lucide-react-native/icons/info'
import Layers from 'lucide-react-native/icons/layers'
import ListChecks from 'lucide-react-native/icons/list-checks'
import Mail from 'lucide-react-native/icons/mail'
import MailOpen from 'lucide-react-native/icons/mail-open'
import Menu from 'lucide-react-native/icons/menu'
import Paperclip from 'lucide-react-native/icons/paperclip'
import Plus from 'lucide-react-native/icons/plus'
import RefreshCw from 'lucide-react-native/icons/refresh-cw'
import Reply from 'lucide-react-native/icons/reply'
import ReplyAll from 'lucide-react-native/icons/reply-all'
import Search from 'lucide-react-native/icons/search'
import Send from 'lucide-react-native/icons/send'
import Settings from 'lucide-react-native/icons/settings'
import ShieldAlert from 'lucide-react-native/icons/shield-alert'
import ShieldCheck from 'lucide-react-native/icons/shield-check'
import ShieldQuestion from 'lucide-react-native/icons/shield-question-mark'
import SquarePen from 'lucide-react-native/icons/square-pen'
import Star from 'lucide-react-native/icons/star'
import Trash from 'lucide-react-native/icons/trash'
import TriangleAlert from 'lucide-react-native/icons/triangle-alert'
import X from 'lucide-react-native/icons/x'
import { useTheme } from './useTheme'

/**
 * The pictures of the screens, the ones the desktop uses for the same things (it draws them with the same
 * library), so that a folder or an action looks the same on both. Each is imported by itself: the library
 * as a whole has thousands, and a bundle holds what it imports.
 */
const ICONS = {
  inbox: Inbox,
  drafts: FilePen,
  sent: Send,
  archive: Archive,
  junk: ShieldAlert,
  trash: Trash,
  folder: Folder,
  unified: Layers,
  today: ListChecks,
  snoozed: Clock,
  search: Search,
  star: Star,
  unread: Mail,
  read: MailOpen,
  attachment: Paperclip,
  refresh: RefreshCw,
  settings: Settings,
  compose: SquarePen,
  menu: Menu,
  plus: Plus,
  close: X,
  check: Check,
  back: ArrowLeft,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  reply: Reply,
  replyAll: ReplyAll,
  forward: Forward,
  more: Ellipsis,
  imageOff: ImageOff,
  shieldOk: ShieldCheck,
  shieldUnknown: ShieldQuestion,
  alert: TriangleAlert,
  info: Info
} satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

/** A picture, in the colour of the text unless it is told another, and as thin as the desktop's. */
export function Icon(props: { name: IconName; size?: number; color?: string; strokeWidth?: number; fill?: string }) {
  const { colors } = useTheme()
  const Glyph = ICONS[props.name]
  return (
    <Glyph
      size={props.size ?? 20}
      color={props.color ?? colors.text}
      strokeWidth={props.strokeWidth ?? 1.75}
      fill={props.fill ?? 'none'}
    />
  )
}
