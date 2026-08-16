import type { IStateStore } from './adapters/base.js';
import { SQLiteStateStore } from './adapters/sqlite.js';
import { DynamoDBStateStore } from './adapters/dynamodb.js';

export type StoreConfig =
  | { type: 'sqlite'; dbPath?: string }
  | { type: 'dynamodb'; region?: string; tablePrefix?: string };

export function createStateStore(config: StoreConfig): IStateStore {
  if (config.type === 'sqlite') {
    return new SQLiteStateStore(config.dbPath);
  }
  return new DynamoDBStateStore(config.region, config.tablePrefix);
}
