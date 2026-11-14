import React, { useMemo, useState } from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { toast } from 'sonner';
import { db } from '@/lib/firebase';
import {
  aggregateSettlement,
  settlementCsv,
  type SettlementOrder,
  type SettlementPayee,
} from '@/domain/partnerTracks';

interface Props {
  isRtl: boolean;
}

function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function text(value: unknown): string {
  return String(value || '').trim();
}

export const AdminSettlementReport: React.FC<Props> = ({ isRtl }) => {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => isoDay(new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => isoDay(today));
  const [rows, setRows] = useState<SettlementPayee[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [ordersSnap, driversSnap, operatorsSnap] = await Promise.all([
        getDocs(query(collection(db, 'orders'), where('status', '==', 'completed'), limit(400))),
        getDocs(query(collection(db, 'drivers'), limit(200))),
        getDocs(query(collection(db, 'operators'), limit(200))),
      ]);
      const payees = new Map<string, { name: string; iban: string; identity: string }>();
      driversSnap.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const bank = (data.bankDetails || {}) as Record<string, unknown>;
        payees.set(docSnap.id, {
          name: text(data.fullName || data.name),
          iban: text(bank.iban),
          identity: text(data.nationalId),
        });
      });
      operatorsSnap.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const bank = (data.bankDetails || {}) as Record<string, unknown>;
        payees.set(docSnap.id, {
          name: text(data.companyName),
          iban: text(bank.iban),
          identity: text(data.commercialRegistration),
        });
      });
      const orders: SettlementOrder[] = ordersSnap.docs.map((docSnap) => {
        const data = docSnap.data();
        const financials = (data.financials || {}) as Record<string, unknown>;
        const completed = data.completedAt || data.updatedAt || data.createdAt;
        const completedAt =
          typeof completed === 'string'
            ? completed
            : completed && typeof completed === 'object' && 'toDate' in completed
              ? (completed as { toDate: () => Date }).toDate().toISOString()
              : '';
        return {
          id: docSnap.id,
          status: text(data.status),
          driverId: text(data.driverId),
          driverName: text(data.driverName),
          operatorId: text(data.operatorId),
          operatorName: text(data.operatorName),
          driverNet: Number(financials.driverNet ?? data.driverNet ?? 0),
          completedAt,
        };
      });
      const report = aggregateSettlement(orders, from, to).map((row) => {
        const known = payees.get(row.payeeId);
        return {
          ...row,
          name: known?.name || row.name,
          iban: known?.iban || '',
          identity: known?.identity || '',
        };
      });
      setRows(report);
      if (report.length === 0) {
        toast.message(isRtl ? 'لا توجد مستحقات مكتملة في هذه الفترة' : 'No completed payables in this period');
      }
    } catch (error) {
      console.error('[admin] settlement load failed:', error);
      toast.error(isRtl ? 'تعذر قراءة الرحلات المكتملة' : 'Could not read completed trips');
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = () => {
    const csv = `\uFEFF${settlementCsv(rows, `JZ-${to}`)}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `jz-payout-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printPdf = () => {
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      toast.error(isRtl ? 'اسمح بالنوافذ المنبثقة لحفظ PDF' : 'Allow pop-ups to save the PDF');
      return;
    }
    const body = rows
      .map(
        (row) =>
          `<tr><td>${row.name}</td><td>${row.kind === 'company' ? 'شركة' : 'فرد'}</td><td dir="ltr">${row.iban}</td><td>${row.netSar.toFixed(2)}</td><td>${row.trips}</td></tr>`
      )
      .join('');
    popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تسوية جيز لوجستيك</title>
      <style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:right}</style></head>
      <body><h1>تقرير التسوية</h1><p>${from} → ${to}</p><table><thead><tr><th>المستفيد</th><th>النوع</th><th>الآيبان</th><th>الصافي</th><th>الرحلات</th></tr></thead><tbody>${body}</tbody></table></body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const total = rows.reduce((sum, row) => sum + row.netSar, 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black">{isRtl ? 'تقارير التسوية والتحويل الجماعي' : 'Settlement and bulk payout'}</h2>
        <p className="mt-1 text-sm text-gray-500">
          {isRtl
            ? 'يجمع صافي الرحلات المكتملة لكل سائق فرد ولكل شركة خلال الفترة. الملف البنكي CSV جاهز للتحويل الجماعي، وPDF للطباعة.'
            : 'Sums completed-trip net pay for each individual driver and each company. Export a bank CSV or a printable PDF.'}
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-[28px] border border-gray-100 bg-white p-5">
        <label className="text-sm font-bold">
          {isRtl ? 'من' : 'From'}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2" />
        </label>
        <label className="text-sm font-bold">
          {isRtl ? 'إلى' : 'To'}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-xl border px-3 py-2" />
        </label>
        <button type="button" onClick={() => void load()} className="rounded-xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white">
          {loading ? (isRtl ? 'جاري الجمع...' : 'Building...') : isRtl ? 'استخراج التقرير' : 'Build report'}
        </button>
        <button type="button" disabled={rows.length === 0} onClick={downloadCsv} className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-40">
          {isRtl ? 'ملف بنكي CSV' : 'Bank CSV'}
        </button>
        <button type="button" disabled={rows.length === 0} onClick={printPdf} className="rounded-xl bg-stone-100 px-4 py-3 text-sm font-bold disabled:opacity-40">
          {isRtl ? 'طباعة / PDF' : 'Print / PDF'}
        </button>
      </div>
      <div className="overflow-x-auto rounded-[28px] border border-gray-100 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400">
              <th className="px-4 py-3 text-start">{isRtl ? 'المستفيد' : 'Payee'}</th>
              <th className="px-4 py-3 text-start">{isRtl ? 'النوع' : 'Kind'}</th>
              <th className="px-4 py-3 text-start">{isRtl ? 'الآيبان' : 'IBAN'}</th>
              <th className="px-4 py-3 text-start">{isRtl ? 'الصافي' : 'Net'}</th>
              <th className="px-4 py-3 text-start">{isRtl ? 'الرحلات' : 'Trips'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.payeeId} className="border-t border-gray-50">
                <td className="px-4 py-3 font-bold">{row.name}</td>
                <td className="px-4 py-3">{row.kind === 'company' ? (isRtl ? 'شركة' : 'Company') : isRtl ? 'فرد' : 'Individual'}</td>
                <td className="px-4 py-3 font-mono" dir="ltr">{row.iban || '—'}</td>
                <td className="px-4 py-3 font-mono">{row.netSar.toFixed(2)}</td>
                <td className="px-4 py-3">{row.trips}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-4 font-black">{isRtl ? 'الإجمالي' : 'Total'}: {total.toFixed(2)} SAR</p>
      </div>
    </div>
  );
};
