;; contracts/Escrow.clar
(define-trait condition-trait
  (
    (verify (principal uint) (response bool uint))
    (create-condition ((buff 1024)) (response uint uint))
  )
)

(define-constant ERR-NOT-FOUND u404)
(define-constant ERR-NOT-OWNER u403)
(define-constant ERR-CONDITION-NOT-MET u201)
(define-constant ERR-TRANSFER-FAILED u301)
(define-constant ERR-ALREADY-CLAIMED u202)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-INVALID-RECIPIENT u103)
(define-constant ERR-INVALID-CONDITION u101)
(define-constant ERR-ESCROW-EXPIRED u203)
(define-constant ERR-ESCROW-NOT-EXPIRED u204)
(define-constant ERR-DISPUTE-INITIATED u205)
(define-constant ERR-DISPUTE-NOT-INITIATED u206)
(define-constant ERR-NOT-DISPUTE-RESOLVER u207)
(define-constant ERR-INVALID-DISPUTE-FEE u208)
(define-constant ERR-INVALID-TIMESTAMP u108)
(define-constant ERR-INVALID-CURRENCY u119)
(define-constant ERR-INSUFFICIENT-BALANCE u302)
(define-constant ERR-REENTRANCY u303)
(define-constant ERR-MAX-ESCROWS-EXCEEDED u114)
(define-constant ERR-ESCROW-CANCELLED u209)
(define-constant ERR-ESCROW-NOT-CANCELLED u210)

(define-data-var next-escrow-id uint u1)
(define-data-var max-escrows uint u10000)
(define-data-var dispute-fee uint u500)
(define-data-var reentrancy-guard bool false)

(define-map escrows uint
  {
    sender: principal,
    recipient: principal,
    amount: uint,
    currency: (string-ascii 10),
    condition-contract: principal,
    condition-param: uint,
    created-at: uint,
    expires-at: (optional uint),
    status: (string-ascii 20),
    dispute-resolver: (optional principal),
    dispute-initiated: bool,
    dispute-reason: (optional (string-utf8 256)),
    cancelled: bool
  }
)

(define-map escrow-balances uint uint)
(define-map dispute-records uint {initiator: principal, timestamp: uint, resolved: bool})

(define-read-only (get-escrow (id uint))
  (map-get? escrows id)
)

(define-read-only (get-escrow-balance (id uint))
  (map-get? escrow-balances id)
)

(define-read-only (get-dispute-record (id uint))
  (map-get? dispute-records id)
)

(define-read-only (is-escrow-active (id uint))
  (match (map-get? escrows id)
    escrow (is-eq (get status escrow) "active")
    false
  )
)

(define-read-only (is-escrow-expired (id uint))
  (match (map-get? escrows id)
    escrow (match (get expires-at escrow)
      expiry (>= block-height expiry)
      false
    )
    false
  )
)

(define-private (validate-amount (amount uint))
  (if (> amount u0) (ok true) (err ERR-INVALID-AMOUNT))
)

(define-private (validate-recipient (recipient principal))
  (if (not (is-eq recipient tx-sender)) (ok true) (err ERR-INVALID-RECIPIENT))
)

(define-private (validate-currency (currency (string-ascii 10)))
  (if (or (is-eq currency "STX") (is-eq currency "USD")) (ok true) (err ERR-INVALID-CURRENCY))
)

(define-private (validate-condition-contract (contract principal))
  (if (not (is-eq contract tx-sender)) (ok true) (err ERR-INVALID-CONDITION))
)

(define-private (prevent-reentrancy)
  (if (var-get reentrancy-guard)
    (err ERR-REENTRANCY)
    (begin (var-set reentrancy-guard true) (ok true))
  )
)

(define-private (release-reentrancy)
  (var-set reentrancy-guard false)
  (ok true)
)

(define-private (transfer-stx (amount uint) (to principal))
  (as-contract (stx-transfer? amount tx-sender to))
)

(define-public (init-escrow
  (id uint)
  (sender principal)
  (recipient principal)
  (amount uint)
  (currency (string-ascii 10))
  (condition-contract principal)
  (condition-param uint)
  (expires-in (optional uint))
)
  (let ((current-id (var-get next-escrow-id)))
    (asserts! (is-eq id current-id) (err ERR-NOT-FOUND))
    (try! (validate-amount amount))
    (try! (validate-recipient recipient))
    (try! (validate-currency currency))
    (try! (validate-condition-contract condition-contract))
    (asserts! (< current-id (var-get max-escrows)) (err ERR-MAX-ESCROWS-EXCEEDED))
    (try! (prevent-reentrancy))
    (map-set escrows id
      {
        sender: sender,
        recipient: recipient,
        amount: amount,
        currency: currency,
        condition-contract: condition-contract,
        condition-param: condition-param,
        created-at: block-height,
        expires-at: (match expires-in exp (+ block-height exp) none),
        status: "active",
        dispute-resolver: none,
        dispute-initiated: false,
        dispute-reason: none,
        cancelled: false
      }
    )
    (map-set escrow-balances id amount)
    (try! (transfer-stx amount sender))
    (var-set next-escrow-id (+ id u1))
    (try! (release-reentrancy))
    (ok id)
  )
)

(define-public (release (id uint) (condition <condition-trait>))
  (let ((escrow (unwrap! (map-get? escrows id) (err ERR-NOT-FOUND))))
    (asserts! (is-eq (get status escrow) "active") (err ERR-ALREADY-CLAIMED))
    (asserts! (not (get cancelled escrow)) (err ERR-ESCROW-CANCELLED))
    (try! (prevent-reentrancy))
    (let ((verified (try! (contract-call? condition verify (get recipient escrow) (get condition-param escrow)))))
      (asserts! verified (err ERR-CONDITION-NOT-MET))
      (let ((amount (unwrap! (map-get? escrow-balances id) (err ERR-INSUFFICIENT-BALANCE))))
        (try! (transfer-stx amount (get recipient escrow)))
        (map-delete escrow-balances id)
        (map-set escrows id (merge escrow {status: "released"}))
        (try! (release-reentrancy))
        (ok true)
      )
    )
  )
)

(define-public (refund (id uint))
  (let ((escrow (unwrap! (map-get? escrows id) (err ERR-NOT-FOUND))))
    (asserts! (is-eq tx-sender (get sender escrow)) (err ERR-NOT-OWNER))
    (asserts! (is-eq (get status escrow) "active") (err ERR-ALREADY-CLAIMED))
    (asserts! (not (get dispute-initiated escrow)) (err ERR-DISPUTE-INITIATED))
    (asserts! (not (get cancelled escrow)) (err ERR-ESCROW-CANCELLED))
    (try! (prevent-reentrancy))
    (if (is-some (get expires-at escrow))
      (asserts! (is-escrow-expired id) (err ERR-ESCROW-NOT-EXPIRED))
      (ok true)
    )
    (let ((amount (unwrap! (map-get? escrow-balances id) (err ERR-INSUFFICIENT-BALANCE))))
      (try! (transfer-stx amount (get sender escrow)))
      (map-delete escrow-balances id)
      (map-set escrows id (merge escrow {status: "refunded"}))
      (try! (release-reentrancy))
      (ok true)
    )
  )
)

(define-public (cancel (id uint))
  (let ((escrow (unwrap! (map-get? escrows id) (err ERR-NOT-FOUND))))
    (asserts! (is-eq tx-sender (get sender escrow)) (err ERR-NOT-OWNER))
    (asserts! (is-eq (get status escrow) "active") (err ERR-ALREADY-CLAIMED))
    (asserts! (not (get dispute-initiated escrow)) (err ERR-DISPUTE-INITIATED))
    (try! (prevent-reentrancy))
    (let ((amount (unwrap! (map-get? escrow-balances id) (err ERR-INSUFFICIENT-BALANCE))))
      (try! (transfer-stx amount (get sender escrow)))
      (map-delete escrow-balances id)
      (map-set escrows id (merge escrow {status: "cancelled", cancelled: true}))
      (try! (release-reentrancy))
      (ok true)
    )
  )
)

(define-public (initiate-dispute (id uint) (reason (string-utf8 256)))
  (let ((escrow (unwrap! (map-get? escrows id) (err ERR-NOT-FOUND))))
    (asserts! (or (is-eq tx-sender (get sender escrow)) (is-eq tx-sender (get recipient escrow))) (err ERR-NOT-OWNER))
    (asserts! (is-eq (get status escrow) "active") (err ERR-ALREADY-CLAIMED))
    (asserts! (not (get dispute-initiated escrow)) (err ERR-DISPUTE-INITIATED))
    (try! (prevent-reentrancy))
    (try! (transfer-stx (var-get dispute-fee) tx-sender))
    (map-set escrows id (merge escrow {dispute-initiated: true, dispute-reason: (some reason)}))
    (map-set dispute-records id {initiator: tx-sender, timestamp: block-height, resolved: false})
    (try! (release-reentrancy))
    (ok true)
  )
)

(define-public (resolve-dispute (id uint) (release-to-recipient bool))
  (let ((escrow (unwrap! (map-get? escrows id) (err ERR-NOT-FOUND))))
    (asserts! (get dispute-initiated escrow) (err ERR-DISPUTE-NOT-INITIATED))
    (asserts! (match (get dispute-resolver escrow) resolver (is-eq tx-sender resolver) false) (err ERR-NOT-DISPUTE-RESOLVER))
    (try! (prevent-reentrancy))
    (let ((amount (unwrap! (map-get? escrow-balances id) (err ERR-INSUFFICIENT-BALANCE))))
      (if release-to-recipient
        (try! (transfer-stx amount (get recipient escrow)))
        (try! (transfer-stx amount (get sender escrow)))
      )
      (map-delete escrow-balances id)
      (map-set escrows id (merge escrow {status: (if release-to-recipient "released" "refunded")}))
      (map-set dispute-records id (merge (unwrap! (map-get? dispute-records id) (err ERR-NOT-FOUND)) {resolved: true}))
      (try! (release-reentrancy))
      (ok true)
    )
  )
)

(define-public (set-dispute-resolver (id uint) (resolver principal))
  (let ((escrow (unwrap! (map-get? escrows id) (err ERR-NOT-FOUND))))
    (asserts! (is-eq tx-sender (get sender escrow)) (err ERR-NOT-OWNER))
    (asserts! (get dispute-initiated escrow) (err ERR-DISPUTE-NOT-INITIATED))
    (map-set escrows id (merge escrow {dispute-resolver: (some resolver)}))
    (ok true)
  )
)

(define-public (extend-expiry (id uint) (additional-blocks uint))
  (let ((escrow (unwrap! (map-get? escrows id) (err ERR-NOT-FOUND))))
    (asserts! (is-eq tx-sender (get sender escrow)) (err ERR-NOT-OWNER))
    (asserts! (is-eq (get status escrow) "active") (err ERR-ALREADY-CLAIMED))
    (asserts! (> additional-blocks u0) (err ERR-INVALID-AMOUNT))
    (let ((new-expiry (+ block-height additional-blocks)))
      (map-set escrows id (merge escrow {expires-at: (some new-expiry)}))
      (ok new-expiry)
    )
  )
)

(define-public (get-escrow-count)
  (ok (var-get next-escrow-id))
)