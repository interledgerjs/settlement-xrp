import { Context } from 'koa'
import { normalizeAsset } from '../utils/normalizeAsset'

export async function create (ctx: Context) {
  const accountJson = await ctx.redis.get(`${ctx.settlement_prefix}:accounts:${ctx.params.id}`)
  const account = JSON.parse(accountJson)

  const body = ctx.request.body
  const clearingScale = body.scale
  const amount = normalizeAsset(clearingScale, 6, BigInt(body.amount))

  await ctx.settleAccount(account, amount.toString())

  let settlementComittment = {
    scale: 6,
    amount: amount.toString()
  }

  ctx.body = settlementComittment
  ctx.status = 201
}
