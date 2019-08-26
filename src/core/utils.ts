import { randomBytes } from 'crypto'
import { promisify } from 'util'
import BigNumber from 'bignumber.js'
import debug from 'debug'

// TODO Add predicate for an amount that is valid (positive or 0, not NaN)

export const convertToQuantity = (amount: BigNumber) => {
  const scale = amount.decimalPlaces() || 0

  return {
    scale,
    amount: amount.shiftedBy(scale).toString()
  } as Quantity
}

export const convertFromQuantity = ({ amount, scale }: Quantity) =>
  new BigNumber(amount).shiftedBy(-scale)

export const sleep = (duration: number) => new Promise(r => setTimeout(r, duration))

// Generate a floating-point, pseudo-random number in the range [0, 1)
export const generateRandom = async () =>
  (await promisify(randomBytes)(4)).readUInt32BE(0) / 4294967296

export type Brand<K, T> = K & { readonly __brand: T }

/**
 * Using a nominal type/"branding" the type ensures that we've validated
 * it using the `isQuantity` function
 */
export type Quantity = Brand<
  {
    amount: string
    scale: number
  },
  'Quantity'
>

export const isQuantity = (o: any): o is Quantity =>
  typeof o === 'object' &&
  Number.isInteger(o.scale) &&
  o.scale >= 0 &&
  o.scale <= 255 &&
  typeof o.amount === 'string' &&
  new BigNumber(o.amount).isInteger() &&
  +o.amount >= 0

export type DatabaseSafe = Brand<string, 'DatabaseSafe'>

export const isDatabaseSafe = (o: any): o is DatabaseSafe =>
  typeof o === 'string' && !o.includes(':')

const log = debug('settlement-core')

const RETRY_MAX_ATTEMPTS = 16
const RETRY_MIN_DELAY_MS = 100
const RETRY_MAX_DELAY_MS = 1000 * 60 * 10 // 10 minutes

/**
 * Retry the given request with an exponential backoff as retry-able errors are encountered
 * @param sendRequest Function to send a request using Axios and handle relevant responses
 * @param attempt Total number of attempts performed, including this attempt
 */
export const retryRequest = <T>(performRequest: () => Promise<T>, attempt = 1): Promise<T> =>
  performRequest().catch(async error => {
    const is409 = error.response && error.response.code === 409 // No Conflict
    const is5xx = error.response && error.response.code >= 500
    const noResponse = error.request && !error.response
    const shouldRetry = is409 || is5xx || noResponse
    if (!shouldRetry) {
      throw error
    }

    if (attempt >= RETRY_MAX_ATTEMPTS) {
      throw new Error(`retried maximum of ${RETRY_MAX_ATTEMPTS} attempts`)
    }

    /**
     * Adaptation of backoff algorithm from Stripe:
     * https://github.com/stripe/stripe-ruby/blob/1bb9ac48b916b1c60591795cdb7ba6d18495e82d/lib/stripe/stripe_client.rb#L78-L92
     */

    let delayMs = Math.min(RETRY_MIN_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS)
    delayMs = delayMs * (0.5 * (1 + (await generateRandom()))) // Add random "jitter" to delay (thundering herd problem)
    delayMs = Math.max(RETRY_MIN_DELAY_MS, delayMs)

    log(`Retrying HTTP request in ${Math.floor(delayMs / 1000)} seconds:`, error.message) // Axios error messages are HUGE
    await sleep(delayMs)
    return retryRequest(performRequest, attempt + 1)
  })
