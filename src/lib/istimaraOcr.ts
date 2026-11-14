import { parseIstimaraText, type IstimaraExtract } from '@/domain/partnerTracks';

/**
 * Reads a photographed Istimara. The caller always keeps manual fields,
 * because Arabic card OCR can miss a digit.
 */
export async function readIstimaraImage(file: File): Promise<IstimaraExtract> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('ara+eng');
  try {
    const result = await worker.recognize(file);
    return parseIstimaraText(result.data.text || '');
  } finally {
    await worker.terminate();
  }
}
