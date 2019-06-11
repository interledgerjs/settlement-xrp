import { Context } from 'koa'
import { Redis } from 'ioredis'
import { Account } from '../models/account'
let getRawBody = require('raw-body')

export interface Message {
  type: string,
  data: any
}

export interface ConfigMessage {
  xrpAddress: string
}

export async function create (ctx: Context) {
  let body = ctx.request.body
  const buffer = await getRawBody(ctx.req)
    .then((buffer: Buffer) => {
        return buffer
    }).catch((error: any) => {
      console.log('Error parsing buffer', error)
    })
  const message: Message = JSON.parse(buffer.toString())
  const reply = await handleMessage(message, ctx)

  ctx.body = reply
  ctx.status = 200
}

async function handleMessage (message: Message, ctx: Context) {
  const accountID: string = ctx.params.id
  switch (message.type) {
    case('config'):
      const configMessage: ConfigMessage = {
        xrpAddress: message.data.xrpAddress
      }
      const account: Account = {
        id: accountID,
        xrpAddress: configMessage.xrpAddress
      }
      await ctx.redis.set(`${ctx.settlement_prefix}:accounts:${accountID}`, JSON.stringify(account))
      await ctx.redis.set(`${ctx.settlement_prefix}:xrpAddress:${configMessage.xrpAddress}:accountId`, account.id)
      return Buffer.from('')
    default:
      throw new Error('Unknown message type')
  }
}
