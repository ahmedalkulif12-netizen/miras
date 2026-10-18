import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import {
  DEFAULT_PAYOUT_INTERVAL_DAYS,
  normalizePayoutIntervalDays,
} from '@/domain/payoutPolicy';

interface Props {
  isRtl: boolean;
}

/** Earnings withdrawal cadence. Lives on the withdrawal-requests page, not service pricing. */
export const AdminPayoutSchedule: React.FC<Props> = ({ isRtl }) => {
  const [intervalDays, setIntervalDays] = useState(String(DEFAULT_PAYOUT_INTERVAL_DAYS));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getDoc(doc(db, 'settings', 'payouts'))
      .then((snap) => {
        if (cancelled) return;
        setIntervalDays(
          String(
            normalizePayoutIntervalDays(
              snap.exists() ? snap.data()?.payoutIntervalDays : undefined
            )
          )
        );
      })
      .catch((error) => {
        console.error('[admin] payout settings load failed:', error);
        toast.error(isRtl ? 'تعذر تحميل جدول السحب' : 'Could not load the payout schedule');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isRtl]);

  const savePayout = async () => {
    const days = normalizePayoutIntervalDays(intervalDays);
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'settings', 'payouts'),
        {
          payoutIntervalDays: days,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      setIntervalDays(String(days));
      toast.success(isRtl ? 'تم حفظ جدول السحب' : 'Payout schedule saved');
    } catch (error) {
      console.error('[admin] payout settings save failed:', error);
      toast.error(isRtl ? 'تعذر حفظ جدول السحب' : 'Could not save the payout schedule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white rounded-[32px] border border-gray-100 p-8 space-y-4">
      <h2 className="text-xl font-black">{isRtl ? 'جدول سحب الأرباح' : 'Earnings withdrawal schedule'}</h2>
      <p className="text-sm text-gray-500">
        {isRtl
          ? 'المدة الدنيا بين طلبات سحب رصيد السائق. القيمة الافتراضية ١٤ يوماً.'
          : 'Minimum days between driver wallet withdrawal requests. Default is 14 days.'}
      </p>
      {loading ? (
        <p className="text-sm text-gray-400">{isRtl ? 'جاري التحميل...' : 'Loading...'}</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-bold text-gray-400">
            {isRtl ? 'كل كم يوم' : 'Interval (days)'}
            <input
              type="number"
              min={1}
              max={90}
              value={intervalDays}
              onChange={(event) => setIntervalDays(event.target.value)}
              className="block w-32 mt-1 p-3 rounded-2xl bg-gray-50 font-mono font-bold text-black"
            />
          </label>
          <button
            type="button"
            disabled={saving}
            onClick={() => void savePayout()}
            className="px-5 py-3 rounded-2xl bg-black text-white text-sm font-bold disabled:opacity-50"
          >
            {isRtl ? 'حفظ الجدول' : 'Save schedule'}
          </button>
        </div>
      )}
    </section>
  );
};
