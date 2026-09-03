import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';

import { AuthGuestRoute, CatchAllRedirect, ProtectedRoute } from '@/components/AuthRouteGuards';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { AuthLoadingScreen } from '@/components/AppBootScreens';
import { useAuthSurfaceRedirect } from '@/hooks/usePostLoginRedirect';
import { APP_ROLES } from '@/domain/user-schema';

import LandingPage from '@/pages/LandingPage';
import LoginPage from '@/pages/LoginPage';
import { B2B_MODULES_ENABLED } from '@/lib/launchFlags';
import AdminLoginPage from '@/pages/AdminLoginPage';
import LegalPage from '@/pages/LegalPage';
import AboutPage from '@/pages/AboutPage';
import PaymentCallbackPage from '@/pages/PaymentCallbackPage';
import ProfilePage from '@/pages/ProfilePage';

const CustomerDashboard = React.lazy(() => import('@/pages/CustomerDashboard'));
const DriverDashboard = React.lazy(() => import('@/pages/DriverDashboard'));
const AdminDashboard = React.lazy(() => import('@/pages/AdminDashboard'));
const PaymentCheckoutPage = React.lazy(() => import('@/pages/PaymentCheckoutPage'));
const LazyB2BCorporatePortal = React.lazy(() => import('@/pages/B2BCorporatePortal'));
const LazyB2BOperatorFleetPanel = React.lazy(() => import('@/pages/B2BOperatorFleetPanel'));
const LazyMapsWrapper = React.lazy(async () => {
  const mod = await import('@/components/MapsWrapper');
  return { default: mod.MapsWrapper };
});

const RouteFallback: React.FC = () => <AuthLoadingScreen />;

function withSuspense(element: React.ReactNode): React.ReactNode {
  return <React.Suspense fallback={<RouteFallback />}>{element}</React.Suspense>;
}

const PostAuthRedirect: React.FC = () => {
  useAuthSurfaceRedirect();
  return null;
};

const App: React.FC = () => {
  const { i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';

  return (
    <AppErrorBoundary>
    <AuthProvider>
      <Router>
        <div className="min-h-dvh bg-white font-sans antialiased text-black" dir={isRtl ? 'rtl' : 'ltr'}>
          <PostAuthRedirect />

          <Routes>
            <Route path="/index.html" element={<Navigate to="/" replace />} />
            <Route
              path="/"
              element={
                <AuthGuestRoute waitForAuth={false}>
                  <LandingPage />
                </AuthGuestRoute>
              }
            />
            <Route
              path="/login"
              element={
                <AuthGuestRoute>
                  <LoginPage />
                </AuthGuestRoute>
              }
            />
            <Route
              path="/admin/login"
              element={
                <AuthGuestRoute>
                  <AdminLoginPage />
                </AuthGuestRoute>
              }
            />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/legal" element={<LegalPage />} />
            <Route path="/terms" element={<LegalPage />} />
            <Route path="/privacy" element={<LegalPage />} />
            <Route
              path="/payment-checkout"
              element={
                <ProtectedRoute role={APP_ROLES.B2C_CLIENT}>
                  {withSuspense(<PaymentCheckoutPage />)}
                </ProtectedRoute>
              }
            />
            <Route
              path="/payment-callback"
              element={
                <ProtectedRoute role={APP_ROLES.B2C_CLIENT}>
                  <PaymentCallbackPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />

            {/* ---- B2C portals (canonical RBAC routes) ---- */}
            <Route
              path="/b2c/client/*"
              element={
                <ProtectedRoute role={APP_ROLES.B2C_CLIENT}>
                  {withSuspense(
                    <LazyMapsWrapper>
                      <CustomerDashboard />
                    </LazyMapsWrapper>
                  )}
                </ProtectedRoute>
              }
            />
            <Route
              path="/b2c/driver/*"
              element={
                <ProtectedRoute role={APP_ROLES.B2C_DRIVER}>
                  {withSuspense(
                    <LazyMapsWrapper>
                      <DriverDashboard />
                    </LazyMapsWrapper>
                  )}
                </ProtectedRoute>
              }
            />

            {/* B2B isolated for launch — set B2B_MODULES_ENABLED to restore portals. */}
            {B2B_MODULES_ENABLED ? (
              <>
                <Route
                  path="/b2b/corporate/*"
                  element={
                    <ProtectedRoute role={APP_ROLES.B2B_CORPORATE}>
                      <React.Suspense fallback={<RouteFallback />}>
                        <LazyB2BCorporatePortal />
                      </React.Suspense>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/b2b/operator/*"
                  element={
                    <ProtectedRoute role={APP_ROLES.B2B_OPERATOR}>
                      <React.Suspense fallback={<RouteFallback />}>
                        <LazyB2BOperatorFleetPanel />
                      </React.Suspense>
                    </ProtectedRoute>
                  }
                />
              </>
            ) : (
              <Route path="/b2b/*" element={<Navigate to="/login" replace />} />
            )}

            {/* ---- Legacy path aliases (pre-RBAC bookmarks) ---- */}
            <Route path="/customer/*" element={<Navigate to="/b2c/client" replace />} />
            <Route path="/driver/*" element={<Navigate to="/b2c/driver?online=1" replace />} />

            <Route
              path="/admin/*"
              element={
                <ProtectedRoute role={APP_ROLES.ADMIN}>
                  {withSuspense(<AdminDashboard />)}
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<CatchAllRedirect />} />
          </Routes>

          <Toaster
            position="top-center"
            richColors
            theme="light"
            offset="calc(env(safe-area-inset-top, 0px) + 12px)"
          />
        </div>
      </Router>
    </AuthProvider>
    </AppErrorBoundary>
  );
};

export default App;
