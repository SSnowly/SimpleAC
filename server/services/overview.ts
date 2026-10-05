import { type Overview, overviewSchema } from '../../shared/contracts/api.js';
import type { Database } from '../db/database.js';
import { requireNumber, requireString } from '../db/mappers.js';

export interface TrendPoint {
  day: string;
  value: number;
}

export interface OverviewService {
  get(): Promise<Overview>;
  /** Detections and new cases per day for the last `days` days, oldest first. */
  trends(days: number): Promise<{ detections: TrendPoint[]; cases: TrendPoint[] }>;
}

const DAY = 'INTERVAL 1 DAY';

export function createOverviewService(db: Database): OverviewService {
  const count = async (query: string): Promise<number> => Number((await db.scalar(query)) ?? 0);

  const perDay = async (table: string, column: string, days: number): Promise<TrendPoint[]> => {
    const rows = await db.query(
      `SELECT DATE_FORMAT(${column}, '%Y-%m-%d') AS day, COUNT(*) AS total FROM ${table}
       WHERE ${column} >= (CURRENT_DATE() - INTERVAL ? DAY) GROUP BY day`,
      [days - 1],
    );
    const counts = new Map(
      rows.map((row) => [requireString(row, 'day'), requireNumber(row, 'total')]),
    );
    const points: TrendPoint[] = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(Date.now() - offset * 86_400_000);
      const key = date.toISOString().slice(0, 10);
      points.push({ day: key, value: counts.get(key) ?? 0 });
    }
    return points;
  };

  return {
    async trends(days) {
      const [detections, cases] = await Promise.all([
        perDay('sac_detections', 'occurred_at', days),
        perDay('sac_cases', 'created_at', days),
      ]);
      return { detections, cases };
    },

    async get() {
      const [
        players,
        seen,
        detections24h,
        openDetections,
        openCases,
        investigating,
        bans,
        captures,
        captures24h,
        ocrMatches,
        topRules,
      ] = await Promise.all([
        count('SELECT COUNT(*) FROM sac_players'),
        count(
          `SELECT COUNT(*) FROM sac_players WHERE last_seen_at > (CURRENT_TIMESTAMP(3) - ${DAY})`,
        ),
        count(
          `SELECT COUNT(*) FROM sac_detections WHERE occurred_at > (CURRENT_TIMESTAMP(3) - ${DAY})`,
        ),
        count(`SELECT COUNT(*) FROM sac_detections WHERE status = 'open'`),
        count(`SELECT COUNT(*) FROM sac_cases WHERE status = 'open'`),
        count(`SELECT COUNT(*) FROM sac_cases WHERE status = 'investigating'`),
        count(
          `SELECT COUNT(*) FROM sac_bans WHERE revoked_by_action_id IS NULL
           AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP(3))`,
        ),
        count(`SELECT COUNT(*) FROM sac_captures WHERE status = 'uploaded'`),
        count(
          `SELECT COUNT(*) FROM sac_captures WHERE created_at > (CURRENT_TIMESTAMP(3) - ${DAY})`,
        ),
        count(
          `SELECT COUNT(DISTINCT capture_id) FROM sac_ocr_results
           WHERE created_at > (CURRENT_TIMESTAMP(3) - ${DAY})
             AND JSON_LENGTH(JSON_EXTRACT(matches_json, '$.matches')) > 0`,
        ),
        db.query(
          `SELECT rule_key, COUNT(*) AS total FROM sac_detections
           WHERE occurred_at > (CURRENT_TIMESTAMP(3) - ${DAY})
           GROUP BY rule_key ORDER BY total DESC, rule_key LIMIT 5`,
        ),
      ]);
      return overviewSchema.parse({
        generatedAt: new Date().toISOString(),
        players: { total: players, seenLast24h: seen },
        detections: {
          last24h: detections24h,
          open: openDetections,
          topRules: topRules.map((row) => ({
            ruleKey: requireString(row, 'rule_key'),
            count: requireNumber(row, 'total'),
          })),
        },
        cases: { open: openCases, investigating },
        bans: { active: bans },
        captures: { total: captures, last24h: captures24h, ocrMatchesLast24h: ocrMatches },
      });
    },
  };
}
