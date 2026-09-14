# Security

Makor handles photos of identity documents and cheques, so a vulnerability here can expose
personal data.

## Reporting

Issues and pull requests on this repository are open to the maintainer only. Report a
vulnerability **privately**: e-mail the address in
[`web/lib/links.ts`](web/lib/links.ts) (`CONTACT_EMAIL`) with the subject *Makor security*, or
use GitHub's *Report a vulnerability* on the repository's Security tab. Describe the affected
component (engine, web app, deployment files), the steps to reproduce and the impact. You will
get an answer within a few days.

## Never include real documents

Do not attach a real document image, or any value read off one — ID, passport, cheque or
account numbers, names, addresses, phone numbers — to a report, an issue or a pull request.
Reproduce with synthetic values (`123456782` is a valid Israeli ID for testing) or a specimen.

## Scope

The code in this repository and its deployment files. A hosted instance's operator is
responsible for its own server, keys and configuration; the public registries and the Anthropic
and Clerk services have their own disclosure programmes.
