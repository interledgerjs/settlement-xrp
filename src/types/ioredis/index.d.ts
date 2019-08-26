import * as IORedis from 'ioredis'

declare module 'ioredis' {
  interface Redis {
    deleteAccount(accountId: string): Promise<number>

    queueSettlement(
      accountId: string,
      idempotencyKey: string,
      amount: string,
      lastRequestTimestamp: number
    ): Promise<string>
  }
}
