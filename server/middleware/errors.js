import { logger } from '../utilities/logger.js';
import { ValidationError } from './validation.js';
import { TextTooLargeError, RevisionConflictError } from '../services/clipboard-service.js';
import {
  UnsupportedImageTypeError,
  ImageTooLargeError,
  ImageLimitReachedError,
  ImageNotFoundError,
} from '../services/image-service.js';
import { FileTooLargeError, FileLimitReachedError, FileNotFoundError } from '../services/file-service.js';

const ERROR_STATUS_MAP = new Map([
  [ValidationError, 400],
  [TextTooLargeError, 413],
  [RevisionConflictError, 409],
  [UnsupportedImageTypeError, 415],
  [ImageTooLargeError, 413],
  [ImageLimitReachedError, 409],
  [ImageNotFoundError, 404],
  [FileTooLargeError, 413],
  [FileLimitReachedError, 409],
  [FileNotFoundError, 404],
]);

function respond(res, status, code, message, extra) {
  res.status(status).json({ error: { code, message, ...extra } });
}

export function notFoundHandler(_req, res) {
  respond(res, 404, 'NOT_FOUND', 'The requested resource was not found.');
}

export function errorHandler(error, req, res, _next) {
  for (const [ErrorClass, status] of ERROR_STATUS_MAP) {
    if (error instanceof ErrorClass) {
      if (error instanceof RevisionConflictError) {
        return respond(res, status, 'REVISION_CONFLICT', error.message, { current: error.current });
      }
      if (error instanceof TextTooLargeError) {
        return respond(res, status, 'TEXT_TOO_LARGE', error.message, { characterCount: error.characterCount });
      }
      if (error instanceof ImageTooLargeError) {
        return respond(res, status, 'IMAGE_TOO_LARGE', error.message);
      }
      if (error instanceof UnsupportedImageTypeError) {
        return respond(res, status, 'UNSUPPORTED_IMAGE_TYPE', error.message);
      }
      if (error instanceof FileTooLargeError) {
        return respond(res, status, 'FILE_TOO_LARGE', error.message);
      }
      if (error instanceof FileLimitReachedError) {
        return respond(res, status, 'FILE_LIMIT_REACHED', error.message);
      }
      if (error instanceof FileNotFoundError) {
        return respond(res, status, 'FILE_NOT_FOUND', error.message);
      }
      return respond(res, status, error.name.toUpperCase(), error.message);
    }
  }

  if (error?.type === 'entity.too.large' || error?.status === 413) {
    return respond(res, 413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
  }

  if (error?.code === 'LIMIT_FILE_SIZE') {
    const isFileUpload = req.path === '/files' || error.field === 'file';
    return respond(
      res,
      413,
      isFileUpload ? 'FILE_TOO_LARGE' : 'IMAGE_TOO_LARGE',
      `${isFileUpload ? 'File' : 'Image'} exceeds the configured size limit.`
    );
  }

  // e.g. an upload cancelled from the progress bar: the client is gone, so nothing to answer.
  if (req.socket?.destroyed) {
    logger.info('Request ended by the client before completion', { path: req.path, method: req.method });
    return;
  }

  logger.error('Unhandled server error', {
    path: req.path,
    method: req.method,
    message: error?.message,
  });

  respond(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred. Please try again.');
}
