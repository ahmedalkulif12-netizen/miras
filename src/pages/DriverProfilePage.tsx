import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Camera, ImagePlus, Phone, Save, Truck, User } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import ProfileAvatar from '@/components/ProfileAvatar';
import { RequiredDriverDocumentsFields } from '@/components/RequiredDriverDocumentsFields';
import { SERVICE_OPTIONS, OPTION_LABELS, SERVICE_KEY_MAP } from '@/constants';
import { normalizePlateNumber, REQUIRED_DRIVER_DOCS } from '@/lib/driverDocumentValidation';
import {
  documentFilesToUploadStatuses,
  uploadDriverDocumentFiles,
} from '@/lib/driverDocumentUpload';
import { uploadVehiclePhoto } from '@/lib/profilePhotoUpload';
import { submitDriverRegistrationToApi } from '@/lib/submitDriverRegistration';
import { describeUploadSaveError } from '@/lib/uploadErrorMessage';
import type { DriverDocumentKey } from '@/lib/userProfile';

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
  const [docFiles, setDocFiles] = useState<Partial<Record<DriverDocumentKey, File>>>({});
  const [vehiclePreview, setVehiclePreview] = useState<string | null>(null);
  const [uploadingVehicle, setUploadingVehicle] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const vehicleCameraRef = useRef<HTMLInputElement>(null);
  const vehicleGalleryRef = useRef<HTMLInputElement>(null);

  const onVehiclePhoto = async (file: File | null) => {
    if (!file || !profile) return;
    const localPreview = URL.createObjectURL(file);
    setVehiclePreview(localPreview);
    setUploadingVehicle(true);
    try {
      const { vehiclePhotoURL } = await uploadVehiclePhoto(file);
      await updateProfile({ vehiclePhotoURL }, { strict: true });
      setVehiclePreview(vehiclePhotoURL);
      toast.success(isRtl ? 'تم حفظ صورة المركبة' : 'Vehicle photo saved');
    } catch (error) {
      const code = String((error as { code?: string })?.code || '');
      const message = error instanceof Error ? error.message : String(error);
      console.error('[DriverProfilePage] vehicle photo failed:', code, message, error);
      setVehiclePreview(profile.vehiclePhotoURL || null);
      toast.error(describeUploadSaveError(error, isRtl));
    } finally {
      setUploadingVehicle(false);
      URL.revokeObjectURL(localPreview);
    }
  };

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

    const existingFiles = profile.documentFiles || {};
    const missingDocs = REQUIRED_DRIVER_DOCS.filter(
      (key) => !docFiles[key] && !existingFiles[key]?.storagePath
    );
    if (missingDocs.length) {
      toast.error(
        isRtl
          ? 'يرجى رفع الهوية، الاستمارة، الرخصة، وكارت التشغيل'
          : 'Upload National ID, registration, license, and operating card'
      );
      return;
    }

    if (uploadingVehicle) {
      toast.error(
        isRtl
          ? 'انتظر اكتمال رفع صورة المركبة قبل الحفظ'
          : 'Wait until the vehicle photo finishes uploading'
      );
      return;
    }

    setIsSaving(true);
    try {
      const uploaded = Object.values(docFiles).some(Boolean)
        ? await uploadDriverDocumentFiles(profile.uid, docFiles)
        : {};
      const documentFiles = { ...existingFiles, ...uploaded };
      const unresolved = (Object.keys(uploaded) as DriverDocumentKey[]).filter(
        (key) => !uploaded[key]?.storagePath || !uploaded[key]?.url
      );
      if (unresolved.length) {
        throw new Error('UPLOAD_URL_MISSING');
      }
      const documentUploadStatuses = documentFilesToUploadStatuses(documentFiles);
      const nextProfile = {
        ...profile,
        name: trimmedName,
        vehicleType,
        vehicleOption,
        plateNumber: normalizedPlate,
        documentFiles,
        documentUploadStatuses,
        accountStatus:
          profile.accountStatus === 'approved' ? 'approved' : 'pending_approval',
      };
      await updateProfile(
        {
          name: trimmedName,
          vehicleType,
          vehicleOption,
          plateNumber: normalizedPlate,
          documentFiles,
          documentUploadStatuses,
          accountStatus: nextProfile.accountStatus,
        },
        { strict: true }
      );
      if (nextProfile.accountStatus !== 'approved') {
        await submitDriverRegistrationToApi(nextProfile);
      }
      setDocFiles({});
      toast.success(t('profile_updated'));
      navigate('/b2c/driver');
    } catch (error) {
      const code = String((error as { code?: string })?.code || '');
      const message = error instanceof Error ? error.message : String(error);
      console.error('[DriverProfilePage] save failed:', code, message, error);
      toast.error(describeUploadSaveError(error, isRtl));
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

          <div className="space-y-3 mt-6">
            <label className="text-xs font-black text-stone-400 uppercase tracking-widest">
              {isRtl ? 'صورة المركبة' : 'Vehicle photo'}
            </label>
            <div className="rounded-3xl border border-stone-100 bg-stone-50 overflow-hidden">
              {vehiclePreview || profile?.vehiclePhotoURL ? (
                <img
                  src={vehiclePreview || profile?.vehiclePhotoURL}
                  alt={isRtl ? 'صورة المركبة' : 'Vehicle'}
                  className="w-full h-48 object-cover"
                />
              ) : (
                <div className="h-40 flex items-center justify-center text-stone-400 text-sm font-bold">
                  {isRtl ? 'لم تُرفع صورة للمركبة بعد' : 'No vehicle photo yet'}
                </div>
              )}
              <div className="flex gap-2 p-3">
                <input
                  ref={vehicleCameraRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    e.target.value = '';
                    void onVehiclePhoto(file);
                  }}
                />
                <input
                  ref={vehicleGalleryRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    e.target.value = '';
                    void onVehiclePhoto(file);
                  }}
                />
                <button
                  type="button"
                  disabled={uploadingVehicle}
                  onClick={() => vehicleCameraRef.current?.click()}
                  className="flex-1 min-h-12 rounded-2xl bg-black text-white text-sm font-black flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Camera size={16} />
                  {isRtl ? 'الكاميرا' : 'Camera'}
                </button>
                <button
                  type="button"
                  disabled={uploadingVehicle}
                  onClick={() => vehicleGalleryRef.current?.click()}
                  className="flex-1 min-h-12 rounded-2xl bg-[#FFCC00] text-black text-sm font-black flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <ImagePlus size={16} />
                  {isRtl ? 'المعرض' : 'Gallery'}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <RequiredDriverDocumentsFields
              isRtl={isRtl}
              files={docFiles}
              alreadyUploaded={Object.fromEntries(
                REQUIRED_DRIVER_DOCS.map((key) => [
                  key,
                  Boolean(profile?.documentFiles?.[key]?.storagePath),
                ])
              )}
              onSelect={(key, file) => {
                setDocFiles((prev) => {
                  const next = { ...prev };
                  if (file) next[key] = file;
                  else delete next[key];
                  return next;
                });
              }}
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
