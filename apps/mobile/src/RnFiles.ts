import { decodeBase64, encodeBase64 } from '@peregrine/imap/mime'
import type { Files, PickedFile } from './files'
import type { Incoming } from './incoming'

/** What the native module `PeregrineFiles` offers, in the shapes that cross the bridge. */
export interface NativeFiles {
  pick(): Promise<{ path: string; name: string; size: number; mimeType: string }[]>
  consumeIncoming(): Promise<(Omit<Incoming, 'files'> & { files: { path: string; name: string; size: number; mimeType: string }[] }) | null>
  stash(name: string, mimeType: string, base64: string): Promise<{ path: string; name: string; size: number; mimeType: string }>
  read(path: string): Promise<string>
  remove(paths: string[]): Promise<void>
  keepOnly(paths: string[]): Promise<void>
  save(name: string, mimeType: string, base64: string): Promise<boolean>
  open(name: string, mimeType: string, base64: string): Promise<void>
}

/**
 * The files of the device, through the native module. Content crosses the bridge as base64, which is
 * what a string can carry, and is turned into bytes and back here.
 */
export class RnFiles implements Files {
  constructor(private readonly native: NativeFiles) {}

  async pick(): Promise<PickedFile[]> {
    const picked = await this.native.pick()
    return picked.map((file) => ({
      path: file.path,
      name: file.name,
      size: file.size,
      contentType: file.mimeType || 'application/octet-stream'
    }))
  }

  async consumeIncoming(): Promise<Incoming | null> {
    const incoming = await this.native.consumeIncoming()
    if (!incoming) return null
    return {
      ...incoming,
      files: incoming.files.map((file) => ({
        path: file.path,
        name: file.name,
        size: file.size,
        contentType: file.mimeType || 'application/octet-stream'
      }))
    }
  }

  async stash(name: string, contentType: string, content: Uint8Array): Promise<PickedFile> {
    const file = await this.native.stash(name, contentType, encodeBase64(content))
    return { path: file.path, name: file.name, size: file.size, contentType: file.mimeType || contentType || 'application/octet-stream' }
  }

  async read(path: string): Promise<Uint8Array> {
    return decodeBase64(await this.native.read(path))
  }

  remove(paths: string[]): Promise<void> {
    return paths.length === 0 ? Promise.resolve() : this.native.remove(paths)
  }

  keepOnly(paths: string[]): Promise<void> {
    return this.native.keepOnly(paths)
  }

  save(name: string, contentType: string, content: Uint8Array): Promise<boolean> {
    return this.native.save(name, contentType, encodeBase64(content))
  }

  open(name: string, contentType: string, content: Uint8Array): Promise<void> {
    return this.native.open(name, contentType, encodeBase64(content))
  }
}
