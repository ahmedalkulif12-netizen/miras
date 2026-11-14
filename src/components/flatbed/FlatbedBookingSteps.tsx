import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Camera, ImagePlus, MapPin, Navigation } from 'lucide-react';
import { LocationAutocomplete, type SelectedPlace } from '@/components/LocationAutocomplete';
import { searchPlacesByText, type NearbyPlace } from '@/lib/placesNearby';
import type { FlatbedServiceMode } from '@/domain/flatbedBooking';

interface Props {
  isRtl: boolean;
  mode: FlatbedServiceMode;
  onModeChange: (mode: FlatbedServiceMode) => void;
  pickupCity: string;
  pickupCoords: google.maps.LatLngLiteral | null;
  onPlace: (target: 'pickup' | 'dropoff', place: SelectedPlace) => void;
  onUseCurrentLocation: () => void;
  locating: boolean;
  tiresIntact: boolean | null;
  onTiresIntact: (value: boolean) => void;
  notes: string;
  onNotes: (value: string) => void;
  vehicleMakeModel: string;
  onVehicleMakeModel: (value: string) => void;
  plateLetters: string;
  plateDigits: string;
  onPlateLetters: (value: string) => void;
  onPlateDigits: (value: string) => void;
  serialNumber: string;
  chassisNumber: string;
  onSerialNumber: (value: string) => void;
  onChassisNumber: (value: string) => void;
  istimaraName: string;
  istimaraUploading: boolean;
  onIstimaraFile: (file: File) => void;
  industrialWorkshop: string;
  onIndustrialWorkshop: (value: string) => void;
}

const MODES: Array<{ id: FlatbedServiceMode; ar: string; en: string }> = [
  { id: 'workshop', ar: 'من ورشة إلى ورشة', en: 'Workshop to workshop' },
  { id: 'industrial', ar: 'مشوار الصناعية', en: 'Industrial area' },
  { id: 'taqdeer', ar: 'تقدير الحوادث', en: 'Accident assessment' },
];

function placeFromHit(hit: NearbyPlace, city: string): SelectedPlace {
  return {
    location: hit.location,
    formattedAddress: hit.address || hit.name,
    displayName: hit.name,
    city,
  };
}

export const FlatbedBookingSteps: React.FC<Props> = ({
  isRtl,
  mode,
  onModeChange,
  pickupCity,
  pickupCoords,
  onPlace,
  onUseCurrentLocation,
  locating,
  tiresIntact,
  onTiresIntact,
  notes,
  onNotes,
  vehicleMakeModel,
  onVehicleMakeModel,
  plateLetters,
  plateDigits,
  onPlateLetters,
  onPlateDigits,
  serialNumber,
  chassisNumber,
  onSerialNumber,
  onChassisNumber,
  istimaraName,
  istimaraUploading,
  onIstimaraFile,
  industrialWorkshop,
  onIndustrialWorkshop,
}) => {
  const placesLib = useMapsLibrary('places');
  const [hits, setHits] = useState<NearbyPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const align = isRtl ? 'text-right' : 'text-left';

  useEffect(() => {
    setHits([]);
    setSelectedId('');
  }, [mode, pickupCity]);

  useEffect(() => {
    if (mode === 'workshop' || !placesLib || !pickupCoords) return;
    let cancelled = false;
    const city = pickupCity.trim();
    const query =
      mode === 'taqdeer'
        ? city
          ? `مركز تقدير ${city}`
          : 'مركز تقدير الحوادث'
        : city
          ? `منطقة صناعية ${city}`
          : 'منطقة صناعية';
    setSearching(true);
    void searchPlacesByText(query, pickupCoords).then((rows) => {
      if (cancelled) return;
      setHits(rows);
      setSearching(false);
        if (mode === 'taqdeer' && rows[0]) {
        setSelectedId(rows[0].id);
        onPlaceRef.current('dropoff', placeFromHit(rows[0], city));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [mode, placesLib, pickupCoords, pickupCity]);

  const chooseHit = (hit: NearbyPlace) => {
    setSelectedId(hit.id);
    const label = industrialWorkshop.trim()
      ? `${hit.name} — ${industrialWorkshop.trim()}`
      : hit.name;
    onPlace('dropoff', {
      ...placeFromHit(hit, pickupCity),
      displayName: label,
      formattedAddress: industrialWorkshop.trim()
        ? `${hit.address} — ${industrialWorkshop.trim()}`
        : hit.address,
    });
  };

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <p className={`text-sm font-black ${align}`}>
          {isRtl ? '٢. نوع المشوار' : '2. Trip type'}
        </p>
        <div className="grid gap-2">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onModeChange(item.id)}
              className={`min-h-12 rounded-2xl border-2 px-4 text-sm font-black ${align} ${
                mode === item.id ? 'bg-black text-[#FFCC00] border-black' : 'bg-white border-stone-200'
              }`}
            >
              {isRtl ? item.ar : item.en}
            </button>
          ))}
        </div>
      </section>

      {(mode === 'workshop' || mode === 'industrial') && (
        <section className="space-y-3">
          <p className={`text-xs font-bold text-gray-500 ${align}`}>
            {isRtl
              ? 'ابحث في أي مدينة: اسم الورشة أو المنطقة الصناعية، مثل الصناعية القديمة أو صناعية النسيم في الرياض.'
              : 'Search any Saudi city by workshop name or industrial area, such as Riyadh’s Old Industrial Area or Al-Naseem.'}
          </p>
          <label className={`block text-sm font-black ${align}`}>
            {mode === 'industrial'
              ? isRtl
                ? 'ورشة أو منطقة صناعية — التحميل'
                : 'Pickup workshop or industrial area'
              : isRtl
                ? 'اسم / موقع ورشة التحميل'
                : 'Pickup workshop'}
          </label>
          <LocationAutocomplete
            isRtl={isRtl}
            bias={pickupCoords}
            placeholder={isRtl ? 'ابحث عن موقع التحميل' : 'Search the pickup'}
            onPlaceSelect={(place) => onPlace('pickup', place)}
          />
          {mode === 'industrial' && (
            <button
              type="button"
              onClick={onUseCurrentLocation}
              disabled={locating}
              className="w-full min-h-12 rounded-2xl bg-[#FFCC00] border-2 border-black font-black text-sm flex items-center justify-center gap-2"
            >
              <Navigation size={16} />
              {locating
                ? isRtl
                  ? 'جاري تحديد موقعك...'
                  : 'Finding your location...'
                : isRtl
                  ? 'أو استخدم موقعي الحالي للتحميل'
                  : 'Or use my current location for pickup'}
            </button>
          )}
          <label className={`block text-sm font-black ${align}`}>
            {mode === 'industrial'
              ? isRtl
                ? 'ورشة أو منطقة صناعية — التنزيل'
                : 'Drop-off workshop or industrial area'
              : isRtl
                ? 'اسم / موقع ورشة التنزيل'
                : 'Drop-off workshop'}
          </label>
          <LocationAutocomplete
            isRtl={isRtl}
            bias={pickupCoords}
            placeholder={isRtl ? 'ابحث عن موقع التنزيل' : 'Search the drop-off'}
            onPlaceSelect={(place) => onPlace('dropoff', place)}
          />
          {mode === 'industrial' && hits.length > 0 && (
            <div className="grid gap-2">
              <p className={`text-xs font-bold text-gray-500 ${align}`}>
                {isRtl ? 'مناطق صناعية قريبة' : 'Nearby industrial areas'}
              </p>
              {hits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => chooseHit(hit)}
                  className={`min-h-12 rounded-2xl border px-3 py-2 ${align} ${
                    selectedId === hit.id ? 'border-black bg-black text-white' : 'border-stone-200 bg-white'
                  }`}
                >
                  <span className="block text-sm font-black">{hit.name}</span>
                  <span className="block text-[11px] font-medium opacity-70">{hit.address}</span>
                </button>
              ))}
            </div>
          )}
          {mode === 'industrial' && (
            <input
              value={industrialWorkshop}
              onChange={(event) => onIndustrialWorkshop(event.target.value.slice(0, 80))}
              placeholder={isRtl ? 'اسم الورشة داخل الصناعية (اختياري)' : 'Workshop name inside the industrial area (optional)'}
              className={`w-full min-h-12 rounded-2xl border border-stone-200 bg-gray-50 px-4 text-sm font-bold outline-none focus:border-black ${align}`}
            />
          )}
        </section>
      )}

      {mode === 'taqdeer' && (
        <section className="space-y-3">
          <button
            type="button"
            onClick={onUseCurrentLocation}
            disabled={locating}
            className="w-full min-h-12 rounded-2xl bg-[#FFCC00] border-2 border-black font-black text-sm flex items-center justify-center gap-2"
          >
            <Navigation size={16} />
            {locating
              ? isRtl
                ? 'جاري تحديد موقعك...'
                : 'Finding your location...'
              : isRtl
                ? 'التحميل من موقعي الحالي'
                : 'Pickup from my current location'}
          </button>
          <p className={`text-xs font-bold text-gray-500 ${align}`}>
            {searching
              ? isRtl
                ? 'جاري البحث في خرائط جوجل...'
                : 'Searching Google Maps...'
              : isRtl
                ? 'أقرب مركز تقدير في مدينتك. يمكنك اختيار مركزاً آخر.'
                : 'Nearest Taqdeer center in your city. You can switch if several are listed.'}
          </p>
          <div className="grid gap-2">
            {hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => chooseHit(hit)}
                className={`min-h-12 rounded-2xl border px-3 py-2 ${align} ${
                  selectedId === hit.id ? 'border-black bg-black text-white' : 'border-stone-200 bg-white'
                }`}
              >
                <span className="block text-sm font-black">{hit.name}</span>
                <span className="block text-[11px] font-medium opacity-70">{hit.address}</span>
              </button>
            ))}
            {!searching && hits.length === 0 && (
              <p className={`text-xs font-bold text-amber-700 ${align}`}>
                {isRtl
                  ? 'لم يتم العثور على نتائج بعد. حدد موقعك ثم أعد المحاولة.'
                  : 'No places yet. Set your location and try again.'}
              </p>
            )}
          </div>
        </section>
      )}

      <section className="space-y-2 rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
        <p className={`text-sm font-black text-amber-950 ${align}`}>
          {isRtl ? '٣. هل حالة الكفرات سليمة وتدور؟' : '3. Are the tires intact and rolling?'}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onTiresIntact(true)}
            className={`min-h-12 rounded-xl border text-sm font-black ${
              tiresIntact === true ? 'bg-black text-white border-black' : 'bg-white border-amber-200'
            }`}
          >
            {isRtl ? 'سليمة · 0' : 'Yes · 0 SAR'}
          </button>
          <button
            type="button"
            onClick={() => onTiresIntact(false)}
            className={`min-h-12 rounded-xl border text-sm font-black ${
              tiresIntact === false ? 'bg-black text-white border-black' : 'bg-white border-amber-200'
            }`}
          >
            {isRtl ? 'تالفة · +100' : 'Damaged · +100'}
          </button>
        </div>
        <textarea
          value={notes}
          onChange={(event) => onNotes(event.target.value.slice(0, 500))}
          placeholder={isRtl ? 'ملاحظات إضافية للسائق' : 'Additional notes for the driver'}
          className={`w-full min-h-[88px] rounded-xl border border-amber-100 bg-white p-3 text-sm outline-none focus:border-amber-400 ${align}`}
        />
      </section>

      <section className={`space-y-3 rounded-2xl border border-stone-200 bg-white p-4 ${align}`}>
        <p className="text-sm font-black">
          {isRtl ? '٤. بيانات المركبة والاستمارة' : '4. Vehicle details and istimara'}
        </p>
        <input
          value={vehicleMakeModel}
          onChange={(event) => onVehicleMakeModel(event.target.value.slice(0, 80))}
          placeholder={isRtl ? 'اسم ونوع السيارة، مثال: تويوتا كامري' : 'Make and model, e.g. Toyota Camry'}
          className={`w-full min-h-12 rounded-xl border border-stone-200 bg-gray-50 px-4 text-sm font-bold outline-none focus:border-black ${align}`}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={plateLetters}
            onChange={(event) => onPlateLetters(event.target.value.slice(0, 3))}
            placeholder={isRtl ? 'حروف اللوحة' : 'Plate letters'}
            className="min-h-12 rounded-xl border border-stone-200 bg-gray-50 px-3 text-center text-sm font-black outline-none focus:border-black"
          />
          <input
            value={plateDigits}
            inputMode="numeric"
            onChange={(event) => onPlateDigits(event.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder={isRtl ? 'أرقام اللوحة' : 'Plate digits'}
            className="min-h-12 rounded-xl border border-stone-200 bg-gray-50 px-3 text-center text-sm font-black outline-none focus:border-black"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => document.getElementById('istimara-camera')?.click()}
            className="min-h-16 rounded-xl border-2 border-dashed border-stone-300 text-xs font-black flex flex-col items-center justify-center gap-1"
          >
            <Camera size={16} />
            {isRtl ? 'تصوير الاستمارة' : 'Camera'}
          </button>
          <button
            type="button"
            onClick={() => document.getElementById('istimara-gallery')?.click()}
            className="min-h-16 rounded-xl border-2 border-dashed border-stone-300 text-xs font-black flex flex-col items-center justify-center gap-1"
          >
            <ImagePlus size={16} />
            {isRtl ? 'من المعرض' : 'Gallery'}
          </button>
        </div>
        <input
          id="istimara-camera"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onIstimaraFile(file);
            event.target.value = '';
          }}
        />
        <input
          id="istimara-gallery"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onIstimaraFile(file);
            event.target.value = '';
          }}
        />
        <p className="text-[11px] font-bold text-gray-500 flex items-center gap-1">
          <MapPin size={12} />
          {istimaraUploading
            ? isRtl
              ? 'جاري رفع صورة الاستمارة...'
              : 'Uploading istimara...'
            : istimaraName || (isRtl ? 'أدخل صورة الاستمارة أو الرقم التسلسلي / الشاصي' : 'Upload the istimara or enter the serial / VIN')}
        </p>
        <input
          value={serialNumber}
          inputMode="numeric"
          onChange={(event) => onSerialNumber(event.target.value.replace(/\D/g, '').slice(0, 15))}
          placeholder={isRtl ? 'الرقم التسلسلي' : 'Serial number'}
          className={`w-full min-h-12 rounded-xl border border-stone-200 bg-gray-50 px-4 text-sm font-bold outline-none focus:border-black ${align}`}
        />
        <input
          value={chassisNumber}
          onChange={(event) => onChassisNumber(event.target.value.toUpperCase().replace(/\s/g, '').slice(0, 17))}
          placeholder={isRtl ? 'رقم الشاصي' : 'Chassis / VIN'}
          className={`w-full min-h-12 rounded-xl border border-stone-200 bg-gray-50 px-4 text-sm font-bold outline-none focus:border-black ${align}`}
        />
      </section>
    </div>
  );
};
