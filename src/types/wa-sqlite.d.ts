// wa-sqlite ships no type declarations; we use a loose surface.
declare module "wa-sqlite" {
  export function Factory(module: unknown): any;
  export const SQLITE_OK: number;
  export const SQLITE_ROW: number;
  export const SQLITE_CANTOPEN: number;
  export const SQLITE_IOERR_SHORT_READ: number;
  export const SQLITE_NOTFOUND: number;
  export const SQLITE_OPEN_READONLY: number;
  const _default: any;
  export default _default;
}

declare module "wa-sqlite/src/VFS.js" {
  export class Base {
    name: string;
    mxPathName: number;
    handleAsync(f: () => Promise<number>): number;
    constructor();
  }
  export const SQLITE_OK: number;
  export const SQLITE_IOERR_SHORT_READ: number;
  export const SQLITE_NOTFOUND: number;
  export const SQLITE_OPEN_READONLY: number;
}
