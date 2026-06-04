// Amount validation for the billing service.
pub fn validate_amount(amount: i64) -> Result<(), String> {
    if amount <= 0 {
        return Err("invoice amount must be positive".to_string());
    }
    Ok(())
}
