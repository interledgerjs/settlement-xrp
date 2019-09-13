import { randomBytes } from 'crypto'
import debug from 'debug'
import { promisify } from 'util'

const log = debug('settlement-core')

/** Wait and resolve after the given number of milliseconds */
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Generate a floating-point, pseudo-random number in the range [0, 1) */
export const generateRandom = async () =>
  (await promisify(randomBytes)(4)).readUInt32BE(0) / 4294967296

const RETRY_MIN_DELAY_MS = 100
const RETRY_MAX_DELAY_MS = 1000 * 60 * 60 // 1 hour

/**
 * Retry the given request with an exponential backoff as retry-able errors are encountered
 * @param sendRequest Function to send a request using Axios and handle relevant responses
 * @param attempt Total number of attempts performed, including this attempt
 */
export const retryRequest = <T>(performRequest: () => Promise<T>, attempt = 1): Promise<T> =>
  performRequest().catch(async err => {
    const is409 = err.response && err.response.code === 409 // No Conflict
    const is5xx = err.response && err.response.code >= 500
    const noResponse = err.request && !err.response
    const shouldRetry = is409 || is5xx || noResponse
    if (!shouldRetry) {
      throw err
    }

    /**
     * Adaptation of backoff algorithm from Stripe:
     * https://github.com/stripe/stripe-ruby/blob/1bb9ac48b916b1c60591795cdb7ba6d18495e82d/lib/stripe/stripe_client.rb#L78-L92
     */

    let delayMs = Math.min(RETRY_MIN_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS)
    delayMs = delayMs * (0.5 * (1 + (await generateRandom()))) // Add random "jitter" to delay (thundering herd problem)
    delayMs = Math.max(RETRY_MIN_DELAY_MS, delayMs)

    log(`Retrying HTTP request in ${Math.floor(delayMs / 1000)} seconds:`, err.message) // Don't log Axios error objects...they're HUGE
    await sleep(delayMs)
    return retryRequest(performRequest, attempt + 1)
  })
