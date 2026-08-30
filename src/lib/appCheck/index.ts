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
  shouldRelaxAuthAppCheck,
} from '@/lib/appCheck/client';

export {
  clearAppCheckDebugToken,
  enforceProductionAppCheckGuard,
  isAppCheckDebugModeAllowed,
  isProductionClient,
  lockAppCheckDebugTokenDisabled,
} from '@/lib/appCheck/guard';
