import { Context } from "koa";
import { Redis } from "ioredis";
import { ThresholdAlert, Account } from "..";


export async function create(ctx: Context, redis: Redis, handleThresholdAlert: any) {
    const alert = ctx.request.body as ThresholdAlert

    handleThresholdAlert(ctx.account as Account, alert)

    ctx.response.status = 200
}