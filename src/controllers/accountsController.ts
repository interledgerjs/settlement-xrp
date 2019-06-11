import { Context } from "koa";
import { Redis } from "ioredis";
import { Account } from "../models/account";


/** Create account if it does not exists or update if it does exist*/
export async function create(ctx: Context, redis: Redis) {
    let body = ctx.request.body
    let account: Account = {
        id: body.id
    }

    //Check if account exists first
    const existingAccount = await ctx.redis.get(`${ctx.settlement_prefix}:accounts:${account.id}`)
    if(!existingAccount) {
        await ctx.redis.set(`${ctx.settlement_prefix}:accounts:${account.id}`, JSON.stringify(account))
    }
    ctx.configAccount(account.id)

    ctx.status = 200
}

/** Get account by Id */
export async function show(ctx: Context, redis: Redis) {
    const account =  await redis.get(`${ctx.settlement_prefix}:accounts:${ctx.params.id}`)

    if(account) {
        ctx.body = JSON.parse(account)
        ctx.status = 200
    } else {
        ctx.status = 404
    }
}

/** Delete account by Id */
export async function destroy(ctx: Context, redis: Redis) {
    await redis.del(`${ctx.settlement_prefix}:accounts:${ctx.params.id}`)
    //TODO Delete key from redis for ledger address

    ctx.status = 200
}