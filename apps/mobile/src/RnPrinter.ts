import type { Printer } from './printing'

/** What the native module `PeregrinePrint` offers, as it offers it. */
export interface NativePrint {
  print(jobName: string, html: string): Promise<void>
}

/** The print service of the device, through the native module. */
export class RnPrinter implements Printer {
  constructor(private readonly native: NativePrint) {}

  print(jobName: string, html: string): Promise<void> {
    return this.native.print(jobName, html)
  }
}
