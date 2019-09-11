import BigNumber from 'bignumber.js'
import Redis from 'ioredis'
import { SettlementStore } from '.'

/**
 * Redis Key Namespace
 * =========================================
 *
 * accounts
 * - Set of identifiers for all active accounts
 *
 * accounts:[accountId]:settlement-requests:[idempotencyKey]
 * - Hash of each request from connector to send an outgoing settlement
 * - `amount` -- arbitrary precision string of amount queued for settlement
 * - `last_request_timestamp` -- UNIX timestamp in seconds when most recent request
 *    was received with the same idempotency key
 *
 * accounts:[accountId]:queued-settlements
 * - List of arbitrary precision strings of outgoing settlements to be performed (queued and failed)
 *
 * accounts:[accountId]:uncredited-settlements
 * - List of arbitrary precision strings of incoming settlements yet to be credited by connector
 */

/** Configuration options for the connection to the Redis database */
export interface RedisOpts extends Redis.RedisOptions {
  client?: Redis.Redis
  uri?: string
}

type RedisListTxResponse = [[null, string[]], [null, null]]

// TODO Should this define a more specific "RedisSettlementStore" type?

export const connectRedis = async ({ client, uri, ...opts }: RedisOpts = {}): Promise<
  SettlementStore
> => {
  /**
   * After a close reading of IORedis, options set by left params supercede
   * options set by right params (due to the use Lodash _.defaults):
   * https://github.com/luin/ioredis/blob/1baff479b2abfb1cba73e84ce514b3330b2b0993/lib/redis/index.ts#L193
   */
  const redis = client ? client : new Redis(uri, opts)

  redis.defineCommand('deleteAccount', {
    numberOfKeys: 0,
    lua: `redis.call('SREM', 'accounts', ARGV[1])
          local pattern = 'accounts:' .. ARGV[1] .. '*'
          return redis.call('DEL', table.unpack(redis.call('KEYS', pattern)))`
  }) // TODO Update this: `KEYS` is not recommended in production code: https://redis.io/commands/keys

  redis.defineCommand('queueSettlement', {
    numberOfKeys: 0,
    lua: `-- Check for an existing idempotency key for this settlement
          local settlement_request_key = 'accounts:' .. ARGV[1] .. ':settlement-requests:' .. ARGV[2]
          local amount = redis.call('HGET', settlement_request_key, 'amount')

          -- If no idempotency key exists, cache idempotency key and enqueue the settlement
          if not amount then
            redis.call('HSET', settlement_request_key, 'amount', ARGV[3])
            amount = ARGV[3]

            local queued_settlements_key = 'accounts:' .. ARGV[1] .. ':queued-settlements'
            redis.call('LPUSH', queued_settlements_key, ARGV[3])
          end

          -- Set the timestamp of the most recent request for this idempotency key
          redis.call('HSET', settlement_request_key, 'last_request_timestamp', ARGV[4])

          -- Return amount queued for settlement (from preexisting idempotency key or this transaction)
          return amount`
  })

  const self: SettlementStore = {
    async createAccount(accountId) {
      return (await redis.sadd('accounts', accountId)) === 0 // SADD returns number of elements added to set
    },

    async isExistingAccount(accountId) {
      return (await redis.sismember('accounts', accountId)) === 1
    },

    async deleteAccount(accountId) {
      await redis.deleteAccount(accountId)
    },

    async queueSettlement(accountId, idempotencyKey, amount) {
      return new BigNumber(
        await redis.queueSettlement(accountId, idempotencyKey, amount.toString(), Date.now())
      )
    },

    async loadAmountToSettle(accountId) {
      return redis
        .multi()
        .lrange(`accounts:${accountId}:queued-settlements`, 0, -1)
        .del(`accounts:${accountId}:queued-settlements`)
        .exec()
        .then(async ([[err, res]]: RedisListTxResponse) => BigNumber.sum(0, ...res))
    },

    async saveAmountToSettle(accountId, amount) {
      await redis.lpush(`accounts:${accountId}:queued-settlements`, amount.toString())
    },

    async loadAmountToCredit(accountId) {
      return redis
        .multi()
        .lrange(`accounts:${accountId}:uncredited-settlements`, 0, -1)
        .del(`accounts:${accountId}:uncredited-settlements`)
        .exec()
        .then(([[, res]]: RedisListTxResponse) => BigNumber.sum(0, ...res))
    },

    async saveAmountToCredit(accountId, amount) {
      await redis.lpush(`accounts:${accountId}:uncredited-settlements`, amount.toString())
    },

    async disconnect() {
      redis.disconnect()
    }
  }

  return self
}
