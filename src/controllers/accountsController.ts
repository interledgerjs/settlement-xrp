import { Context } from 'koa'
import { Redis } from 'ioredis'
import { Account } from '../models/account'

export async function create (ctx: Context) {
  let body = ctx.request.body
  let account: Account = {
    id: body.id
  }

    // Check if account exists first
  const existingAccount = await ctx.redis.get(`${ctx.settlement_prefix}:accounts:${account.id}`)
  if (!existingAccount) {
    await ctx.redis.set(`${ctx.settlement_prefix}:accounts:${account.id}`, JSON.stringify(account))
  }

  ctx.status = 200
}

/** Get account by Id */
export async function show (ctx: Context) {
  const account = await ctx.redis.get(`${ctx.settlement_prefix}:accounts:${ctx.params.id}`)
  if (account) {
    ctx.body = JSON.parse(account)
    ctx.status = 200
  } else {
    ctx.status = 404
  }
}

/** Delete account by Id */
export async function destroy (ctx: Context) {
  await ctx.redis.del(`${ctx.settlement_prefix}:accounts:${ctx.params.id}`)
    // TODO Delete key from redis for ledger address

  ctx.status = 200
}
