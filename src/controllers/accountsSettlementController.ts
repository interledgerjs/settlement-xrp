import { Context } from "koa";
import { Redis } from "ioredis";


/** Create account if it does not exists or update if it does exist*/
export async function create(ctx: Context, redis: Redis) {
    // let body = ctx.request.body

    // await ctx.redis.set(`${ctx.settlement_prefix}:accounts:${body.id}`, JSON.stringify(body))

    ctx.status = 200
}