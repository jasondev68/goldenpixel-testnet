import { translate, type Msg } from '@/i18n'

/** Error whose message is already translated for toasts, and whose `msg` can be re-rendered when the language changes. */
export class ApiError extends Error {
  msg: Msg
  code?: string
  constructor(msg: Msg, code?: string) {
    super(translate(msg.key, msg.vars))
    this.msg = msg
    this.code = code
  }
}
