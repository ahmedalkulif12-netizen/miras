import { assertStagingEnvironment } from './stagingGuard.ts';
import { loadE2eConfig } from './config.ts';
import {
  initAdminContext,
  ensureTestActors,
  cleanupArtifacts,
} from './helpers/adminContext.ts';
import { runFullLifecycleScenario } from './scenarios/fullLifecycle.ts';
import { runFirstDriverWinsScenario } from './scenarios/firstDriverWins.ts';
import { runAppCheckCompatScenario, runHealthScenario } from './scenarios/appCheckCompat.ts';
import type { ScenarioResult } from './scenarios/fullLifecycle.ts';

function printResult(result: ScenarioResult): void {
  const status = result.passed ? 'PASS' : 'FAIL';
  console.log(`[e2e] ${status} ${result.name} (${result.durationMs}ms)`);
  if (result.error) console.log(`       ↳ ${result.error}`);
  if (result.risky) console.log(`       ⚠ ${result.risky}`);
}

export async function runStagingSmokeSuite(): Promise<number> {
  console.log('[e2e] Miras staging smoke — architecture: HTTP APIs + signed webhooks + Firestore client listeners');
  console.log('[e2e] Server must already be running at E2E_BASE_URL (npm run dev or staging host).\n');

  const guard = assertStagingEnvironment();
  const config = loadE2eConfig(guard);

  console.log(`[e2e] project=${config.projectId} baseUrl=${config.baseUrl}`);
  console.log(`[e2e] appCheckEnforce=${config.appCheckEnforce} skipCleanup=${config.skipCleanup}\n`);

  if (config.dryRun) {
    console.log('[e2e] dry-run OK — staging guards passed, no scenarios executed.');
    return 0;
  }

  const ctx = initAdminContext();
  await ensureTestActors(ctx, config.actors);

  const results: ScenarioResult[] = [];

  try {
    results.push(await runHealthScenario(config));
    results.push(await runAppCheckCompatScenario(ctx, config));
    results.push(await runFirstDriverWinsScenario(ctx, config));
    results.push(await runFullLifecycleScenario(ctx, config));
  } finally {
    await cleanupArtifacts(ctx, config);
  }

  console.log('');
  for (const result of results) {
    printResult(result);
  }

  const failed = results.filter((r) => !r.passed);
  const risky = results.filter((r) => r.risky);

  console.log('');
  console.log(`[e2e] summary: ${results.length - failed.length}/${results.length} passed`);
  if (risky.length) {
    console.log(`[e2e] warnings: ${risky.length} scenario(s) flagged manual follow-up`);
  }

  return failed.length > 0 ? 1 : 0;
}
