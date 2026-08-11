# Contributing to Kalaido

Thanks for your interest in contributing.

For development setup, build commands and project layout, see the [README](README.md).

## Contributor License Agreement

Before we can merge your first contribution, you need to sign the [Contributor License Agreement](CLA.md).
Email <cla@northshoresoftware.ca> and we'll reply with a link to sign it electronically. You only need to do this once —
it covers all your future contributions.

## Third-party material

The CLA covers work you own. It does not — and cannot — cover work you don't.

If any part of your contribution was not written by you, it must be **disclosed and isolated**. This applies to code
copied or adapted from another project, snippets from a forum or article, generated content whose provenance you can't
establish, vendored files, and non-code assets such as images, fonts and icons.

This is not about keeping third-party material out. It is about knowing what is in the codebase and under what terms.

### 1. Put it in its own commit

Third-party material goes in a separate commit from your own work. Don't mix the two in one commit, even for a one-line
snippet.

Add a `Third-Party-Content` trailer to that commit's message so it can be found later:

```
Add rate limiter from upstream

Vendored from github.com/example/ratelimit at v1.4.2.

Third-Party-Content: y
```

Include the source license text where it is available.

### 2. Disclose it in the pull request

Document each piece of third-party material in the PR description, per the template.

If you can't establish one of the details it asks for, say so explicitly rather than guessing or leaving it blank.

## Questions

Open an issue, or email <kalaido@northshoresoftware.ca>.
