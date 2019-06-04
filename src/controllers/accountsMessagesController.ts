import { Context } from "koa"
import { Redis } from "ioredis"
import { config } from "shelljs";
var getRawBody = require('raw-body')

export interface Message {
    type: string,
    data: any
}

export interface ConfigMessage {
    xrpAddress: string
}

/** Create account if it does not exists or update if it does exist*/
export async function create(ctx: Context) {
    let body = ctx.request.body
    const buffer = await getRawBody(ctx.req)
    .then((buffer: Buffer) => {
        return buffer
    }).catch((error: any) => {
        console.log('Error parsing buffer', error)
    })
    const message: Message = JSON.parse(buffer.toString())
    await handleMessage(message, ctx)

    
    ctx.status = 200
}

async function handleMessage(message: Message, redis: Redis) {
    switch (message.type) {
        case('config'):
            const configMessage: ConfigMessage = {
                xrpAddress: message.data.xrpAddress
            }
            await ctx.redis.set(`${ctx.settlement_prefix}:accounts:${body.id}`, JSON.stringify(body))
            return
        default:
            throw new Error("Unknown message type")
    }
}