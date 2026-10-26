from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Login(StrictModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


class TicketCreate(StrictModel):
    subject: str = Field(min_length=3, max_length=180)
    description: str = Field(min_length=5, max_length=8000)
    customerName: str = Field(min_length=1, max_length=100)
    orderId: str | None = Field(default=None, min_length=1, max_length=100)


class RunCreate(StrictModel):
    idempotencyKey: str | None = Field(default=None, min_length=8, max_length=128, pattern=r"^[\w.-]+$")


class TicketUpdate(StrictModel):
    expectedVersion: StrictInt = Field(ge=1)
    subject: str | None = Field(default=None, min_length=3, max_length=180)
    description: str | None = Field(default=None, min_length=5, max_length=8000)
    orderId: str | None = Field(default=None, min_length=1, max_length=100)
    note: str | None = Field(default=None, min_length=3, max_length=2000)

    @model_validator(mode="after")
    def require_change(self):
        changed = self.model_fields_set - {"expectedVersion"}
        if not changed or any(getattr(self, name) is None for name in changed - {"orderId"}):
            raise ValueError("Supply at least one non-null update or note; only orderId may be null")
        return self


class TicketTransition(StrictModel):
    expectedVersion: StrictInt = Field(ge=1)
    action: Literal["resolve", "reopen"]
    reason: str = Field(min_length=3, max_length=2000)


class KnowledgePublish(StrictModel):
    expectedVersion: StrictInt = Field(ge=1)
    title: str = Field(min_length=3, max_length=180)
    body: str = Field(min_length=10, max_length=8000)
    reason: str = Field(min_length=3, max_length=1000)


class Decision(StrictModel):
    decision: Literal["approve", "reject"]
    reason: str = Field(min_length=3, max_length=1000)
    idempotencyKey: str = Field(min_length=8, max_length=128, pattern=r"^[\w.-]+$")


class Proposal(StrictModel):
    action: Literal["refund", "reply", "abstain"]
    amountCents: StrictInt = Field(ge=0, le=10_000_000)
    reason: str = Field(min_length=1, max_length=2000)
    citations: list[str] = Field(max_length=8)

    @field_validator("citations")
    @classmethod
    def validate_citations(cls, value):
        if any(len(x) > 180 for x in value):
            raise ValueError("Citation identifier is too long")
        return value


class ProviderResult(StrictModel):
    answer: str = Field(min_length=1, max_length=6000)
    proposal: Proposal
