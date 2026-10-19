// What this package assumes the platform provides beyond the language itself.
//
// Read only by the package's own tsconfig, which has no DOM and no Node types, so a global used
// anywhere in `src` has to be declared here or the build stops. That makes the list below the
// whole of the contract. Node, Electron and Hermes all have these.

declare function setTimeout(handler: () => void, milliseconds: number): unknown
declare function clearTimeout(handle: unknown): void
