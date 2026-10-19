// TypeScript 7 requires a module declaration even for a side-effect-only import, so a plain
// `import './foo.css'` needs somewhere to resolve to. This has to live outside global.d.ts:
// a shorthand ambient module only works in a file that has no imports of its own.
declare module '*.css';
