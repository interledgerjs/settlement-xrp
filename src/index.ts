import axios, { AxiosResponse } from 'axios'
import BigNumber from 'bignumber.js'
import { randomBytes } from 'crypto'
import debug from 'debug'
import { RedisStoreServices, RedisSettlementEngine, DecoratedPipeline } from 'ilp-settlement-core'
import { deriveAddress, deriveKeypair } from 'ripple-keypairs'
import { RippleAPI, FormattedTransactionType, FormattedPaymentTransaction } from 'ripple-lib'
import { isValidAmount } from 'ilp-settlement-core/dist/redis'

const log = debug('settlement-xrp')

/**
 * Redis Key Namespace
 * =========================================
 *
 * pending-xrp-transactions
 * - Sorted set of a pending outgoing transactions, sorted by LastLedgerVersion,
 *   mapped to transaction hash
 *
 * pending-xrp-transaction:[tx-hash]
 * - Hash of outgoing transaction metadata
 *   `amount`     -- Arbitrary precision string of amount of the payment
 *   `tx_hash`    -- Transaction hash uniquely identifiying this transaction
 *   `account_id` -- Recipient of this transaction in connector account (not XRPL address)
 *
 * incoming-xrp-payment-tags:[destination-tag]
 * - TODO
 *
 * latest-checked-ledger-version
 * - Latest ledger version checked for incoming XRP payemnts. Payments from all ledger versions
 *   including and prior to this were already credited
 */

export const TESTNET_RIPPLED_URI = 'wss://s.altnet.rippletest.net:51233'

export interface XrpEngineOpts {
  xrpSecret?: string
  rippledUri?: string
  rippleClient?: RippleAPI
}

export interface XrpSettlementEngine extends RedisSettlementEngine {
  sendPayment(accountId: string): Promise<void>
  startFinalizeTransactionLoop(): () => Promise<void>
  updatePendingTransactions(): Promise<void>
  finalizeTransaction(txHash: string, rollback: boolean): Promise<void>

  startCreditPaymentLoop(): () => Promise<void>
  creditIncomingPayments(): Promise<void>

  disconnect(): Promise<void>
}

export const createEngine = (opts: XrpEngineOpts = {}) => async ({
  redis,
  sendMessage,
  creditSettlement,
  prepareSettlement,
  refundSettlement
}: RedisStoreServices) => {
  /** XRP secret for sending and signing outgoing payments */
  const xrpSecret = opts.xrpSecret || (await generateTestnetAccount())

  /** XRP address to tell peer to send payments to */
  let xrpAddress: string
  try {
    xrpAddress = secretToAddress(xrpSecret)
  } catch (err) {
    throw new Error('Invalid XRP secret')
  }

  const rippleClient: RippleAPI =
    opts.rippleClient ||
    new RippleAPI({
      server: opts.rippledUri || TESTNET_RIPPLED_URI
    })

  // @ts-ignore
  // Connection issues require increasing timeout, but cannot pass as config option:
  // https://github.com/ripple/ripple-lib/issues/1196
  rippleClient.connection._config.connectionTimeout = 10000

  /** Queue of accounts corresponding to pending outgoing settlements */
  let queue = Promise.resolve()

  const self: XrpSettlementEngine = {
    async handleMessage(accountId, message) {
      if (message.type && message.type === 'paymentDetails') {
        const destinationTag = randomBytes(4).readUInt32BE(0)
        const tagKey = `incoming-xrp-payment-tags:${destinationTag}`

        const alreadyExists = (await redis.exists(tagKey)) === 1
        if (alreadyExists) {
          // TODO Should this try again instead?
          throw new Error('Failed to generate new destination tag')
        }

        // Expire after 5 minutes
        await redis.setex(tagKey, 5 * 60000, accountId)

        return {
          destinationTag,
          xrpAddress
        }
      } else {
        throw new Error('Unknown message type')
      }
    },

    async settle(accountId) {
      // TODO Will the queuing work correctly if this returns right away after the payment is created?

      // Queue the payment to the next account so only a single XRP transaction is performed at a time
      queue = queue.then(() =>
        self.sendPayment(accountId).catch(err => log('Failed to settle:', err))
      )
    },

    async sendPayment(accountId: string) {
      // Create lease for 1 second to prepare settlement
      const [queuedAmount, commitTx] = await prepareSettlement(accountId, 1000)

      // Limit precision to drops (remainder will be refunded when lease expires)
      // Even though settlement-core checks against this, if connector scale > 6, it could still round down to 0
      const amount = queuedAmount.decimalPlaces(6, BigNumber.ROUND_DOWN)
      if (amount.isZero()) {
        return
      }

      let details = `account=${accountId} xrp=${amount}`
      log(`Starting settlement: ${details}`)

      const paymentDetails = await sendMessage(accountId, {
        type: 'paymentDetails'
      })
        .then(response =>
          isPaymentDetails(response)
            ? response
            : log(`Failed to settle: Received invalid payment details: ${details}`)
        )
        .catch(err => log(`Failed to settle: Error fetching payment details: ${details}`, err))
      if (!paymentDetails) {
        return
      }

      const transaction = await rippleClient.preparePayment(xrpAddress, {
        source: {
          address: xrpAddress,
          amount: {
            value: amount.toString(),
            currency: 'XRP'
          }
        },
        destination: {
          address: paymentDetails.xrpAddress,
          tag: paymentDetails.destinationTag,
          minAmount: {
            value: amount.toString(),
            currency: 'XRP'
          }
        }
      })

      const maxLedgerVersion = transaction.instructions.maxLedgerVersion
      if (!maxLedgerVersion) {
        log('Failed to settle: cannot send payment with no max ledger version')
        return
      }

      // Per https://github.com/ripple/ripple-lib/blob/develop/docs/index.md#transaction-instructions:
      // By omitting maxLedgerVersion instruction, default is current ledger plus 3
      const { signedTransaction, id: txHash } = rippleClient.sign(transaction.txJSON, xrpSecret)
      const transactionKey = `pending-xrp-transaction:${txHash}`

      try {
        // TODO This is an argument that commit should be a callback function?

        // *Before we submit*, settlement must be become unconditional
        await commitTx
          .zadd('pending-xrp-transactions', maxLedgerVersion.toString(), txHash)
          .hset(transactionKey, 'amount', amount.toFixed())
          .hset(transactionKey, 'tx_hash', txHash)
          .hset(transactionKey, 'account_id', accountId)
          .exec()

        // TODO If that returns `null`, the tx failed due the watch and we MUST NOT submit the settlement!

        // Per https://developers.ripple.com/get-started-with-rippleapi-for-javascript.html:
        //   "The tentative result should be ignored. Transactions that succeed here can ultimately fail,
        //    and transactions that fail here can ultimately succeed."
        await rippleClient.submit(signedTransaction)
      } catch (err) {
        log(`Failed to settle: ${details}`, err)
      }
    },

    startFinalizeTransactionLoop() {
      let terminate = false

      // If something goes very wrong, don't log too excessively
      const throttledLog = throttle(log, 60000)

      const updateTransactionLoop = (async () => {
        while (true) {
          if (terminate) {
            return
          }

          await sleep(2000)

          // TODO Move `updatePendingTransactions` here?
          await self
            .updatePendingTransactions()
            .catch(err => throttledLog('Failed to check pending transactions:', err))
        }
      })()

      return () => {
        terminate = true
        return updateTransactionLoop
      }
    },

    async updatePendingTransactions() {
      // Fetch the most recent validated ledger
      const latestLedgerVersion = await rippleClient.getLedgerVersion()

      // Iterate through all pending transactions
      let cursor = 0
      while (true) {
        const [newCursor, res] = await redis.zscan('pending-xrp-transactions', cursor, 'COUNT', 5)
        cursor = parseInt(newCursor, 10)

        const txIds = res.filter((_, i) => i % 2 === 0) // Even elements (member)
        const maxLedgerVersions = res.filter((_, i) => i % 2 === 1).map(parseInt) // Odd elements (score)

        const checkPendingTxs = txIds.map(async (txHash, i) => {
          const maxLedgerVersion = maxLedgerVersions[i]
          if (maxLedgerVersion < latestLedgerVersion) {
            return self.finalizeTransaction(txHash, true)
          }

          const result = await checkForTx(rippleClient, txHash)

          switch (result) {
            case TransactionStatus.Success:
              return self.finalizeTransaction(txHash, false)
            case TransactionStatus.Failure:
              return self.finalizeTransaction(txHash, true)
          }
        })

        await Promise.all(checkPendingTxs)

        // We've finished iterating through every pending transaction
        if (cursor === 0) {
          return
        }
      }
    },

    // TODO Add comment here, this should be idempotent
    async finalizeTransaction(txHash: string, rollback = false) {
      const txKey = `pending-xrp-transaction:${txHash}`

      const redisCopy = redis.duplicate()

      try {
        // Fail this rollback if this transaction was rolled back or finalized concurrently
        await redisCopy.watch(txKey)

        const txAlreadyFinalized = (await redis.exists(txKey)) !== 1
        if (txAlreadyFinalized) {
          throw new Error('Transaction was already finalized')
        }

        const [accountId, rawAmount] = await redis.hmget(txKey, 'account_id', 'amount')
        if (!accountId || !rawAmount) {
          throw new Error('Missing account or amount. Database may be corrupted')
        }

        const amount = new BigNumber(rawAmount)
        if (!isValidAmount(amount)) {
          throw new Error('Amount is invalid. Database may be corrupted')
        }

        const redisTx = rollback
          ? refundSettlement(accountId, amount, redisCopy.multi())
          : redis.multi()
        await redisTx
          .del(txKey)
          .zrem('pending-xrp-transactions', txKey)
          .exec()
      } catch (err) {
        log('Failed to finalize transaction: txHash=%s error=%O', txHash, err)
        await redisCopy.unwatch()
      }

      redisCopy.disconnect()
    },

    startCreditPaymentLoop() {
      let terminate = false

      // If something goes very wrong, don't log too excessively
      const throttledLog = throttle(log, 60000)

      const creditLoop = (async () => {
        while (true) {
          if (terminate) {
            return
          }

          await sleep(4000)
          await self
            .creditIncomingPayments()
            .catch(err => throttledLog('Failed to credit incoming payments:', err))
        }
      })()

      return () => {
        terminate = true
        return creditLoop
      }
    },

    async creditIncomingPayments() {
      const currentLedgerVersion = await rippleClient.getLedgerVersion() // Most recent validated ledger version

      const redisCopy = redis.duplicate()
      try {
        const ledgerVersionKey = 'latest-checked-ledger-version'

        // Prevent races/prevent the same transactions credited multiple times
        await redisCopy.watch(ledgerVersionKey)

        const lastCheckedLedgerVersion = await redisCopy
          .get(ledgerVersionKey)
          .then(res => (typeof res === 'string' ? parseInt(res, 10) : undefined))

        // Lookup transactions for up to 500 ledger versions at a time
        // (If this fails due to a gap in the history, this helps limits how many versions we skip)
        const minLedgerVersion = lastCheckedLedgerVersion
          ? Math.min(lastCheckedLedgerVersion + 1, currentLedgerVersion)
          : currentLedgerVersion
        const maxLedgerVersion = Math.min(minLedgerVersion + 500, currentLedgerVersion)

        // ripple-lib recursively fetches all transactions within the specified range
        const transactions: FormattedTransactionType[] = await rippleClient
          .getTransactions(xrpAddress, {
            earliestFirst: true,
            excludeFailures: true, // Code must be `tesSUCCESS`
            initiated: false, // Only include incoming transactions
            types: ['payment'],
            minLedgerVersion,
            maxLedgerVersion
          })
          .catch(err => {
            if (err instanceof rippleClient.errors.MissingLedgerHistoryError) {
              log(
                'ERROR: Unable to fetch transactions from ledger versions %d-%d, may have missed incoming payments',
                minLedgerVersion,
                maxLedgerVersion
              )

              // Retuning no transactions will still fast-forward, to check later ledgers rather than failing permanently
              return []
            }

            throw err
          })

        const isPayment = (tx: FormattedTransactionType): tx is FormattedPaymentTransaction =>
          tx.type === 'payment'

        const isSuccessful = (tx: FormattedPaymentTransaction) => tx.outcome.result === 'tesSUCCESS'

        const isXrp = (tx: FormattedPaymentTransaction) =>
          !!(tx.outcome.deliveredAmount?.currency === 'XRP')

        const amDestination = (tx: FormattedPaymentTransaction) =>
          tx.specification.destination.address === xrpAddress

        const hasNotBeenCredited = (tx: FormattedPaymentTransaction) =>
          typeof lastCheckedLedgerVersion === 'undefined' ||
          tx.outcome.ledgerVersion > minLedgerVersion

        // Compose Redis transaction to atomically credit all incoming payments
        await transactions
          .filter(isPayment)
          .filter(isSuccessful)
          .filter(isXrp)
          .filter(amDestination)
          .filter(hasNotBeenCredited)
          // Lookup account corresponding to each incoming XRP payment
          .map(
            async ({ id: txHash, ...tx }): Promise<void | [string, BigNumber, string]> => {
              const destinationTag = tx.specification.destination.tag
              if (!destinationTag) {
                return
              }

              // TODO Add this to Redis schema
              const accountId = await redis
                .get(`incoming-xrp-payment-tags:${destinationTag}`)
                .catch(err => log('Failed to lookup account for incoming payment:', err))
              if (!accountId) {
                return
              }

              const amount = new BigNumber(tx.outcome.deliveredAmount?.value || 0)
              if (!amount.isGreaterThan(0)) {
                return
              }

              return [accountId, amount, txHash]
            }
          )
          // Collect all pending promises into a single Redis transaction
          .reduce(async (acc, creditPromise) => {
            const credit = await creditPromise
            if (!credit) {
              return acc
            }

            const [accountId, amount, txHash] = credit
            log(
              `Received incoming XRP payment: xrp=%d account=%s txHash=%s`,
              amount,
              accountId,
              txHash
            )

            return creditSettlement(accountId, amount, await acc)
          }, Promise.resolve(redisCopy.multi()))
          // Submit the tx to credit all payemnts, and update the ledger version we queried
          .then(redisTx => redisTx.set(ledgerVersionKey, maxLedgerVersion).exec())

        log('Credited incoming XRP payments up to ledger version %s', maxLedgerVersion)
      } catch (err) {
        log('Error crediting incoming XRP payments:', err)
        await redisCopy.unwatch()
      }

      redisCopy.disconnect()
    },

    async disconnect() {
      // TODO How should I stop the outgoing queue?

      await Promise.all([stopFinalizeTransactionLoop(), stopCreditPaymentLoop()])
      await rippleClient.disconnect()
    }
  }

  const stopFinalizeTransactionLoop = self.startFinalizeTransactionLoop()
  const stopCreditPaymentLoop = self.startCreditPaymentLoop()

  await rippleClient.connect()

  return self
}

export interface PaymentDetails {
  xrpAddress: string
  destinationTag: number
}

const MAX_UINT_32 = 4294967295

export const isPaymentDetails = (o: any): o is PaymentDetails =>
  typeof o === 'object' &&
  typeof o.xrpAddress === 'string' &&
  Number.isInteger(o.destinationTag) &&
  o.destinationTag >= 0 &&
  o.destinationTag <= MAX_UINT_32

interface RippleTestnetResponse {
  account?: {
    secret: string
    address: string
  }
}

/** Convert an XRP secret to an XRP address */
export const secretToAddress = (xrpSecret: string) =>
  deriveAddress(deriveKeypair(xrpSecret).publicKey)

/** Generate a secret for a new, prefunded XRP account */
export const generateTestnetAccount = async () =>
  axios
    .post('https://faucet.altnet.rippletest.net/accounts')
    .then(async ({ data }: AxiosResponse<RippleTestnetResponse>) => {
      if (data && data.account) {
        const { secret, address } = data.account

        // Wait for it to be included in a block
        await sleep(5000)

        // TODO Instead of sleeping, poll until the account exists?

        log(`Generated new XRP testnet account: address=${address} secret=${secret}`)
        return secret
      }

      throw new Error('Failed to generate new XRP testnet account')
    })

/** Wait and resolve after the given number of milliseconds */
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Create a function that runs the given function once per period, ignoring subsequent calls
 * @param func Function to execute once per period
 * @param period Number of milliseconds between function calls
 */
export function throttle<F extends Function>(func: F, period: number): F {
  let ready = true

  return ((...args: any[]) => {
    if (!ready) {
      return
    }

    setTimeout(() => {
      ready = true
    }, period)

    func(...args)
  }) as any
}

/** States of an XRP transaction */
enum TransactionStatus {
  Success,
  Failure,
  Pending
}

/**
 * Was the given transaction successfully included in a validated ledger?
 * @param api Connected instance of ripple-lib
 * @param txHash Transaction hash
 */
const checkForTx = (api: RippleAPI, txHash: string): Promise<TransactionStatus> =>
  api
    .getTransaction(txHash)
    .then(({ outcome }) =>
      outcome.result === 'tesSUCCESS' ? TransactionStatus.Success : TransactionStatus.Failure
    )
    // ripple-lib rejects on:
    // - Tx not found errors
    // - Missing ledger history errors
    // - tx isn't from a validated ledger:
    //   https://github.com/ripple/ripple-lib/blob/f5196389e8554d1653cbfaaa398b0180442888de/src/ledger/transaction.ts#L118
    .catch(_ => TransactionStatus.Pending)
