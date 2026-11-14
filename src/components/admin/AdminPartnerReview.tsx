import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, limit, onSnapshot, query, updateDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import { updateAdminDriverStatusApi } from '@/lib/adminService';
import { FLEET_BODY_TYPES } from '@/domain/partnerTracks';

interface Props {
  isRtl: boolean;
}

interface TrackRow {
  id: string;
  track: 'individual' | 'company';
  name: string;
  phone: string;
  identity: string;
  status: string;
  iban: string;
  holder: string;
  match: string;
  vehicle: string;
  fleet: string;
  license: string;
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function pending(status: string): boolean {
  return ['pending', 'pending_approval', 'pending_review', 'ready_for_review'].includes(status);
}

export const AdminPartnerReview: React.FC<Props> = ({ isRtl }) => {
  const [rows, setRows] = useState<TrackRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const map = new Map<string, TrackRow>();
    const publish = () => setRows([...map.values()]);
    const unsubDrivers = onSnapshot(
      query(collection(db, 'drivers'), limit(80)),
      (snap) => {
        for (const key of [...map.keys()]) {
          if (key.startsWith('individual:')) map.delete(key);
        }
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const status = text(data.accountStatus);
          if (!pending(status)) return;
          const bank = (data.bankDetails || {}) as Record<string, unknown>;
          const check = (data.ibanVerification || {}) as Record<string, unknown>;
          map.set(`individual:${docSnap.id}`, {
            id: docSnap.id,
            track: 'individual',
            name: text(data.fullName || data.name),
            phone: text(data.phone),
            identity: text(data.nationalId),
            status,
            iban: text(bank.iban),
            holder: text(bank.accountHolderName),
            match: text(check.status) === 'matched' ? 'matched' : 'review',
            vehicle: [text(data.vehicleType), text(data.vehicleModel), text(data.plateNumber)]
              .filter(Boolean)
              .join(' · '),
            fleet: '',
            license: '',
          });
        });
        publish();
      },
      (error) => console.warn('[admin] driver track listen failed:', error)
    );
    const unsubOperators = onSnapshot(
      query(collection(db, 'operators'), limit(80)),
      (snap) => {
        for (const key of [...map.keys()]) {
          if (key.startsWith('company:')) map.delete(key);
        }
        snap.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const status = text(data.accountStatus || 'pending');
          if (!pending(status)) return;
          const bank = (data.bankDetails || {}) as Record<string, unknown>;
          const check = (data.ibanVerification || {}) as Record<string, unknown>;
          const plan = (data.fleetPlan || {}) as { totalVehicles?: number; types?: Record<string, number> };
          const fleet = FLEET_BODY_TYPES.map((kind) => {
            const count = Number(plan.types?.[kind.id] || 0);
            return count > 0 ? `${isRtl ? kind.ar : kind.en}: ${count}` : '';
          })
            .filter(Boolean)
            .join(' · ');
          map.set(`company:${docSnap.id}`, {
            id: docSnap.id,
            track: 'company',
            name: text(data.companyName),
            phone: text(data.phone),
            identity: text(data.commercialRegistration),
            status,
            iban: text(bank.iban),
            holder: text(bank.accountHolderName),
            match: text(check.status) === 'matched' ? 'matched' : 'review',
            vehicle: '',
            fleet: fleet || (plan.totalVehicles ? String(plan.totalVehicles) : ''),
            license: text(data.transportLicense),
          });
        });
        publish();
      },
      (error) => console.warn('[admin] company track listen failed:', error)
    );
    return () => {
      unsubDrivers();
      unsubOperators();
    };
  }, [isRtl]);

  const individuals = useMemo(() => rows.filter((row) => row.track === 'individual'), [rows]);
  const companies = useMemo(() => rows.filter((row) => row.track === 'company'), [rows]);

  const decide = async (row: TrackRow, status: 'approved' | 'rejected') => {
    setBusyId(`${row.track}:${row.id}`);
    try {
      if (row.track === 'individual') {
        await updateAdminDriverStatusApi({ id: row.id, kind: 'b2c_driver' }, status);
      } else {
        const next = status === 'approved' ? 'approved' : 'rejected';
        await updateDoc(doc(db, 'operators', row.id), {
          accountStatus: next,
          reviewedAt: new Date().toISOString(),
        });
        await updateDoc(doc(db, 'users', row.id), { accountStatus: next }).catch((error) => {
          console.warn('[admin] company user status mirror failed:', error);
        });
      }
      toast.success(status === 'approved' ? (isRtl ? 'تم الاعتماد' : 'Approved') : isRtl ? 'تم الرفض' : 'Rejected');
    } catch (error) {
      console.error('[admin] partner decision failed:', error);
      toast.error(error instanceof Error ? error.message : isRtl ? 'تعذر تحديث الطلب' : 'Could not update the application');
    } finally {
      setBusyId(null);
    }
  };

  const section = (title: string, list: TrackRow[]) => (
    <section className="space-y-3">
      <h3 className="text-lg font-black">{title}</h3>
      {list.length === 0 ? (
        <p className="rounded-3xl border border-gray-100 bg-white p-6 text-sm text-gray-400">
          {isRtl ? 'لا توجد طلبات في هذا المسار.' : 'No applications on this track.'}
        </p>
      ) : (
        list.map((row) => (
          <article key={`${row.track}:${row.id}`} className="rounded-3xl border border-gray-100 bg-white p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-black">{row.name || row.id}</p>
                <p className="text-sm text-gray-500" dir="ltr">{row.phone || '—'}</p>
                <p className="text-sm font-bold">{isRtl ? 'الهوية / السجل' : 'ID / CR'}: {row.identity || '—'}</p>
                <p className="text-sm">{row.vehicle || row.fleet || '—'}</p>
                {row.license ? <p className="text-xs text-gray-500">{row.license}</p> : null}
                <p className="text-xs font-mono" dir="ltr">{row.iban || '—'}</p>
                <p className="text-xs text-gray-500">{row.holder || '—'}</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-[10px] font-bold ${row.match === 'matched' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
                {row.match === 'matched'
                  ? isRtl
                    ? 'الاسم مطابق'
                    : 'Name matched'
                  : isRtl
                    ? 'بانتظار مطابقة المستند'
                    : 'Document match pending'}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyId === `${row.track}:${row.id}`}
                onClick={() => void decide(row, 'approved')}
                className="rounded-xl bg-neutral-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
              >
                {isRtl ? 'اعتماد' : 'Approve'}
              </button>
              <button
                type="button"
                disabled={busyId === `${row.track}:${row.id}`}
                onClick={() => void decide(row, 'rejected')}
                className="rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-700 disabled:opacity-50"
              >
                {isRtl ? 'رفض' : 'Reject'}
              </button>
            </div>
          </article>
        ))
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black">{isRtl ? 'مسارا التسجيل' : 'Registration tracks'}</h2>
        <p className="mt-1 text-sm text-gray-500">
          {isRtl
            ? 'طلبات الأفراد منفصلة عن طلبات الشركات. اعتماد الشركة يربط عوائد أسطولها بآيبانها التجاري.'
            : 'Individual applications stay separate from company applications. Approving a company pays its fleet to the company IBAN.'}
        </p>
      </div>
      {section(isRtl ? 'سائقون أفراد' : 'Individual drivers', individuals)}
      {section(isRtl ? 'شركات ومؤسسات' : 'Companies and establishments', companies)}
    </div>
  );
};
