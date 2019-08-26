import BigNumber from 'bignumber.js'
import Redis from 'ioredis'
import { SettlementStore } from '.'
import { DatabaseSafe } from '../utils'

/**
 * Redis Key Namespace
 * =========================================
 *
 * accounts
 * - Set of identifiers for all active accounts
 *
 * accounts:[accountId]:settlement-requests:[idempotencyKey]
 * - Hash of each request from connector to send an outgoing settlement
 * - `amount` -- floating point string of amount queued for settlement;
 * - `last_request_timestamp` -- UNIX timestamp in seconds when most recent request
 *   was received with the same idempotency key
 *
 * accounts:[accountId]:queued-settlements
 * - List of floating point strings of outgoing settlements to be performed (queued and failed)
 *
 * accounts:[accountId]:uncredited-settlements
 * - List of floating point strings of incoming settlements yet to be credited by connector
 */

export interface RedisOpts {
  client?: Redis.Redis
  host?: string
  port?: number
  uri?: string
}

export const connectRedis = async ({ client, uri, host, port }: RedisOpts = {}): Promise<
  SettlementStore
> => {
  const redis = client || (host || port ? new Redis({ port, host }) : new Redis(uri))

  redis.defineCommand('deleteAccount', {
    numberOfKeys: 0,
    lua: `redis.call('SREM', 'accounts', ARGV[1])
          local pattern = 'accounts:' .. ARGV[1] .. '*'
          return redis.call('DEL', table.unpack(redis.call('KEYS', pattern)))`
  })

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
    async createAccount(accountId: DatabaseSafe) {
      const alreadyExists = (await redis.sadd('accounts', accountId)) === 0 // Returns number of elements added to set
      if (alreadyExists) {
        return Promise.reject(new Error('Account already exists')) // TODO however this is being called, it's unhandled
      }
    },

    async isExistingAccount(accountId: DatabaseSafe) {
      return (await redis.sismember('accounts', accountId)) === 1
    },

    // TODO I might need to move the "DatabaseSafe" type to SettlementStore in order for it to be enforced...
    // TODO Rename to SafeString or SafeKey ?

    async deleteAccount(accountId: DatabaseSafe) {
      await redis.deleteAccount(accountId)
    },

    // TODO This needs to ensure amount isn't NaN... sigh
    async queueSettlement(accountId: DatabaseSafe, idempotencyKey: DatabaseSafe, amount) {
      const res = await redis.queueSettlement(
        accountId,
        idempotencyKey,
        amount.toString(),
        Date.now()
      )

      return new BigNumber(res)
    },

    async loadAmountToSettle(accountId: DatabaseSafe) {
      return redis
        .multi()
        .lrange(`accounts:${accountId}:queued-settlements`, 0, -1)
        .del(`accounts:${accountId}:queued-settlements`)
        .exec()
        .then(async ([[err, res]]) => BigNumber.sum(...res))
    },

    // TODO Is this saving NaN amounts back to the DB? yikes
    async saveAmountToSettle(accountId: DatabaseSafe, amount) {
      await redis.lpush(`accounts:${accountId}:queued-settlements`, amount.toString())
    },

    async loadAmountToCredit(accountId: DatabaseSafe) {
      return redis
        .multi()
        .lrange(`accounts:${accountId}:uncredited-settlements`, 0, -1)
        .del(`accounts:${accountId}:uncredited-settlements`)
        .exec()
        .then(([[err, res]]) => BigNumber.sum(...res))
    },

    async saveAmountToCredit(accountId: DatabaseSafe, amount) {
      await redis.lpush(`accounts:${accountId}:uncredited-settlements`, amount.toString())
    },

    async disconnect() {
      redis.disconnect()
    }
  }

  return self
}
