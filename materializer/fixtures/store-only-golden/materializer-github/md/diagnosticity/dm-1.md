# **DM-1** · Intermittent auth bypass

*One matrix: the evidence against each viable explanation, and the outcome it drove. Use it when you followed a DM- link.*

Terms on this page: [Subsystem](../how-to-read.md#term-subsystem) · [Competing explanations](../how-to-read.md#term-competing-explanations)

**Subsystem**: **[B-02](../subsystems/b02-auth-service.md)** (Auth Service)  
**Shared location**: `auth/gateway.ts:parse@deadbeef`  
**Outcome**: resolved
**Leading concern**: **[concern TC-1](../concerns.md#tc-1)**  

## Matrix

| Evidence | **[CB-1](../concerns.md#cb-1)** | **[TC-1](../concerns.md#tc-1)** | Diagnostic value |
|---|---|---|---|
| `auth/gateway.ts` · `parse` · _code-verified_ | ✗ | ✓ | 1✗ / 1✓ |
| `auth/gateway.ts` · `parse` · _comment-asserted_ | · | ✗ | 1✗ / 0✓ |

**Cell legend**: ✓ consistent · ✗ contradicts · · irrelevant · ~ ambiguous

## Evidence detail

### Evidence #1

`auth/gateway.ts` · `parse` · _code-verified_ · ref `deadbeef`

_Unsanitized input flows to SQL_

### Evidence #2

`auth/gateway.ts` · `parse` · _comment-asserted_ · ref `deadbeef`

_Docstring claims sanitization_

*Rendered from the command line. Its read-back was not recorded in the survey's record, so the Publication integrity figures on the overview describe an earlier publication.*
