import {
  isSessionOwnerExpired,
  selectScopedSession,
  type SessionRegistryRecord,
  type SessionScope
} from "./sessionRegistry";
import {
  selectGovernedToolsForTaskFromCatalog,
  type GovernedToolRouteResult
} from "./toolInventory";

export interface GovernedSessionDispatchInput {
  readonly sessions: readonly SessionRegistryRecord[];
  readonly scope: SessionScope;
  readonly task: string;
  readonly catalogPaths: readonly string[];
  readonly now: string;
}

export interface GovernedSessionDispatchPlan {
  readonly session: SessionRegistryRecord;
  readonly route: GovernedToolRouteResult;
  readonly skillIds: readonly string[];
}

export function skillIdsForHandoff(
  plan: GovernedSessionDispatchPlan,
  requestedSkillIds?: readonly string[]
): readonly string[] {
  if (requestedSkillIds === undefined) return plan.skillIds;
  const allowed = new Set(plan.skillIds);
  const selected = [...new Set(requestedSkillIds)];
  if (selected.some((skillId) => !allowed.has(skillId))) {
    throw new Error("skill_not_in_governed_route");
  }
  return selected;
}

/** Resolves a live project/agent session before selecting any governed skills. */
export function prepareGovernedSessionDispatch(
  input: GovernedSessionDispatchInput
): GovernedSessionDispatchPlan {
  const session = selectScopedSession(input.sessions, input.scope);
  if (session === null) throw new Error("session_not_found");
  if (isSessionOwnerExpired(session, input.now)) throw new Error("session_owner_expired");

  const route = selectGovernedToolsForTaskFromCatalog(input, input.catalogPaths);
  return {
    session,
    route,
    skillIds: [...new Set(route.skillManifests.map((manifest) => manifest.id))]
  };
}
