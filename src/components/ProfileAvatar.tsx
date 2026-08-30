import React, { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { uploadProfilePhoto, validateProfilePhotoFile } from '@/lib/profilePhotoUpload';

interface ProfileAvatarProps {
  sizeClassName?: string;
  /** Show camera control (default true). */
  editable?: boolean;
}

/**
 * Circular avatar with camera control that opens a file picker and uploads a profile photo.
 */
export const ProfileAvatar: React.FC<ProfileAvatarProps> = ({
  sizeClassName = 'w-32 h-32',
  editable = true,
}) => {
  const { i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const { profile, updateProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const displayUrl = previewUrl || profile?.photoURL || null;
  const initial = profile?.name?.[0]?.toUpperCase() || '?';

  const openPicker = () => {
    if (!editable || uploading) return;
    inputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const check = validateProfilePhotoFile(file);
    if (check.ok === false) {
      toast.error(
        check.message === 'PHOTO_TOO_LARGE'
          ? isRtl
            ? 'حجم الصورة كبير جداً (الحد 3 م.ب)'
            : 'Image is too large (max 3 MB)'
          : isRtl
            ? 'صيغة الصورة غير مدعومة (JPG/PNG/WebP)'
            : 'Unsupported image type (JPG/PNG/WebP)'
      );
      return;
    }

    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setUploading(true);
    try {
      const { photoURL } = await uploadProfilePhoto(file);
      await updateProfile({ photoURL });
      setPreviewUrl(photoURL);
      toast.success(isRtl ? 'تم تحديث صورة الملف الشخصي' : 'Profile photo updated');
    } catch (error) {
      console.error('[ProfileAvatar] upload failed:', error);
      setPreviewUrl(profile?.photoURL || null);
      toast.error(isRtl ? 'فشل رفع الصورة' : 'Failed to upload photo');
    } finally {
      setUploading(false);
      URL.revokeObjectURL(localPreview);
    }
  };

  return (
    <div className="relative group inline-block">
      <div
        className={`${sizeClassName} rounded-full bg-stone-100 flex items-center justify-center text-stone-400 text-4xl font-black border-4 border-white shadow-xl overflow-hidden`}
      >
        {displayUrl ? (
          <img src={displayUrl} alt={profile?.name || 'avatar'} className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </div>

      {editable && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label={isRtl ? 'تغيير صورة الملف الشخصي' : 'Change profile photo'}
            onChange={(e) => void onFileChange(e)}
          />
          <button
            type="button"
            onClick={openPicker}
            disabled={uploading}
            title={isRtl ? 'تغيير الصورة' : 'Change photo'}
            aria-label={isRtl ? 'تغيير صورة الملف الشخصي' : 'Change profile photo'}
            className="absolute bottom-0 right-0 p-2.5 bg-black text-white rounded-2xl shadow-lg hover:scale-110 transition-all border-4 border-white disabled:opacity-60"
          >
            <Camera size={18} className={uploading ? 'animate-pulse' : ''} />
          </button>
        </>
      )}
    </div>
  );
};

export default ProfileAvatar;
