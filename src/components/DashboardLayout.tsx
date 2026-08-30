import React, { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import {
  Truck,
  LogOut,
  Bell,
  Menu,
  User,
  Users,
  Trash2,
  ShieldAlert,
  ChevronRight,
  ChevronLeft,
  LayoutDashboard,
  CreditCard,
  Star,
  Settings,
  ShieldCheck,
  Building2,
  Warehouse,
  DollarSign,
  MessageSquare,
} from 'lucide-react';
import { ChatUnreadBadge } from '@/components/TripChatNotifyButton';
import { BrandLogo } from '@/components/BrandLogo';
import { LanguageToggle } from '@/components/LanguageToggle';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import {
  APP_ROLES,
  getRoleLabel,
  isAdminRole,
  isClientRole,
  isCorporateRole,
  isDriverRole,
  isOperatorRole,
  normalizeAppRole,
} from '@/domain/user-schema';
import { B2B_MODULES_ENABLED } from '@/lib/launchFlags';
import { DevBypassPanel } from '@/components/DevBypassPanel';

export interface DashboardTripChatProps {
  visible: boolean;
  unreadCount: number;
  onOpen: () => void;
  label?: string;
}

interface DashboardLayoutProps {
  children: React.ReactNode;
  title: string;
  tripChat?: DashboardTripChatProps;
}

const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, title, tripChat }) => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { profile, logout, deleteAccount } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  React.useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
    toast.success(isRtl ? 'تم تسجيل الخروج بنجاح' : 'Logout successful');
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount();
      setShowDeleteConfirm(false);
      navigate('/', { replace: true });
      toast.success(isRtl ? 'تم حذف الحساب بنجاح' : 'Account deleted successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      toast.error(
        message || (isRtl ? 'حدث خطأ أثناء حذف الحساب' : 'Error deleting account')
      );
    }
  };

  return (
    <div className="flex h-dvh bg-[var(--color-background)]">
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[60] lg:hidden backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 ${isRtl ? 'right-0 border-l' : 'left-0 border-r'} z-[70] lg:relative lg:flex w-72 max-w-[85vw] flex-col bg-white transition-transform duration-300 app-header-safe app-bottom-safe ${
          isSidebarOpen
            ? 'translate-x-0'
            : isRtl
              ? 'translate-x-full lg:translate-x-0'
              : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="p-5 md:p-6 border-b flex items-center justify-between">
          <BrandLogo size={28} withChip withWordmark />
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
            aria-label={isRtl ? 'إغلاق القائمة' : 'Close menu'}
          >
            {isRtl ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          </button>
        </div>

        <nav className="flex-1 p-4 flex flex-col gap-2 overflow-y-auto">
          <div className="mt-4 flex flex-col gap-1">
            <p className="text-[10px] font-bold text-gray-400 px-4 mb-2 uppercase tracking-widest">
              {isRtl ? 'القائمة الرئيسية' : 'Main Menu'}
            </p>

            {isClientRole(profile?.role) && (
              <>
                <SidebarLink to="/b2c/client" icon={<LayoutDashboard size={20} />} label={`${t('inside_city')} & ${t('outside_city')}`} end />
                <SidebarLink to="/b2c/client/orders" icon={<Truck size={20} />} label={t('my_orders')} />
                <SidebarLink to="/b2c/client/wallet" icon={<CreditCard size={20} />} label={t('wallet')} />
              </>
            )}

            {isDriverRole(profile?.role) && (
              <>
                <SidebarLink to="/b2c/driver" icon={<LayoutDashboard size={20} />} label={t('home')} end />
                <SidebarLink to="/b2c/driver/earnings" icon={<CreditCard size={20} />} label={isRtl ? 'المحفظة' : t('wallet')} />
                <SidebarLink to="/b2c/driver/ratings" icon={<Star size={20} />} label={t('ratings')} />
                <SidebarLink to="/b2c/driver/profile" icon={<User size={20} />} label={t('update_data')} />
              </>
            )}

            {B2B_MODULES_ENABLED && isCorporateRole(profile?.role) && (
              <SidebarLink to="/b2b/corporate" icon={<Building2 size={20} />} label={isRtl ? 'بوابة الشركات' : 'Corporate Portal'} />
            )}

            {B2B_MODULES_ENABLED && isOperatorRole(profile?.role) && (
              <SidebarLink to="/b2b/operator" icon={<Warehouse size={20} />} label={isRtl ? 'لوحة الأسطول' : 'Fleet Panel'} />
            )}

            {isAdminRole(profile?.role) && (
              <>
                <SidebarLink to="/admin" icon={<LayoutDashboard size={20} />} label={t('admin_dashboard')} end />
                <SidebarLink to="/admin/directory" icon={<Users size={20} />} label={isRtl ? 'دليل المستخدمين' : 'User directory'} />
                <SidebarLink to="/admin/drivers" icon={<ShieldCheck size={20} />} label={t('manage_drivers')} />
                <SidebarLink to="/admin/clients" icon={<Users size={20} />} label={isRtl ? 'إدارة العملاء' : 'Manage clients'} />
                <SidebarLink to="/admin/finance" icon={<CreditCard size={20} />} label={isRtl ? 'المحاسبة المالية' : 'Financial ledger'} />
                <SidebarLink to="/admin/withdrawals" icon={<DollarSign size={20} />} label={isRtl ? 'طلبات السحب' : 'Payout requests'} />
                {B2B_MODULES_ENABLED ? (
                  <SidebarLink to="/admin/corporate-contracts" icon={<Building2 size={20} />} label={isRtl ? 'عقود الشركات' : 'Corporate contracts'} />
                ) : null}
                <SidebarLink to="/admin/reports" icon={<Bell size={20} />} label={t('reports_analytics')} />
              </>
            )}

            <SidebarLink to="/profile" icon={<User size={20} />} label={t('profile')} />
          </div>

          <div className="mt-auto flex flex-col gap-1">
            <SidebarLink to="/about" icon={<Settings size={20} />} label={t('about')} />
            <SidebarLink to="/terms" icon={<ShieldAlert size={20} />} label={t('legal_support')} />
          </div>
        </nav>

        <div className="p-4 border-t space-y-2">
          <DevBypassPanel isRtl={isRtl} variant="compact" />
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 p-3 text-gray-600 hover:bg-gray-50 rounded-xl transition-all font-medium text-sm"
          >
            <LogOut size={20} />
            {t('logout')}
          </button>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full flex items-center gap-3 p-3 text-red-500 hover:bg-red-50 rounded-xl transition-all font-medium text-sm"
          >
            <Trash2 size={20} />
            {t('delete_account')}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="min-h-16 md:h-20 bg-white border-b flex items-center justify-between gap-3 px-4 md:px-6 lg:px-8 app-header-safe">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 hover:bg-gray-100 rounded-lg"
              aria-label={isRtl ? 'فتح القائمة' : 'Open menu'}
            >
              <Menu size={24} />
            </button>
            <h1 className="text-lg md:text-xl font-bold truncate">{title}</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <LanguageToggle />

            {tripChat?.visible ? (
              <button
                type="button"
                onClick={tripChat.onOpen}
                className={`relative p-2.5 rounded-xl transition-all ${
                  tripChat.unreadCount > 0
                    ? 'bg-rose-50 text-rose-700'
                    : 'hover:bg-gray-100 text-gray-600'
                }`}
                aria-label={tripChat.label || t('trip_chat')}
              >
                <MessageSquare
                  size={20}
                  className={tripChat.unreadCount > 0 ? 'animate-pulse' : ''}
                />
                <ChatUnreadBadge
                  count={tripChat.unreadCount}
                  className="absolute top-0.5 end-0.5"
                />
              </button>
            ) : null}

            <Link
              to="/profile"
              className="flex items-center gap-3 rounded-xl hover:bg-gray-50 p-1 pr-2 transition-colors"
              aria-label={t('profile')}
            >
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-sm font-bold leading-tight">{profile?.name}</span>
                <span className="text-[10px] text-muted-foreground uppercase">
                  {(() => {
                    const role = normalizeAppRole(profile?.role) ?? APP_ROLES.B2C_CLIENT;
                    return getRoleLabel(role, isRtl ? 'ar' : 'en');
                  })()}
                </span>
              </div>
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-black font-bold">
                {profile?.name?.[0]?.toUpperCase()}
              </div>
            </Link>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 relative app-bottom-safe">
          {children}

          {showDeleteConfirm && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6">
                <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center text-red-500 mx-auto">
                  <ShieldAlert size={32} />
                </div>
                <div className="text-center space-y-2">
                  <h3 className="text-xl font-bold">
                    {isRtl ? 'هل أنت متأكد من حذف الحساب؟' : 'Are you sure you want to delete your account?'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {isRtl
                      ? 'هذا الإجراء نهائي ولا يمكن التراجع عنه. سيتم حذف بياناتك الشخصية وإلغاء الطلبات المفتوحة. قد تُحفظ سجلات الطلبات المكتملة للمحاسبة القانونية.'
                      : 'This action is final and cannot be undone. Personal data will be removed and open orders cancelled. Completed order records may be retained for legal accounting.'}
                  </p>
                </div>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold hover:bg-red-600 transition-all"
                  >
                    {isRtl ? 'نعم، احذف الحساب' : 'Yes, Delete Account'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-all"
                  >
                    {isRtl ? 'تراجع' : 'Cancel'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const SidebarLink: React.FC<{
  to: string;
  icon: React.ReactNode;
  label: string;
  /** When true, only the exact path is active (section homes like /b2c/client). */
  end?: boolean;
}> = ({ to, icon, label, end = false }) => {
  const location = useLocation();
  const isActive = end
    ? location.pathname === to
    : location.pathname === to || location.pathname.startsWith(`${to}/`);

  return (
    <Link
      to={to}
      className={`flex items-center gap-3 p-3 rounded-xl transition-all text-sm font-medium ${
        isActive
          ? 'bg-primary text-black shadow-lg shadow-primary/20 font-bold'
          : 'text-gray-500 hover:bg-gray-100 hover:text-black'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
};

export default DashboardLayout;
