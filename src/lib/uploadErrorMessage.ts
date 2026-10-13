/** Map upload/save failures to a specific Arabic or English toast. */
export function describeUploadSaveError(error: unknown, isRtl: boolean): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  const code = String((error as { code?: string })?.code || '');
  const blob = `${code} ${raw}`.toLowerCase();

  if (
    blob.includes('photo_too_large') ||
    blob.includes('5 mb') ||
    blob.includes('3 mb') ||
    blob.includes('413') ||
    blob.includes('entity too large') ||
    blob.includes('payload too large')
  ) {
    return isRtl
      ? 'الصورة أكبر من الحد المسموح حتى بعد الضغط. اختر صورة أصغر.'
      : 'The image is still too large after compression. Choose a smaller photo.';
  }

  if (
    blob.includes('image_decode_failed') ||
    blob.includes('image_encode_failed') ||
    blob.includes('file_read_failed') ||
    blob.includes('photo_type_invalid') ||
    blob.includes('document_empty') ||
    blob.includes('only jpeg') ||
    blob.includes('not a valid jpeg') ||
    blob.includes('not a valid png') ||
    blob.includes('octet-stream')
  ) {
    return isRtl
      ? 'تعذر قراءة الصورة. استخدم JPEG أو PNG من الكاميرا أو المعرض.'
      : 'The image could not be read. Use a JPEG or PNG from the camera or gallery.';
  }

  if (
    blob.includes('permission-denied') ||
    blob.includes('insufficient permissions') ||
    blob.includes('storage rule')
  ) {
    const label = code || 'permission-denied';
    return isRtl
      ? `رفضت الصلاحيات العملية (${label}). أعد تسجيل الدخول ثم حاول مرة أخرى.`
      : `Permissions rejected the request (${label}). Sign in again and retry.`;
  }

  if (
    blob.includes('html instead of json') ||
    blob.includes('cloud run') ||
    blob.includes('non-json') ||
    blob.includes('invalid json')
  ) {
    return isRtl
      ? 'تعذر الوصول إلى خادم الرفع. تحقق من الاتصال، أو شغّل واجهة البرمجة محلياً بالأمر npm run dev.'
      : 'The upload server is unreachable. Check your connection, or run the API locally with npm run dev.';
  }

  if (
    blob.includes('failed to fetch') ||
    blob.includes('network') ||
    blob.includes('timeout') ||
    blob.includes('aborted') ||
    blob.includes('network_upload_failed')
  ) {
    return isRtl
      ? 'انقطع الاتصال أثناء الرفع. تحقق من الشبكة ثم أعد المحاولة.'
      : 'The connection dropped during upload. Check the network and try again.';
  }

  if (blob.includes('documents_incomplete') || blob.includes('missing:')) {
    const missing = raw.replace(/^.*missing:\s*/i, '');
    return isRtl
      ? `مستندات ناقصة قبل الحفظ: ${missing}`
      : `Missing required documents before save: ${missing}`;
  }

  if (
    blob.includes('not_authenticated') ||
    blob.includes('unauthenticated') ||
    blob.includes('401')
  ) {
    return isRtl
      ? 'انتهت الجلسة. سجّل الدخول مرة أخرى ثم أعد الحفظ.'
      : 'Your session expired. Sign in again, then save.';
  }

  if (blob.includes('upload_url_missing')) {
    return isRtl
      ? 'اكتمل الرفع لكن الرابط لم يُرجع. أعد المحاولة.'
      : 'The upload finished without a file URL. Try again.';
  }

  const detail = (raw || code || 'unknown').slice(0, 220);
  return isRtl ? `فشل الحفظ: ${detail}` : `Save failed: ${detail}`;
}
