// TypeScript ambient declarations for JavaScript modules used by db/ TypeScript files.

declare module '*.js' {
  const content: any;
  export default content;
  export = content;
}
