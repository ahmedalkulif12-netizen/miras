export interface E2eActors {
  customerUid: string;
  driverAUid: string;
  driverBUid: string;
}

export interface E2eConfig {
  baseUrl: string;
  projectId: string;
  appCheckEnforce: boolean;
  actors: E2eActors;
  /** Optional App Check debug JWT for enforced environments */
  appCheckToken?: string;
  firebaseApiKey: string;
  skipCleanup: boolean;
  dryRun: boolean;
}

export function loadE2eConfig(guard: {
  baseUrl: string;
  projectId: string;
  appCheckEnforce: boolean;
}): E2eConfig {
  const firebaseApiKey = process.env.VITE_FIREBASE_API_KEY?.trim();
  if (!firebaseApiKey) {
    throw new Error('E2E requires VITE_FIREBASE_API_KEY for custom-token → ID token exchange.');
  }

  return {
    baseUrl: guard.baseUrl,
    projectId: guard.projectId,
    appCheckEnforce: guard.appCheckEnforce,
    firebaseApiKey,
    appCheckToken: process.env.E2E_APP_CHECK_TOKEN?.trim() || undefined,
    skipCleanup: process.argv.includes('--skip-cleanup'),
    dryRun: process.argv.includes('--dry-run'),
    actors: {
      customerUid: process.env.E2E_CUSTOMER_UID!.trim(),
      driverAUid: process.env.E2E_DRIVER_A_UID!.trim(),
      driverBUid: process.env.E2E_DRIVER_B_UID!.trim(),
    },
  };
}
