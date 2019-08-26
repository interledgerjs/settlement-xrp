import BigNumber from 'bignumber.js'

export interface SettlementStore {
  /**
   * Create a new account
   * @param accountId Unique account identifier
   */
  createAccount(accountId: string): Promise<void>

  /**
   * Has the given account been instantiated via a call from the connector?
   * @param accountId Unique account identifier
   */
  isExistingAccount(accountId: string): Promise<boolean>

  /**
   * Delete all state associated with the given account
   * @param accountId Unique account identifier
   */
  deleteAccount(accountId: string): Promise<void>

  /**
   * TODO
   * @param accountId Unique account identifier
   * @param idempotencyKey Unique identifier for this settlement request
   * @param amount
   * @return
   */
  queueSettlement(
    accountId: string,
    idempotencyKey: string,
    amount: BigNumber
  ): Promise<BigNumber>

  /**
   * Load the amount of failed outgoing settlements (used to retry sending)
   * - Must acquire a lock on the amounts or prevent applying them to simultaneous settlements
   * @param accountId Unique account identifier
   * @return Total unsettled amount in a floating point, standard unit
   */
  loadAmountToSettle(accountId: string): Promise<BigNumber>

  /**
   * Save the amount as a failed outgoing settlement to be retried later
   * - Must add the amount to existing unsettled amounts
   * @param accountId Unique account identifier
   * @param amount Unsettled amount in a floating point, standard unit
   */
  saveAmountToSettle(accountId: string, amount: BigNumber): Promise<void>

  /**
   * Load the amount of uncredited incoming settlements (used to retry notifying the connector)
   * - Must acquire a lock on the amounts or prevent applying them to simultaneous notifications
   * @param accountId Unique account identifier
   * @return Total uncredited amount in a floating point, standard unit
   */
  loadAmountToCredit(accountId: string): Promise<BigNumber>

  /**
   * Save the amount as an uncredited incoming settlement to be retried later
   * - Must add the amount to existing uncredited amounts
   * @param accountId Unique account identifier
   * @param amount Uncredited amount in a floating point, standard unit
   */
  saveAmountToCredit(accountId: string, amount: BigNumber): Promise<void>

  /** Shutdown the database connection */
  disconnect?(): Promise<void>
}
