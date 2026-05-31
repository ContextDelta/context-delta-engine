# Billing Service

Invoices require a customer id and a positive amount. Amount validation lives in
`internal/validation/validation.go`, while `internal/invoice/invoice.go` owns the
invoice id and returned shape.
