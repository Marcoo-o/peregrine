/**
 * What the application needs of the device's files. The native module is behind it, and nothing else
 * imports it, so everything above can be tested without a device.
 */

/** A file the user picked, already copied into the application's own storage. */
export interface PickedFile {
  /** Where the copy is, in the application's storage. What a queued message refers to. */
  path: string
  name: string
  size: number
  contentType: string
}

/** What sending needs: to read the copies of the picked files and to remove them. */
export interface FileAccess {
  /** The whole content of a copy made by `pick`. */
  read(path: string): Promise<Uint8Array>
  /** Deletes copies made by `pick`. A copy that is gone already is not an error. */
  remove(paths: string[]): Promise<void>
}

export interface Files extends FileAccess {
  /** Lets the user pick files and copies them into the application's storage. No pick gives an empty list. */
  pick(): Promise<PickedFile[]>
  /** Lets the user choose where to save a file. False when they chose none. */
  save(name: string, contentType: string, content: Uint8Array): Promise<boolean>
  /** Hands a file to another application to show. */
  open(name: string, contentType: string, content: Uint8Array): Promise<void>
}

/**
 * How much may be attached to one message. Providers refuse a message that is larger than 20 to 50
 * megabytes, and what is attached has to go through the bridge to the native side and be encoded on the
 * way, so more is a message that is likely to fail after a long wait. The server's own limit is checked
 * by the client when it is known.
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
