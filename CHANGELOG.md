# Changelog

## 0.1.1

- Replace ambiguous Git diff header matching with deterministic linear scans, preventing excessive CPU use on malformed headers with repeated path separators.
- Limit each Git diff header to 128 KiB while preserving the 4,096-character decoded path limit, including fully octal-escaped UTF-8 paths. Validate both old and new header paths.
- Preserve quoted and unquoted paths, spaces, escaped quotes, renames, hunks and public API signatures. Add adversarial parser tests with a child-process deadline and maximum-length path fixtures.

## 0.1.0

Initial independently authored implementation, released on GitHub under Apache-2.0. Registry publication and installation verification are tracked separately for each channel.
