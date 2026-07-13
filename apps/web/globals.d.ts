// TypeScript 6 checks side-effect imports (TS2882). Next.js only declares
// `*.module.css`, so plain stylesheet imports (app/globals.css) need this.
declare module '*.css';
