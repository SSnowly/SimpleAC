import { createId } from '../../shared/contracts/ids.js';
import type { SqlStatement } from '../db/database.js';

export type ActionActorType =
  | 'system'
  | 'staff'
  | 'resource'
  | 'console'
  | 'ingame_panel'
  | 'web_api';

export interface ActionInput {
  correlationId?: string;
  actorType: ActionActorType;
  actorId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  reason: string;
  metadata?: Record<string, unknown>;
  origin: string;
  reversesActionId?: string;
}

export interface ActionStatement extends SqlStatement {
  id: string;
  correlationId: string;
}

const SAFE_CORRELATION = /^[A-Za-z0-9._-]{1,40}$/;

export function isSafeCorrelationId(value: string | undefined): value is string {
  return value !== undefined && SAFE_CORRELATION.test(value);
}

export function actionStatement(input: ActionInput): ActionStatement {
  const id = createId('SAC-ACT');
  const correlationId = isSafeCorrelationId(input.correlationId) ? input.correlationId : id;
  return {
    id,
    correlationId,
    query: `INSERT INTO sac_actions (
      id, correlation_id, actor_type, actor_id, action_type, target_type,
      target_id, reason, metadata_json, origin, reverses_action_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      id,
      correlationId,
      input.actorType,
      input.actorId,
      input.actionType,
      input.targetType,
      input.targetId,
      input.reason,
      JSON.stringify(input.metadata ?? {}),
      input.origin,
      input.reversesActionId ?? null,
    ],
  };
}
