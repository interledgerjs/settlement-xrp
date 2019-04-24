import { Context } from "koa";
import { Redis } from "ioredis";
import { BalanceUpdate, Account } from "..";


export async function create(ctx: Context, redis: Redis, handleBalanceUpdate: any) {
    const update = ctx.request.body as BalanceUpdate

    handleBalanceUpdate(ctx.account as Account, update)

    ctx.response.status = 200
}