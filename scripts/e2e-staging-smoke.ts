#!/usr/bin/env tsx
import { runStagingSmokeSuite } from '../e2e/runner.ts';

runStagingSmokeSuite()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('[e2e] fatal:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
