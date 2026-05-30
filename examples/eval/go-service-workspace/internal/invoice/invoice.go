package invoice

import (
	"fmt"

	"example.com/billing/internal/validation"
)

// CreateInvoice builds an invoice after validating the request amount.
func CreateInvoice(customerID string, amount int) (string, error) {
	if err := validation.ValidateAmount(amount); err != nil {
		return "", err
	}
	return fmt.Sprintf("invoice-%s", customerID), nil
}
