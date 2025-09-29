(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-INVALID-RECIPIENT u102)
(define-constant ERR-INVALID-CONDITION u103)
(define-constant ERR-TRANSFER-FAILED u104)
(define-constant ERR-ESCROW-ALREADY-EXISTS u105)
(define-constant ERR-ESCROW-NOT-FOUND u106)
(define-constant ERR-INVALID-PARAMS u107)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u108)
(define-constant ERR-INVALID-FEE u109)
(define-constant ERR-MAX-ESCROWS-EXCEEDED u110)
(define-constant ERR-INVALID-TIMESTAMP u111)
(define-constant ERR-INVALID-CURRENCY u112)
(define-constant ERR-INVALID-STATUS u113)

(define-data-var next-escrow-id uint u1)
(define-data-var max-escrows uint u10000)
(define-data-var creation-fee uint u500)
(define-data-var authority-contract (optional principal) none)
(define-data-var supported-currencies (list 10 (string-utf8 20)) (list "STX" "USD" "BTC"))

(define-map escrows-by-id
  uint
  {
    sender: principal,
    recipient: principal,
    amount: uint,
    condition-contract: principal,
    condition-param: uint,
    timestamp: uint,
    currency: (string-utf8 20),
    status: bool
  }
)

(define-map escrows-by-sender
  principal
  (list 100 uint)
)

(define-read-only (get-escrow (id uint))
  (map-get? escrows-by-id id)
)

(define-read-only (get-escrows-by-sender (sender principal))
  (default-to (list) (map-get? escrows-by-sender sender))
)

(define-read-only (get-escrow-count)
  (var-get next-escrow-id)
)

(define-read-only (get-creation-fee)
  (var-get creation-fee)
)

(define-read-only (get-supported-currencies)
  (var-get supported-currencies)
)

(define-private (validate-amount (amount uint))
  (if (> amount u0)
      (ok true)
      (err ERR-INVALID-AMOUNT))
)

(define-private (validate-recipient (recipient principal))
  (if (not (is-eq recipient 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-INVALID-RECIPIENT))
)

(define-private (validate-condition (condition principal))
  (if (not (is-eq condition 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-INVALID-CONDITION))
)

(define-private (validate-params (params (buff 1024)))
  (if (> (len params) u0)
      (ok true)
      (err ERR-INVALID-PARAMS))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-currency (currency (string-utf8 20)))
  (if (is-some (index-of (var-get supported-currencies) currency))
      (ok true)
      (err ERR-INVALID-CURRENCY))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-recipient contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-creation-fee (new-fee uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (asserts! (>= new-fee u0) (err ERR-INVALID-FEE))
    (var-set creation-fee new-fee)
    (ok true)
  )
)

(define-public (add-currency (currency (string-utf8 20)))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (try! (validate-currency currency))
    (var-set supported-currencies (unwrap! (as-max-len? (append (var-get supported-currencies) currency) u10) (err ERR-INVALID-CURRENCY)))
    (ok true)
  )
)

(define-public (create-escrow
  (recipient principal)
  (amount uint)
  (condition-contract principal)
  (condition-params (buff 1024))
  (currency (string-utf8 20))
)
  (let
    (
      (escrow-id (var-get next-escrow-id))
      (authority (var-get authority-contract))
      (sender-escrows (get-escrows-by-sender tx-sender))
    )
    (asserts! (< escrow-id (var-get max-escrows)) (err ERR-MAX-ESCROWS-EXCEEDED))
    (try! (validate-recipient recipient))
    (try! (validate-amount amount))
    (try! (validate-condition condition-contract))
    (try! (validate-params condition-params))
    (try! (validate-currency currency))
    (asserts! (is-none (map-get? escrows-by-id escrow-id)) (err ERR-ESCROW-ALREADY-EXISTS))
    (asserts! (is-some authority) (err ERR-AUTHORITY-NOT-VERIFIED))
    (try! (stx-transfer? (var-get creation-fee) tx-sender (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
    (let
      (
        (condition-param (try! (contract-call? condition-contract create-condition condition-params)))
      )
      (try! (contract-call? .Escrow init-escrow escrow-id tx-sender recipient amount condition-contract condition-param currency))
      (map-set escrows-by-id escrow-id
        {
          sender: tx-sender,
          recipient: recipient,
          amount: amount,
          condition-contract: condition-contract,
          condition-param: condition-param,
          timestamp: block-height,
          currency: currency,
          status: true
        }
      )
      (map-set escrows-by-sender tx-sender
        (unwrap! (as-max-len? (append sender-escrows escrow-id) u100) (err ERR-MAX-ESCROWS-EXCEEDED))
      )
      (var-set next-escrow-id (+ escrow-id u1))
      (print { event: "escrow-created", id: escrow-id })
      (ok escrow-id)
    )
  )
)

(define-public (cancel-escrow (escrow-id uint))
  (let
    (
      (escrow (unwrap! (map-get? escrows-by-id escrow-id) (err ERR-ESCROW-NOT-FOUND)))
    )
    (asserts! (is-eq tx-sender (get sender escrow)) (err ERR-NOT-AUTHORIZED))
    (asserts! (get status escrow) (err ERR-INVALID-STATUS))
    (try! (contract-call? .Escrow refund escrow-id))
    (map-set escrows-by-id escrow-id (merge escrow { status: false }))
    (print { event: "escrow-cancelled", id: escrow-id })
    (ok true)
  )
)