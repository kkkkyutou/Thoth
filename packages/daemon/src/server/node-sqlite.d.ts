declare module "node:sqlite" {
  export interface StatementRunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface StatementSync {
    get(...parameters: unknown[]): unknown;
    all(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): StatementRunResult;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
