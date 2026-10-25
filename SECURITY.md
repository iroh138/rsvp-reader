# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub: **Security → Report a vulnerability** on this repository (private vulnerability reporting). Do not open a public issue.

Include what you found, how to reproduce it (a sample PDF if relevant), and the version or commit.

What to expect:
- acknowledgement within 3 working days;
- an assessment and, for confirmed issues, a fix or mitigation plan;
- credit in the release notes if you want it.

## Scope

In scope: the web app and its service worker, PDF import and rendering, import of reading positions, the build and release pipeline, and published store builds.

The app processes untrusted PDF files with PDF.js. Vulnerabilities in PDF.js itself should also be reported upstream to Mozilla.

## Supported versions

Only the latest released version receives fixes.
