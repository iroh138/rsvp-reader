# Contributing

Thanks for your interest. Before you open a pull request, please read this.

## Contributions and licensing

The project is published under AGPL-3.0-only. The maintainer may also distribute it under other terms in the future, for example in app stores whose terms are not compatible with the AGPL, or as a closed-source version.

For that reason, **pull requests with code are accepted only together with a signed contributor licence agreement (CLA)**. The CLA grants the maintainer the right to relicense your contribution. Until a CLA is published, please open an issue to discuss your idea instead of sending code.

Bug reports, test PDFs (that you have the right to share) and documentation suggestions are welcome as issues.

## Rules for every change

- One change per pull request, with a description of the expected behaviour and how it was tested.
- `npm test` and `npm run build` pass.
- No new dependency without a note: why it is needed, who publishes it, and the lockfile diff.
- Changes to PDF import, the service worker, the build/CI configuration or position import need a negative test and a human review of the diff.
