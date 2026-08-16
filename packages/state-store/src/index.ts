export type { IStateStore } from './adapters/base.js';
export { SQLiteStateStore } from './adapters/sqlite.js';
export { DynamoDBStateStore } from './adapters/dynamodb.js';
export { createStateStore } from './factory.js';
export type { StoreConfig } from './factory.js';
export type { AggregatedMetrics, MetricRecord, ProjectRecord, TrafficScale } from './types.js';
export { CREATE_METRICS_IDX_SQL, CREATE_METRICS_SQL, CREATE_PROJECTS_SQL, METRICS_TABLE, PROJECTS_TABLE } from './schema.js';
