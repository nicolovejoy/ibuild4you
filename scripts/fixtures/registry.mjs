// All seedable preview scenarios, in one list. Add a scenario by dropping a
// module in scenarios/ that exports `scenario = { name, description, standard,
// seed }` and importing it here.

import { scenario as dashboardBuckets } from './scenarios/dashboard-buckets.mjs'
import { scenario as multiHumanCast } from './scenarios/multi-human-cast.mjs'

export const SCENARIOS = [dashboardBuckets, multiHumanCast]

export function findScenario(name) {
  return SCENARIOS.find((s) => s.name === name) ?? null
}
