use crate::validation::validate_amount;

// Builds an invoice after validating the requested amount.
pub fn create_invoice(customer_id: &str, amount: i64) -> Result<String, String> {
    validate_amount(amount)?;
    Ok(format!("invoice-{customer_id}"))
}
