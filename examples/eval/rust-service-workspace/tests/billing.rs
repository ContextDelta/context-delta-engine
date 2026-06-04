use rust_service::billing::create_invoice;

#[test]
fn rejects_zero_amount() {
    assert!(create_invoice("c1", 0).is_err());
}
