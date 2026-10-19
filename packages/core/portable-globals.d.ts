// What portable code assumes the platform provides beyond the language itself.
//
// This file is read only by the package's own tsconfig, which has no DOM and no Node types, so
// a global used anywhere in `src` has to be declared here or the build stops. That makes the
// list below the whole of the contract, and an addition to it a decision that shows up in review.
//
// Anything here has to exist on every platform the package runs on. Electron and Node have all
// of it. Hermes, which runs React Native, ships a `URL` whose `hostname`, `username` and
// `password` are not implemented, so the phone application needs a complete one installed
// before the link checks are used.

declare class URL {
  constructor(input: string, base?: string)
  readonly hostname: string
  readonly username: string
  readonly password: string
}
