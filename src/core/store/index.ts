import BigNumber from 'bignumber.js'
import { Brand } from '../utils/quantity'

const KEY_NAMESPACE_DELIMITER = ':'

export type SafeKey = Brand<string, 'SafeKey'>

export const isSafeKey = (o: any): o is SafeKey =>
  typeof o === 'string' && !o.includes(KEY_NAMESPACE_DELIMITER)

export interface SettlementStore {
  /**
   * Create an account with the given ID
   *
   * @param accountId Unique account identifier
   * @return Did the account already exist?
   */
  createAccount(accountId: SafeKey): Promise<boolean>

  /**
   * Has the given account been instantiated via a call from the connector?
   *
   * @param accountId Unique account identifier
   */
  isExistingAccount(accountId: SafeKey): Promise<boolean>

  /**
   * Delete all state associated with the given account
   *
   * @param accountId Unique account identifier
   */
  deleteAccount(accountId: SafeKey): Promise<void>

  /**
   * Save the amount to settle corresponding to the given idempotency key
   * - If the idempotency key is already cached, return the amount already queued for settlement
   * - If the idempotency key is new, queue the amount for settlement and save the idempotency key,
   *   returning the same amount
   *
   * @param accountId Unique account identifier
   * @param idempotencyKey Unique identifier for this settlement request
   * @param amount Amount to queue for settlement corresponding to this idempotency key
   * @return Amount queued for settlement corresponding to this idempotency key
   */
  queueSettlement(
    accountId: SafeKey,
    idempotencyKey: SafeKey,
    amount: BigNumber
  ): Promise<BigNumber>

  /**
   * Load the amount of failed outgoing settlements (used to retry sending)
   * - Must acquire a lock on the amounts or prevent applying them to simultaneous settlements
   * - Returns 0 if there are no uncredited settlements
   *
   * @param accountId Unique account identifier
   * @return Total unsettled amount in standard unit in arbitrary precision
   */
  loadAmountToSettle(accountId: SafeKey): Promise<BigNumber>

  /**
   * Save the amount as a failed outgoing settlement to be retried later
   * - Must add the amount to existing unsettled amounts
   *
   * @param accountId Unique account identifier
   * @param amount Unsettled amount in standard unit in arbitrary precision
   */
  saveAmountToSettle(accountId: SafeKey, amount: BigNumber): Promise<void>

  /**
   * Load the amount of uncredited incoming settlements (used to retry notifying the connector)
   * - Must acquire a lock on the amounts or prevent applying them to simultaneous notifications
   * - Returns 0 if there are no uncredited settlements
   *
   * @param accountId Unique account identifier
   * @return Total uncredited amount in standard unit in arbitrary precision
   */
  loadAmountToCredit(accountId: SafeKey): Promise<BigNumber>

  /**
   * Save the amount as an uncredited incoming settlement to be retried later
   * - Must add the amount to existing uncredited amounts
   *
   * @param accountId Unique account identifier
   * @param amount Uncredited amount in standard unit in arbitrary precision
   */
  saveAmountToCredit(accountId: SafeKey, amount: BigNumber): Promise<void>

  /** Shutdown the database connection */
  disconnect?(): Promise<void>
}
