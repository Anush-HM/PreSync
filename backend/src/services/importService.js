import { extractSlidesFromPdf } from './pdfIngestService.js';
import { parseDocx } from './docxIngestService.js';
import { analyzePptx } from './pptxAnalysisService.js';
import { analyzeDocx, analyzeSlides } from './documentAnalysis.js';

const PDF_MIME = 'application/pdf';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const LEGACY_PPT_MIME = 'application/vnd.ms-powerpoint';
const LEGACY_DOC_MIME = 'application/msword';

export const FORMAT_LABELS = { pdf: 'PDF', pptx: 'PowerPoint file', docx: 'Word document' };

// Browsers often send Office files as application/octet-stream, so the
// extension counts as much as the declared type.
export function detectFormat(file) {
  const ext = (file.originalname.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  if (ext === 'pdf' || file.mimetype === PDF_MIME) return 'pdf';
  if (ext === 'pptx' || file.mimetype === PPTX_MIME) return 'pptx';
  if (ext === 'docx' || file.mimetype === DOCX_MIME) return 'docx';
  if (ext === 'ppt' || file.mimetype === LEGACY_PPT_MIME) return 'ppt';
  if (ext === 'doc' || file.mimetype === LEGACY_DOC_MIME) return 'doc';
  return null;
}

// Client-facing explanation for formats we recognise but can't read,
// or null when the format is supported.
export function unsupportedFormatError(format) {
  if (format === 'ppt') {
    return { status: 415, error: 'Legacy .ppt files are not supported. Open it in PowerPoint, Keynote or Google Slides and save it as .pptx, then import that.' };
  }
  if (format === 'doc') {
    return { status: 415, error: 'Legacy .doc files are not supported. Open it in Word, Pages or Google Docs and save it as .docx, then import that.' };
  }
  if (!format) {
    return { status: 400, error: 'Only Word (.docx), PowerPoint (.pptx) and PDF (.pdf) files can be imported' };
  }
  return null;
}

export class ImportParseError extends Error {}

// Parses and analyses an uploaded file. Throws ImportParseError with a
// user-facing message when the file can't be read.
// Returns { format, title, analysis, outline, blocks, images, slides }.
export async function extractImport(file, format) {
  const fileName = file.originalname;
  try {
    if (format === 'docx') {
      const parsed = await parseDocx(file.buffer);
      const { analysis, outline } = analyzeDocx(parsed, fileName);
      return {
        format,
        title: analysis.title,
        analysis,
        outline,
        blocks: parsed.blocks,
        images: parsed.images,
        page: parsed.meta.page || null,
        header: parsed.header || [],
        footer: parsed.footer || [],
        slides: []
      };
    }
    if (format === 'pptx') {
      const { slides, analysis, outline, canvasWidth, canvasHeight } = await analyzePptx(file.buffer, fileName);
      return { format, title: analysis.title, analysis, outline, blocks: [], images: [], slides, canvasWidth: canvasWidth || 960, canvasHeight: canvasHeight || 540 };
    }
    const report = {};
    const { slides, canvasWidth, canvasHeight } = await extractSlidesFromPdf(file.buffer, report);
    if (slides.length === 0) throw new Error('The PDF has no pages');
    const { analysis, outline } = analyzeSlides(slides, { kind: 'pdf', fileName, packageWarnings: report.warnings });
    return { format, title: analysis.title, analysis, outline, blocks: [], images: [], slides, canvasWidth: canvasWidth || 960, canvasHeight: canvasHeight || 540 };
  } catch (err) {
    throw new ImportParseError(`Could not read this ${FORMAT_LABELS[format]}: ${err.message}`);
  }
}
