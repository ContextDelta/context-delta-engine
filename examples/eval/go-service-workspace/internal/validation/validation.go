package validation

import "errors"

// ValidateAmount rejects invoices that are not strictly positive.
func ValidateAmount(amount int) error {
	if amount <= 0 {
		return errors.New("invoice amount must be positive")
	}
	return nil
}
