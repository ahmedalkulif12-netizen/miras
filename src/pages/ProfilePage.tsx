import React, { useEffect, useState } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import ProfileAvatar from '@/components/ProfileAvatar';
import { useAuth } from '@/hooks/useAuth';
import { User, Phone, Save, ShieldCheck, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { OPTION_LABELS } from '@/constants';
import { isDriverRole } from '@/domain/user-schema';

const ProfilePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { profile, updateProfile } = useAuth();
  const [name, setName] = useState(profile?.name || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setName(profile?.name || '');
  }, [profile?.uid, profile?.name]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast.error(isRtl ? 'يرجى إدخال الاسم الكامل' : 'Please enter your full name');
      return;
    }
    setIsSaving(true);
    try {
      await updateProfile({ name: trimmed });
      toast.success(t('profile_updated'));
    } catch (error) {
      console.error('[ProfilePage] save failed:', error);
      toast.error(isRtl ? 'فشل حفظ البيانات' : 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  const getRoleLabelText = () => {
    const role = profile?.role;
    if (role === 'b2c_client') return t('customer_role');
    if (role === 'b2c_driver') return t('driver_role');
    if (role === 'b2b_corporate') return isRtl ? 'بوابة الشركات' : 'Corporate';
    if (role === 'b2b_operator') return isRtl ? 'مشغل أسطول' : 'Fleet Operator';
    if (role === 'admin') return t('admin_role');
    return '';
  };

  return (
    <DashboardLayout title={t('profile')}>
      <div className={`max-w-4xl mx-auto space-y-8 ${isRtl ? 'text-right' : 'text-left'}`}>
        <div className="bg-white p-8 md:p-12 rounded-[50px] border border-stone-200 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-bl-[100px]"></div>

          <div className="flex flex-col md:flex-row items-center gap-8 relative z-10">
            <ProfileAvatar />

            <div className={`text-center ${isRtl ? 'md:text-right' : 'md:text-left'} space-y-2`}>
              <h1 className="text-3xl font-black text-neutral-900">{profile?.name}</h1>
              <div
                className={`flex items-center gap-2 text-stone-500 font-bold justify-center ${
                  isRtl ? 'md:justify-start' : 'md:justify-end flex-row-reverse'
                }`}
              >
                <ShieldCheck size={18} className="text-primary" />
                <span className="text-sm">
                  {isRtl ? `حساب ${getRoleLabelText()} موثق` : `Verified ${getRoleLabelText()} Account`}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-white p-8 rounded-[40px] border border-stone-100 shadow-sm space-y-6">
            <h2 className={`text-xl font-black flex items-center gap-2 ${isRtl ? '' : 'flex-row-reverse'}`}>
              <User size={20} className="text-primary" /> {t('basic_info')}
            </h2>

            <div className="space-y-4">
              <div className="space-y-2">
                <label
                  className={`text-xs font-black text-stone-400 ${isRtl ? 'mr-2' : 'ml-2'} uppercase tracking-widest`}
                >
                  {t('full_name')}
                </label>
                <div className="relative">
                  <User
                    className={`absolute ${isRtl ? 'right-4' : 'left-4'} top-1/2 -translate-y-1/2 text-stone-300`}
                    size={18}
                  />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={`w-full p-4 ${
                      isRtl ? 'pr-12' : 'pl-12'
                    } rounded-2xl bg-stone-50 border border-stone-100 focus:border-primary outline-none font-bold transition-all`}
                  />
                </div>
              </div>

              <div className="space-y-2 opacity-60 grayscale pointer-events-none">
                <label
                  className={`text-xs font-black text-stone-400 ${isRtl ? 'mr-2' : 'ml-2'} uppercase tracking-widest`}
                >
                  {t('phone_number_static')}
                </label>
                <div className="relative">
                  <Phone
                    className={`absolute ${isRtl ? 'right-4' : 'left-4'} top-1/2 -translate-y-1/2 text-stone-300`}
                    size={18}
                  />
                  <input
                    type="text"
                    value={profile?.phone || ''}
                    readOnly
                    className={`w-full p-4 ${
                      isRtl ? 'pr-12' : 'pl-12'
                    } rounded-2xl bg-stone-100 border border-stone-200 outline-none font-bold`}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-8">
            {isDriverRole(profile?.role) && (
              <div className="bg-white p-8 rounded-[40px] border border-stone-100 shadow-sm space-y-6">
                <h2 className={`text-xl font-black flex items-center gap-2 ${isRtl ? '' : 'flex-row-reverse'}`}>
                  <Truck size={20} className="text-primary" /> {t('vehicle_info')}
                </h2>
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-4 rounded-2xl bg-stone-50 border border-stone-100">
                    <span className="text-stone-400 font-bold text-xs uppercase">
                      {t('vehicle_type') || 'Vehicle Type'}
                    </span>
                    <span className="font-bold">{t(profile.vehicleType || '') || profile.vehicleType}</span>
                  </div>
                  <div className="flex justify-between items-center p-4 rounded-2xl bg-stone-50 border border-stone-100">
                    <span className="text-stone-400 font-bold text-xs uppercase">{t('subtype') || 'Subtype'}</span>
                    <span className="font-bold">
                      {t(OPTION_LABELS[profile.vehicleOption || ''] || profile.vehicleOption || '')}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-4 rounded-2xl bg-stone-50 border border-stone-100">
                    <span className="text-stone-400 font-bold text-xs uppercase">{t('plate_number')}</span>
                    <span className="font-bold uppercase tracking-widest">{profile.plateNumber}</span>
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="w-full py-5 bg-neutral-900 text-white rounded-[32px] font-black text-xl shadow-2xl shadow-neutral-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-70"
            >
              <Save size={24} />
              {isSaving ? t('saving') : t('save_changes')}
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ProfilePage;
