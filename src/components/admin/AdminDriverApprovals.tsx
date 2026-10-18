import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  fetchAdminDriverDocumentUrl,
  fetchAdminDrivers,
  updateAdminDriverStatusApi,
  type AdminDriverApiRow,
} from '@/lib/adminService';
import { isReviewQueueDriverStatus } from '@/domain/driver-review';

interface Props {
  isRtl: boolean;
}

const DOC_KEYS = ['id', 'license', 'registration', 'permit'] as const;

export const AdminDriverApprovals: React.FC<Props> = ({ isRtl }) => {
  const [rows, setRows] = useState<AdminDriverApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const drivers = await fetchAdminDrivers();
      setRows(drivers.filter((driver) => isReviewQueueDriverStatus(driver.status)));
    } catch (error) {
      console.error('[admin] approvals load failed:', error);
      toast.error(isRtl ? 'تعذر تحميل طلبات السائقين' : 'Could not load driver applications');
    } finally {
      setLoading(false);
    }
  }, [isRtl]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDoc = async (driver: AdminDriverApiRow, key: (typeof DOC_KEYS)[number]) => {
    try {
      const file = await fetchAdminDriverDocumentUrl(driver, key);
      window.open(file.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('[admin] document open failed:', error);
      toast.error(isRtl ? 'تعذر فتح المستند' : 'Could not open the document');
    }
  };

  const decide = async (driver: AdminDriverApiRow, status: 'approved' | 'rejected') => {
    setBusyId(driver.id);
    try {
      await updateAdminDriverStatusApi(driver, status);
      setRows((prev) => prev.filter((row) => row.id !== driver.id));
      toast.success(
        status === 'approved'
          ? isRtl
            ? 'تم اعتماد السائق ويمكنه بدء الوردية'
            : 'Driver approved. They can start a shift now.'
          : isRtl
            ? 'تم رفض الطلب'
            : 'Application rejected'
      );
    } catch (error) {
      console.error('[admin] driver decision failed:', error);
      toast.error(error instanceof Error ? error.message : isRtl ? 'تعذر تحديث الحالة' : 'Could not update status');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-gray-400">{isRtl ? 'جاري تحميل الطلبات...' : 'Loading applications...'}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black">{isRtl ? 'اعتماد السائقين' : 'Driver Approvals'}</h2>
        <p className="text-sm text-gray-500 mt-1">
          {isRtl
            ? 'السائقون الجدد يبقون قيد المراجعة حتى الاعتماد. بعد الموافقة يمكنهم تفعيل الوردية فوراً.'
            : 'New drivers stay under review until you approve them. Approval lets them go on duty immediately.'}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="bg-white rounded-[28px] border border-gray-100 p-8 text-sm text-gray-400">
          {isRtl ? 'لا توجد طلبات بانتظار المراجعة.' : 'No applications are waiting for review.'}
        </p>
      ) : (
        rows.map((driver) => (
          <article key={driver.id} className="bg-white rounded-[28px] border border-gray-100 p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black">{driver.name || driver.id}</h3>
                <p className="text-sm text-gray-500">{driver.phone || '—'}</p>
                <p className="text-sm font-bold mt-1">
                  {driver.truck || driver.serviceType || '—'} · {driver.plateNumber || '—'}
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-amber-50 text-amber-800 text-[10px] font-bold">
                {driver.status}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {DOC_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => void openDoc(driver, key)}
                  className="px-3 py-2 rounded-xl bg-gray-50 text-xs font-bold"
                >
                  {key}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busyId === driver.id}
                onClick={() => void decide(driver, 'approved')}
                className="px-4 py-3 rounded-2xl bg-black text-white text-sm font-bold disabled:opacity-50"
              >
                {isRtl ? 'اعتماد' : 'Approve'}
              </button>
              <button
                type="button"
                disabled={busyId === driver.id}
                onClick={() => void decide(driver, 'rejected')}
                className="px-4 py-3 rounded-2xl bg-red-50 text-red-700 text-sm font-bold disabled:opacity-50"
              >
                {isRtl ? 'رفض' : 'Reject'}
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
};
