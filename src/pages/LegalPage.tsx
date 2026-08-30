import React from 'react';
import { useLocation } from 'react-router-dom';
import { Shield, Scale, Info, Lock, Mail, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SimplePublicHeader } from '@/components/SimplePublicHeader';
import {
  SUPPORT_EMAIL,
  supportMailto,
} from '@/lib/supportContact';

const LegalPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const isPrivacyOnly = path === '/privacy';
  const isLegalHub = path === '/legal';
  const showPrivacy = isPrivacyOnly || isLegalHub;
  const showTerms = !isPrivacyOnly;

  return (
    <div className="min-h-dvh bg-blue-50/50">
      <SimplePublicHeader />
      <div className="max-w-4xl mx-auto px-4 pt-10 pb-20 space-y-12 text-black">

        <header className={`space-y-6 ${isRtl ? 'text-right' : 'text-left'}`}>
          <div className={`w-20 h-20 bg-primary/20 rounded-[32px] flex items-center justify-center text-primary shadow-lg shadow-primary/10 ${isRtl ? '' : 'mr-auto ml-0'}`}>
            {isPrivacyOnly ? <Lock size={40} /> : <Scale size={40} />}
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-neutral-900 tracking-tight">
            {isLegalHub
              ? t('legal_hub_title')
              : isPrivacyOnly
                ? t('privacy_policy_title')
                : t('terms_conditions_title')}
          </h1>
          <div className={`flex items-center gap-2 text-stone-400 font-medium ${isRtl ? '' : 'flex-row-reverse justify-end'}`}>
            <Info size={16} />
            <p>{t('last_updated')}: {new Date().toLocaleDateString(isRtl ? 'ar-SA' : 'en-US')}</p>
          </div>
        </header>

        <div className={`bg-white p-8 md:p-16 rounded-[60px] border border-stone-200/60 shadow-xl shadow-stone-200/20 space-y-12 ${isRtl ? 'text-right' : 'text-left'} leading-relaxed`}>
          {showPrivacy ? (
            <>
              <div className="space-y-6 border-b border-stone-100 pb-8">
                <p className="text-lg font-medium text-neutral-700">
                  {t('privacy_intro')}
                </p>
                <div className={`p-4 bg-primary/5 rounded-2xl border border-primary/10 flex items-center gap-3 text-primary font-bold text-sm ${isRtl ? '' : 'flex-row-reverse'}`}>
                  <Shield size={20} />
                  <span>{t('privacy_agreement')}</span>
                </div>
              </div>

              <Section title={isRtl ? '1. البيانات التي نقوم بجمعها' : '1. Data We Collect'} isRtl={isRtl}>
                <p>نقوم بجمع البيانات التالية لتقديم خدمات النقل:</p>
                <ul className="list-disc list-inside mt-4 space-y-3 text-stone-600 font-medium">
                  <li><strong>بيانات الهوية:</strong> الاسم، رقم الجوال، البريد الإلكتروني</li>
                  <li><strong>بيانات الموقع:</strong> الموقع الجغرافي (GPS) لتحديد مواقع الاستلام والتسليم وتتبع الشحنة</li>
                  <li><strong>بيانات الطلبات:</strong> تفاصيل الشحنات، التواريخ، العمليات المالية، والتقييمات</li>
                  <li><strong>بيانات السائقين:</strong> رخصة القيادة، استمارة المركبة، التصاريح الرسمية</li>
                </ul>
              </Section>

              <Section title={isRtl ? '2. كيفية استخدام البيانات' : '2. How We Use Data'} isRtl={isRtl}>
                <p>نستخدم البيانات للأغراض التالية:</p>
                <ul className="list-disc list-inside mt-4 space-y-2 text-stone-600 font-medium">
                  <li>تنفيذ خدمات النقل بين العملاء والسائقين</li>
                  <li>تحسين جودة الخدمة وتجربة المستخدم</li>
                  <li>التواصل مع المستخدمين بشأن الطلبات</li>
                  <li>الامتثال للأنظمة والقوانين</li>
                </ul>
              </Section>

              <Section title={isRtl ? '3. الأساس القانوني لمعالجة البيانات' : '3. Legal Basis'} isRtl={isRtl}>
                <p>يتم جمع ومعالجة البيانات بناءً على موافقة المستخدم، ولتنفيذ الخدمة المطلوبة، والامتثال للأنظمة المعمول بها في المملكة العربية السعودية.</p>
              </Section>

              <Section title={isRtl ? '4. مشاركة البيانات' : '4. Data Sharing'} isRtl={isRtl}>
                <p>قد تتم مشاركة البيانات في الحالات التالية:</p>
                <ul className="list-disc list-inside mt-4 space-y-2 text-stone-600 font-medium">
                  <li>مع السائقين لإتمام عملية النقل</li>
                  <li>مع الجهات الحكومية عند الطلب الرسمي</li>
                  <li>مع مزودي الخدمات التقنية (مثل خدمات الاستضافة)</li>
                </ul>
                <p className="mt-4 font-bold text-neutral-900 underline underline-offset-4 decoration-primary/30">نحن لا نقوم ببيع البيانات لأي طرف ثالث.</p>
              </Section>

              <Section title={isRtl ? '5. تخزين البيانات وحمايتها' : '5. Data Storage'} isRtl={isRtl}>
                <p>نقوم بتخزين البيانات في خوادم آمنة، ونستخدم تقنيات حماية متقدمة. قد يتم نقل البيانات ومعالجتها خارج المملكة عبر مزودي خدمات معتمدين مثل خدمات الحوسبة السحابية.</p>
              </Section>

              <Section title={isRtl ? '6. مدة الاحتفاظ بالبيانات' : '6. Data Retention'} isRtl={isRtl}>
                <p>نحتفظ بالبيانات طالما كان الحساب نشطًا، أو حسب ما تتطلبه الأنظمة، وبعدها يتم حذفها أو إخفاؤها.</p>
              </Section>

              <Section title={isRtl ? '7. حقوق المستخدم' : '7. User Rights'} isRtl={isRtl}>
                <p>يحق للمستخدم:</p>
                <ul className="list-disc list-inside mt-4 space-y-2 text-stone-600 font-medium">
                  <li>الوصول إلى بياناته</li>
                  <li>تعديل بياناته</li>
                  <li>طلب حذف الحساب</li>
                  <li>سحب الموافقة على معالجة البيانات</li>
                </ul>
              </Section>

              <Section title="8. ملفات تعريف الارتباط (Cookies)">
                <p>قد نستخدم تقنيات تتبع لتحسين الأداء وتجربة المستخدم.</p>
              </Section>

              <Section title="9. حماية المدفوعات">
                <p>لا نقوم بتخزين بيانات بطاقات الدفع، ويتم التعامل معها عبر مزودي دفع معتمدين.</p>
              </Section>

              <Section title="10. سياسة القصر">
                <p>الخدمة مخصصة للأشخاص بعمر 18 سنة فأكثر.</p>
              </Section>

              <Section title="11. التعديلات على السياسة">
                <p>يحق لنا تعديل سياسة الخصوصية في أي وقت، وسيتم إشعار المستخدمين عند التحديث.</p>
              </Section>

              <Section title={isRtl ? '12. الرسوم والعمولات' : '12. Fees and Commissions'} isRtl={isRtl}>
                <p>تعتمد منصة Miras نموذج تسعير شفاف يضمن استدامة الخدمة:</p>
                <ul className="list-disc list-inside mt-4 space-y-2 text-stone-600 font-medium">
                  <li><strong>رسوم الخدمة (العميل):</strong> تفرض المنصة رسوم خدمة بنسبة 5% من قيمة الرحلة الأساسية لتغطية التكاليف التقنية.</li>
                  <li><strong>عمولة المنصة (السائق):</strong> يتم استقطاع نسبة 15% من إجمالي قيمة الطلب كعمولة للمنصة.</li>
                  <li><strong>إجمالي الرسوم:</strong> يبلغ إجمالي رسوم المنصة 20% من قيمة الطلب، بالإضافة إلى ضريبة القيمة المضافة المقررة نظاماً.</li>
                </ul>
              </Section>

              <Section title="13. التواصل">
                <p>لأي استفسارات تتعلق بالخصوصية أو لممارسة حقوقكم، يمكنكم التواصل معنا عبر:</p>
                <div className="mt-4">
                  <a
                    href={supportMailto}
                    className="inline-flex items-center gap-3 p-4 bg-stone-50 rounded-2xl hover:bg-stone-100 transition-colors"
                    dir="ltr"
                  >
                    <Mail className="text-primary shrink-0" />
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400">{t('contact_email_label')}</p>
                      <span className="font-bold text-neutral-800">{SUPPORT_EMAIL}</span>
                    </div>
                  </a>
                </div>
              </Section>
            </>
          ) : null}
          {showTerms ? (
            <>
              <div className="space-y-6 border-b border-stone-100 pb-8">
                <p className="text-lg font-medium text-neutral-700">
                  تحكم هذه الشروط والأحكام علاقتكم بمنصة "Miras". يرجى قراءتها بعناية قبل البدء في استخدام الخدمات.
                </p>
              </div>

              <Section title={isRtl ? '1. طبيعة الخدمة (الوساطة التقنية)' : '1. Nature of Service'} isRtl={isRtl}>
                <p>{isRtl ? 'منصة "Miras" هي وسيط تقني يعمل على ربط العملاء بمزودي خدمات النقل (السائقين) المستقلين. بصفتنا مقدم منصة، نحن لا نملك الشاحنات ولا نقوم بعمليات النقل بأنفسنا.' : 'Miras is a technical intermediary that connects customers with independent transport service providers (drivers). As a platform provider, we do not own trucks or conduct transport operations ourselves.'}</p>
                <div className={`mt-4 p-4 bg-orange-50 border border-orange-100 rounded-2xl text-orange-800 text-sm font-medium ${isRtl ? '' : 'text-left border-l-4'}`}>
                   {t('mediation_service_note')}
                </div>
              </Section>

              <Section title="2. مسؤوليات الأطراف">
                <div className="grid gap-6 mt-4">
                  <div className="p-6 bg-stone-50 rounded-3xl border border-stone-100">
                    <h4 className="font-bold text-neutral-900 mb-2">مسؤولية السائق:</h4>
                    <p className="text-sm text-stone-600">السائق هو المسؤول الأول والوحيد عن سلامة الشحنة من لحظة الاستلام وحتى التسليم. يلتزم السائق بفحص الحمولة والتأكد من مطابقتها لأنظمة السلامة المرورية في المملكة.</p>
                  </div>
                  <div className="p-6 bg-stone-50 rounded-3xl border border-stone-100">
                    <h4 className="font-bold text-neutral-900 mb-2">مسؤولية العميل:</h4>
                    <p className="text-sm text-stone-600">يلتزم العميل بإدخال بيانات دقيقة وصحيحة تشمل (مواقع الاستلام والتسليم، نوع وحجم الحمولة، والوزن). المنصة غير مسؤولة عن أي تكاليف إضافية تنشأ نتيجة إدخال بيانات خاطئة.</p>
                  </div>
                </div>
              </Section>

              <Section title="3. سياسة التسعير والعمولات">
                <ul className="list-disc list-inside space-y-3 text-stone-600 font-medium">
                  <li><strong>التسعير:</strong> يتم احتساب السعر آلياً بناءً على نوع الخدمة، نوع المركبة، والمسافة الجغرافية بين نقطتي الاستلام والتسليم.</li>
                  <li><strong>رسوم الخدمة (العميل):</strong> يتم احتساب رسوم خدمة بنسبة 5% من قيمة الطلب لتغطية التكاليف التشغيلية والتقنية للمنصة.</li>
                  <li><strong>عمولة المنصة (السائق):</strong> يتم استقطاع نسبة 15% من إجمالي قيمة الطلب كعمولة للمنصة مقابل خدمات الوساطة والربط التقني.</li>
                  <li><strong>الضرائب:</strong> كافة الأسعار والعمولات تخضع لضريبة القيمة المضافة (VAT) المقررة في المملكة العربية السعودية بنسبة 15%.</li>
                </ul>
              </Section>

              <Section title="4. سياسة الإلغاء والاسترجاع">
                <div className="bg-white border border-stone-200 rounded-3xl overflow-hidden mt-4">
                   <div className="p-5 bg-stone-50 border-b border-stone-100 flex items-center gap-2 font-bold">
                     <RefreshCw size={18} className="text-primary" />
                     <span>نظام الإلغاء المرن</span>
                   </div>
                   <div className="p-6 space-y-4">
                     <p className="text-sm"><strong>قبل القبول:</strong> يمكن للعميل إلغاء الطلب مجاناً في أي وقت قبل قبول السائق للمهمة.</p>
                     <p className="text-sm"><strong>بعد القبول:</strong> في حال الإلغاء بعد قبول السائق وتحركه، قد يتم فرض رسوم إلغاء (رسوم تشغيلية) تخصم من العميل وتذهب للسائق كتعويض عن الوقت والوقود.</p>
                     <p className="text-sm"><strong>الاسترجاع المالي:</strong> في حال الدفع الإلكتروني، يتم استرداد المبالغ (بعد خصم رسوم الإلغاء إن وجدت) إلى حساب العميل خلال 3 إلى 7 أيام عمل كحد أقصى.</p>
                   </div>
                </div>
              </Section>

              <Section title="5. حدود المسؤولية والنظام القانوني">
                <p>التطبيق والمنصة غير مسؤولين عن أي تلفيات في الشحنات أو تأخير ناتج عن ظروف الطريق أو تقصير من السائق. في حال حدوث نزاع، تعمل المنصة كجهة تنسيق وتوفر البيانات اللازمة للجهات الرسمية.</p>
                <p className="mt-4">تخضع هذه الشروط والأحكام لأنظمة المملكة العربية السعودية، وأي نزاع ينشأ عنها يتم حله ودياً، وفي حال تعذر ذلك يختص القضاء السعودي في مدينة الرياض بالفصل فيه.</p>
              </Section>

              <Section title="6. نظام التقييم والحسابات">
                <p>تعتمد جودة المنصة على نظام التقييم المتبادل بين العميل والسائق. يحق للمنصة إيقاف أو حظر أي حساب (سواء عميل أو سائق) في حال الحصول على تقييمات منخفضة متكررة أو مخالفة أي من شروط الاستخدام أو الآداب العامة.</p>
              </Section>
            </>
          ) : null}
        </div>

        <footer className="text-center text-stone-400 text-sm font-medium pb-20">
           &copy; {new Date().getFullYear()} شركة Miras للخدمات اللوجستية. جميع الحقوق محفوظة لعملائنا وشركائنا.
        </footer>
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string, children: React.ReactNode, isRtl: boolean }> = ({ title, children, isRtl }) => (
  <section className="space-y-4">
    <div className={`flex items-center gap-4 ${isRtl ? '' : 'flex-row-reverse'}`}>
      <div className="w-1.5 h-8 bg-primary rounded-full"></div>
      <h2 className="text-2xl font-black text-neutral-900 tracking-tight">{title}</h2>
    </div>
    <div className={`text-stone-600 ${isRtl ? 'pr-5' : 'pl-5'} font-medium leading-relaxed`}>
      {children}
    </div>
  </section>
);

export default LegalPage;
