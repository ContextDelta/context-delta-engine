from .validator import validate_amount


def charge(account, amount):
    """Charge an account. Negative amounts must be rejected."""
    validate_amount(amount)
    return {"account": account, "amount": amount, "status": "charged"}
