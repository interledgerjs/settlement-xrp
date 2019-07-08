import { Context } from 'koa'
let getRawBody = require('raw-body')
import { randomBytes } from 'crypto'

export interface Message {
  type: string,
  data: any
}

export interface PaymentDetailsMessage {
  xrpAddress: string,
  destinationTag: number
}

export async function create (ctx: Context) {
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
    case('paymentDetails'):
      const destinationTag = await ctx.redis.get(`${ctx.settlement_prefix}:accountId:${accountID}:destinationTag`).then(async (tag: string) => {
        if (tag) {
          return tag
        } else {
          const destinationTag = randomBytes(4).readUInt32BE(0)
          await ctx.redis.set(`${ctx.settlement_prefix}:destinationTag:${destinationTag}:accountId`, accountID)
          await ctx.redis.set(`${ctx.settlement_prefix}:accountId:${accountID}:destinationTag`, destinationTag)
          return destinationTag
        }
      })

      const paymentDetails: PaymentDetailsMessage = {
        xrpAddress: ctx.xrpAddress,
        destinationTag: Number(destinationTag)
      }
      return Buffer.from(JSON.stringify(paymentDetails))
    default:
      throw new Error('Unknown message type')
  }
}
