import React from 'react';
import { motion } from 'motion/react';
import type { ContractStatus } from '@/lib/b2bContractStore';

export const B2B_COLORS = {
  slate: 'text-slate-800',
  slateMuted: 'text-slate-500',
  teal: 'text-teal-600',
  tealBg: 'bg-teal-600',
  tealLight: 'bg-teal-50',
  slateCard: 'bg-white border border-slate-200/80 shadow-sm',
} as const;

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: 'teal' | 'slate' | 'amber';
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, sub, icon, accent = 'teal' }) => {
  const accentMap = {
    teal: 'from-teal-500/10 to-teal-600/5 border-teal-200/60 text-teal-700',
    slate: 'from-slate-600/10 to-slate-700/5 border-slate-200/60 text-slate-700',
    amber: 'from-amber-400/10 to-amber-500/5 border-amber-200/60 text-amber-700',
  };

  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-5 ${accentMap[accent]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{label}</p>
          <p className="text-2xl font-black text-slate-900 truncate">{value}</p>
          {sub && <p className="text-xs font-medium text-slate-500">{sub}</p>}
        </div>
        <div className="shrink-0 w-10 h-10 rounded-xl bg-white/80 flex items-center justify-center shadow-sm">
          {icon}
        </div>
      </div>
    </div>
  );
};

const STATUS_STYLES: Record<ContractStatus, { bg: string; text: string; labelEn: string; labelAr: string }> = {
  open: { bg: 'bg-teal-50 border-teal-200', text: 'text-teal-700', labelEn: 'Open', labelAr: 'مفتوح' },
  applied: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', labelEn: 'Applied', labelAr: 'تم التقديم' },
  accepted: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', labelEn: 'Accepted', labelAr: 'مقبول' },
  closed: { bg: 'bg-slate-100 border-slate-200', text: 'text-slate-600', labelEn: 'Closed', labelAr: 'مغلق' },
};

export const StatusBadge: React.FC<{ status: ContractStatus; isRtl?: boolean }> = ({
  status,
  isRtl,
}) => {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${s.bg} ${s.text}`}
    >
      {isRtl ? s.labelAr : s.labelEn}
    </span>
  );
};

interface TabBarProps {
  tabs: { id: string; label: string; icon?: React.ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, active, onChange }) => (
  <div className="flex flex-wrap gap-2 p-1.5 rounded-2xl bg-slate-100/80 border border-slate-200/60">
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        onClick={() => onChange(tab.id)}
        className={`flex-1 min-w-[140px] flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
          active === tab.id
            ? 'bg-white text-slate-800 shadow-md shadow-slate-200/50 ring-1 ring-slate-200/80'
            : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
        }`}
      >
        {tab.icon}
        {tab.label}
      </button>
    ))}
  </div>
);

interface SectionCardProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  subtitle,
  icon,
  children,
  className = '',
}) => (
  <motion.section
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    className={`rounded-3xl bg-white border border-slate-200/80 shadow-sm overflow-hidden ${className}`}
  >
    <div className="px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-slate-50/80 to-teal-50/30 flex items-center gap-3">
      {icon && (
        <div className="w-10 h-10 rounded-xl bg-teal-600/10 flex items-center justify-center text-teal-700">
          {icon}
        </div>
      )}
      <div>
        <h2 className="text-lg font-black text-slate-800 tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs font-medium text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    <div className="p-6">{children}</div>
  </motion.section>
);

export const FieldLabel: React.FC<{ children: React.ReactNode; required?: boolean }> = ({
  children,
  required,
}) => (
  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide mb-2">
    {children}
    {required && <span className="text-teal-600 ms-1">*</span>}
  </label>
);

export const inputClass =
  'w-full px-4 py-3.5 rounded-xl border border-slate-200 bg-slate-50/50 text-slate-800 font-medium text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 transition-all';

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-teal-600 text-white font-bold text-sm hover:bg-teal-700 active:scale-[0.98] transition-all shadow-lg shadow-teal-600/20 disabled:opacity-50 disabled:cursor-not-allowed';

export const btnSecondary =
  'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-slate-200 bg-white text-slate-700 font-bold text-sm hover:bg-slate-50 transition-all';
