export {
  AppCheckInitError,
  ensureAppCheckTokenForApi,
  ensureAppCheckTokenForAuth,
  getAppCheckInitError,
  getAppCheckInstance,
  getAppCheckToken,
  initAppCheck,
  isAppCheckActive,
  isAppCheckDisabled,
  isNativeCapacitorRuntime,
  shouldRelaxAuthAppCheck,
} from '@/lib/appCheck/client';

export {
  isAppCheckAttestationFailure,
  isNativeFirebaseAppId,
  isWebFirebaseAppId,
} from '@/lib/appCheck/runtime';

export {
  clearAppCheckDebugToken,
  enforceProductionAppCheckGuard,
  isAppCheckDebugModeAllowed,
  isProductionClient,
  lockAppCheckDebugTokenDisabled,
} from '@/lib/appCheck/guard';
