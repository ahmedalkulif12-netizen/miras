import React, { useState } from 'react';
import { toast } from 'sonner';
import { submitServiceFeedback } from '@/lib/feedbackService';

interface ServiceFeedbackFormProps {
  isRtl: boolean;
  orderId?: string | null;
  onSubmitted?: () => void;
}

export const ServiceFeedbackForm: React.FC<ServiceFeedbackFormProps> = ({
  isRtl,
  orderId,
  onSubmitted,
}) => {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (rating < 1) {
      toast.error(isRtl ? 'اختر عدد النجوم أولاً' : 'Choose a star rating first');
      return;
    }
    setSending(true);
    try {
      await submitServiceFeedback({ rating, comment, orderId });
      toast.success(isRtl ? 'تم حفظ تقييمك' : 'Your feedback was saved');
      setRating(0);
      setComment('');
      onSubmitted?.();
    } catch (error) {
      console.error('[feedback] submit failed:', error);
      toast.error(isRtl ? 'تعذر حفظ التقييم' : 'Could not save feedback');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => setRating(star)}
            className={`min-w-14 min-h-14 text-4xl leading-none rounded-2xl border-2 ${
              rating >= star ? 'border-black bg-[#FFCC00] text-black' : 'border-stone-200 bg-white text-stone-300'
            }`}
            aria-label={`${star}`}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        maxLength={1000}
        placeholder={isRtl ? 'اكتب ملاحظتك عن الخدمة' : 'Write a comment about the service'}
        className={`w-full min-h-32 p-5 rounded-3xl bg-stone-50 border-2 border-black/10 text-base font-medium outline-none focus:border-black ${isRtl ? 'text-right' : 'text-left'}`}
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={sending || rating < 1}
        className="w-full min-h-16 rounded-3xl bg-black text-[#FFCC00] font-black text-lg disabled:opacity-40"
      >
        {sending ? (isRtl ? 'جاري الحفظ...' : 'Saving...') : isRtl ? 'إرسال التقييم' : 'Send feedback'}
      </button>
    </div>
  );
};
