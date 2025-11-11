(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-MAX-SIGNERS u101)
(define-constant ERR-INVALID-REQUIRED u102)
(define-constant ERR-INVALID-VOTING-DUR u103)
(define-constant ERR-INVALID-PENALTY-RATE u104)
(define-constant ERR-INVALID-THRESHOLD u105)
(define-constant ERR-CONDITION-ALREADY-EXISTS u106)
(define-constant ERR-CONDITION-NOT-FOUND u107)
(define-constant ERR-INVALID-TIMESTAMP u108)
(define-constant ERR-AUTHORITY-NOT-VERIFIED u109)
(define-constant ERR-INVALID-MIN-STAKE u110)
(define-constant ERR-INVALID-MAX-STAKE u111)
(define-constant ERR-UPDATE-NOT-ALLOWED u112)
(define-constant ERR-INVALID-UPDATE-PARAM u113)
(define-constant ERR-MAX-CONDITIONS-EXCEEDED u114)
(define-constant ERR-INVALID-CONDITION-TYPE u115)
(define-constant ERR-INVALID-INTEREST-RATE u116)
(define-constant ERR-INVALID-GRACE-PERIOD u117)
(define-constant ERR-INVALID-LOCATION u118)
(define-constant ERR-INVALID-CURRENCY u119)
(define-constant ERR-INVALID-STATUS u120)
(define-constant ERR-ALREADY-SIGNED u121)
(define-constant ERR-NOT-SIGNER u122)

(define-data-var next-condition-id uint u0)
(define-data-var max-conditions uint u1000)
(define-data-var creation-fee uint u1000)
(define-data-var authority-contract (optional principal) none)

(define-map conditions
  uint
  {
    name: (string-utf8 100),
    max-signers: uint,
    required: uint,
    voting-duration: uint,
    penalty-rate: uint,
    threshold: uint,
    timestamp: uint,
    creator: principal,
    condition-type: (string-utf8 50),
    interest-rate: uint,
    grace-period: uint,
    location: (string-utf8 100),
    currency: (string-utf8 20),
    status: bool,
    min-stake: uint,
    max-stake: uint,
    signers: (list 50 principal),
    approvals: (list 50 principal)
  }
)

(define-map conditions-by-name
  (string-utf8 100)
  uint)

(define-map condition-updates
  uint
  {
    update-name: (string-utf8 100),
    update-max-signers: uint,
    update-required: uint,
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-condition (id uint))
  (map-get? conditions id)
)

(define-read-only (get-condition-updates (id uint))
  (map-get? condition-updates id)
)

(define-read-only (is-condition-registered (name (string-utf8 100)))
  (is-some (map-get? conditions-by-name name))
)

(define-private (validate-name (name (string-utf8 100)))
  (if (and (> (len name) u0) (<= (len name) u100))
      (ok true)
      (err ERR-INVALID-UPDATE-PARAM))
)

(define-private (validate-max-signers (members uint))
  (if (and (> members u0) (<= members u50))
      (ok true)
      (err ERR-INVALID-MAX-SIGNERS))
)

(define-private (validate-required (amount uint))
  (if (> amount u0)
      (ok true)
      (err ERR-INVALID-REQUIRED))
)

(define-private (validate-voting-duration (duration uint))
  (if (> duration u0)
      (ok true)
      (err ERR-INVALID-VOTING-DUR))
)

(define-private (validate-penalty-rate (rate uint))
  (if (<= rate u100)
      (ok true)
      (err ERR-INVALID-PENALTY-RATE))
)

(define-private (validate-threshold (threshold uint))
  (if (and (> threshold u0) (<= threshold u100))
      (ok true)
      (err ERR-INVALID-THRESHOLD))
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (validate-condition-type (type (string-utf8 50)))
  (if (or (is-eq type "simple") (is-eq type "weighted") (is-eq type "community"))
      (ok true)
      (err ERR-INVALID-CONDITION-TYPE))
)

(define-private (validate-interest-rate (rate uint))
  (if (<= rate u20)
      (ok true)
      (err ERR-INVALID-INTEREST-RATE))
)

(define-private (validate-grace-period (period uint))
  (if (<= period u30)
      (ok true)
      (err ERR-INVALID-GRACE-PERIOD))
)

(define-private (validate-location (loc (string-utf8 100)))
  (if (and (> (len loc) u0) (<= (len loc) u100))
      (ok true)
      (err ERR-INVALID-LOCATION))
)

(define-private (validate-currency (cur (string-utf8 20)))
  (if (or (is-eq cur "STX") (is-eq cur "USD") (is-eq cur "BTC"))
      (ok true)
      (err ERR-INVALID-CURRENCY))
)

(define-private (validate-min-stake (min uint))
  (if (> min u0)
      (ok true)
      (err ERR-INVALID-MIN-STAKE))
)

(define-private (validate-max-stake (max uint))
  (if (> max u0)
      (ok true)
      (err ERR-INVALID-MAX-STAKE))
)

(define-private (validate-principal (p principal))
  (if (not (is-eq p 'SP000000000000000000002Q6VF78))
      (ok true)
      (err ERR-NOT-AUTHORIZED))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (try! (validate-principal contract-principal))
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-conditions (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set max-conditions new-max)
    (ok true)
  )
)

(define-public (set-creation-fee (new-fee uint))
  (begin
    (asserts! (>= new-fee u0) (err ERR-INVALID-UPDATE-PARAM))
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-VERIFIED))
    (var-set creation-fee new-fee)
    (ok true)
  )
)

(define-public (create-condition (params (buff 1024)))
  (let ((data (unwrap! (from-consensus-buff? {name: (string-utf8 100), max-signers: uint, required: uint, voting-duration: uint, penalty-rate: uint, threshold: uint, condition-type: (string-utf8 50), interest-rate: uint, grace-period: uint, location: (string-utf8 100), currency: (string-utf8 20), min-stake: uint, max-stake: uint, signers: (list 50 principal)} params) (err ERR-INVALID-UPDATE-PARAM))))
    (let (
          (next-id (var-get next-condition-id))
          (current-max (var-get max-conditions))
          (authority (var-get authority-contract))
          (name (get name data))
          (max-signers (get max-signers data))
          (required (get required data))
          (voting-duration (get voting-duration data))
          (penalty-rate (get penalty-rate data))
          (threshold (get threshold data))
          (condition-type (get condition-type data))
          (interest-rate (get interest-rate data))
          (grace-period (get grace-period data))
          (location (get location data))
          (currency (get currency data))
          (min-stake (get min-stake data))
          (max-stake (get max-stake data))
          (signers (get signers data))
        )
      (asserts! (< next-id current-max) (err ERR-MAX_CONDITIONS-EXCEEDED))
      (try! (validate-name name))
      (try! (validate-max-signers max-signers))
      (try! (validate-required required))
      (try! (validate-voting-duration voting-duration))
      (try! (validate-penalty-rate penalty-rate))
      (try! (validate-threshold threshold))
      (try! (validate-condition-type condition-type))
      (try! (validate-interest-rate interest-rate))
      (try! (validate-grace-period grace-period))
      (try! (validate-location location))
      (try! (validate-currency currency))
      (try! (validate-min-stake min-stake))
      (try! (validate-max-stake max-stake))
      (asserts! (<= required max-signers) (err ERR-INVALID-REQUIRED))
      (asserts! (is-none (map-get? conditions-by-name name)) (err ERR-CONDITION-ALREADY-EXISTS))
      (let ((authority-recipient (unwrap! authority (err ERR-AUTHORITY-NOT-VERIFIED))))
        (try! (stx-transfer? (var-get creation-fee) tx-sender authority-recipient))
      )
      (map-set conditions next-id
        {
          name: name,
          max-signers: max-signers,
          required: required,
          voting-duration: voting-duration,
          penalty-rate: penalty-rate,
          threshold: threshold,
          timestamp: block-height,
          creator: tx-sender,
          condition-type: condition-type,
          interest-rate: interest-rate,
          grace-period: grace-period,
          location: location,
          currency: currency,
          status: true,
          min-stake: min-stake,
          max-stake: max-stake,
          signers: signers,
          approvals: (list)
        }
      )
      (map-set conditions-by-name name next-id)
      (var-set next-condition-id (+ next-id u1))
      (print { event: "condition-created", id: next-id })
      (ok next-id)
    )
  )
)

(define-public (approve (id uint))
  (match (map-get? conditions id)
    entry
      (if (index-of? (get signers entry) tx-sender)
        (if (index-of? (get approvals entry) tx-sender)
          (err ERR-ALREADY-SIGNED)
          (begin
            (map-set conditions id (merge entry {approvals: (append (get approvals entry) tx-sender)}))
            (ok true)
          )
        )
        (err ERR-NOT-SIGNER)
      )
    (err ERR-CONDITION-NOT-FOUND)
  )
)

(define-public (verify (recipient principal) (id uint))
  (match (map-get? conditions id)
    entry
      (ok (and (>= (len (get approvals entry)) (get required entry))
               (<= block-height (+ (get timestamp entry) (get voting-duration entry)))))
    (err ERR-CONDITION-NOT-FOUND)
  )
)

(define-public (update-condition
  (condition-id uint)
  (update-name (string-utf8 100))
  (update-max-signers uint)
  (update-required uint)
)
  (let ((condition (map-get? conditions condition-id)))
    (match condition
      c
        (begin
          (asserts! (is-eq (get creator c) tx-sender) (err ERR-NOT-AUTHORIZED))
          (try! (validate-name update-name))
          (try! (validate-max-signers update-max-signers))
          (try! (validate-required update-required))
          (asserts! (<= update-required update-max-signers) (err ERR-INVALID-REQUIRED))
          (let ((existing (map-get? conditions-by-name update-name)))
            (match existing
              existing-id
                (asserts! (is-eq existing-id condition-id) (err ERR-CONDITION-ALREADY-EXISTS))
              true
            )
          )
          (let ((old-name (get name c)))
            (if (is-eq old-name update-name)
                (ok true)
                (begin
                  (map-delete conditions-by-name old-name)
                  (map-set conditions-by-name update-name condition-id)
                  (ok true)
                )
            )
          )
          (map-set conditions condition-id
            (merge c {
              name: update-name,
              max-signers: update-max-signers,
              required: update-required,
              timestamp: block-height
            })
          )
          (map-set condition-updates condition-id
            {
              update-name: update-name,
              update-max-signers: update-max-signers,
              update-required: update-required,
              update-timestamp: block-height,
              updater: tx-sender
            }
          )
          (print { event: "condition-updated", id: condition-id })
          (ok true)
        )
      (err ERR-CONDITION-NOT-FOUND)
    )
  )
)

(define-public (get-condition-count)
  (ok (var-get next-condition-id))
)

(define-public (check-condition-existence (name (string-utf8 100)))
  (ok (is-condition-registered name))
)