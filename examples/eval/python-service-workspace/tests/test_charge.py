import pytest

from payments.charge import charge


def test_rejects_negative_charge_amount():
    with pytest.raises(ValueError):
        charge("acct-1", -5)


def test_charges_positive_amount():
    assert charge("acct-1", 10)["status"] == "charged"
