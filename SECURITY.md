# Security policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability. Use GitHub's private
vulnerability reporting: the "Report a vulnerability" button under this
repository's Security tab. Include reproduction steps and, where possible, a
minimal failing input. Use synthetic data only, never real personal data.

We aim to acknowledge reports within 72 hours. Only the latest version
receives security fixes.

## What the tool protects against

This tool performs deterministic keyed pseudonymisation of tabular data.

| Adversary | Resisted? | Notes |
|---|---|---|
| Recipient of the output, without key or salt | Yes | Tokens are keyed BLAKE2b-512 MACs |
| Outsider linking two outputs | Only with a one-shot run | Dataset runs are linkable by design |
| Attacker holding the master key | No | Trying plausible values recovers them; key custody is the boundary |
| Frequency and co-occurrence analysis | No | Equal values give equal tokens |
| Re-identification from the columns left in clear | No (reported) | `anonymiser inspect` measures k-anonymity |

Pseudonymised output remains personal data under the GDPR. Never ship a key or
salt file with the data.

All cryptography comes from the RustCrypto libraries. The `kyber-aes` policy
is deprecated and refused for new runs; it was never a post-quantum
protection.
