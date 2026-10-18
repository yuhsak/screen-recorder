import { message, type Message } from '../i18n/messages'

export class RecordingError extends Error {
  constructor(readonly detail: Message) {
    super(detail.key)
  }
}

export function describeError(error: unknown): Message {
  if (error instanceof RecordingError) return error.detail
  // DOMException and errors from another realm need not inherit our Error class.
  if (typeof error === 'object' && error !== null && 'name' in error) {
    switch (error.name) {
      case 'AbortError':
        return message('errorCanceled')
      case 'NotAllowedError':
        return message('errorPermission')
      case 'NotFoundError':
        return message('errorNotFound')
      case 'NotReadableError':
        return message('errorNotReadable')
      case 'QuotaExceededError':
        return message('errorDiskFull')
      case 'SecurityError':
        return message('errorSecurity')
    }
  }
  return message('errorUnknown')
}
