import axios, { AxiosResponse } from 'axios'
import BigNumber from 'bignumber.js'
import { randomBytes } from 'crypto'
import debug from 'debug'
import { AccountServices, SettlementEngine } from 'ilp-settlement-core'
import { deriveAddress, deriveKeypair } from 'ripple-keypairs'
import { RippleAPI } from 'ripple-lib'
import { Prepare } from 'ripple-lib/dist/npm/transaction/types'

const log = debug('settlement-xrp')

export const TESTNET_RIPPLED_URI = 'wss://s.altnet.rippletest.net:51233'

export interface XrpEngineOpts {
  xrpSecret?: string
  rippledUri?: string
  rippleClient?: RippleAPI
}

export interface XrpSettlementEngine extends SettlementEngine {
  handleMessage(accountId: string, message: any): Promise<any>
  handleTransaction(tx: any): void
  disconnect(): Promise<void>
}

export type ConnectXrpSettlementEngine = (services: AccountServices) => Promise<XrpSettlementEngine>

export const createEngine = (opts: XrpEngineOpts = {}): ConnectXrpSettlementEngine => async ({
  sendMessage,
  creditSettlement
}) => {
  /** XRP secret for sending and signing outgoing payments */
  const xrpSecret = opts.xrpSecret || (await generateTestnetAccount())

  /** XRP address to tell peer to send payments to */
  let xrpAddress: string
  try {
    xrpAddress = secretToAddress(xrpSecret)
  } catch (err) {
    throw new Error('Invalid XRP secret')
  }

  /** Lock if a transaction is currently being submitted */
  let pendingTransaction = false

  const rippleClient: RippleAPI =
    opts.rippleClient ||
    new RippleAPI({
      server: opts.rippledUri || TESTNET_RIPPLED_URI
    })

  // @ts-ignore
  // Connection issues require increasing timeout, but cannot pass as config option:
  // https://github.com/ripple/ripple-lib/issues/1196
  rippleClient.connection._config.connectionTimeout = 10000

  /** Mapping of destinationTag -> accountId to correlate incoming payments */
  const incomingPaymentTags = new Map<number, string>()

  /** Set of timeout IDs to cleanup when exiting */
  const pendingTimers = new Set<NodeJS.Timeout>()

  const self: XrpSettlementEngine = {
    async handleMessage(accountId, message) {
      if (message.type && message.type === 'paymentDetails') {
        const destinationTag = randomBytes(4).readUInt32BE(0)
        if (incomingPaymentTags.has(destinationTag)) {
          throw new Error('Failed to generate new destination tag')
        }

        incomingPaymentTags.set(destinationTag, accountId)

        // Clean-up tags after 5 mins to prevent memory leak
        pendingTimers.add(setTimeout(() => incomingPaymentTags.delete(destinationTag), 5 * 60000))

        return {
          destinationTag,
          xrpAddress
        }
      } else {
        throw new Error('Unknown message type')
      }
    },

    async settle(accountId, queuedAmount) {
      const amount = queuedAmount.decimalPlaces(6, BigNumber.ROUND_DOWN) // Limit precision to drops (remainder will be refunded)
      if (amount.isZero()) {
        // Even though settlement-core checks against this, if connector scale > 6, it could still round down to 0
        return new BigNumber(0)
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
        return new BigNumber(0)
      }

      let transaction: Prepare
      try {
        transaction = await rippleClient.preparePayment(xrpAddress, {
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
      } catch (err) {
        log(`Failed to settle: Error preparing XRP payment: ${details}`, err)
        return new BigNumber(0)
      }

      // Ensure only a single settlement occurs at once
      if (pendingTransaction) {
        log(`Failed to settle: transaction already in progress: ${details}`)
        return new BigNumber(0)
      }

      // Apply lock for pending transaction
      pendingTransaction = true

      try {
        /*
         * Per https://github.com/ripple/ripple-lib/blob/develop/docs/index.md#transaction-instructions:
         * By omitting maxLedgerVersion instruction, default is current ledger plus 3
         */
        const { signedTransaction, id } = rippleClient.sign(transaction.txJSON, xrpSecret)

        /**
         * Per https://developers.ripple.com/get-started-with-rippleapi-for-javascript.html:
         *
         * "The tentative result should be ignored. Transactions that succeed here can ultimately fail,
         * and transactions that fail here can ultimately succeed."
         */
        await rippleClient.submit(signedTransaction)

        const didApplyTx = checkForTx(rippleClient, id)
        return didApplyTx ? amount : new BigNumber(0)
      } catch (err) {
        log(`Failed to settle: Transaction error: ${details}`, err)
        return amount // For safety, assume transaction was applied (return full amount was settled)
      } finally {
        pendingTransaction = false
      }
    },

    handleTransaction(tx) {
      // Reference: https://xrpl.org/monitor-incoming-payments-with-websocket.html (4. Read Incoming Payments)
      if (
        !tx.validated ||
        tx.meta.TransactionResult !== 'tesSUCCESS' ||
        tx.transaction.TransactionType !== 'Payment' ||
        tx.transaction.Destination !== xrpAddress
      ) {
        return
      }

      /**
       * Parse amount received from the transaction
       * - https://xrpl.org/transaction-metadata.html#delivered-amount
       * - https://xrpl.org/basic-data-types.html#specifying-currency-amounts
       * - `delivered_amount` may represent a non-XRP asset, so ensure it's a string
       */
      const amount = new BigNumber(tx.meta.delivered_amount).shiftedBy(-6) // Convert from drops to XRP
      if (!amount.isGreaterThan(0)) {
        return
      }

      // TODO What if amount is NaN? (Will settlement-core catch that?)

      const accountId = incomingPaymentTags.get(tx.transaction.DestinationTag)
      if (!accountId) {
        return
      }

      const txHash = tx.transaction.hash
      log(`Received incoming XRP payment: xrp=${amount} account=${accountId} txHash=${txHash}`)
      creditSettlement(accountId, amount, txHash)
    },

    async disconnect() {
      pendingTimers.forEach(timer => clearTimeout(timer))
      await rippleClient.disconnect()
    }
  }

  await rippleClient.connect()

  rippleClient.connection.on('transaction', self.handleTransaction)
  await rippleClient.request('subscribe', {
    accounts: [xrpAddress]
  })

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
 * Was the given transaction successfully included in a validated ledger?
 *
 * @param api Connected instance of ripple-lib
 * @param txHash Transaction hash
 * @param attempts Cumulative number of attempts this transaction state has been fetched
 */
const checkForTx = (api: RippleAPI, txHash: string, attempts = 0): Promise<boolean> =>
  api
    .getTransaction(txHash)
    .then(({ outcome }) => {
      if (outcome.result === 'tesSUCCESS') {
        log(`Transaction successfully included in validated ledger: txHash=${txHash}`)
        return true
      } else {
        log(`Transaction failed: txHash=${txHash} outcome=${outcome.result}`)
        return false
      }
    })
    /**
     * Ripple-lib throws if the tx isn't from a validated ledger:
     * https://github.com/ripple/ripple-lib/blob/181cfd69de74454f1024b77dffdeb1363cbc07c1/src/ledger/transaction.ts#L86
     */
    .catch(async (err: Error) => {
      // Fails after at least 4 seconds (plus time for each API call)
      if (attempts > 20) {
        log(`Failed to fetch transaction result, despite several attempts: txHash=${txHash}`, err)
        return true // Must assume the transaction was included, since we can't verify the result
      }

      const shouldRetry =
        err instanceof api.errors.MissingLedgerHistoryError ||
        err instanceof api.errors.NotFoundError
      if (shouldRetry) {
        await sleep(200)
        return checkForTx(api, txHash, attempts + 1)
      }

      return true // Non-retryable error (but not related to transaction inclusion)
    })
