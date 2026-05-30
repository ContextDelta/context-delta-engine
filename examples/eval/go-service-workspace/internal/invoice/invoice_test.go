package invoice_test

import (
	"testing"

	"example.com/billing/internal/invoice"
)

func TestCreateInvoiceRejectsZeroAmount(t *testing.T) {
	if _, err := invoice.CreateInvoice("c1", 0); err == nil {
		t.Fatal("expected zero amount to be rejected")
	}
}

func TestCreateInvoiceAcceptsPositiveAmount(t *testing.T) {
	id, err := invoice.CreateInvoice("c1", 42)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "invoice-c1" {
		t.Fatalf("unexpected invoice id: %s", id)
	}
}
