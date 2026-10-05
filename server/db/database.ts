export interface SqlStatement {
  query: string;
  values: readonly unknown[];
}

export type Row = Record<string, unknown>;

export interface Database {
  query(query: string, values?: readonly unknown[]): Promise<Row[]>;
  single(query: string, values?: readonly unknown[]): Promise<Row | null>;
  scalar(query: string, values?: readonly unknown[]): Promise<unknown>;
  /** Runs a data-modifying statement and returns the affected row count. */
  execute(query: string, values?: readonly unknown[]): Promise<number>;
  transaction(statements: readonly SqlStatement[]): Promise<boolean>;
}

interface OxmysqlExports {
  query_async(query: string, values?: unknown[]): Promise<unknown>;
  single_async(query: string, values?: unknown[]): Promise<unknown>;
  scalar_async(query: string, values?: unknown[]): Promise<unknown>;
  update_async(query: string, values?: unknown[]): Promise<unknown>;
  transaction_async(statements: { query: string; values: unknown[] }[]): Promise<unknown>;
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createOxmysqlDatabase(oxmysql: OxmysqlExports): Database {
  return {
    async query(query, values = []) {
      const result = await oxmysql.query_async(query, [...values]);
      return Array.isArray(result) ? result.filter(isRow) : [];
    },
    async single(query, values = []) {
      const result = await oxmysql.single_async(query, [...values]);
      return isRow(result) ? result : null;
    },
    async scalar(query, values = []) {
      return (await oxmysql.scalar_async(query, [...values])) ?? null;
    },
    async execute(query, values = []) {
      const result = await oxmysql.update_async(query, [...values]);
      return typeof result === 'number' ? result : 0;
    },
    async transaction(statements) {
      const result = await oxmysql.transaction_async(
        statements.map((statement) => ({ query: statement.query, values: [...statement.values] })),
      );
      return result === true;
    },
  };
}
