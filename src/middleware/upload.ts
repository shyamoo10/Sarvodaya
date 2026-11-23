import multer from 'multer';
import type { RequestHandler } from 'express';
import { ApiError } from '../lib/http';
import { ErrorCode } from '../config/error-codes';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

/**
 * Accepts one .xlsx file in the "file" field. Files stay in memory: the workbook
 * is parsed and thrown away, nothing is written to disk.
 */
export const importFileUpload: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (error: unknown) => {
    if (error) {
      const message =
        error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
          ? 'The file is larger than 5 MB'
          : 'Upload a single .xlsx file in the "file" field';
      next(new ApiError(400, ErrorCode.INVALID_IMPORT_FILE, message));
      return;
    }
    next();
  });
};
