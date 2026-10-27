import multer from 'multer';

// Memory storage — the file never touches disk. Fine for now given
// imports are a few MB at most; revisit if very large files become common.
// The file type is checked by the controller, which can tell the user
// exactly what is wrong (e.g. a legacy .ppt or .doc).
export const MAX_UPLOAD_MB = 25;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

// Upload problems are the client's fault, so answer them with a 4xx
// here instead of letting them fall through to the generic 500 handler.
// "file" is the field name; "pdf" is still accepted for older clients.
export function uploadImportFile(req, res, next) {
  upload.fields([{ name: 'file', maxCount: 1 }, { name: 'pdf', maxCount: 1 }])(req, res, (err) => {
    if (!err) {
      req.file = req.files?.file?.[0] || req.files?.pdf?.[0];
      return next();
    }
    if (!(err instanceof multer.MulterError)) return next(err);
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File must be ${MAX_UPLOAD_MB}MB or smaller` });
    }
    return res.status(400).json({ error: 'Upload one .docx, .pptx or .pdf file in the "file" field' });
  });
}
