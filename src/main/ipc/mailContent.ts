import type { IpcMain } from 'electron'
import { IpcChannels } from '@shared/ipcContracts'
import { mailContentCsp, type MailContentPolicy } from '@peregrine/core/mailCsp'
import { publishMailContent } from '../protocols/mailContentProtocol'

export function registerMailContentIpc(ipcMain: IpcMain): void {
  ipcMain.handle(
    IpcChannels.mailContentPublish,
    (_event, args: { html: string; policy: MailContentPolicy }): { url: string } => {
      return { url: publishMailContent(args.html, mailContentCsp(args.policy)) }
    }
  )
}
