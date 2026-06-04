# Billing Service

Invoices require a customer id and a positive amount. Amount validation lives in
`src/validation.rs`, while `src/billing.rs` owns invoice creation.
