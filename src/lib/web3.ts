import { buildTxExplorerUrl, getChain } from '@/onchain-facts'
import type { Msg } from '@/i18n'

export const shortAddress = (a?: string) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '')

export const txUrl = (chainId: number, hash: string) => (getChain(chainId) ? buildTxExplorerUrl(chainId, hash) : undefined)

type ErrLike = { code?: number; name?: string; shortMessage?: string; message?: string; cause?: unknown }

function flatten(e: unknown): string {
  const err = e as ErrLike
  return `${err?.name ?? ''} ${err?.shortMessage ?? ''} ${err?.message ?? ''}`.toLowerCase()
}

export function isUserRejection(e: unknown): boolean {
  let cur: unknown = e
  for (let i = 0; i < 5 && cur; i++) {
    const err = cur as ErrLike
    if (err.code === 4001 || /user rejected|user denied|rejected the request|request rejected/i.test(flatten(cur))) return true
    cur = err.cause
  }
  return false
}

export type ParsedError = { rejected: boolean; msg: Msg }

/**
 * Turns wallet, RPC and SDK errors into a translatable message. A rejection is not an error.
 * The result is a `Msg` (key + vars), so it can sit in state and still render in the active language.
 */
export function parseOnchainError(e: unknown): ParsedError {
  if (isUserRejection(e)) return { rejected: true, msg: { key: 'err.cancelled' } }
  const text = flatten(e)
  const m = (key: Msg['key']): ParsedError => ({ rejected: false, msg: { key } })
  if (/insufficient funds|exceeds balance|insufficient balance|transfer amount exceeds/.test(text)) return m('err.insufficient')
  if (/slippage|price impact|min.*(return|output|amount)|stop.?limit/.test(text)) return m('err.slippage')
  if (/chain.*(mismatch|not configured)|switch.*chain|wrong network|unrecognized chain|4902/.test(text)) return m('err.wrongNetwork')
  if (/reverted|execution reverted/.test(text)) return m('err.reverted')
  if (/timeout|timed out|network|fetch failed|http request failed|rpc|failed to fetch/.test(text)) return m('err.network')
  // Provider and SDK detail is technical and stays as the provider wrote it, under a translated lead-in.
  const detail = (e as ErrLike)?.shortMessage ?? (e as ErrLike)?.message
  return detail ? { rejected: false, msg: { key: 'err.withDetail', vars: { detail: detail.slice(0, 160) } } } : m('err.generic')
}
