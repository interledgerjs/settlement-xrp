import BigNumber from 'bignumber.js'
import { randomBytes } from 'crypto'
import debug from 'debug'
import { deriveAddress, deriveKeypair } from 'ripple-keypairs'
import { RippleAPI } from 'ripple-lib'
import { ConnectSettlementEngine, SettlementEngine } from './core'
import axios, { AxiosResponse } from 'axios'

const log = debug('settlement-xrp')

export interface XrpEngineOpts {
  xrpSecret?: string
  rippledUri?: string
  rippleClient?: RippleAPI
}

export interface XrpSettlementEngine extends SettlementEngine {
  handleTransaction(tx: any): void
}

export const createEngine = (opts: XrpEngineOpts = {}): ConnectSettlementEngine => async ({
  sendMessage,
  creditSettlement
}) => {
  const xrpSecret = opts.xrpSecret || (await generateTestnetAccount())
  const xrpAddress = deriveAddress(deriveKeypair(xrpSecret).publicKey)

  const rippleClient: RippleAPI =
    opts.rippleClient ||
    new RippleAPI({
      server: opts.rippledUri || 'wss://s.altnet.rippletest.net:51233'
    })

  const incomingPaymentTags = new Map<number, string>() // destinationTag -> accountId

  const self: XrpSettlementEngine = {
    async handle(accountId, message) {
      if (message.type && message.type === 'paymentDetails') {
        const destinationTag = randomBytes(4).readUInt32BE(0)
        if (incomingPaymentTags.has(destinationTag)) {
          throw new Error('Failed to generate new destination tag')
        }

        incomingPaymentTags.set(destinationTag, accountId)
        setTimeout(() => incomingPaymentTags.delete(destinationTag), 5 * 60000) // Clean-up tags after 5 mins to prevent memory leak

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
      log(`Starting settlement: account=${accountId} xrp=${amount}`)

      const paymentDetails = await sendMessage(accountId, {
        type: 'paymentDetails'
      })
        .then(response =>
          isPaymentDetails(response)
            ? response
            : log(`Failed to settle: Received invalid payment details: account=${accountId}`)
        )
        .catch(err =>
          log(`Failed to settle: Error fetching payment details: account=${accountId}`, err)
        )
      if (!paymentDetails) {
        return new BigNumber(0)
      }

      const signedTransaction = await rippleClient
        .preparePayment(xrpAddress, {
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
        .then(payment => rippleClient.sign(payment.txJSON, xrpSecret).signedTransaction)
        .catch(err =>
          log(`Error creating transaction to settle: account=${accountId} xrp=${amount}`, err)
        )
      if (!signedTransaction) {
        return new BigNumber(0)
      }

      /**
       * TODO Should this check if the transaction succeeded?
       *
       * Per https://developers.ripple.com/get-started-with-rippleapi-for-javascript.html:
       * "The tentative result should be ignored. Transactions that succeed here can ultimately fail,
       *  and transactions that fail here can ultimately succeed."
       */
      await rippleClient
        .submit(signedTransaction)
        .then(({ resultCode }) =>
          resultCode === 'tesSUCCESS'
            ? log(`Successfully submitted payment: account=${accountId} xrp=${amount}`)
            : log(
                `[Tentative] Payment failed: account=${accountId} xrp=${amount} code=${resultCode}`
              )
        )
        .catch(err => log(`Failed to submit payment: account=${accountId} xrp=${amount}`, err))
      return amount
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

      const accountId = incomingPaymentTags.get(tx.transaction.DestinationTag)
      if (!accountId) {
        return
      }

      const txHash = tx.transaction.hash
      log(`Received incoming XRP payment: xrp=${amount} account=${accountId} txHash=${txHash}`)
      creditSettlement(accountId, amount, txHash)
    },

    async disconnect() {
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

interface PaymentDetails {
  xrpAddress: string
  destinationTag: number
}

const MAX_UINT_32 = 4294967295

const isPaymentDetails = (o: any): o is PaymentDetails =>
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

export const generateTestnetAccount = async () =>
  axios
    .post('https://faucet.altnet.rippletest.net/accounts')
    .then(({ data }: AxiosResponse<RippleTestnetResponse>) => {
      if (data && data.account) {
        const { secret, address } = data.account
        log(`Generated new XRP testnet account: address=${address} secret=${secret}`)
        return secret
      }

      throw new Error('Failed to generate new XRP testnet account')
    })
