import React, { useEffect, useMemo } from 'react';
import { Upload, CheckCircle2, ImagePlus } from 'lucide-react';
import type { DriverDocumentKey } from '@/lib/userProfile';
import {
  DRIVER_DOC_ACCEPT,
  getDriverDocumentLabel,
  getDriverDocumentHint,
} from '@/lib/driverDocumentValidation';

interface RequiredDriverDocumentsFieldsProps {
  isRtl: boolean;
  files: Partial<Record<DriverDocumentKey, File>>;
  onSelect: (key: DriverDocumentKey, file: File | null) => void;
  keys?: DriverDocumentKey[];
}

const DEFAULT_KEYS: DriverDocumentKey[] = ['id', 'registration', 'permit', 'license'];

export const RequiredDriverDocumentsFields: React.FC<RequiredDriverDocumentsFieldsProps> = ({
  isRtl,
  files,
  onSelect,
  keys = DEFAULT_KEYS,
}) => {
  const locale = isRtl ? 'ar' : 'en';
  const previews = useMemo(() => {
    const map: Partial<Record<DriverDocumentKey, string>> = {};
    for (const key of keys) {
      const file = files[key];
      if (file) map[key] = URL.createObjectURL(file);
    }
    return map;
  }, [files, keys]);

  useEffect(() => {
    return () => {
      for (const key of keys) {
        const url = previews[key];
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, [previews, keys]);

  return (
    <div className="space-y-3">
      <div className={isRtl ? 'text-right' : 'text-left'}>
        <p className="text-sm font-bold text-neutral-700">
          {isRtl ? 'المستندات المطلوبة (صور)' : 'Required documents (images)'}
        </p>
        <p className="text-[11px] text-stone-400 font-bold leading-relaxed mt-1">
          {isRtl
            ? 'ارفع صور JPEG أو PNG للهوية/الإقامة، الاستمارة، كارت التشغيل، ورخصة القيادة. الحد الأقصى 5 م.ب لكل صورة.'
            : 'Upload JPEG or PNG photos of National ID/Iqama, Istimara, operating card, and driving license. Max 5 MB each.'}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {keys.map((key) => {
          const file = files[key];
          const preview = previews[key];
          const label = getDriverDocumentLabel(key, locale);
          const hint = getDriverDocumentHint(key, locale);
          return (
            <label
              key={key}
              className={`rounded-2xl border-2 border-dashed p-4 flex flex-col gap-2 cursor-pointer transition-colors ${
                file
                  ? 'border-emerald-400 bg-emerald-50/60'
                  : 'border-stone-200 bg-white hover:border-primary'
              } ${isRtl ? 'text-right' : 'text-left'}`}
            >
              <input
                type="file"
                accept={DRIVER_DOC_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const next = e.target.files?.[0] || null;
                  onSelect(key, next);
                  e.target.value = '';
                }}
              />
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-neutral-800">{label}</p>
                  <p className="text-[10px] text-stone-400 font-bold mt-0.5">{hint}</p>
                </div>
                {file ? (
                  <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
                ) : (
                  <ImagePlus size={18} className="text-stone-300 shrink-0" />
                )}
              </div>
              {preview ? (
                <img
                  src={preview}
                  alt={label}
                  className="w-full h-28 object-cover rounded-xl border border-white/80"
                />
              ) : (
                <div className="h-20 rounded-xl bg-stone-50 flex items-center justify-center gap-2 text-stone-400">
                  <Upload size={16} />
                  <span className="text-xs font-bold">
                    {isRtl ? 'اضغط لرفع صورة' : 'Tap to upload image'}
                  </span>
                </div>
              )}
              {file ? (
                <p className="text-[10px] font-bold text-emerald-700 truncate">{file.name}</p>
              ) : (
                <p className="text-[10px] font-bold text-red-500">
                  {isRtl ? 'مطلوب' : 'Required'}
                </p>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
};
