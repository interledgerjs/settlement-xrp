
Currently handles settlement

## Balance Tracking

The following ideas of balance is important as it forms the basis on handling balances within ILP

Positive increase to peer balance (Debit):
* Incoming packet FROM peer (AR)
* Settlement Sent TO peer (AP)

Negative adjustment to peer balance (Credit):
* Outgoing packet TO peer (AP)
* Settlement Received FROM peer (AR)

Note (Balance is an overlay of a peer receivable and peer payable account in accounting terms and is basically a simplified netting process)

## Parameters
* Maximum Balance: Maximum credit you wish to extend to your counterparty peer
* Minimum Balance: Maximum credit you want to allow extended to yourself from the counterparty peer/ OR the known amount of credit they have extended you. Can be used on your side to determine if you need to be settling
* Settlement Threshold: Threshold with which to do the settlement

## Flows to consider
We are Alice and counterparty is Bob and thus the balances and settings are from our perspective

### Mutual credit extended between both parties

#### Account Related
* Startup
    * Check for existing accounts and add thresholds on the connector(s)
* Adding an account
    * Add thresholds on the connector(s)
* Removing an account
    * Remove thresholds on the connector(s)

#### Ledger Related
* Subscribe to account on ledger
    * incoming transaction needs to update connector(s) balance
* Deal with incoming thresholds
    * Settle if threshold to settle is passed

### TODO
* [ ] Add peer.settle handler
* [ ] Settlement simulator
* [ ] How to handle initial state?
* [ ] Prevent duplicate settlements with close events happening