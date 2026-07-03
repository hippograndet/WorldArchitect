# Security Policy

This file covers how to report a security vulnerability in WorldArchitect itself. For the app's security model (data egress, secret handling, prompt/output safety), see [docs/security.md](docs/security.md).

## Supported Versions

WorldArchitect is pre-1.0 (`v0.5.x`). Only the latest commit on `main` is supported — there are no maintained older release branches yet.

## Reporting a Vulnerability

Please **do not open a public GitHub issue** for security vulnerabilities.

Instead, report it privately using one of:

- [GitHub's private vulnerability reporting](https://github.com/hippograndet/WorldArchitect/security/advisories/new) (preferred — keeps the report and any discussion private until a fix ships)
- Email: hippolytegrandet@gmail.com

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce (a minimal repro is very helpful)
- Whether it affects local mode (`APP_MODE=local`), hosted mode (`APP_MODE=hosted`), or both

You should expect an initial response within a few days. This is a small, actively-maintained solo project rather than a company with an SLA — please be patient, but reports will not be ignored.

## Scope

In scope: the WorldArchitect application code in this repository (`client/`, `server/`).

Out of scope: vulnerabilities in third-party dependencies (report those upstream), and issues that require an attacker to already have full access to a user's own local machine or database file in local mode (that's the local-first trust model, not a vulnerability — see [docs/local-first.md](docs/local-first.md)).
