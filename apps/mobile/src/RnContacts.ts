import type { Contact, DeviceContacts } from './contacts'

/** What the native module `PeregrineContacts` offers, in the shapes that cross the bridge. */
export interface NativeContacts {
  permitted(): Promise<boolean>
  ensurePermission(): Promise<boolean>
  search(typed: string, limit: number): Promise<{ name: string; address: string }[]>
}

/** The address book of the device, through the native module. */
export class RnContacts implements DeviceContacts {
  constructor(private readonly native: NativeContacts) {}

  permitted(): Promise<boolean> {
    return this.native.permitted()
  }

  ensurePermission(): Promise<boolean> {
    return this.native.ensurePermission()
  }

  async search(typed: string, limit: number): Promise<Contact[]> {
    if (typed.trim() === '') return []
    const found = await this.native.search(typed, limit)
    return found.map(({ name, address }) => ({ name, address }))
  }
}
