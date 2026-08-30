import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Eye, Search, Users, Truck, Building2, Warehouse, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchAdminDirectory,
  type AdminDirectoryEntry,
  type AdminDirectoryKind,
  type AdminDirectoryResponse,
} from '@/lib/adminService';
import { B2B_MODULES_ENABLED } from '@/lib/launchFlags';

const KIND_FILTERS: Array<{ id: 'all' | 'drivers' | AdminDirectoryKind; en: string; ar: string }> = [
  { id: 'all', en: 'All registrations', ar: 'كل التسجيلات' },
  { id: 'drivers', en: 'All drivers', ar: 'كل السائقين' },
  { id: 'b2c_client', en: 'Individual Clients (B2C)', ar: 'عملاء أفراد' },
  { id: 'b2c_driver', en: 'Individual Drivers', ar: 'سائقون أفراد' },
  ...(B2B_MODULES_ENABLED
    ? [
        { id: 'b2b_corporate' as const, en: 'Corporate Clients (B2B)', ar: 'عملاء شركات' },
        { id: 'b2b_operator' as const, en: 'Fleet Operators', ar: 'مشغلو الأسطول' },
        { id: 'fleet_driver' as const, en: 'Fleet Drivers', ar: 'سائقو الأسطول' },
      ]
    : []),
];

function kindBadgeClass(kind: AdminDirectoryKind): string {
  switch (kind) {
    case 'b2c_client':
      return 'bg-sky-50 text-sky-700';
    case 'b2c_driver':
      return 'bg-amber-50 text-amber-700';
    case 'b2b_corporate':
      return 'bg-violet-50 text-violet-700';
    case 'b2b_operator':
      return 'bg-emerald-50 text-emerald-700';
    case 'fleet_driver':
      return 'bg-orange-50 text-orange-700';
    default:
      return 'bg-gray-50 text-gray-600';
  }
}

function DetailRow({
  label,
  value,
  isRtl,
}: {
  label: string;
  value?: string | null;
  isRtl: boolean;
}) {
  if (!value) return null;
  return (
    <div className={`space-y-1 ${isRtl ? 'text-right' : 'text-left'}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="text-sm font-bold text-neutral-800 break-all">{value}</p>
    </div>
  );
}

export const AdminDirectoryPanel: React.FC<{ isRtl: boolean }> = ({ isRtl }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialKind = searchParams.get('kind');
  const [kind, setKind] = useState<'all' | AdminDirectoryKind | 'drivers'>(
    initialKind === 'drivers'
      ? 'drivers'
      : KIND_FILTERS.some((f) => f.id === initialKind)
        ? (initialKind as AdminDirectoryKind)
        : 'all'
  );
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AdminDirectoryResponse | null>(null);
  const [selected, setSelected] = useState<AdminDirectoryEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchAdminDirectory('all'));
    } catch (error) {
      console.error('[admin directory]', error);
      toast.error(isRtl ? 'تعذر تحميل دليل المستخدمين' : 'Failed to load user directory');
    } finally {
      setLoading(false);
    }
  }, [isRtl]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const current = searchParams.get('kind') || 'all';
    if (current === kind) return;
    const next = new URLSearchParams();
    if (kind !== 'all') next.set('kind', kind);
    setSearchParams(next, { replace: true });
  }, [kind, searchParams, setSearchParams]);

  const filtered = useMemo(() => {
    const rows = data?.entries || [];
    const byKind =
      kind === 'all'
        ? rows
        : kind === 'drivers'
          ? rows.filter((row) => row.kind === 'b2c_driver' || row.kind === 'fleet_driver')
          : rows.filter((row) => row.kind === kind);
    const q = query.trim().toLowerCase();
    if (!q) return byKind;
    return byKind.filter((row) =>
      [row.name, row.phone, row.companyName, row.plateNumber, row.roleLabelEn, row.roleLabelAr]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [data?.entries, query, kind]);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm p-8 space-y-6">
        <div className={`flex flex-col gap-2 ${isRtl ? 'text-right' : 'text-left'}`}>
          <h3 className="text-xl font-bold flex items-center gap-2">
            <Users size={22} className="text-primary" />
            {isRtl ? 'دليل المستخدمين والسائقين' : 'Users & drivers directory'}
          </h3>
          <p className="text-sm text-gray-500 font-medium">
            {isRtl
              ? 'عرض التسجيلات الحقيقية فقط — بدون بيانات تجريبية.'
              : 'Showing real production registrations only — test records are excluded.'}
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MiniStat
            icon={<Users size={16} />}
            label={isRtl ? 'إجمالي المستخدمين' : 'Total users'}
            value={data?.stats.totalUsers ?? 0}
          />
          <MiniStat
            icon={<Truck size={16} />}
            label={isRtl ? 'إجمالي السائقين' : 'Total drivers'}
            value={data?.stats.totalDrivers ?? 0}
          />
          <MiniStat
            icon={<Building2 size={16} />}
            label={isRtl ? 'عملاء شركات' : 'Corporate'}
            value={data?.stats.totalCorporate ?? 0}
          />
          <MiniStat
            icon={<Warehouse size={16} />}
            label={isRtl ? 'مشغلو الأسطول' : 'Operators'}
            value={data?.stats.totalOperators ?? 0}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setKind(filter.id)}
              className={`px-4 py-2 rounded-full text-xs font-bold border transition-colors ${
                kind === filter.id
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'bg-white text-neutral-500 border-stone-200 hover:border-neutral-400'
              }`}
            >
              {isRtl ? filter.ar : filter.en}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search
            size={16}
            className={`absolute top-1/2 -translate-y-1/2 text-stone-300 ${isRtl ? 'right-4' : 'left-4'}`}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isRtl ? 'بحث بالاسم أو الجوال أو اللوحة' : 'Search name, phone, or plate'}
            className={`w-full py-3 rounded-2xl border border-stone-200 outline-none focus:border-primary ${
              isRtl ? 'pr-11 pl-4 text-right' : 'pl-11 pr-4 text-left'
            }`}
          />
        </div>
      </div>

      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className={`w-full ${isRtl ? 'text-right' : 'text-left'}`}>
            <thead>
              <tr className="bg-gray-50/50 text-[10px] uppercase font-extrabold text-gray-400 tracking-widest">
                <th className="px-8 py-4">{isRtl ? 'الاسم' : 'Name'}</th>
                <th className="px-8 py-4">{isRtl ? 'النوع' : 'Role'}</th>
                <th className="px-8 py-4">{isRtl ? 'الجوال' : 'Phone'}</th>
                <th className="px-8 py-4">{isRtl ? 'المركبة / الشركة' : 'Vehicle / Company'}</th>
                <th className="px-8 py-4">{isRtl ? 'الحالة' : 'Status'}</th>
                <th className="px-8 py-4">{isRtl ? 'تفاصيل' : 'Details'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-8 py-12 text-center text-sm text-gray-400">
                    {isRtl ? 'جاري التحميل...' : 'Loading...'}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-8 py-12 text-center text-sm text-gray-400">
                    {isRtl ? 'لا توجد تسجيلات حقيقية في هذا التصنيف' : 'No real registrations in this filter'}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/50">
                    <td className="px-8 py-5">
                      <div className="font-bold text-sm">{row.name}</div>
                      <div className="text-[10px] text-gray-400">
                        {row.segment === 'b2b' ? 'B2B' : 'B2C'}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold ${kindBadgeClass(row.kind)}`}>
                        {isRtl ? row.roleLabelAr : row.roleLabelEn}
                      </span>
                    </td>
                    <td className="px-8 py-5 font-mono text-xs">{row.phone || '—'}</td>
                    <td className="px-8 py-5 text-sm">
                      {row.companyName || row.plateNumber || row.vehicleType || '—'}
                    </td>
                    <td className="px-8 py-5 text-xs font-bold capitalize">{row.status}</td>
                    <td className="px-8 py-5">
                      <button
                        type="button"
                        onClick={() => setSelected(row)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800"
                      >
                        <Eye size={14} />
                        {isRtl ? 'عرض التفاصيل' : 'View details'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            aria-label="Close"
            onClick={() => setSelected(null)}
          />
          <div className="relative bg-white w-full max-w-lg rounded-[32px] shadow-2xl p-8 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div className={isRtl ? 'text-right' : 'text-left'}>
                <p className={`inline-flex px-3 py-1 rounded-full text-[10px] font-bold ${kindBadgeClass(selected.kind)}`}>
                  {isRtl ? selected.roleLabelAr : selected.roleLabelEn}
                </p>
                <h4 className="text-2xl font-black mt-3">{selected.name}</h4>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="p-2 rounded-full hover:bg-gray-100"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <DetailRow label={isRtl ? 'الجوال' : 'Phone'} value={selected.phone} isRtl={isRtl} />
              <DetailRow label={isRtl ? 'الحالة' : 'Status'} value={selected.status} isRtl={isRtl} />
              <DetailRow label={isRtl ? 'الشركة' : 'Company'} value={selected.companyName} isRtl={isRtl} />
              <DetailRow
                label={isRtl ? 'السجل التجاري' : 'Commercial registration'}
                value={selected.commercialRegistration}
                isRtl={isRtl}
              />
              <DetailRow label={isRtl ? 'نوع المركبة' : 'Vehicle type'} value={selected.vehicleType} isRtl={isRtl} />
              <DetailRow label={isRtl ? 'النوع الفرعي' : 'Subtype'} value={selected.vehicleOption} isRtl={isRtl} />
              <DetailRow label={isRtl ? 'لوحة المركبة' : 'Plate number'} value={selected.plateNumber} isRtl={isRtl} />
              <DetailRow label={isRtl ? 'الهوية / الإقامة' : 'National ID / Iqama'} value={selected.nationalId} isRtl={isRtl} />
              <DetailRow
                label={isRtl ? 'رقم الاستمارة' : 'Registration serial'}
                value={selected.registrationSerial}
                isRtl={isRtl}
              />
              <DetailRow label={isRtl ? 'مشغل الأسطول' : 'Fleet operator'} value={selected.operatorName} isRtl={isRtl} />
              <DetailRow
                label={isRtl ? 'تاريخ التسجيل' : 'Registered'}
                value={selected.createdAt ? new Date(selected.createdAt).toLocaleString() : null}
                isRtl={isRtl}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MiniStat: React.FC<{ icon: React.ReactNode; label: string; value: number }> = ({
  icon,
  label,
  value,
}) => (
  <div className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-3">
    <div className="flex items-center gap-2 text-stone-400 mb-1">
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
    </div>
    <p className="text-2xl font-black font-mono">{value}</p>
  </div>
);
