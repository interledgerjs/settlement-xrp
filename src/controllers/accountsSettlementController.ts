import { Context } from "koa";
import { Redis } from "ioredis";
import { normalizeAsset } from "../utils/normalizeAsset";


/** Create account if it does not exists or update if it does exist*/
export async function create(ctx: Context) {
    const accountJson = await ctx.redis.get(`${ctx.settlement_prefix}:accounts:${ctx.params.id}`)
    const account = JSON.parse(accountJson)

    const body = ctx.request.body
    const amount = normalizeAsset(body.scale, 6, BigInt(body.amount))
    await ctx.settleAccount(account, amount.toString())

    ctx.status = 200
}