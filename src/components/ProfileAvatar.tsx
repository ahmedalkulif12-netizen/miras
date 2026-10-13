import React, { useRef, useState } from 'react';
import { Camera, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { uploadProfilePhoto } from '@/lib/profilePhotoUpload';
import { describeUploadSaveError } from '@/lib/uploadErrorMessage';

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
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const displayUrl = previewUrl || profile?.photoURL || null;
  const initial = profile?.name?.[0]?.toUpperCase() || '?';

  const openPicker = (source: 'camera' | 'gallery') => {
    if (!editable || uploading) return;
    (source === 'camera' ? cameraRef : galleryRef).current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const localPreview = URL.createObjectURL(file);
    setPreviewUrl(localPreview);
    setUploading(true);
    try {
      const { photoURL } = await uploadProfilePhoto(file);
      await updateProfile({ photoURL }, { strict: true });
      setPreviewUrl(photoURL);
      toast.success(isRtl ? 'تم تحديث صورة الملف الشخصي' : 'Profile photo updated');
    } catch (error) {
      const code = String((error as { code?: string })?.code || '');
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ProfileAvatar] upload failed:', code, message, error);
      setPreviewUrl(profile?.photoURL || null);
      toast.error(describeUploadSaveError(error, isRtl));
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
            ref={cameraRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="user"
            className="sr-only"
            aria-label={isRtl ? 'التقاط صورة بالكاميرا' : 'Take profile photo with camera'}
            onChange={(e) => void onFileChange(e)}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            aria-label={isRtl ? 'اختيار صورة من المعرض' : 'Choose profile photo from gallery'}
            onChange={(e) => void onFileChange(e)}
          />
          <div className="absolute -bottom-1 -right-1 flex gap-1">
            <button
              type="button"
              onClick={() => openPicker('camera')}
              disabled={uploading}
              title={isRtl ? 'الكاميرا' : 'Camera'}
              aria-label={isRtl ? 'التقاط صورة بالكاميرا' : 'Take profile photo with camera'}
              className="p-2 bg-black text-white rounded-xl shadow-lg border-2 border-white disabled:opacity-60"
            >
              <Camera size={16} className={uploading ? 'animate-pulse' : ''} />
            </button>
            <button
              type="button"
              onClick={() => openPicker('gallery')}
              disabled={uploading}
              title={isRtl ? 'المعرض' : 'Gallery'}
              aria-label={isRtl ? 'اختيار صورة من المعرض' : 'Choose profile photo from gallery'}
              className="p-2 bg-[#FFCC00] text-black rounded-xl shadow-lg border-2 border-white disabled:opacity-60"
            >
              <ImagePlus size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default ProfileAvatar;
