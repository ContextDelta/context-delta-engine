def validate_amount(amount):
    """Reject negative or zero charge amounts."""
    if amount is None:
        raise ValueError("amount is required")
    if amount <= 0:
        raise ValueError("amount must be a positive charge value")
    return amount
