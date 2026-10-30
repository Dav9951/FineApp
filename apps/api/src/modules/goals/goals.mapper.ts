import type {
  GoalContributionDto,
  GoalDto,
  GoalProgress,
  GoalProjectionDto,
} from '@fineapp/shared';

import type { GoalRow } from '../../db/schema/goals.js';

/**
 * Mapowanie wiersza celu na DTO — jedyne miejsce, gdzie `snake_case` z bazy spotyka
 * `camelCase` kontraktu (02 §4). Postęp, plan i prognozę wylicza serwis.
 *
 * @param row - Wiersz celu.
 * @param progress - Zebrana kwota, udział i reszta.
 * @param contribution - Plan i wpłaty miesiąca.
 * @param projection - Prognoza.
 * @returns DTO celu.
 */
export function toGoalDto(
  row: GoalRow,
  progress: GoalProgress,
  contribution: GoalContributionDto,
  projection: GoalProjectionDto,
): GoalDto {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    purpose: row.purpose,
    targetAmountMinor: row.targetAmountMinor,
    targetDate: row.targetDate,
    startingAmountMinor: row.startingAmountMinor,
    linkedAccountId: row.linkedAccountId,
    progressSource: row.progressSource,
    contributionAmountMinor: row.contributionAmountMinor,
    contributionPercentBps: row.contributionPercentBps,
    currentAmountMinor: progress.currentAmountMinor,
    progressBps: progress.progressBps,
    remainingMinor: progress.remainingMinor,
    contribution,
    projection,
    priority: row.priority,
    color: row.color,
    icon: row.icon,
    status: row.status,
    achievedAt: row.achievedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
