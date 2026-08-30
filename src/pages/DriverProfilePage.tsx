import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Phone, Save, Truck, User } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import ProfileAvatar from '@/components/ProfileAvatar';
import { SERVICE_OPTIONS, OPTION_LABELS, SERVICE_KEY_MAP } from '@/constants';
import { normalizePlateNumber } from '@/lib/driverDocumentValidation';

const VEHICLE_TYPES = [
  { id: 'furniture_moving', ar: 'نقل عفش', en: 'Furniture Moving' },
  { id: 'flatbed', ar: 'نقل سطحه', en: 'Flatbed / Towing' },
  { id: 'water_tanker', ar: 'صهريج مياه', en: 'Water Tanker' },
  { id: 'heavy_equipment', ar: 'معدات ثقيلة', en: 'Heavy Equipment' },
  { id: 'refrigerated', ar: 'نقل مبرد', en: 'Refrigerated' },
  { id: 'goods_transport', ar: 'نقل بضائع', en: 'Cargo Transport' },
] as const;

function optionsForVehicleType(vehicleType: string): string[] {
  const sk = SERVICE_KEY_MAP[vehicleType] || vehicleType;
  return (SERVICE_OPTIONS as Record<string, string[]>)[sk] || [];
}

/**
 * Driver profile / vehicle data update screen.
 * Rendered inside DriverDashboard Routes (no nested DashboardLayout).
 */
const DriverProfilePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const navigate = useNavigate();
  const { profile, updateProfile } = useAuth();

  const [name, setName] = useState(profile?.name || '');
  const [vehicleType, setVehicleType] = useState(profile?.vehicleType || 'flatbed');
  const [vehicleOption, setVehicleOption] = useState(profile?.vehicleOption || 'normal');
  const [plateNumber, setPlateNumber] = useState(profile?.plateNumber || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name || '');
    setVehicleType(profile.vehicleType || 'flatbed');
    setVehicleOption(profile.vehicleOption || 'normal');
    setPlateNumber(profile.plateNumber || '');
  }, [profile?.uid, profile?.name, profile?.vehicleType, profile?.vehicleOption, profile?.plateNumber]);

  const subtypeOptions = useMemo(() => optionsForVehicleType(vehicleType), [vehicleType]);

  useEffect(() => {
    if (subtypeOptions.length && !subtypeOptions.includes(vehicleOption)) {
      setVehicleOption(subtypeOptions[0]);
    }
  }, [subtypeOptions, vehicleOption]);

  const handleSave = async () => {
    if (!profile) return;
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      toast.error(isRtl ? 'يرجى إدخال الاسم الكامل' : 'Please enter your full name');
      return;
    }
    const normalizedPlate = normalizePlateNumber(plateNumber);
    if (!normalizedPlate || normalizedPlate.length < 3) {
      toast.error(isRtl ? 'يرجى إدخال رقم لوحة صالح' : 'Please enter a valid plate number');
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({
        name: trimmedName,
        vehicleType,
        vehicleOption,
        plateNumber: normalizedPlate,
      });
      toast.success(t('profile_updated'));
      navigate('/b2c/driver');
    } catch (error) {
      console.error('[DriverProfilePage] save failed:', error);
      toast.error(isRtl ? 'فشل حفظ البيانات' : 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`max-w-2xl mx-auto space-y-6 ${isRtl ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => navigate('/b2c/driver')}
        className={`inline-flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-black transition-colors ${
          isRtl ? 'flex-row' : 'flex-row-reverse'
        }`}
      >
        <ArrowRight size={16} className={isRtl ? '' : 'rotate-180'} />
        {isRtl ? 'العودة للوحة السائق' : 'Back to driver dashboard'}
      </button>

      <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-4">
        <div className={`flex flex-col sm:flex-row items-center gap-6 ${isRtl ? 'sm:flex-row-reverse' : ''}`}>
          <ProfileAvatar />
          <div className={`space-y-2 ${isRtl ? 'text-right' : 'text-left'} w-full`}>
            <h2 className="text-2xl font-black">{isRtl ? 'تحديث بيانات السائق' : 'Update Driver Profile'}</h2>
            <p className="text-sm text-muted-foreground">
              {isRtl
                ? 'حدّث صورتك واسمك وبيانات المركبة لضمان استقبال الطلبات المناسبة.'
                : 'Update your photo, name, and vehicle details to receive matching orders.'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-5">
        <div className="space-y-2">
          <label className="text-xs font-black text-stone-400 uppercase tracking-widest">
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
              className={`w-full p-4 ${isRtl ? 'pr-12' : 'pl-12'} rounded-2xl bg-stone-50 border border-stone-100 focus:border-primary outline-none font-bold`}
            />
          </div>
        </div>

        <div className="space-y-2 opacity-70">
          <label className="text-xs font-black text-stone-400 uppercase tracking-widest">
            {t('phone_number_static') || (isRtl ? 'رقم الجوال' : 'Phone')}
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
              className={`w-full p-4 ${isRtl ? 'pr-12' : 'pl-12'} rounded-2xl bg-stone-100 border border-stone-200 outline-none font-bold`}
            />
          </div>
        </div>

        <div className="pt-2 border-t border-dashed border-stone-100">
          <h3 className={`text-lg font-black flex items-center gap-2 mb-4 ${isRtl ? '' : 'flex-row-reverse'}`}>
            <Truck size={20} className="text-primary" />
            {t('vehicle_info')}
          </h3>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-black text-stone-400 uppercase tracking-widest">
                {t('vehicle_type') || (isRtl ? 'نوع المركبة' : 'Vehicle Type')}
              </label>
              <select
                value={vehicleType}
                onChange={(e) => {
                  const next = e.target.value;
                  setVehicleType(next);
                  const opts = optionsForVehicleType(next);
                  setVehicleOption(opts[0] || '');
                }}
                className="w-full p-4 rounded-2xl bg-stone-50 border border-stone-100 focus:border-primary outline-none font-bold text-sm"
              >
                {VEHICLE_TYPES.map((vt) => (
                  <option key={vt.id} value={vt.id}>
                    {isRtl ? vt.ar : vt.en}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black text-stone-400 uppercase tracking-widest">
                {t('subtype') || (isRtl ? 'النوع الفرعي' : 'Subtype')}
              </label>
              <select
                value={vehicleOption}
                onChange={(e) => setVehicleOption(e.target.value)}
                className="w-full p-4 rounded-2xl bg-stone-50 border border-stone-100 focus:border-primary outline-none font-bold text-sm"
              >
                {subtypeOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {t(OPTION_LABELS[opt] || opt)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2 mt-4">
            <label className="text-xs font-black text-stone-400 uppercase tracking-widest">
              {t('plate_number')}
            </label>
            <input
              type="text"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              className="w-full p-4 rounded-2xl bg-stone-50 border border-stone-100 focus:border-primary outline-none font-bold uppercase tracking-widest"
              placeholder={isRtl ? 'مثال: ب ص م 1234' : 'e.g. ABC 1234'}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={isSaving}
          className="w-full py-4 bg-black text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-black/90 transition-all disabled:opacity-50"
        >
          <Save size={18} />
          {isSaving ? t('saving') || (isRtl ? 'جاري الحفظ...' : 'Saving...') : t('save_changes')}
        </button>
      </div>
    </div>
  );
};

export default DriverProfilePage;
